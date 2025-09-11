// tiles.js — равномерная сетка (uniform grid) с единой ячейкой на мобиле
import { ctx, state } from "./state.js";
import { byId, hashColor, isMobileView } from "./utils.js";
import { fitSpotlightSize } from "./layout.js";

/* ===== DOM helpers ===== */
export function tilesMain(){ return byId('tilesMain'); }
export function tilesRail(){ return byId('tilesRail'); }
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
  requestLayout(); // сразу адаптивно переложим
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
  const w = videoEl.videoWidth | 0;
  const h = videoEl.videoHeight | 0;
  if (!w || !h) return;

  const isPortrait = h > w;
  tile.classList.toggle('portrait', isPortrait);
  tile.dataset.ar = (w>0 && h>0) ? (w/h).toFixed(6) : '';

  if (isMobileGrid()){
    requestLayout();
  } else if (tile.classList.contains('spotlight')) {
    fitSpotlightSize();
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
  tile.dataset.vid = newId || '';
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
   РАВНОМЕРНАЯ СЕТКА ДЛЯ МОБИЛЬНОГО РЕЖИМА
   — все плитки одного размера (общая ширина/высота ячейки)
   — подбираем кол-во колонок (1..N) и единый aspect-ratio ячейки
   — целевая функция: максимальная суммарная площадь, при полном влезании в stage
   ========================================================================= */

function getTileAR(tile){
  const d = parseFloat(tile.dataset.ar);
  if (d && isFinite(d) && d > 0) return d;

  const v = tile.querySelector('video');
  const w = v?.videoWidth|0, h = v?.videoHeight|0;
  if (w>0 && h>0) return w/h;

  return tile.classList.contains('portrait') ? (9/16) : (16/9);
}

function getAvailableStageSize(m){
  const stage = m.closest?.('.stage') || m.parentElement || document.body;
  const cs = getComputedStyle(stage);
  const padV = (parseFloat(cs.paddingTop)||0) + (parseFloat(cs.paddingBottom)||0);
  const H = Math.max(0, stage.clientHeight - padV);
  const W = Math.max(0, m.clientWidth);
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

  const { W, H } = getAvailableStageSize(m);
  if (W < 10 || H < 10){ requestLayout(); return; }

  const gap = parseFloat(getComputedStyle(m).getPropertyValue('--tile-gap')) || 10;

  // Выберем ориентацию ячейки: по большинству тайлов (портрет/ландшафт)
  const ARs = tiles.map(getTileAR);
  const portraits = ARs.filter(ar => ar < 1).length;
  const majorityAR = portraits > N/2 ? 9/16 : 16/9;

  // Рассматриваем кандидаты AR ячейки
  const arCandidates = [majorityAR, 1]; // 1:1 как запасной вариант

  let best = null;

  function tryCandidate(cols, ar){
    const rows = Math.ceil(N / cols);
    const cellWAvail = (W - gap * (cols - 1)) / cols;
    const cellHAvail = (H - gap * (rows - 1)) / rows;
    if (cellWAvail <= 0 || cellHAvail <= 0) return null;

    // вариант 1: ограничены шириной
    const chByW = cellWAvail / ar;
    // вариант 2: ограничены высотой
    const cwByH = cellHAvail * ar;

    let cw, ch;
    if (chByW <= cellHAvail && cwByH <= cellWAvail) {
      // оба варианта влазят — берём тот, что даёт большую площадь
      const areaW = cellWAvail * chByW;
      const areaH = cwByH * cellHAvail;
      if (areaW >= areaH){ cw = cellWAvail; ch = chByW; } else { ch = cellHAvail; cw = cwByH; }
    } else if (chByW <= cellHAvail) {
      cw = cellWAvail; ch = chByW;
    } else if (cwByH <= cellWAvail) {
      ch = cellHAvail; cw = cwByH;
    } else {
      // ни один способ не влез — недопустимо
      return null;
    }

    const filledW = cw * cols + gap * (cols - 1);
    const filledH = ch * rows + gap * (rows - 1);
    const util = (filledW / W) * (filledH / H); // коэффициент заполнения
    const area = cw * ch; // площадь одной ячейки

    return { cols, rows, cw, ch, ar, area, util };
  }

  for (const ar of arCandidates){
    for (let cols = 1; cols <= N; cols++){
      const cand = tryCandidate(cols, ar);
      if (!cand) continue;
      // метрика отбора: сначала максимальная площадь клетки, затем лучший fill
      if (!best ||
          cand.area > best.area + 0.5 ||
          (Math.abs(cand.area - best.area) <= 0.5 && cand.util > best.util)) {
        best = cand;
      }
    }
  }

  if (!best){ clearGrid(); return; }

  // Расстановка
  m.style.position = 'relative';
  m.classList.add('grid-active');

  const px = (v)=> Math.round(v) + 'px';
  const { cols, rows, cw, ch } = best;

  tiles.forEach((el, i)=>{
    const r = Math.floor(i / cols);
    const c = i % cols;
    const left = c * (cw + gap);
    const top  = r * (ch + gap);

    el.style.boxSizing = 'border-box';
    el.style.position = 'absolute';
    el.style.left = px(left);
    el.style.top  = px(top);
    el.style.width  = px(cw);
    el.style.height = px(ch);
    el.style.aspectRatio = ''; // фиксируемся на width/height
  });

  m.style.height = px(rows * ch + gap * (rows - 1));

  tiles.forEach(t=> t.classList.remove('spotlight','thumb'));
}

function clearGrid(){
  const m = tilesMain(); if (!m) return;
  m.classList.remove('grid-active');
  m.style.position = '';
  m.style.height   = '';
  m.querySelectorAll('.tile').forEach(t=>{
    t.style.position = '';
    t.style.top = '';
    t.style.left = '';
    t.style.width = '';
    t.style.height = '';
    t.style.aspectRatio = '';
    t.style.boxSizing = '';
  });
}

/* --- реагируем на изменения окружения --- */
window.addEventListener('resize', ()=>{ if (isMobileGrid()) requestLayout(); }, { passive:true });
window.addEventListener('orientationchange', ()=>{ setTimeout(()=>{ if (isMobileGrid()) requestLayout(); }, 60); }, { passive:true });

/* ResizeObserver — если контейнер меняет размер */
let ro = null;
(function attachRO(){
  const m = tilesMain();
  if (!m) return;
  if (ro) ro.disconnect();
  ro = new ResizeObserver(()=>{ if (isMobileGrid()) requestLayout(); });
  ro.observe(m);
})();

/* Перестраиваем при изменениях DOM/атрибутов (горячее подключение и т.п.) */
const tilesMutObs = new MutationObserver((muts)=>{
  if (!isMobileGrid()) return;
  for (const m of muts){
    if (m.type === 'childList' && (m.addedNodes.length || m.removedNodes.length)){ requestLayout(); return; }
    if (m.type === 'attributes'){ requestLayout(); return; } // data-ar / class изменились
  }
});
const tm = tilesMain();
tm && tilesMutObs.observe(tm, {
  childList:true,
  subtree:true,
  attributes:true,
  attributeFilter:['data-ar','class']
});

/* Экспорт — на случай ручного пересчёта извне */
export function relayoutTilesIfMobile(){
  if (isMobileGrid()) layoutUniformGrid(); else clearGrid();
}
