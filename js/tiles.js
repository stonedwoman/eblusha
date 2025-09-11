// tiles.js — гибрид: видео-тайлы с фиксированным AR, остальные — равные; justified-раскладка на мобиле
import { ctx, state } from "./state.js";
import { byId, hashColor, isMobileView } from "./utils.js";
import { fitSpotlightSize } from "./layout.js";

/* ===== DOM helpers ===== */
export function tilesMain(){ return byId('tilesMain'); }
export function tilesRail(){ return byId('tilesRail'); }
export function tilesHost(){ return byId('tiles'); }          // контейнер поля
export function getLocalTileVideo(){ return document.querySelector('.tile.me video'); }

function isMobileHybrid(){ return isMobileView() && !ctx.isStageFull; }

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
  requestLayout(); // адаптивно переложим сразу
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
function snapVideoAR(rawAr){
  // фиксируем видео к ближайшему из 2:1 (16:8), 16:9, 9:16 (для портретов)
  const CANDS = [2, 16/9, 9/16];
  if (!(rawAr > 0)) return 16/9;
  let best = CANDS[0], d = Math.abs(rawAr - CANDS[0]);
  for (let i=1;i<CANDS.length;i++){
    const di = Math.abs(rawAr - CANDS[i]);
    if (di < d){ d = di; best = CANDS[i]; }
  }
  return best;
}

