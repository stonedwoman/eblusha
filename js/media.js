// MIC, CAMERA, SCREEN, FACING
import { ctx, state } from "./state.js";
import { byId, isMobileView } from "./utils.js";
import { applyLayout } from "./layout.js";
import {
  attachVideoToTile,
  showAvatarInTile,
  applyCamTransformsToLive,
  getLocalTileVideo,
  setTileAspectFromVideo,
  relayoutTilesForce,
} from "./tiles.js";
import {
  Track,
  createLocalAudioTrack,
  createLocalVideoTrack,
  createLocalScreenTracks,
} from "./vendor/livekit-loader.js";

/* ===== Публикации (helpers) ===== */
export function micPub(){
  try { return ctx.room?.localParticipant?.getTrack(Track.Source.Microphone); }
  catch { return null; }
}
export function camPub(){
  try { return ctx.room?.localParticipant?.getTrack(Track.Source.Camera); }
  catch { return null; }
}

/* ===== MIC ===== */
export function isMicActuallyOn(){
  const lp = ctx.room?.localParticipant;
  if (lp && typeof lp.isMicrophoneEnabled === "boolean") return lp.isMicrophoneEnabled;
  if (lp && typeof lp.isMicrophoneEnabled === "function") { try { return !!lp.isMicrophoneEnabled(); } catch {} }
  const pub = micPub();
  if (!pub) return false;
  const trackEnabled = (pub.track?.isEnabled !== false);
  return pub.isMuted === false && trackEnabled;
}

let micBusy = false;

export async function ensureMicOn(){
  if(!ctx.room) return;
  const lp = ctx.room.localParticipant;
  try{
    if (typeof lp?.setMicrophoneEnabled === "function"){
      await lp.setMicrophoneEnabled(true, {
        audioCaptureDefaults:{
          echoCancellation:state.settings.ec,
          noiseSuppression:state.settings.ns,
          autoGainControl:state.settings.agc,
          deviceId: state.settings.micDevice||undefined
        }
      });
      const pub = micPub();
      ctx.localAudioTrack = pub?.track || ctx.localAudioTrack;
      return;
    }
  }catch(e){ console.warn("setMicrophoneEnabled failed, fallback", e); }

  const existing = micPub();
  if (existing){
    if (existing.isMuted) { await (existing.setMuted?.(false) || existing.unmute?.()); }
    ctx.localAudioTrack = existing.track || ctx.localAudioTrack;
    return;
  }
  try{
    const track = await createLocalAudioTrack({
      echoCancellation:state.settings.ec,
      noiseSuppression:state.settings.ns,
      autoGainControl:state.settings.agc,
      deviceId: state.settings.micDevice||undefined
    });
    ctx.localAudioTrack = track;
    await ctx.room.localParticipant.publishTrack(track, { source: Track.Source.Microphone });
  }catch(e){ console.error(e); alert("Не удалось включить микрофон: "+(e?.message||e)); }
}

export async function toggleMic(){
  if(!ctx.room || micBusy) return;
  micBusy = true;
  byId("btnMic")?.setAttribute("disabled","true");
  try{
    const lp  = ctx.room.localParticipant;
    const targetOn = !isMicActuallyOn();
    if (typeof lp?.setMicrophoneEnabled === "function"){
      await lp.setMicrophoneEnabled(targetOn, {
        audioCaptureDefaults:{
          echoCancellation:state.settings.ec,
          noiseSuppression:state.settings.ns,
          autoGainControl:state.settings.agc,
          deviceId: state.settings.micDevice||undefined
        }
      });
    } else {
      let pub = micPub();
      if (!pub){
        if (targetOn){ await ensureMicOn(); pub = micPub(); }
      } else {
        if (targetOn){
          if (typeof pub.unmute === "function")      await pub.unmute();
          else if (typeof pub.setMuted === "function") await pub.setMuted(false);
          else if (pub.track?.setEnabled)              pub.track.setEnabled(true);
        } else {
          if (typeof pub.mute === "function")         await pub.mute();
          else if (typeof pub.setMuted === "function") await pub.setMuted(true);
          else if (pub.track?.setEnabled)              pub.track.setEnabled(false);
        }
      }
    }
  }catch(e){
    alert("Ошибка микрофона: "+(e?.message||e));
  }finally{
    micBusy = false;
    byId("btnMic")?.removeAttribute("disabled");
    window.dispatchEvent(new Event("app:refresh-ui"));
  }
}
byId("btnMic")?.addEventListener("click", toggleMic);

