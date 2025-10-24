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
  dedupeTilesByPid,
  cleanupOrphanDom,
  removeTileByPid,
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
  // Надёжная проверка: публикация + живой медиатрек + не muted
  const pub = camPub();
  const track = pub?.track;
  if (!pub || !track) return false;
  const mst = track.mediaStreamTrack;
  const live = !!mst && mst.readyState === "live";
  const enabled = (track.isEnabled !== false);
  return pub.isMuted === false && enabled && live;
}
let camBusy = false;

const CAMERA_RELEASE_DELAY_MS = 160;
const LOCAL_VIDEO_STABILIZE_TICKS = [80, 180, 320, 600, 1000, 1600, 2200, 2800];
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isVideoTrackLive = (track) => {
  const mst = track?.mediaStreamTrack;
  return !!mst && mst.readyState === "live";
};

let cameraOp = null;
async function runExclusiveCameraOp(fn){
  if (cameraOp){
    try { await cameraOp; } catch {}
  }
  cameraOp = (async ()=>{ try { return await fn(); } finally { cameraOp = null; } })();
  return cameraOp;
}

function localParticipantId(){
  return ctx.room?.localParticipant?.identity || "";
}

export function preferredCamConstraints({ facingOverride, deviceOverride, includeLastPrefs = true } = {}){
  const facing = facingOverride || state.settings.camFacing || "user";
  let deviceId;
  if (deviceOverride !== undefined){
    deviceId = deviceOverride || "";
  } else {
    deviceId = state.settings.camDevice || "";
  }
  const base = deviceId
    ? { deviceId: { exact: deviceId } }
    : { facingMode: { ideal: facing } };

  if (!includeLastPrefs) return base;

  const last = ctx.lastVideoPrefs || {};
  const arIdeal = (typeof last.aspectRatio === "number" && last.aspectRatio > 0)
    ? last.aspectRatio
    : 16/9;

  return {
    ...base,
    aspectRatio: { ideal: arIdeal },
    ...(last.width  ? { width:  { ideal: last.width  } } : {}),
    ...(last.height ? { height: { ideal: last.height } } : {}),
  };
}

export function getCameraUiStatus(){
  const pub = camPub();
  const track = pub?.track || ctx.localVideoTrack || null;
  const live = !!track && isVideoTrackLive(track);
  const enabled = !!track && (track.isEnabled !== false);
  const mutedProp = pub?.isMuted;
  const isMuted = (mutedProp === true); // только true означает muted, иначе считаем не muted
  const isOn = (!!track && live && enabled && !isMuted) || (!!track && live && enabled && mutedProp === undefined);
  const hasPublication = !!pub;
  const isSwitching = !!ctx._camSwitching;
  return { isOn, hasPublication, live, isMuted, isSwitching };
}

export async function releaseLocalCamera({ showAvatar = true, unpublish = false, track: trackOverride } = {}){
  const pub = camPub();
  const track = trackOverride || pub?.track || ctx.localVideoTrack;
  const meId = localParticipantId();

  if (!track) return null;

  if (showAvatar && meId){
    try { showAvatarInTile(meId); } catch {}
  }

  if (pub && !trackOverride){
    try { await (pub.setMuted?.(true) || pub.mute?.()); } catch {}
    if (unpublish){
      try { await ctx.room?.localParticipant?.unpublishTrack(pub.track); } catch {}
    }
  } else if (trackOverride && unpublish){
    try { await ctx.room?.localParticipant?.unpublishTrack(trackOverride); } catch {}
  }

  if (track && isVideoTrackLive(track)){
    try { track.stop?.(); } catch {}
    try { track.mediaStreamTrack?.stop?.(); } catch {}
  }

  if (!trackOverride){
    ctx.localVideoTrack = null;
  }

  if (meId && !trackOverride){
    try { applyLayout(); } catch {}
  }

  // Сразу обновим UI (снимет "активность" кнопки камеры)
  try { window.dispatchEvent(new Event('app:refresh-ui')); } catch {}
  await wait(CAMERA_RELEASE_DELAY_MS);
  try { window.dispatchEvent(new Event('app:refresh-ui')); } catch {}
  return pub;
}

function captureVideoPrefsFromTrack(track){
  try{
    const mst = track?.mediaStreamTrack;
    const settings = mst?.getSettings?.() || {};
    const v = getLocalTileVideo();
    const width = (settings.width|0) || (v?.videoWidth|0) || 0;
    const height = (settings.height|0) || (v?.videoHeight|0) || 0;
    const aspect = (width>0 && height>0) ? (width/height)
      : (v && v.videoWidth>0 && v.videoHeight>0 ? (v.videoWidth/v.videoHeight) : undefined);
    ctx.lastVideoPrefs = {
      width: width || undefined,
      height: height || undefined,
      aspectRatio: aspect || ctx.lastVideoPrefs?.aspectRatio || undefined,
    };
  }catch{}
}

