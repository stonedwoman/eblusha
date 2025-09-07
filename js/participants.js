import { ctx } from "./state.js";

/* ===== Участники ===== */
export function getRemoteParticipants(){
  const p = ctx.room && ctx.room.participants;
  if (!p) return [];
  if (p instanceof Map || (typeof p.forEach==='function' && typeof p.values==='function')) {
    return Array.from(p.values()).filter(Boolean);
  }
  try { return Object.values(p).filter(Boolean); } catch { return []; }
}