/* ===== CAMERA ===== */
export function isCamActuallyOn(){
  // Сначала доверяем реальному треку публикации — это надёжнее,
  // т.к. мы можем включать/выключать камеру не через setCameraEnabled
  const pub = camPub();
  if (pub){
    const trackEnabled = (pub.track?.isEnabled !== false);
    return pub.isMuted === false && trackEnabled;
  }
  // Фолбэк — API участника (может быть неточным, если не используем setCameraEnabled)
  const lp = ctx.room?.localParticipant;
  if (lp && typeof lp.isCameraEnabled === "boolean") return lp.isCameraEnabled;
  if (lp && typeof lp.isCameraEnabled === "function") { try { return !!lp.isCameraEnabled(); } catch {} }
  return false;
}
let camBusy = false;
// Защита от параллельных createLocalVideoTrack: инкрементируем токен операции
let camCreateNonce = 0;

function installLocalVideoTrackGuards(track){
  try{
    const mst = track?.mediaStreamTrack;
    if (!mst) return;
    // Если камера пропала/доступ потерян — пробуем восстановить текущими настройками,
    // но только если это актуальный MST и мы не в процессе переключения
    const onEnded = async ()=>{
      try{
        if (!ctx.room) return;
        if (ctx._camSwitching) return;
        if (document.visibilityState === 'hidden') return;
        if (ctx.camDesiredOn === false) return; // пользователь явно выключил камеру
        const cur = (camPub()?.track || ctx.localVideoTrack)?.mediaStreamTrack;
        if (cur && cur !== mst) return;
        // Не автозапускаем новую камеру — дадим пользователю включить вручную
        // и просто дернём обновление UI
        window.dispatchEvent(new Event('app:refresh-ui'));
      }catch{}
    };
    mst.addEventListener('ended', onEnded);
    mst.addEventListener('mute',  ()=>{/* ignore; LK pub.mute обработается отдельно */});
  }catch{}
}

export function desiredAspectRatio(){
  try{
    const v = getLocalTileVideo();
    const isPortrait = v ? (v.videoHeight > v.videoWidth)
      : (window.matchMedia?.('(orientation: portrait)')?.matches || (window.innerHeight > window.innerWidth));
    return isPortrait ? (9/16) : (16/9);
  }catch{ return (16/9); }
}

function computeSizeForOrientation(prefs={}){
  const ar = desiredAspectRatio();
  // Используем сохранённые размеры, если они соответствуют ориентации; иначе 720p
  let w = prefs.width|0, h = prefs.height|0;
  const portrait = ar < 1;
  const looksPortrait = (w>0 && h>0) ? (h>w) : portrait;
  if (!(w>0 && h>0) || looksPortrait!==portrait){
    if (portrait){ w = 720; h = 1280; }
    else { w = 1280; h = 720; }
  }
  return { width: w, height: h, aspect: ar };
}

async function tuneTrackToOrientation(track, prefs={}){
  try{
    const mst = track?.mediaStreamTrack;
    if (!mst || typeof mst.applyConstraints !== 'function') return;
    const sz = computeSizeForOrientation(prefs);
    // Сначала пробуем exact, затем ослабим до ideal
    try{
      await mst.applyConstraints({
        aspectRatio: { exact: sz.aspect },
        width:  { exact: sz.width },
        height: { exact: sz.height },
      });
    }catch{
      try{
        await mst.applyConstraints({
          aspectRatio: { ideal: sz.aspect },
          width:  { ideal: sz.width },
          height: { ideal: sz.height },
        });
      }catch{}
    }
  }catch{}
}

