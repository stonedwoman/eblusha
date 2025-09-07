import { ctx } from "./state.js";
import { byId, isMobileView } from "./utils.js";
import { createTileEl, tilesMain, tilesRail } from "./tiles.js";
import { usersCounterText } from "./registry.js";

/* ===== Лэйаут / скроллбар / spotlight ===== */

export function updateUsersCounter(){
  byId('usersTag').textContent = usersCounterText();
}

/* --- mobile scrollbar --- */
const sbar      = byId('tilesSbar');
const sbarTrack = byId('sbarTrack');
const sbarThumb = byId('sbarThumb');

let sbarDrag = null;
let sbarUpdateTimer = null;

export function queueSbarUpdate(){
  clearTimeout(sbarUpdateTimer);
  sbarUpdateTimer = setTimeout(()=> updateMobileScrollbar(false), 50);
}

export function updateMobileScrollbar(forceShow){
  if(!isMobileView() || ctx.isStageFull) { sbar?.classList.remove('show'); return; }
  const m = tilesMain(); if(!m) return;

  const scrollW = m.scrollWidth, viewW = m.clientWidth;
  const need = scrollW > viewW + 2;
  if (!sbar) return;

  sbar.setAttribute('aria-hidden', need ? 'false' : 'true');
  sbar.classList.toggle('show', need);
  if(!need) return;

  const trackW = sbarTrack.clientWidth;
  const minThumb = 28;
  const thumbW = Math.max(minThumb, Math.round((viewW/scrollW) * trackW));
  const maxLeft = Math.max(0, trackW - thumbW);
  const left = maxLeft ? Math.round((m.scrollLeft / (scrollW - viewW)) * maxLeft) : 0;

  sbarThumb.style.width = thumbW + 'px';
  sbarThumb.style.transform = `translateX(${left}px)`;

  if(forceShow){
    sbarThumb.animate(
      [{transform:`translateX(${left}px) scaleY(1.0)`},
       {transform:`translateX(${left}px) scaleY(1.25)`},
       {transform:`translateX(${left}px) scaleY(1.0)`}],
      {duration:600, easing:'ease-out'}
    );
  }
}

tilesMain().addEventListener('scroll', ()=> updateMobileScrollbar(false), {passive:true});
window.addEventListener('resize', ()=> updateMobileScrollbar(false));

function sbarSetScrollByThumbX(px){
  const m = tilesMain();
  const trackW = sbarTrack.clientWidth;
  const thumbW = sbarThumb.clientWidth;
  const maxLeft = Math.max(0, trackW - thumbW);
  const clamped = Math.max(0, Math.min(maxLeft, px));
  const ratio = maxLeft ? (clamped / maxLeft) : 0;
  const maxScroll = m.scrollWidth - m.clientWidth;
  m.scrollLeft = ratio * maxScroll;
  updateMobileScrollbar(false);
}

function startSbarDrag(clientX){
  sbar.classList.add('dragging');
  const rect = sbarTrack.getBoundingClientRect();
  const thumbRect = sbarThumb.getBoundingClientRect();
  sbarDrag = { startX: clientX, startLeft: thumbRect.left - rect.left };
}
function moveSbarDrag(clientX){
  if(!sbarDrag) return;
  const rect = sbarTrack.getBoundingClientRect();
  const delta = clientX - sbarDrag.startX;
  sbarSetScrollByThumbX(sbarDrag.startLeft + delta);
}
function endSbarDrag(){
  sbar.classList.remove('dragging');
  sbarDrag=null;
}
sbarThumb.addEventListener('mousedown', (e)=>{ e.preventDefault(); startSbarDrag(e.clientX); });
document.addEventListener('mousemove', (e)=>{ if(sbarDrag) moveSbarDrag(e.clientX); });
document.addEventListener('mouseup', endSbarDrag);
sbarThumb.addEventListener('touchstart', (e)=>{ startSbarDrag(e.touches[0].clientX); }, {passive:true});
document.addEventListener('touchmove', (e)=>{ if(sbarDrag) moveSbarDrag(e.touches[0].clientX); }, {passive:true});
document.addEventListener('touchend', endSbarDrag);
sbarTrack.addEventListener('mousedown', (e)=>{
  if(e.target===sbarThumb) return;
  const rect = sbarTrack.getBoundingClientRect();
  sbarSetScrollByThumbX(e.clientX - rect.left - sbarThumb.clientWidth/2);
});
sbarTrack.addEventListener('touchstart', (e)=>{
  if(e.target===sbarThumb) return;
  const rect = sbarTrack.getBoundingClientRect();
  sbarSetScrollByThumbX(e.touches[0].clientX - rect.left - sbarThumb.clientWidth/2);
}, {passive:true});

