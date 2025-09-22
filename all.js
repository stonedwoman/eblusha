/* ===== LiveKit loader (устойчивый) ===== */
async function loadLiveKitSafe(){
  if (window.LivekitClient) return window.LivekitClient;
  if (window.LiveKitClient) return window.LiveKitClient;
  if (window.livekit)       return window.livekit;
  try { return await import('https://cdn.skypack.dev/livekit-client'); } catch {}
  try { return await import('https://esm.sh/livekit-client'); } catch {}
  await new Promise((res, rej)=>{
    const s=document.createElement('script');
    s.src='https://cdn.jsdelivr.net/npm/livekit-client@2/dist/livekit-client.min.js';
    s.async=true; s.onload=res; s.onerror=rej; document.head.appendChild(s);
  });
  return window.LivekitClient || window.LiveKitClient || window.livekit;
}
const LK = await loadLiveKitSafe();
const {
  Room, RoomEvent, Track,
  createLocalAudioTrack, createLocalVideoTrack, createLocalScreenTracks,
  ConnectionQuality, LogLevel, setLogLevel
} = LK;
try{ setLogLevel?.(LogLevel?.debug ?? 3); }catch{}

/* ===== Конфиг ===== */
const LIVEKIT_WS_URL = "wss://voice.eblusha.org";
const TOKEN_ENDPOINT  = "/token";

/* ===== Утилы ===== */
const $  = s => document.querySelector(s);
const byId = id => document.getElementById(id);
const isWidthMobile = ()=> matchMedia('(max-width:640px)').matches;
const isMobileDevice = ()=>{
  const ua = navigator.userAgent.toLowerCase();
  return  /android|iphone|ipad|ipod/.test(ua)
       || matchMedia('(pointer:coarse)').matches
       || matchMedia('(hover:none)').matches
       || navigator.maxTouchPoints > 0;
};
const isMobileView = ()=> isWidthMobile() || isMobileDevice();

function hashColor(name){
  let h=0; for(let i=0;i<name.length;i++) h=(h<<5)-h+name.charCodeAt(i);
  const hue=Math.abs(h)%360; return `hsl(${hue} 45% 55%)`;
}
function show(id){ const el=byId(id); if(el){ el.hidden=false; el.style.display=(id==='screen-app'?'grid':'block'); } }
function hide(id){ const el=byId(id); if(el){ el.hidden=true; el.style.display='none'; } }

/* ===== SFX ===== */
let audioCtx=null;
function ensureAudio(){ if(!audioCtx){ audioCtx = new (window.AudioContext||window.webkitAudioContext)(); } return audioCtx; }
function beep(freq=880, dur=0.12, type='sine', vol=0.05, when=0){
  const ctx=ensureAudio(); const t0=ctx.currentTime+when;
  const o=ctx.createOscillator(); const g=ctx.createGain();
  o.type=type; o.frequency.value=freq;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(vol, t0+0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0+dur);
  o.connect(g).connect(ctx.destination);
  o.start(t0); o.stop(t0+dur+0.02);
}
function sfx(kind){
  if(kind==='self-join'){ beep(1100,0.09,'triangle',0.06); beep(1500,0.07,'triangle',0.05,0.08); }
  else if(kind==='self-leave'){ beep(700,0.08,'sine',0.05); beep(500,0.12,'sine',0.05,0.07); }
  else if(kind==='peer-join'){ beep(900,0.07,'square',0.05); }
  else if(kind==='peer-leave'){ beep(520,0.10,'square',0.05); }
}

/* ===== Состояние ===== */
let room=null, localAudioTrack=null, localVideoTrack=null, screenTracks=[];
let pingTimer=null, statsPC=null, previewTrack=null;
const registry = new Map(); // id -> { participant, tile, row, hasVideo, name, isLocal, audioEl, volume }
let pinnedId=null, isStageFull=false;
const state={
  me:{ name:'Me', room:'room', share:false, _mobileRotateOpen:false },
  settings:{ ns:true, ec:true, agc:true, micDevice:'', camDevice:'', camFlip:false, camFacing:'user', lowQuality:false }
};

/* ===== Индикаторы качества сети (заглушка под ConnectionQualityChanged) ===== */
function setQualityIndicator(q){
  const dot=byId('pingDot'), label=byId('mePingVal');
  if(!dot||!label) return;
  if(q===ConnectionQuality.Excellent){ dot.className='dot ok';   label.textContent='Отлично'; }
  else if(q===ConnectionQuality.Good){  dot.className='dot warn'; label.textContent='Норм'; }
  else if(q===ConnectionQuality.Poor){  dot.className='dot bad';  label.textContent='Плохо'; }
}

/* ===== Участники ===== */
function getRemoteParticipants(){
  const p = room && room.participants;
  if (!p) return [];
  if (p instanceof Map || (typeof p.forEach==='function' && typeof p.values==='function')) return Array.from(p.values()).filter(Boolean);
  try { return Object.values(p).filter(Boolean); } catch { return []; }
}

/* ===== Вход ===== */
byId('authForm').addEventListener('submit', async (e)=>{ e.preventDefault(); await joinRoom(); });

async function joinRoom(){
  try{
    state.me.name=(byId('name').value||'').trim()||('user-'+Math.random().toString(36).slice(2,7));
    state.me.room=(byId('room').value||'').trim()||'room-1';
    byId('joinBtn').disabled=true;

    const r=await fetch(`${TOKEN_ENDPOINT}?room=${encodeURIComponent(state.me.room)}&user=${encodeURIComponent(state.me.name)}`);
    const { token } = await r.json();

    await connectLiveKit(token);

    hide('screen-auth'); show('screen-app');
    byId('roomTag').textContent='Комната #'+state.me.room;
    byId('meName').textContent=state.me.name;
    byId('meRoom').textContent='Комната '+state.me.room;
    const letter=state.me.name.slice(0,1).toUpperCase();
    byId('meBigAvatar').textContent=letter;
    byId('meBigAvatar').style.background=hashColor(state.me.name);
    sfx('self-join');

    setShareButtonMode();
    initFootDots();
  }catch(e){ alert('Ошибка подключения: '+(e?.message||e)); console.error(e); }
  finally{ byId('joinBtn').disabled=false; }
}

