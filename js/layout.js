// layout.js
import { ctx } from "./state.js";
import { byId, isMobileView } from "./utils.js";
import { createTileEl, tilesMain, tilesRail } from "./tiles.js";
import { usersCounterText } from "./registry.js";

/* ========================================================================== */
/* === ЛЭЙАУТ / МОБ. СКРОЛЛБАР / СПОТЛАЙТ / ФУТЕР-КАРУСЕЛЬ ================== */
/* ========================================================================== */

/* ----------------------------- Утилиты ----------------------------------- */
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
const raf = (fn) => requestAnimationFrame(fn);
const on = (el, ev, fn, opts) => el && el.addEventListener(ev, fn, opts);
const qs = (sel, root=document) => root.querySelector(sel);
const qsa = (sel, root=document) => Array.from(root.querySelectorAll(sel));

/* ориентации и режимы */
const mqLand = window.matchMedia('(max-width: 950px) and (hover: none) and (pointer: coarse) and (orientation: landscape)');
const mqPort = window.matchMedia('(max-width: 640px) and (hover: none) and (pointer: coarse) and (orientation: portrait)');
const isLandscapeMobileNow = () => mqLand?.matches;
const isPortraitMobileNow  = () => mqPort?.matches;
/* общий режим карусели (ландшафт мобильный ИЛИ портрет мобильный) */
const isCarouselModeNow    = () => isLandscapeMobileNow() || isPortraitMobileNow();

/* ------------------------ Пользовательский счётчик ----------------------- */
export function updateUsersCounter(){
  const tag = byId('usersTag');
  if (tag) tag.textContent = usersCounterText();
}

/* ===================== МОБИЛЬНЫЙ СКРОЛЛБАР ДЛЯ ПЛИТОК ==================== */
/* селекторы переведены на классы под твой CSS (.tiles-sbar .track .thumb)   */
const sbar      = qs('.tiles-sbar');
const sbarTrack = qs('.tiles-sbar .track');
const sbarThumb = qs('.tiles-sbar .thumb');

let sbarDrag = null;
let sbarUpdateTimer = null;

export function queueSbarUpdate(){
  clearTimeout(sbarUpdateTimer);
  sbarUpdateTimer = setTimeout(()=> updateMobileScrollbar(false), 50);
}

export function updateMobileScrollbar(forceShow){
  // горизонтального скролла плиток нет, когда не мобайл, в ландшафте сетка, или fullscreen stage
  if(!isMobileView() || isLandscapeMobileNow() || ctx.isStageFull) {
    sbar?.classList.remove('show');
    return;
  }
  const m = tilesMain(); if(!m || !sbar) return;

  const scrollW = m.scrollWidth, viewW = m.clientWidth;
  const need = scrollW > viewW + 2;

  sbar.setAttribute('aria-hidden', need ? 'false' : 'true');
  sbar.classList.toggle('show', need);
  if(!need) return;

  const trackW  = sbarTrack?.clientWidth || 0;
  const minTh   = 28;
  const thumbW  = Math.max(minTh, Math.round((viewW/scrollW) * trackW));
  const maxLeft = Math.max(0, trackW - thumbW);
  const left    = maxLeft ? Math.round((m.scrollLeft / (scrollW - viewW)) * maxLeft) : 0;

  if (sbarThumb){
    sbarThumb.style.width     = thumbW + 'px';
    sbarThumb.style.transform = `translateX(${left}px)`;
    if(forceShow){
      sbarThumb.animate(
        [{transform:`translateX(${left}px) scaleY(1.0)`},
         {transform:`translateX(${left}px) scaleY(1.25)`},
         {transform:`translateX(${left}px) scaleY(1.0)`}],
        {duration:600, easing:'ease-out'}
      );
    }
  }
}

/* безопасная подписка на скролл tiles-main (если элемент уже есть) */
const _m = tilesMain();
_m && _m.addEventListener('scroll', ()=> updateMobileScrollbar(false), {passive:true});
window.addEventListener('resize',  ()=> updateMobileScrollbar(false));

