import { ctx } from "./state.js";
import { byId, isMobileView, isMobileLandscape } from "./utils.js";
import { createTileEl, tilesMain, tilesRail } from "./tiles.js";
import { usersCounterText } from "./registry.js";

/* ===== Лэйаут / скроллбар / spotlight ===== */

export function updateUsersCounter(){
  byId('usersTag').textContent = usersCounterText();
}

/* --- mobile scrollbar (для портретной мобилки) --- */
const sbar      = byId('tilesSbar');
const sbarTrack = byId('sbarTrack');
const sbarThumb = byId('sbarThumb');

let sbarDrag = null;
let sbarUpdateTimer = null;

export function queueSbarUpdate(){
  clearTimeout(sbarUpdateTimer);
  sbarUpdateTimer = setTimeout(()=> updateMobileScrollbar(false), 50);
}

export function updateMobileScrollbar(forceShow){
  // в landscape мобилы — горизонтального скролла нет, там сетка
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

/* безопасная подписка на скролл tiles-main */
const _m = tilesMain();
_m && _m.addEventListener('scroll', ()=> updateMobileScrollbar(false), {passive:true});
window.addEventListener('resize',  ()=> updateMobileScrollbar(false));

function sbarSetScrollByThumbX(px){
  const m = tilesMain(); if(!m || !sbarTrack || !sbarThumb) return;
  const trackW  = sbarTrack.clientWidth;
  const thumbW  = sbarThumb.clientWidth;
  const maxLeft = Math.max(0, trackW - thumbW);
  const clamp   = Math.max(0, Math.min(maxLeft, px));
  const ratio   = maxLeft ? (clamp / maxLeft) : 0;
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
  sbarThumb.addEventListener('mousedown', (e)=>{ e.preventDefault(); startSbarDrag(e.clientX); });
  document.addEventListener('mousemove', (e)=>{ if(sbarDrag) moveSbarDrag(e.clientX); });
  document.addEventListener('mouseup', endSbarDrag);
  sbarThumb.addEventListener('touchstart', (e)=>{ startSbarDrag(e.touches[0].clientX); }, {passive:true});
  document.addEventListener('touchmove',  (e)=>{ if(sbarDrag) moveSbarDrag(e.touches[0].clientX); }, {passive:true});
  document.addEventListener('touchend', endSbarDrag);
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

/* --- spotlight / раскладка --- */

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

export function applyLayout(){
  const tiles = byId('tiles'), main = tilesMain(), rail = tilesRail();
  const mobile = isMobileView() && !ctx.isStageFull;

  // восстановить уничтоженные DOM-элементы
  ctx.registry.forEach((rec)=>{
    if(!document.body.contains(rec.tile)){
      rec.tile = createTileEl(rec.participant.identity, rec.name, rec.isLocal);
    }
  });

  // если вообще нет плиток, а локальный участник уже есть — вставим заглушку
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
      t.classList.remove('spotlight','thumb','portrait');
      t.style.width=''; t.style.height='';
      if (t.parentElement !== main) main.appendChild(t);
    });
    updateUsersCounter();

    // в landscape — равномерная сетка, в портретной мобилке — горизонтальная лента + скроллбар
    if (isLandscapeMobileNow()){
      settleGrid();
      // тут НЕ переезжаем насильно на индекс 1 — держим текущую панель;
      // при первом входе это сделает mountSidebarIntoFootSwipe()
      alignToActivePane('instant');
    } else {
      updateMobileScrollbar(true);
    }
    return;
  }

  // --- Десктопный режим со спотлайтом и рейлом ---
  const spotlightId = chooseAutoSpotlight();
  const totalTiles  = document.querySelectorAll('.tile').length;

  tiles.classList.add('spotlight');
  tiles.classList.toggle('single', totalTiles<=1);

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

/* === Подгон размера спотлайта на десктопе === */
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

