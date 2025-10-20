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
    const s = a.map(x=> (typeof x==='string' ? x : (x && x.message ? x.message : JSON.stringify(x)))).join(' ');
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

function tokenUrl(){
  try{
    // Если страница открыта как file:// — используем абсолютный URL к токен-эндпоинту
    if (!/^https?:/i.test(location.protocol)) return 'https://eblusha.org/token';
  }catch{}
  return TOKEN_ENDPOINT;
}

async function fetchToken(roomId, name){
  const url = `${tokenUrl()}?room=${encodeURIComponent(roomId)}&user=${encodeURIComponent(name)}`;
  const r = await fetch(url, { mode:'cors' });
  const raw = await r.text();
  if (!r.ok){
    throw new Error('token http '+r.status+' '+raw.slice(0,180));
  }
  // Поддержка двух форматов: "{ token: '...' }" и просто строка токена
  let token = raw.trim();
  try{
    if (/^\s*\{/.test(raw)){
      const j = JSON.parse(raw);
      token = (j && (j.token || j.accessToken || j.jwt)) ? (j.token || j.accessToken || j.jwt) : token;
    }
  }catch{}
  if (!token || token.length < 10) throw new Error('empty token');
  return token;
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

function logVideoMeta(prefix){
  try{
    const w = vCam?.videoWidth|0, h = vCam?.videoHeight|0;
    const s = localVideoTrack?.mediaStreamTrack?.getSettings?.() || {};
    log(`${prefix}: video ${w}x${h}, settings ${s.width||'?'}x${s.height||'?'} ar=${(w&&h)?(w/h).toFixed(3):'?'} facing=${facing}`);
  }catch{}
}

['loadedmetadata','resize','loadeddata'].forEach(ev=>{
  vCam.addEventListener(ev, ()=> logVideoMeta(ev));
});

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

function capturePrefs(){
  try{
    const s = localVideoTrack?.mediaStreamTrack?.getSettings?.() || {};
    const w = s.width|0, h = s.height|0;
    const ar = (w>0 && h>0) ? (w/h) : undefined;
    const vw = vCam?.videoWidth|0, vh = vCam?.videoHeight|0;
    const ar2 = (!ar && vw>0 && vh>0) ? (vw/vh) : ar;
    return {
      width: (w||vw)||undefined,
      height: (h||vh)||undefined,
      aspectRatio: ar2||undefined
    };
  }catch{ return { width:undefined, height:undefined, aspectRatio:undefined }; }
}

async function pickCameraDevice(nextFacing){
  try{
    const devs = await navigator.mediaDevices.enumerateDevices();
    const cams = devs.filter(d=> d.kind==='videoinput');
    if (!cams.length) return null;
    const isEnv = nextFacing==='environment';
    const back  = cams.find(d=>/back|rear|environment|задн/i.test(d.label||''));
    const front = cams.find(d=>/front|user|впер|селф|self/i.test(d.label||''));
    return isEnv ? (back||cams[1]||cams[0]).deviceId : (front||cams[0]).deviceId;
  }catch{ return null; }
}

async function startCam(){
  try{
    if (!room) { setStatus('нет подключения'); log('cam error: room not connected'); return; }
    if (localVideoTrack){ return; }
    const devId = await pickCameraDevice(facing);
    const prefs = capturePrefs();
    const constraints = devId ? {
      deviceId: { exact: devId },
      ...(prefs.width  ? { width:  { ideal: prefs.width  } } : {}),
      ...(prefs.height ? { height: { ideal: prefs.height } } : {}),
      ...(prefs.aspectRatio ? { aspectRatio: { ideal: prefs.aspectRatio } } : {})
    } : {
      ...(facing ? { facingMode: { ideal: facing } } : {}),
      ...(prefs.width  ? { width:  { ideal: prefs.width  } } : {}),
      ...(prefs.height ? { height: { ideal: prefs.height } } : {}),
      ...(prefs.aspectRatio ? { aspectRatio: { ideal: prefs.aspectRatio } } : {})
    };
    const t = await createLocalVideoTrack(constraints);
    localVideoTrack = t;
    attachTo(vCam, t);
    await room.localParticipant.publishTrack(t, { source: Track.Source.Camera });
    log('cam started');
  }catch(e){ log('cam error:', e?.message||e); }
}

async function stopCam(){
  try{
    const pub = room?.localParticipant?.getTrack?.(Track.Source.Camera) || null;
    if (pub){ await pub.setMuted?.(true); }
    if (localVideoTrack){ try{ localVideoTrack.stop(); }catch{}; localVideoTrack = null; }
    vCam.srcObject = null; vCam.removeAttribute('src');
    log('cam stopped');
  }catch(e){ log('stopCam error:', e?.message||e); }
}

async function toggleFacing(){
  try{
    if (!room){ log('toggleFacing: not connected'); return; }
    facing = (facing === 'user') ? 'environment' : 'user';
    const prefs = capturePrefs();
    if (localVideoTrack?.restartTrack){
      // сначала пробуем exact AR/размеры, затем fallback на ideal
      try{
        await localVideoTrack.restartTrack({
          facingMode: facing,
          ...(prefs.width  ? { width:  { exact: prefs.width  } } : {}),
          ...(prefs.height ? { height: { exact: prefs.height } } : {}),
          ...(prefs.aspectRatio ? { aspectRatio: { exact: prefs.aspectRatio } } : {})
        });
      }catch{
        await localVideoTrack.restartTrack({
          facingMode: facing,
          ...(prefs.width  ? { width:  { ideal: prefs.width  } } : {}),
          ...(prefs.height ? { height: { ideal: prefs.height } } : {}),
          ...(prefs.aspectRatio ? { aspectRatio: { ideal: prefs.aspectRatio } } : {})
        });
      }
      attachTo(vCam, localVideoTrack);
      log('facing via restartTrack', facing);
      logVideoMeta('after restart');
      return;
    }
    // recreate with deviceId if available
    const devId = await pickCameraDevice(facing);
    const cNew = devId ? {
      deviceId: { exact: devId },
      ...(prefs.width  ? { width:  { ideal: prefs.width  } } : {}),
      ...(prefs.height ? { height: { ideal: prefs.height } } : {}),
      ...(prefs.aspectRatio ? { aspectRatio: { ideal: prefs.aspectRatio } } : {})
    } : {
      facingMode: { ideal: facing },
      ...(prefs.width  ? { width:  { ideal: prefs.width  } } : {}),
      ...(prefs.height ? { height: { ideal: prefs.height } } : {}),
      ...(prefs.aspectRatio ? { aspectRatio: { ideal: prefs.aspectRatio } } : {})
    };
    const prev = localVideoTrack;
    const pub = room.localParticipant?.getTrack?.(Track.Source.Camera) || null;
    const newTrack = await createLocalVideoTrack(cNew);
    if (pub){ await pub.replaceTrack(newTrack); try{ prev?.stop(); }catch{}; }
    else { await room.localParticipant.publishTrack(newTrack, { source: Track.Source.Camera }); }
    localVideoTrack = newTrack; attachTo(vCam, newTrack);
    log('facing via recreate', facing);
    logVideoMeta('after recreate');
  }catch(e){ log('toggleFacing error:', e?.message||e); }
}

btnStartScreen.addEventListener('click', startScreen);
btnStartCam.addEventListener('click', startCam);
btnToggleFacing.addEventListener('click', toggleFacing);
btnStopCam.addEventListener('click', stopCam);

(async()=>{
  try{
    await join();
    try{ await startScreen(); }catch{}
  }catch(e){ setStatus('ошибка'); log('join error:', e?.message||e); }
})();


