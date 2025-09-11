// tiles.js — мозаичная (justified) раскладка с пер-тайловым AR на мобиле
import { ctx, state } from "./state.js";
import { byId, hashColor, isMobileView } from "./utils.js";

/* ===== мини-эмиттер для связи с layout-модулями (без циклов) ===== */
const emit = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }));
const requestSbarUpdate   = () => emit("layout:sbar-update");
const requestFitSpotlight = () => emit("layout:fit-spotlight");

/* ===== DOM helpers ===== */
export function tilesMain(){ return byId('tilesMain'); }
export function tilesRail(){ return byId('tilesRail'); }
export function getLocalTileVideo(){ return document.querySelector('.tile.me video'); }

/* важное: функция-декларация (нет TDZ) */
function isMobileMosaic(){ return isMobileView() && !ctx.isStageFull; }

/* ==== Overlay (как было) ==== */
const ov = byId('tileOverlay');
const ovMedia = byId('ovMedia');
const ovClose = byId('ovClose');
const ovName  = byId('ovName');
let ovReturnTile = null;

export async function openTileOverlay(tile){
  const v = tile.querySelector('video');
  if(!v) return;
  ovReturnTile = tile;
  ovName.textContent = tile.dataset.name || 'Видео';
  ov.classList.add('open'); ov.setAttribute('aria-hidden','false');
  ovMedia.innerHTML = ''; ovMedia.appendChild(v);
  try{ if(ov.requestFullscreen) await ov.requestFullscreen({ navigationUI:'hide' }); }catch{}
  try{ await screen.orientation.lock('landscape'); }catch{}
  state.me._mobileRotateOpen = true;
}
export async function closeTileOverlay(){
  if(!ovReturnTile) {
    ov.classList.remove('open'); ov.setAttribute('aria-hidden','true');
    try{ if(document.fullscreenElement) await document.exitFullscreen(); }catch{}
    try{ if(screen.orientation.unlock) screen.orientation.unlock(); }catch{}
    state.me._mobileRotateOpen = false;
    return;
  }
  const v = ovMedia.querySelector('video');
  if(v){ ovReturnTile.prepend(v); }
  ovReturnTile = null;
  ov.classList.remove('open'); ov.setAttribute('aria-hidden','true');
  try{ if(document.fullscreenElement) await document.exitFullscreen(); }catch{}
  try{ if(screen.orientation.unlock) screen.orientation.unlock(); }catch{}
  state.me._mobileRotateOpen = false;
}
ovClose?.addEventListener('click', closeTileOverlay);
ov?.addEventListener('click', (e)=>{ if(e.target===ov) closeTileOverlay(); });
document.addEventListener('keydown', (e)=>{ if(e.key==='Escape' && ov?.classList.contains('open')) closeTileOverlay(); });

/* ===== Создание тайла / строки в списке ===== */
export function createTileEl(identity, name, isLocal){
  const el=document.createElement('div');
  el.className='tile' + (isLocal?' me':'');

  el.dataset.pid=identity;
  el.dataset.name=name;
  el.style.background = hashColor(name);

  const vol = isLocal ? '' :
    `<div class="vol"><span>🔊</span><input type="range" min="0" max="100" value="100" data-act="vol"></div>`;

  el.innerHTML = `
    <div class="placeholder"><div class="avatar-ph">${name.slice(0,1).toUpperCase()}</div></div>
    <div class="name">${name}${isLocal?' (ты)':''}</div>
    ${vol}
    <div class="controls"><button class="ctrl" data-act="pin" title="В спотлайт">⭐</button></div>`;

  el.addEventListener('click', (e)=>{
    const act = e.target?.dataset?.act;
    if(act==='pin'){
      ctx.pinnedId = (ctx.pinnedId===identity ? null : identity);
      e.stopPropagation();
      return;
    }
    if(el.querySelector('video')){ openTileOverlay(el); }
  });

  el.addEventListener('input',(e)=>{
    if(e.target?.dataset?.act!=='vol') return;
    e.stopPropagation();
    const rec = ctx.registry.get(identity);
    const v = Math.max(0, Math.min(100, Number(e.target.value||0)));
    if(rec){
      rec.volume = v/100;
      if(rec.audioEl) rec.audioEl.volume = rec.volume;
    }
  });

  tilesMain().appendChild(el);
  // На мобиле сразу переложим мозаику
  if (isMobileMosaic()) layoutMosaic();
  return el;
}

