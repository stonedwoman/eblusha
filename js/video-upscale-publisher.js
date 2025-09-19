// Client-side Canvas Upscale/Crop Publisher for LiveKit
//
// README (usage & notes):
// - Software-only zoom/crop via <canvas> (2D). No PTZ, no applyConstraints.
// - Works on iOS WebKit (Chrome/Safari): uses requestAnimationFrame with 2D canvas.
// - Publishes processed MediaStreamTrack (from canvas.captureStream) to LiveKit so all
//   subscribers receive the same zoomed/cropped view.
// - Gestures: pinch-zoom (2 fingers), pan (drag), Ctrl+wheel zoom on desktop.
// - Exposes control API: setZoom, setCenter, getZoom, getCenter, dispose.
// - If a camera publication already exists, replaces its track; otherwise publishes
//   a new track named "camera-upscaled".
// - No external deps. Minimal logs if options.debug === true.
//
// Limitations:
// - CPU-bound on low-end devices at 720p30 with 2D canvas. Use renderEveryNFrames
//   to reduce load. Optional WebGL path can be added later.

import { ctx } from "./state.js";
import { Track } from "./vendor/livekit-loader.js";

/**
 * @typedef {Object} StartOptions
 * @property {import('./vendor/livekit-loader.js').Room} room - Connected LiveKit Room
 * @property {number} [fps=30]
 * @property {number} [width=1280]
 * @property {number} [height=720]
 * @property {number} [minZoom=1]
 * @property {number} [maxZoom=4]
 * @property {HTMLElement} [gestureEl]
 * @property {HTMLElement} [mountEl]
 * @property {string} [background="#000"]
 * @property {boolean} [useWebGL=false]
 * @property {number} [renderEveryNFrames=1]
 * @property {boolean} [debug=false]
 */

/**
 * Start capturing camera, render to canvas with crop/scale, and publish to LiveKit.
 * @param {StartOptions} options
 */