export function finalizeLocalCameraTrack(track, { facing } = {}){
  const meId = localParticipantId();
  ctx.localVideoTrack = track;

  if (facing) {
    try { state.settings.camFacing = facing; } catch {}
  }
  const facingMode = state.settings.camFacing || "user";
  try { state.settings.camMirror = (facingMode === "user"); } catch {}

  if (meId){
    attachVideoToTile(track, meId, true);
  }

  window.requestAnimationFrame(()=>{
    applyCamTransformsToLive();
    captureVideoPrefsFromTrack(track);
    try { window.dispatchEvent(new Event('app:refresh-ui')); } catch {}
  });

  setTimeout(()=> window.dispatchEvent(new Event('app:local-video-replaced')), 30);

  const arTick = ()=>{
    const v = getLocalTileVideo(); if (!v) return;
    const tile = v.closest('.tile');
    if (tile){
      setTileAspectFromVideo(tile, v);
      relayoutTilesForce();
    }
  };
  LOCAL_VIDEO_STABILIZE_TICKS.forEach(ms=> setTimeout(arTick, ms));
}

export async function createAndPublishCameraTrack(constraints, { facing, showAvatarOnRelease = true } = {}){
  const pub0 = camPub();
  const oldTrack = pub0?.track || ctx.localVideoTrack || null;

  const needPreRelease = isMobileView();
  if (needPreRelease && oldTrack){
    await releaseLocalCamera({ showAvatar: showAvatarOnRelease, unpublish: true });
  }

  const newTrack = await createLocalVideoTrack(constraints);

  let pub = camPub();
  if (pub && !needPreRelease){
    await pub.replaceTrack(newTrack);
    await (pub.setMuted?.(false) || pub.unmute?.());
  } else {
    const lp = ctx.room?.localParticipant;
    if (lp){
      await lp.publishTrack(newTrack, { source: Track.Source.Camera });
      pub = camPub();
      try { await (pub?.setMuted?.(false) || pub?.unmute?.()); } catch {}
    }
  }

  finalizeLocalCameraTrack(newTrack, { facing });

  if (!needPreRelease){ try { if (oldTrack && oldTrack !== newTrack) oldTrack.stop?.(); } catch {} }

  try { window.dispatchEvent(new Event('app:refresh-ui')); } catch {}
  return newTrack;
}

export async function replaceCameraTrack(constraints, options = {}){
  return createAndPublishCameraTrack(constraints, options);
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
    const ar0 = (w0>0 && h0>0) ? (w0/h0) : (v0 && v0.videoWidth>0 && v0.videoHeight>0 ? (v0.videoWidth/v0.videoHeight) : undefined);
    const prefs = { width: w0||undefined, height: h0||undefined, aspectRatio: ar0||undefined };
    try{ ctx.lastVideoPrefs = prefs; }catch{}
    return prefs;
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
  if (camBusy && !force) return;
  camBusy = true;
  try{
    await runExclusiveCameraOp(async()=>{
      const facing = state.settings.camFacing || "user";
      const deviceId = state.settings.camDevice || await pickCameraDevice(facing);
      const constraints = preferredCamConstraints({
        facingOverride: facing,
        deviceOverride: deviceId,
      });

      const existingPub = camPub();
      if (existingPub?.track && isVideoTrackLive(existingPub.track)){
        try { await (existingPub.setMuted?.(false) || existingPub.unmute?.()); } catch {}
        finalizeLocalCameraTrack(existingPub.track, { facing });
      } else {
        await createAndPublishCameraTrack(constraints, {
          facing,
          showAvatarOnRelease: false,
        });
      }

      try{ captureVideoPrefsFromTrack(ctx.localVideoTrack); }catch{}
    });
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
    await runExclusiveCameraOp(async()=>{
      const lp = ctx.room.localParticipant;
      const cam = getCameraUiStatus();
      const targetOn = !cam.isOn;
      let pub = camPub();

      if (targetOn){
        const facing = state.settings.camFacing || "user";
        const deviceId = state.settings.camDevice || await pickCameraDevice(facing);
        const constraints = preferredCamConstraints({ facingOverride: facing, deviceOverride: deviceId });

        if (!pub?.track || !isVideoTrackLive(pub.track)){
          await createAndPublishCameraTrack(constraints, { facing, showAvatarOnRelease: false });
          pub = camPub();
        } else {
          try { await (pub.setMuted?.(false) || pub.unmute?.()); } catch {}
          finalizeLocalCameraTrack(pub.track, { facing });
        }

        try{ state.settings.camMirror = ((state.settings.camFacing||"user") === "user"); }catch{}
      } else {
        if (pub?.track){
          await releaseLocalCamera({ showAvatar: true, unpublish: true });
        } else if (ctx.localVideoTrack){
          await releaseLocalCamera({ showAvatar: true, unpublish: false });
        }
        try{ ctx.localVideoTrack = null; }catch{}
        showAvatarInTile(lp.identity);
      }
      applyLayout();
      try { window.dispatchEvent(new Event('app:refresh-ui')); } catch {}
    });
  }catch(e){
    alert("Ошибка камеры: "+(e?.message||e));
  }finally{
    camBusy = false;
    byId("btnCam")?.removeAttribute("disabled");
    try { window.dispatchEvent(new Event('app:refresh-ui')); } catch {}
  }
}
byId("btnCam")?.addEventListener("click", toggleCam);