/* === Подсветка активных спикеров === */
export function highlightSpeaking(ids){
  const set=new Set(ids);
  document.querySelectorAll('.tile').forEach(t=>t.classList.remove('speaking'));
  set.forEach(id=>{
    document.querySelector(`.tile[data-pid="${CSS.escape(id)}"]`)?.classList.add('speaking');
  });
}

/* ========================================================================== */
/* === MOBILE LANDSCAPE: равномерная сетка одинаковых 16:9 тайлов =========== */
/* ========================================================================== */

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

// пересчёт сетки при изменении размеров/ориентации
window.addEventListener('resize', ()=> { if (isLandscapeMobileNow()) applyEqualGrid(); }, { passive:true });
window.addEventListener('orientationchange', ()=> { if (isLandscapeMobileNow()) setTimeout(applyEqualGrid, 60); });

/* ========================================================================== */
/* === Перенос в карусель и порядок панелей: [Подключены][Настройки][Чат] === */
/* ========================================================================== */

const mqLand = window.matchMedia('(max-width: 950px) and (hover: none) and (pointer: coarse) and (orientation: landscape)');
function isLandscapeMobileNow(){ return mqLand?.matches; }

let sidebarMounted = false;
let sidebarPlaceholder = null;

/* состояние карусели */
let footSwipeInitialized = false; // первый вход в landscape
let activePaneIdx = 1;            // будем держать актуальный индекс
let initSuppressed = false;       // не фиксировать активную панель во время первичного автоскролла
let fsResizeObs = null;

/* утилиты */
function getFootSwipe(){ return document.querySelector('.foot-swipe'); }
function getFootPanes(){
  const fs = getFootSwipe();
  return fs ? Array.from(fs.querySelectorAll('.foot-pane')) : [];
}
function getSidebarPane(){ return getFootSwipe()?.querySelector('.foot-pane.sidebar-pane') || null; }
function getSettingsPane(){
  return getFootPanes().find(p => p !== getSidebarPane() && p.querySelector('.me-card')) || null;
}
function getChatPane(){
  return getFootPanes().find(p => p !== getSidebarPane() && p.querySelector('.chatbox')) || null;
}
function getPaneIndex(p){ const panes = getFootPanes(); return p ? panes.indexOf(p) : -1; }

/* ШИМ совместимости: старые вызовы продолжают работать */
function scrollFootSwipeToPane(idx, behavior = 'instant'){
  activePaneIdx = Math.max(0, Math.min(idx, getFootPanes().length - 1));
  alignToActivePane(behavior);
}

/* аккуратный скролл к активной панели с «подтяжкой» после релоевта */
function alignToActivePane(behavior = 'instant'){
  const fs = getFootSwipe(); const panes = getFootPanes();
  if (!fs || !panes.length) return;
  const target = panes[Math.max(0, Math.min(activePaneIdx, panes.length - 1))];
  if (!target) return;

  const left = target.offsetLeft;
  fs.scrollTo({ left, behavior });
  requestAnimationFrame(()=> fs.scrollTo({ left, behavior:'instant' }));
  setTimeout(()=> fs.scrollTo({ left, behavior:'instant' }), 60);
}

/* вычислить индекс панели ближе к центру */
function detectActivePaneIdx(){
  const fs = getFootSwipe(); const panes = getFootPanes();
  if(!fs || !panes.length) return activePaneIdx;
  const center = fs.scrollLeft + fs.clientWidth / 2;
  let best = 0, bestDist = Infinity;
  panes.forEach((p, i)=>{
    const pc = p.offsetLeft + p.clientWidth / 2;
    const d = Math.abs(center - pc);
    if(d < bestDist){ bestDist = d; best = i; }
  });
  return best;
}

/* следим за скроллом пользователя */
function attachFsScrollWatcher(){
  const fs = getFootSwipe();
  if(!fs || fs.__watching) return;
  fs.__watching = true;
  let t = null;
  fs.addEventListener('scroll', ()=>{
    if(initSuppressed) return;
    if(t) return;
    t = setTimeout(()=>{ activePaneIdx = detectActivePaneIdx(); t = null; }, 120);
  }, { passive:true });
}