function buildVideoDefaults(){
  try{
    const devId = state.settings.camDevice || undefined;
    const prefs = ctx.lastVideoPrefs || {};
    const sz = computeSizeForOrientation(prefs);
    const out = {
      ...(devId ? { deviceId: { exact: devId } } : {}),
      aspectRatio: { ideal: sz.aspect },
      frameRate: { ideal: 30, min: 15 },
      width:  { ideal: sz.width },
      height: { ideal: sz.height },
    };
    return out;
  }catch{ return {}; }
}

async function countVideoInputs(){
  try{
    const devs = await navigator.mediaDevices.enumerateDevices();
    return devs.filter(d=> d.kind === "videoinput").length;
  }catch{ return 0; }
}

function isMobileUA(){
  try{
    const ua = navigator.userAgent||navigator.vendor||'';
    return /Android|iPhone|iPad|iPod|Mobile|Silk/i.test(ua);
  }catch{ return false; }
}

function captureCurrentVideoPrefs(){
  try{
    const pub = camPub();
    const lkTrack = pub?.track || ctx.localVideoTrack;
    const mst = lkTrack?.mediaStreamTrack;
    const s = mst?.getSettings?.() || {};
  const v0 = getLocalTileVideo();
  const w0 = (s.width|0) || (v0?.videoWidth|0) || 0;
  const h0 = (s.height|0) || (v0?.videoHeight|0) || 0;
  const prefs = { width: w0||undefined, height: h0||undefined };
    try{ ctx.lastVideoPrefs = prefs; }catch{}
    return prefs;
  }catch{ return { width: undefined, height: undefined }; }
}

export async function pickCameraDevice(facing){
  try{
    const devs = await navigator.mediaDevices.enumerateDevices();
    const cams = devs.filter(d=>d.kind==="videoinput");
    if(!cams.length) return null;
    const isEnv = facing==="environment";
    const pref = cams.find(d=>/back|rear|environment|задн/i.test(d.label||""));
    const front = cams.find(d=>/front|user|впер|селф|self/i.test(d.label||""));
    if(isEnv) return (pref||cams[1]||cams[0]).deviceId;
    return (front||cams[0]).deviceId;
  }catch{ return null; }
}

