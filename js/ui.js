/* =====================================================================
   ui.js — menú de pausa estilo V-Slice (fondo oscuro, opciones con la fuente
   Alphabet "bold", datos de la canción arriba a la derecha), opciones del chart,
   lista de assets cargados, avisos y controles (teclado / táctil).
   ===================================================================== */
'use strict';

const overlay = $('overlay');
const UI = { kind: null, items: [], sel: 0, panel: null };

const MENUS = {
  pause: [['resume', 'Reanudar'], ['restart', 'Reiniciar cancion'], ['opts', 'Opciones del chart'], ['assets', 'Assets cargados']],
  ready: [['resume', 'Jugar'], ['opts', 'Opciones del chart'], ['assets', 'Assets cargados']],
  over:  [['restart', 'Reintentar'], ['opts', 'Opciones del chart'], ['assets', 'Assets cargados']],
  end:   [['restart', 'Otra vez'], ['opts', 'Opciones del chart'], ['assets', 'Assets cargados']],
};
const TITLES = { pause: '', over: 'Perdiste', end: 'Cancion terminada', ready: 'Listo' };

function buildMenu(kind) {
  const box = $('pauseItems'); box.innerHTML = '';
  UI.items = MENUS[kind].map(([id, label], i) => {
    const b = document.createElement('button'); b.className = 'pitem'; b.dataset.id = id;
    const cv2 = document.createElement('canvas'); const sp = document.createElement('span'); sp.textContent = label;
    b.append(cv2, sp);
    b.addEventListener('mouseenter', () => select(i, true));
    b.addEventListener('click', () => { select(i); activate(id); });
    box.appendChild(b);
    return { id, label, el: b, canvas: cv2, span: sp };
  });
  UI.sel = 0; select(0, true);
}
function select(i, silent) {
  const n = UI.items.length; i = ((i % n) + n) % n;
  if (i !== UI.sel && !silent) Sfx.play('scrollMenu', 0.4);
  UI.sel = i;
  UI.items.forEach((it, k) => { it.el.classList.toggle('sel', k === i); it.el.style.setProperty('--d', k - i); });
}
function activate(id) {
  if (id === 'resume') closeOverlay();
  else if (id === 'restart') restart();
  else if (id === 'opts' || id === 'assets') togglePanel(id);
}
function togglePanel(id) {
  UI.panel = UI.panel === id ? null : id;
  $('panelOpts').hidden = UI.panel !== 'opts'; $('panelAssets').hidden = UI.panel !== 'assets';
  $('pausePanel').classList.toggle('show', !!UI.panel);
  if (UI.panel === 'assets') renderAssetList();
}
function renderAssetList() {
  const lines = Scene.loading ? ['Cargando…'] : statusLines();
  $('assetList').innerHTML = lines.map(l => `<div class="${l.startsWith('✘') ? 'bad' : 'ok'}">${escHtml(l)}</div>`).join('');
}

/* cada frame mientras el menú está abierto: letras animadas (AtlasText a 24 fps) */
function uiTick() {
  if (!UI.kind) return;
  const t = performance.now();
  for (const it of UI.items) {
    const base = clamp(Math.min(innerWidth * 0.075, innerHeight * 0.085), 26, 56);
    const c = Fonts.toCanvas('bold', it.label, it.el.classList.contains('sel') ? base * 1.12 : base, t, it.canvas);
    it.el.classList.toggle('alfabeto', !!c);
  }
  const title = TITLES[UI.kind];
  const tc = title ? Fonts.toCanvas('bold', title, clamp(innerWidth * 0.09, 34, 72), t, $('ovTitleCanvas')) : null;
  $('ovTitle').classList.toggle('alfabeto', !!tc);
  $('ovTitle').hidden = !title;
}

function openOverlay(kind) {
  G.paused = true; UI.kind = G.overlayKind = kind; Music.pause();
  for (let i = 0; i < 4; i++) release(i);
  const acc = G.judged ? (G.accSum / G.judged * 100).toFixed(2) + '%' : '—';
  $('ovTitleText').textContent = { pause: 'PAUSA', over: '¡PERDISTE!', end: '¡CANCIÓN TERMINADA!', ready: '¡LISTO!' }[kind];
  const meta = [G.chart.title, G.chart.artist ? 'Artista: ' + G.chart.artist : '', G.chart.difficulty ? 'Dificultad: ' + G.chart.difficulty.toUpperCase() : '',
    `Puntuación: ${formatMoney(G.score)}`, `Fallos: ${G.misses}`, `Precisión: ${acc}`].filter(Boolean);
  $('pauseMeta').innerHTML = meta.map(l => `<div>${escHtml(l)}</div>`).join('');
  $('pauseMeta').insertAdjacentHTML('beforeend', clearPercentHtml(kind));
  $('modeSel').value = G.mode;
  buildMenu(kind);
  UI.panel = null; togglePanel(null); UI.panel = null; $('pausePanel').classList.remove('show'); $('panelOpts').hidden = $('panelAssets').hidden = true;
  overlay.classList.add('show');
  if (kind === 'pause' && Sfx.has('pauseMusic')) Sfx.playLoop('pauseMusic', 0.5, 8);
  uiTick();
}
function closeOverlay(silent) {
  overlay.classList.remove('show'); Sfx.stopLoop();
  UI.kind = G.overlayKind = null; G.paused = false; lastFrame = performance.now();
  if (!silent && Music.has && Music.started && G.songPos >= 0 && G.songPos < Music.duration) Music.play(G.songPos);
}
/* % de precisión con la fuente freeplay-clear (al terminar la canción) */
function clearPercentHtml(kind) {
  if (kind !== 'end' || !G.judged || !Fonts.has('freeplay-clear')) return '';
  const pct = String(Math.floor(G.accSum / G.judged * 100));
  const c = Fonts.toCanvas('freeplay-clear', pct, 40);
  return c ? `<div class="clear"><img alt="${pct}%" src="${c.toDataURL()}"><b>%</b></div>` : '';
}
function setMode(m) { G.mode = m; $('modeSel').value = m; }

