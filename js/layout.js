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
    // небольшой «пинок» в следующий кадр
    raf(() => { emitResize(); impl.queueSbarUpdate(); });
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
export function fitSpotlightSize (...a){ return impl.fitSpotlightSize(...a); }
export function applyLayout      (...a){ return impl.applyLayout(...a); }
export function queueSbarUpdate  (...a){ return impl.queueSbarUpdate(...a); }
export function updateMobileScrollbar(...a){ return impl.updateMobileScrollbar(...a); }
export function updateUsersCounter(...a){ return impl.updateUsersCounter(...a); }
export function highlightSpeaking(...a){ return impl.highlightSpeaking(...a); }

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
    if (isMobile) {
      return isPortrait
        ? "./layout/layout.mobile-portrait.js"
        : "./layout/layout.mobile-landscape.js";
    }
    return "./layout/layout.desktop.js";
  } catch {
    return "./layout/layout.desktop.js";
  }
}

(async () => {
  try {
    const mod = await import(pickProfilePath());
    // В профильных файлах могут быть частичные реализации — аккуратно подменяем имеющиеся
    [
      "fitSpotlightSize", "applyLayout", "queueSbarUpdate",
      "updateMobileScrollbar", "updateUsersCounter", "highlightSpeaking"
    ].forEach(k => {
      if (typeof mod[k] === "function") impl[k] = mod[k];
    });
  } catch {
    // если профиль не загрузился — остаёмся на дефолтных реализациях
  }
})();