export async function ensureCameraOn(force=false){
  if (!ctx.room) return;
  if (camBusy) return; // всегда предотвращаем параллельные включения
  // Если пользователь не просил включать камеру — не делаем автозапуск
  if (ctx.camDesiredOn === false && !force) return;
  camBusy = true;
  // на входе очищаем потенциальные зависшие превью/локальные ресурсы (кроме опубликованного)
  try{
    if (ctx.previewTrack){ try{ ctx.previewTrack.stop?.(); }catch{}; try{ ctx.previewTrack.detach?.()?.remove?.(); }catch{}; ctx.previewTrack = null; }
  }catch{}
  const myNonce = ++camCreateNonce;
  const lp = ctx.room?.localParticipant;
  const devId = state.settings.camDevice || await pickCameraDevice(state.settings.camFacing||"user");

  // Предпочтительный набор констрейнтов: устройство/фейсинг + сохранённые префы AR/размера
  const base = devId
    ? { deviceId: { exact: devId } }
    : { facingMode: { ideal: state.settings.camFacing||"user" } };
  const constraints = {
    ...base,
    frameRate: { ideal: 30, min: 15 }
  };
  const old = ctx.localVideoTrack || camPub()?.track || null;
  // На мобильных (особенно Android) перед открытием новой камеры освобождаем ресурс старого трека
  const shouldPreStop = isMobileUA();
  if (shouldPreStop && old){ try{ old.stop?.(); }catch{} }
  try{
    // Ограничим время createLocalVideoTrack, чтобы не зависнуть при подвисшей камере
    const createWithTimeout = (ms)=> Promise.race([
      createLocalVideoTrack(constraints),
      new Promise((_,rej)=> setTimeout(()=> rej(new Error('camera-create-timeout')), ms))
    ]);
    const newTrack = await createWithTimeout(8500);
    try{ if (newTrack?.mediaStreamTrack) newTrack.mediaStreamTrack.contentHint = 'motion'; }catch{}
    // Если за время ожидания стартанул другой create — закрываем этот трек и выходим
    if (myNonce !== camCreateNonce){ try{ newTrack.stop?.(); }catch{}; return; }
    const pub = camPub();
    if (pub){
      try{ await pub.replaceTrack(newTrack); }
      catch(e){ try{ await ctx.room.localParticipant.unpublishTrack(pub.track); }catch{}; await ctx.room.localParticipant.publishTrack(newTrack, { source: Track.Source.Camera }); }
      try{ await (pub.setMuted?.(false) || pub.unmute?.()); }catch{}
    } else {
      await ctx.room.localParticipant.publishTrack(newTrack, { source: Track.Source.Camera });
    }
    if (!shouldPreStop){ try { old?.stop?.(); } catch {} }
    ctx.localVideoTrack = newTrack;
    installLocalVideoTrackGuards(newTrack);
    // auto-mirror based on facing
    try{
      const facing = state.settings.camFacing || "user";
      state.settings.camMirror = (facing === "user");
    }catch{}
    // Зафиксировать 16:9/текущий AR для будущих рестартов
    try{
      const v = getLocalTileVideo();
      const w = v?.videoWidth|0, h = v?.videoHeight|0;
      const ar = (w>0 && h>0) ? (w/h) : (ctx.lastVideoPrefs?.aspectRatio || (16/9));
      ctx.lastVideoPrefs = { width: w||undefined, height: h||undefined, aspectRatio: ar };
    }catch{}
    attachVideoToTile(newTrack, ctx.room.localParticipant.identity, true);
    window.requestAnimationFrame(applyCamTransformsToLive);
    setTimeout(()=> window.dispatchEvent(new Event('app:local-video-replaced')), 30);
    const arTick = ()=>{
      const v = getLocalTileVideo();
      if (!v) return;
      const tile = v.closest('.tile');
      if (tile){ setTileAspectFromVideo(tile, v); relayoutTilesForce(); }
    };
    const ticks = [80, 180, 320, 600, 1000, 1600, 2200, 2800];
    ticks.forEach(ms=> setTimeout(arTick, ms));
  }catch(e){
    console.error('[camera] ensureCameraOn failed:', e);
    alert("Не удалось включить камеру: "+(e?.message||e));
  } finally {
    camBusy = false;
  }
}

async function trySwitchFacingOnSameTrack(newFacing){
  const pub = camPub();
  const lkTrack = pub?.track || ctx.localVideoTrack;
  const mst = lkTrack?.mediaStreamTrack;
  if (!mst || typeof mst.applyConstraints !== "function") return false;
  // Пытаемся мягко переключить даже на мобильных; фолбэк сделаем выше при ошибке

  try{
    const caps = mst.getCapabilities?.() || {};
    if (caps.facingMode && Array.isArray(caps.facingMode) && !caps.facingMode.includes(newFacing)){
      return false;
    }
    // Сохраняем текущие предпочтения AR/размера и пробуем exact → ideal
    const s = mst.getSettings?.() || {};
    const vEl = getLocalTileVideo();
    const wPref = (s.width|0) || (vEl?.videoWidth|0) || undefined;
    const hPref = (s.height|0) || (vEl?.videoHeight|0) || undefined;
    const arPref = (wPref && hPref) ? (wPref/hPref) : ((vEl?.videoWidth>0 && vEl?.videoHeight>0) ? (vEl.videoWidth/vEl.videoHeight) : undefined);
    try {
      await mst.applyConstraints({
        facingMode: { exact: newFacing },
        ...(wPref ? { width:  { exact: wPref } } : {}),
        ...(hPref ? { height: { exact: hPref } } : {}),
        ...(arPref? { aspectRatio: { exact: arPref } } : {})
      });
    }
    catch {
      await mst.applyConstraints({
        facingMode: newFacing,
        ...(wPref ? { width:  { ideal: wPref } } : {}),
        ...(hPref ? { height: { ideal: hPref } } : {}),
        ...(arPref? { aspectRatio: { ideal: arPref } } : {})
      });
    }

    const v2 = getLocalTileVideo();
    if (v2){
      const tile = v2.closest(".tile");
      setTimeout(()=> {
        const wv = v2.videoWidth, hv = v2.videoHeight;
        tile?.classList.toggle("portrait", hv>wv);
        applyCamTransformsToLive();
      }, 0);
    }
    state.settings.camFacing = newFacing;
    return true;
  }catch{ return false; }
}

