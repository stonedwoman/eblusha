/* ===== Утилы ===== */
export const $  = (s)=>document.querySelector(s);
export const byId = (id)=>document.getElementById(id);

// простая проверка "мобилка" (портрет до 640px или landscape до 950px)
export function isMobileView(){
  const narrow = window.matchMedia('(max-width: 640px)').matches;
  const mobileLandscape = window.matchMedia('(max-width: 950px) and (hover: none) and (pointer: coarse)').matches;
  return narrow || mobileLandscape;
}

// отдельный хелпер именно для landscape-мобилы
export function isMobileLandscape(){
  return window.matchMedia('(max-width: 950px) and (hover: none) and (pointer: coarse) and (orientation: landscape)').matches;
}

export function hashColor(name){
  let h=0;
  for(let i=0;i<name.length;i++) h=(h<<5)-h+name.charCodeAt(i);
  const hue=Math.abs(h)%360;
  return `hsl(${hue} 45% 55%)`;
}

export function show(id){
  const el = document.getElementById(id);
  if (!el) return;
  el.hidden = false;               // этого достаточно, hidden убирает display:none
  el.style.removeProperty('display'); // снять возможный inline display
}

export function hide(id){
  const el = document.getElementById(id);
  if (!el) return;
  el.hidden = true;                // браузер сам применит display:none
}
