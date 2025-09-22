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

/* ===== Processed camera pipeline (mirror/zoom for everyone) ===== */
function ensureProcState(){ ctx.camProc = ctx.camProc || {}; return ctx.camProc; }

function createHiddenVideoFromTrack(track){
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.autoplay = true;
  try{ v.setAttribute('muted',''); v.setAttribute('playsinline',''); v.setAttribute('autoplay',''); }catch{}
  try{ v.srcObject = new MediaStream([track.mediaStreamTrack||track]); v.play?.(); }catch{}
  v.style.position='fixed'; v.style.left='-9999px'; v.style.top='-9999px'; v.style.width='1px'; v.style.height='1px'; v.style.opacity='0';
  document.body.appendChild(v);
  return v;
}

function startProcessedPublishFromSourceTrack(sourceTrack){
  const proc = ensureProcState();
  // cleanup previous
  try{ proc.stop?.(); }catch{}

  // canvas setup
  const srcMst = sourceTrack?.mediaStreamTrack || sourceTrack;
  const s = srcMst?.getSettings?.() || {};
  const baseW = (s.width|0) || 1280; const baseH = (s.height|0) || 720;
  const canvas = document.createElement('canvas');
  canvas.width = baseW; canvas.height = baseH;
  const g = canvas.getContext('2d', { alpha:false });
  const videoEl = createHiddenVideoFromTrack(srcMst);

  const outStream = canvas.captureStream?.(30) || canvas.captureStream?.() || null;
  const outTrack = outStream ? (outStream.getVideoTracks?.()[0] || null) : null;

  // state
  proc.active = true;
  proc.canvas = canvas; proc.ctx2d = g; proc.srcVideo = videoEl; proc.srcTrack = srcMst; proc.outTrack = outTrack;
  proc.zoom = Math.max(1, Number(proc.zoom)||1);
  proc.offsetX = Number.isFinite(proc.offsetX)? proc.offsetX : 0; // -1..1
  proc.offsetY = Number.isFinite(proc.offsetY)? proc.offsetY : 0;
  proc.mirror = !!state.settings.camMirror; // follow settings

  // draw loop
  let raf = 0;
  const draw = ()=>{
    try{
      const vw = videoEl.videoWidth|0, vh = videoEl.videoHeight|0;
      if (vw>0 && vh>0){
        const cw = canvas.width, ch = canvas.height;
        g.imageSmoothingEnabled = true;
        g.imageSmoothingQuality = 'high';
        g.fillStyle = '#000'; g.fillRect(0,0,cw,ch);
        g.save();
        // mirror around center if needed
        if (proc.mirror){ g.translate(cw, 0); g.scale(-1, 1); }
        // compute scaled source rect based on zoom and offsets (-1..1 in both axes)
        const baseScale = Math.min(cw / vw, ch / vh); // cover/contain baseline? choose cover for fixed area
        // We want to FILL canvas; start from cover scale then apply zoom
        const coverScale = Math.max(cw / vw, ch / vh);
        const scale = coverScale * Math.max(1, proc.zoom);
        const drawW = vw * scale; const drawH = vh * scale;
        const cx = (cw - drawW) / 2 + (proc.offsetX||0) * cw * 0.25; // allow pan up to 25% of canvas
        const cy = (ch - drawH) / 2 + (proc.offsetY||0) * ch * 0.25;
        g.drawImage(videoEl, 0, 0, vw, vh, Math.round(cx), Math.round(cy), Math.round(drawW), Math.round(drawH));
        g.restore();
      }
    }catch{}
    raf = requestAnimationFrame(draw);
  };
  draw();

  proc.stop = ()=>{
    try{ cancelAnimationFrame(raf); }catch{}
    try{ videoEl.pause?.(); }catch{}
    try{ videoEl.srcObject = null; }catch{}
    try{ videoEl.remove?.(); }catch{}
    try{ outTrack?.stop?.(); }catch{}
    proc.active = false;
  };

  // publish/replace
  (async()=>{
    try{
      const pub = camPub();
      const me = ctx.room?.localParticipant;
      if (pub){ await pub.replaceTrack(outTrack); }
      else if (me){ await me.publishTrack(outTrack, { source: Track.Source.Camera }); }
      // Attach processed to local tile for WYSIWYG
      try{ attachVideoToTile(outTrack, me.identity, true); }catch{}
    }catch(e){ console.warn('processed publish error', e); }
  })();

  return proc;
}

