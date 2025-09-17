// ===== Desktop layout (spotlight + rail) =====
import { ctx } from "../state.js";
import { byId } from "../utils.js";
import { createTileEl, tilesMain, tilesRail } from "../tiles.js";
import { usersCounterText } from "../registry.js";

/* ----------------------------- Утилиты ----------------------------------- */
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
const raf = (fn) => requestAnimationFrame(fn);
const on = (el, ev, fn, opts) => el && el.addEventListener(ev, fn, opts);
const qs = (sel, root=document) => root.querySelector(sel);
const qsa = (sel, root=document) => Array.from(root.querySelectorAll(sel));

/* ------------------------ Пользовательский счётчик ----------------------- */
export function updateUsersCounter(){
  const tag = byId('usersTag');
  if (tag) tag.textContent = usersCounterText();
}

/* =============================== СПОТЛАЙТ ================================ */
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

export function fitSpotlightSize(){
  const main = tilesMain();
  const tile = main?.querySelector('.tile.spotlight');
  if (!tile || !main) return;

  const box = main.getBoundingClientRect();
  // Вычисляем AR из самого видео, fallback к классам
  const v = tile.querySelector('video');
  let ar = 16/9;
  if (v && v.videoWidth > 0 && v.videoHeight > 0){ ar = v.videoWidth / v.videoHeight; }
  else if (tile.classList.contains('portrait')) ar = 9/16;

  let w = box.width, h = w / ar;
  if (h > box.height){ h = box.height; w = h * ar; }

  tile.style.width  = Math.floor(w) + 'px';
  tile.style.height = Math.floor(h) + 'px';
  // Центрирование через margin-auto
  tile.style.margin = 'auto';

  // если при смене AR видео поменялось — дергаем ещё раз в следующий кадр
  requestAnimationFrame(()=>{
    const v2 = tile.querySelector('video');
    if (v2 && v2.videoWidth>0 && v2.videoHeight>0){
      const ar2 = v2.videoWidth / v2.videoHeight;
      if (Math.abs(ar2 - ar) > 0.001) fitSpotlightSize();
    }
  });
}

/* Подсветка активных спикеров (общая фича) */
export function highlightSpeaking(ids){
  const set=new Set(ids);
  document.querySelectorAll('.tile').forEach(t=>t.classList.remove('speaking'));
  set.forEach(id=>{
    document.querySelector(`.tile[data-pid="${CSS.escape(id)}"]`)?.classList.add('speaking');
  });
}

/* ===== Авто-детект портретности видео и пересчёт ===== */
function updateTileOrientationFromVideo(video){
  const tile = video.closest?.('.tile');
  if (!tile) return;
  const vw = video.videoWidth | 0;
  const vh = video.videoHeight | 0;
  if (!vw || !vh) return;

  const isPortrait = vh > vw;
  const wasPortrait = tile.classList.contains('portrait');
  if (isPortrait !== wasPortrait){
    tile.classList.toggle('portrait', isPortrait);
    fitSpotlightSize();
  }
}
function attachVideoARWatcher(video){
  if (!video || video.__arWatchAttached) return;
  const handler = () => updateTileOrientationFromVideo(video);

  video.addEventListener('loadedmetadata', handler);
  video.addEventListener('loadeddata', handler);
  video.addEventListener('resize', handler);

  if (typeof queueMicrotask === 'function') queueMicrotask(handler);
  else setTimeout(handler, 0);

  video.__arWatchAttached = true;
}
function observeAllTileVideos(){
  document.querySelectorAll('.tile video').forEach(attachVideoARWatcher);
}
let videoMutationObs = null;
function installVideoARObservers(){
  const root = tilesMain() || document;
  if (videoMutationObs) videoMutationObs.disconnect();
  videoMutationObs = new MutationObserver(muts => {
    for (const m of muts){
      m.addedNodes && m.addedNodes.forEach(node=>{
        if (node.nodeType !== 1) return;
        if (node.matches?.('video')) attachVideoARWatcher(node);
        node.querySelectorAll?.('video').forEach(attachVideoARWatcher);
      });
    }
  });
  videoMutationObs.observe(root, { childList:true, subtree:true });
  observeAllTileVideos();
}

/* ================================ APPLY ================================== */
export function applyLayout(){
  const tiles = byId('tiles'), main = tilesMain(), rail = tilesRail();

  // Восстановление DOM-плиток из реестра
  ctx.registry.forEach((rec)=>{
    if(!document.body.contains(rec.tile)){
      rec.tile = createTileEl(rec.participant.identity, rec.name, rec.isLocal);
    }
  });

  // Если нет ни одной плитки — вставляем локальную заглушку
  if (!document.querySelector('.tile') && ctx.room?.localParticipant){
    const me  = ctx.room.localParticipant;
    const rec = ctx.registry.get(me.identity);
    if (rec && !rec.tile){
      rec.tile = createTileEl(me.identity, rec.name || me.identity, true);
      main && main.appendChild(rec.tile);
    }
  }

  const spotlightId = chooseAutoSpotlight();
  const totalTiles  = document.querySelectorAll('.tile').length;

  tiles.classList.add('spotlight');
  tiles.classList.toggle('single', totalTiles<=1);

  // Сброс мобильных инлайновых стилей на main
  if (main){
    main.style.gridTemplateColumns = '';
    main.style.display = '';
    main.style.gap = '';
    main.style.gridAutoFlow = '';
    main.style.alignContent = '';
    main.style.justifyContent = '';
  }
  document.querySelectorAll('.tile').forEach(t=>{
    t.style.aspectRatio = '';
  });

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

/* ================================ INIT =================================== */
export function initLayout(){
  updateUsersCounter();
  installVideoARObservers();

  // На старте разложим и подгоним спотлайт
  applyLayout();
  fitSpotlightSize();

  // Ресайз
  on(window, 'resize', ()=> fitSpotlightSize(), { passive:true });
  const ro = new ResizeObserver(()=> fitSpotlightSize());
  const tm = tilesMain();
  tm && ro.observe(tm);
}
