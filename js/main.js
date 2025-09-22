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