export function createRowEl(identity, name){
  const row=document.createElement('div');
  row.className='user';
  row.dataset.pid = identity;
  row.innerHTML=`<div class="avatar" style="background:${hashColor(name)}">${name.slice(0,1).toUpperCase()}</div><div class="name">${name}</div>`;
  row.onclick=()=>{ ctx.pinnedId = (ctx.pinnedId===identity? null : identity); };
  byId('onlineList').appendChild(row);
  return row;
}

/* ===== Видео/Аудио ===== */
export function setTileAspectFromVideo(tile, videoEl){
  // всегда вычисляем реальный AR и сохраняем его
  const w = videoEl.videoWidth | 0;
  const h = videoEl.videoHeight | 0;
  if (!w || !h) return;

  const isPortrait = h > w;
  tile.classList.toggle('portrait', isPortrait);
  tile.dataset.ar = (w>0 && h>0) ? (w/h).toFixed(6) : ''; // пригодится раскладчику

  if (isMobileMosaic()){
    layoutMosaic();         // перестроить «мозаику» на мобиле
    requestSbarUpdate();    // горизонтального скролла нет — но обновим статус
  } else if (tile.classList.contains('spotlight')) {
    requestFitSpotlight();  // десктоп попросим подогнать спотлайт
  }

  emit('tiles:ar-changed', { tile });
}

export function applyCamTransformsTo(el){
  if(!el) return;
  const rot = state.settings.camFlip ? ' rotate(180deg)' : '';
  const mir = state.settings.camMirror ? ' scaleX(-1)' : '';
  el.style.transform = mir + rot;
}
export function applyCamTransformsToLive(){
  const v = getLocalTileVideo();
  applyCamTransformsTo(v);
}

export function safeRemoveVideo(el){
  try{ el.pause?.(); }catch{}
  try{ el.srcObject = null; }catch{}
  try{ el.removeAttribute('src'); }catch{}
  try{ el.load?.(); }catch{}
  try{ el.remove(); }catch{}
}

export function attachVideoToTile(track, identity, isLocal, labelOverride){
  const rec  = ctx.registry.get(identity.replace('#screen','')) || { name: identity };
  const name = labelOverride || rec.name || identity;
  const tile = ensureTile(identity, name, isLocal);

  const newId = track?.mediaStreamTrack?.id || track?.mediaStream?.id || '';
  const curV  = tile.querySelector('video');
  const curId = tile.dataset.vid || '';

  if (curV && curId && curId === newId){
    curV.muted = !!isLocal;
    if (isLocal && !identity.includes('#screen')) applyCamTransformsTo(curV);
    setTileAspectFromVideo(tile, curV);
    return;
  }

  if (curV) safeRemoveVideo(curV);
  tile.querySelector('.placeholder')?.remove();

  const v = track.attach();
  v.autoplay = true;
  v.playsInline = true;
  v.setAttribute('autoplay','');
  v.setAttribute('playsinline','');
  if (isLocal){
    v.muted = true;
    v.setAttribute('muted','');
  }
  v.classList.add('media');
  tile.dataset.vid = newId || '';
  tile.prepend(v);

  if(isLocal && !identity.includes('#screen')) applyCamTransformsTo(v);

  const tryApply = ()=> setTileAspectFromVideo(tile, v);
  v.addEventListener('loadedmetadata', tryApply);
  v.addEventListener('resize', tryApply);
  tryApply();

  if (isMobileMosaic()) layoutMosaic();
  requestSbarUpdate();
}

export function ensureTile(identity, name, isLocal){
  let el = document.querySelector(`.tile[data-pid="${CSS.escape(identity)}"]`);
  if(el) return el;
  if(!identity.includes('#screen') && ctx.registry.has(identity)){
    return ctx.registry.get(identity).tile;
  }
  return createTileEl(identity, name, isLocal);
}