function sbarSetScrollByThumbX(px){
  const m = tilesMain(); if(!m || !sbarTrack || !sbarThumb) return;
  const trackW  = sbarTrack.clientWidth;
  const thumbW  = sbarThumb.clientWidth;
  const maxLeft = Math.max(0, trackW - thumbW);
  const clampX  = Math.max(0, Math.min(maxLeft, px));
  const ratio   = maxLeft ? (clampX / maxLeft) : 0;
  const maxScr  = m.scrollWidth - m.clientWidth;
  m.scrollLeft = ratio * maxScr;
  updateMobileScrollbar(false);
}

function startSbarDrag(clientX){
  if(!sbar || !sbarTrack || !sbarThumb) return;
  sbar.classList.add('dragging');
  const rect = sbarTrack.getBoundingClientRect();
  const th   = sbarThumb.getBoundingClientRect();
  sbarDrag = { startX: clientX, startLeft: th.left - rect.left };
}
function moveSbarDrag(clientX){
  if(!sbarDrag) return;
  const rect  = sbarTrack.getBoundingClientRect();
  const delta = clientX - sbarDrag.startX;
  sbarSetScrollByThumbX(sbarDrag.startLeft + delta);
}
function endSbarDrag(){ sbar && sbar.classList.remove('dragging'); sbarDrag=null; }

/* навешиваем обработчики только если элементы есть */
if (sbarThumb && sbarTrack && sbar){
  // Pointer
  sbarThumb.addEventListener('pointerdown', (e)=>{ e.preventDefault(); sbarThumb.setPointerCapture?.(e.pointerId); startSbarDrag(e.clientX); });
  document.addEventListener('pointermove', (e)=>{ if(sbarDrag) moveSbarDrag(e.clientX); }, {passive:true});
  document.addEventListener('pointerup', endSbarDrag);

  // Mouse/fallback
  sbarThumb.addEventListener('mousedown', (e)=>{ e.preventDefault(); startSbarDrag(e.clientX); });
  document.addEventListener('mousemove', (e)=>{ if(sbarDrag) moveSbarDrag(e.clientX); });
  document.addEventListener('mouseup', endSbarDrag);

  // Touch/fallback
  sbarThumb.addEventListener('touchstart', (e)=>{ startSbarDrag(e.touches[0].clientX); }, {passive:true});
  document.addEventListener('touchmove',  (e)=>{ if(sbarDrag) moveSbarDrag(e.touches[0].clientX); }, {passive:true});
  document.addEventListener('touchend', endSbarDrag);

  // Клик по треку — переход по месту
  sbarTrack.addEventListener('mousedown', (e)=>{
    if(e.target===sbarThumb) return;
    const rect = sbarTrack.getBoundingClientRect();
    sbarSetScrollByThumbX(e.clientX - rect.left - sbarThumb.clientWidth/2);
  });
  sbarTrack.addEventListener('touchstart', (e)=>{
    if(e.target===sbarThumb) return;
    const rect = sbarTrack.getBoundingClientRect();
    sbarSetScrollByThumbX(e.touches[0].clientX - rect.left - sbarThumb.clientWidth/2);
  }, {passive:true});
}

/* =============================== СПОТЛАЙТ ================================ */

export function chooseAutoSpotlight(){
  if(ctx.pinnedId && ctx.registry.has(ctx.pinnedId)) return ctx.pinnedId;

  const meId = ctx.room?.localParticipant?.identity;
  if(meId && document.querySelector(`.tile[data-pid="${CSS.escape(meId)}#screen"]`))
    return meId+'#screen';

  const withVideo = [...ctx.registry.entries()].filter(([,r])=>r.hasVideo);
  if(withVideo.length) return withVideo[0][0];
  if(meId && ctx.registry.has(meId)) return meId;

  return [...ctx.registry.keys()][0];
}

/* ========== MOBILE SMART ASPECT GRID (16:9 / 9:16, максимальная площадь) ========== */

/** Для одиночной плитки: если тайл помечен 'portrait' → 9:16, иначе по ориентации stage */
function pickARForSingle(tile, stageAR){
  if (tile?.classList?.contains?.('portrait')) return 9/16;
  return stageAR >= 1 ? 16/9 : 9/16;
}

