// layout.js — совместимый слой (shim) для импортов из разных модулей.
// Экспортируем: fitSpotlightSize, applyLayout, queueSbarUpdate, updateUsersCounter.
// Плюс дублируем их в globalThis.layout для безопасного вызова без импорта.

const raf = (fn) =>
  (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : setTimeout(fn, 0));

function emitResize() {
  try { window.dispatchEvent(new Event('resize')); } catch {}
}

/* ===== Spotlight: подгоняем медиа внутри .tile.spotlight ===== */
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

/* ===== Скроллбар/лэйаут ===== */
let _sbarRaf = 0;

export function queueSbarUpdate() {
  if (_sbarRaf) cancelAnimationFrame(_sbarRaf);
  _sbarRaf = raf(() => {
    _sbarRaf = 0;
    try {
      const host = document.querySelector('#tiles') || document.querySelector('#tilesMain');
      const rail = document.querySelector('.tiles-sbar');
      if (!host || !rail) return;

      const need = host.scrollHeight > host.clientHeight + 1;
      rail.style.display = need ? '' : 'none';
      // здесь можно синхронизировать кастомный ползунок (если он есть)
    } catch {}
  });
}

export function applyLayout() {
  raf(() => { emitResize(); queueSbarUpdate(); });
}

/* ===== Счётчик участников (совместимый API) ===== */
export function updateUsersCounter(n) {
  try {
    // Если число не передали — попробуем вывести из DOM.
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

    // Куда пишем: пытаемся найти популярные id/классы
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

    // Обновим бейдж в тайтле, если хочется
    if (document && typeof document.title === 'string') {
      const base = document.title.replace(/^\(\d+\)\s*/, '');
      document.title = `(${count}) ${base}`;
    }
  } catch {}
}

/* ===== Глобальные алиасы ===== */
try {
  globalThis.layout = globalThis.layout || {};
  globalThis.layout.fitSpotlightSize  = fitSpotlightSize;
  globalThis.layout.applyLayout       = applyLayout;
  globalThis.layout.queueSbarUpdate   = queueSbarUpdate;
  globalThis.layout.updateUsersCounter= updateUsersCounter;

  // На случай очень старых вызовов:
  if (typeof globalThis.fitSpotlightSize !== 'function') {
    globalThis.fitSpotlightSize = fitSpotlightSize;
  }
} catch {}