export function showAvatarInTile(identity){
  const t=document.querySelector(`.tile[data-pid="${CSS.escape(identity)}"]`);
  if(!t) return;
  t.classList.remove('portrait');
  const v = t.querySelector('video');
  if (v) safeRemoveVideo(v);
  t.dataset.vid = '';
  delete t.dataset.ar;
  if(!t.querySelector('.placeholder')){
    const ph=document.createElement('div');
    ph.className='placeholder';
    ph.innerHTML=`<div class="avatar-ph">${(t.dataset.name||'?').slice(0,1).toUpperCase()}</div>`;
    t.prepend(ph);
  }
  if (t.classList.contains('spotlight')) requestFitSpotlight();
  if (isMobileMosaic()) layoutMosaic();
  requestSbarUpdate();
}

export function attachAudioTrack(track, baseId){
  const el=track.attach();
  el.style.display='none';
  document.body.appendChild(el);

  const rec = ctx.registry.get(baseId);
  if(rec){
    rec.audioEl = el;
    if(typeof rec.volume!=='number') rec.volume = 1;
    el.volume = rec.volume;
    const slider = rec.tile?.querySelector('.vol input[type=range]');
    if(slider){ slider.value = Math.round(rec.volume*100); slider.disabled=false; }
  }
  return el;
}

/* =========================================================================
   МОЗАИЧНАЯ РАСКЛАДКА (JUSTIFIED) ДЛЯ МОБИЛЬНОГО РЕЖИМА
   -------------------------------------------------------------------------
   — у каждой плитки свой AR (из videoWidth/videoHeight или .portrait)
   — раскладка по строкам; высота каждой строки выбрана так, чтобы сумма
     ширин плиток в строке идеально заполнила контейнер по ширине.
   — элементы позиционируются абсолютно внутри tilesMain.
   ========================================================================= */

function getTileAR(tile){
  // 1) точный из dataset (ставится в setTileAspectFromVideo)
  const d = parseFloat(tile.dataset.ar);
  if (d && isFinite(d) && d > 0) return d;

  // 2) из <video> (если уже прогружен)
  const v = tile.querySelector('video');
  const w = v?.videoWidth|0, h = v?.videoHeight|0;
  if (w>0 && h>0) return w/h;

  // 3) из класса .portrait
  return tile.classList.contains('portrait') ? (9/16) : (16/9);
}

