// tiles.js — равномерная сетка (uniform grid) c единой ячейкой для обычных,
// но видео-тайлы растягиваются по своему AR на кратное число колонок.
import { ctx, state } from "./state.js";
import { byId, hashColor, isMobileView } from "./utils.js";
import { fitSpotlightSize, applyLayout } from "./layout.js";
import { markHasVideo, recomputeHasVideo } from "./registry.js";

// Безопасная обёртка для fitSpotlightSize
function safeFitSpotlightSize() {
  try {
    if (typeof fitSpotlightSize === 'function') {
      fitSpotlightSize();
    }
  } catch (e) {
    console.warn('fitSpotlightSize not available:', e);
  }
}

/* ===== DOM helpers ===== */
export function tilesMain(){ return byId('tilesMain'); }
export function tilesRail(){ return byId('tilesRail'); }
export function tilesHost(){ return byId('tiles'); }  // поле раскладки
export function getLocalTileVideo(){ return document.querySelector('.tile.me video'); }

function isMobileGrid(){ return isMobileView() && !ctx.isStageFull; }

/* ==== Overlay (как было) ==== */
const ov = byId('tileOverlay');
const ovMedia = byId('ovMedia');
const ovClose = byId('ovClose');
const ovName  = byId('ovName');
let ovReturnTile = null;

export async function openTileOverlay(tile){
  const v = tile.querySelector('video');
  if(!v) return;
  ovReturnTile = tile;
  ovName.textContent = tile.dataset.name || 'Видео';
  ov.classList.add('open'); ov.setAttribute('aria-hidden','false');
  ovMedia.innerHTML = ''; ovMedia.appendChild(v);
  try{ if(ov.requestFullscreen) await ov.requestFullscreen({ navigationUI:'hide' }); }catch{}
  try{ await screen.orientation.lock('landscape'); }catch{}
  state.me._mobileRotateOpen = true;
}
export async function closeTileOverlay(){
  if(!ovReturnTile) {
    ov.classList.remove('open'); ov.setAttribute('aria-hidden','true');
    try{ if(document.fullscreenElement) await document.exitFullscreen(); }catch{}
    try{ if(screen.orientation.unlock) screen.orientation.unlock(); }catch{}
    state.me._mobileRotateOpen = false;
    return;
  }
  const v = ovMedia.querySelector('video');
  if(v){ ovReturnTile.prepend(v); }
  ovReturnTile = null;
  ov.classList.remove('open'); ov.setAttribute('aria-hidden','true');
  try{ if(document.fullscreenElement) await document.exitFullscreen(); }catch{}
  try{ if(screen.orientation.unlock) screen.orientation.unlock(); }catch{}
  state.me._mobileRotateOpen = false;
}
ovClose?.addEventListener('click', closeTileOverlay);
ov?.addEventListener('click', (e)=>{ if(e.target===ov) closeTileOverlay(); });
document.addEventListener('keydown', (e)=>{ if(e.key==='Escape' && ov?.classList.contains('open')) closeTileOverlay(); });

/* ===== Создание тайла / строки в списке ===== */
export function createTileEl(identity, name, isLocal){
  const el=document.createElement('div');
  el.className='tile' + (isLocal?' me':'');

  el.dataset.pid=identity;
  el.dataset.name=name;
  el.style.background = hashColor(name);

  const vol = isLocal ? '' :
    `<div class="vol"><span>🔊</span><input type="range" min="0" max="100" value="100" data-act="vol"></div>`;

  el.innerHTML = `
    <div class="placeholder"><div class="avatar-ph">${name.slice(0,1).toUpperCase()}</div></div>
    <div class="name">${name}${isLocal?' (ты)':''}</div>
    ${vol}
    <div class="controls"><button class="ctrl" data-act="pin" title="В спотлайт">⭐</button></div>`;

  el.addEventListener('click', (e)=>{
    const act = e.target?.dataset?.act;
    if(act==='pin'){
      ctx.pinnedId = (ctx.pinnedId===identity ? null : identity);
      e.stopPropagation();
      return;
    }
    if(el.querySelector('video')){ openTileOverlay(el); }
  });

  el.addEventListener('input',(e)=>{
    if(e.target?.dataset?.act!=='vol') return;
    e.stopPropagation();
    const rec = ctx.registry.get(identity);
    const v = Math.max(0, Math.min(100, Number(e.target.value||0)));
    if(rec){
      rec.volume = v/100;
      if(rec.audioEl) rec.audioEl.volume = rec.volume;
    }
  });

  tilesMain().appendChild(el);
  requestLayout(); // переложим сразу
  return el;
}