export async function startUpscaledVideoPublish(options){
  const opts = normalizeOptions(options);
  const log = (...args)=>{ if (opts.debug) console.log("[upscale]", ...args); };

  // 1) Create capture video element and request camera
  const srcVideo = document.createElement('video');
  srcVideo.playsInline = true; // iOS WebKit
  srcVideo.muted = true;
  srcVideo.autoplay = true;
  srcVideo.style.display = 'none';

  const constraints = { video: { width: { ideal: opts.width }, height: { ideal: opts.height }, frameRate: { ideal: opts.fps } }, audio: false };
  /** @type {MediaStream} */
  let srcStream;
  try{
    srcStream = await navigator.mediaDevices.getUserMedia(constraints);
  }catch(e){
    console.error('[upscale] getUserMedia failed:', e);
    throw e;
  }
  const srcTrack = srcStream.getVideoTracks()[0];
  srcVideo.srcObject = srcStream;

  try{ await srcVideo.play(); }catch{ /* iOS might delay; we'll poll metadata */ }

  // 2) Prepare canvas
  const canvas = document.createElement('canvas');
  canvas.width = opts.width;
  canvas.height = opts.height;
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.display = 'block';
  const ctx2d = canvas.getContext('2d', { alpha: false, desynchronized: true });

  // Mount canvas if mountEl available, otherwise keep off-DOM (still works for captureStream)
  const mountEl = resolveMountEl(opts.mountEl);
  if (mountEl){
    ensureTouchActionNone(mountEl);
    try{ mountEl.appendChild(canvas); }catch{}
  }

  // 3) Gesture handling state
  let zoom = clamp(opts.initialZoom ?? 1, opts.minZoom, opts.maxZoom);
  let cx = 0.5, cy = 0.5; // normalized center
  let rafHandle = 0; let running = true; let frameCount = 0;

  const gestureEl = resolveGestureEl(opts.gestureEl) || mountEl || document.body;
  ensureTouchActionNone(gestureEl);
  const cleanupGestures = setupGestures(gestureEl, {
    get viewSize(){ return { w: canvas.clientWidth||opts.width, h: canvas.clientHeight||opts.height }; },
    get zoom(){ return zoom; },
    set zoom(z){ zoom = clamp(z, opts.minZoom, opts.maxZoom); },
    get center(){ return { cx, cy }; },
    set center(p){ const clamped = clampCenter(p.cx, p.cy); cx = clamped.cx; cy = clamped.cy; },
  }, { debug: opts.debug });

  // 4) Wait for metadata
  await waitForVideoMetadata(srcVideo, log);

  // 5) Start processed capture
  const processedStream = canvas.captureStream(opts.fps);
  const processedTrack = processedStream.getVideoTracks()[0];

  // 6) Publish or replace
  let previousTrack = null;
  const localParticipant = (opts.room || ctx.room)?.localParticipant;
  if (!localParticipant) throw new Error('Room is not connected');
  const existingPub = safeGetCamPub(localParticipant);
  if (existingPub){
    previousTrack = existingPub.track?.mediaStreamTrack || existingPub.track || null;
    log('Replacing existing camera publication with upscaled track');
    await existingPub.replaceTrack(processedTrack);
    try{ await (existingPub.setMuted?.(false) || existingPub.unmute?.()); }catch{}
  } else {
    log('Publishing new upscaled camera track');
    await localParticipant.publishTrack(processedTrack, {
      source: Track.Source.Camera,
      name: 'camera-upscaled',
      simulcast: true,
    });
  }

  // 7) Render loop
  const bg = opts.background || '#000';
  const render = ()=>{
    if (!running) return;
    rafHandle = window.requestAnimationFrame(render);
    frameCount++;
    if ((frameCount % (opts.renderEveryNFrames||1)) !== 0) return;

    const sw = srcVideo.videoWidth|0, sh = srcVideo.videoHeight|0;
    if (!sw || !sh) return;

    // compute crop window
    const winW = sw / zoom;
    const winH = sh / zoom;
    const left = clampN(cx * sw - winW/2, 0, sw - winW);
    const top  = clampN(cy * sh - winH/2, 0, sh - winH);

    // clear / bg
    if (bg){
      ctx2d.fillStyle = bg;
      ctx2d.fillRect(0, 0, canvas.width, canvas.height);
    } else {
      ctx2d.clearRect(0, 0, canvas.width, canvas.height);
    }

    try{
      ctx2d.drawImage(srcVideo, left, top, winW, winH, 0, 0, canvas.width, canvas.height);
    }catch{}
  };
  rafHandle = window.requestAnimationFrame(render);

  // 8) Handle track end and resize/orientation
  const onEnded = ()=>{ log('Source track ended'); stopLoop(); };
  try{ srcTrack.addEventListener('ended', onEnded); }catch{}

  const onResize = ()=>{
    // keep internal resolution, only adjust CSS size
    // canvas.style.{width,height} already use 100%; nothing to recompute
  };
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);

  function stopLoop(){
    running = false;
    try{ if (rafHandle) cancelAnimationFrame(rafHandle); }catch{}
  }

  async function dispose(){
    log('Dispose called');
    stopLoop();
    try{ window.removeEventListener('resize', onResize); }catch{}
    try{ window.removeEventListener('orientationchange', onResize); }catch{}
    try{ srcTrack.removeEventListener?.('ended', onEnded); }catch{}

    // Unpublish or restore: we simply unpublish if we created a new publication.
    // If we replaced an existing publication, we leave the processed track published
    // unless the caller chooses to publish another track later. Per spec: stop both tracks.
    try{ processedTrack.stop?.(); }catch{}
    try{ srcTrack.stop?.(); }catch{}

    // Remove canvas from DOM
    try{ canvas.remove(); }catch{}
  }

  // API
  const api = {
    setZoom(z){ zoom = clamp(z, opts.minZoom, opts.maxZoom); },
    setCenter(nx, ny){ const p = clampCenter(nx, ny); cx = p.cx; cy = p.cy; },
    getZoom(){ return zoom; },
    getCenter(){ return { cx, cy }; },
    dispose,
  };

  // expose for debugging if needed
  try{ window.videoUpscale = api; }catch{}
  log('Initialized');

  return api;
}