/* ===== Подключение LiveKit ===== */
async function connectLiveKit(token){
  room = new Room({ autoSubscribe:true, adaptiveStream:true, dynacast:true });

  room.on(RoomEvent.ParticipantConnected,  (p)=>{ registerParticipant(p); applyLayout(); if(!p.isLocal) sfx('peer-join'); });
  room.on(RoomEvent.ParticipantDisconnected,(p)=>{ unregisterParticipant(p.identity); applyLayout(); if(!p.isLocal) sfx('peer-leave'); });

  room.on(RoomEvent.TrackSubscribed, (track, pub, participant)=>{
    if (!registry.has(participant.identity)) registerParticipant(participant);
    const id = participant.identity + (pub.source===Track.Source.ScreenShare || pub.source===Track.Source.ScreenShareAudio ? '#screen' : '');
    if(track.kind==='audio'){
      attachAudioTrack(track, participant.identity);
    } else {
      attachVideoToTile(track, id, participant.isLocal, pub.source===Track.Source.ScreenShare?'Экран':undefined);
      markHasVideo(participant.identity, true);
      const media = track.mediaStreamTrack;
      if (media){
        media.addEventListener('ended', ()=>{ showAvatarInTile(id); recomputeHasVideo(participant.identity); applyLayout(); });
        media.addEventListener('mute',  ()=>{ showAvatarInTile(id); recomputeHasVideo(participant.identity); applyLayout(); });
      }
    }
    applyLayout();
  });

  room.on(RoomEvent.TrackUnsubscribed, (track, pub, participant)=>{
    const id = participant.identity + (pub.source===Track.Source.ScreenShare || pub.source===Track.Source.ScreenShareAudio ? '#screen' : '');
    if(track.kind==='video'){ showAvatarInTile(id); recomputeHasVideo(participant.identity); }
    (track.detach?.()||[]).forEach(el=>el.remove());
    applyLayout();
  });

  // локальные mute/unmute — просто обновляем UI
  room.on(RoomEvent.TrackMuted,  (pub,p)=>{
    if(p?.isLocal){
      if(pub?.source===Track.Source.Camera) { showAvatarInTile(p.identity); applyLayout(); }
      refreshControls();
    }
  });
  room.on(RoomEvent.TrackUnmuted,(pub,p)=>{
    if(p?.isLocal){
      if(pub?.source===Track.Source.Camera && pub?.track){ attachVideoToTile(pub.track, p.identity, true); applyLayout(); }
      refreshControls();
    }
  });

  room.on(RoomEvent.ActiveSpeakersChanged, (speakers)=>{ highlightSpeaking(speakers.map(p=>p.identity)); if(!pinnedId) applyLayout(); });
  room.on(RoomEvent.ConnectionQualityChanged, (p,q)=>{ if(p?.isLocal) setQualityIndicator(q); });

  await room.connect(LIVEKIT_WS_URL, token);
  wireData();

  registerParticipant(room.localParticipant);
  getRemoteParticipants().forEach(registerParticipant);

  await ensureMicOn(); // публикуем мик сразу
  applyLayout();
  refreshControls();
  startPingLoop();
}

/* ===== Реестр ===== */
function registerParticipant(participant){
  const id = participant.identity;
  if(registry.has(id)){ registry.get(id).participant = participant; return; }
  const name = participant.name || id || 'user';
  const tile = createTileEl(id, name, participant.isLocal);
  const row  = createRowEl(id, name);
  registry.set(id, { participant, tile, row, hasVideo:false, name, isLocal:!!participant.isLocal, audioEl:null, volume:1 });
  updateUsersCounter();
  queueSbarUpdate();
}
function unregisterParticipant(id){
  const rec = registry.get(id);
  if(!rec) return;
  rec.tile?.remove(); rec.row?.remove();
  registry.delete(id);
  if(pinnedId===id) pinnedId=null;
  updateUsersCounter();
  queueSbarUpdate();
}
function updateUsersCounter(){ byId('usersTag').textContent = `${registry.size} участник(ов)`; }

/* ===== DOM helpers ===== */
const tilesMain = ()=> byId('tilesMain');
const tilesRail = ()=> byId('tilesRail');
const getLocalTileVideo = ()=> document.querySelector('.tile.me video');

/* ==== Per-tile overlay ==== */
const ov = byId('tileOverlay'), ovMedia = byId('ovMedia'), ovClose = byId('ovClose'), ovName = byId('ovName');
let ovReturnTile = null;

async function openTileOverlay(tile){
  const v = tile.querySelector('video');
  if(!v) return;
  ovReturnTile = tile;
  ovName.textContent = tile.dataset.name || 'Видео';
  ov.classList.add('open'); ov.setAttribute('aria-hidden','false');
  ovMedia.innerHTML = ''; ovMedia.appendChild(v);
  try{ if(ov.requestFullscreen) await ov.requestFullscreen({ navigationUI:'hide' }); }catch{}
  try{ await screen.orientation.lock('landscape'); }catch{}
  state.me._mobileRotateOpen = true; refreshControls();
}
async function closeTileOverlay(){
  const v = ovMedia.querySelector('video');
  if(v && ovReturnTile) ovReturnTile.prepend(v);
  ovReturnTile = null;
  ov.classList.remove('open'); ov.setAttribute('aria-hidden','true');
  try{ if(document.fullscreenElement) await document.exitFullscreen(); }catch{}
  try{ if(screen.orientation.unlock) screen.orientation.unlock(); }catch{}
  state.me._mobileRotateOpen = false; refreshControls();
}
ovClose.addEventListener('click', closeTileOverlay);
ov.addEventListener('click', (e)=>{ if(e.target===ov) closeTileOverlay(); });
document.addEventListener('keydown', (e)=>{ if(e.key==='Escape' && ov.classList.contains('open')) closeTileOverlay(); });

/* ===== Создание тайла ===== */
function createTileEl(identity, name, isLocal){
  const el=document.createElement('div');
  el.className='tile' + (isLocal?' me':'');
  el.dataset.pid=identity; el.dataset.name=name;
  el.style.background = hashColor(name);
  const vol = isLocal ? '' : `<div class="vol"><span>🔊</span><input type="range" min="0" max="100" value="100" data-act="vol"></div>`;
  el.innerHTML=`
    <div class="placeholder"><div class="avatar-ph">${name.slice(0,1).toUpperCase()}</div></div>
    <div class="name">${name}${isLocal?' (вы)':''}</div>
    ${vol}
    <div class="controls"><button class="ctrl" data-act="pin" title="В спотлайт">⭐</button></div>`;

  el.addEventListener('click', (e)=>{
    const act = e.target?.dataset?.act;
    if(act==='pin'){ pinnedId = (pinnedId===identity? null : identity); applyLayout(); e.stopPropagation(); return; }
    if(el.querySelector('video')){ openTileOverlay(el); }
  });
  el.addEventListener('input',(e)=>{
    if(e.target?.dataset?.act==='vol'){
      e.stopPropagation();
      const rec = registry.get(identity);
      const v = Math.max(0, Math.min(100, Number(e.target.value||0)));
      if(rec){ rec.volume = v/100; if(rec.audioEl) rec.audioEl.volume = rec.volume; }
    }
  });
  tilesMain().appendChild(el);
  return el;
}
function createRowEl(identity, name){
  const row=document.createElement('div');
  row.className='user'; row.dataset.pid = identity;
  row.innerHTML=`<div class="avatar" style="background:${hashColor(name)}">${name.slice(0,1).toUpperCase()}</div><div class="name">${name}</div>`;
  row.onclick=()=>{ pinnedId = (pinnedId===identity? null : identity); applyLayout(); };
  byId('onlineList').appendChild(row);
  return row;
}