export function createRowEl(identity, name){
  const row=document.createElement('div');
  row.className='user';
  row.dataset.pid = identity;
  row.innerHTML=`<div class="avatar" style="background:${hashColor(name)}">${name.slice(0,1).toUpperCase()}</div><div class="name">${name}</div>`;
  row.onclick=()=>{ ctx.pinnedId = (ctx.pinnedId===identity? null : identity); };
  
  // Добавляем в оба списка (сайдбар для десктопа, карусель для мобильных)
  const lists = document.querySelectorAll('#onlineList');
  lists.forEach(list => {
    const clonedRow = row.cloneNode(true);
    clonedRow.onclick = () => { ctx.pinnedId = (ctx.pinnedId===identity? null : identity); };
    list.appendChild(clonedRow);
  });
  
  return row;
}

/* ===== Видео/Аудио ===== */
export function setTileAspectFromVideo(tile, videoEl){
  const w = videoEl.videoWidth | 0;
  const h = videoEl.videoHeight | 0;
  if (!w || !h) return;

  tile.classList.toggle('portrait', h > w);
  tile.dataset.ar = (w>0 && h>0) ? (w/h).toFixed(6) : '';
  tile.dataset.vid = '1'; // пометка «есть видео»

  // гарантируем нахождение тайла в основном контейнере
  const m = tilesMain(); if (m && tile.parentElement !== m) m.appendChild(tile);

  if (isMobileView()){
    layoutUniformGrid();
    setTimeout(()=>{ if (isMobileView()) layoutUniformGrid(); }, 60);
  } else if (tile.classList.contains('spotlight')) {
    safeFitSpotlightSize();
  }
}

export function applyCamTransformsTo(el){
  if(!el) return;
  const rot = state.settings.camFlip ? ' rotate(180deg)' : '';
  const mir = state.settings.camMirror ? ' scaleX(-1)' : '';
  el.style.transform = mir + rot;
}
export function applyCamTransformsToLive(){
  const v = getLocalTileVideo();
  applyCamTransformsTo(v);
}

export function safeRemoveVideo(el){
  try{ el.pause?.(); }catch{}
  try{ el.srcObject = null; }catch{}
  try{ el.removeAttribute('src'); }catch{}
  try{ el.load?.(); }catch{}
  try{ el.remove(); }catch{}
}

export function attachVideoToTile(track, identity, isLocal, labelOverride){
  const rec  = ctx.registry.get(identity.replace('#screen','')) || { name: identity };
  const name = labelOverride || rec.name || identity;
  const tile = ensureTile(identity, name, isLocal);

  const newId = track?.mediaStreamTrack?.id || track?.mediaStream?.id || '';
  const curV  = tile.querySelector('video');
  const curId = tile.dataset.vid || '';

  if (curV && curId && curId === newId){
    curV.muted = !!isLocal;
    if (isLocal && !identity.includes('#screen')) applyCamTransformsTo(curV);
    setTileAspectFromVideo(tile, curV);
    return;
  }

  if (curV) safeRemoveVideo(curV);
  tile.querySelector('.placeholder')?.remove();

  const v = track.attach();
  v.autoplay = true;
  v.playsInline = true;
  v.setAttribute('autoplay','');
  v.setAttribute('playsinline','');
  if (isLocal){
    v.muted = true;
    v.setAttribute('muted','');
  }
  v.classList.add('media');
  tile.dataset.vid = newId || '1';
  tile.prepend(v);

  if(isLocal && !identity.includes('#screen')) applyCamTransformsTo(v);

  const tryApply = ()=> setTileAspectFromVideo(tile, v);
  v.addEventListener('loadedmetadata', tryApply);
  v.addEventListener('resize', tryApply);
  tryApply();

  // Форсируем пересчёт: сразу и через небольшой таймаут.
  // Для чужого видео также возвращаем тайл из оверлея/списков в основную мозаику.
  const m = tilesMain(); if (m && tile.parentElement !== m) m.appendChild(tile);
  // Отметим наличие видео у базового участника (без #screen)
  try { markHasVideo(identity.replace('#screen',''), true); } catch {}
  // Переобновим флаг по DOM, если track уже отрисовался
  setTimeout(()=>{ try { recomputeHasVideo(identity.replace('#screen','')); } catch {} }, 30);
  // Дёргаем общий слой раскладки, чтобы профили (desktop/mobile) точно переосмыслили режим
  try { applyLayout(); } catch {}
  if (isMobileGrid() || isMobileView()){
    layoutUniformGrid();
    setTimeout(()=> layoutUniformGrid(), 60);
  } else {
    requestLayout();
  }
}

