// /js/main.js  — единственная точка входа

// базовые вещи
import "./config.js";
import "./state.js";
import "./utils.js";
import "./vendor/livekit-loader.js"; // прогреваем загрузчик LK

// UI и DOM-хелперы
import "./tiles.js";
import "./layout.js";
import "./controls.js";
import "./participants.js";
import "./registry.js";   // если у тебя есть отдельный модуль под реестр
import "./sfx.js";

// функциональные блоки
import "./media.js";               // mic/cam/facing/screen-share
import "./chat-session.js";        // чат/выход/горячие клавиши
import "./livekit-connection.js";  // коннект к LiveKit
import "./join.js";                // сабмит формы входа
import "./ui-settings-ice-init.js";// сцена, настройки, предпросмотр, ICE, init

// Wake Lock and iOS media playback helpers
(async () => {
  try {
    if ('wakeLock' in navigator) {
      let lock = await navigator.wakeLock.request('screen');
      document.addEventListener('visibilitychange', async () => {
        if (document.visibilityState === 'visible') {
          try { lock = await navigator.wakeLock.request('screen'); } catch {}
        }
      });
    }
  } catch {}
})();

// Ensure audio starts on first user gesture (iOS policy)
window.addEventListener('touchend', () => {
  try{
    const el = document.getElementById('remoteAudio');
    if (el) { el.play().catch(()=>{}); }
    // fallback: try all audio elements
    document.querySelectorAll('audio').forEach(a=>{ try{ a.play().catch(()=>{}); }catch{} });
  }catch{}
}, { once:true });

try{ if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing'; }catch{}
