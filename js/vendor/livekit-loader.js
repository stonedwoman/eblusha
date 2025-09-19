/* ===== LiveKit loader ===== */
export async function loadLiveKitSafe(){
  if (window.LivekitClient) return window.LivekitClient;
  if (window.LiveKitClient) return window.LiveKitClient;
  if (window.livekit) return window.livekit;
  try { return await import('https://cdn.skypack.dev/livekit-client'); } catch {}
  try { return await import('https://esm.sh/livekit-client'); } catch {}
  await new Promise((res, rej)=>{
    const s=document.createElement('script');
    s.src='https://cdn.jsdelivr.net/npm/livekit-client@2/dist/livekit-client.min.js';
    s.async=true; s.onload=res; s.onerror=rej;
    document.head.appendChild(s);
  });
  return window.LivekitClient || window.LiveKitClient || window.livekit;
}

export const LK = await loadLiveKitSafe();
export const {
  Room, RoomEvent, Track,
  createLocalAudioTrack, createLocalVideoTrack, createLocalScreenTracks,
  ConnectionQuality, LogLevel, setLogLevel
} = LK;

try { setLogLevel?.(LogLevel?.debug||'debug'); } catch {}