/* ===== Видео/Аудио ===== */
function setTileAspectFromVideo(tile, videoEl){
  if (isMobileView() && !isStageFull){ tile.classList.remove('portrait'); return; }
  const w = videoEl.videoWidth, h = videoEl.videoHeight;
  if (!w || !h) return;
  tile.classList.toggle('portrait', h > w);
  if (tile.classList.contains('spotlight')) fitSpotlightSize();
}
function applyCamTransformsTo(el){
  if(!el) return;
  const rot = state.settings.camFlip ? ' rotate(180deg)' : '';
  const mir = state.settings.camMirror ? ' scaleX(-1)' : '';
  el.style.transform = mir + rot;
}
function applyCamTransformsToLive(){ applyCamTransformsTo(getLocalTileVideo()); }
function safeRemoveVideo(el){
  try{ el.pause?.(); }catch{}
  try{ el.srcObject = null; }catch{}
  try{ el.removeAttribute('src'); }catch{}
  try{ el.load?.(); }catch{}
  try{ el.remove(); }catch{}
}

function attachVideoToTile(track, identity, isLocal, labelOverride){
  const rec  = registry.get(identity.replace('#screen','')) || { name: identity };
  const name = labelOverride || rec.name || identity;
  const tile = ensureTile(identity, name, isLocal);

  const newId = track?.mediaStreamTrack?.id || track?.mediaStream?.id || '';
  const curV  = tile.querySelector('video');
  const curId = tile.dataset.vid || '';
  if (curV && curId && curId === newId){
    curV.muted = !!isLocal;
    if (isLocal && !identity.includes('#screen')) applyCamTransformsTo(curV);
    setTileAspectFromVideo(tile, curV);
    return;
  }

  if (curV) safeRemoveVideo(curV);
  tile.querySelector('.placeholder')?.remove();

  const v = track.attach();
  v.autoplay = true; v.playsInline = true;
  v.setAttribute('autoplay',''); v.setAttribute('playsinline','');
  if (isLocal){ v.muted = true; v.setAttribute('muted',''); }
  v.classList.add('media');
  tile.dataset.vid = newId || '';
  tile.prepend(v);

  if(isLocal && !identity.includes('#screen')) applyCamTransformsTo(v);

  const tryApply = ()=> setTileAspectFromVideo(tile, v);
  v.addEventListener('loadedmetadata', tryApply);
  v.addEventListener('resize', tryApply);
  tryApply();
  queueSbarUpdate();
}
function ensureTile(identity, name, isLocal){
  let el = document.querySelector(`.tile[data-pid="${CSS.escape(identity)}"]`);
  if(el) return el;
  if(!identity.includes('#screen') && registry.has(identity)){ return registry.get(identity).tile; }
  return createTileEl(identity, name, isLocal);
}
function showAvatarInTile(identity){
  const t=document.querySelector(`.tile[data-pid="${CSS.escape(identity)}"]`);
  if(!t) return;
  t.classList.remove('portrait');
  const v = t.querySelector('video'); if (v) safeRemoveVideo(v);
  t.dataset.vid = '';
  if(!t.querySelector('.placeholder')){
    const ph=document.createElement('div'); ph.className='placeholder';
    ph.innerHTML=`<div class="avatar-ph">${(t.dataset.name||'?').slice(0,1).toUpperCase()}</div>`; t.prepend(ph);
  }
  if (t.classList.contains('spotlight')) fitSpotlightSize();
  queueSbarUpdate();
}
function attachAudioTrack(track, baseId){
  const el=track.attach(); el.style.display='none'; document.body.appendChild(el);
  const rec = registry.get(baseId);
  if(rec){
    rec.audioEl = el; if(typeof rec.volume!=='number') rec.volume = 1; el.volume = rec.volume;
    const slider = rec.tile?.querySelector('.vol input[type=range]'); if(slider){ slider.value = Math.round(rec.volume*100); slider.disabled=false; }
  }
  return el;
}
function markHasVideo(baseId, val){ const r=registry.get(baseId); if(r){ r.hasVideo=val; } }
function recomputeHasVideo(baseId){
  const r=registry.get(baseId); if(!r) return;
  const anyVideo = !!document.querySelector(`.tile[data-pid="${CSS.escape(baseId)}"] video, .tile[data-pid="${CSS.escape(baseId)}#screen"] video`);
  r.hasVideo = anyVideo;
}

/* ===== Спикеры ===== */
function highlightSpeaking(ids){
  const set=new Set(ids);
  document.querySelectorAll('.tile').forEach(t=>t.classList.remove('speaking'));
  set.forEach(id=>{ document.querySelector(`.tile[data-pid="${CSS.escape(id)}"]`)?.classList.add('speaking'); });
}

/* ===== Лэйаут ===== */
function chooseAutoSpotlight(){
  if(pinnedId && registry.has(pinnedId)) return pinnedId;
  const meId = room?.localParticipant?.identity;
  if(meId && document.querySelector(`.tile[data-pid="${CSS.escape(meId)}#screen"]`)) return meId+'#screen';
  const withVideo = [...registry.entries()].filter(([,r])=>r.hasVideo);
  if(withVideo.length) return withVideo[0][0];
  if(meId && registry.has(meId)) return meId;
  return [...registry.keys()][0];
}

// подбор колонок под 16:9 чтобы максимизировать площадь (ПК без спотлайта)
function bestGrid(n, W, H, ar = 16/9){
  let best={rows:1, cols:n, score:0};
  for(let cols=1; cols<=Math.min(n,6); cols++){
    const rows = Math.ceil(n/cols);
    const w = W/cols, h = H/rows;
    const size = Math.min(w, h/ar);
    const score = size; // прокси площади (без констант)
    if(score > best.score) best = {rows, cols, score};
  }
  return best;
}

