import { ctx, state } from "./state.js";
import { byId, isMobileView } from "./utils.js";
import { fitSpotlightSize, applyLayout, updateMobileScrollbar } from "./layout.js";
import { applyCamTransformsToLive } from "./tiles.js";
import { setShareButtonMode, refreshControls } from "./controls.js";
import {
  micPub, camPub, isCamActuallyOn, desiredAspectRatio,
} from "./media.js";
import {
  createLocalAudioTrack,
  createLocalVideoTrack,
} from "./vendor/livekit-loader.js";

/* ===== Фулскрин сцены ===== */
const stageEl = byId("stage");
const btnFS   = byId("btnStageFS");
const btnClose= byId("btnStageClose");

export async function toggleStageFullscreen(on){
  if(on==null) on=!ctx.isStageFull;
  if(on){ await enterStageOverlay(); } else { await exitStageOverlay(); }
  fitSpotlightSize();
}
export async function enterStageOverlay(){
  if(ctx.isStageFull) return; ctx.isStageFull=true;
  document.body.classList.add("no-scroll");
  stageEl.classList.add("stage-full");
  if (btnClose) btnClose.hidden=false;
  try{
    if(stageEl.requestFullscreen){ await stageEl.requestFullscreen({ navigationUI:"hide" }); }
    else if(stageEl.webkitRequestFullscreen){ stageEl.webkitRequestFullscreen(); }
  }catch{}
  try{ await screen.orientation.lock("landscape"); }catch{}
  applyLayout();
}
export async function exitStageOverlay(){
  if(!ctx.isStageFull) return; ctx.isStageFull=false;
  document.body.classList.remove("no-scroll");
  stageEl.classList.remove("stage-full");
  if (btnClose) btnClose.hidden=true;
  try{
    if(document.fullscreenElement){ await document.exitFullscreen(); }
    else if(document.webkitFullscreenElement){ document.webkitCancelFullScreen(); }
  }catch{}
  try{ if(screen.orientation.unlock) screen.orientation.unlock(); }catch{}
  applyLayout();
}

btnFS?.addEventListener("click", ()=> toggleStageFullscreen(true));
btnClose?.addEventListener("click", ()=> toggleStageFullscreen(false));
document.addEventListener("keydown", (e)=>{ if(e.key==="Escape" && ctx.isStageFull){ toggleStageFullscreen(false); }});
document.addEventListener("fullscreenchange", ()=>{ if(!document.fullscreenElement && ctx.isStageFull){ exitStageOverlay(); }});

/* ===== Настройки + предпросмотр ===== */
const settingsModal = byId("settingsModal");
const btnSettings   = byId("btnSettings");
const btnSettingsClose = byId("settingsClose");
const backdrop = byId("settingsBackdrop");

let previewTrack = null;

export function openSettings(){
  settingsModal.classList.add("open");
  settingsModal.setAttribute("aria-hidden","false");
  fillDeviceSelects();
  startCamPreview();
}
export function closeSettings(){
  stopCamPreview();
  settingsModal.classList.remove("open");
  settingsModal.setAttribute("aria-hidden","true");
}
btnSettings?.addEventListener("click", openSettings);
btnSettingsClose?.addEventListener("click", closeSettings);
backdrop?.addEventListener("click", closeSettings);

byId("settingsSave")?.addEventListener("click", ()=>{ applySettingsFromModal(true); });
byId("settingsApply")?.addEventListener("click", ()=>{ applySettingsFromModal(false); });

export async function fillDeviceSelects(){
  try{
    const devs=await navigator.mediaDevices.enumerateDevices();
    const mics=devs.filter(d=>d.kind==="audioinput");
    const cams=devs.filter(d=>d.kind==="videoinput");
    const micSel=byId("micSel"), camSel=byId("camSel");
    const fill=(sel,items,cur)=>{
      sel.innerHTML="";
      sel.appendChild(new Option("По умолчанию",""));
      items.forEach((d,i)=> sel.appendChild(new Option(d.label||`${d.kind} ${i+1}`, d.deviceId)));
      if(cur) sel.value=cur;
    };
    fill(micSel,mics,state.settings.micDevice);
    fill(camSel,cams,state.settings.camDevice);
    byId("nsChk").checked=state.settings.ns;
    byId("ecChk").checked=state.settings.ec;
    byId("agcChk").checked=state.settings.agc;
  }catch(e){ console.warn("enumerateDevices error",e); }
}