export function ensureTile(identity, name, isLocal){
  let el = document.querySelector(`.tile[data-pid="${CSS.escape(identity)}"]`);
  if(el) return el;
  if(!identity.includes('#screen') && ctx.registry.has(identity)){
    return ctx.registry.get(identity).tile;
  }
  return createTileEl(identity, name, isLocal);
}

export function showAvatarInTile(identity){
  const t=document.querySelector(`.tile[data-pid="${CSS.escape(identity)}"]`);
  if(!t) return;
  t.classList.remove('portrait');
  const v = t.querySelector('video');
  if (v) safeRemoveVideo(v);
  t.dataset.vid = '';
  delete t.dataset.ar;
  try { markHasVideo(identity.replace('#screen',''), false); } catch {}
  if(!t.querySelector('.placeholder')){
    const ph=document.createElement('div');
    ph.className='placeholder';
    ph.innerHTML=`<div class="avatar-ph">${(t.dataset.name||'?').slice(0,1).toUpperCase()}</div>`;
    t.prepend(ph);
  }
  if (t.classList.contains('spotlight')) fitSpotlightSize();
  try { applyLayout(); } catch {}
  if (isMobileGrid()){
    layoutUniformGrid();
    setTimeout(()=>{ if (isMobileGrid()) layoutUniformGrid(); }, 50);
  } else {
    requestLayout();
  }
}

export function attachAudioTrack(track, baseId){
  const el=track.attach();
  el.style.display='none';
  document.body.appendChild(el);

  const rec = ctx.registry.get(baseId);
  if(rec){
    rec.audioEl = el;
    if(typeof rec.volume!=='number') rec.volume = 1;
    el.volume = rec.volume;
    const slider = rec.tile?.querySelector('.vol input[type=range]');
    if(slider){ slider.value = Math.round(rec.volume*100); slider.disabled=false; }
  }
  return el;
}

/* =========================================================================
   РАВНОМЕРНАЯ СЕТКА (UNIFORM) С «SPAN BY AR» ДЛЯ ВИДЕО-ТАЙЛОВ
   — обычные плитки: единый размер ячейки по всей сетке
   — видео-плитки: ширина = span*cellW (+gaps), где span≈AR_video/AR_cell
   — расчёт ведём по #tiles (fallback: #tilesMain)
   ========================================================================= */

function hasVideo(tile){
  return !!tile.dataset.vid && !!tile.querySelector('video');
}

function getVideoAR(tile){
  const d = parseFloat(tile.dataset.ar);
  if (d && isFinite(d) && d > 0) return d;
  const v = tile.querySelector('video');
  const w = v?.videoWidth|0, h = v?.videoHeight|0;
  return (w>0 && h>0) ? (w/h) : NaN;
}

function getTileAR(tile){
  const d = parseFloat(tile.dataset.ar);
  if (d && isFinite(d) && d > 0) return d;
  const v = tile.querySelector('video');
  const w = v?.videoWidth|0, h = v?.videoHeight|0;
  if (w>0 && h>0) return w/h;
  return tile.classList.contains('portrait') ? (9/16) : (16/9);
}

