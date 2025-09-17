// tiles.js — равномерная сетка (uniform grid) c единой ячейкой для обычных,
// но видео-тайлы растягиваются по своему AR на кратное число колонок.
import { ctx, state } from "./state.js";
import { byId, hashColor, isMobileView } from "./utils.js";
import { fitSpotlightSize } from "./layout.js";

// Безопасная обёртка для fitSpotlightSize
function safeFitSpotlightSize() {
  try {
    if (typeof fitSpotlightSize === 'function') {
      fitSpotlightSize();
    }
  } catch (e) {
    console.warn('fitSpotlightSize not available:', e);
  }
}

/* ===== DOM helpers ===== */
export function tilesMain(){ return byId('tilesMain'); }
export function tilesRail(){ return byId('tilesRail'); }
export function tilesHost(){ return byId('tiles'); }  // поле раскладки
export function getLocalTileVideo(){ return document.querySelector('.tile.me video'); }

function isMobileGrid(){ return isMobileView() && !ctx.isStageFull; }

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
  requestLayout(); // переложим сразу
  return el;
}

export function createRowEl(identity, name){
  const row=document.createElement('div');
  row.className='user';
  row.dataset.pid = identity;
  row.innerHTML=`<div class="avatar" style="background:${hashColor(name)}">${name.slice(0,1).toUpperCase()}</div><div class="name">${name}</div>`;
  row.onclick=()=>{ ctx.pinnedId = (ctx.pinnedId===identity? null : identity); };
  
  // Добавляем в оба списка (сайдбар для десктопа, карусель для мобильных)
  const lists = document.querySelectorAll('#onlineList');
  lists.forEach(list => {
    const clonedRow = row.cloneNode(true);
    clonedRow.onclick = () => { ctx.pinnedId = (ctx.pinnedId===identity? null : identity); };
    list.appendChild(clonedRow);
  });
  
  return row;
}

