import { byId, isMobileView } from "./utils.js";
import { state } from "./state.js";
import { isMicActuallyOn, isCamActuallyOn } from "./media.js";

/* ===== UI-кнопки (вид/состояния) ===== */
export function refreshControls(){
  const mpOn = isMicActuallyOn();
  const cpOn = isCamActuallyOn();
  const shareOn = state.me.share===true || (isMobileView() && !!state.me._mobileRotateOpen);

  byId('btnMic').classList.toggle('active', mpOn);
  byId('btnCam').classList.toggle('active', cpOn);
  byId('btnShare').classList.toggle('active', shareOn);

  const facingBtn = byId('btnFacing');
  if (facingBtn) facingBtn.hidden = !(isMobileView() && cpOn);

  const shareBtn = byId('btnShare');
  if (shareBtn) shareBtn.hidden = isMobileView();
}

export function setShareButtonMode(){
  const btn = byId('btnShare');
  if (!btn) return;
  if (isMobileView()){
    btn.hidden = true;
  }else{
    btn.hidden = false;
    btn.title = 'Шарить экран';
  }
}

/* слушаем кастомный сигнал об обновлении UI */
window.addEventListener("app:refresh-ui", refreshControls);

document.getElementById('btnLeave')?.addEventListener('click', async ()=>{
  await leaveRoom();
});
