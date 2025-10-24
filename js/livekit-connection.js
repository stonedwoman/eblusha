import { Room, RoomEvent, Track } from "./vendor/livekit-loader.js";
import { LIVEKIT_WS_URL } from "./config.js";
import { ctx, state, setQualityIndicator } from "./state.js";
import { registerParticipant, unregisterParticipant, markHasVideo, recomputeHasVideo } from "./registry.js";
import { attachAudioTrack, attachVideoToTile, showAvatarInTile, dedupeTilesByPid, cleanupOrphanDom, removeTileByPid } from "./tiles.js";
import { applyLayout, highlightSpeaking } from "./layout.js";
import { refreshControls } from "./controls.js";
import { wireData } from "./chat-session.js";
import { ensureMicOn } from "./media.js";
import { startPingLoop } from "./ui-settings-ice-init.js";
import { sfx } from "./sfx.js";

const SCREEN_LABEL = "Экран";
const SCREEN_SUFFIX = "#screen";
const VIDEO_GUARD_KEY = "__eblkVideoGuard";

const scheduleStageRefresh = (() => {
  let raf = 0;
  const run = () => {
    raf = 0;
    try { dedupeTilesByPid(); } catch {}
    try { cleanupOrphanDom(); } catch {}
    try { applyLayout(); } catch {}
    try { refreshControls(); } catch {}
  };
  return () => {
    if (raf) return;
    raf = requestAnimationFrame(run);
  };
})();

const isScreenPublication = (publication) => {
  const src = publication?.source;
  return src === Track.Source.ScreenShare || src === Track.Source.ScreenShareAudio;
};

const makeTileId = (participant, publication) => {
  if (!participant) return "";
  return participant.identity + (isScreenPublication(publication) ? SCREEN_SUFFIX : "");
};

const ensureParticipant = (participant) => {
  if (!participant) return;
  try { registerParticipant(participant); } catch {}
};

const ensurePublicationSubscribed = (publication, participant) => {
  if (!publication || participant?.isLocal) return;
  try {
    if (typeof publication.setSubscribed === "function" && publication.isSubscribed === false) {
      publication.setSubscribed(true).catch(() => {});
    }
  } catch {}
};

const listPublications = (participant) => {
  const out = new Set();
  try { participant?.tracks?.forEach?.((pub) => out.add(pub)); } catch {}
  try { participant?.trackPublications?.forEach?.((pub) => out.add(pub)); } catch {}
  try { participant?.videoTracks?.forEach?.((pub) => out.add(pub)); } catch {}
  try { participant?.audioTracks?.forEach?.((pub) => out.add(pub)); } catch {}
  try {
    const arr = participant?.getTrackPublications?.();
    if (Array.isArray(arr)) arr.forEach((pub) => out.add(pub));
  } catch {}
  return Array.from(out).filter(Boolean);
};

const guardVideoTrack = (track, participant, publication) => {
  const media = track?.mediaStreamTrack;
  if (!media || media[VIDEO_GUARD_KEY]) return;

  const baseId = participant?.identity || "";
  const tileId = makeTileId(participant, publication);
  const isScreen = isScreenPublication(publication);

  const onHide = () => {
    showAvatarInTile(tileId);
    if (!isScreen) {
      markHasVideo(baseId, false);
      recomputeHasVideo(baseId);
    }
    scheduleStageRefresh();
  };

  const onVisible = () => {
    attachVideoToTile(track, tileId, !!participant?.isLocal, isScreen ? SCREEN_LABEL : undefined);
    markHasVideo(baseId, true);
    recomputeHasVideo(baseId);
    scheduleStageRefresh();
  };

  media.addEventListener("ended", onHide);
  media.addEventListener("mute", onHide);
  media.addEventListener("unmute", onVisible);
  media[VIDEO_GUARD_KEY] = true;
};