function applyLayout(){
  const tiles = byId('tiles'), main = tilesMain(), rail = tilesRail();
  const mobile = isMobileView() && !isStageFull;

  // гарантируем DOM-тайлы для зарегистрированных
  registry.forEach((rec)=>{ if(!document.body.contains(rec.tile)){ rec.tile = createTileEl(rec.participant.identity, rec.name, rec.isLocal); } });

  if (mobile){
    tiles.classList.remove('spotlight','single');
    const N = Array.from(main.children).length + Array.from(rail.children).length;
    // вернуть все тайлы в main
    document.querySelectorAll('.tile').forEach(t=>{
      t.classList.remove('spotlight','thumb','portrait');
      t.style.width=''; t.style.height='';
      if (t.parentElement !== main) main.appendChild(t);
    });

    // мобильный режим: сетка для 1–4, лента для 5+
    if(N<=2){
      main.style.display='grid';
      main.style.gridTemplateColumns=`repeat(${N}, 1fr)`;
    }else if(N<=4){
      main.style.display='grid';
      main.style.gridTemplateColumns='repeat(2, 1fr)';
    }else{
      main.style.display='flex';
    }
    updateUsersCounter();
    updateMobileScrollbar(true);
    return;
  }

  // ПК: спотлайт если >1 тайла, иначе обычная сетка
  const spotlightId = chooseAutoSpotlight();
  const allTiles = Array.from(document.querySelectorAll('.tile'));
  const totalTiles = allTiles.length;

  if (spotlightId && totalTiles>1){
    tiles.classList.add('spotlight');
    tiles.classList.toggle('single', false);
    allTiles.forEach(t=>{
      t.classList.remove('spotlight','thumb');
      t.style.width=''; t.style.height='';
      const id=t.dataset.pid;
      if(id===spotlightId){
        if (t.parentElement !== main) main.appendChild(t);
        t.classList.add('spotlight');
      } else {
        if (t.parentElement !== rail) rail.appendChild(t);
        t.classList.add('thumb');
      }
    });
    fitSpotlightSize();
  } else {
    tiles.classList.remove('spotlight'); tiles.classList.toggle('single', totalTiles<=1);
    // вернуть все в main
    allTiles.forEach(t=>{
      t.classList.remove('spotlight','thumb');
      t.style.width=''; t.style.height='';
      if (t.parentElement !== main) main.appendChild(t);
    });
    // лучшая сетка по контейнеру
    const box = main.getBoundingClientRect();
    const N = main.children.length;
    const { cols } = bestGrid(N, Math.max(1, box.width), Math.max(1, box.height), 16/9);
    main.style.display='grid';
    main.style.gridTemplateColumns = `repeat(${Math.max(1, cols)}, 1fr)`;
  }
  updateUsersCounter();
}

/* ===== Кастомная полоса прокрутки для мобилки ===== */
const sbar     = byId('tilesSbar');
const sbarTrack= byId('sbarTrack');
const sbarThumb= byId('sbarThumb');
let sbarDrag = null, sbarUpdateTimer=null;

function queueSbarUpdate(){ clearTimeout(sbarUpdateTimer); sbarUpdateTimer=setTimeout(()=>updateMobileScrollbar(false), 50); }
function updateMobileScrollbar(forceShow){
  if(!isMobileView() || isStageFull) { sbar?.classList.remove('show'); return; }
  const m = tilesMain(); if(!m||!sbar) return;
  const need = m.scrollWidth > m.clientWidth + 2;
  sbar.setAttribute('aria-hidden', need ? 'false' : 'true');
  sbar.classList.toggle('show', need);
  if(!need) return;

  const trackW = sbarTrack.clientWidth;
  const minThumb = 28;
  const thumbW = Math.max(minThumb, Math.round((m.clientWidth/m.scrollWidth) * trackW));
  const maxLeft = Math.max(0, trackW - thumbW);
  const left = maxLeft ? Math.round((m.scrollLeft / (m.scrollWidth - m.clientWidth)) * maxLeft) : 0;

  sbarThumb.style.width = thumbW + 'px';
  sbarThumb.style.transform = `translateX(${left}px)`;

  if(forceShow){
    sbarThumb.animate(
      [{transform:`translateX(${left}px) scaleY(1.0)`},
       {transform:`translateX(${left}px) scaleY(1.25)`},
       {transform:`translateX(${left}px) scaleY(1.0)`}],
      {duration:600, easing:'ease-out'}
    );
  }
}
tilesMain().addEventListener('scroll', ()=> updateMobileScrollbar(false), {passive:true});
window.addEventListener('resize',  ()=> updateMobileScrollbar(false));

function sbarSetScrollByThumbX(px){
  const m = tilesMain();
  const trackW = sbarTrack.clientWidth;
  const thumbW = sbarThumb.clientWidth;
  const maxLeft = Math.max(0, trackW - thumbW);
  const clamped = Math.max(0, Math.min(maxLeft, px));
  const ratio = maxLeft ? (clamped / maxLeft) : 0;
  const maxScroll = m.scrollWidth - m.clientWidth;
  m.scrollLeft = ratio * maxScroll;
  updateMobileScrollbar(false);
}
function startSbarDrag(clientX){
  sbar.classList.add('dragging');
  const rect = sbarTrack.getBoundingClientRect();
  const thumbRect = sbarThumb.getBoundingClientRect();
  sbarDrag = { startX: clientX, startLeft: thumbRect.left - rect.left };
}
function moveSbarDrag(clientX){
  if(!sbarDrag) return;
  const rect = sbarTrack.getBoundingClientRect();
  const delta = clientX - sbarDrag.startX;
  sbarSetScrollByThumbX(sbarDrag.startLeft + delta);
}
function endSbarDrag(){ sbar.classList.remove('dragging'); sbarDrag=null; }

sbarThumb.addEventListener('mousedown', (e)=>{ e.preventDefault(); startSbarDrag(e.clientX); });
document.addEventListener('mousemove', (e)=>{ if(sbarDrag) moveSbarDrag(e.clientX); });
document.addEventListener('mouseup', endSbarDrag);
sbarThumb.addEventListener('touchstart', (e)=>{ startSbarDrag(e.touches[0].clientX); }, {passive:true});
document.addEventListener('touchmove', (e)=>{ if(sbarDrag) moveSbarDrag(e.touches[0].clientX); }, {passive:true});
document.addEventListener('touchend', endSbarDrag);
sbarTrack.addEventListener('mousedown', (e)=>{
  if(e.target===sbarThumb) return;
  const rect = sbarTrack.getBoundingClientRect();
  sbarSetScrollByThumbX(e.clientX - rect.left - sbarThumb.clientWidth/2);
});
sbarTrack.addEventListener('touchstart', (e)=>{
  if(e.target===sbarThumb) return;
  const rect = sbarTrack.getBoundingClientRect();
  sbarSetScrollByThumbX(e.touches[0].clientX - rect.left - sbarThumb.clientWidth/2);
}, {passive:true});

/* ===== fit спотлайта ===== */
function fitSpotlightSize(){
  if (isMobileView() && !isStageFull) return;
  const main = tilesMain();
  const tile = main.querySelector('.tile.spotlight');
  if (!tile) return;
  const box = main.getBoundingClientRect();
  const ar = tile.classList.contains('portrait') ? (9/16) : (16/9);
  let w = box.width, h = w / ar;
  if (h > box.height){ h = box.height; w = h * ar; }
  tile.style.width  = Math.floor(w) + 'px';
  tile.style.height = Math.floor(h) + 'px';
}