export async function toggleCam(){
  if(!ctx.room || camBusy) return;
  camBusy = true;
  byId("btnCam")?.setAttribute("disabled","true");
  try{
    const lp = ctx.room.localParticipant;
    const targetOn = !isCamActuallyOn();
    // сохраняем желаемое состояние камеры, чтобы onEnded-автовосстановление не мешало
    try{ ctx.camDesiredOn = targetOn; }catch{}
    let pub = camPub();
    if (targetOn){
      // Включение
      if (!pub){
        try{
          if (typeof lp?.setCameraEnabled === "function"){
            await lp.setCameraEnabled(true, { videoCaptureDefaults: buildVideoDefaults() });
          } else {
            await ensureCameraOn(true);
          }
        }catch{}
        pub = camPub();
        // Если публикация не появилась — форсировано создаём и публикуем трек
        if (!pub){ await ensureCameraOn(true); pub = camPub(); }
      } else {
        if (typeof lp?.setCameraEnabled === "function"){ try{ await lp.setCameraEnabled(true); }catch{} }
        if (typeof pub.unmute === "function")      await pub.unmute();
        else if (typeof pub.setMuted === "function") await pub.setMuted(false);
        else if (pub.track?.setEnabled)              pub.track.setEnabled(true);
        try{ await tuneTrackToOrientation(pub.track || ctx.localVideoTrack, ctx.lastVideoPrefs||{}); }catch{}
      }
      // auto-mirror based on current facing
      try{ state.settings.camMirror = ((state.settings.camFacing||"user") === "user"); }catch{}
    } else {
      // Выключение
      // Сбросим любые незавершённые открытия/переключения камеры
      try{ camCreateNonce++; ctx._camSwitching = false; ctx.camDesiredOn = false; }catch{}
      let turnedOff = false;
      try{
        if (typeof lp?.setCameraEnabled === "function"){ await lp.setCameraEnabled(false); turnedOff = true; }
      }catch{}
      // Если LP-API не сработал — жёстко отписываем трек
      pub = camPub();
      if (!turnedOff){
        if (pub){
          try{
            const track = pub.track;
            if (track){
              try{ await ctx.room?.localParticipant?.unpublishTrack(track); }catch{}
              try{ track.stop?.(); }catch{}
            }
          }catch{}
          try{
            if (typeof pub.mute === "function")         await pub.mute();
            else if (typeof pub.setMuted === "function") await pub.setMuted(true);
            else if (pub.track?.setEnabled)              pub.track.setEnabled(false);
          }catch{}
        }
      }
      try{ ctx.localVideoTrack = null; }catch{}
      try{ ctx.lastVideoPrefs = null; }catch{}
      showAvatarInTile(lp.identity);
    }
    applyLayout();
  }catch(e){
    alert("Ошибка камеры: "+(e?.message||e));
  }finally{
    camBusy = false;
    byId("btnCam")?.removeAttribute("disabled");
    window.dispatchEvent(new Event("app:refresh-ui"));
  }
}
byId("btnCam")?.addEventListener("click", toggleCam);

