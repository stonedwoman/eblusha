// layout.js — совместимый слой (shim) для импортов из разных модулей.
// Экспортируем: fitSpotlightSize, applyLayout, queueSbarUpdate,
//               updateUsersCounter, updateMobileScrollbar (и алиас updateMobileScrollBar).

const raf = (fn) =>
  (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : setTimeout(fn, 0));

function emitResize() {
  try { window.dispatchEvent(new Event('resize')); } catch {}
}

/* ================= Spotlight ================= */
export function fitSpotlightSize() {
  try {
    const media =
      document.querySelector('.tile.spotlight video') ||
      document.querySelector('.tile.spotlight img')   ||
      document.querySelector('#spotlight video')      ||
      document.querySelector('#spotlight img');

    if (media) {
      media.style.width = '100%';
      media.style.height = '100%';
      media.style.objectFit = 'contain';
      media.style.objectPosition = 'center';
    }

    const stage = document.querySelector('.stage') || document.querySelector('#stage');
    if (stage) {
      stage.style.minHeight = '0';
      stage.style.overflow = 'hidden';
    }
  } catch {}
  emitResize();
}

/* ============== Кастомный/мобильный скроллбар плиток ============== */
let _sbarRaf = 0;

function _updateScrollbarCore() {
  try {
    const host =
      document.querySelector('#tiles') ||
      document.querySelector('#tilesMain') ||
      document.querySelector('.tiles-main');

    // рейл скроллбара — любые распространённые селекторы
    const rail =
      document.querySelector('.tiles-sbar') ||
      document.querySelector('#tilesSbar') ||
      document.querySelector('#mobileSbar');

    if (!host || !rail) return;

    const need = host.scrollHeight > host.clientHeight + 1;
    rail.style.display = need ? '' : 'none';

    // тут можно добавить синхронизацию ползунка, если он кастомный
  } catch {}
}

export function queueSbarUpdate() {
  if (_sbarRaf) cancelAnimationFrame(_sbarRaf);
  _sbarRaf = raf(() => {
    _sbarRaf = 0;
    _updateScrollbarCore();
  });
}

/** Обновление мобильного скроллбара (совместимый API). */
export function updateMobileScrollbar() {
  // делаем мгновенный апдейт + ставим в очередь ещё один — чтобы схлопнулись мутации
  _updateScrollbarCore();
  queueSbarUpdate();
}
// На всякий случай экспортируем алиас с другой раскладкой буквы B
export { updateMobileScrollbar as updateMobileScrollBar };

/* ================= Общий пересчёт раскладки ================= */
export function applyLayout() {
  raf(() => {
    emitResize();
    // обновим все виды скроллбара
    updateMobileScrollbar();
  });
}

/* ================= Счётчик участников ================= */
export function updateUsersCounter(n) {
  try {
    let count = Number.isFinite(n) ? Number(n) : NaN;

    if (!Number.isFinite(count)) {
      const candidates = [
        '#onlineList .user',
        '.participants .user',
        '#tilesMain .tile',
        '#tiles .tile',
      ];
      for (const sel of candidates) {
        const els = document.querySelectorAll(sel);
        if (els && els.length) { count = els.length; break; }
      }
      if (!Number.isFinite(count)) count = 0;
    }

    const targets = [
      '#usersCounter', '#onlineCounter', '#participantsCount',
      '.usersCounter', '.onlineCounter', '.participantsCount',
      '#users-count', '#online-count', '.users-count', '.online-count',
      '#participants-counter', '.participants-counter'
    ];
    for (const sel of targets) {
      const el = document.querySelector(sel);
      if (el) el.textContent = String(count);
    }

    if (document && typeof document.title === 'string') {
      const base = document.title.replace(/^\(\d+\)\s*/, '');
      document.title = `(${count}) ${base}`;
    }
  } catch {}
}

/* ================= Глобальные алиасы ================= */
try {
  globalThis.layout = globalThis.layout || {};
  globalThis.layout.fitSpotlightSize     = fitSpotlightSize;
  globalThis.layout.applyLayout          = applyLayout;
  globalThis.layout.queueSbarUpdate      = queueSbarUpdate;
  globalThis.layout.updateUsersCounter   = updateUsersCounter;
  globalThis.layout.updateMobileScrollbar= updateMobileScrollbar;

  // На случай очень старых вызовов напрямую:
  if (typeof globalThis.fitSpotlightSize !== 'function') {
    globalThis.fitSpotlightSize = fitSpotlightSize;
  }
} catch {}
