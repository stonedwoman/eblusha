// tiles.js — uniform grid: одинаковые боксы; видео внутри сохраняет свой AR
import { ctx, state } from "./state.js";
import { byId, hashColor, isMobileView } from "./utils.js";
import { fitSpotlightSize } from "./layout.js";

/* ===== DOM helpers ===== */
export function tilesMain(){ return byId('tilesMain'); }
export function tilesRail(){ return byId('tilesRail'); }
export function tilesHost(){ return byId('tiles'); } // поле раскладки (#tiles)
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
  requestLayout(); // сразу переложим
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
function setPortraitFlag(tile, w, h){
  tile.classList.toggle('portrait', h > w);
}
export function setTileAspectFromVideo(tile, videoEl){
  const w = videoEl.videoWidth | 0;
  const h = videoEl.videoHeight | 0;
  if (!w || !h) return;
  setPortraitFlag(tile, w, h);
  tile.dataset.ar = (w>0 && h>0) ? (w/h).toFixed(6) : '';
  tile.dataset.vid = '1'; // пометка «есть видео»
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

/* — наблюдатель AR видео, чтобы ловить 16:9 ↔ 9:16 «на лету» — */
function stopVideoARWatcher(v){
  const st = v && v.__arWatch;
  if(!st) return;
  try{
    v.removeEventListener('loadedmetadata', st.onMeta);
    v.removeEventListener('loadeddata', st.onMeta);
    v.removeEventListener('resize', st.onMeta);
  }catch{}
  if (st.rfcb && v.cancelVideoFrameCallback){ try{ v.cancelVideoFrameCallback(st.rfcb); }catch{} }
  if (st.timer){ clearInterval(st.timer); }
  v.__arWatch = null;
}
function startVideoARWatcher(v, tile){
  if (!v || v.__arWatch) return;
  let lastW = 0, lastH = 0;
  const check = (ww, hh)=>{
    const w = (ww|0) || (v.videoWidth|0);
    const h = (hh|0) || (v.videoHeight|0);
    if (!w || !h) return;
    if (w!==lastW || h!==lastH){
      lastW = w; lastH = h;
      setTileAspectFromVideo(tile, v);
    }
  };
  const onMeta = ()=> check();
  v.addEventListener('loadedmetadata', onMeta);
  v.addEventListener('loadeddata', onMeta);
  v.addEventListener('resize', onMeta);
  let rfcb = 0, timer = 0;
  if (typeof v.requestVideoFrameCallback === 'function'){
    const loop = (_now, meta)=>{ check(meta?.width|0, meta?.height|0); rfcb = v.requestVideoFrameCallback(loop); };
    rfcb = v.requestVideoFrameCallback(loop);
  } else {
    timer = setInterval(()=> check(), 300);
  }
  v.__arWatch = { onMeta, rfcb, timer };
}

export function safeRemoveVideo(el){
  try{ stopVideoARWatcher(el); }catch{}
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
    startVideoARWatcher(curV, tile);
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

  startVideoARWatcher(v, tile);
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
   — все плитки ОДИНАКОВОГО размера (cellW × rowH)
   — AR видео влияет только на содержимое внутри (через object-fit: contain)
   ========================================================================= */

function getTileAR(tile){
  const d = parseFloat(tile.dataset.ar);
  if (d && isFinite(d) && d > 0) return d;
  const v = tile.querySelector('video');
  const w = v?.videoWidth|0, h = v?.videoHeight|0;
  if (w>0 && h>0) return w/h;
  return tile.classList.contains('portrait') ? (9/16) : (16/9);
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

  m.style.width = '100%';
  const gap = parseFloat(getComputedStyle(m).getPropertyValue('--tile-gap')) || 10;

  // AR ячейки берём по «большинству» тайлов; 1:1 — как запасной
  const ars = tiles.map(getTileAR);
  const portraits = ars.filter(a=>a<1).length;
  const cellAR = portraits > N/2 ? 9/16 : 16/9;

  // ищем число колонок, чтобы занять максимум пространства
  let best = null;

  function tryCols(cols){
    const rows = Math.ceil(N / cols);
    const cellWAvail = (W - gap * (cols - 1)) / cols;
    const cellHAvail = (H - gap * (rows - 1)) / rows;
    if (cellWAvail <= 0 || cellHAvail <= 0) return null;

    // стремимся к максимальной площади клетки, но чтобы всё влазило
    const hByW = cellWAvail / cellAR;
    const wByH = cellHAvail * cellAR;

    let cw, ch;
    if (hByW <= cellHAvail && wByH <= cellWAvail){
      // оба подходят — возьмём, что больше по площади
      const areaW = cellWAvail * hByW;
      const areaH = wByH * cellHAvail;
      if (areaW >= areaH){ cw = cellWAvail; ch = hByW; } else { cw = wByH; ch = cellHAvail; }
    } else if (hByW <= cellHAvail){
      cw = cellWAvail; ch = hByW;
    } else if (wByH <= cellWAvail){
      cw = wByH; ch = cellHAvail;
    } else {
      return null;
    }

    const filledW = cw * cols + gap * (cols - 1);
    const filledH = ch * rows + gap * (rows - 1);
    const util = (filledW / W) * (filledH / H);
    const area = cw * ch;
    return { cols, rows, cw, ch, util, area };
  }

  for (let cols=1; cols<=N; cols++){
    const cand = tryCols(cols);
    if (!cand) continue;
    if (!best ||
        cand.area > best.area + 0.5 ||
        (Math.abs(cand.area - best.area) <= 0.5 && cand.util > best.util)){
      best = cand;
    }
  }
  if (!best){ clearGrid(); return; }

  // Раскладываем абсолютно по одинаковым боксам
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
    el.style.setProperty('width',  px(cw), 'important');
    el.style.setProperty('height', px(ch), 'important');
    el.style.aspectRatio = ''; // управляем width/height
  });

  m.style.height = px(rows * ch + gap * (rows - 1));
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

/* Перестраиваем при изменениях DOM/атрибутов (горячие подключения, смена AR) */
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