/* ===== Переключение фронт/тыл ===== */
export async function toggleFacing(){
  if(!ctx.room || !isCamActuallyOn() || camBusy) return;
  // не ограничиваемся числом камер: многие мобильные отдают 1 device, но поддерживают facingMode
  camBusy = true;
  ctx._camSwitching = true;
  const myNonce = ++camCreateNonce; // защитимся от повторных кликов/гонок
  const btn = byId("btnFacing"); if (btn) btn.disabled = true;

  const prevFacing = state.settings.camFacing || "user";
  const nextFacing = prevFacing === "user" ? "environment" : "user";

  try{
    // Сохраняем текущие преференции (размер/AR), чтобы удержать 16:9 после переключения
    const prefs = captureCurrentVideoPrefs();

    // 1) мягкий путь — restartTrack, если есть
    if (ctx.localVideoTrack && typeof ctx.localVideoTrack.restartTrack === "function"){
      // freeze AR while switching
      try{
        const v0 = getLocalTileVideo();
        const tile0 = v0?.closest('.tile');
        if (v0 && tile0){
          const ar0 = (v0.videoWidth>0 && v0.videoHeight>0) ? (v0.videoWidth/v0.videoHeight) : (tile0.classList.contains('portrait')? (9/16):(16/9));
          tile0.dataset.freezeAr = String(ar0);
        }
      }catch{}
      // Минимально просим только смену facing без навязывания формата
      await ctx.localVideoTrack.restartTrack({ facingMode: nextFacing });
      // гарантируем, что паблиш не остался в mute
      try{ const p = camPub(); await (p?.setMuted?.(false) || p?.unmute?.()); }catch{}
      state.settings.camFacing = nextFacing;
      // auto-mirror based on facing
      try{ state.settings.camMirror = (nextFacing === "user"); }catch{}
      // переустановим защиты на новый MST (после restart он меняется под капотом)
      try{ if (ctx.localVideoTrack) installLocalVideoTrackGuards(ctx.localVideoTrack); }catch{}
      // дёрнем стабилизацию AR/раскладки как при замене трека
      setTimeout(()=> window.dispatchEvent(new Event('app:local-video-replaced')), 30);
      window.requestAnimationFrame(()=>{
        const v = getLocalTileVideo();
        if (v){
          const tile = v.closest(".tile");
          if (tile) tile.classList.toggle("portrait", v.videoHeight>v.videoWidth);
          applyCamTransformsToLive();
          const unfreeze = ()=>{ try{ delete tile.dataset.freezeAr; }catch{} };
          setTimeout(unfreeze, 300);
          setTimeout(unfreeze, 800);
          setTimeout(unfreeze, 1600);
        }
      });
    }
    // 2) (отключено) applyConstraints на исходном треке часто сбивает формат до 4:3 — пропускаем
    // 3) Фолбэк — новый трек
    else {
      state.settings.camFacing = nextFacing;
      state.settings.camDevice = ""; // дать браузеру выбрать

      const picked = await pickCameraDevice(nextFacing);
      // Базово выбираем устройство/фейсинг, добавляем AR на основе ориентации и предпочтительные размеры
      let constraints = {
        ...(picked ? { deviceId: { exact: picked } } : { facingMode: { ideal: nextFacing } }),
        frameRate: { ideal: 30, min: 15 }
      };
      // Если предыдущий локальный трек существует, попробуем подсказать target frame size близкую к нему
      try{
        const prev = ctx.localVideoTrack?.mediaStreamTrack;
        const s = prev?.getSettings?.()||{};
        if ((s.width|0)>0 && (s.height|0)>0){
          constraints = { ...constraints, width: { ideal: s.width }, height: { ideal: s.height } };
        }
      }catch{}
      // На мобильных сначала освободим текущую камеру, чтобы избежать ошибки доступа
      const shouldPreStop = isMobileUA();
      if (shouldPreStop){ try { ctx.localVideoTrack?.stop?.(); } catch {} }
      // Таймаут на создание трека, чтобы избежать зависания и повторов
      const createWithTimeout = (ms)=> Promise.race([
        createLocalVideoTrack(constraints),
        new Promise((_,rej)=> setTimeout(()=> rej(new Error('camera-create-timeout')), ms))
      ]);
      const newTrack = await createWithTimeout(3500);
      // если за это время начался другой свитч — закрываем трек и выходим
      if (myNonce !== camCreateNonce){ try{ newTrack.stop?.(); }catch{}; throw new Error('cam-switch-superseded'); }
      try{ if (newTrack?.mediaStreamTrack) newTrack.mediaStreamTrack.contentHint = 'motion'; }catch{}
      try{ if (newTrack?.mediaStreamTrack) newTrack.mediaStreamTrack.contentHint = 'motion'; }catch{}
      const meId = ctx.room.localParticipant.identity;
      const pub = camPub();

      attachVideoToTile(newTrack, meId, true);

      if (pub) {
        try{ await pub.replaceTrack(newTrack); }
        catch(e){ try{ await ctx.room.localParticipant.unpublishTrack(pub.track); }catch{}; await ctx.room.localParticipant.publishTrack(newTrack, { source: Track.Source.Camera }); }
        if (!shouldPreStop){ try { ctx.localVideoTrack?.stop(); } catch {} }
        try{ await (pub.setMuted?.(false) || pub.unmute?.()); }catch{}
      } else {
        await ctx.room.localParticipant.publishTrack(newTrack, { source: Track.Source.Camera });
      }

      ctx.localVideoTrack = newTrack;
      installLocalVideoTrackGuards(newTrack);
      applyCamTransformsToLive();
      setTimeout(()=> window.dispatchEvent(new Event('app:local-video-replaced')), 30);
      // форс-обновление AR локального видео после смены facing
      const arTick2 = ()=>{
        const v = getLocalTileVideo();
        if (!v) return;
        const tile = v.closest('.tile');
        if (tile){ setTileAspectFromVideo(tile, v); relayoutTilesForce(); }
      };
      const ticks2 = [80, 180, 320, 600, 1000, 1600, 2200, 2800];
      ticks2.forEach(ms=> setTimeout(arTick2, ms));
    }

    applyLayout();
  }catch(e){
    state.settings.camFacing = prevFacing;
    try{ state.settings.camMirror = (prevFacing === "user"); }catch{}
    console.error("[camera] switch failed:", e);
    alert("Не удалось переключить камеру: " + (e?.message||e));
  }finally{
    camBusy = false;
    if (btn) btn.disabled = false;
    setTimeout(()=>{ ctx._camSwitching = false; }, 400);
    window.dispatchEvent(new Event("app:refresh-ui"));
  }
}
byId("btnFacing")?.addEventListener("click", toggleFacing);