function layoutMosaic(){
  const m = tilesMain();
  if (!m) return;

  const tiles = Array.from(m.querySelectorAll('.tile'));
  const N = tiles.length;
  if (!N) return;

  const box = m.getBoundingClientRect();
  let W = Math.max(0, box.width);
  let H = Math.max(0, box.height);
  if (W < 10 || H < 10){ requestAnimationFrame(layoutMosaic); return; }

  // Гэп из CSS переменной (или дефолт)
  const gap = parseFloat(getComputedStyle(m).getPropertyValue('--tile-gap')) || 10;

  // Подготовим данные по AR
  const items = tiles.map(t => ({ el:t, ar: Math.max(0.2, Math.min(5, getTileAR(t))) }));

  // --- Поиск лучшего числа строк (1..N)
  const totalAR = items.reduce((s,x)=>s+x.ar, 0);
  let best = null;

  function measure(rowsCount){
    // разбиваем items последовательно на rowsCount рядов,
    // пытаясь уравнять сумму AR в каждом ряду
    const target = totalAR / rowsCount;
    const rows = [];
    let row = [], sum = 0;

    for (let i=0;i<items.length;i++){
      const it = items[i];
      if (row.length===0){ row.push(it); sum = it.ar; continue; }

      const remain = items.length - i;           // сколько элементов осталось
      const rowsLeft = rowsCount - rows.length;  // включая текущий
      const mustBreak = remain <= (rowsLeft-1);  // если мало — переносим
      const closer = Math.abs(sum + it.ar - target) <= Math.abs(sum - target);

      if (!mustBreak && closer){
        row.push(it); sum += it.ar;
      } else {
        rows.push(row);
        row = [it]; sum = it.ar;
      }
    }
    if (row.length) rows.push(row);

    // Высота каждой строки, чтобы заполнить ширину W
    const heights = rows.map(r => {
      const sumAR = r.reduce((s,x)=>s+x.ar,0);
      const n = r.length;
      const wAvail = W - gap*(n-1);
      const h = wAvail / sumAR;
      return Math.max(40, h); // не даём строке становиться слишком низкой
    });

    const totalH = heights.reduce((s,h)=>s+h,0) + gap*(rows.length-1);
    return { rows, heights, totalH };
  }

  // предпочитаем количество рядов около ceil(sqrt(N));
  // один ряд при N>=2 — штрафуем, чтобы 2 участника стали в 2 ряда
  const prefRows = Math.min(N, Math.max(1, Math.ceil(Math.sqrt(N))));
  for (let r = 1; r <= N; r++){
    const cand = measure(r);
    const fits = cand.totalH <= H;

    const base   = fits ? (H - cand.totalH) : (cand.totalH - H + 10000); // штраф за переполнение
    const prefer = Math.abs(r - prefRows) * 200;                          // мягкая тяга к «разумным» рядам
    const singlePenalty = (N >= 2 && r === 1) ? 1000 : 0;                 // не хотим один ряд при 2+

    const score = base + prefer + singlePenalty;
    if (!best || score < best.score) best = { ...cand, rowsCount:r, score };
  }

  if (!best) return;

  // Абсолютное позиционирование
  m.style.position = 'relative';
  let y = 0;

  // Применяем размеры/позиции
  const px = (v)=> Math.round(v) + 'px';

  best.rows.forEach((row, ri) => {
    const h = best.heights[ri];
    let x = 0;
    row.forEach((it) => {
      const w = it.ar * h;
      const el = it.el;

      el.style.position = 'absolute';
      el.style.top  = px(y);
      el.style.left = px(x);
      el.style.width  = px(w);
      el.style.height = px(h);
      el.style.aspectRatio = ''; // чтобы не мешало фиксированным height

      x += w + gap;
    });
    y += h + gap;
  });

  // высота контейнера
  m.style.height = px(y - gap); // убрали последний gap

  // все «лишние» инлайны/классы, которые мешают мозаике
  tiles.forEach(t=>{
    t.classList.remove('spotlight','thumb');
  });

  // горизонтального скролла нет — спрячем/обновим кастомный сбар (через событие)
  requestSbarUpdate();
}

/* --- сброс мозаики (когда выходим из мобилки) --- */
function clearMosaic(){
  const m = tilesMain(); if (!m) return;
  m.style.position = '';
  m.style.height   = '';
  const tiles = m.querySelectorAll('.tile');
  tiles.forEach(t=>{
    t.style.position = '';
    t.style.top = '';
    t.style.left = '';
    t.style.width = '';
    t.style.height = '';
    t.style.aspectRatio = ''; // остальное снимет активный layout
  });
}

/* --- реагируем на изменения окружения --- */
window.addEventListener('resize', ()=>{
  if (isMobileMosaic()) layoutMosaic();
}, { passive:true });

window.addEventListener('orientationchange', ()=>{
  setTimeout(()=>{
    if (isMobileMosaic()) layoutMosaic();
  }, 60);
}, { passive:true });

/* Наблюдатель за DOM плиток — чтобы мозаика перестраивалась,
   когда плитки добавляются/удаляются не через наши функции */
const tilesMutObs = new MutationObserver((muts)=>{
  if (!isMobileMosaic()) return;
  for (const m of muts){
    if (m.type === 'childList' && (m.addedNodes.length || m.removedNodes.length)){
      layoutMosaic();
      return;
    }
  }
});
const tm = tilesMain();
tm && tilesMutObs.observe(tm, { childList:true });

/* Экспортируем тонкий API, если где-то понадобится ручной пересчёт */
export function relayoutTilesIfMobile(){
  if (isMobileMosaic()) layoutMosaic(); else clearMosaic();
}
