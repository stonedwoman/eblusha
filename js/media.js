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
  }catch(e){ alert("Не удалось включить микрофон: "+(e?.message||e)); }
}

export async function toggleMic(){
  if(!ctx.room || micBusy) return;
  micBusy = true;
  byId("btnMic")?.setAttribute("disabled","true");
  try{
    const lp  = ctx.room.localParticipant;
    const targetOn = !isMicActuallyOn();
    await lp.setMicrophoneEnabled(targetOn, {
      audioCaptureDefaults:{
        echoCancellation:state.settings.ec,
        noiseSuppression:state.settings.ns,
        autoGainControl:state.settings.agc,
        deviceId: state.settings.micDevice||undefined
      }
    });
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
  const lp = ctx.room?.localParticipant;
  if (lp && typeof lp.isCameraEnabled === "boolean") return lp.isCameraEnabled;
  if (lp && typeof lp.isCameraEnabled === "function") { try { return !!lp.isCameraEnabled(); } catch {} }
  const pub = camPub();
  if (!pub) return false;
  const trackEnabled = (pub.track?.isEnabled !== false);
  return pub.isMuted === false && trackEnabled;
}
let camBusy = false;

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
    const ar0 = (w0>0 && h0>0) ? (w0/h0) : (v0 && v0.videoWidth>0 && v0.videoHeight>0 ? (v0.videoWidth/v0.videoHeight) : undefined);
    return { width: w0||undefined, height: h0||undefined, aspectRatio: ar0||undefined };
  }catch{ return { width: undefined, height: undefined, aspectRatio: undefined }; }
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
  if (camBusy && !force) return; // защита от повторного входа/зацикливания
  camBusy = true;
  const lp = ctx.room?.localParticipant;
  const devId = state.settings.camDevice || await pickCameraDevice(state.settings.camFacing||"user");
  try{
    await lp.setCameraEnabled(true, {
      videoCaptureDefaults: { deviceId: devId || undefined }
    });
    const pub = camPub();
    ctx.localVideoTrack = pub?.track || ctx.localVideoTrack;
    if (pub?.track) attachVideoToTile(pub.track, ctx.room.localParticipant.identity, true);
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
    if (targetOn){
      const devId = state.settings.camDevice || await pickCameraDevice(state.settings.camFacing||"user");
      await lp.setCameraEnabled(true, { videoCaptureDefaults: { deviceId: devId || undefined } });
      // подстрахуемся: иногда публикация остаётся muted после enable
      try{ const pub = camPub(); await (pub?.setMuted?.(false) || pub?.unmute?.()); pub?.track?.setEnabled?.(true); }catch{}
      try{ const pub = camPub(); if (pub?.track) attachVideoToTile(pub.track, lp.identity, true); }catch{}
    } else {
      await lp.setCameraEnabled(false);
      // iOS Chrome совместимость: явно замьютить и отключить track
      try{ const pub = camPub(); await (pub?.setMuted?.(true) || pub?.mute?.()); pub?.track?.setEnabled?.(false); }catch{}
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
  const btn = byId("btnFacing"); if (btn) btn.disabled = true;

  const prevFacing = state.settings.camFacing || "user";
  const nextFacing = prevFacing === "user" ? "environment" : "user";

  try{
    // Только мягкий путь — restartTrack, без фолбэков
    if (!(ctx.localVideoTrack && typeof ctx.localVideoTrack.restartTrack === "function")){
      throw new Error("restartTrack недоступен для текущего локального видео-трека");
    }
    // freeze AR while switching
    try{
      const v0 = getLocalTileVideo();
      const tile0 = v0?.closest('.tile');
      if (v0 && tile0){
        const ar0 = (v0.videoWidth>0 && v0.videoHeight>0) ? (v0.videoWidth/v0.videoHeight) : (tile0.classList.contains('portrait')? (9/16):(16/9));
        tile0.dataset.freezeAr = String(ar0);
      }
    }catch{}
    // передаём предпочтительные размеры/AR, чтобы избежать отката в 4:3
    const prefs = captureCurrentVideoPrefs();
    const picked = await pickCameraDevice(nextFacing);
    const buildOpts = (mode)=>{
      const o = { facingMode: mode };
      if (picked) o.deviceId = { exact: picked };
      if (prefs?.width)       o.width       = { exact: prefs.width };
      if (prefs?.height)      o.height      = { exact: prefs.height };
      if (prefs?.aspectRatio) o.aspectRatio = { exact: prefs.aspectRatio };
      return o;
    };
    // Пытаемся строго сохранить параметры; если не получится — ослабим до ideal
    try{
      await ctx.localVideoTrack.restartTrack(buildOpts(nextFacing));
    }catch{
      const o = { facingMode: nextFacing };
      if (picked) o.deviceId = { exact: picked };
      if (prefs?.width)       o.width       = { ideal: prefs.width };
      if (prefs?.height)      o.height      = { ideal: prefs.height };
      if (prefs?.aspectRatio) o.aspectRatio = { ideal: prefs.aspectRatio };
      await ctx.localVideoTrack.restartTrack(o);
    }
    try{ const p = camPub(); await (p?.setMuted?.(false) || p?.unmute?.()); }catch{}
    state.settings.camFacing = nextFacing;
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
    applyLayout();
  }catch(e){
    state.settings.camFacing = prevFacing;
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