export async function applySettingsFromModal(closeAfter){
  state.settings.micDevice=byId("micSel").value;
  state.settings.camDevice=byId("camSel").value;
  state.settings.ns=byId("nsChk").checked;
  state.settings.ec=byId("ecChk").checked;
  state.settings.agc=byId("agcChk").checked;

  try{
    const mp = micPub();
    if (mp){
      const newMic = await createLocalAudioTrack({
        echoCancellation:state.settings.ec,
        noiseSuppression:state.settings.ns,
        autoGainControl:state.settings.agc,
        deviceId: state.settings.micDevice||undefined
      });
      const oldA = ctx.localAudioTrack || mp.track;
      await mp.replaceTrack(newMic);
      await (mp.setMuted?.(false) || mp.unmute?.());
      try{ oldA?.stop?.(); }catch{}
      ctx.localAudioTrack=newMic;
    }
  }catch(e){ console.warn("mic replace error", e); }

  try{
    const cp = camPub();
    if (cp && isCamActuallyOn()){
      const devId = state.settings.camDevice || null;
      const prefs = (ctx.lastVideoPrefs||{});
      const arIdeal = (typeof prefs.aspectRatio === 'number' && prefs.aspectRatio>0) ? prefs.aspectRatio : desiredAspectRatio();
      const constraints = {
        ...(devId ? { deviceId:{ exact: devId } } : { facingMode: { ideal: state.settings.camFacing||"user" } }),
        aspectRatio: { ideal: arIdeal },
        frameRate: { ideal: 30, min: 15 },
        ...(prefs.width  ? { width:  { ideal: prefs.width  } } : {}),
        ...(prefs.height ? { height: { ideal: prefs.height } } : {}),
      };
      const oldV = ctx.localVideoTrack || cp.track;
      // На мобильных устройство часто блокируется, если открыть новую камеру до остановки старой
      const ua = navigator.userAgent||navigator.vendor||"";
      const isMobile = /Android|iPhone|iPad|iPod|Mobile|Silk/i.test(ua);
      if (isMobile){ try{ oldV?.stop?.(); }catch{} }
      const newCam = await createLocalVideoTrack(constraints);
      try{ if (newCam?.mediaStreamTrack) newCam.mediaStreamTrack.contentHint = 'motion'; }catch{}
      try{ await (async()=>{
        const { desiredAspectRatio } = await import('./media.js');
        // на случай отличия ориентации — добьёмся нужного AR
        const ar = desiredAspectRatio();
        try{ await newCam.mediaStreamTrack.applyConstraints({ aspectRatio: { ideal: ar } }); }catch{}
      })(); }catch{}
      await cp.replaceTrack(newCam);
      await (cp.setMuted?.(false) || cp.unmute?.());
      if (!isMobile){ try{ oldV?.stop?.(); }catch{} }
      ctx.localVideoTrack=newCam;
      // локальная плитка
      applyCamTransformsToLive();
      applyLayout();
      // Старт стабильной перераскладки, чтобы формат соответствовал реальному потоку
      setTimeout(()=> window.dispatchEvent(new Event('app:local-video-replaced')), 30);
    }
  }catch(e){ console.warn("cam replace error", e); }

  applyPreviewTransforms();
  refreshControls();
  if (closeAfter) closeSettings();
}