// AR «ячейки» выбираем ТОЛЬКО по обычным (без видео) плиткам.
// Если их нет — берём 1:1 как нейтральный.
function pickCellAR(tiles){
  const ph = tiles.filter(t=>!hasVideo(t));
  if (!ph.length) return 1; // все видео — делаем квадратную базу
  const ars = ph.map(getTileAR);
  const portraits = ars.filter(a=>a<1).length;
  const majority = portraits > ph.length/2 ? (9/16) : (16/9);
  // попробуем также квадрат как запасной
  // вернём тот, который ближе к среднему по «фантомным» AR плейсхолдеров
  const avg = ars.reduce((s,a)=>s+a,0)/ars.length;
  const cand = [majority, 1];
  let best=cand[0], d=Math.abs(avg-best);
  if (Math.abs(avg-cand[1])<d) best=cand[1];
  return best;
}

// измеряем поле по #tiles (или #tilesMain)
function getFieldSize(){
  const host = tilesHost() || tilesMain() || document.body;
  const cs = getComputedStyle(host);
  const padH = (parseFloat(cs.paddingLeft)||0) + (parseFloat(cs.paddingRight)||0);
  const padV = (parseFloat(cs.paddingTop)||0)  + (parseFloat(cs.paddingBottom)||0);
  const W = Math.max(0, (host.clientWidth || host.getBoundingClientRect().width) - padH);
  const H = Math.max(0, (host.clientHeight|| host.getBoundingClientRect().height) - padV);
  return { W, H };
}

let layoutRAF = 0;
function requestLayout(){
  if (!isMobileGrid()) return;
  if (layoutRAF) return;
  layoutRAF = requestAnimationFrame(()=>{ layoutRAF = 0; layoutUniformGrid(); });
}

