import { ctx, state } from "./state.js";

// Apply quality to a single RemoteTrackPublication (video only)
export function applyPubQuality(pub){
  try{
    if (!pub) return;
    // some SDKs expose kind or track?.kind; guard both
    const kind = pub.kind || pub.track?.kind;
    if (kind !== 'video') return;
    if (typeof pub.setVideoQuality === 'function'){
      pub.setVideoQuality(state.settings.lowQuality ? 'low' : 'high');
    }
  }catch{}
}

// Apply global quality mode across the room
export function applyGlobalVideoQualityMode(){
  const room = ctx.room;
  if (!room) return;

  // Toggle adaptive stream: lowQuality => enable adaptive; high mode => disable adaptive
  try{
    if (typeof room.setAdaptiveStream === 'function'){
      room.setAdaptiveStream(!!state.settings.lowQuality);
    }
  }catch{}

  try{
    // Remote participants: set desired quality for all existing video pubs
    const participants = Array.from(room.participants?.values?.() || []);
    participants.forEach(p=>{
      try{
        // publications can be in different collections depending on SDK version
        const pubs = [];
        try { p.videoTracks?.forEach?.(pub=> pubs.push(pub)); } catch{}
        try { p.trackPublications?.forEach?.(pub=> pubs.push(pub)); } catch{}
        try { p.tracks?.forEach?.(pub=> pubs.push(pub)); } catch{}
        pubs.forEach(pub=> applyPubQuality(pub));
      }catch{}
    });
  }catch{}
}


