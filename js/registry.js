import { ctx } from "./state.js";
import { byId } from "./utils.js";
import { createTileEl, createRowEl } from "./tiles.js";
import { updateUsersCounter, queueSbarUpdate } from "./layout.js";

/* ===== Реестр участников и связанные утилиты ===== */

export function registerParticipant(participant){
  const id = participant.identity;
  if (ctx.registry.has(id)) {
    ctx.registry.get(id).participant = participant;
    return;
  }

  const name = participant.name || id || "user";
  const tile = createTileEl(id, name, participant.isLocal);
  const row  = createRowEl(id, name);

  ctx.registry.set(id, {
    participant,
    tile,
    row,
    hasVideo: false,
    name,
    isLocal: !!participant.isLocal,
    audioEl: null,
    volume: 1
  });

  updateUsersCounter();
  queueSbarUpdate();
}

export function unregisterParticipant(id){
  const rec = ctx.registry.get(id);
  if (!rec) return;

  rec.tile?.remove();
  rec.row?.remove();
  
  // Удаляем из обоих списков участников
  const lists = document.querySelectorAll('#onlineList');
  lists.forEach(list => {
    const rows = list.querySelectorAll(`[data-pid="${CSS.escape(id)}"]`);
    rows.forEach(row => row.remove());
  });
  
  ctx.registry.delete(id);
  updateUsersCounter();
  queueSbarUpdate();
}

/* Храним флаг наличия видео у базы участника */
export function markHasVideo(baseId, val){
  const r = ctx.registry.get(baseId);
  if (r) r.hasVideo = !!val;
}

/* Пересчёт флага наличия видео по DOM */
export function recomputeHasVideo(baseId){
  const anyVideo = !!document.querySelector(
    `.tile[data-pid="${CSS.escape(baseId)}"] video, .tile[data-pid="${CSS.escape(baseId)}#screen"] video`
  );
  const r = ctx.registry.get(baseId);
  if (r) r.hasVideo = anyVideo;
}

/* Текст счётчика «N участник(ов)» */
export function usersCounterText(){
  return `${ctx.registry.size} участник(ов)`;
}
