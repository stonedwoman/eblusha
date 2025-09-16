// ===== Mobile Landscape layout (equal grid + footer carousel) =====
import { ctx } from "../state.js";
import { updateFootDotsActive, initFootDots } from "../ui-settings-ice-init.js";
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
// Используем глобальные переменные для предотвращения повторной инициализации
if (typeof window.footSwipeInitialized === 'undefined') {
  window.footSwipeInitialized = false;
}

// Минимальный логгер для отладки карусели (отключён в проде)
const FS = ()=>{};

// Восстанавливаем активную панель из sessionStorage (или из уже установленной window.activePaneIdx), по умолчанию 1
let savedIdx = null; try { const raw = sessionStorage.getItem(STORAGE_KEY); savedIdx = raw!=null ? +raw : null; } catch {}
const existingIdx = (typeof window.activePaneIdx === 'number') ? window.activePaneIdx : null;
window.activePaneIdx = Number.isFinite(existingIdx) ? existingIdx : (Number.isFinite(savedIdx) ? savedIdx : 1);
let activePaneIdx = window.activePaneIdx;
FS('init', { profile:'landscape', savedIdx, active: activePaneIdx });
let suppressDetect = false;
let fsResizeObs = null;
let fsScrollHandler = null;

// STORAGE_KEY already declared above

const getFootSwipe = () => qs('.foot-swipe');
const getFootPanes = () => { const fs = getFootSwipe(); return fs ? qsa('.foot-pane', fs) : []; };
// dots handled centrally in ui-settings-ice-init.js via updateFootDotsActive()

function loadSavedPaneIdx(){
  try{
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw != null ? Math.max(0, Math.min(+raw, getFootPanes().length-1)) : null;
  }catch{ return null; }
}
function saveActivePaneIdx(){
  try{ sessionStorage.setItem(STORAGE_KEY, String(window.activePaneIdx)); }catch{}
}

export function scrollFootSwipeToPane(idx, behavior = 'instant'){
  window.activePaneIdx = Math.max(0, Math.min(idx, getFootPanes().length - 1));
  activePaneIdx = window.activePaneIdx;
  saveActivePaneIdx();
  alignToActivePane(behavior);
}
function alignToActivePane(behavior = 'instant'){
  const fs = getFootSwipe(); const panes = getFootPanes();
  if (!fs || !panes.length) return;

  // Wait until measurements are available
  if (fs.clientWidth === 0 || panes.some(p => p.clientWidth === 0)){
    FS('wait', { reason:'clientWidth=0' });
    requestAnimationFrame(() => setTimeout(() => alignToActivePane(behavior), 30));
    return;
  }

  const target = panes[Math.max(0, Math.min(activePaneIdx, panes.length - 1))];
  if (!target) return;

  // Uniform panes: each pane is 100% of viewport width → compute deterministically
  let left = Math.round(activePaneIdx * fs.clientWidth);
  const measuredLeft = target.offsetLeft;
  // If DOM measurement matches or is close, use it; otherwise use deterministic value
  if (Number.isFinite(measuredLeft) && Math.abs(measuredLeft - left) <= 2) {
    left = measuredLeft;
  }
  FS('align', { idx: activePaneIdx, measuredLeft, computedLeft:left, slBefore: fs.scrollLeft, vw: fs.clientWidth });
  
  suppressDetect = true;
  try{ fs.scrollTo({ left, behavior }); }catch{ fs.scrollLeft = left; }
  requestAnimationFrame(()=> { try{ fs.scrollTo({ left, behavior:'instant' }); }catch{ fs.scrollLeft = left; }});
  setTimeout(()=> { 
    try{ fs.scrollTo({ left, behavior:'instant' }); }catch{ fs.scrollLeft = left; } 
    suppressDetect = false; 
    // persist current pane index after programmatic align
    saveActivePaneIdx();
    updateFootDotsActive();
    FS('aligned', { idx: activePaneIdx, slAfter: fs.scrollLeft });
  }, 80);

  updateFootDotsActive();
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
      // simple index detection in landscape: pane width = viewport width
      const fs = getFootSwipe();
      if (fs && fs.clientWidth > 0){ window.activePaneIdx = Math.round(fs.scrollLeft / fs.clientWidth); }
      else { window.activePaneIdx = detectActivePaneIdx(); }
      activePaneIdx = window.activePaneIdx;
      saveActivePaneIdx();
      updateFootDotsActive();
      FS('scroll->idx', { idx: activePaneIdx, sl: fs?.scrollLeft, vw: fs?.clientWidth });
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

/* === ИНИЦИАЛИЗАЦИЯ КАРУСЕЛИ (теперь сайдбар уже в HTML) === */
function initFootSwipeCarousel(){
  const footSwipe = getFootSwipe();
  if (!footSwipe) return;
  
  // Если карусель уже инициализирована, просто выравниваем по активной панели
  if (window.footSwipeInitialized) {
    FS('reinit-align', { idx: activePaneIdx });
    alignToActivePane('instant');
    return;
  }

  const panes = getFootPanes();
  FS('panes', { count: panes.length });
  
  const saved = loadSavedPaneIdx();
  FS('saved', { saved });
  if (saved != null){ window.activePaneIdx = saved; activePaneIdx = saved; }

  attachFsScrollWatcher();
  alignToActivePane('instant');

  if (fsResizeObs) fsResizeObs.disconnect();
  fsResizeObs = new ResizeObserver(()=> alignToActivePane('instant'));
  fsResizeObs.observe(footSwipe);

  // ensure dots exist and reflect current pane count
  try { initFootDots(); } catch {}
  updateFootDotsActive();

  window.footSwipeInitialized = true;
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
  // инициализируем карусель
  initFootSwipeCarousel();
  updateUsersCounter();
}

/* ================================ INIT =================================== */
export function initLayout(){
  updateUsersCounter();

  // Инициализируем карусель
  initFootSwipeCarousel();

  // Пересчёты сетки
  on(window, 'resize', ()=> settleGrid(), { passive:true });
  on(window, 'orientationchange', ()=> {
    setTimeout(() => {
      settleGrid();
      // Сохраняем текущую панель перед сменой ориентации
      saveActivePaneIdx();
    }, 60);
  }, { passive:true });
  
  // Первый прогон
  applyLayout();
}