/* ===== Чат ===== */
function chatPush(author,text){
  const wrap=byId('chatLog');
  if(!wrap) return;
  const row=document.createElement('div'); row.className='chat-row';
  const color=hashColor(author);
  row.innerHTML=`<div class="chat-nick" style="color:${color}">${author}</div><div class="bubble">${text}</div>`;
  wrap.appendChild(row); wrap.scrollTop=wrap.scrollHeight;
}
function sendChatMessage(text){
  if(!text.trim()||!room) return;
  const payload={type:'chat', from:state.me.name, text:text.trim(), ts:Date.now()};
  chatPush(state.me.name, text.trim());
  try{ const data=new TextEncoder().encode(JSON.stringify(payload)); room.localParticipant.publishData(data,{reliable:true}); }catch(e){ console.warn('publishData failed',e); }
}
function wireData(){
  room.on(RoomEvent.DataReceived,(payload,participant)=>{
    try{
      const msg=JSON.parse(new TextDecoder().decode(payload));
      if(msg.type==='chat'){ chatPush(msg.from||participant.identity||'user', msg.text); }
    }catch(e){ console.warn('bad data',e); }
  });
}
byId('chatForm')?.addEventListener('submit',(e)=>{ e.preventDefault(); const v=byId('chatInput').value; if(!v.trim()) return; sendChatMessage(v); byId('chatInput').value=''; });

/* ===== Публикации помощники ===== */
const micPub = ()=>{ try{ return room?.localParticipant?.getTrack(Track.Source.Microphone); }catch{ return null; } };
const camPub = ()=>{ try{ return room?.localParticipant?.getTrack(Track.Source.Camera); }catch{ return null; } };

/* ===== MIC ===== */
function isMicActuallyOn(){
  const lp = room?.localParticipant;
  if (lp && typeof lp.isMicrophoneEnabled === 'boolean') return lp.isMicrophoneEnabled;
  if (lp && typeof lp.isMicrophoneEnabled === 'function') { try { return !!lp.isMicrophoneEnabled(); } catch {} }
  const pub = micPub(); if (!pub) return false;
  const trackEnabled = (pub.track?.isEnabled !== false);
  return pub.isMuted === false && trackEnabled;
}
let micBusy=false;

async function ensureMicOn(){
  if(!room) return;
  const lp = room.localParticipant;
  try{
    if (typeof lp?.setMicrophoneEnabled === 'function'){
      await lp.setMicrophoneEnabled(true, {
        audioCaptureDefaults:{
          echoCancellation:state.settings.ec,
          noiseSuppression:state.settings.ns,
          autoGainControl:state.settings.agc,
          deviceId: state.settings.micDevice||undefined
        }
      });
      const pub = micPub();
      localAudioTrack = pub?.track || localAudioTrack;
      return;
    }
  }catch(e){ console.warn('setMicrophoneEnabled failed, fallback', e); }

  const existing = micPub();
  if (existing){
    if (existing.isMuted) { await (existing.setMuted?.(false) || existing.unmute?.()); }
    localAudioTrack = existing.track || localAudioTrack;
    return;
  }
  try{
    const track = await createLocalAudioTrack({
      echoCancellation:state.settings.ec, noiseSuppression:state.settings.ns, autoGainControl:state.settings.agc,
      deviceId: state.settings.micDevice||undefined
    });
    localAudioTrack = track;
    await room.localParticipant.publishTrack(track, { source: Track.Source.Microphone });
  }catch(e){ console.error(e); alert('Не удалось включить микрофон: '+(e?.message||e)); }
}
async function toggleMic(){
  if(!room || micBusy) return;
  micBusy = true; byId('btnMic').disabled = true;
  try{
    const lp  = room.localParticipant;
    const targetOn = !isMicActuallyOn();
    if (typeof lp?.setMicrophoneEnabled === 'function'){
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
      if (!pub){ if (targetOn){ await ensureMicOn(); pub = micPub(); } }
      else {
        if (targetOn){
          if (typeof pub.unmute === 'function')      await pub.unmute();
          else if (typeof pub.setMuted === 'function') await pub.setMuted(false);
          else if (pub.track?.setEnabled)              pub.track.setEnabled(true);
        } else {
          if (typeof pub.mute === 'function')         await pub.mute();
          else if (typeof pub.setMuted === 'function') await pub.setMuted(true);
          else if (pub.track?.setEnabled)              pub.track.setEnabled(false);
        }
      }
    }
  }catch(e){ alert('Ошибка микрофона: '+(e?.message||e)); }
  finally{ micBusy = false; byId('btnMic').disabled = false; refreshControls(); }
}
byId('btnMic').onclick = toggleMic;

/* ===== КАМЕРА ===== */
function isCamActuallyOn(){
  const lp = room?.localParticipant;
  if (lp && typeof lp.isCameraEnabled === 'boolean') return lp.isCameraEnabled;
  if (lp && typeof lp.isCameraEnabled === 'function') { try { return !!lp.isCameraEnabled(); } catch {} }
  const pub = camPub(); if (!pub) return false;
  const trackEnabled = (pub.track?.isEnabled !== false);
  return pub.isMuted === false && trackEnabled;
}
let camBusy=false;

async function pickCameraDevice(facing){
  try{
    const devs = await navigator.mediaDevices.enumerateDevices();
    const cams = devs.filter(d=>d.kind==='videoinput');
    if(!cams.length) return null;
    const isEnv = facing==='environment';
    const back = cams.find(d=>/back|rear|environment|задн/i.test(d.label||''));
    const front= cams.find(d=>/front|user|впер|селф|self/i.test(d.label||''));
    return isEnv ? (back||cams[1]||cams[0]).deviceId : (front||cams[0]).deviceId;
  }catch{ return null; }
}

