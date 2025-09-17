import { Room, RoomEvent, Track } from "./vendor/livekit-loader.js";
import { LIVEKIT_WS_URL } from "./config.js";
import { ctx, state, setQualityIndicator } from "./state.js";
import { getRemoteParticipants } from "./participants.js";
import { sfx } from "./sfx.js";

/* из следующих файлов (будут в следующей/последующих пачках) */
import { registerParticipant, unregisterParticipant, markHasVideo, recomputeHasVideo } from "./registry.js";
import { attachAudioTrack, attachVideoToTile, showAvatarInTile } from "./tiles.js";
import { applyLayout, highlightSpeaking } from "./layout.js";
import { refreshControls } from "./controls.js";
import { wireData } from "./chat-session.js";
import { ensureMicOn } from "./media.js";
import { startPingLoop } from "./ui-settings-ice-init.js";

/* ===== Подключение LiveKit ===== */
export async function connectLiveKit(token){
  ctx.room = new Room({ autoSubscribe:true, adaptiveStream:true, dynacast:true });

  ctx.room.on(RoomEvent.ParticipantConnected,  (p)=>{
    registerParticipant(p);
    applyLayout();
    if(!p.isLocal) sfx('peer-join');
  });

  ctx.room.on(RoomEvent.ParticipantDisconnected,(p)=>{
    unregisterParticipant(p.identity);
    applyLayout();
    if(!p.isLocal) sfx('peer-leave');
  });

  ctx.room.on(RoomEvent.TrackSubscribed, (track, pub, participant)=>{
    if (!ctx.registry.has(participant.identity)) registerParticipant(participant);

    const id = participant.identity +
      (pub.source===Track.Source.ScreenShare || pub.source===Track.Source.ScreenShareAudio ? '#screen' : '');

    if(track.kind==='audio'){
      attachAudioTrack(track, participant.identity);
    } else {
      attachVideoToTile(track, id, participant.isLocal,
        pub.source===Track.Source.ScreenShare ? 'Экран' : undefined);
      markHasVideo(participant.identity, true);

      const media = track.mediaStreamTrack;
      if (media){
        media.addEventListener('ended', ()=>{
          showAvatarInTile(id);
          recomputeHasVideo(participant.identity);
          applyLayout();
        });
        media.addEventListener('mute',  ()=>{
          showAvatarInTile(id);
          recomputeHasVideo(participant.identity);
          applyLayout();
        });
        media.addEventListener('unmute', ()=>{
          // повторно прикрепляем к тайлу без смены трека
          attachVideoToTile(track, id, participant.isLocal,
            pub.source===Track.Source.ScreenShare ? 'Экран' : undefined);
          markHasVideo(participant.identity, true);
          applyLayout();
        });
      }
    }
    applyLayout();
  });

  ctx.room.on(RoomEvent.TrackUnsubscribed, (track, pub, participant)=>{
    const id = participant.identity +
      (pub.source===Track.Source.ScreenShare || pub.source===Track.Source.ScreenShareAudio ? '#screen' : '');
    if(track.kind==='video'){
      showAvatarInTile(id);
      recomputeHasVideo(participant.identity);
    }
    (track.detach?.()||[]).forEach(el=>el.remove());
    applyLayout();
  });

  ctx.room.on(RoomEvent.TrackMuted,  (pub,p)=>{
    if(pub?.source===Track.Source.Microphone){ refreshControls(); }
    if(pub?.source===Track.Source.Camera){
      showAvatarInTile(p.identity);
      markHasVideo(p.identity, false);
      refreshControls();
      applyLayout();
    }
  });

  ctx.room.on(RoomEvent.TrackUnmuted,(pub,p)=>{
    if(pub?.source===Track.Source.Microphone){ refreshControls(); }
    if(pub?.source===Track.Source.Camera){
      if(pub?.track) attachVideoToTile(pub.track, p.identity, !!p?.isLocal);
      markHasVideo(p.identity, true);
      refreshControls();
      applyLayout();
    }
  });

  ctx.room.on(RoomEvent.LocalTrackPublished,   (pub,p)=>{
    if(pub?.source===Track.Source.Camera && p?.isLocal && pub.track){
      ctx.localVideoTrack = pub.track;
      attachVideoToTile(pub.track, p.identity, true);
      markHasVideo(p.identity, true);
      applyLayout();
    }
    refreshControls();
  });

  ctx.room.on(RoomEvent.LocalTrackUnpublished, (pub,p)=>{
    if(pub?.source===Track.Source.Camera && p?.isLocal){
      showAvatarInTile(p.identity);
      markHasVideo(p.identity, false);
      ctx.localVideoTrack = null;
      applyLayout();
    }
    refreshControls();
  });

  ctx.room.on(RoomEvent.ActiveSpeakersChanged, (speakers)=>{
    const ids = speakers.map(p=>p.identity);
    highlightSpeaking(ids);
  });

  ctx.room.on(RoomEvent.ConnectionQualityChanged, (p,q)=>{
    if(p?.isLocal) setQualityIndicator(q);
  });

  await ctx.room.connect(LIVEKIT_WS_URL, token);
  wireData(); // чат datachannel

  registerParticipant(ctx.room.localParticipant);
  getRemoteParticipants().forEach(registerParticipant);

  // Гидратация уже подписанных треков (если подключились к существующей сессии)
  try {
    const enumerateVideoPubs = (p)=>{
      const out = [];
      try {
        if (p?.videoTracks && typeof p.videoTracks.forEach === 'function'){
          p.videoTracks.forEach(pub=> out.push(pub));
        }
        if (p?.trackPublications && typeof p.trackPublications.forEach === 'function'){
          p.trackPublications.forEach(pub=>{ if (pub?.kind === 'video' || pub?.track?.kind === 'video') out.push(pub); });
        }
        if (p?.tracks && typeof p.tracks.forEach === 'function'){
          p.tracks.forEach(pub=>{ if (pub?.kind === 'video' || pub?.track?.kind === 'video') out.push(pub); });
        }
        if (typeof p?.getTrackPublications === 'function'){
          (p.getTrackPublications()||[]).forEach(pub=>{ if (pub?.kind === 'video' || pub?.track?.kind === 'video') out.push(pub); });
        }
      } catch {}
      return out;
    };

    const attachFromPubs = (p)=>{
      enumerateVideoPubs(p).forEach(pub=>{
        try {
          // гарантируем подписку
          if (typeof pub?.setSubscribed === 'function' && !pub.isSubscribed){
            pub.setSubscribed(true);
          }
        } catch {}
        const track = pub?.track;
        if (!track) return;
        const isScreen = (pub?.source===Track.Source.ScreenShare || pub?.source===Track.Source.ScreenShareAudio);
        const id = p.identity + (isScreen ? '#screen' : '');
        attachVideoToTile(track, id, !!p.isLocal, (isScreen ? 'Экран' : undefined));
        markHasVideo(p.identity, true);
      });
    };

    const hydrateWithRetry = (tries = 10)=>{
      attachFromPubs(ctx.room.localParticipant);
      getRemoteParticipants().forEach(attachFromPubs);
      // если уже появились видео — можно не повторять
      if (document.querySelector('.tile video') || tries <= 0) return;
      setTimeout(()=> hydrateWithRetry(tries-1), 200);
    };

    hydrateWithRetry(12);
  } catch {}

  await ensureMicOn();
  applyLayout();
  refreshControls();

  startPingLoop();
}