/* сохраняем scrollLeft на время DOM-манипуляций */
function withPreservedFsScroll(fn){
  const fs = getFootSwipe();
  if(!fs){ fn(); return; }
  const left = fs.scrollLeft;
  fn();
  requestAnimationFrame(()=> { fs.scrollLeft = left; });
}

/** Вставить «Подключены» как ПЕРВУЮ панель (слева) */
function mountSidebarIntoFootSwipe(){
  if (sidebarMounted) return;

  const sidebar   = document.querySelector('.sidebar');
  const footSwipe = getFootSwipe();
  if (!sidebar || !footSwipe) return;

  const list = sidebar.querySelector('.list') || sidebar.querySelector('#onlineList');
  if (!list) return;

  // плейсхолдер
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

  withPreservedFsScroll(()=> {
    footSwipe.insertBefore(pane, footSwipe.firstChild);
  });

  sidebarMounted = true;

  ensureFootSwipeOrder();
  attachFsScrollWatcher();

  // первый вход — открыть «me»
  if (!footSwipeInitialized){
    initSuppressed = true;

    const settingsPane = getSettingsPane();
    const sIdx = getPaneIndex(settingsPane);
    activePaneIdx = sIdx >= 0 ? sIdx : 1;

    alignToActivePane('instant');
    setTimeout(()=>{ initSuppressed = false; }, 300);
    footSwipeInitialized = true;

    // на изменение размеров контейнера — подтягиваем позицию
    if (fsResizeObs) fsResizeObs.disconnect();
    fsResizeObs = new ResizeObserver(()=> alignToActivePane('instant'));
    fsResizeObs.observe(footSwipe);
  }
}

/** Вернуть список на место и убрать панель из карусели */
function unmountSidebarFromFootSwipe(){
  if (!sidebarMounted) return;

  const pane = document.querySelector('.foot-pane.sidebar-pane');
  const list = pane?.querySelector('.list > .list, .list > #onlineList') || pane?.querySelector('.list');
  if (list && sidebarPlaceholder && sidebarPlaceholder.parentElement) {
    sidebarPlaceholder.parentElement.replaceChild(list, sidebarPlaceholder);
  }
  pane?.remove();

  sidebarMounted = false;
  sidebarPlaceholder = null;

  // сброс состояний
  footSwipeInitialized = false;
  initSuppressed = false;
  if (fsResizeObs){ fsResizeObs.disconnect(); fsResizeObs = null; }
}

/** Жёстко выставляем порядок: [Подключены][Настройки][Чат] */
function ensureFootSwipeOrder(){
  const fs = getFootSwipe();
  if (!fs) return;

  const sidebarPane = getSidebarPane();
  const settingsPane = getSettingsPane();
  const chatPane = getChatPane();

  withPreservedFsScroll(()=> {
    if (sidebarPane) fs.insertBefore(sidebarPane, fs.firstChild); // слева
    if (settingsPane) fs.appendChild(settingsPane);                // середина
    if (chatPane)     fs.appendChild(chatPane);                    // справа
  });
}

/** Реакция на вход/выход из landscape-режима */
function handleSidebarRelocation(){
  if (isLandscapeMobileNow()){
    mountSidebarIntoFootSwipe();
    // удерживаем текущую панель (или me при первом входе)
    alignToActivePane('instant');
  } else {
    unmountSidebarFromFootSwipe();
  }
}

handleSidebarRelocation();

/* события окружения */
mqLand.addEventListener?.('change', handleSidebarRelocation);
window.matchMedia('(orientation: landscape)').addEventListener?.('change', handleSidebarRelocation);
window.addEventListener('orientationchange', handleSidebarRelocation);
window.addEventListener('resize', () => {
  handleSidebarRelocation();
  if (isLandscapeMobileNow()) alignToActivePane('instant');
});