/* --- spotlight / раскладка --- */

export function chooseAutoSpotlight(){
  if(ctx.pinnedId && ctx.registry.has(ctx.pinnedId)) return ctx.pinnedId;

  const meId = ctx.room?.localParticipant?.identity;
  if(meId && document.querySelector(`.tile[data-pid="${CSS.escape(meId)}#screen"]`))
    return meId+'#screen';

  const withVideo = [...ctx.registry.entries()].filter(([,r])=>r.hasVideo);
  if(withVideo.length) return withVideo[0][0];
  if(meId && ctx.registry.has(meId)) return meId;

  return [...ctx.registry.keys()][0];
}

export function applyLayout(){
  const tiles = byId('tiles'), main = tilesMain(), rail = tilesRail();
  const mobile = isMobileView() && !ctx.isStageFull;

  // восстановить уничтоженные DOM-элементы
  ctx.registry.forEach((rec)=>{
    if(!document.body.contains(rec.tile)){
      rec.tile = createTileEl(rec.participant.identity, rec.name, rec.isLocal);
    }
  });

  if (mobile) {
    tiles.classList.remove('spotlight','single');
    document.querySelectorAll('.tile').forEach(t=>{
      t.classList.remove('spotlight','thumb','portrait');
      t.style.width=''; t.style.height='';
      if (t.parentElement !== main) main.appendChild(t);
    });
    updateUsersCounter();
    updateMobileScrollbar(true);
    return;
  }

  const spotlightId = chooseAutoSpotlight();
  const totalTiles = document.querySelectorAll('.tile').length;

  tiles.classList.add('spotlight');
  tiles.classList.toggle('single', totalTiles<=1);

  document.querySelectorAll('.tile').forEach(t=>{
    t.classList.remove('spotlight','thumb');
    t.style.width=''; t.style.height='';
    const id=t.dataset.pid;
    if(id===spotlightId){
      if (t.parentElement !== main) main.appendChild(t);
      t.classList.add('spotlight');
    } else {
      if (totalTiles>1){
        if (t.parentElement !== rail) rail.appendChild(t);
        t.classList.add('thumb');
      } else {
        if (t.parentElement !== main) main.appendChild(t);
      }
    }
  });

  fitSpotlightSize();
  updateUsersCounter();
}

/* === УСТОЙЧИВЫЙ рассчёт размера спотлайта на десктопе === */
export function fitSpotlightSize(){
  if (isMobileView() && !ctx.isStageFull) return;

  const main = tilesMain();
  if (!main) return;
  const tile = main.querySelector('.tile.spotlight');
  if (!tile) return;

  const box = main.getBoundingClientRect();

  // 1) Если контейнер ещё не разметился — НЕ трогаем inline-стили вовсе.
  //    Пускай работает CSS (и наш min-height), а мы попробуем снова чуть позже.
  if (box.width < 64 || box.height < 64) {
    tile.style.removeProperty('width');
    tile.style.removeProperty('height');
    // повторим попытку: ближайший кадр + через 120 мс
    requestAnimationFrame(()=>fitSpotlightSize());
    setTimeout(()=>fitSpotlightSize(), 120);
    return;
  }

  // 2) Нормальный расчёт AR
  const ar = tile.classList.contains('portrait') ? (9/16) : (16/9);

  let w = box.width;
  let h = w / ar;
  if (h > box.height) { h = box.height; w = h * ar; }

  // 3) На всякий: никакого 0×0
  if (w < 64 || h < 64) {
    tile.style.removeProperty('width');
    tile.style.removeProperty('height');
    return;
  }

  tile.style.width  = Math.floor(w) + 'px';
  tile.style.height = Math.floor(h) + 'px';
}

/* подстраиваем size при изменении контейнера */
(() => {
  const m = tilesMain();
  if (!m) return;
  try {
    const ro = new ResizeObserver(()=> fitSpotlightSize());
    ro.observe(m);
  } catch {}
})();
