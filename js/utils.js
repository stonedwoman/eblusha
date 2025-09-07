/* ===== Утилы ===== */
export const $  = (s)=>document.querySelector(s);
export const byId = (id)=>document.getElementById(id);
export const isMobileView = ()=> matchMedia('(max-width:640px)').matches;

export function hashColor(name){
  let h=0;
  for(let i=0;i<name.length;i++) h=(h<<5)-h+name.charCodeAt(i);
  const hue=Math.abs(h)%360;
  return `hsl(${hue} 45% 55%)`;
}

export function show(id){
  const el=byId(id);
  if(el){ el.hidden=false; el.style.display=(id==='screen-app'?'grid':'block'); }
}

export function hide(id){
  const el=byId(id);
  if(el){ el.hidden=true; el.style.display='none'; }
}