export async function startCamPreview(){
  stopCamPreview();
  try{
    // на мобиле — не открываем 2-й поток, если основная камера уже включена
    if (isMobileView() && isCamActuallyOn()){
      byId("camHint").textContent="Камера уже используется — предпросмотр отключён на мобиле";
      byId("camHint").style.display="block";
      return;
    }
    const opts={}; if(state.settings.camDevice) opts.deviceId={ exact: state.settings.camDevice };
    previewTrack=await createLocalVideoTrack(opts);
    const v=previewTrack.attach();
    const wrap=byId("camPreview");
    wrap.querySelector("video")?.remove();
    byId("camHint").style.display="none";
    wrap.appendChild(v);
    applyPreviewTransforms();
  }catch(e){
    byId("camHint").textContent="Не удалось открыть камеру: "+(e?.message||e);
    byId("camHint").style.display="block";
    console.warn("preview error",e);
  }
}
export function stopCamPreview(){
  try{
    if(previewTrack){ previewTrack.attach()?.remove(); previewTrack.stop(); previewTrack=null; }
    byId("camHint").style.display="";
  }catch{}
}
export function applyPreviewTransforms(){
  const v=byId("camPreview").querySelector("video");
  if(!v) return;
  const rot=state.settings.camFlip?' rotate(180deg)':'';
  const mir=state.settings.camMirror?' scaleX(-1)':'';
  v.style.transform=mir+rot;
}
byId("btnCamFlip")?.addEventListener("click", ()=>{
  state.settings.camFlip=!state.settings.camFlip;
  applyPreviewTransforms(); applyCamTransformsToLive();
});

/* ===== ICE diag (RTT) ===== */
function lkPCs(room){
  const e = room?.engine || {};
  const raw = [
    e.client?.publisher?.pc, e.client?.subscriber?.pc,
    e.publisher?.pc, e.subscriber?.pc,
    e.publisherTransport?.pc, e.subscriberTransport?.pc,
    e.pcManager?.publisherPC, e.pcManager?.subscriberPC,
    e.pcManager?.publisher?.pc, e.pcManager?.subscriber?.pc,
  ].filter(pc => pc && typeof pc.getStats === "function");

  let pub = null, sub = null;
  for (const pc of raw){
    const sdp = pc.currentLocalDescription?.sdp || pc.localDescription?.sdp || "";
    if (/a=sendonly|a=sendrecv/i.test(sdp)) pub = pub || pc;
    if (/a=recvonly/i.test(sdp))           sub = sub || pc;
  }
  if (!pub) pub = raw[0] || null;
  if (!sub) sub = raw[1] || pub || null;
  return { pub, sub };
}
async function iceRttForPC(pc){
  if (!pc) return null;
  const stats = await pc.getStats();
  let rtt = null;
  stats.forEach(rep => {
    if (rep.type === "transport" && rep.selectedCandidatePairId){
      const p = stats.get(rep.selectedCandidatePairId);
      if (p && typeof p.currentRoundTripTime === "number"){
        rtt = Math.round(p.currentRoundTripTime * 1000);
      }
    }
  });
  stats.forEach(rep => {
    if (rep.type === "candidate-pair" &&
        (rep.nominated || rep.selected) &&
        rep.state === "succeeded" &&
        typeof rep.currentRoundTripTime === "number"){
      rtt = Math.round(rep.currentRoundTripTime * 1000);
    }
  });
  return rtt;
}
function fmtRTT(ms){ return (typeof ms === "number") ? `${ms} ms` : "—"; }

export async function updateNetRTT(){
  try{
    const { pub, sub } = lkPCs(ctx.room);
    const [up, down] = await Promise.all([iceRttForPC(pub), iceRttForPC(sub)]);
    const badge = document.getElementById("netRTT");
    if (badge) badge.textContent = `RTT ↑${fmtRTT(up)} / ↓${fmtRTT(down)}`;
    const ms = (typeof up === "number") ? up : down;
    const dot  = document.getElementById("pingDot");
    const label= document.getElementById("mePingVal");
    if (typeof ms === "number"){
      label.textContent = `${ms} ms`;
      dot.className = "dot " + (ms < 60 ? "ok" : ms < 120 ? "warn" : "bad");
    }else{
      label.textContent = "—";
      dot.className = "dot off";
    }
  }catch(e){
    console.warn("updateNetRTT error", e);
  }
}
let pingTimer=null;
export function startPingLoop(){ stopPingLoop(); updateNetRTT(); pingTimer = setInterval(updateNetRTT, 1500); }
export function stopPingLoop(){ if (pingTimer){ clearInterval(pingTimer); pingTimer = null; } }

