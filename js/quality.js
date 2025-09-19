import { ctx, state } from "./state.js";
import { VideoQuality } from "./vendor/livekit-loader.js";

// Apply quality to a single RemoteTrackPublication (video only)
export function applyPubQuality(pub){
  try{
    if (!pub) return;
    // some SDKs expose kind or track?.kind; guard both
    const kind = pub.kind || pub.track?.kind;
    if (kind !== 'video') return;
    if (typeof pub.setVideoQuality === 'function'){
      const q = state.settings.lowQuality ? (VideoQuality?.LOW||'low') : (VideoQuality?.HIGH||'high');
      pub.setVideoQuality(q);
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
      // In lowQuality mode let adaptiveStream shrink; in highQuality force full receive
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

  // Also try to raise our local encoding if SDK provides it (dynacast/highest layer)
  try{
    const lp = room.localParticipant;
    if (lp && typeof lp.setCameraCaptureDefaults === 'function'){
      // no change here; capture defaults are handled elsewhere
    }
    // For subscribers, LiveKit decides the layer; we just request high via publication
  }catch{}
}


