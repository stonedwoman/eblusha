import { Room, RoomEvent, Track } from "./vendor/livekit-loader.js";
import { LIVEKIT_WS_URL } from "./config.js";
import { ctx, state, setQualityIndicator } from "./state.js";
import { getRemoteParticipants } from "./participants.js";
import { sfx } from "./sfx.js";

/* из следующих файлов (будут в следующей/последующих пачках) */
import { registerParticipant, unregisterParticipant, markHasVideo, recomputeHasVideo } from "./registry.js";
import { attachAudioTrack, attachVideoToTile, showAvatarInTile, dedupeTilesByPid, cleanupOrphanDom, removeTileByPid } from "./tiles.js";
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
    dedupeTilesByPid();
    cleanupOrphanDom();
    if(!p.isLocal) sfx('peer-join');
  });

  ctx.room.on(RoomEvent.ParticipantDisconnected,(p)=>{
    unregisterParticipant(p.identity);
    applyLayout();
    dedupeTilesByPid();
    // подчистим возможные висячие тайлы и строки по DOM на всякий случай
    try {
      document.querySelectorAll(`.tile[data-pid="${CSS.escape(p.identity)}"]`).forEach(el=> el.remove());
      document.querySelectorAll(`#onlineList [data-pid="${CSS.escape(p.identity)}"], .user-list [data-pid="${CSS.escape(p.identity)}"]`).forEach(el=> el.remove());
    } catch {}
    cleanupOrphanDom();
    if(!p.isLocal) sfx('peer-leave');
  });

  ctx.room.on(RoomEvent.TrackSubscribed, (track, pub, participant)=>{
    if (!ctx.registry.has(participant.identity)) registerParticipant(participant);

    const id = participant.identity +
      (pub.source===Track.Source.ScreenShare || pub.source===Track.Source.ScreenShareAudio ? '#screen' : '');

    if(track.kind==='audio'){
      attachAudioTrack(track, participant.identity);
    } else {
      // защита от «фантомного» pid: тайл создаём только если участник есть в реестре
      if (!ctx.registry.has(participant.identity)) return;
      // защита от дублей: если этот track.sid уже привязан к другому участнику — не прикрепляем
      try {
        const sid = track?.sid || track?.mediaStreamTrack?.id;
        if (sid){
          const dup = document.querySelector(`.tile[data-vid="${CSS.escape(sid)}"]`);
          if (dup){ return; }
        }
      } catch {}
      attachVideoToTile(track, id, participant.isLocal,
        pub.source===Track.Source.ScreenShare ? 'Экран' : undefined);
      markHasVideo(participant.identity, true);

      // Зафиксируем «общее» соотношение сторон по первому реальному удалённому видео
      try{
        if (!participant.isLocal && !ctx.sharedVideoFormat){
          const mst = track.mediaStreamTrack;
          const s = mst?.getSettings?.() || {};
          const w = (s.width|0) || track?.attachedElements?.[0]?.videoWidth|0;
          const h = (s.height|0)|| track?.attachedElements?.[0]?.videoHeight|0;
          if (w>0 && h>0){ ctx.sharedVideoFormat = { width:w, height:h, aspect: w/h }; }
        }
      }catch{}

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
    dedupeTilesByPid();
  });

  ctx.room.on(RoomEvent.TrackUnsubscribed, (track, pub, participant)=>{
    const id = participant.identity +
      (pub.source===Track.Source.ScreenShare || pub.source===Track.Source.ScreenShareAudio ? '#screen' : '');
    if(track.kind==='video'){
      showAvatarInTile(id);
      recomputeHasVideo(participant.identity);
      // если это был screen-share — удалим тайл целиком
      if (/#screen$/.test(id)) removeTileByPid(id);
    }
    (track.detach?.()||[]).forEach(el=>el.remove());
    applyLayout();
    dedupeTilesByPid();
    cleanupOrphanDom();
  });

  // На некоторых платформах, когда вкладка была в фоне, события могли пройти мимо DOM.
  // При публикации удалённых видео треков в фоне — догарантируем подписку.
  try{
    if (RoomEvent && RoomEvent.TrackPublished != null){
      ctx.room.on(RoomEvent.TrackPublished, (pub, participant)=>{
        try{
          if ((pub?.kind === 'video' || pub?.track?.kind === 'video') && typeof pub?.setSubscribed === 'function' && !pub.isSubscribed){
            pub.setSubscribed(true);
          }
        }catch{}
      });

  // Если публикуется локальная камера и статус mute у публикации отличается от трека — синхронизируем
  ctx.room.on(RoomEvent.LocalTrackPublished,   async (pub,p)=>{
    if(pub?.source===Track.Source.Camera && p?.isLocal && pub.track){
      try{
        if (pub.isMuted && pub.track?.isEnabled !== false){ await pub.unmute?.(); }
      }catch{}
    }
  });
    }
  }catch{}

  ctx.room.on(RoomEvent.TrackMuted,  (pub,p)=>{
    if(pub?.source===Track.Source.Microphone){ refreshControls(); }
    if(pub?.source===Track.Source.Camera){
      showAvatarInTile(p.identity);
      markHasVideo(p.identity, false);
      refreshControls();
      applyLayout();
      dedupeTilesByPid();
      cleanupOrphanDom();
    }
  });

  ctx.room.on(RoomEvent.TrackUnmuted,(pub,p)=>{
    if(pub?.source===Track.Source.Microphone){ refreshControls(); }
    if(pub?.source===Track.Source.Camera){
      if(pub?.track) attachVideoToTile(pub.track, p.identity, !!p?.isLocal);
      markHasVideo(p.identity, true);
      refreshControls();
      applyLayout();
      dedupeTilesByPid();
      cleanupOrphanDom();
    }
  });

  ctx.room.on(RoomEvent.LocalTrackPublished,   async (pub,p)=>{
    if(pub?.source===Track.Source.Camera && p?.isLocal && pub.track){
      ctx.localVideoTrack = pub.track;
      attachVideoToTile(pub.track, p.identity, true);
      markHasVideo(p.identity, true);
      applyLayout();
      try{
        // Убедимся, что публикация действительно в unmute после повторного включения
        (async()=>{ try{ await (pub.setMuted?.(false) || pub.unmute?.()); }catch{} })();
      }catch{}
      // Не навязываем aspectRatio — используем исходный формат камеры
    }
    refreshControls();
  });

  ctx.room.on(RoomEvent.LocalTrackUnpublished, (pub,p)=>{
    if(pub?.source===Track.Source.Camera && p?.isLocal){
      showAvatarInTile(p.identity);
      markHasVideo(p.identity, false);
      ctx.localVideoTrack = null;
      try{ ctx.sharedVideoFormat = null; }catch{}
      applyLayout();
    }
    refreshControls();
  });

  ctx.room.on(RoomEvent.ActiveSpeakersChanged, (speakers)=>{
    const ids = speakers.map(p=>p.identity);
    highlightSpeaking(ids);
  });

  ctx.room.on(RoomEvent.ConnectionQualityChanged, (p,q)=>{
    try{
      // Обновим бейдж качества аудио/сети рядом с именем участника
      const tileName = document.querySelector(`.tile[data-pid="${CSS.escape(p.identity)}"] .name`);
      if (tileName){
        let aq = tileName.querySelector('.aq');
        if (!aq){ aq = document.createElement('span'); aq.className='aq'; tileName.appendChild(aq); }
        const label = q===3?'Excellent': q===2?'Good': q===1?'Poor': '—';
        aq.textContent = label;
      }
    }catch{}
    if(p?.isLocal) setQualityIndicator(q);
  });

  await ctx.room.connect(LIVEKIT_WS_URL, token);
  // После переподключения не автозапускаем камеру: ждём явного действия пользователя
  try{ ctx.camDesiredOn = isFinite(ctx.camDesiredOn) ? ctx.camDesiredOn : undefined; }catch{}
  wireData(); // чат datachannel

  registerParticipant(ctx.room.localParticipant);
  getRemoteParticipants().forEach(registerParticipant);

  // Гидратация уже подписанных треков (если подключились к существующей сессии)
  try {
    const hydrated = new Set(); // track sid/id, чтобы не дублировать
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
        // публикации должны принадлежать именно этому участнику
        const ownerId = pub?.participant?.identity || pub?.ownerIdentity || p?.identity;
        if (ownerId && p?.identity && ownerId !== p.identity) return;

        const track = pub?.track;
        if (!track) return;
        const sid = track?.sid || pub?.trackSid || pub?.sid || track?.mediaStreamTrack?.id;
        if (sid && hydrated.has(sid)) return; // уже прикрепили где-то
        const isScreen = (pub?.source===Track.Source.ScreenShare || pub?.source===Track.Source.ScreenShareAudio);
        const id = p.identity + (isScreen ? '#screen' : '');
        attachVideoToTile(track, id, !!p.isLocal, (isScreen ? 'Экран' : undefined));
        markHasVideo(p.identity, true);
        if (sid) hydrated.add(sid);
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
    // При возврате вкладки в фокус — повторно гидрируем, на случай упущенных DOM-операций
    const onVisible = ()=>{
      if (document.visibilityState !== 'visible') return;
      try{ hydrateWithRetry(10); }catch{}
      try{ applyLayout(); }catch{}
      try{ dedupeTilesByPid(); }catch{}
      try{ cleanupOrphanDom(); }catch{}
    };
    document.addEventListener('visibilitychange', onVisible);
  } catch {}

  await ensureMicOn();
  applyLayout();
  dedupeTilesByPid();
  cleanupOrphanDom();
  refreshControls();

  startPingLoop();
}