const handleVideoAttach = (track, publication, participant) => {
  const tileId = makeTileId(participant, publication);
  const isScreen = isScreenPublication(publication);

  attachVideoToTile(track, tileId, !!participant?.isLocal, isScreen ? SCREEN_LABEL : undefined);
  markHasVideo(participant?.identity, true);
  recomputeHasVideo(participant?.identity);
  guardVideoTrack(track, participant, publication);
  scheduleStageRefresh();
};

const handleTrackSubscribed = (track, publication, participant) => {
  ensureParticipant(participant);
  if (!track) return;

  const kind = track.kind || publication?.kind || publication?.track?.kind;
  if (kind === "audio") {
    attachAudioTrack(track, participant.identity);
    scheduleStageRefresh();
    return;
  }

  handleVideoAttach(track, publication, participant);
};

const handleTrackUnsubscribed = (track, publication, participant) => {
  const tileId = makeTileId(participant, publication);
  const kind = track?.kind || publication?.kind || publication?.track?.kind;

  if (kind === "video") {
    if (isScreenPublication(publication)) {
      removeTileByPid(tileId);
    } else {
      showAvatarInTile(tileId);
      markHasVideo(participant.identity, false);
      recomputeHasVideo(participant.identity);
    }
  }

  try {
    (track?.detach?.() || []).forEach((el) => el.remove());
  } catch {}

  scheduleStageRefresh();
};

const handleTrackMuted = (publication, participant) => {
  if (!publication || !participant) return;
  if (publication.source === Track.Source.Microphone) {
    scheduleStageRefresh();
    return;
  }

  const tileId = makeTileId(participant, publication);
  showAvatarInTile(tileId);
  if (!isScreenPublication(publication)) {
    markHasVideo(participant.identity, false);
    recomputeHasVideo(participant.identity);
  }
  scheduleStageRefresh();
};

const handleTrackUnmuted = (publication, participant) => {
  if (!publication?.track) return;
  handleTrackSubscribed(publication.track, publication, participant);
};

const handleLocalTrackPublished = (publication, participant) => {
  if (!publication || !participant?.isLocal) return;

  if (publication.source === Track.Source.Camera && publication.track) {
    ctx.localVideoTrack = publication.track;
    handleVideoAttach(publication.track, publication, participant);
  }

  if (publication.source === Track.Source.Microphone && publication.track) {
    ctx.localAudioTrack = publication.track;
  }

  if (isScreenPublication(publication) && publication.track) {
    handleVideoAttach(publication.track, publication, participant);
  }
};

const handleLocalTrackUnpublished = (publication, participant) => {
  if (!publication || !participant?.isLocal) return;

  const tileId = makeTileId(participant, publication);

  if (publication.source === Track.Source.Camera) {
    showAvatarInTile(participant.identity);
    markHasVideo(participant.identity, false);
    ctx.localVideoTrack = null;
  }

  if (publication.source === Track.Source.Microphone) {
    ctx.localAudioTrack = null;
  }

  if (isScreenPublication(publication)) {
    removeTileByPid(tileId);
    try { state.me.share = false; } catch {}
  }

  scheduleStageRefresh();
};

const syncParticipantState = (participant) => {
  if (!participant) return;
  ensureParticipant(participant);
  const pubs = listPublications(participant);
  const seenVideoIds = new Set();
  pubs.forEach((pub) => {
    ensurePublicationSubscribed(pub, participant);
    const track = pub?.track;
    const isScreen = isScreenPublication(pub);
    const tileId = makeTileId(participant, pub);
    if (track) {
      handleTrackSubscribed(track, pub, participant);
      seenVideoIds.add(tileId);
    } else {
      // публикации нет реального трека — очистим тайл
      showAvatarInTile(tileId);
    }
  });
  // Дополнительно пройдём по DOM и удалим тайлы, у которых нет живого видео и нет публикаций
  try {
    document.querySelectorAll(`.tile[data-pid^="${CSS.escape(participant.identity)}"]`).forEach((el)=>{
      const pid = el.getAttribute('data-pid')||'';
      const hasVid = !!el.querySelector('video');
      if (!hasVid && !seenVideoIds.has(pid)) {
        showAvatarInTile(pid);
      }
    });
  } catch {}
};