export function setTileAspectFromVideo(tile, videoEl){
  const w = videoEl.videoWidth | 0;
  const h = videoEl.videoHeight | 0;
  if (!w || !h) return;

  const ar = w/h;
  tile.classList.toggle('portrait', h > w);
  tile.dataset.ar = ar.toFixed(6);
  tile.dataset.vid = tile.dataset.vid || '1';   // пометка «есть видео»

  if (isMobileHybrid()){
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
   ГИБРИДНАЯ JUSTIFIED-РАСКЛАДКА ДЛЯ МОБИЛЬНОГО РЕЖИМА
   — тайлы С видео: фиксированный AR (снап к 2:1, 16:9, 9:16)
   — тайлы БЕЗ видео: у всех один AR на раскладку (из [1:1, 16:9, 9:16])
   — укладка по строкам с одинаковой высотой, идеальное заполнение по ширине
   — вычисления ведём относительно контейнера #tiles
   ========================================================================= */

function hasWorkingVideo(tile){
  return !!tile.dataset.vid && !!tile.querySelector('video');
}

function getVideoAR(tile){
  const d = parseFloat(tile.dataset.ar);
  if (d && isFinite(d) && d > 0) return d;
  const v = tile.querySelector('video');
  const w = v?.videoWidth|0, h = v?.videoHeight|0;
  return (w>0 && h>0) ? (w/h) : NaN;
}

// для поля #tiles
function getAvailableFieldSize(){
  const host = tilesHost() || tilesMain() || document.body;
  const cs = getComputedStyle(host);
  const padH = (parseFloat(cs.paddingLeft)||0) + (parseFloat(cs.paddingRight)||0);
  const padV = (parseFloat(cs.paddingTop)||0)  + (parseFloat(cs.paddingBottom)||0);

  const W = Math.max(0, (host.clientWidth || host.getBoundingClientRect().width) - padH);
  const H = Math.max(0, (host.clientHeight|| host.getBoundingClientRect().height) - padV);
  return { W, H };
}

function pickPlaceholderAR(tiles){
  // выбираем из [1:1, 16:9, 9:16] то, что даст лучший fill
  const CANDS = [1, 16/9, 9/16];
  const { W, H } = getAvailableFieldSize();
  const gap = parseFloat(getComputedStyle(tilesMain()).getPropertyValue('--tile-gap')) || 10;

  let best = CANDS[0], bestScore = -Infinity;

  for (const ar of CANDS){
    // грубая оценка: попробуем 1 или 2 строки, какая заполнит лучше
    for (let rows=1; rows<=2; rows++){
      const cols = Math.max(1, Math.floor((W + gap) / ((H/rows)*ar + gap)));
      const cw = (W - gap*(cols-1)) / cols;
      const ch = cw / ar;
      const filledH = ch*rows + gap*(rows-1);
      const util = Math.min(1, (filledH/H));
      const score = util - Math.abs(filledH - H)*0.0001; // лёгкая нелюбовь к недозаполнению/переполнению
      if (score > bestScore){ bestScore = score; best = ar; }
    }
  }
  return best;
}

let layoutRAF = 0;
function requestLayout(){
  if (!isMobileHybrid()) return;
  if (layoutRAF) return;
  layoutRAF = requestAnimationFrame(()=>{ layoutRAF = 0; layoutHybridRows(); });
}

function layoutHybridRows(){
  const m = tilesMain();
  if (!m) return;

  const tiles = Array.from(m.querySelectorAll('.tile'));
  const N = tiles.length;
  if (!N){ clearLayout(); return; }

  const hostSize = getAvailableFieldSize();
  const W = hostSize.W, H = hostSize.H;
  if (W < 10 || H < 10){ requestLayout(); return; }

  // соберём элементы с AR
  const videoItems = [];
  const phItems    = [];
  tiles.forEach(t=>{
    if (hasWorkingVideo(t)){
      const raw = getVideoAR(t);
      const ar = snapVideoAR(raw);
      videoItems.push({ el:t, ar });
    } else {
      phItems.push({ el:t, ar: NaN }); // заполним позже
    }
  });

  // единый AR для плейсхолдеров
  const phAR = pickPlaceholderAR(tiles);
  phItems.forEach(i=> i.ar = phAR);

  const items = videoItems.concat(phItems); // исходный порядок важен (справедливый)

  // justified по строкам
  const gap = parseFloat(getComputedStyle(m).getPropertyValue('--tile-gap')) || 10;
  const totalAR = items.reduce((s,x)=>s+x.ar, 0);

  let best = null;

  function measure(rowsCount){
    const target = totalAR / rowsCount;
    const rows = [];
    let row = [], sum = 0;

    for (let i=0;i<items.length;i++){
      const it = items[i];
      if (row.length===0){ row.push(it); sum = it.ar; continue; }
      const remain    = items.length - i;
      const rowsLeft  = rowsCount - rows.length;
      const mustKeep  = remain <= (rowsLeft-1);
      const closer    = Math.abs(sum + it.ar - target) <= Math.abs(sum - target);

      if (!mustKeep && closer){ row.push(it); sum += it.ar; }
      else { rows.push(row); row = [it]; sum = it.ar; }
    }
    if (row.length) rows.push(row);

    const heights = rows.map(r=>{
      const sumAR = r.reduce((s,x)=>s+x.ar,0);
      const n = r.length;
      const wAvail = W - gap*(n-1);
      const h = wAvail / sumAR;
      return Math.max(40, h);
    });

    const totalH = heights.reduce((s,h)=>s+h,0) + gap*(rows.length-1);
    return { rows, heights, totalH };
  }

  for (let r = 1; r <= Math.min(N, 6); r++){ // до 6 строк на мобиле — более чем
    const cand = measure(r);
    const fits = cand.totalH <= H;
    const score = fits ? (H - cand.totalH) : (cand.totalH - H + 10000);
    if (!best || score < best.score) best = { ...cand, rowsCount:r, score };
  }

  if (!best){ clearLayout(); return; }

  // Применяем
  m.style.position = 'relative';
  m.style.width = '100%';
  const px = (v)=> Math.round(v) + 'px';

  let y = 0;
  best.rows.forEach((row, ri)=>{
    const h = best.heights[ri];
    let x = 0;
    row.forEach((it)=>{
      const w = it.ar * h;
      const el = it.el;

      el.style.boxSizing = 'border-box';
      el.style.position  = 'absolute';
      el.style.left = px(x);
      el.style.top  = px(y);

      // ⬇️ перебиваем .tile.me { width:100%!important }
      el.style.setProperty('width',  px(w), 'important');
      el.style.setProperty('height', px(h), 'important');

      el.style.aspectRatio = ''; // фиксируемся на width/height
      x += w + gap;
    });
    y += h + gap;
  });

  m.style.height = px(y - gap);
  tiles.forEach(t=> t.classList.remove('spotlight','thumb'));
}

function clearLayout(){
  const m = tilesMain(); if (!m) return;
  m.style.position = '';
  m.style.width    = '';
  m.style.height   = '';
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
window.addEventListener('resize', ()=>{ if (isMobileHybrid()) requestLayout(); }, { passive:true });
window.addEventListener('orientationchange', ()=>{ setTimeout(()=>{ if (isMobileHybrid()) requestLayout(); }, 60); }, { passive:true });

/* ResizeObserver — следим и за .tiles-main, и за #tiles */
let roMain = null;
let roHost = null;
function attachROs(){
  const m = tilesMain();
  const h = tilesHost();

  if (roMain){ roMain.disconnect(); roMain = null; }
  if (roHost){ roHost.disconnect(); roHost = null; }

  if (m){
    roMain = new ResizeObserver(()=>{ if (isMobileHybrid()) requestLayout(); });
    roMain.observe(m);
  }
  if (h){
    roHost = new ResizeObserver(()=>{ if (isMobileHybrid()) requestLayout(); });
    roHost.observe(h);
  }
}
attachROs();
document.addEventListener('DOMContentLoaded', attachROs);

/* Перестраиваем при изменениях DOM/атрибутов (горячее подключение и т.п.) */
const tilesMutObs = new MutationObserver((muts)=>{
  if (!isMobileHybrid()) return;
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
  if (isMobileHybrid()) layoutHybridRows(); else clearLayout();
}