// ===== Helpers =====

/** @param {StartOptions} o */
function normalizeOptions(o){
  const out = Object.assign({
    room: ctx.room,
    fps: 30,
    width: 1280,
    height: 720,
    minZoom: 1,
    maxZoom: 4,
    useWebGL: false,
    renderEveryNFrames: 1,
    background: '#000',
    debug: false,
  }, (o||{}));
  // Clamp min/max
  if (!(out.minZoom > 0)) out.minZoom = 1;
  if (!(out.maxZoom >= out.minZoom)) out.maxZoom = Math.max(out.minZoom, 4);
  // force integer canvas size
  out.width = Math.max(2, out.width|0);
  out.height = Math.max(2, out.height|0);
  return out;
}

function resolveMountEl(provided){
  if (provided) return provided;
  try{
    const z = document.getElementById('zoomStage');
    if (z) return z;
  }catch{}
  return null; // keep off-DOM by default to avoid overlaying UI
}

function resolveGestureEl(provided){
  if (provided) return provided;
  try{
    const z = document.getElementById('zoomStage');
    if (z) return z;
  }catch{}
  try{
    const t = document.querySelector('.tiles');
    if (t) return t;
  }catch{}
  return document.body;
}

function ensureTouchActionNone(el){
  try{
    if (getComputedStyle(el).touchAction !== 'none') el.style.touchAction = 'none';
  }catch{}
}

function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }
function clampN(v, a, b){ return Math.max(a, Math.min(b, v)); }
function clampCenter(cx, cy){ return { cx: clamp(cx, 0, 1), cy: clamp(cy, 0, 1) }; }

async function waitForVideoMetadata(video, log){
  if ((video.videoWidth|0) > 0 && (video.videoHeight|0) > 0) return;
  await new Promise((res)=>{
    let done=false;
    const check=()=>{
      if (!done && (video.videoWidth|0)>0 && (video.videoHeight|0)>0){ done=true; res(); }
      else setTimeout(check, 30);
    };
    video.addEventListener('loadedmetadata', ()=>{ if(!done){ done=true; res(); } });
    check();
  });
  try{ await video.play(); }catch{}
  log('metadata ready', video.videoWidth, 'x', video.videoHeight);
}

function safeGetCamPub(localParticipant){
  try{ return localParticipant.getTrack(Track.Source.Camera); }catch{ return null; }
}

