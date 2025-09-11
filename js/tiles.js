// tiles.js — uniform grid для обычных плиток + видео всегда своим AR
// tiles.js — uniform grid: одинаковые боксы; видео внутри сохраняет свой AR
import { ctx, state } from "./state.js";
import { byId, hashColor, isMobileView } from "./utils.js";
import { fitSpotlightSize } from "./layout.js";
/* ===== DOM helpers ===== */
export function tilesMain(){ return byId('tilesMain'); }
export function tilesRail(){ return byId('tilesRail'); }
export function tilesHost(){ return byId('tiles'); }     // поле раскладки
export function tilesHost(){ return byId('tiles'); } // поле раскладки (#tiles)
export function getLocalTileVideo(){ return document.querySelector('.tile.me video'); }

function isMobileGrid(){ return isMobileView() && !ctx.isStageFull; }
export function createTileEl(identity, name, isLocal){
  });

  tilesMain().appendChild(el);
  requestLayout(); // переложим сразу
  requestLayout(); // сразу переложим
  return el;
}

export function createRowEl(identity, name){
}

/* ===== Видео/Аудио ===== */

function setPortraitFlag(tile, w, h){
  tile.classList.toggle('portrait', h > w);
}

export function setTileAspectFromVideo(tile, videoEl){
  const w = videoEl.videoWidth | 0;
  const h = videoEl.videoHeight | 0;
  if (!w || !h) return;

  setPortraitFlag(tile, w, h);
  tile.dataset.ar = (w>0 && h>0) ? (w/h).toFixed(6) : '';
  tile.dataset.vid = '1'; // пометка «есть видео»

  if (isMobileGrid()){
    requestLayout();
  } else if (tile.classList.contains('spotlight')) {
export function applyCamTransformsToLive(){
  applyCamTransformsTo(v);
}

/* — наблюдатель AR видео, чтобы ловить 16:9 ↔ 9:16 «на лету» — */
function stopVideoARWatcher(v){
  const st = v && v.__arWatch;
  if(!st) return;
function stopVideoARWatcher(v){
function startVideoARWatcher(v, tile){
  if (!v || v.__arWatch) return;
  let lastW = 0, lastH = 0;

  const check = (ww, hh)=>{
    // может прийти либо из metadata (w/h undefined), либо из rVFC
    const w = (ww|0) || (v.videoWidth|0);
    const h = (hh|0) || (v.videoHeight|0);
    if (!w || !h) return;
function startVideoARWatcher(v, tile){
      setTileAspectFromVideo(tile, v);
    }
  };

  const onMeta = ()=> check();
  v.addEventListener('loadedmetadata', onMeta);
  v.addEventListener('loadeddata', onMeta);
  v.addEventListener('resize', onMeta);

  let rfcb = 0, timer = 0;
  if (typeof v.requestVideoFrameCallback === 'function'){
    const loop = (_now, meta)=>{ check(meta?.width|0, meta?.height|0); rfcb = v.requestVideoFrameCallback(loop); };
function startVideoARWatcher(v, tile){
  } else {
    timer = setInterval(()=> check(), 300);
  }

  v.__arWatch = { onMeta, rfcb, timer };
}

export function attachAudioTrack(track, baseId){
}

/* =========================================================================
   РАВНОМЕРНАЯ СЕТКА С ФИКСИРОВАННОЙ ВЫСОТОЙ СТРОКИ:
   — обычные плитки: единая ширина (cellW), единая высота строки (rowH)
   — видео-плитки: ширина = rowH * videoAR (настоящий формат)
   — переносим по строкам; строку центрируем по ширине поля
   РАВНОМЕРНАЯ СЕТКА ДЛЯ МОБИЛЬНОГО РЕЖИМА
   — все плитки ОДИНАКОВОГО размера (cellW × rowH)
   — AR видео влияет только на содержимое внутри (через object-fit: contain)
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
function getTileAR(tile){
  return tile.classList.contains('portrait') ? (9/16) : (16/9);
}

// AR «ячейки» берём по обычным плиткам; если их нет — 1:1
function pickCellAR(tiles){
  const ph = tiles.filter(t=>!hasVideo(t));
  if (!ph.length) return 1;
  const ars = ph.map(getTileAR);
  const portraits = ars.filter(a=>a<1).length;
  const majority = portraits > ph.length/2 ? (9/16) : (16/9);
  const avg = ars.reduce((s,a)=>s+a,0)/ars.length;
  const cand = [majority, 1];
  let best=cand[0], d=Math.abs(avg-best);
  if (Math.abs(avg-cand[1])<d) best=cand[1];
  return best;
}

// измеряем поле по #tiles (или #tilesMain)
function getFieldSize(){
  const host = tilesHost() || tilesMain() || document.body;
function layoutUniformGrid(){
  if (W < 10 || H < 10){ requestLayout(); return; }

  m.style.width = '100%';

  const gap = parseFloat(getComputedStyle(m).getPropertyValue('--tile-gap')) || 10;

  const cellAR = pickCellAR(tiles);
  // AR ячейки берём по «большинству» тайлов; 1:1 — как запасной
  const ars = tiles.map(getTileAR);
  const portraits = ars.filter(a=>a<1).length;
  const cellAR = portraits > N/2 ? 9/16 : 16/9;

  // подбираем кол-во колонок для обычных плиток (1..N)
  // ищем число колонок, чтобы занять максимум пространства
  let best = null;

  function simulate(cols){
    const cellW = (W - gap*(cols-1)) / cols;
    if (cellW <= 0) return null;
    const rowH  = cellW / cellAR;

    // собираем строки, считая ширину каждого элемента
    const rows = [];
    let row = [];
    let rowW = 0;

    const pushRow = ()=>{
      if(!row.length) return;
      rows.push({ items: row, rowW });
      row = []; rowW = 0;
    };

    for (const el of tiles){
      let w;
      if (hasVideo(el)){
        const ar = getVideoAR(el);
        w = (ar>0 && isFinite(ar)) ? (rowH * ar) : cellW; // если вдруг AR неизвестен — как placeholder
        w = Math.min(Math.max(40, w), W); // приятные пределы
      } else {
        w = cellW;
      }

      const need = (row.length ? gap : 0) + w;
      if (rowW + need > W && row.length){ // перенос
        pushRow();
      }
      row.push({ el, w });
      rowW += (rowW>0 ? gap : 0) + w;
  function tryCols(cols){
    const rows = Math.ceil(N / cols);
    const cellWAvail = (W - gap * (cols - 1)) / cols;
    const cellHAvail = (H - gap * (rows - 1)) / rows;
    if (cellWAvail <= 0 || cellHAvail <= 0) return null;

    // стремимся к максимальной площади клетки, но чтобы всё влазило
    const hByW = cellWAvail / cellAR;
    const wByH = cellHAvail * cellAR;

    let cw, ch;
    if (hByW <= cellHAvail && wByH <= cellWAvail){
      // оба подходят — возьмём, что больше по площади
      const areaW = cellWAvail * hByW;
      const areaH = wByH * cellHAvail;
      if (areaW >= areaH){ cw = cellWAvail; ch = hByW; } else { cw = wByH; ch = cellHAvail; }
    } else if (hByW <= cellHAvail){
      cw = cellWAvail; ch = hByW;
    } else if (wByH <= cellWAvail){
      cw = wByH; ch = cellHAvail;
    } else {
      return null;
    }
    pushRow();

    const totalH = rows.length * rowH + gap*(rows.length-1);
    const fits = totalH <= H;
    // метрика: 1) не переполнить, 2) ближе к H, 3) меньше «дыр» в строках
    let blanks = 0;
    for (const r of rows){ blanks += Math.max(0, W - r.rowW); }
    const score = (fits?0:10000) + Math.abs(H-totalH) + blanks*0.01;

    return { cols, cellW, rowH, rows, totalH, score };
    const filledW = cw * cols + gap * (cols - 1);
    const filledH = ch * rows + gap * (rows - 1);
    const util = (filledW / W) * (filledH / H);
    const area = cw * ch;
    return { cols, rows, cw, ch, util, area };
  }

  for (let cols=1; cols<=N; cols++){
    const cand = simulate(cols);
    const cand = tryCols(cols);
    if (!cand) continue;
    if (!best || cand.score < best.score) best = cand;
    if (!best ||
        cand.area > best.area + 0.5 ||
        (Math.abs(cand.area - best.area) <= 0.5 && cand.util > best.util)){
      best = cand;
    }
  }
  if (!best){ clearGrid(); return; }

  // раскладываем
  // Раскладываем абсолютно по одинаковым боксам
  m.style.position = 'relative';
  m.classList.add('grid-active');

  const px = (v)=> Math.round(v) + 'px';
  const { rowH, rows } = best;

  let y = 0;
  for (const r of rows){
    // центрируем строку
    let x = Math.max(0, (W - r.rowW) / 2);
    r.items.forEach(({el, w})=>{
      el.style.boxSizing = 'border-box';
      el.style.position = 'absolute';
      el.style.left = px(x);
      el.style.top  = px(y);

      // перебиваем возможные !important
      el.style.setProperty('width',  px(w), 'important');
      el.style.setProperty('height', px(rowH), 'important');

      el.style.aspectRatio = ''; // управляем width/height

      x += w + gap;
    });
    y += rowH + gap;
  }
  const { cols, rows, cw, ch } = best;

  tiles.forEach((el, i)=>{
    const r = Math.floor(i / cols);
    const c = i % cols;
    const left = c * (cw + gap);
    const top  = r * (ch + gap);

    el.style.boxSizing = 'border-box';
    el.style.position = 'absolute';
    el.style.left = px(left);
    el.style.top  = px(top);
    el.style.setProperty('width',  px(cw), 'important');
    el.style.setProperty('height', px(ch), 'important');
    el.style.aspectRatio = ''; // управляем width/height
  });

  m.style.height = px(y - gap);
  m.style.height = px(rows * ch + gap * (rows - 1));
  tiles.forEach(t=> t.classList.remove('spotlight','thumb'));
}

function attachROs(){
attachROs();
document.addEventListener('DOMContentLoaded', attachROs);

/* Перестраиваем при изменениях DOM/атрибутов (горячее подключение, смена AR) */
/* Перестраиваем при изменениях DOM/атрибутов (горячие подключения, смена AR) */
const tilesMutObs = new MutationObserver((muts)=>{
  if (!isMobileGrid()) return;
  for (const m of muts){
tm && tilesMutObs.observe(tm, {
export function relayoutTilesIfMobile(){
  if (isMobileGrid()) layoutUniformGrid(); else clearGrid();
}
// === Унификация размеров: меньшая сторона видео = меньшей стороне иконки ===
function getBaseMinSide(){
  // берём первую не-видео плитку как эталон
  const ref = document.querySelector('.tile:not(.has-video)');
  if (ref) return Math.min(ref.clientWidth || 0, ref.clientHeight || 0) || 0;

  // fallback: попробуем CSS-переменную --tile-s или твой дефолт
  const r = getComputedStyle(document.documentElement);
  const cssS = parseFloat(r.getPropertyValue('--tile-s')) || 0;
  return cssS || 96; // последний рубеж
}

function sizeVideoTiles(){
  const S = getBaseMinSide();
  if (!S) return;

  document.querySelectorAll('.tile.has-video').forEach(t => {
    const v = t.querySelector('video');
    if (!v) return;

    // берём фактическое видео-AR; если ещё не готово — из data-ar или 16:9
    const vw = v.videoWidth, vh = v.videoHeight;
    let ar = (vw && vh) ? (vw / vh) : (parseFloat(t.dataset.ar) || 16/9);

    // меньшею сторону фиксируем как S
    const w = ar >= 1 ? S * ar : S;
    const h = ar >= 1 ? S       : S / ar;

    t.style.setProperty('--w', Math.round(w) + 'px');
    t.style.setProperty('--h', Math.round(h) + 'px');
    t.classList.add('sized-video');
  });
}

// вызывать после любой перекладки/ресайза/смены ориентации:
window.addEventListener('resize', sizeVideoTiles);
document.addEventListener('visibilitychange', sizeVideoTiles, true);
document.addEventListener('loadedmetadata', e => {
  if (e.target && e.target.tagName === 'VIDEO') sizeVideoTiles();
}, true);
document.addEventListener('play', e => {
  if (e.target && e.target.tagName === 'VIDEO') sizeVideoTiles();
}, true);

// если у тебя есть функция пересчёта мозаики — просто дерни sizeVideoTiles() в конце
// например:
// layoutMosaic = (...args) => { /* твой код */ ; sizeVideoTiles(); }