async function ensureCameraOn(){
  const devId = state.settings.camDevice || await pickCameraDevice(state.settings.camFacing||'user');
  const constraints = devId
    ? { frameRate:24, deviceId:{ exact: devId } }
    : { frameRate:24, facingMode: { exact: state.settings.camFacing||'user' } };

  const old = localVideoTrack || camPub()?.track || null;
  const newTrack = await createLocalVideoTrack(constraints);
  const pub = camPub();
  if (pub){ await pub.replaceTrack(newTrack); await (pub.setMuted?.(false) || pub.unmute?.()); }
  else { await room.localParticipant.publishTrack(newTrack, { source: Track.Source.Camera }); }

  try { old?.stop?.(); } catch {}
  localVideoTrack = newTrack;
  attachVideoToTile(newTrack, room.localParticipant.identity, true);
  markHasVideo(room.localParticipant.identity, true);
  applyCamTransformsToLive();
}
async function toggleCam(){
  if(!room || camBusy) return;
  camBusy = true; byId('btnCam').disabled = true;
  try{
    const lp = room.localParticipant;
    const targetOn = !isCamActuallyOn();
    if (typeof lp?.setCameraEnabled === 'function'){
      await lp.setCameraEnabled(targetOn, { videoCaptureDefaults:{ deviceId: state.settings.camDevice||undefined } });
    } else {
      let pub = camPub();
      if (!pub){ if (targetOn){ await ensureCameraOn(); pub = camPub(); } }
      else {
        if (targetOn){
          if (typeof pub.unmute === 'function')      await pub.unmute();
          else if (typeof pub.setMuted === 'function') await pub.setMuted(false);
          else if (pub.track?.setEnabled)              pub.track.setEnabled(true);
        } else {
          if (typeof pub.mute === 'function')         await pub.mute();
          else if (typeof pub.setMuted === 'function') await pub.setMuted(true);
          else if (pub.track?.setEnabled)              pub.track.setEnabled(false);
          showAvatarInTile(lp.identity);
        }
      }
    }
    applyLayout();
  }catch(e){ alert('Ошибка камеры: '+(e?.message||e)); }
  finally{ camBusy = false; byId('btnCam').disabled = false; refreshControls(); }
}
byId('btnCam').onclick = toggleCam;

/* ===== Переключение фронт/зад (если есть кнопка #btnFacing) ===== */
async function trySwitchFacingOnSameTrack(newFacing){
  const pub = camPub();
  const lkTrack = pub?.track || localVideoTrack;
  const mst = lkTrack?.mediaStreamTrack;
  if (!mst || typeof mst.applyConstraints !== 'function') return false;
  try{
    const caps = mst.getCapabilities?.() || {};
    if (caps.facingMode && Array.isArray(caps.facingMode) && !caps.facingMode.includes(newFacing)) return false;
    try { await mst.applyConstraints({ facingMode: { exact: newFacing } }); }
    catch { await mst.applyConstraints({ facingMode: newFacing }); }
    const v = getLocalTileVideo();
    if (v){ const tile = v.closest('.tile'); setTimeout(()=> setTileAspectFromVideo(tile, v), 0); applyCamTransformsToLive(); }
    state.settings.camFacing = newFacing; return true;
  }catch{ return false; }
}
async function toggleFacing(){
  if(!room || !isCamActuallyOn() || camBusy) return;
  camBusy = true; const btn = byId('btnFacing'); if (btn) btn.disabled = true;
  const prev = state.settings.camFacing || 'user';
  const next = prev === 'user' ? 'environment' : 'user';
  try{
    if (localVideoTrack?.restartTrack){ await localVideoTrack.restartTrack({ facingMode: next }); state.settings.camFacing = next; }
    else if (await trySwitchFacingOnSameTrack(next)){}
    else {
      state.settings.camFacing = next; state.settings.camDevice = '';
      const newTrack = await createLocalVideoTrack({ facingMode: { ideal: next }, frameRate: 24 });
      const meId = room.localParticipant.identity;
      const pub = camPub();
      attachVideoToTile(newTrack, meId, true);
      if (pub){ await pub.replaceTrack(newTrack); try { localVideoTrack?.stop(); } catch {} }
      else { await room.localParticipant.publishTrack(newTrack, { source: Track.Source.Camera }); }
      localVideoTrack = newTrack; markHasVideo(meId, true); applyCamTransformsToLive();
    }
    applyLayout();
  }catch(e){ state.settings.camFacing = prev; alert('Не удалось переключить камеру: ' + (e?.message||e)); }
  finally{ camBusy = false; if (btn) btn.disabled = false; refreshControls(); }
}
byId('btnFacing')?.addEventListener('click', toggleFacing);

/* ===== Прочие кнопки ===== */
function refreshControls(){
  const mpOn = isMicActuallyOn();
  const cpOn = isCamActuallyOn();
  const shareOn = state.me.share===true || (isMobileView() && !!state.me._mobileRotateOpen);
  byId('btnMic')?.classList.toggle('active', mpOn);
  byId('btnCam')?.classList.toggle('active', cpOn);
  byId('btnShare')?.classList.toggle('active', shareOn);

  const facingBtn = byId('btnFacing');
  if (facingBtn) facingBtn.hidden = !(isMobileView() && cpOn);

  const shareBtn = byId('btnShare');
  if (shareBtn) shareBtn.hidden = isMobileView(); // мобильным — кнопка скрыта (есть per-tile overlay)
}
function setShareButtonMode(){
  const btn = byId('btnShare');
  if (!btn) return;
  btn.hidden = isMobileView();
  if (!isMobileView()) btn.title = 'Шарить экран';
}

/* ===== Leave: аккуратный выход + центрирование логина ===== */
byId('btnLeave').onclick = async ()=>{ sfx('self-leave'); await leaveRoom(); };
async function leaveRoom(){
  try{
    const lp = room?.localParticipant;
    try{ if(lp?.setMicrophoneEnabled) await lp.setMicrophoneEnabled(false); else await micPub()?.setMuted?.(true); }catch{}
    try{ if(lp?.setCameraEnabled) await lp.setCameraEnabled(false); else await camPub()?.setMuted?.(true); }catch{}
    try{ localVideoTrack?.stop(); }catch{}
    try{ localAudioTrack?.stop(); }catch{}
    await stopScreenShare();
    if(room){ await room.disconnect(); }
  }catch{}
  registry.clear(); byId('onlineList').innerHTML=''; byId('tilesMain').innerHTML=''; byId('tilesRail').innerHTML='';
  if (ov.classList.contains('open')) await closeTileOverlay();

  // сбросим полноэкран/ориентацию и прокрутку
  try{ if(document.fullscreenElement) await document.exitFullscreen(); }catch{}
  try{ if(screen.orientation.unlock) screen.orientation.unlock(); }catch{}
  document.body.classList.remove('no-scroll'); isStageFull=false;

  show('screen-auth'); hide('screen-app'); // логин уже центрируется CSS-ом
}

/* Горячая клавиша M — mute/unmute */
document.addEventListener('keydown', (e)=>{ if (e.key && e.key.toLowerCase()==='m' && !e.repeat) toggleMic(); });

