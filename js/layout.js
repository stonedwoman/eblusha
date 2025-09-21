// js/layout.js
// Универсальный слой совместимости: гарантирует наличие именованных экспортов,
// а затем (лениво) подтягивает профиль из ./layout/*.js и подменяет реализации.

// ===== утилиты
const raf = (fn) => requestAnimationFrame(fn);
const emitResize = () => { try { window.dispatchEvent(new Event("resize")); } catch {} };

// ===== дефолтные реализации (безопасные, минимальные)
const impl = {
  fitSpotlightSize() {
    try {
      const media =
        document.querySelector(".tile.spotlight video") ||
        document.querySelector(".tile.spotlight img") ||
        document.querySelector("#spotlight video") ||
        document.querySelector("#spotlight img");
      if (media) {
        media.style.width = "100%";
        media.style.height = "100%";
        media.style.objectFit = "contain";
        media.style.objectPosition = "center";
      }
      const stage = document.querySelector(".stage") || document.querySelector("#stage");
      if (stage) { stage.style.minHeight = "0"; stage.style.overflow = "hidden"; }
    } catch {}
    emitResize();
  },

  applyLayout() {
    try{
      const tiles = document.getElementById('tiles');
      const main  = document.getElementById('tilesMain');
      const rail  = document.getElementById('tilesRail');
      if (!main) return;

      // 1) вернуть все тайлы в основной контейнер
      const allTiles = Array.from(document.querySelectorAll('.tile'));
      allTiles.forEach(t=>{
        t.classList.remove('spotlight','thumb');
        t.style.width=''; t.style.height='';
        if (t.parentElement !== main) main.appendChild(t);
      });
      if (tiles){ tiles.classList.remove('spotlight'); tiles.classList.toggle('single', allTiles.length<=1); }
      if (rail){ rail.innerHTML=''; }

      // 2) простая грид-сетка: подберём число колонок под 16:9, чтобы увеличивать площадь
      const box = main.getBoundingClientRect();
      const N = Math.max(0, main.querySelectorAll('.tile').length);
      const best = (function bestGrid(n, W, H, ar){
        ar = ar || (16/9);
        let res={ rows:1, cols: Math.max(1,n), score:0 };
        for(let cols=1; cols<=Math.max(1, Math.min(n, 6)); cols++){
          const rows = Math.ceil(n/cols);
          const w = W/cols, h = H/rows;
          const size = Math.min(w, h/ar);
          if(size > res.score) res = { rows, cols, score:size };
        }
        return res;
      })(N, Math.max(1, box.width), Math.max(1, box.height), 16/9);

      main.style.display = 'grid';
      main.style.gridTemplateColumns = `repeat(${Math.max(1, best.cols||1)}, 1fr)`;
      // задаём явную высоту строк для видимости контента
      const rows = Math.max(1, Math.ceil(N / Math.max(1, best.cols||1)));
      const rowH = Math.floor(box.height / rows);
      main.style.gridAutoRows = `${rowH}px`;
    } finally {
      emitResize(); impl.queueSbarUpdate();
    }
  },

  queueSbarUpdate() {
    if (impl.__sbarRaf) cancelAnimationFrame(impl.__sbarRaf);
    impl.__sbarRaf = raf(() => {
      impl.__sbarRaf = 0;
      try {
        const host =
          document.querySelector("#tiles") ||
          document.querySelector("#tilesMain") ||
          document.querySelector(".tiles-main");
        const rail = document.querySelector(".tiles-sbar") || document.querySelector(".mobile-sbar");
        if (!host || !rail) return;
        const need = host.scrollHeight > host.clientHeight + 1;
        rail.style.display = need ? "" : "none";
      } catch {}
    });
  },

  // устаревшее название в части кода — просто алиас
  updateMobileScrollbar() { impl.queueSbarUpdate(); },

  updateUsersCounter() {
    try {
      const nTiles = document.querySelectorAll(".tile").length;
      const nUsers = document.querySelectorAll("#onlineList .user, .user-list .user").length;
      const n = Math.max(nTiles, nUsers);
      const el =
        document.querySelector("#usersCounter") ||
        document.querySelector("#onlineCounter") ||
        document.querySelector(".users-counter");
      if (el) el.textContent = String(n);
    } catch {}
  },

  // подсветка говорящего; терпимо к разным сигнатурам
  highlightSpeaking(identity, on = true) {
    try {
      let pid = identity;
      if (identity && typeof identity === "object") {
        pid = identity.identity || identity.participantId || identity.pid || identity.id;
      }
      if (typeof pid !== "string") return;
      const sel = `.tile[data-pid="${CSS.escape(pid)}"]`;
      document.querySelectorAll(sel).forEach(t => t.classList.toggle("speaking", !!on));
    } catch {}
  },
};

