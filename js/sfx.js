/* ===== SFX ===== */
let audioCtx=null;
function ensureAudio(){
  if(!audioCtx){
    audioCtx = new (window.AudioContext||window.webkitAudioContext)();
  }
  return audioCtx;
}

export function beep(freq=880, dur=0.12, type='sine', vol=0.05, when=0){
  const ctx=ensureAudio(); const t0=ctx.currentTime+when;
  const o=ctx.createOscillator(); const g=ctx.createGain();
  o.type=type; o.frequency.value=freq;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(vol, t0+0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0+dur);
  o.connect(g).connect(ctx.destination);
  o.start(t0); o.stop(t0+dur+0.02);
}

export function sfx(kind){
  if(kind==='self-join'){ beep(1100,0.09,'triangle',0.06); beep(1500,0.07,'triangle',0.05,0.08); }
  else if(kind==='self-leave'){ beep(700,0.08,'sine',0.05); beep(500,0.12,'sine',0.05,0.07); }
  else if(kind==='peer-join'){ beep(900,0.07,'square',0.05); }
  else if(kind==='peer-leave'){ beep(520,0.10,'square',0.05); }
}