const syncRoomState = (room) => {
  if (!room) return;
  try { syncParticipantState(room.localParticipant); } catch {}
  try {
    const participants = room.participants;
    if (participants instanceof Map) {
      participants.forEach((p) => syncParticipantState(p));
    } else {
      Object.values(participants || {}).forEach((p) => syncParticipantState(p));
    }
  } catch {}
  // Очистим фантомные видео-тайлы: есть data-vid/класс has-video, но видео-элемент отсутствует
  try{
    document.querySelectorAll('.tile.has-video').forEach(el=>{
      const hasEl = !!el.querySelector('video');
      if (!hasEl){
        const pid = el.getAttribute('data-pid')||'';
        showAvatarInTile(pid);
      }
    });
  }catch{}
  scheduleStageRefresh();
};

const ensureVisibilityRehydration = (() => {
  let wired = false;
  return () => {
    if (wired) return;
    wired = true;
    try {
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible" && ctx.room) {
          syncRoomState(ctx.room);
        }
      });
    } catch {}
  };
})();

const resetRoomContext = () => {
  try { clearInterval(ctx._reconcileTimer); } catch {}
  ctx._reconcileTimer = null;
  ctx.localAudioTrack = null;
  ctx.localVideoTrack = null;
};

const setupRoomEventHandlers = (room) => {
  room.on(RoomEvent.ParticipantConnected, (participant) => {
    ensureParticipant(participant);
    syncParticipantState(participant);
    scheduleStageRefresh();
    if (!participant.isLocal) sfx("peer-join");
  });

  room.on(RoomEvent.ParticipantDisconnected, (participant) => {
    try { unregisterParticipant(participant.identity); } catch {}
    try { removeTileByPid(participant.identity); } catch {}
    try { removeTileByPid(`${participant.identity}${SCREEN_SUFFIX}`); } catch {}
    scheduleStageRefresh();
    if (!participant.isLocal) sfx("peer-leave");
  });

  room.on(RoomEvent.TrackSubscribed, handleTrackSubscribed);
  room.on(RoomEvent.TrackUnsubscribed, handleTrackUnsubscribed);
  room.on(RoomEvent.TrackMuted, handleTrackMuted);
  room.on(RoomEvent.TrackUnmuted, handleTrackUnmuted);
  room.on(RoomEvent.LocalTrackPublished, handleLocalTrackPublished);
  room.on(RoomEvent.LocalTrackUnpublished, handleLocalTrackUnpublished);

  room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
    try { highlightSpeaking(speakers.map((p) => p.identity)); } catch {}
  });

  room.on(RoomEvent.ConnectionQualityChanged, (participant, quality) => {
    try {
      const tileName = document.querySelector(`.tile[data-pid="${CSS.escape(participant.identity)}"] .name`);
      if (tileName) {
        let badge = tileName.querySelector(".aq");
        if (!badge) {
          badge = document.createElement("span");
          badge.className = "aq";
          tileName.appendChild(badge);
        }
        const label = quality === 3 ? "Excellent" : quality === 2 ? "Good" : quality === 1 ? "Poor" : "—";
        badge.textContent = label;
      }
    } catch {}
    if (participant?.isLocal) setQualityIndicator(quality);
  });
};

export async function connectLiveKit(token) {
  resetRoomContext();

  if (ctx.room) {
    try { await ctx.room.disconnect(); } catch {}
  }

  const room = new Room({
    autoSubscribe: true,
    adaptiveStream: true,
    dynacast: true,
  });

  ctx.room = room;

  setupRoomEventHandlers(room);
  ensureVisibilityRehydration();

  await room.connect(LIVEKIT_WS_URL, token);

  wireData();
  syncRoomState(room);

  await ensureMicOn();
  scheduleStageRefresh();

  startPingLoop();
}
