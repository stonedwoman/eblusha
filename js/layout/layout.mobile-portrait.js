// ===== Mobile Portrait layout (mosaic from tiles.js + scrollbar + footer carousel) =====
import { ctx } from "../state.js";
import { byId, isMobileView } from "../utils.js";
import { createTileEl, tilesMain, relayoutTilesIfMobile } from "../tiles.js";
import { usersCounterText } from "../registry.js";

/* ----------------------------- Утилиты ----------------------------------- */
const on  = (el, ev, fn, opts) => el && el.addEventListener(ev, fn, opts);
const qs  = (sel, root=document) => root.querySelector(sel);
const qsa = (sel, root=document) => Array.from(root.querySelectorAll(sel));

/* ------------------------ Пользовательский счётчик ----------------------- */
export function updateUsersCounter(){
  const tag = byId('usersTag');
  if (tag) tag.textContent = usersCounterText();
}
/* ------------------------- Подсветка говорящих --------------------------- */
export function highlightSpeaking(ids){
  const set = new Set(ids);
  document.querySelectorAll('.tile').forEach(t=>t.classList.remove('speaking'));
  set.forEach(id=>{
    document.querySelector(`.tile[data-pid="${CSS.escape(id)}"]`)?.classList.add('speaking');
  });
}

/* ------------------------- Спотлайт (заглушка для мобилки) ---------------- */
export function fitSpotlightSize(){
  // В мобильном портрете спотлайт не используется
  // Просто пересчитываем мозаику
  relayoutTilesIfMobile();
}

/* ===================== МОБИЛЬНЫЙ СКРОЛЛБАР ДЛЯ ПЛИТОК ==================== */
const getSbar      = ()=> qs('.tiles-sbar');
const getSbarTrack = ()=> qs('.tiles-sbar .track');
const getSbarThumb = ()=> qs('.tiles-sbar .thumb');

let sbarDrag = null;
let sbarUpdateTimer = null;

export function queueSbarUpdate(){
  clearTimeout(sbarUpdateTimer);
  sbarUpdateTimer = setTimeout(()=> updateMobileScrollbar(false), 50);
}

export function updateMobileScrollbar(forceShow){
  if (!isMobileView() || ctx.isStageFull) {
    getSbar()?.classList.remove('show');
    return;
  }
  const m = tilesMain(); const sbar = getSbar(); if(!m || !sbar) return;

  const scrollW = m.scrollWidth, viewW = m.clientWidth;
  const need = scrollW > viewW + 2;

  sbar.setAttribute('aria-hidden', need ? 'false' : 'true');
  sbar.classList.toggle('show', need);
  if(!need) return;

  const track = getSbarTrack(); const thumb = getSbarThumb();
  if (!track || !thumb) return;

  const trackW  = track.clientWidth || 0;
  const minTh   = 28;
  const thumbW  = Math.max(minTh, Math.round((viewW/scrollW) * trackW));
  const maxLeft = Math.max(0, trackW - thumbW);
  const left    = maxLeft ? Math.round((m.scrollLeft / (scrollW - viewW)) * maxLeft) : 0;

  thumb.style.width     = thumbW + 'px';
  thumb.style.transform = `translateX(${left}px)`;
  if(forceShow){
    thumb.animate(
      [{transform:`translateX(${left}px) scaleY(1.0)`},
       {transform:`translateX(${left}px) scaleY(1.25)`},
       {transform:`translateX(${left}px) scaleY(1.0)`}],
      {duration:600, easing:'ease-out'}
    );
  }
}

function sbarSetScrollByThumbX(px){
  const m = tilesMain(); const track = getSbarTrack(); const thumb = getSbarThumb();
  if(!m || !track || !thumb) return;
  const trackW  = track.clientWidth;
  const thumbW  = thumb.clientWidth;
  const maxLeft = Math.max(0, trackW - thumbW);
  const clampX  = Math.max(0, Math.min(maxLeft, px));
  const ratio   = maxLeft ? (clampX / maxLeft) : 0;
  const maxScr  = m.scrollWidth - m.clientWidth;
  m.scrollLeft = ratio * maxScr;
  updateMobileScrollbar(false);
}

function startSbarDrag(clientX){
  const track = getSbarTrack(); const thumb = getSbarThumb(); const sbar = getSbar();
  if(!sbar || !track || !thumb) return;
  sbar.classList.add('dragging');
  const rect = track.getBoundingClientRect();
  const th   = thumb.getBoundingClientRect();
  sbarDrag = { startX: clientX, startLeft: th.left - rect.left };
}