/* ===== Видео/Аудио ===== */
export function setTileAspectFromVideo(tile, videoEl){
  const w = videoEl.videoWidth | 0;
  const h = videoEl.videoHeight | 0;
  if (!w || !h) return;

  tile.classList.toggle('portrait', h > w);
  tile.dataset.ar = (w>0 && h>0) ? (w/h).toFixed(6) : '';
  tile.dataset.vid = '1'; // пометка «есть видео»

  if (isMobileGrid()){
    requestLayout();
  } else if (tile.classList.contains('spotlight')) {
    safeFitSpotlightSize();
  }
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
  tile.dataset.vid = newId || '1';
  tile.prepend(v);

  if(isLocal && !identity.includes('#screen')) applyCamTransformsTo(v);

  const tryApply = ()=> setTileAspectFromVideo(tile, v);
  v.addEventListener('loadedmetadata', tryApply);
  v.addEventListener('resize', tryApply);
  tryApply();

  requestLayout();
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
  if (t.classList.contains('spotlight')) fitSpotlightSize();
  requestLayout();
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
   РАВНОМЕРНАЯ СЕТКА (UNIFORM) С «SPAN BY AR» ДЛЯ ВИДЕО-ТАЙЛОВ
   — обычные плитки: единый размер ячейки по всей сетке
   — видео-плитки: ширина = span*cellW (+gaps), где span≈AR_video/AR_cell
   — расчёт ведём по #tiles (fallback: #tilesMain)
   ========================================================================= */

function hasVideo(tile){
  return !!tile.dataset.vid && !!tile.querySelector('video');
}

function getVideoAR(tile){
  const d = parseFloat(tile.dataset.ar);
  if (d && isFinite(d) && d > 0) return d;
  const v = tile.querySelector('video');
  const w = v?.videoWidth|0, h = v?.videoHeight|0;
  return (w>0 && h>0) ? (w/h) : NaN;
}

function getTileAR(tile){
  const d = parseFloat(tile.dataset.ar);
  if (d && isFinite(d) && d > 0) return d;
  const v = tile.querySelector('video');
  const w = v?.videoWidth|0, h = v?.videoHeight|0;
  if (w>0 && h>0) return w/h;
  return tile.classList.contains('portrait') ? (9/16) : (16/9);
}

// AR «ячейки» выбираем ТОЛЬКО по обычным (без видео) плиткам.
// Если их нет — берём 1:1 как нейтральный.
function pickCellAR(tiles){
  const ph = tiles.filter(t=>!hasVideo(t));
  if (!ph.length) return 1; // все видео — делаем квадратную базу
  const ars = ph.map(getTileAR);
  const portraits = ars.filter(a=>a<1).length;
  const majority = portraits > ph.length/2 ? (9/16) : (16/9);
  // попробуем также квадрат как запасной
  // вернём тот, который ближе к среднему по «фантомным» AR плейсхолдеров
  const avg = ars.reduce((s,a)=>s+a,0)/ars.length;
  const cand = [majority, 1];
  let best=cand[0], d=Math.abs(avg-best);
  if (Math.abs(avg-cand[1])<d) best=cand[1];
  return best;
}

// измеряем поле по #tiles (или #tilesMain)
function getFieldSize(){
  const host = tilesHost() || tilesMain() || document.body;
  const cs = getComputedStyle(host);
  const padH = (parseFloat(cs.paddingLeft)||0) + (parseFloat(cs.paddingRight)||0);
  const padV = (parseFloat(cs.paddingTop)||0)  + (parseFloat(cs.paddingBottom)||0);
  const W = Math.max(0, (host.clientWidth || host.getBoundingClientRect().width) - padH);
  const H = Math.max(0, (host.clientHeight|| host.getBoundingClientRect().height) - padV);
  return { W, H };
}

let layoutRAF = 0;
function requestLayout(){
  if (!isMobileGrid()) return;
  if (layoutRAF) return;
  layoutRAF = requestAnimationFrame(()=>{ layoutRAF = 0; layoutUniformGrid(); });
}

function layoutUniformGrid(){
  const m = tilesMain();
  if (!m) return;

  const tiles = Array.from(m.querySelectorAll('.tile'));
  const N = tiles.length;
  if (!N){ clearGrid(); return; }

  const { W, H } = getFieldSize();
  if (W < 10 || H < 10){ requestLayout(); return; }

  // гарантируем ширину
  m.style.width = '100%';

  const gap = parseFloat(getComputedStyle(m).getPropertyValue('--tile-gap')) || 10;

  // ==== Justified mosaic: 1..3 rows, per-tile AR = 16:9 or 9:16, same row height ====

  // Вычисляем желаемый AR для каждого тайла: 16:9 (>=1) или 9:16 (<1)
  const desiredAR = tiles.map(t=>{
    const ar = getVideoAR(t);
    if (ar && isFinite(ar)) return ar >= 1 ? (16/9) : (9/16);
    // нет видео — по умолчанию ландшафт
    return 16/9;
  });

  // Кандидаты по числу рядов (1..3 или до N)
  const maxRows = Math.min(3, Math.max(1, N));
  let best = null;

  function measureForRows(rowsCount){
    if (rowsCount < 1) return null;
    const hBase = (H - gap * (rowsCount - 1)) / rowsCount;
    if (!(hBase > 0)) return null;

    let idx = 0;
    const rows = [];
    let totalH = 0;

    for (let r = 0; r < rowsCount; r++){
      // Набираем ряд до переполнения ширины
      let sumW = 0;
      const start = idx;
      while (idx < N){
        sumW += desiredAR[idx] * hBase;
        const itemsInRow = idx - start + 1;
        const needed = sumW + gap * (itemsInRow - 1);
        if (needed >= W) { break; }
        idx++;
      }
      // Гарантируем минимум один элемент в ряду
      if (idx === start) idx++;

      const end = Math.min(idx, N-1);
      const rowIdxs = [];
      for (let k=start; k<=end; k++) rowIdxs.push(k);

      // Пересчёт точной высоты ряда, чтобы заполнить ширину (justified)
      const sumAR = rowIdxs.reduce((s,i)=> s + desiredAR[i], 0);
      const hRow = (W - gap * (rowIdxs.length - 1)) / (sumAR || (16/9));

      rows.push({ idxs: rowIdxs, h: Math.max(1, hRow) });
      totalH += hRow;
      if (r < rowsCount - 1) totalH += gap;

      idx = end + 1;
      if (idx >= N) break;
    }

    // Если есть ещё элементы, добавим дополнительный ряд (как штраф — превысим rowsCount)
    while (idx < N){
      const start = idx;
      let sumAR = 0, count = 0;
      while (idx < N){ sumAR += desiredAR[idx]; idx++; count++; if (count >= Math.ceil(N/rowsCount)) break; }
      const hRow = (W - gap * (count - 1)) / (sumAR || (16/9));
      rows.push({ idxs: Array.from({length:count}, (_,j)=> start+j), h: Math.max(1, hRow) });
      totalH += gap + hRow;
    }

    const fits = totalH <= H + 0.5; // допускаем подгонку в пределах пиксела
    const score = (fits?0:10000) + Math.abs(H - totalH);
    return { rows, totalH, score };
  }

  for (let r=1; r<=maxRows; r++){
    const cand = measureForRows(r);
    if (!best || (cand && cand.score < best.score)) best = cand;
  }
  if (!best){ clearGrid(); return; }

  // раскладываем
  m.style.position = 'relative';
  m.classList.add('grid-active');

  const px = (v)=> Math.round(v) + 'px';

  let y = 0;
  let tileIndexPlaced = 0;
  for (const row of best.rows){
    const h = row.h;
    let x = 0;
    const rowTiles = row.idxs.map(i => tiles[i]).filter(Boolean);
    const rowARs   = row.idxs.map(i => desiredAR[i]);
    const sumAR    = rowARs.reduce((s,a)=> s+a, 0) || (16/9);
    // первичные ширины до округления
    let widths = rowARs.map(a => a * h);
    const totalGaps = gap * (rowTiles.length - 1);
    const scale = (W - totalGaps) / widths.reduce((s,w)=> s+w, 0);
    widths = widths.map(w => w * scale);

    // исправим накопленную погрешность округления на последнем элементе
    let acc = 0;
    for (let i=0; i<rowTiles.length; i++){
      const isLast = (i === rowTiles.length - 1);
      const w = isLast ? (W - totalGaps - acc) : Math.round(widths[i]);
      const el = rowTiles[i];

      el.style.boxSizing = 'border-box';
      el.style.position = 'absolute';
      el.style.left = px(x);
      el.style.top  = px(y);
      el.style.setProperty('width',  px(w), 'important');
      el.style.setProperty('height', px(Math.round(h)), 'important');
      el.style.aspectRatio = '';

      x += w + gap;
      acc += isLast ? 0 : Math.round(widths[i]);
      tileIndexPlaced++;
    }
    y += Math.round(h) + gap;
  }

  m.style.height = px(y - gap);
  tiles.forEach(t=> t.classList.remove('spotlight','thumb'));
}

function clearGrid(){
  const m = tilesMain(); if (!m) return;
  m.classList.remove('grid-active');
  m.style.position = '';
  m.style.height   = '';
  m.style.width    = '';
  m.querySelectorAll('.tile').forEach(t=>{
    t.style.removeProperty('position');
    t.style.removeProperty('top');
    t.style.removeProperty('left');
    t.style.removeProperty('width');
    t.style.removeProperty('height');
    t.style.removeProperty('box-sizing');
    t.style.aspectRatio = '';
  });
}

/* --- реагируем на изменения окружения --- */
window.addEventListener('resize', ()=>{ if (isMobileGrid()) requestLayout(); }, { passive:true });
window.addEventListener('orientationchange', ()=>{ setTimeout(()=>{ if (isMobileGrid()) requestLayout(); }, 60); }, { passive:true });

/* ResizeObserver — следим и за .tiles-main, и за #tiles */
let roMain = null;
let roHost = null;
function attachROs(){
  const m = tilesMain();
  const h = tilesHost();

  if (roMain){ roMain.disconnect(); roMain = null; }
  if (roHost){ roHost.disconnect(); roHost = null; }

  if (m){
    roMain = new ResizeObserver(()=>{ if (isMobileGrid()) requestLayout(); });
    roMain.observe(m);
  }
  if (h){
    roHost = new ResizeObserver(()=>{ if (isMobileGrid()) requestLayout(); });
    roHost.observe(h);
  }
}
attachROs();
document.addEventListener('DOMContentLoaded', attachROs);

/* Перестраиваем при изменениях DOM/атрибутов (горячее подключение, смена AR) */
const tilesMutObs = new MutationObserver((muts)=>{
  if (!isMobileGrid()) return;
  for (const m of muts){
    if (m.type === 'childList' && (m.addedNodes.length || m.removedNodes.length)){ requestLayout(); return; }
    if (m.type === 'attributes'){ requestLayout(); return; } // data-ar / class / data-vid
  }
});
const tm = tilesMain();
tm && tilesMutObs.observe(tm, {
  childList:true,
  subtree:true,
  attributes:true,
  attributeFilter:['data-ar','class','data-vid']
});

/* Экспорт — на случай ручного пересчёта извне */
export function relayoutTilesIfMobile(){
  if (isMobileGrid()) layoutUniformGrid(); else clearGrid();
}
