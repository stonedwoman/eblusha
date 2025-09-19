/* ===== Глобальное состояние (мутабельный контейнер) ===== */
export const state = {
  me:{ name:'Me', room:'room', share:false },
  settings:{
    ns:true, ec:true, agc:true,
    micDevice:'', camDevice:'',
    camFlip:false, camMirror:false, camFacing:'user',
    lowQuality:false
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
export function setQualityIndicator(_q){}
