// ===== Mobile Portrait layout (smart AR grid + scrollbar + footer carousel) =====
import { ctx } from "../state.js";
import { byId, isMobileView } from "../utils.js";
import { createTileEl, tilesMain } from "../tiles.js";
import { usersCounterText } from "../registry.js";

/* ----------------------------- Утилиты ----------------------------------- */
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
const raf = (fn) => requestAnimationFrame(fn);
const on = (el, ev, fn, opts) => el && el.addEventListener(ev, fn, opts);
const qs = (sel, root=document) => root.querySelector(sel);
const qsa = (sel, root=document) => Array.from(root.querySelectorAll(sel));

/* ------------------------ Пользовательский счётчик ----------------------- */
export function updateUsersCounter(){
  const tag = byId('usersTag');
  if (tag) tag.textContent = usersCounterText();
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
  const track  = getSbarTrack();
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

  // Mouse/fallback
  thumb.addEventListener('mousedown', (e)=>{ e.preventDefault(); startSbarDrag(e.clientX); });
  document.addEventListener('mousemove', (e)=>{ if(sbarDrag) moveSbarDrag(e.clientX); });
  document.addEventListener('mouseup', endSbarDrag);

  // Touch/fallback
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

/* ========== SMART ASPECT GRID (16:9 / 9:16, максимальная площадь) ========= */
function pickARForSingle(tile, stageAR){
  if (tile?.classList?.contains?.('portrait')) return 9/16;
  return stageAR >= 1 ? 16/9 : 9/16;
}
function bestGridForAR(N, W, H, gap, AR){
  let best = null;
  for (let cols = 1; cols <= N; cols++){
    const rows   = Math.ceil(N / cols);
    const wAvail = W - gap * (cols - 1);
    const hAvail = H - gap * (rows - 1);
    if (wAvail <= 0 || hAvail <= 0) continue;

    const cwFill     = wAvail / cols;
    const chFill     = cwFill / AR;
    const totalHFill = rows * chFill + gap * (rows - 1);

    if (totalHFill <= H + 0.5){
      const area = cwFill * chFill;
      if (!best || area > best.area)
        best = { mode:'fillWidth', cols, rows, cw:cwFill, ch:chFill, AR, area };
    } else {
      const chFit     = hAvail / rows;
      const cwFit     = chFit * AR;
      const totalWFit = cols * cwFit + gap * (cols - 1);
      if (cwFit > 0 && totalWFit <= W + 0.5){
        const area = cwFit * chFit;
        if (!best || area > best.area)
          best = { mode:'fitHeight', cols, rows, cw:cwFit, ch:chFit, AR, area };
      }
    }
  }
  return best;
}
function layoutMobileTiles(){
  const m = tilesMain(); if (!m) return;
  const tiles = m.querySelectorAll('.tile'); const N = tiles.length;
  if (!N) return;

  const box = m.getBoundingClientRect();
  const W = Math.max(0, box.width);
  const H = Math.max(0, box.height);
  if (W < 10 || H < 10){ requestAnimationFrame(layoutMobileTiles); return; }

  const gap = parseFloat(getComputedStyle(m).getPropertyValue('--tile-gap')) || 10;
  const stageAR = W / H;

  let ARs;
  if (N === 1) {
    ARs = [ pickARForSingle(tiles[0], stageAR) ];
  } else {
    const portraits = [...tiles].filter(t => t.classList.contains('portrait')).length;
    ARs = portraits > N/2 ? [9/16, 16/9] : [16/9, 9/16];
  }

  let best = null;
  for (const AR of ARs){
    const cand = bestGridForAR(N, W, H, gap, AR);
    if (cand && (!best || cand.area > best.area)) best = cand;
  }
  if (!best) return;

  m.style.display = 'grid';
  m.style.gap = `${gap}px`;
  m.style.gridAutoFlow = 'row';
  m.style.alignContent = 'center';
  m.style.justifyContent = 'center';

  if (best.mode === 'fillWidth'){
    m.style.gridTemplateColumns = `repeat(${best.cols}, 1fr)`;
  } else {
    m.style.gridTemplateColumns = `repeat(${best.cols}, ${Math.floor(best.cw)}px)`;
  }

  const arCSS = best.AR > 1 ? '16 / 9' : '9 / 16';
  tiles.forEach(t => {
    t.style.width = '100%';
    t.style.height = 'auto';
    t.style.aspectRatio = arCSS;
  });

  // горизонтального скролла не будет
  getSbar()?.classList.remove('show');
}

/* ===== Авто-детект портретности видео и перерисовка ===== */
function updateTileOrientationFromVideo(video){
  const tile = video.closest?.('.tile');
  if (!tile) return;
  const vw = video.videoWidth | 0;
  const vh = video.videoHeight | 0;
  if (!vw || !vh) return;

  const isPortrait = vh > vw;
  const wasPortrait = tile.classList.contains('portrait');
  if (isPortrait !== wasPortrait){
    tile.classList.toggle('portrait', isPortrait);
    if (isMobileView() && !ctx.isStageFull) layoutMobileTiles();
  }
}
function attachVideoARWatcher(video){
  if (!video || video.__arWatchAttached) return;
  const handler = () => updateTileOrientationFromVideo(video);

  video.addEventListener('loadedmetadata', handler);
  video.addEventListener('loadeddata', handler);
  video.addEventListener('resize', handler);

  if (typeof queueMicrotask === 'function') queueMicrotask(handler);
  else setTimeout(handler, 0);

  video.__arWatchAttached = true;
}
function observeAllTileVideos(){
  document.querySelectorAll('.tile video').forEach(attachVideoARWatcher);
}
let videoMutationObs = null;
function installVideoARObservers(){
  const root = tilesMain() || document;
  if (videoMutationObs) videoMutationObs.disconnect();
  videoMutationObs = new MutationObserver(muts => {
    for (const m of muts){
      m.addedNodes && m.addedNodes.forEach(node=>{
        if (node.nodeType !== 1) return;
        if (node.matches?.('video')) attachVideoARWatcher(node);
        node.querySelectorAll?.('video').forEach(attachVideoARWatcher);
      });
    }
  });
  videoMutationObs.observe(root, { childList:true, subtree:true });
  observeAllTileVideos();
}

/* ======================== ФУТЕР-КАРУСЕЛЬ (портрет) ======================= */
let sidebarMounted = false;
let sidebarPlaceholder = null;

let footSwipeInitialized = false;
let activePaneIdx = 1;
let suppressDetect = false;
let fsResizeObs = null;
let fsScrollHandler = null;

const STORAGE_KEY = 'footPaneIdx_v1';

const getFootSwipe = () => qs('.foot-swipe');
const getFootPanes = () => { const fs = getFootSwipe(); return fs ? qsa('.foot-pane', fs) : []; };
const getSidebarPane = () => getFootSwipe()?.querySelector('.foot-pane.sidebar-pane') || null;
const getNonSidebarPanes = () => getFootPanes().filter(p => p !== getSidebarPane());
const getDotsWrap  = () => qs('.foot-dots');
const getDots      = () => qsa('.foot-dots .fdot');
const markDots = (idx)=> getDots().forEach((d,i)=> d.classList.toggle('active', i===idx));

function getSettingsPane(){
  const list = getNonSidebarPanes();
  const byClass = list.find(p => p.querySelector('.me-card') || p.dataset.role === 'settings');
  return byClass || list[0] || null;
}
function getChatPane(){
  const list = getNonSidebarPanes();
  const byClass = list.find(p => p.querySelector('.chatbox') || p.dataset.role === 'chat');
  return byClass || list[1] || null;
}
const getPaneIndex = (p) => { const panes = getFootPanes(); return p ? panes.indexOf(p) : -1; };

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
function detachFsScrollWatcher(){
  const fs = getFootSwipe();
  if (!fs || !fs.__watching) return;
  fs.__watching = false;
  if (fsScrollHandler) fs.removeEventListener('scroll', fsScrollHandler);
  fsScrollHandler = null;
}
function withPreservedFsScroll(fn, preserve = true){
  const fs = getFootSwipe();
  if (!fs){ fn(); return; }
  const left = preserve ? fs.scrollLeft : null;
  suppressDetect = true;
  fn();
  if (preserve && left != null){
    requestAnimationFrame(()=> { fs.scrollLeft = left; suppressDetect = false; });
  } else {
    suppressDetect = false;
  }
}
function mountSidebarIntoFootSwipe(){
  if (sidebarMounted) return;

  const sidebar   = qs('.sidebar');
  const footSwipe = getFootSwipe();
  if (!sidebar || !footSwipe) return;

  const list = sidebar.querySelector('.list') || sidebar.querySelector('#onlineList');
  if (!list) return;

  sidebarPlaceholder = document.createElement('div');
  sidebarPlaceholder.className = 'sidebar-placeholder';
  list.parentElement.insertBefore(sidebarPlaceholder, list);

  const pane = document.createElement('div');
  pane.className = 'foot-pane sidebar-pane';

  const title = document.createElement('h3');
  title.textContent = 'Подключены';
  title.style.cssText = 'display:none';

  const wrapper = document.createElement('div');
  wrapper.className = 'list';
  wrapper.appendChild(list);

  pane.appendChild(title);
  pane.appendChild(wrapper);

  withPreservedFsScroll(()=> {
    footSwipe.insertBefore(pane, footSwipe.firstChild);
  }, /*preserve*/ false);

  sidebarMounted = true;
  ensureFootSwipeOrder(false);

  if (!footSwipeInitialized){
    const saved = loadSavedPaneIdx();
    if (saved != null){
      activePaneIdx = saved;
    } else {
      const sIdx = getPaneIndex(getSettingsPane());
      activePaneIdx = sIdx >= 0 ? sIdx : 1;
    }
    attachFsScrollWatcher();
    alignToActivePane('instant');

    if (fsResizeObs) fsResizeObs.disconnect();
    fsResizeObs = new ResizeObserver(()=> alignToActivePane('instant'));
    fsResizeObs.observe(footSwipe);

    const dots = getDots();
    if (dots.length){
      dots.forEach((dot, i)=>{
        on(dot, 'click', ()=> scrollFootSwipeToPane(i, 'smooth'));
        on(dot, 'keydown', (e)=>{ if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); scrollFootSwipeToPane(i, 'smooth'); }});
      });
      markDots(activePaneIdx);
    }

    footSwipeInitialized = true;
  } else {
    alignToActivePane('instant');
    markDots(activePaneIdx);
  }
}
function unmountSidebarFromFootSwipe(){
  if (!sidebarMounted) return;

  const pane = qs('.foot-pane.sidebar-pane');
  const list = pane?.querySelector('.list > .list, .list > #onlineList') || pane?.querySelector('.list');
  if (list && sidebarPlaceholder && sidebarPlaceholder.parentElement) {
    sidebarPlaceholder.parentElement.replaceChild(list, sidebarPlaceholder);
  }
  pane?.remove();

  sidebarMounted = false;
  sidebarPlaceholder = null;

  detachFsScrollWatcher();
  if (fsResizeObs){ fsResizeObs.disconnect(); fsResizeObs = null; }

  footSwipeInitialized = false;
}
function ensureFootSwipeOrder(preserve = true){
  const fs = getFootSwipe();
  if (!fs) return;

  const sidebarPane  = getSidebarPane();
  const settingsPane = getSettingsPane();
  const chatPane     = getChatPane();

  withPreservedFsScroll(()=> {
    if (sidebarPane)  fs.insertBefore(sidebarPane, fs.firstChild); // слева
    if (settingsPane) fs.appendChild(settingsPane);                // середина
    if (chatPane)     fs.appendChild(chatPane);                    // справа
  }, preserve);
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
    t.style.width=''; t.style.height='';
    if (t.parentElement !== main) main.appendChild(t);
  });

  // Умная мобильная сетка (строгий AR + max площадь)
  if (isMobileView() && !ctx.isStageFull) layoutMobileTiles();

  // Скроллбар настроим
  updateMobileScrollbar(true);

  // Удержим активную панель карусели
  alignToActivePane('instant');

  updateUsersCounter();
}

/* ================================ INIT =================================== */
export function initLayout(){
  updateUsersCounter();

  // Сразу переносим «Подключены» и настраиваем порядок панелей
  mountSidebarIntoFootSwipe();
  ensureFootSwipeOrder(true);
  alignToActivePane('instant');

  // Наблюдение за видео-AR
  installVideoARObservers();

  // Скроллбар: события
  attachSbarEvents();
  const tm = tilesMain();
  if (tm){
    on(tm, 'scroll', ()=> updateMobileScrollbar(false), {passive:true});
    const ro = new ResizeObserver(()=> queueSbarUpdate());
    ro.observe(tm);
  }

  // Пересчёты на ресайз/ориентацию
  on(window, 'resize', ()=>{
    if (isMobileView() && !ctx.isStageFull) layoutMobileTiles();
    updateMobileScrollbar(false);
    alignToActivePane('instant');
  }, { passive:true });
  on(window, 'orientationchange', ()=>{
    setTimeout(()=>{
      if (isMobileView() && !ctx.isStageFull) layoutMobileTiles();
      updateMobileScrollbar(false);
      alignToActivePane('instant');
    }, 60);
  }, { passive:true });

  // Первый прогон верстки
  applyLayout();
}
