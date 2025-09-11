// layout.js — роутер между тремя лэйаутами
// HTML по-прежнему подключает только этот файл.

import * as Desktop   from "./layout/layout.desktop.js";
import * as MPortrait from "./layout/layout.mobile-portrait.js";
import * as MLand     from "./layout/layout.mobile-landscape.js";
import { isMobileView } from "./utils.js";

/* --------- Детект режимов --------- */
const mqLand = window.matchMedia('(max-width: 950px) and (hover: none) and (pointer: coarse) and (orientation: landscape)');
const mqPort = window.matchMedia('(max-width: 640px) and (hover: none) and (pointer: coarse) and (orientation: portrait)');

function detectMode(){
  if (mqPort.matches) return "m-portrait";
  if (mqLand.matches) return "m-landscape";
  return "desktop";
}

/* --------- Мини-сброс мобильных «карусельных» следов при выходе на десктоп --------- */
function cleanupMobileUI(){
  // Вернуть список «Подключены» из карусели обратно в сайдбар (если перенесён)
  const pane = document.querySelector('.foot-pane.sidebar-pane');
  const placeholder = document.querySelector('.sidebar-placeholder');
  const innerList = pane?.querySelector('.list > #onlineList, .list > .list') || null;

  if (pane && innerList && placeholder && placeholder.parentElement){
    placeholder.parentElement.replaceChild(innerList, placeholder);
    pane.remove();
  }
  // Снять активные точки-пейджера, чтобы не мигали на десктопе
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
    // просто обновим раскладку активного модуля
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

/* --------- Публичные прокси (совместимость с остальным кодом) --------- */
// Можно продолжать вызывать эти функции как раньше из других файлов.
export function initLayout(){ switchTo(detectMode()); }
export function applyLayout(){ currentModule?.applyLayout?.(); }
export function updateUsersCounter(){ currentModule?.updateUsersCounter?.(); }
export function highlightSpeaking(ids){ currentModule?.highlightSpeaking?.(ids); }
// Прокси для карусели (на десктопе — no-op)
export function scrollFootSwipeToPane(i, behavior){ currentModule?.scrollFootSwipeToPane?.(i, behavior); }
// Только десктопный модуль умеет это по-настоящему, проксируем если есть
export function fitSpotlightSize(){ currentModule?.fitSpotlightSize?.(); }

/* --------- Автозапуск и трекинг смены режима --------- */
function handleEnvChange(){
  const next = detectMode();
  switchTo(next);
}

// Первичный запуск
if (document.readyState !== 'loading') initLayout();
else document.addEventListener('DOMContentLoaded', initLayout);

// Реакция на изменения окружения
mqLand.addEventListener?.('change', handleEnvChange);
mqPort.addEventListener?.('change', handleEnvChange);
window.addEventListener('resize', handleEnvChange, { passive:true });
window.addEventListener('orientationchange', () => setTimeout(handleEnvChange, 60), { passive:true });

// Подстрахуемся: если переменная ширины «мобилы» изменилась внутри utils → обновим режим
// (не обязательно, но полезно, если isMobileView() влияет на верстку модулей)
const mqMobile = window.matchMedia('(max-width: 950px)');
mqMobile.addEventListener?.('change', handleEnvChange);