/* ===== SCREEN SHARE (desktop) ===== */
ctx.screenTracks = ctx.screenTracks || [];

export async function stopScreenShare(){
  try{
    for(const t of ctx.screenTracks){
      try{ await ctx.room?.localParticipant?.unpublishTrack(t); }catch{}
      try{ t.stop?.(); }catch{}
    }
  }catch{}
  ctx.screenTracks = [];
  state.me.share = false;
  if (ctx.room?.localParticipant) {
    showAvatarInTile(ctx.room.localParticipant.identity+"#screen");
  }
  applyLayout();
  window.dispatchEvent(new Event("app:refresh-ui"));
}

async function onShareClick(){
  if(!ctx.room) return;
  if (isMobileView()) return;

  try{
    if(state.me.share){ await stopScreenShare(); }
    else {
      const tracks = await createLocalScreenTracks({ audio:true });
      ctx.screenTracks = tracks;
      for(const t of tracks){ await ctx.room.localParticipant.publishTrack(t); }
      state.me.share = true;

      const vTrack = tracks.find(t=>t.kind==="video");
      if(vTrack){
        attachVideoToTile(
          vTrack,
          ctx.room.localParticipant.identity+"#screen",
          true,
          "Экран"
        );
      }
      applyLayout();
    }
  }catch(e){ alert("Ошибка шаринга экрана: "+(e?.message||e)); }
  window.dispatchEvent(new Event("app:refresh-ui"));
}
byId("btnShare")?.addEventListener("click", onShareClick);