/* ===== Индикатор-«точки» для foot-swipe ===== */
const footSwipe = byId("footSwipe");
const footDots  = byId("footDots");
const STORAGE_KEY = 'footPaneIdx_v1';

export function initFootDots(){
  if (!footSwipe || !footDots) return;
  const panes = footSwipe.querySelectorAll(".foot-pane").length;
  footDots.innerHTML = "";
  // Показываем точки всегда, если панелей больше одной (универсально для всех режимов)
  const shouldShow = panes > 1;
  footDots.setAttribute("aria-hidden", shouldShow ? "false" : "true");
  footDots.style.display = shouldShow ? "flex" : "none";
  if (!shouldShow) return;
  for (let i=0;i<panes;i++){
    const b=document.createElement("button");
    b.type="button"; b.className="fdot"; b.setAttribute("aria-label",`Панель ${i+1}`);
    b.addEventListener("click", ()=>{
      // синхронизируем глобальный индекс, затем прокручиваем
      window.activePaneIdx = i;
      try{ sessionStorage.setItem(STORAGE_KEY, String(i)); }catch{}
      footSwipe.scrollTo({left: i * footSwipe.clientWidth, behavior:"smooth"});
      updateFootDotsActive();
    });
    footDots.appendChild(b);
  }
  updateFootDotsActive();
}
export function updateFootDotsActive(){
  if (!footSwipe || !footDots || footDots.children.length===0) return;
  let idx;
  const panesEls = footSwipe.querySelectorAll('.foot-pane');
  if (Number.isFinite(window.activePaneIdx)){
    idx = Math.max(0, Math.min(window.activePaneIdx, panesEls.length-1));
  } else {
    // Fallback: вычисляем ближайшую панель к центру вьюпорта
    const center = footSwipe.scrollLeft + footSwipe.clientWidth / 2;
    let best = 0, bestDist = Infinity;
    panesEls.forEach((p, i) => {
      const L = p.offsetLeft, R = L + p.clientWidth;
      const dist = center < L ? (L - center) : (center > R ? (center - R) : 0);
      if (dist < bestDist) { bestDist = dist; best = i; }
    });
    idx = best;
  }
  [...footDots.children].forEach((b,i)=>{
    b.classList.toggle("active", i===idx);
    b.setAttribute("aria-current", i===idx ? "true" : "false");
  });
}
footSwipe?.addEventListener("scroll", ()=> updateFootDotsActive(), {passive:true});

/* ===== INIT ===== */
document.addEventListener("DOMContentLoaded", ()=>{
  const qs=new URLSearchParams(location.search);
  if(qs.get("room")) byId("room").value=qs.get("room");
  if(qs.get("user")) byId("name").value=qs.get("user");

  const ro = new ResizeObserver(()=> fitSpotlightSize()); ro.observe(byId("tilesMain"));
  window.addEventListener("resize", ()=>{
    fitSpotlightSize();
    if (isMobileView() && !ctx.isStageFull){
      document.querySelectorAll(".tile").forEach(t=>t.classList.remove("portrait"));
    }
    updateMobileScrollbar(false);
    setShareButtonMode();
    initFootDots();
    refreshControls();
  });

  updateMobileScrollbar(false);
  setShareButtonMode();
  initFootDots();
  refreshControls();
  // Авто-мираж: фронталка — зеркальная, тыл — обычная
  try{ state.settings.camMirror = (state.settings.camFacing||"user") === "user"; }catch{}
  try{ applyPreviewTransforms(); }catch{}
  try{ applyCamTransformsToLive(); }catch{}
});

/* controls дергает refresh по кастом-эвенту */
window.addEventListener("app:refresh-ui", refreshControls);