function moveSbarDrag(clientX){
  if(!sbarDrag) return;
  const delta = clientX - sbarDrag.startX;
  sbarSetScrollByThumbX(sbarDrag.startLeft + delta);
}

function endSbarDrag(){ getSbar()?.classList.remove('dragging'); sbarDrag=null; }

function attachSbarEvents(){
  const sbar  = getSbar(), track = getSbarTrack(), thumb = getSbarThumb();
  if (!(sbar && track && thumb) || sbar.__sbarBound) return;
  sbar.__sbarBound = true;

  // Pointer
  thumb.addEventListener('pointerdown', (e)=>{ e.preventDefault(); thumb.setPointerCapture?.(e.pointerId); startSbarDrag(e.clientX); });
  document.addEventListener('pointermove', (e)=>{ if(sbarDrag) moveSbarDrag(e.clientX); }, {passive:true});
  document.addEventListener('pointerup', endSbarDrag);

  // Mouse
  thumb.addEventListener('mousedown', (e)=>{ e.preventDefault(); startSbarDrag(e.clientX); });
  document.addEventListener('mousemove', (e)=>{ if(sbarDrag) moveSbarDrag(e.clientX); });
  document.addEventListener('mouseup', endSbarDrag);

  // Touch
  thumb.addEventListener('touchstart', (e)=>{ startSbarDrag(e.touches[0].clientX); }, {passive:true});
  document.addEventListener('touchmove',  (e)=>{ if(sbarDrag) moveSbarDrag(e.touches[0].clientX); }, {passive:true});
  document.addEventListener('touchend', endSbarDrag);

  // Click-to-jump
  track.addEventListener('mousedown', (e)=>{
    if(e.target===thumb) return;
    const rect = track.getBoundingClientRect();
    sbarSetScrollByThumbX(e.clientX - rect.left - thumb.clientWidth/2);
  });
  track.addEventListener('touchstart', (e)=>{
    if(e.target===thumb) return;
    const rect = track.getBoundingClientRect();
    sbarSetScrollByThumbX(e.touches[0].clientX - rect.left - thumb.clientWidth/2);
  }, {passive:true});
}

/* ======================== ФУТЕР-КАРУСЕЛЬ (портрет) ======================= */
let footSwipeInitialized = false;
let activePaneIdx = 1;
let suppressDetect = false;
let fsResizeObs = null;
let fsScrollHandler = null;

const STORAGE_KEY = 'footPaneIdx_v1';

const getFootSwipe = () => qs('.foot-swipe');
const getFootPanes = () => { const fs = getFootSwipe(); return fs ? qsa('.foot-pane', fs) : []; };
const getDots      = () => qsa('.foot-dots .fdot');
const markDots = (idx)=> getDots().forEach((d,i)=> d.classList.toggle('active', i===idx));

function loadSavedPaneIdx(){
  try{
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw != null ? Math.max(0, Math.min(+raw, getFootPanes().length-1)) : null;
  }catch{ return null; }
}

function saveActivePaneIdx(){
  try{ sessionStorage.setItem(STORAGE_KEY, String(activePaneIdx)); }catch{}
}

export function scrollFootSwipeToPane(idx, behavior = 'instant'){
  activePaneIdx = Math.max(0, Math.min(idx, getFootPanes().length - 1));
  saveActivePaneIdx();
  alignToActivePane(behavior);
}

function alignToActivePane(behavior = 'instant'){
  const fs = getFootSwipe(); const panes = getFootPanes();
  if (!fs || !panes.length) return;

  const target = panes[Math.max(0, Math.min(activePaneIdx, panes.length - 1))];
  if (!target) return;

  const left = target.offsetLeft;
  suppressDetect = true;
  try{ fs.scrollTo({ left, behavior }); }catch{ fs.scrollLeft = left; }
  requestAnimationFrame(()=> { try{ fs.scrollTo({ left, behavior:'instant' }); }catch{ fs.scrollLeft = left; }});
  setTimeout(()=> { try{ fs.scrollTo({ left, behavior:'instant' }); }catch{ fs.scrollLeft = left; } suppressDetect = false; }, 80);

  markDots(activePaneIdx);
}