let toastTimer = 0;
function toast(msg, ms = 2200) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms); }

/* ---------- botones / opciones ---------- */
$('pauseBtn').addEventListener('click', () => { if (G.overlayKind) { if (G.overlayKind === 'pause') closeOverlay(); } else openOverlay('pause'); });
$('modeSel').addEventListener('change', e => { setMode(e.target.value); toast('Modo: ' + e.target.selectedOptions[0].textContent); });
$('btnLoad').addEventListener('click', () => $('fileInput').click());
$('btnDemo').addEventListener('click', () => { G.raw = G.meta = null; $('diffRow').style.display = 'none'; loadChart(Chart.makeDemo()); toast('Canción demo cargada'); });
$('diffSel').addEventListener('change', e => { if (G.raw) { try { G.chart = Chart.parse(G.raw, G.meta, e.target.value); restart(); openOverlay('ready'); } catch (err) { toast('Error: ' + err.message); } } });
$('fileInput').addEventListener('change', async e => {
  try { await handleFiles([...e.target.files]); } catch (err) { console.error(err); toast('Error al cargar: ' + err.message); }
  e.target.value = '';
});
document.addEventListener('visibilitychange', () => { if (document.hidden && !G.overlayKind) openOverlay('pause'); });

async function handleFiles(files) {
  const { raw, meta, inst, voices } = await readChartFiles(files);
  const chart = Chart.parse(raw, meta);
  G.raw = raw; G.meta = meta;
  if (chart.difficulties && chart.difficulties.length > 1) {
    $('diffSel').innerHTML = chart.difficulties.map(d => `<option value="${d.replace(/"/g, '')}">${d.replace(/</g, '')}</option>`).join('');
    $('diffSel').value = chart.difficulty; $('diffRow').style.display = '';
  } else $('diffRow').style.display = 'none';
  if (G.mode === 'demo') setMode('keyboard');
  loadChart(chart, [inst, ...(inst ? voices : voices.slice(0, 1))]);
  if (!Music.has) toast(`Chart cargado: ${chart.notes.length} notas (sin audio)`);
  openOverlay('ready');
}

/* ---------- teclado ---------- */
window.addEventListener('keydown', e => {
  if (G.overlayKind) {
    if (e.target && /SELECT|INPUT/.test(e.target.tagName)) return;
    if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') { e.preventDefault(); select(UI.sel - 1); return; }
    if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') { e.preventDefault(); select(UI.sel + 1); return; }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(UI.items[UI.sel].id); return; }
    if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') { e.preventDefault(); if (G.overlayKind === 'pause' || G.overlayKind === 'ready') closeOverlay(); return; }
    return;
  }
  if (e.key === 'Escape' || e.key === 'Enter' || e.key === 'p' || e.key === 'P') { e.preventDefault(); openOverlay('pause'); return; }
  const lane = KEY_MAP[e.key] ?? KEY_MAP[(e.key || '').toLowerCase()];
  if (lane === undefined || e.repeat) return;
  e.preventDefault();
  if (G.mode === 'mobile') setMode('keyboard');
  press(lane);
});
window.addEventListener('keyup', e => {
  const lane = KEY_MAP[e.key] ?? KEY_MAP[(e.key || '').toLowerCase()];
  if (lane !== undefined) release(lane);
});

/* ---------- táctil: 4 columnas de la pantalla ---------- */
const pointers = new Map();
cv.addEventListener('pointerdown', e => {
  if (G.mode !== 'mobile') { if (e.pointerType === 'touch' && G.mode === 'demo') { setMode('mobile'); toast('Modo Táctil activado 📱'); } else return; }
  const lane = clamp(Math.floor(e.clientX / (W / 4)), 0, 3);
  pointers.set(e.pointerId, lane); press(lane); e.preventDefault();
});
const endPointer = e => { if (pointers.has(e.pointerId)) { release(pointers.get(e.pointerId)); pointers.delete(e.pointerId); } };
cv.addEventListener('pointerup', endPointer); cv.addEventListener('pointercancel', endPointer); cv.addEventListener('pointerleave', endPointer);
