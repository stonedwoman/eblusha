/* ===== Глобальное состояние (мутабельный контейнер) ===== */
export const state = {
  me:{ name:'Me', room:'room', share:false },
  settings:{
    ns:true, ec:true, agc:true,
    micDevice:'', camDevice:'',
    camFlip:false, camFacing:'user'
  }
};

export const ctx = {
  room: null,
  localAudioTrack: null,
  localVideoTrack: null,
  screenTracks: [],
  pingTimer: null,
  statsPC: null,
  previewTrack: null,
  registry: new Map(),
  pinnedId: null,
  isStageFull: false
};

/* заглушка */
export function setQualityIndicator(q){
  try{
    const lp = ctx.room?.localParticipant; if (!lp) return;
    const pid = lp.identity;
    const tile = document.querySelector(`.tile[data-pid="${CSS.escape(pid)}"] .name`);
    if (!tile) return;
    let qa = tile.querySelector('.aq');
    if (!qa){ qa = document.createElement('span'); qa.className='aq'; tile.appendChild(qa); }
    const label = q===3?'Excellent': q===2?'Good': q===1?'Poor': '—';
    qa.textContent = label;
  }catch{}
}
