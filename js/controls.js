import { byId, isMobileView } from "./utils.js";
import { state } from "./state.js";
import { isMicActuallyOn, getCameraUiStatus } from "./media.js";

/* ===== UI-кнопки (вид/состояния) ===== */
export function refreshControls(){
  const mpOn = isMicActuallyOn();
  const cam = getCameraUiStatus();
  const cpOn = cam.isOn;
  const shareOn = state.me.share===true || (isMobileView() && !!state.me._mobileRotateOpen);

  byId('btnMic').classList.toggle('active', mpOn);
  byId('btnCam').classList.toggle('active', cpOn);
  byId('btnShare').classList.toggle('active', shareOn);

  const facingBtn = byId('btnFacing');
  if (facingBtn){
    // Показываем только если камера включена или есть публикация и мы в мобильном режиме
    facingBtn.hidden = !(isMobileView() && (cpOn || cam.hasPublication));
    facingBtn.disabled = !!cam.isSwitching;
  }

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
