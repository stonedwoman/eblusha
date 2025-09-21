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

export async function ensureCameraOn(){
  if (!ctx.room) return;
  if (camBusy) return; // защита от повторного входа/зацикливания
  camBusy = true;
  const lp = ctx.room?.localParticipant;
  const devId = state.settings.camDevice || await pickCameraDevice(state.settings.camFacing||"user");

  // Fallback: manual track creation with minimal constraints
  const constraints = devId ? { deviceId:{ exact: devId } } : {};
  const old = ctx.localVideoTrack || camPub()?.track || null;
  const newTrack = await createLocalVideoTrack(constraints);
  const pub = camPub();
  if (pub){
    await pub.replaceTrack(newTrack);
    await (pub.setMuted?.(false) || pub.unmute?.());
  } else {
    await ctx.room.localParticipant.publishTrack(newTrack, { source: Track.Source.Camera });
  }
  try { old?.stop?.(); } catch {}
  ctx.localVideoTrack = newTrack;
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
  camBusy = false;
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
    let pub = camPub();
    if (!pub){
      if (targetOn){
        try{ await ensureCameraOn(); }catch{}
        pub = camPub();
      }
    } else {
      if (targetOn){
        if (typeof pub.unmute === "function")      await pub.unmute();
        else if (typeof pub.setMuted === "function") await pub.setMuted(false);
        else if (pub.track?.setEnabled)              pub.track.setEnabled(true);
      } else {
        if (typeof pub.mute === "function")         await pub.mute();
        else if (typeof pub.setMuted === "function") await pub.setMuted(true);
        else if (pub.track?.setEnabled)              pub.track.setEnabled(false);
        showAvatarInTile(lp.identity);
      }
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
      const prefs = captureCurrentVideoPrefs();
      const base = { facingMode: nextFacing };
      const withPrefsMobileExact = { ...base, ...(prefs.aspectRatio ? { aspectRatio: { exact: prefs.aspectRatio } } : {}) };
      const withPrefsMobileIdeal = { ...base, ...(prefs.aspectRatio ? { aspectRatio: { ideal: prefs.aspectRatio } } : {}) };
      const withPrefsDesktop     = { ...base,
        ...(prefs.width  ? { width:  { ideal: prefs.width  } } : {}),
        ...(prefs.height ? { height: { ideal: prefs.height } } : {}),
        ...(prefs.aspectRatio ? { aspectRatio: { ideal: prefs.aspectRatio } } : {}) };
      if (isMobileUA()){
        try{ await ctx.localVideoTrack.restartTrack(withPrefsMobileExact); }
        catch{ await ctx.localVideoTrack.restartTrack(withPrefsMobileIdeal); }
      } else {
        await ctx.localVideoTrack.restartTrack(withPrefsDesktop);
      }
      // гарантируем, что паблиш не остался в mute
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
    }
    // 2) applyConstraints
    else if (await trySwitchFacingOnSameTrack(nextFacing)){
      // ok
      setTimeout(()=> window.dispatchEvent(new Event('app:local-video-replaced')), 30);
    }
    // 3) Фолбэк — новый трек
    else {
      state.settings.camFacing = nextFacing;
      state.settings.camDevice = ""; // дать браузеру выбрать

      const picked = await pickCameraDevice(nextFacing);
      // На мобильных задаём только aspectRatio (ideal), чтобы удержать формат без риска циклов; на десктопе — также width/height.
      const pr = captureCurrentVideoPrefs();
      const baseConsMobile = {
        ...(pr.aspectRatio ? { aspectRatio: { ideal: pr.aspectRatio } } : {})
      };
      const baseConsDesktop = {
        ...(pr.width  ? { width:  { ideal: pr.width  } } : {}),
        ...(pr.height ? { height: { ideal: pr.height } } : {}),
        ...(pr.aspectRatio ? { aspectRatio: { ideal: pr.aspectRatio } } : {})
      };
      const baseCons = isMobileUA() ? baseConsMobile : baseConsDesktop;
      const constraints = picked ? { deviceId: { exact: picked }, ...baseCons }
                                 : { facingMode: { ideal: nextFacing }, ...baseCons };
      const newTrack = await createLocalVideoTrack(constraints);
      const meId = ctx.room.localParticipant.identity;
      const pub = camPub();

      attachVideoToTile(newTrack, meId, true);

      if (pub) {
        await pub.replaceTrack(newTrack);
        try { ctx.localVideoTrack?.stop(); } catch {}
        try{ await (pub.setMuted?.(false) || pub.unmute?.()); }catch{}
      } else {
        await ctx.room.localParticipant.publishTrack(newTrack, { source: Track.Source.Camera });
      }

      ctx.localVideoTrack = newTrack;
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