// ===== экспортируем «обёртки», которые делегируют в текущую impl
export function fitSpotlightSize (...a){ 
  if (typeof impl.fitSpotlightSize === 'function') return impl.fitSpotlightSize(...a);
  // fallback для случаев, когда модуль ещё не загрузился
  try { window.dispatchEvent(new Event("resize")); } catch {}
}
export function applyLayout      (...a){ 
  if (typeof impl.applyLayout === 'function') return impl.applyLayout(...a);
  // fallback для случаев, когда модуль ещё не загрузился
  console.warn('applyLayout not ready, using fallback');
  try { 
    // Попробуем пересчитать layout через событие
    window.dispatchEvent(new Event("resize")); 
    // И через небольшой таймаут ещё раз
    setTimeout(() => {
      if (typeof impl.applyLayout === 'function') {
        impl.applyLayout(...a);
      }
    }, 100);
  } catch (e) {
    console.error('Layout fallback failed:', e);
  }
}
export function queueSbarUpdate  (...a){ 
  if (typeof impl.queueSbarUpdate === 'function') return impl.queueSbarUpdate(...a);
}
export function updateMobileScrollbar(...a){ 
  if (typeof impl.updateMobileScrollbar === 'function') return impl.updateMobileScrollbar(...a);
}
export function updateUsersCounter(...a){ 
  if (typeof impl.updateUsersCounter === 'function') return impl.updateUsersCounter(...a);
}
export function highlightSpeaking(...a){ 
  if (typeof impl.highlightSpeaking === 'function') return impl.highlightSpeaking(...a);
}

// ===== глобальные алиасы (некоторые места зовут через globalThis)
try {
  globalThis.layout = globalThis.layout || {};
  Object.assign(globalThis.layout, {
    fitSpotlightSize, applyLayout, queueSbarUpdate,
    updateMobileScrollbar, updateUsersCounter, highlightSpeaking
  });
  if (typeof globalThis.fitSpotlightSize !== "function") {
    globalThis.fitSpotlightSize = fitSpotlightSize;
  }
} catch {}

// ===== попытка лениво подгрузить конкретный профиль из ./layout/*.js
function pickProfilePath(){
  try {
    const isMobile = matchMedia("(max-width: 900px)").matches;
    const isPortrait = matchMedia("(orientation: portrait)").matches;
    console.log('Profile selection:', { isMobile, isPortrait, width: window.innerWidth, height: window.innerHeight });
    
    if (isMobile) {
      const profile = isPortrait
        ? "./layout/layout.mobile-portrait.js"
        : "./layout/layout.mobile-landscape.js";
      console.log('Selected mobile profile:', profile);
      return profile;
    }
    console.log('Selected desktop profile');
    return "./layout/layout.desktop.js";
  } catch (e) {
    console.error('Error in pickProfilePath:', e);
    return "./layout/layout.desktop.js";
  }
}

// Загружаем профиль сразу, не асинхронно
let profileLoaded = false;
let profileLoading = false;

function loadProfile() {
  // Профили отключены: используем простую грид-сетку из impl.applyLayout
  profileLoaded = true; profileLoading = false;
}

// Запускаем загрузку сразу
loadProfile();

// Обработчик изменения ориентации для перезагрузки профиля
window.addEventListener('orientationchange', () => {
  setTimeout(() => {
    console.log('Orientation changed, reloading layout profile');
    profileLoaded = false;
    profileLoading = false;
    loadProfile();
  }, 100);
}, { passive: true });

// Обработчик изменения размера окна для перезагрузки профиля
window.addEventListener('resize', () => {
  setTimeout(() => {
    const currentProfile = pickProfilePath();
    console.log('Window resized, checking if profile needs reload:', currentProfile);
    // Здесь можно добавить логику для проверки, нужно ли перезагружать профиль
  }, 100);
}, { passive: true });