/* ===== Переключение фронт/тыл ===== */
export async function toggleFacing(){
  if(!ctx.room || camBusy) return;
  const cam = getCameraUiStatus();
  camBusy = true;
  ctx._camSwitching = true;
  const btn = byId("btnFacing"); if (btn) btn.disabled = true;

  const prevFacing = state.settings.camFacing || "user";
  const nextFacing = prevFacing === "user" ? "environment" : "user";

  try{
    await runExclusiveCameraOp(async()=>{
      // если камеры нет вовсе — включаем и выходим (следующее нажатие выполнит разворот)
      const pub = camPub();
      const hasTrackNow = !!(pub?.track || ctx.localVideoTrack);
      if (!hasTrackNow){ await ensureCameraOn(true); return; }

      let restarted = false;
      // На мобильных — пересоздание, на десктопе пробуем restartTrack → иначе пересоздание
      if (!isMobileView() && ctx.localVideoTrack && typeof ctx.localVideoTrack.restartTrack === "function"){
        try{
          const v0 = getLocalTileVideo();
          const tile0 = v0?.closest('.tile');
          if (v0 && tile0){
            const ar0 = (v0.videoWidth>0 && v0.videoHeight>0) ? (v0.videoWidth/v0.videoHeight) : (tile0.classList.contains('portrait')? (9/16):(16/9));
            tile0.dataset.freezeAr = String(ar0);
          }
        }catch{}
        try{
          const base = { facingMode: nextFacing };
          await ctx.localVideoTrack.restartTrack(base);
          restarted = true;
        }catch{}
        if (restarted){
          try{ const p = camPub(); await (p?.setMuted?.(false) || p?.unmute?.()); }catch{}
          state.settings.camFacing = nextFacing;
          try{ state.settings.camMirror = (nextFacing === "user"); }catch{}
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
          captureVideoPrefsFromTrack(ctx.localVideoTrack);
        }
      }
      if (!restarted){
        state.settings.camFacing = nextFacing;
        state.settings.camDevice = "";
        const picked = await pickCameraDevice(nextFacing);
        const constraints = preferredCamConstraints({
          facingOverride: nextFacing,
          deviceOverride: picked,
          includeLastPrefs: false,
        });

        await createAndPublishCameraTrack(constraints, {
          facing: nextFacing,
          showAvatarOnRelease: true,
        });
      }

      applyLayout();
      try { window.dispatchEvent(new Event('app:refresh-ui')); } catch {}
    });
  }catch(e){
    state.settings.camFacing = prevFacing;
    try{ state.settings.camMirror = (prevFacing === "user"); }catch{}
    console.error("[camera] switch failed:", e);
    alert("Не удалось переключить камеру: " + (e?.message||e));
  }finally{
    camBusy = false;
    if (btn) btn.disabled = false;
    setTimeout(()=>{ ctx._camSwitching = false; }, 400);
    try { window.dispatchEvent(new Event('app:refresh-ui')); } catch {}
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
  try{
    const localId = ctx.room?.localParticipant?.identity;
    if (localId){
      // локально очищаем содержимое, но сам тайл может оставаться у других — удаление не форсим
      showAvatarInTile(localId+"#screen");
    }
  }catch{}
  // подчистим DOM и разложим заново
  try{ dedupeTilesByPid(); cleanupOrphanDom(); }catch{}
  applyLayout();
  // если камера была включена до начала шаринга — гарантируем её восстановление
  try{
    if (state.me._camWasOnBeforeShare){
      if (!isCamActuallyOn()) await ensureCameraOn(true);
      // переаттачим текущий локальный видеотрек в плитку
      const vtrack = (camPub()?.track) || ctx.localVideoTrack;
      const meId = ctx.room?.localParticipant?.identity;
      if (vtrack && meId){ attachVideoToTile(vtrack, meId, true); }
    }
  }catch{}
  try{ delete state.me._camWasOnBeforeShare; }catch{}
  window.dispatchEvent(new Event("app:refresh-ui"));
}

async function onShareClick(){
  if(!ctx.room) return;
  if (isMobileView()) return;

  try{
    if(state.me.share){ await stopScreenShare(); }
    else {
      // запомним состояние камеры до старта шаринга, чтобы восстановить после
      try { state.me._camWasOnBeforeShare = isCamActuallyOn(); } catch {}
      const tracks = await createLocalScreenTracks({ audio:true });
      ctx.screenTracks = tracks;
      for(const t of tracks){
        try{ if (t?.mediaStreamTrack && 'contentHint' in t.mediaStreamTrack) t.mediaStreamTrack.contentHint = 'detail'; }catch{}
        const opts = (t.kind === 'video')
          ? { source: Track.Source.ScreenShare }
          : { source: Track.Source.ScreenShareAudio };
        await ctx.room.localParticipant.publishTrack(t, opts);
      }
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
