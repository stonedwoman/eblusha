import { byId, hashColor, hide, show } from "./utils.js";
import { state } from "./state.js";
import { TOKEN_ENDPOINT } from "./config.js";
import { connectLiveKit } from "./livekit-connection.js";
import { sfx } from "./sfx.js";
import { setShareButtonMode } from "./controls.js";   // будет в следующей пачке
import { initFootDots } from "./ui-settings-ice-init.js";         // будет в следующей пачке

/* ===== Вход ===== */
byId('authForm').addEventListener('submit', async (e)=>{ e.preventDefault(); await joinRoom(); });

// Автозаполнение: случайный ник и комната 123
function randomNick(){
  const animals=["Еблуша","Хуйлан","Пиздюк","Ебанат","Ебанушка","Долбовносинск","Припиздок","Пиздюшонок","Уёба","Хуевёрт","ТЕЕХ","Еблосос"];
  const adj=["Шустрый","Весёлый","Сонный","Ловкий","Смелый","Молчаливый","Лучезарный","Грозный","Тихий","Шумный","Юркий","Небесный"];
  const a=animals[Math.floor(Math.random()*animals.length)];
  const b=adj[Math.floor(Math.random()*adj.length)];
  return `${b} ${a}`;
}
function applyDefaults(){
  try{
    if (byId('name') && !byId('name').value) byId('name').value = randomNick();
    if (byId('room')) byId('room').value = '123';
  }catch{}
}
applyDefaults();
document.addEventListener('DOMContentLoaded', applyDefaults);

export async function joinRoom(){
  try{
    state.me.name=(byId('name').value||'').trim()||('user-'+Math.random().toString(36).slice(2,7));
    state.me.room=(byId('room').value||'').trim()||'room-1';
    byId('joinBtn').disabled=true;

    const r=await fetch(`${TOKEN_ENDPOINT}?room=${encodeURIComponent(state.me.room)}&user=${encodeURIComponent(state.me.name)}`);
    const { token } = await r.json();
    await connectLiveKit(token);

    hide('screen-auth'); show('screen-app');
    byId('roomTag').textContent='Комната #'+state.me.room;
    byId('meName').textContent=state.me.name;
    byId('meRoom').textContent='Комната '+state.me.room;

    const letter=state.me.name.slice(0,1).toUpperCase();
    byId('meBigAvatar').textContent=letter;
    byId('meBigAvatar').style.background=hashColor(state.me.name);
    sfx('self-join');

    setShareButtonMode();
    initFootDots();
  }catch(e){
    alert('Ошибка подключения: '+(e?.message||e));
    console.error(e);
  }finally{
    byId('joinBtn').disabled=false;
  }
}
