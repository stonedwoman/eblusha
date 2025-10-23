import { ctx, state } from "./state.js";
import { byId, hashColor, show, hide } from "./utils.js";
import { Track } from "./vendor/livekit-loader.js";
import { stopScreenShare, toggleMic } from "./media.js";
import { closeTileOverlay } from "./tiles.js";

/* ===== Чат ===== */
export function chatPush(author,text){
  const wrap=byId("chatLog");
  const row=document.createElement("div");
  row.className="chat-row";
  const color=hashColor(author);
  row.innerHTML=`<div class="chat-nick" style="color:${color}">${author}</div><div class="bubble">${text}</div>`;
  wrap.appendChild(row);
  wrap.scrollTop=wrap.scrollHeight;
}

export function sendChatMessage(text){
  if(!text.trim()||!ctx.room) return;
  const payload={type:"chat", from:state.me.name, text:text.trim(), ts:Date.now()};
  chatPush(state.me.name, text.trim());
  try{
    const data=new TextEncoder().encode(JSON.stringify(payload));
    ctx.room.localParticipant.publishData(data,{reliable:true});
  }catch(e){ console.warn("publishData failed",e); }
}

export function wireData(){
  ctx.room.on("dataReceived",(payload,participant)=>{
    try{
      const msg=JSON.parse(new TextDecoder().decode(payload));
      if(msg.type==="chat"){
        chatPush(msg.from||participant.identity||"user", msg.text);
      }
    }catch(e){ console.warn("bad data",e); }
  });
}

byId("chatForm")?.addEventListener("submit",(e)=>{
  e.preventDefault();
  const v=byId("chatInput").value;
  if(!v.trim()) return;
  sendChatMessage(v);
  byId("chatInput").value="";
});

/* ===== Выход из комнаты ===== */
export async function leaveRoom(){
  try{
    const lp = ctx.room?.localParticipant;
    try{ if(lp?.setMicrophoneEnabled) await lp.setMicrophoneEnabled(false);
         else await ctx.room?.localParticipant?.getTrack(Track.Source.Microphone)?.setMuted?.(true); }catch{}
    try{ if(lp?.setCameraEnabled) await lp.setCameraEnabled(false);
         else await ctx.room?.localParticipant?.getTrack(Track.Source.Camera)?.setMuted?.(true); }catch{}
    try{ ctx.localVideoTrack?.stop?.(); }catch{}
    try{ ctx.localAudioTrack?.stop?.(); }catch{}
    await stopScreenShare();
    if(ctx.room){ await ctx.room.disconnect(); }
  }catch{}

  // остановим reconcile-таймер, если есть
  try{ if (ctx._reconcileTimer){ clearInterval(ctx._reconcileTimer); ctx._reconcileTimer = null; } }catch{}

  ctx.registry.clear();
  byId("onlineList").innerHTML="";
  byId("tilesMain").innerHTML="";
  byId("tilesRail").innerHTML="";
  if (byId("tileOverlay")?.classList.contains("open")) await closeTileOverlay();

  show("screen-auth");
  hide("screen-app");
  window.dispatchEvent(new Event("app:refresh-ui"));
}
byId("btnLeave")?.addEventListener("click", async ()=>{
  await leaveRoom();
});

/* ===== Хоткеи ===== */
document.addEventListener("keydown", (e)=>{
  if (e.key && e.key.toLowerCase()==="m" && !e.repeat) toggleMic();
});