export function setProcessedCamMirror(on){ const p = ctx.camProc; if (p && p.active){ p.mirror = !!on; } }
export function setProcessedCamZoom(z){ const p = ctx.camProc; if (p && p.active){ p.zoom = Math.max(1, Math.min(6, Number(z)||1)); } }
export function nudgeProcessedCamOffset(dx, dy){ const p = ctx.camProc; if (p && p.active){ p.offsetX = Math.max(-1, Math.min(1, (p.offsetX||0) + dx)); p.offsetY = Math.max(-1, Math.min(1, (p.offsetY||0) + dy)); } }
export function setProcessedCamOffset(nx, ny){ const p = ctx.camProc; if (p && p.active){ p.offsetX = Math.max(-1, Math.min(1, Number(nx)||0)); p.offsetY = Math.max(-1, Math.min(1, Number(ny)||0)); } }

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
  if (camBusy && !force) return; // защита от повторного входа/зацикливания
  camBusy = true;
  const lp = ctx.room?.localParticipant;
  const devId = state.settings.camDevice || await pickCameraDevice(state.settings.camFacing||"user");

  // Предпочтительный набор констрейнтов: устройство/фейсинг + сохранённые префы AR/размера
  const base = devId
    ? { deviceId: { exact: devId } }
    : { facingMode: { ideal: state.settings.camFacing||"user" } };
  const last = (ctx.lastVideoPrefs||{});
  const arIdeal = (typeof last.aspectRatio === "number" && last.aspectRatio>0)
    ? last.aspectRatio
    : (16/9); // дефолтно просим 16:9, чтобы избежать 4:3
  const constraints = {
    ...base,
    aspectRatio: { ideal: arIdeal },
    ...(last.width  ? { width:  { ideal: last.width  } } : {}),
    ...(last.height ? { height: { ideal: last.height } } : {}),
  };
  const old = ctx.localVideoTrack || camPub()?.track || null;
  try{
    const newTrack = await createLocalVideoTrack(constraints);
    // auto-mirror based on facing as default
    try{ state.settings.camMirror = ((state.settings.camFacing||"user") === "user"); }catch{}
    // Start processed pipeline so mirrored/zoomed stream is published to everyone
    const proc = startProcessedPublishFromSourceTrack(newTrack);
    const pub = camPub();
    if (pub){ await (pub.setMuted?.(false) || pub.unmute?.()); }
    try { old?.stop?.(); } catch {}
    ctx.localVideoTrack = newTrack;
    // Зафиксировать 16:9/текущий AR для будущих рестартов
    try{
      const v = getLocalTileVideo();
      const w = v?.videoWidth|0, h = v?.videoHeight|0;
      const ar = (w>0 && h>0) ? (w/h) : (ctx.lastVideoPrefs?.aspectRatio || (16/9));
      ctx.lastVideoPrefs = { width: w||undefined, height: h||undefined, aspectRatio: ar };
    }catch{}
    // Local tile shows processed output via startProcessedPublishFromSourceTrack
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
    let pub = camPub();
    if (targetOn){
      // Включение
      if (!pub){
        try{
          if (typeof lp?.setCameraEnabled === "function"){
            await lp.setCameraEnabled(true, { videoCaptureDefaults:{ deviceId: (state.settings.camDevice||undefined) } });
          } else {
            await ensureCameraOn(true);
          }
        }catch{}
        pub = camPub();
      } else {
        if (typeof lp?.setCameraEnabled === "function"){ try{ await lp.setCameraEnabled(true); }catch{} }
        if (typeof pub.unmute === "function")      await pub.unmute();
        else if (typeof pub.setMuted === "function") await pub.setMuted(false);
        else if (pub.track?.setEnabled)              pub.track.setEnabled(true);
        // if we already have a raw track published (from previous), start processed pipeline from it
        try{
          const current = camPub();
          const base = current?.track || ctx.localVideoTrack;
          if (base){ startProcessedPublishFromSourceTrack(base); }
        }catch{}
      }
      // auto-mirror based on current facing
      try{ state.settings.camMirror = ((state.settings.camFacing||"user") === "user"); }catch{}
    } else {
      // Выключение
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
      // как в тесте — минимум констрейнтов при рестарте
      await ctx.localVideoTrack.restartTrack({ facingMode: nextFacing });
      // гарантируем, что паблиш не остался в mute
      try{ const p = camPub(); await (p?.setMuted?.(false) || p?.unmute?.()); }catch{}
      state.settings.camFacing = nextFacing;
      // auto-mirror based on facing
      try{ state.settings.camMirror = (nextFacing === "user"); }catch{}
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
      // Минимальные констрейнты, как в тесте: только deviceId или facingMode
      const constraints = picked ? { deviceId: { exact: picked } }
                                 : { facingMode: { ideal: nextFacing } };
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
