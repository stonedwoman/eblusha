// ===== Mobile Landscape layout (equal grid + footer carousel) =====
import { ctx } from "../state.js";
import { byId } from "../utils.js";
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

/* =================== Равномерная сетка с фиксированным 16:9 ============== */
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

  // подчистим инлайны
  tiles.forEach(t=>{
    t.style.aspectRatio = '';
    t.style.width = '';
    t.style.height = '';
  });
}
function settleGrid(){
  applyEqualGrid();
  requestAnimationFrame(applyEqualGrid);
  setTimeout(applyEqualGrid, 60);
}

/* Подсветка активных спикеров (общая фича) */
export function highlightSpeaking(ids){
  const set=new Set(ids);
  document.querySelectorAll('.tile').forEach(t=>t.classList.remove('speaking'));
  set.forEach(id=>{
    document.querySelector(`.tile[data-pid="${CSS.escape(id)}"]`)?.classList.add('speaking');
  });
}

/* ======================== ФУТЕР-КАРУСЕЛЬ (ландшафт) ====================== */
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
const getDots      = () => qsa('.foot-dots .fdot');
const markDots = (idx)=> getDots().forEach((d,i)=> d.classList.toggle('active', i===idx));

/* --- Поиск списка «Подключены» надёжнее --- */
function getSidebar(){ return qs('.sidebar'); }
/** Предпочитаем #onlineList, затем похожие классы, затем .list как фолбэк */
function findOnlineList(){
  const sb = getSidebar();
  // строго внутри sidebar
  let el = sb?.querySelector('#onlineList, .online-list') || null;
  if (!el) el = sb?.querySelector('.list #onlineList, .list .online-list') || null;
  if (!el) el = sb?.querySelector('#onlineList, .online-list, .list') || null;
  // глобальный фолбэк (если уже вынесли из сайдбара или верстка другая)
  if (!el) el = document.querySelector('#onlineList, .online-list');
  return el || null;
}

/* --- если элемента ещё нет, ждём его появление и монтируем --- */
let waitObs = null;
function waitAndMountSidebarIfReady(){
  if (sidebarMounted) return;
  const fs = getFootSwipe();
  const list = findOnlineList();
  if (fs && list) { mountSidebarIntoFootSwipe(); return; }

  if (waitObs) waitObs.disconnect();
  waitObs = new MutationObserver(() => {
    const fs2 = getFootSwipe();
    const l2 = findOnlineList();
    if (fs2 && l2){
      waitObs.disconnect(); waitObs = null;
      mountSidebarIntoFootSwipe();
    }
  });
  waitObs.observe(document.body, { childList:true, subtree:true });
}

/* Панели «Настройки» и «Чат» */
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

/* === МОНТАЖ «ПОДКЛЮЧЕНЫ» В КАРУСЕЛЬ === */
function mountSidebarIntoFootSwipe(){
  if (sidebarMounted && getSidebarPane()) return;

  const footSwipe = getFootSwipe();
  const list = findOnlineList();
  if (!footSwipe || !list) { waitAndMountSidebarIfReady(); return; }

  // Если список уже в нужной панели — просто выровняем порядок
  const existingPane = list.closest('.foot-pane.sidebar-pane');
  if (existingPane && existingPane.parentElement === footSwipe){
    sidebarMounted = true;
    ensureFootSwipeOrder(false);
    return;
  }

  // Создадим плейсхолдер, чтобы вернуть список обратно при выходе из мобайла
  if (!sidebarPlaceholder){
    sidebarPlaceholder = document.createElement('div');
    sidebarPlaceholder.className = 'sidebar-placeholder';
    if (list.parentElement) list.parentElement.insertBefore(sidebarPlaceholder, list);
  }

  // Панель «Подключены» (если её нет)
  let pane = getSidebarPane();
  if (!pane){
    pane = document.createElement('div');
    pane.className = 'foot-pane sidebar-pane';
  } else {
    pane.textContent = ''; // очистим, на случай старого содержимого
  }

  // Обёртка и заголовок (заголовок скрыт)
  const title = document.createElement('h3');
  title.textContent = 'Подключены';
  title.style.cssText = 'display:none';

  const wrapper = document.createElement('div');
  wrapper.className = 'list';
  wrapper.appendChild(list);

  pane.appendChild(title);
  pane.appendChild(wrapper);

  withPreservedFsScroll(()=> {
    if (!pane.parentElement) footSwipe.insertBefore(pane, footSwipe.firstChild);
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

  const pane = getSidebarPane();
  // Берём сам список из панели (внутри wrapper.list)
  const list = pane?.querySelector('.list > #onlineList, .list > .online-list, .list > .list') || pane?.querySelector('.list');
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

  const sidebarPane  = getSidebarPane() || null;
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
    t.style.width=''; t.style.height=''; t.style.aspectRatio='';
    if (t.parentElement !== main) main.appendChild(t);
  });

  applyEqualGrid();
  // убеждаемся, что модуль «Подключены» смонтирован
  mountSidebarIntoFootSwipe();
  alignToActivePane('instant');
  updateUsersCounter();
}

/* ================================ INIT =================================== */
export function initLayout(){
  updateUsersCounter();

  // Попробуем смонтировать сразу, иначе дождёмся появления узлов
  mountSidebarIntoFootSwipe();
  waitAndMountSidebarIfReady();

  ensureFootSwipeOrder(true);
  alignToActivePane('instant');

  // Пересчёты сетки
  on(window, 'resize', ()=> settleGrid(), { passive:true });
  on(window, 'orientationchange', ()=> setTimeout(settleGrid, 60), { passive:true });

  // Первый прогон
  applyLayout();
}