// Gestures: pinch (two touches), pan (drag), Ctrl+wheel
function setupGestures(targetEl, state, { debug=false }={}){
  let dragging=false; let lastX=0, lastY=0;
  let pinchActive=false; let pinchStartDist=0; let pinchStartZoom=1; let pinchMid={x:0,y:0};

  const log = (...a)=>{ if (debug) console.log('[upscale:gesture]', ...a); };

  const onPointerDown = (e)=>{
    if (e.pointerType==='touch' || e.pointerType==='pen' || e.pointerType==='mouse'){
      dragging = true; lastX = e.clientX; lastY = e.clientY; targetEl.setPointerCapture?.(e.pointerId);
    }
  };
  const onPointerMove = (e)=>{
    if (!dragging || e.buttons===0) return;
    const dx = e.clientX - lastX; const dy = e.clientY - lastY; lastX = e.clientX; lastY = e.clientY;
    const { w, h } = state.viewSize;
    const z = state.zoom;
    const nx = (-dx) / (w) / z; // inverse pan, normalized
    const ny = (-dy) / (h) / z;
    const c = state.center; state.center = { cx: c.cx + nx, cy: c.cy + ny };
  };
  const onPointerUp = (e)=>{ dragging=false; try{ targetEl.releasePointerCapture?.(e.pointerId); }catch{} };

  // Wheel zoom (Ctrl+wheel on desktop)
  const onWheel = (e)=>{
    if (!(e.ctrlKey || e.metaKey)) return; // require ctrl for precision trackpads
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * 0.0015);
    const pre = state.zoom;
    const next = clamp(pre * factor, 1, 4);
    // zoom around pointer position
    const rect = targetEl.getBoundingClientRect?.() || { left:0, top:0, width:1, height:1 };
    const px = ((e.clientX - rect.left) / Math.max(1, rect.width));
    const py = ((e.clientY - rect.top) / Math.max(1, rect.height));
    const c = state.center;
    const sw = 1/pre, sn = 1/next; // window size in normalized units
    const cxNew = c.cx + (px - 0.5) * (sw - sn);
    const cyNew = c.cy + (py - 0.5) * (sw - sn);
    state.center = { cx: cxNew, cy: cyNew };
    state.zoom = next;
  };

  // Touch pinch zoom
  const onTouchStart = (e)=>{
    if (e.touches.length===2){
      pinchActive = true;
      pinchStartDist = pinchDistance(e.touches[0], e.touches[1]);
      pinchStartZoom = state.zoom;
      pinchMid = pinchMidpoint(e.touches[0], e.touches[1], targetEl.getBoundingClientRect?.());
    }
  };
  const onTouchMove = (e)=>{
    if (pinchActive && e.touches.length===2){
      e.preventDefault();
      const d = pinchDistance(e.touches[0], e.touches[1]);
      const ratio = (d / Math.max(1, pinchStartDist));
      const next = clamp(pinchStartZoom * ratio, 1, 4);
      const pre = state.zoom;
      // center compensation so zoom stays under fingers
      const sw = 1/pre, sn = 1/next;
      const c = state.center;
      const cxNew = c.cx + (pinchMid.x - 0.5) * (sw - sn);
      const cyNew = c.cy + (pinchMid.y - 0.5) * (sw - sn);
      state.center = { cx: cxNew, cy: cyNew };
      state.zoom = next;
    }
  };
  const onTouchEnd = (e)=>{ if (e.touches.length<2) pinchActive=false; };

  targetEl.addEventListener('pointerdown', onPointerDown, { passive: true });
  targetEl.addEventListener('pointermove', onPointerMove, { passive: true });
  targetEl.addEventListener('pointerup', onPointerUp, { passive: true });
  targetEl.addEventListener('pointercancel', onPointerUp, { passive: true });
  targetEl.addEventListener('wheel', onWheel, { passive: false });
  targetEl.addEventListener('touchstart', onTouchStart, { passive: true });
  targetEl.addEventListener('touchmove', onTouchMove, { passive: false });
  targetEl.addEventListener('touchend', onTouchEnd, { passive: true });

  log('gestures attached');

  return ()=>{
    targetEl.removeEventListener('pointerdown', onPointerDown);
    targetEl.removeEventListener('pointermove', onPointerMove);
    targetEl.removeEventListener('pointerup', onPointerUp);
    targetEl.removeEventListener('pointercancel', onPointerUp);
    targetEl.removeEventListener('wheel', onWheel);
    targetEl.removeEventListener('touchstart', onTouchStart);
    targetEl.removeEventListener('touchmove', onTouchMove);
    targetEl.removeEventListener('touchend', onTouchEnd);
  };
}

function pinchDistance(a, b){ const dx=a.clientX-b.clientX, dy=a.clientY-b.clientY; return Math.hypot(dx, dy); }
function pinchMidpoint(a, b, rect){
  const x = (a.clientX+b.clientX)/2; const y=(a.clientY+b.clientY)/2;
  const r = rect || { left:0, top:0, width:1, height:1 };
  return { x: (x - r.left) / Math.max(1, r.width), y: (y - r.top) / Math.max(1, r.height) };
}


