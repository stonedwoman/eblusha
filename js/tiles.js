// tiles.js — равномерная сетка (uniform grid) c единой ячейкой для обычных,
// но видео-тайлы растягиваются по своему AR на кратное число колонок.
import { ctx, state } from "./state.js";
import { byId, hashColor, isMobileView } from "./utils.js";
// ⬇️ важное отличие: больше НЕТ именованного импорта
import * as layout from "./layout.js";

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
  byId('onlineList').appendChild(row);
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
    // безопасный (необязательный) вызов из layout.js
    layout?.fitSpotlightSize?.();
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
  if (t.classList.contains('spotlight')) layout?.fitSpotlightSize?.();
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

<<<<<<< HEAD
  const cellAR = pickCellAR(tiles);

  // подберём число колонок (1..N)
=======
  // AR ячейки берём по «большинству» тайлов; 1:1 — как запасной
  const ars = tiles.map(getTileAR);
  const portraits = ars.filter(a=>a<1).length;
  const cellAR = portraits > N/2 ? 9/16 : 16/9;

  // ищем число колонок, чтобы занять максимум пространства
>>>>>>> parent of 667728d (0.87)
  let best = null;

  function packAndMeasure(cols){
    const cw = (W - gap*(cols-1)) / cols;
    if (cw <= 0) return null;
    const ch = cw / cellAR;

<<<<<<< HEAD
    // превратим список тайлов в юниты
    const items = tiles.map(el=>{
      if (hasVideo(el)){
        let ar = getVideoAR(el);
        if (!(ar>0 && isFinite(ar))) ar = cellAR;
        let span = Math.max(1, Math.round(ar / cellAR));
        span = Math.min(span, cols);
        return { el, type:'vid', span, ar };
      } else {
        return { el, type:'ph', span:1, ar:cellAR };
      }
    });

    // грид по строкам
    const rows = [];
    let row = [], used = 0;
    for (const it of items){
      if (used + it.span > cols){
        if (row.length) rows.push(row);
        row = [it]; used = it.span;
      } else {
        row.push(it); used += it.span;
      }
=======
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
>>>>>>> parent of 667728d (0.87)
    }
    if (row.length) rows.push(row);

<<<<<<< HEAD
    const totalH = rows.length * ch + gap*(rows.length-1);

    // метрика: 1) не превышать высоту, 2) ближе к H, 3) меньше «пустых» ячеек
    const fits = totalH <= H;
    let blanks = 0;
    for (const r of rows){
      const sum = r.reduce((s,x)=>s+x.span,0);
      blanks += Math.max(0, cols - sum);
    }
    const score = (fits?0:10000) + Math.abs(H-totalH) + blanks*5;

    return { cols, cw, ch, rows, totalH, blanks, score };
=======
    const filledW = cw * cols + gap * (cols - 1);
    const filledH = ch * rows + gap * (rows - 1);
    const util = (filledW / W) * (filledH / H);
    const area = cw * ch;
    return { cols, rows, cw, ch, util, area };
>>>>>>> parent of 667728d (0.87)
  }

  for (let cols=1; cols<=N; cols++){
    const cand = packAndMeasure(cols);
    if (!cand) continue;
    if (!best || cand.score < best.score) best = cand;
  }
  if (!best){ clearGrid(); return; }

<<<<<<< HEAD
  // раскладываем
=======
  // Раскладываем абсолютно по одинаковым боксам
>>>>>>> parent of 667728d (0.87)
  m.style.position = 'relative';
  m.classList.add('grid-active');

  const px = (v)=> Math.round(v) + 'px';
<<<<<<< HEAD
  const { cw, ch, rows } = best;

  let y = 0;
  for (const r of rows){
    let x = 0;
    for (const it of r){
      const el = it.el;
      const w = it.span * cw + gap * (it.span - 1);

      el.style.boxSizing = 'border-box';
      el.style.position = 'absolute';
      el.style.left = px(x);
      el.style.top  = px(y);

      // перебиваем возможные !important
      el.style.setProperty('width',  px(w), 'important');
      el.style.setProperty('height', px(ch), 'important');

      el.style.aspectRatio = ''; // держим размер по width/height
      x += w + gap;
    }
    y += ch + gap;
  }

  m.style.height = px(y - gap);
=======
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
>>>>>>> parent of 667728d (0.87)
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
