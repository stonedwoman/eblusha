// layout.js — роутер между тремя лэйаутами
import * as Desktop   from "./layout/layout.desktop.js";
import * as MPortrait from "./layout/layout.mobile-portrait.js";
import * as MLand     from "./layout/layout.mobile-landscape.js";

/* --------- Детект режимов --------- */
const mqLand = window.matchMedia('(max-width: 950px) and (hover: none) and (pointer: coarse) and (orientation: landscape)');
const mqPort = window.matchMedia('(max-width: 640px) and (hover: none) and (pointer: coarse) and (orientation: portrait)');

function detectMode(){
  if (mqPort.matches) return "m-portrait";
  if (mqLand.matches) return "m-landscape";
  return "desktop";
}

/* --------- Мини-сброс мобильных следов при выходе на десктоп --------- */
function cleanupMobileUI(){
  const pane = document.querySelector('.foot-pane.sidebar-pane');
  const placeholder = document.querySelector('.sidebar-placeholder');
  const innerList = pane?.querySelector('.list > #onlineList, .list > .list') || null;

  if (pane && innerList && placeholder && placeholder.parentElement){
    placeholder.parentElement.replaceChild(innerList, placeholder);
    pane.remove();
  }
  document.querySelectorAll('.foot-dots .fdot.active').forEach(d => d.classList.remove('active'));
}

/* --------- Роутер --------- */
const modules = {
  "desktop":     Desktop,
  "m-portrait":  MPortrait,
  "m-landscape": MLand,
};

let currentMode   = null;
let currentModule = null;
const inited = new Set();

function switchTo(mode){
  if (mode === currentMode) {
    currentModule?.applyLayout?.();
    return;
  }
  currentMode   = mode;
  currentModule = modules[mode];

  if (mode === "desktop") cleanupMobileUI();

  if (!inited.has(mode)) {
    currentModule?.initLayout?.();
    inited.add(mode);
  } else {
    currentModule?.applyLayout?.();
  }
}

/* --------- Публичные прокси (совместимость) --------- */
// Эти функции всегда существуют как именованные экспорты,
// даже если в активном модуле они no-op.
export function initLayout(){ switchTo(detectMode()); }
export function applyLayout(){ currentModule?.applyLayout?.(); }
export function updateUsersCounter(){ currentModule?.updateUsersCounter?.(); }
export function highlightSpeaking(ids){ currentModule?.highlightSpeaking?.(ids); }
export function scrollFootSwipeToPane(i, behavior){ currentModule?.scrollFootSwipeToPane?.(i, behavior); }
export function fitSpotlightSize(){ currentModule?.fitSpotlightSize?.(); }

// 🔧 ВАЖНО: добавлены прокси под старые импорты из tiles.js
export function queueSbarUpdate(){ currentModule?.queueSbarUpdate?.(); }
export function updateMobileScrollbar(forceShow){ currentModule?.updateMobileScrollbar?.(forceShow); }

/* --------- Автозапуск и трекинг смены режима --------- */
function handleEnvChange(){
  const next = detectMode();
  switchTo(next);
}

if (document.readyState !== 'loading') initLayout();
else document.addEventListener('DOMContentLoaded', initLayout);

mqLand.addEventListener?.('change', handleEnvChange);
mqPort.addEventListener?.('change', handleEnvChange);
window.addEventListener('resize', handleEnvChange, { passive:true });
window.addEventListener('orientationchange', () => setTimeout(handleEnvChange, 60), { passive:true });