function detectActivePaneIdx(){
  const fs = getFootSwipe(); const panes = getFootPanes();
  if (!fs || !panes.length) return activePaneIdx;

  const center = fs.scrollLeft + fs.clientWidth / 2;

  const hit = panes.findIndex(p => {
    const L = p.offsetLeft, R = L + p.clientWidth;
    return center >= L && center <= R;
  });
  if (hit !== -1) return hit;

  let best = 0, bestDist = Infinity;
  panes.forEach((p, i) => {
    const L = p.offsetLeft, R = L + p.clientWidth;
    const d = center < L ? (L - center) : (center - R);
    if (d < bestDist || (d === bestDist && i > best)) { bestDist = d; best = i; }
  });
  return best;
}

function attachFsScrollWatcher(){
  const fs = getFootSwipe();
  if (!fs || fs.__watching) return;
  fs.__watching = true;

  let t = null;
  fsScrollHandler = () => {
    if (suppressDetect) return;
    if (t) return;
    t = setTimeout(()=>{
      activePaneIdx = detectActivePaneIdx();
      saveActivePaneIdx();
      markDots(activePaneIdx);
      t = null;
    }, 100);
  };
  fs.addEventListener('scroll', fsScrollHandler, { passive:true });
}

/* ================================ APPLY ================================== */
export function applyLayout(){
  const tiles = byId('tiles'), main = tilesMain();

  // Восстановление DOM-плиток из реестра
  ctx.registry.forEach((rec)=>{
    if(!document.body.contains(rec.tile)){
      rec.tile = createTileEl(rec.participant.identity, rec.name, rec.isLocal);
    }
  });

  // Если нет ни одной плитки — вставим локальную
  if (!document.querySelector('.tile') && ctx.room?.localParticipant){
    const me  = ctx.room.localParticipant;
    const rec = ctx.registry.get(me.identity);
    if (rec && !rec.tile){
      rec.tile = createTileEl(me.identity, rec.name || me.identity, true);
      main && main.appendChild(rec.tile);
    }
  }

  tiles.classList.remove('spotlight','single');
  document.querySelectorAll('.tile').forEach(t=>{
    t.classList.remove('spotlight','thumb');
    t.style.width=''; t.style.height=''; t.style.aspectRatio='';
    if (t.parentElement !== main) main.appendChild(t);
  });

  // Мозаичная раскладка из tiles.js
  relayoutTilesIfMobile();

  // Скроллбар (в мозаике обычно скрыт)
  updateMobileScrollbar(true);

  updateUsersCounter();
}

/* ================================ INIT =================================== */
export function initLayout(){
  updateUsersCounter();

  // События скроллбара
  attachSbarEvents();
  const tm = tilesMain();
  if (tm){
    on(tm, 'scroll', ()=> updateMobileScrollbar(false), {passive:true});
    const ro = new ResizeObserver(()=> queueSbarUpdate());
    ro.observe(tm);
  }

  // Слушаем события из tiles.js (без циклов)
  window.addEventListener('layout:sbar-update', ()=> updateMobileScrollbar(false));

  // Пересчёты на ресайз/ориентацию
  on(window, 'resize', ()=>{
    relayoutTilesIfMobile();
    updateMobileScrollbar(false);
  }, { passive:true });

  on(window, 'orientationchange', ()=>{
    setTimeout(()=>{
      relayoutTilesIfMobile();
      updateMobileScrollbar(false);
    }, 60);
  }, { passive:true });

  // Инициализация футер-карусели
  if (!footSwipeInitialized) {
    const saved = loadSavedPaneIdx();
    if (saved != null) {
      activePaneIdx = saved;
    }
    
    attachFsScrollWatcher();
    alignToActivePane('instant');

    if (fsResizeObs) fsResizeObs.disconnect();
    const fs = getFootSwipe();
    if (fs) {
      fsResizeObs = new ResizeObserver(()=> alignToActivePane('instant'));
      fsResizeObs.observe(fs);
    }

    const dots = getDots();
    if (dots.length){
      dots.forEach((dot, i)=>{
        on(dot, 'click',   ()=> scrollFootSwipeToPane(i, 'smooth'));
        on(dot, 'keydown', (e)=>{ if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); scrollFootSwipeToPane(i, 'smooth'); }});
      });
      markDots(activePaneIdx);
    }

    footSwipeInitialized = true;
  }

  // Первый прогон
  applyLayout();
}