function layoutUniformGrid(){
  const m = tilesMain();
  if (!m) return;

  const tiles = Array.from(m.querySelectorAll('.tile'));
  const N = tiles.length;
  if (!N){ clearGrid(); return; }

  const { W, H } = getFieldSize();
  if (W < 10 || H < 10){ requestLayout(); return; }

  // гарантируем ширину
  m.style.width = '100%';

  const gap = parseFloat(getComputedStyle(m).getPropertyValue('--tile-gap')) || 10;

  // ==== Variant B: split video (80%) vs no-video (20%), videos keep native AR ====

  const allTiles = tiles;
  const videoTiles = allTiles.filter(t=> hasVideo(t));
  const noVideoTiles = allTiles.filter(t=> !hasVideo(t));

  const px = (v)=> Math.round(v) + 'px';

  // Helpers: place equal grid in rect
  function layoutEqualGrid(rect, items, opts){
    const forceSquare = !!(opts && opts.forceSquare);
    const n = items.length; if (!n) return;
    const { x, y, w:RW, h:RH } = rect;
    let best=null;
    for (let cols=1; cols<=n; cols++){
      const rows = Math.ceil(n/cols);
      let cw = Math.floor((RW - gap*(cols-1)) / cols);
      let ch = Math.floor((RH - gap*(rows-1)) / rows);
      if (cw<=0 || ch<=0) continue;
      if (forceSquare){
        const s = Math.min(cw, ch);
        cw = ch = s;
      }
      const area = cw*ch; if (!best || area>best.area) best={cols,rows,cw,ch,area};
    }
    if (!best) return;
    const offX = x + Math.max(0, Math.floor((RW - (best.cols*best.cw + gap*(best.cols-1))) / 2));
    const offY = y + Math.max(0, Math.floor((RH - (best.rows*best.ch + gap*(best.rows-1))) / 2));
    let i=0;
    for (let r=0;r<best.rows;r++){
      for (let c=0;c<best.cols;c++){
        const el = items[i++]; if (!el) break;
        const left = offX + c*(best.cw+gap);
        const top  = offY + r*(best.ch+gap);
        el.style.boxSizing='border-box';
        el.style.position='absolute';
        el.style.left = px(left);
        el.style.top  = px(top);
        el.style.setProperty('width',  px(best.cw), 'important');
        el.style.setProperty('height', px(best.ch), 'important');
        el.style.aspectRatio='';
      }
    }
  }

  // Helpers: video mosaic with native AR in rect (1..3 rows)
  function layoutVideoMosaic(rect, items){
    const n = items.length; if (!n) return;
    const { x, y, w:RW, h:RH } = rect;
    const desiredAR = items.map(getVideoAR).map(ar=> (ar && isFinite(ar))? ar : 16/9);
    const maxRows = Math.min(3, Math.max(1, n));
    let placed = 0;

    // Если в LANDSCAPE большинство видео портретные — удобнее колоночная укладка
    const isLandscape = matchMedia('(orientation: landscape)').matches;
    const portraitShare = desiredAR.filter(a=> a < 1).length / desiredAR.length;
    if (isLandscape && portraitShare > 0.5){
      // Колонки одинаковой ширины. Подберём число колонок и ширину так,
      // чтобы каждая колонка точно помещалась по высоте RH.
      let bestCol = null;
      for (let cols=1; cols<=Math.min(3, n); cols++){
        // чередуем элементы по колонкам (round-robin)
        const colIdxs = Array.from({length: cols}, ()=> []);
        for (let i=0; i<n; i++) colIdxs[i % cols].push(i);

        // лимит ширины по горизонтали
        const cwByWidth = Math.floor((RW - gap*(cols-1)) / cols);
        if (!(cwByWidth>0)) continue;

        // лимит ширины из высоты каждой колонки: sum(h_i) + gaps <= RH,
        // где h_i = cw/ar_i => cw <= (RH - gaps) / sum(1/ar_i)
        let cwByHeight = Infinity;
        for (const list of colIdxs){
          const invSum = list.reduce((s,i)=> s + (1/(desiredAR[i]|| (16/9))), 0);
          const gaps = gap * Math.max(0, list.length - 1);
          const limit = Math.floor((RH - gaps) / Math.max(0.0001, invSum));
          cwByHeight = Math.min(cwByHeight, limit);
        }
        const cw = Math.max(1, Math.min(cwByWidth, cwByHeight));
        // метрика: используем площадь
        const area = cw * RH * cols; // приблизительно
        if (!bestCol || area > bestCol.area){ bestCol = { cols, cw, colIdxs, area }; }
      }
      if (bestCol){
        const offX = x + Math.max(0, Math.floor((RW - (bestCol.cols*bestCol.cw + gap*(bestCol.cols-1))) / 2));
        for (let c=0; c<bestCol.cols; c++){
          const list = bestCol.colIdxs[c];
          // вертикальная центровка содержимого колонки
          const colHeights = list.map(i=> Math.max(1, Math.floor(bestCol.cw / (desiredAR[i] || (16/9)))));
          const colTotal = colHeights.reduce((s,h)=> s+h, 0) + gap * Math.max(0, colHeights.length - 1);
          let colY = y + Math.max(0, Math.floor((RH - colTotal) / 2));
          for (let k=0; k<list.length; k++){
            const idx = list[k];
            const el = items[idx]; const ar = desiredAR[idx]; if (!el || !ar) break;
            const h = Math.max(1, Math.floor(bestCol.cw / ar));
            // clamp последнего, чтобы не вылезти за RH из-за округлений
            const remaining = (y + RH) - colY;
            const hClamped = Math.max(1, Math.min(h, remaining));
            el.style.boxSizing='border-box';
            el.style.position='absolute';
            el.style.left = (offX + c*(bestCol.cw+gap)) + 'px';
            el.style.top  = colY + 'px';
            el.style.setProperty('width',  bestCol.cw + 'px', 'important');
            el.style.setProperty('height', hClamped + 'px', 'important');
            el.style.aspectRatio='';
            colY += hClamped + gap;
            if (colY > y + RH) break;
            placed++;
          }
        }
        return;
      }
    }

    function distributeCounts(n, rows){
      const base=Math.floor(n/rows), rem=n%rows; return Array.from({length:rows},(_,i)=> base+(i<rem?1:0));
    }

    let best=null;
    for(let rows=1; rows<=maxRows; rows++){
      const counts=distributeCounts(n, rows);
      const availH = (RH - gap*(rows-1)) / rows; if (!(availH>0)) continue;
      let i=0, totalH=0; const rowsMeta=[];
      for(let r=0;r<rows;r++){
        const cnt=counts[r]; const idxs=Array.from({length:cnt},(_,k)=> i+k).filter(j=> j<n);
        const sumAR = idxs.reduce((s,j)=> s+desiredAR[j],0) || (16/9);
        const hRow = Math.max(1, Math.min(availH, (RW - gap*(idxs.length-1)) / sumAR));
        rowsMeta.push({ idxs, h: hRow }); totalH += hRow; i += cnt;
      }
      totalH += gap*(rowsMeta.length-1);
      const fits = totalH <= RH + 0.5; const score=(fits?0:10000)+Math.abs(RH-totalH);
      if(!best || score<best.score) best={rowsMeta,score,totalH};
    }
    if(!best) return;

    const totalRowsH = Math.round(best.totalH || 0);
    let yCur = y + Math.max(0, Math.floor((RH - totalRowsH) / 2));
    for(const row of best.rowsMeta){
      const hInt = Math.floor(row.h);
      const gapsW = gap * (row.idxs.length - 1);
      const roundW = row.idxs.map(j=> Math.round((desiredAR[j] || (16/9)) * hInt));
      let sumW = roundW.reduce((s,w)=> s+w, 0);
      const targetTilesW = RW - gapsW; let delta = targetTilesW - sumW;
      if (Math.abs(delta) <= 2 && roundW.length){
        roundW[roundW.length-1] = Math.max(1, roundW[roundW.length-1] + delta);
        sumW += delta;
      }
      const rowTotal = sumW + gapsW;
      let xCur = x + Math.max(0, Math.round((RW - rowTotal) / 2));
      for(let k=0;k<row.idxs.length;k++){
        const el = items[row.idxs[k]]; if(!el) continue;
        const w = roundW[k];
        el.style.boxSizing='border-box';
        el.style.position='absolute';
        el.style.left = px(xCur);
        el.style.top  = px(yCur);
        el.style.setProperty('width',  px(w), 'important');
        el.style.setProperty('height', px(hInt), 'important');
        el.style.aspectRatio='';
        xCur += w + gap;
        placed++;
      }
      yCur += hInt + gap;
    }

    // Fallback: если что-то пошло не так и ничего не разложили — ровная строка по всей ширине
    if (!placed){
      const cw = Math.floor((RW - gap*(n-1)) / n);
      const ch = Math.max(1, Math.min(RH, Math.floor(RH)));
      let xCur = x;
      for (let i=0; i<n; i++){
        const el = items[i]; if (!el) continue;
        el.style.boxSizing='border-box';
        el.style.position='absolute';
        el.style.left = px(xCur);
        el.style.top  = px(y);
        el.style.setProperty('width',  px(cw), 'important');
        el.style.setProperty('height', px(ch), 'important');
        el.style.aspectRatio='';
        xCur += cw + gap;
      }
    }
  }

  // Case handling
  const anyVideo = videoTiles.length > 0;
  const anyNoVid = noVideoTiles.length > 0;

  m.style.position = 'relative';
  m.classList.add('grid-active');

  if (!anyVideo && anyNoVid){
    layoutEqualGrid({ x:0, y:0, w:W, h:H }, noVideoTiles, { forceSquare:false });
    m.style.height = px(H);
  } else if (anyVideo && !anyNoVid){
    layoutVideoMosaic({ x:0, y:0, w:W, h:H }, videoTiles);
    m.style.height = px(H);
  } else {
    const isPortrait = matchMedia('(orientation: portrait)').matches;
    if (isPortrait){
      const hVid = Math.max(0, Math.round(H * 0.8));
      const hNo  = Math.max(0, H - hVid - gap);
      layoutVideoMosaic({ x:0, y:0, w:W, h:hVid }, videoTiles);
      layoutEqualGrid({ x:0, y:hVid + gap, w:W, h:hNo }, noVideoTiles, { forceSquare:true });
      m.style.height = px(H);
    } else {
      const wVid = Math.max(0, Math.round(W * 0.8));
      const wNo  = Math.max(0, W - wVid - gap);
      layoutVideoMosaic({ x:0, y:0, w:wVid, h:H }, videoTiles);
      layoutEqualGrid({ x:wVid + gap, y:0, w:wNo, h:H }, noVideoTiles, { forceSquare:true });
      m.style.height = px(H);
    }
  }

  tiles.forEach(t=> t.classList.remove('spotlight','thumb'));
}