/** Подбор лучшей сетки под заданный AR: максимизируем площадь плитки */
function bestGridForAR(N, W, H, gap, AR){
  let best = null;
  for (let cols = 1; cols <= N; cols++){
    const rows   = Math.ceil(N / cols);
    const wAvail = W - gap * (cols - 1);
    const hAvail = H - gap * (rows - 1);
    if (wAvail <= 0 || hAvail <= 0) continue;

    // 1) Заполнение по ширине (1fr-колонки)
    const cwFill     = wAvail / cols;
    const chFill     = cwFill / AR;
    const totalHFill = rows * chFill + gap * (rows - 1);

    if (totalHFill <= H + 0.5){
      const area = cwFill * chFill;
      if (!best || area > best.area)
        best = { mode:'fillWidth', cols, rows, cw:cwFill, ch:chFill, AR, area };
    } else {
      // 2) Подгон по высоте
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

/** Главный раскладчик мобильных плиток: строгий 16:9 / 9:16 + максимум площади */
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

  // канд. AR:
  // 1 тайл — по его метке .portrait / ориентации stage;
  // >1 тайла — если портретных больше половины, предпочитаем 9:16.
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

  // Применяем сетку
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
    // фиксируем aspect-ratio у плитки (видео внутри — через object-fit в CSS)
    t.style.aspectRatio = arCSS;
  });

  // в этой схеме горизонтального скролла нет — скрываем сбар (если был)
  sbar?.classList.remove('show');
}

/* ===== Авто-детект портретности видео и перерисовка лэйаута ===== */

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
    if (isMobileView() && !ctx.isStageFull) {
      layoutMobileTiles();
    } else {
      fitSpotlightSize();
    }
  }
}

