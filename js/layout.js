// layout.js — совместимый слой (shim) для импорта из разных модулей.
// Экспортирует: fitSpotlightSize, applyLayout, queueSbarUpdate.

function raf(fn){ return requestAnimationFrame(fn); }
function emitResize(){
  try {
    // триггерим перерасчёт во всех местах, где подписались на resize
    window.dispatchEvent(new Event('resize'));
  } catch {}
}

/* ====== Spotlight ====== */
// Подгоняет содержимое .tile.spotlight под контейнер.
export function fitSpotlightSize(){
  try{
    // Берём медиаконтент внутри активного спотлайта
    const media =
      document.querySelector('.tile.spotlight video') ||
      document.querySelector('.tile.spotlight img') ||
      document.querySelector('#spotlight video') ||
      document.querySelector('#spotlight img');

    if (media){
      media.style.width = '100%';
      media.style.height = '100%';
      media.style.objectFit = 'contain';
      media.style.objectPosition = 'center';
    }

    // Иногда спотлайт находится в .stage — убедимся, что она не даёт
    // внутренним абсолютам схлопнуться.
    const stage = document.querySelector('.stage') || document.querySelector('#stage');
    if (stage){
      stage.style.minHeight = '0';
      stage.style.overflow = 'hidden';
    }
  } catch {}
  emitResize();
}

/* ====== Общий пересчёт раскладки ====== */
// Лёгкий «пинок» всей верстки: ресайз + обновление скроллбара.
export function applyLayout(){
  // Немного отложим, чтобы накопившиеся мутирования DOM схлопнулись
  raf(()=>{ emitResize(); queueSbarUpdate(); });
}

/* ====== Кастомный скроллбар плиток ====== */
// Мягко обновляет видимость/размер панели прокрутки, если она есть.
let _sbarRaf = 0;
export function queueSbarUpdate(){
  if (_sbarRaf) cancelAnimationFrame(_sbarRaf);
  _sbarRaf = raf(()=>{
    _sbarRaf = 0;
    try{
      const host = document.querySelector('#tiles') || document.querySelector('#tilesMain');
      const rail = document.querySelector('.tiles-sbar');

      if (!host || !rail) return;

      const need = host.scrollHeight > host.clientHeight + 1;
      rail.style.display = need ? '' : 'none';

      // Простейшая синхронизация положения (если у вас есть кастомный трек/ползунок —
      // можно дополнить логику здесь, сейчас — no-op).
    } catch {}
  });
}

/* ====== Глобальные алиасы, чтобы можно было вызвать без импорта ====== */
try {
  globalThis.layout = globalThis.layout || {};
  globalThis.layout.fitSpotlightSize = fitSpotlightSize;
  globalThis.layout.applyLayout      = applyLayout;
  globalThis.layout.queueSbarUpdate  = queueSbarUpdate;

  // На случай старых вызовов напрямую в глобале:
  if (typeof globalThis.fitSpotlightSize !== 'function') {
    globalThis.fitSpotlightSize = fitSpotlightSize;
  }
} catch {}
