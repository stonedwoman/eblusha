import { Room, Track, createLocalVideoTrack, createLocalScreenTracks } from './vendor/livekit-loader.js';
import { LIVEKIT_WS_URL, TOKEN_ENDPOINT } from './config.js';

const logEl = document.getElementById('log');
const statusEl = document.getElementById('status');
const meTag = document.getElementById('meTag');
const vCam = document.getElementById('camVideo');
const vScr = document.getElementById('screenVideo');
const btnStartScreen = document.getElementById('btnStartScreen');
const btnStartCam = document.getElementById('btnStartCam');
const btnToggleFacing = document.getElementById('btnToggleFacing');
const btnStopCam = document.getElementById('btnStopCam');

function log(...a){
  try{
    const s = a.map(x=> typeof x==='string'? x : JSON.stringify(x)).join(' ');
    logEl.textContent += s + '\n';
    logEl.scrollTop = logEl.scrollHeight;
  }catch{}
}
function setStatus(s){ statusEl.textContent = 'Статус: ' + s; }

let room = null;
let localVideoTrack = null;
let screenVideoTrack = null;
let facing = 'user';

function randName(){ return 'u' + Math.random().toString(36).slice(2, 8); }

async function fetchToken(roomId, name){
  const r = await fetch(`${TOKEN_ENDPOINT}?room=${encodeURIComponent(roomId)}&user=${encodeURIComponent(name)}`);
  if (!r.ok) throw new Error('token http '+r.status);
  return r.text();
}

async function join(){
  const user = randName();
  const roomId = '123';
  meTag.textContent = `${user}@${roomId}`;
  setStatus('получаем токен…');
  const token = await fetchToken(roomId, user);
  setStatus('подключаемся…');
  room = new Room({ autoSubscribe:true, adaptiveStream:true, dynacast:true });
  await room.connect(LIVEKIT_WS_URL, token);
  setStatus('подключены');
  log('connected');
}

function attachTo(el, track){
  try{
    el.srcObject = new MediaStream([track.mediaStreamTrack]);
    el.play?.();
  }catch(e){ log('attach error', e?.message||e); }
}

async function startScreen(){
  try{
    const tracks = await createLocalScreenTracks({ audio:false });
    const v = tracks.find(t=>t.kind==='video');
    if (v){
      screenVideoTrack = v;
      attachTo(vScr, v);
      await room.localParticipant.publishTrack(v, { source: Track.Source.ScreenShare });
      log('screen started');
    }
  }catch(e){ log('screen error:', e?.message||e); }
}

async function startCam(){
  try{
    if (localVideoTrack){ return; }
    // no mirroring, no fixed frameRate, minimal constraints
    const constraints = facing ? { facingMode: { ideal: facing } } : {};
    const t = await createLocalVideoTrack(constraints);
    localVideoTrack = t;
    attachTo(vCam, t);
    await room.localParticipant.publishTrack(t, { source: Track.Source.Camera });
    log('cam started');
  }catch(e){ log('cam error:', e?.message||e); }
}

async function stopCam(){
  try{
    const pubs = room.localParticipant?.getTrack?.(Track.Source.Camera);
    const pub = pubs || null;
    if (pub){ await pub.setMuted?.(true); }
    if (localVideoTrack){ try{ localVideoTrack.stop(); }catch{}; localVideoTrack = null; }
    vCam.srcObject = null; vCam.removeAttribute('src');
    log('cam stopped');
  }catch(e){ log('stopCam error:', e?.message||e); }
}

async function toggleFacing(){
  try{
    facing = (facing === 'user') ? 'environment' : 'user';
    if (localVideoTrack?.restartTrack){
      await localVideoTrack.restartTrack({ facingMode: facing });
      attachTo(vCam, localVideoTrack);
      log('facing via restartTrack', facing);
      return;
    }
    // recreate
    const prev = localVideoTrack; const pubs = room.localParticipant?.getTrack?.(Track.Source.Camera);
    const newTrack = await createLocalVideoTrack({ facingMode: { ideal: facing } });
    if (pubs){ await pubs.replaceTrack(newTrack); try{ prev?.stop(); }catch{}; }
    else { await room.localParticipant.publishTrack(newTrack, { source: Track.Source.Camera }); }
    localVideoTrack = newTrack; attachTo(vCam, newTrack);
    log('facing via recreate', facing);
  }catch(e){ log('toggleFacing error:', e?.message||e); }
}

btnStartScreen.addEventListener('click', startScreen);
btnStartCam.addEventListener('click', startCam);
btnToggleFacing.addEventListener('click', toggleFacing);
btnStopCam.addEventListener('click', stopCam);

(async()=>{
  try{
    await join();
    // авто-старт экрана по запросу пользователя чаще успешен, поэтому оставим кнопку.
    // но попробуем мягко запустить без аудио — если заблокировано, просто будет ошибка в лог.
    try{ await startScreen(); }catch{}
  }catch(e){ setStatus('ошибка'); log('join error:', e?.message||e); }
})();