/* ===== Шеринг экрана (только десктоп) ===== */
byId('btnShare').onclick = async ()=>{
  if(!room || isMobileView()) return;
  try{
    if(state.me.share){ await stopScreenShare(); }
    else {
      const tracks=await createLocalScreenTracks({ audio:true });
      screenTracks=tracks;
      for(const t of tracks){ await room.localParticipant.publishTrack(t); }
      state.me.share=true;
      const vTrack=tracks.find(t=>t.kind==='video');
      if(vTrack){ attachVideoToTile(vTrack, room.localParticipant.identity+'#screen', true, 'Экран'); }
    }
    applyLayout();
  }catch(e){ alert('Ошибка шаринга экрана: '+(e?.message||e)); }
  refreshControls();
};
async function stopScreenShare(){
  try{
    for(const t of screenTracks){ try{ await room.localParticipant.unpublishTrack(t); }catch{} try{ t.stop(); }catch{} }
  }catch{}
  screenTracks=[]; state.me.share=false;
  showAvatarInTile(room?.localParticipant?.identity+'#screen');
  applyLayout();
}

/* ===== FULLSCREEN сцены ===== */
const stageEl = byId('stage');
const btnFS   = byId('btnStageFS');
const btnClose= byId('btnStageClose');
btnFS?.addEventListener('click', ()=> toggleStageFullscreen(true));
btnClose?.addEventListener('click', ()=> toggleStageFullscreen(false));
document.addEventListener('keydown', (e)=>{ if(e.key==='Escape' && isStageFull){ toggleStageFullscreen(false); }});
document.addEventListener('fullscreenchange', ()=>{ if(!document.fullscreenElement && isStageFull){ exitStageOverlay(); }});
async function toggleStageFullscreen(on){ if(on==null) on=!isStageFull; if(on){ await enterStageOverlay(); } else { await exitStageOverlay(); } fitSpotlightSize(); }
async function enterStageOverlay(){
  if(isStageFull) return; isStageFull=true;
  document.body.classList.add('no-scroll'); stageEl.classList.add('stage-full'); if(btnClose) btnClose.hidden=false;
  try{ if(stageEl.requestFullscreen){ await stageEl.requestFullscreen({ navigationUI:'hide' }); } else if(stageEl.webkitRequestFullscreen){ stageEl.webkitRequestFullscreen(); } }catch{}
  try{ await screen.orientation.lock('landscape'); }catch{}
  applyLayout();
}
async function exitStageOverlay(){
  if(!isStageFull) return; isStageFull=false;
  document.body.classList.remove('no-scroll'); stageEl.classList.remove('stage-full'); if(btnClose) btnClose.hidden=true;
  try{ if(document.fullscreenElement){ await document.exitFullscreen(); } else if(document.webkitFullscreenElement){ document.webkitCancelFullScreen(); } }catch{}
  try{ if(screen.orientation.unlock) screen.orientation.unlock(); }catch{}
  applyLayout();
}

/* ===== Настройки + предпросмотр + «Экономия трафика» ===== */
const settingsModal = byId('settingsModal');
const btnSettings   = byId('btnSettings');
const btnSettingsClose = byId('settingsClose');
const backdrop = byId('settingsBackdrop');

function openSettings(){ settingsModal?.classList.add('open'); settingsModal?.setAttribute('aria-hidden','false'); fillDeviceSelects(); startCamPreview(); }
function closeSettings(){ stopCamPreview(); settingsModal?.classList.remove('open'); settingsModal?.setAttribute('aria-hidden','true'); }
btnSettings?.addEventListener('click', openSettings);
btnSettingsClose?.addEventListener('click', closeSettings);
backdrop?.addEventListener('click', closeSettings);
byId('settingsSave')?.addEventListener('click', ()=>{ applySettingsFromModal(true); });
byId('settingsApply')?.addEventListener('click', ()=>{ applySettingsFromModal(false); });

async function fillDeviceSelects(){
  try{
    const devs=await navigator.mediaDevices.enumerateDevices();
    const mics=devs.filter(d=>d.kind==='audioinput');
    const cams=devs.filter(d=>d.kind==='videoinput');
    const micSel=byId('micSel'), camSel=byId('camSel');
    const fill=(sel,items,cur)=>{ if(!sel) return; sel.innerHTML=''; sel.appendChild(new Option('По умолчанию','')); items.forEach((d,i)=> sel.appendChild(new Option(d.label||`${d.kind} ${i+1}`, d.deviceId))); if(cur) sel.value=cur; };
    fill(micSel,mics,state.settings.micDevice); fill(camSel,cams,state.settings.camDevice);
    byId('nsChk') && (byId('nsChk').checked=state.settings.ns);
    byId('ecChk') && (byId('ecChk').checked=state.settings.ec);
    byId('agcChk') && (byId('agcChk').checked=state.settings.agc);
    byId('lowQChk') && (byId('lowQChk').checked=state.settings.lowQuality);
  }catch(e){ console.warn('enumerateDevices error',e); }
}

async function applySettingsFromModal(closeAfter){
  if(byId('micSel')) state.settings.micDevice=byId('micSel').value;
  if(byId('camSel')) state.settings.camDevice=byId('camSel').value;
  if(byId('nsChk'))  state.settings.ns=byId('nsChk').checked;
  if(byId('ecChk'))  state.settings.ec=byId('ecChk').checked;
  if(byId('agcChk')) state.settings.agc=byId('agcChk').checked;
  if(byId('lowQChk')) state.settings.lowQuality=byId('lowQChk').checked;

  // заменить мик на лету (если опубликован)
  try{
    const mp = micPub();
    if (mp){
      const newMic = await createLocalAudioTrack({
        echoCancellation:state.settings.ec, noiseSuppression:state.settings.ns, autoGainControl:state.settings.agc,
        deviceId: state.settings.micDevice||undefined
      });
      const oldA = localAudioTrack || mp.track;
      await mp.replaceTrack(newMic); await (mp.setMuted?.(false) || mp.unmute?.());
      try{ oldA?.stop?.(); }catch{}
      localAudioTrack=newMic;
    }
  }catch(e){ console.warn('mic replace error', e); }

  // заменить камеру на лету (если включена)
  try{
    const cp = camPub();
    if (cp && isCamActuallyOn()){
      const devId = state.settings.camDevice || await pickCameraDevice(state.settings.camFacing||'user');
      const constraints = devId
        ? { frameRate:24, deviceId:{ exact: devId } }
        : { frameRate:24, facingMode: { exact: state.settings.camFacing||'user' } };
      const oldV = localVideoTrack || cp.track;
      const newCam = await createLocalVideoTrack(constraints);
      await cp.replaceTrack(newCam); await (cp.setMuted?.(false) || cp.unmute?.());
      try{ oldV?.stop?.(); }catch{}
      localVideoTrack=newCam;
      attachVideoToTile(newCam, room.localParticipant.identity, true);
      markHasVideo(room.localParticipant.identity, true);
      applyCamTransformsToLive();
      applyLayout();
    }
  }catch(e){ console.warn('cam replace error', e); }

  // глобально понизить качество подписок (если чекбокс есть и включён)
  if (state.settings.lowQuality){
    try{
      room?.remoteParticipants?.forEach(p=>{
        p?.tracks?.forEach(pub=>{
          if(pub?.setVideoQuality) pub.setVideoQuality('low');
        });
      });
    }catch(e){ console.warn('quality set error', e); }
  }

  applyPreviewTransforms(); refreshControls();
  if (closeAfter) closeSettings();
}