function clearGrid(){
  const m = tilesMain(); if (!m) return;
  m.classList.remove('grid-active');
  m.style.position = '';
  m.style.height   = '';
  m.style.width    = '';
  m.querySelectorAll('.tile').forEach(t=>{
    t.style.removeProperty('position');
    t.style.removeProperty('top');
    t.style.removeProperty('left');
    t.style.removeProperty('width');
    t.style.removeProperty('height');
    t.style.removeProperty('box-sizing');
    t.style.aspectRatio = '';
  });
}

/* --- реагируем на изменения окружения --- */
window.addEventListener('resize', ()=>{ if (isMobileGrid()) requestLayout(); }, { passive:true });
window.addEventListener('orientationchange', ()=>{ setTimeout(()=>{ if (isMobileGrid()) requestLayout(); }, 60); }, { passive:true });

/* ResizeObserver — следим и за .tiles-main, и за #tiles */
let roMain = null;
let roHost = null;
function attachROs(){
  const m = tilesMain();
  const h = tilesHost();

  if (roMain){ roMain.disconnect(); roMain = null; }
  if (roHost){ roHost.disconnect(); roHost = null; }

  if (m){
    roMain = new ResizeObserver(()=>{ if (isMobileGrid()) requestLayout(); });
    roMain.observe(m);
  }
  if (h){
    roHost = new ResizeObserver(()=>{ if (isMobileGrid()) requestLayout(); });
    roHost.observe(h);
  }
}
attachROs();
document.addEventListener('DOMContentLoaded', attachROs);