function attachVideoARWatcher(video){
  if (!video || video.__arWatchAttached) return;
  const handler = () => updateTileOrientationFromVideo(video);

  video.addEventListener('loadedmetadata', handler);
  video.addEventListener('loadeddata', handler);
  // Chrome/Edge поддерживают 'resize' на <video> при смене потока/энкодера
  video.addEventListener('resize', handler);

  // первый прогон
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

/* ======================================================================== */

export function applyLayout(){
  const tiles = byId('tiles'), main = tilesMain(), rail = tilesRail();
  const mobile = isMobileView() && !ctx.isStageFull;

  // Восстановление уничтоженных DOM-элементов
  ctx.registry.forEach((rec)=>{
    if(!document.body.contains(rec.tile)){
      rec.tile = createTileEl(rec.participant.identity, rec.name, rec.isLocal);
    }
  });

  // Если нет плиток, а локальный участник уже есть — вставим заглушку
  if (!document.querySelector('.tile') && ctx.room?.localParticipant){
    const me  = ctx.room.localParticipant;
    const rec = ctx.registry.get(me.identity);
    if (rec && !rec.tile){
      rec.tile = createTileEl(me.identity, rec.name || me.identity, true);
      main && main.appendChild(rec.tile);
    }
  }

  if (mobile) {
    tiles.classList.remove('spotlight','single');
    document.querySelectorAll('.tile').forEach(t=>{
      // НЕ трогаем 'portrait' — авто-детект видео управляет этим классом
      t.classList.remove('spotlight','thumb');
      // очищаем прямые размеры — будем управлять через aspect-ratio
      t.style.width=''; t.style.height='';
      if (t.parentElement !== main) main.appendChild(t);
    });

    // Новая «умная» мобильная сетка (строгий AR + макс. площадь)
    layoutMobileTiles();

    // Удерживаем текущую панель карусели (если используется)
    alignToActivePane('instant');
    updateUsersCounter();
    return;
  }

  // --- Десктопный режим со спотлайтом и рейлом ---
  const spotlightId = chooseAutoSpotlight();
  const totalTiles  = document.querySelectorAll('.tile').length;

  tiles.classList.add('spotlight');
  tiles.classList.toggle('single', totalTiles<=1);

  // сброс параметров мобильной сетки при выходе из мобайла
  const m = tilesMain();
  if (m){
    m.style.gridTemplateColumns = '';
    m.style.display = '';
    m.style.gap = '';
    m.style.gridAutoFlow = '';
    m.style.alignContent = '';
    m.style.justifyContent = '';
  }
  document.querySelectorAll('.tile').forEach(t=>{
    t.style.aspectRatio = '';
  });

  document.querySelectorAll('.tile').forEach(t=>{
    t.classList.remove('spotlight','thumb');
    t.style.width=''; t.style.height='';
    const id=t.dataset.pid;
    if(id===spotlightId){
      if (t.parentElement !== main) main.appendChild(t);
      t.classList.add('spotlight');
    } else {
      if (totalTiles>1){
        if (t.parentElement !== rail) rail.appendChild(t);
        t.classList.add('thumb');
      } else {
        if (t.parentElement !== main) main.appendChild(t);
      }
    }
  });

  fitSpotlightSize();
  updateUsersCounter();
}

export function fitSpotlightSize(){
  if (isMobileView() && !ctx.isStageFull) return;
  const main = tilesMain();
  const tile = main?.querySelector('.tile.spotlight');
  if (!tile || !main) return;

  const box = main.getBoundingClientRect();
  const ar  = tile.classList.contains('portrait') ? (9/16) : (16/9);

  let w = box.width, h = w / ar;
  if (h > box.height){ h = box.height; w = h * ar; }

  tile.style.width  = Math.floor(w) + 'px';
  tile.style.height = Math.floor(h) + 'px';
}

/* Подсветка активных спикеров */
export function highlightSpeaking(ids){
  const set=new Set(ids);
  document.querySelectorAll('.tile').forEach(t=>t.classList.remove('speaking'));
  set.forEach(id=>{
    document.querySelector(`.tile[data-pid="${CSS.escape(id)}"]`)?.classList.add('speaking');
  });
}

/* =================== MOBILE LANDSCAPE: равномерная сетка ================== */
/* Оставлено для совместимости; новая умная сетка выше покрывает оба режима. */

function applyEqualGrid(){
  const m = tilesMain();
  if (!m) return;

  const tiles = m.querySelectorAll('.tile');
  const N = tiles.length;
  if (!N) return;

  const box = m.getBoundingClientRect();
  const W = Math.max(0, box.width);
  const H = Math.max(0, box.height);
  if (W < 10 || H < 10) { requestAnimationFrame(applyEqualGrid); return; }

  const gap = parseFloat(getComputedStyle(m).getPropertyValue('--tile-gap')) || 10;
  const AR  = 16/9;

  let best = { area: -1, cols: 1, rows: N, cellW: 0, cellH: 0 };

  for (let cols = 1; cols <= N; cols++){
    const rows = Math.ceil(N / cols);

    const wAvail = W - gap * (cols - 1);
    const hAvail = H - gap * (rows - 1);

    // по ширине
    let cellW = Math.floor(wAvail / cols);
    let cellH = Math.floor(cellW / AR);
    if (rows * cellH <= hAvail && cellW > 0 && cellH > 0){
      const area = cellW * cellH;
      if (area > best.area) best = { area, cols, rows, cellW, cellH };
    }

    // по высоте
    cellH = Math.floor(hAvail / rows);
    cellW = Math.floor(cellH * AR);
    if (cols * cellW <= wAvail && cellW > 0 && cellH > 0){
      const area = cellW * cellH;
      if (area > best.area) best = { area, cols, rows, cellW, cellH };
    }
  }

  m.style.setProperty('--grid-cols', String(best.cols));
  m.style.setProperty('--cell-h', `${best.cellH}px`);
}

/* «Осадка» сетки для iOS/медленных ресайзов */
function settleGrid(){
  applyEqualGrid();
  requestAnimationFrame(applyEqualGrid);
  setTimeout(applyEqualGrid, 60);
}

// пересчёт сетки при изменении размеров/ориентации (совместимость)
window.addEventListener('resize', ()=> { if (isLandscapeMobileNow()) applyEqualGrid(); }, { passive:true });
window.addEventListener('orientationchange', ()=> { if (isLandscapeMobileNow()) setTimeout(applyEqualGrid, 60); });

/* ========================================================================== */
/* === ФУТЕР-КАРУСЕЛЬ: перенос сайдбара и порядок [Подключены][Настройки][Чат] */
/* ========================================================================== */

let sidebarMounted = false;
let sidebarPlaceholder = null;

/* состояние карусели */
let footSwipeInitialized = false;
let activePaneIdx = 1;                 // текущая активная панель
let suppressDetect = false;            // блокировка детектора во время выравниваний
let fsResizeObs = null;
let fsScrollHandler = null;

const STORAGE_KEY = 'footPaneIdx_v1';

/* DOM-хелперы для карусели */
const getFootSwipe = () => qs('.foot-swipe');
const getFootPanes = () => { const fs = getFootSwipe(); return fs ? qsa('.foot-pane', fs) : []; };
const getSidebarPane = () => getFootSwipe()?.querySelector('.foot-pane.sidebar-pane') || null;
const getNonSidebarPanes = () => getFootPanes().filter(p => p !== getSidebarPane());
const getDotsWrap  = () => qs('.foot-dots');
const getDots      = () => qsa('.foot-dots .fdot');
const markDots = (idx)=> getDots().forEach((d,i)=> d.classList.toggle('active', i===idx));

/* «Настройки» — пытаемся найти по .me-card, иначе берём 1-ю не-sidebar */
function getSettingsPane(){
  const list = getNonSidebarPanes();
  const byClass = list.find(p => p.querySelector('.me-card') || p.dataset.role === 'settings');
  return byClass || list[0] || null;
}
/* «Чат» — по .chatbox, иначе 2-ю не-sidebar (если есть) */
function getChatPane(){
  const list = getNonSidebarPanes();
  const byClass = list.find(p => p.querySelector('.chatbox') || p.dataset.role === 'chat');
  return byClass || list[1] || null;
}
const getPaneIndex = (p) => { const panes = getFootPanes(); return p ? panes.indexOf(p) : -1; };

/* сохранение/восстановление выбранной панели */
function loadSavedPaneIdx(){
  try{
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw != null ? Math.max(0, Math.min(+raw, getFootPanes().length-1)) : null;
  }catch{ return null; }
}
function saveActivePaneIdx(){
  try{ sessionStorage.setItem(STORAGE_KEY, String(activePaneIdx)); }catch{}
}

/* Переход к панели по индексу */
export function scrollFootSwipeToPane(idx, behavior = 'instant'){
  activePaneIdx = Math.max(0, Math.min(idx, getFootPanes().length - 1));
  saveActivePaneIdx();
  alignToActivePane(behavior);
}

/* аккуратный скролл к activePaneIdx c «подтяжкой» после рефлоу */
function alignToActivePane(behavior = 'instant'){
  const fs = getFootSwipe(); const panes = getFootPanes();
  if (!fs || !panes.length) return;

  const target = panes[Math.max(0, Math.min(activePaneIdx, panes.length - 1))];
  if (!target) return;

  const left = target.offsetLeft;
  suppressDetect = true;
  try{ fs.scrollTo({ left, behavior }); }catch{ fs.scrollLeft = left; }
  // двойная/тройная подтяжка — защищаемся от позднего рефлоу
  requestAnimationFrame(()=> { try{ fs.scrollTo({ left, behavior:'instant' }); }catch{ fs.scrollLeft = left; }});
  setTimeout(()=> { try{ fs.scrollTo({ left, behavior:'instant' }); }catch{ fs.scrollLeft = left; } suppressDetect = false; }, 80);

  // обновим точки сразу
  markDots(activePaneIdx);
}

/* вычислить индекс панели, в которой реально находится центр вьюпорта */
function detectActivePaneIdx(){
  const fs = getFootSwipe(); const panes = getFootPanes();
  if (!fs || !panes.length) return activePaneIdx;

  const center = fs.scrollLeft + fs.clientWidth / 2;

  // если центр попал внутрь конкретной панели — берём её
  const hit = panes.findIndex(p => {
    const L = p.offsetLeft, R = L + p.clientWidth;
    return center >= L && center <= R;
  });
  if (hit !== -1) return hit;

  // иначе ближайшая по краю (при равенстве — правая)
  let best = 0, bestDist = Infinity;
  panes.forEach((p, i) => {
    const L = p.offsetLeft, R = L + p.clientWidth;
    const d = center < L ? (L - center) : (center - R);
    if (d < bestDist || (d === bestDist && i > best)) { bestDist = d; best = i; }
  });
  return best;
}

/* следим за ручным скроллом пользователя */
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

/* на время DOM-манипуляций можно сохранить/вернуть scrollLeft (по умолчанию — да) */
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

/** Вставить «Подключены» как ПЕРВУЮ панель (слева) */
function mountSidebarIntoFootSwipe(){
  if (sidebarMounted) return;

  const sidebar   = qs('.sidebar');
  const footSwipe = getFootSwipe();
  if (!sidebar || !footSwipe) return;

  const list = sidebar.querySelector('.list') || sidebar.querySelector('#onlineList');
  if (!list) return;

  // плейсхолдер, чтобы вернуть список обратно
  sidebarPlaceholder = document.createElement('div');
  sidebarPlaceholder.className = 'sidebar-placeholder';
  list.parentElement.insertBefore(sidebarPlaceholder, list);

  // панель «Подключены»
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

  // вставляем и сразу расставляем порядок
  withPreservedFsScroll(()=> {
    footSwipe.insertBefore(pane, footSwipe.firstChild);
  }, /*preserve*/ false);

  sidebarMounted = true;

  // порядок панелей
  ensureFootSwipeOrder(false);

  // Первый вход: выбираем сохранённую панель или «настройки»
  if (!footSwipeInitialized){
    const saved = loadSavedPaneIdx();
    if (saved != null){
      activePaneIdx = saved;
    } else {
      const sIdx = getPaneIndex(getSettingsPane());
      activePaneIdx = sIdx >= 0 ? sIdx : 1;
    }
    attachFsScrollWatcher();
    // выравниваемся на выбранную панель
    alignToActivePane('instant');

    // реагируем на изменения ширины контейнера
    if (fsResizeObs) fsResizeObs.disconnect();
    fsResizeObs = new ResizeObserver(()=> alignToActivePane('instant'));
    fsResizeObs.observe(footSwipe);

    // подключим точки, если есть
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
    // Повторный вход — держим текущую панель
    alignToActivePane('instant');
    markDots(activePaneIdx);
  }
}

/** Вернуть список на место и убрать панель из карусели */
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

/** Жёсткий порядок: [Подключены][Настройки][Чат] */
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

/** переключение режимов (и для ландшафта, и для портрета мобилки) */
function handleSidebarRelocation(){
  if (isCarouselModeNow()){
    mountSidebarIntoFootSwipe();
    ensureFootSwipeOrder(true);
    alignToActivePane('instant');  // удержать текущую панель
  } else {
    unmountSidebarFromFootSwipe();
  }
}

/* первичная инициализация */
handleSidebarRelocation();

/* события окружения */
mqLand.addEventListener?.('change', handleSidebarRelocation);
mqPort.addEventListener?.('change', handleSidebarRelocation);
window.matchMedia('(orientation: landscape)').addEventListener?.('change', handleSidebarRelocation);
window.matchMedia('(orientation: portrait)').addEventListener?.('change', handleSidebarRelocation);
window.addEventListener('orientationchange', handleSidebarRelocation);
window.addEventListener('resize', () => {
  handleSidebarRelocation();
  if (isCarouselModeNow()) alignToActivePane('instant');
});

/* Дополнительные пересчёты для умной мобильной сетки */
window.addEventListener('resize', ()=>{
  if (isMobileView() && !ctx.isStageFull) layoutMobileTiles();
}, { passive:true });

window.addEventListener('orientationchange', ()=>{
  setTimeout(()=>{
    if (isMobileView() && !ctx.isStageFull) layoutMobileTiles();
  }, 60);
});

/* ========================================================================== */
/* === Экспортируемое API для внешних модулей =============================== */
/* ========================================================================== */

export function initLayout(){
  // счётчик пользователей
  updateUsersCounter();

  // мобильный скроллбар для плиток (начальная отрисовка)
  updateMobileScrollbar(true);

  // на всякий случай — периодический пересчёт при изменении DOM плиток
  const tm = tilesMain();
  if (tm){
    on(tm, 'scroll', ()=> queueSbarUpdate(), {passive:true});
    const ro = new ResizeObserver(()=> queueSbarUpdate(true));
    ro.observe(tm);
  }

  // десктоп: подгон спотлайта при старте
  if (!isMobileView()) fitSpotlightSize();

  // наблюдение за изменениями ориентации видео
  installVideoARObservers();
}

// Автостарт, но сохраняем экспорт initLayout на случай ручного вызова
if (document.readyState !== 'loading') initLayout();
else document.addEventListener('DOMContentLoaded', initLayout);