async function startCamPreview(){
  stopCamPreview();
  try{
    // на мобиле, если основная камера уже включена — не открываем второй поток превью
    if (isMobileView() && isCamActuallyOn()){
      if(byId('camHint')){ byId('camHint').textContent='Камера уже используется — предпросмотр отключён на мобиле'; byId('camHint').style.display='block'; }
      return;
    }
    const opts={}; if(state.settings.camDevice) opts.deviceId={ exact: state.settings.camDevice };
    previewTrack=await createLocalVideoTrack({ frameRate:24, ...opts });
    const v=previewTrack.attach();
    const wrap=byId('camPreview'); if(!wrap) return;
    wrap.querySelector('video')?.remove();
    if(byId('camHint')) byId('camHint').style.display='none';
    wrap.appendChild(v);
    applyPreviewTransforms();
  }catch(e){
    if(byId('camHint')){ byId('camHint').textContent='Не удалось открыть камеру: '+(e?.message||e); byId('camHint').style.display='block'; }
    console.warn('preview error',e);
  }
}
function stopCamPreview(){ try{ if(previewTrack){ previewTrack.attach()?.remove(); previewTrack.stop(); previewTrack=null; } if(byId('camHint')) byId('camHint').style.display=''; }catch{} }
function applyPreviewTransforms(){
  const v=byId('camPreview')?.querySelector('video'); if(!v) return;
  const rot=state.settings.camFlip?' rotate(180deg)':''; const mir=state.settings.camMirror?' scaleX(-1)':'';
  v.style.transform=mir+rot;
}
byId('btnCamFlip')?.addEventListener('click', ()=>{ state.settings.camFlip=!state.settings.camFlip; applyPreviewTransforms(); applyCamTransformsToLive(); });

/* ===== RTT / пинг (ICE) ===== */
function lkPCs(room){
  const e = room?.engine || {};
  const raw = [
    e.client?.publisher?.pc, e.client?.subscriber?.pc,
    e.publisher?.pc, e.subscriber?.pc,
    e.publisherTransport?.pc, e.subscriberTransport?.pc,
    e.pcManager?.publisherPC, e.pcManager?.subscriberPC,
    e.pcManager?.publisher?.pc, e.pcManager?.subscriber?.pc,
  ].filter(pc => pc && typeof pc.getStats === 'function');
  let pub=null, sub=null;
  for (const pc of raw){
    const sdp = pc.currentLocalDescription?.sdp || pc.localDescription?.sdp || '';
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
    if (rep.type === 'transport' && rep.selectedCandidatePairId){
      const p = stats.get(rep.selectedCandidatePairId);
      if (p && typeof p.currentRoundTripTime === 'number'){
        rtt = Math.round(p.currentRoundTripTime * 1000);
      }
    }
    if (rep.type === 'candidate-pair' && (rep.nominated||rep.selected) && rep.state==='succeeded' && typeof rep.currentRoundTripTime==='number'){
      rtt = Math.round(rep.currentRoundTripTime * 1000);
    }
  });
  return rtt;
}
function fmtRTT(ms){ return (typeof ms === 'number') ? `${ms} ms` : '—'; }
async function updateNetRTT(){
  try{
    const { pub, sub } = lkPCs(room);
    const [up, down] = await Promise.all([iceRttForPC(pub), iceRttForPC(sub)]);
    const badge = document.getElementById('netRTT'); if (badge) badge.textContent = `RTT ↑${fmtRTT(up)} / ↓${fmtRTT(down)}`;
    const ms = (typeof up === 'number') ? up : down;
    const dot  = document.getElementById('pingDot');
    const label= document.getElementById('mePingVal');
    if (typeof ms === 'number'){ label.textContent = `${ms} ms`; dot.className = 'dot ' + (ms < 60 ? 'ok' : ms < 120 ? 'warn' : 'bad'); }
    else { label.textContent = '—'; dot.className = 'dot off'; }
  }catch(e){ console.warn('updateNetRTT error', e); }
}
function startPingLoop(){ stopPingLoop(); updateNetRTT(); pingTimer = setInterval(updateNetRTT, 1500); }
function stopPingLoop(){ if (pingTimer){ clearInterval(pingTimer); pingTimer = null; } }

/* ===== Индикатор-«точки» для foot-swipe (если есть) ===== */
const footSwipe = byId('footSwipe');
const footDots  = byId('footDots');
function initFootDots(){
  if (!footSwipe || !footDots) return;
  const panes = footSwipe.querySelectorAll('.foot-pane').length;
  footDots.innerHTML = '';
  const shouldShow = isMobileView() && panes > 1;
  footDots.setAttribute('aria-hidden', shouldShow ? 'false' : 'true');
  footDots.style.display = shouldShow ? 'flex' : 'none';
  if (!shouldShow) return;
  for (let i=0;i<panes;i++){
    const b=document.createElement('button');
    b.type='button'; b.className='fdot'; b.setAttribute('aria-label',`Панель ${i+1}`);
    b.addEventListener('click', ()=> footSwipe.scrollTo({left: i * footSwipe.clientWidth, behavior:'smooth'}));
    footDots.appendChild(b);
  }
  updateFootDotsActive();
}
function updateFootDotsActive(){
  if (!footSwipe || !footDots || footDots.children.length===0) return;
  const idx = Math.round(footSwipe.scrollLeft / footSwipe.clientWidth);
  [...footDots.children].forEach((b,i)=>{
    b.classList.toggle('active', i===idx);
    b.setAttribute('aria-current', i===idx ? 'true' : 'false');
  });
}
footSwipe?.addEventListener('scroll', ()=> updateFootDotsActive(), {passive:true});

/* ===== Инициализация ===== */
document.addEventListener('DOMContentLoaded', ()=>{
  const qs=new URLSearchParams(location.search);
  if(qs.get('room')) byId('room').value=qs.get('room');
  if(qs.get('user')) byId('name').value=qs.get('user');

  const ro = new ResizeObserver(()=> fitSpotlightSize()); ro.observe(byId('tilesMain'));
  window.addEventListener('resize', ()=>{
    fitSpotlightSize();
    if (isMobileView() && !isStageFull){ document.querySelectorAll('.tile').forEach(t=>t.classList.remove('portrait')); }
    updateMobileScrollbar(false);
    setShareButtonMode();
    initFootDots();
    refreshControls();
  });

  updateMobileScrollbar(false);
  setShareButtonMode();
  initFootDots();
  refreshControls();
});