/* Перестраиваем при изменениях DOM/атрибутов (горячее подключение, смена AR) */
const tilesMutObs = new MutationObserver((muts)=>{
  if (!isMobileGrid()) return;
  for (const m of muts){
    if (m.type === 'childList' && (m.addedNodes.length || m.removedNodes.length)){ requestLayout(); return; }
    if (m.type === 'attributes'){ requestLayout(); return; } // data-ar / class / data-vid
  }
});
let tilesMutObsAttached = false;
function attachTilesMutObs(){
  if (tilesMutObsAttached) return;
  const tm = tilesMain();
  if (!tm) return;
  tilesMutObs.observe(tm, {
    childList:true,
    subtree:true,
    attributes:true,
    attributeFilter:['data-ar','class','data-vid']
  });
  tilesMutObsAttached = true;
}
attachTilesMutObs();
document.addEventListener('DOMContentLoaded', attachTilesMutObs);

/* ==== Наблюдение за изменением реального разрешения видео (resize/metadata + RAF) ==== */
function attachVideoARWatcher(video){
  if (!video || video.__mobArWatchAttached) return;
  const handler = ()=>{
    const tile = video.closest?.('.tile');
    if (!tile) return;
    setTileAspectFromVideo(tile, video);
    if (isMobileGrid() || isMobileView()) layoutUniformGrid(); else safeFitSpotlightSize();
  };
  video.addEventListener('loadedmetadata', handler);
  video.addEventListener('loadeddata', handler);
  video.addEventListener('resize', handler);
  // RAF-пуллер на случай отсутствия события resize у конкретной платформы
  let lastW = 0, lastH = 0;
  const poll = ()=>{
    if (!video.isConnected){ video.__mobArWatchAttached = false; return; }
    const w = video.videoWidth|0, h = video.videoHeight|0;
    if (w && h && (w!==lastW || h!==lastH)){
      lastW = w; lastH = h; handler();
    }
    video.__mobArWatchRAF = requestAnimationFrame(poll);
  };
  video.__mobArWatchAttached = true;
  poll();
}
function installVideoARWatchers(){
  const root = tilesMain() || document;
  root.querySelectorAll('video').forEach(attachVideoARWatcher);
  if (installVideoARWatchers._mo) installVideoARWatchers._mo.disconnect();
  const mo = new MutationObserver((muts)=>{
    for (const m of muts){
      m.addedNodes && m.addedNodes.forEach(node=>{
        if (node.nodeType!==1) return;
        if (node.matches?.('video')) attachVideoARWatcher(node);
        node.querySelectorAll?.('video').forEach(attachVideoARWatcher);
      });
    }
  });
  mo.observe(root, { childList:true, subtree:true });
  installVideoARWatchers._mo = mo;
}
installVideoARWatchers();
document.addEventListener('DOMContentLoaded', installVideoARWatchers);

/* Экспорт — на случай ручного пересчёта извне */
export function relayoutTilesIfMobile(){
  if (isMobileGrid()) layoutUniformGrid(); else clearGrid();
}
