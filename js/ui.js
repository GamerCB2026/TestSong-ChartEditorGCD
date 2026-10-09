/* =====================================================================
   ui.js — menú de pausa estilo V-Slice (fondo oscuro, opciones con la fuente
   Alphabet "bold", datos de la canción arriba a la derecha), menú de OPCIONES
   estilo FNF (Back, Cambio De Dificultad, Middlescroll, Downscroll/Upscroll,
   Asignar Teclas), barra de tiempo (solo en pausa, arrastrable), panel del
   chart, lista de assets, avisos y controles (teclado / táctil).
   ===================================================================== */
'use strict';

const overlay = $('overlay');
const UI = { kind: null, menu: null, items: [], sel: 0, panel: null, waitKey: null, lastToggle: 0, openedAt: 0 };

const BASE_MENUS = {
  pause: [['resume', 'Reanudar'], ['restart', 'Reiniciar'], ['options', 'Opciones'], ['chart', 'Chart y modo'], ['assets', 'Assets cargados']],
  ready: [['resume', 'Jugar'], ['options', 'Opciones'], ['chart', 'Chart y modo'], ['assets', 'Assets cargados']],
  over:  [['restart', 'Reintentar'], ['options', 'Opciones'], ['chart', 'Chart y modo'], ['assets', 'Assets cargados']],
  end:   [['restart', 'Otra vez'], ['options', 'Opciones'], ['chart', 'Chart y modo'], ['assets', 'Assets cargados']],
};
const TITLES = { pause: '', over: 'Perdiste', end: 'Cancion terminada', ready: 'Listo', options: 'Opciones', difficulty: 'Dificultad', keybinds: 'Asignar Teclas' };
const PARENT = { options: null, difficulty: 'options', keybinds: 'options' };   // null = menú base (pausa/listo…)
const onOff = b => b ? 'On' : 'Off';

/* elementos de cada menú: [id, texto] */
function menuItems(menu) {
  switch (menu) {
    case 'options': return [
      ['back', 'Back'],
      ['difficulty', 'Cambio De Dificultad'],
      ['middlescroll', 'Middlescroll: ' + onOff(Opts.middlescroll)],
      ['downscroll', Opts.isDown() ? 'Downscroll' : 'Upscroll'],
      ['keybinds', 'Asignar Teclas'],
      ['vslice', 'Controles V-Slice: ' + ({ off: 'Off', arrows: 'Flechas', hitbox: 'Hitbox' }[Opts.vslice] || 'Off')],
    ];
    case 'difficulty': {
      // canción con variaciones (.fnfc): "normal", "erect (erect)", "normal (pico)"…
      if (G.pack) return [['back', 'Back'], ...G.pack.entries.map(en => ['diff:' + en.v + '|' + en.d, (en.v === G.variation && en.d === G.chart.difficulty ? '> ' : '') + en.label])];
      const ds = (G.chart && G.chart.difficulties && G.chart.difficulties.length) ? G.chart.difficulties : [G.chart && G.chart.difficulty || 'normal'];
      return [['back', 'Back'], ...ds.map(d => ['diff:' + d, (d === (G.chart.difficulty || ds[0]) ? '> ' : '') + d])];
    }
    case 'keybinds': return [
      ['back', 'Back'],
      ...[0, 1, 2, 3].map(i => ['key:' + i, `${LANE_ES[i]}: ${UI.waitKey === i ? '...' : keyName(Opts.keys[i])}`]),
      ['reset', 'Reset'],
    ];
    default: return BASE_MENUS[menu] || BASE_MENUS.pause;
  }
}

function buildMenu(menu, keepSel) {
  UI.menu = menu;
  const box = $('pauseItems'); box.innerHTML = '';
  box.classList.toggle('submenu', menu in PARENT);
  UI.items = menuItems(menu).map(([id, label], i) => {
    const b = document.createElement('button'); b.className = 'pitem'; b.dataset.id = id; b.type = 'button';
    const cv2 = document.createElement('canvas'); const sp = document.createElement('span'); sp.textContent = label;
    b.append(cv2, sp);
    b.addEventListener('mouseenter', () => { if (UI.waitKey === null) select(i, true); });
    b.addEventListener('click', e => { e.stopPropagation(); if (UI.waitKey !== null) return; select(i, true); activate(id); });
    box.appendChild(b);
    return { id, label, el: b, canvas: cv2, span: sp };
  });
  const sel = keepSel ? Math.min(UI.sel, UI.items.length - 1) : 0;
  UI.sel = -1; select(sel, true);
  $('optHint').textContent = menu === 'keybinds' ? (UI.waitKey !== null ? `Presiona una tecla para ${LANE_ES[UI.waitKey]} (Esc cancela)` : 'Enter: cambiar tecla · Las flechas ← ↓ ↑ → siempre funcionan · Esc: volver')
    : menu === 'options' ? 'Enter / clic: cambiar · Esc: volver · Se guarda en este navegador'
    : menu === 'difficulty' ? (G.pack && G.pack.vars.length > 1 ? 'Dificultad (variación): cambiar de variación recarga chart, audio, personajes y escenario' : 'Elige una dificultad: la canción se reinicia con esas notas') : '';
  $('optHint').hidden = !(menu in PARENT);
  syncTimeBar();
  overlay.classList.toggle('opciones', menu in PARENT);
  updateTimeBar();
}
function select(i, silent) {
  const n = UI.items.length; i = ((i % n) + n) % n;
  if (i !== UI.sel && !silent) Sfx.play('scrollMenu', 0.4);
  UI.sel = i;
  UI.items.forEach((it, k) => { it.el.classList.toggle('sel', k === i); it.el.style.setProperty('--d', k - i); });
}
function goBack() {
  if (UI.waitKey !== null) { UI.waitKey = null; buildMenu('keybinds', true); return; }
  if (UI.menu in PARENT) {
    const p = PARENT[UI.menu], from = UI.menu;
    buildMenu(p || UI.kind);
    const idx = UI.items.findIndex(it => it.id === from); if (idx >= 0) select(idx, true);
    return;
  }
  if (UI.kind === 'pause' || UI.kind === 'ready') togglePause();
}
function activate(id) {
  if (id === 'resume') togglePause();
  else if (id === 'restart') restart();
  else if (id === 'chart' || id === 'assets') togglePanel(id);
  else if (id === 'options') { togglePanel(null); buildMenu('options'); }
  else if (id === 'back') goBack();
  else if (id === 'difficulty') buildMenu('difficulty');
  else if (id === 'keybinds') buildMenu('keybinds');
  else if (id === 'middlescroll') { Opts.middlescroll = !Opts.middlescroll; Opts.save(); resize(); buildMenu('options', true); Sfx.play('scrollMenu', 0.4); }
  else if (id === 'downscroll') { Opts.downscroll = !Opts.isDown(); Opts.save(); resize(); buildMenu('options', true); Sfx.play('scrollMenu', 0.4); }
  else if (id === 'vslice') {
    const order = ['off', 'arrows', 'hitbox']; Opts.vslice = order[(order.indexOf(Opts.vslice) + 1) % order.length]; Opts.save(); resize(); buildMenu('options', true); Sfx.play('scrollMenu', 0.4);
    toast({ off: 'Controles V-Slice: Off → 4 zonas grandes de toque (las de siempre)', arrows: 'Controles V-Slice: Flechas → tocas los receptores (zonas invisibles más pequeñas, como el juego en móvil)', hitbox: 'Controles V-Slice: Hitbox → 4 carriles invisibles que se iluminan al tocar' }[Opts.vslice], 4200);
    if (Opts.vslice !== 'off' && G.mode !== 'mobile') toast('Controles V-Slice: se usan en modo Táctil (toca la pantalla o elige "Táctil" en Chart y modo)', 4200);
  }
  else if (id === 'reset') { Opts.resetKeys(); buildMenu('keybinds', true); toast('Teclas por defecto: A S W D (+ flechas)'); }
  else if (id.startsWith('key:')) { UI.waitKey = +id.slice(4); buildMenu('keybinds', true); }
  else if (id.startsWith('diff:')) changeDifficulty(id.slice(5));
}
function changeDifficulty(d) {
  if (G.pack && d.includes('|')) {
    const [v, diff] = [d.slice(0, d.indexOf('|')), d.slice(d.indexOf('|') + 1)];
    if (v !== G.variation) { loadVariation(G.pack, v, diff).catch(err => { console.error(err); toast('Error: ' + err.message); }); return; }
    d = diff;
  }
  if (!G.raw) { toast('Este chart solo tiene una dificultad'); return; }
  try {
    const chart = Chart.parse(G.raw, G.meta, d);
    chart.scene = G.chart.scene;
    G.chart = chart; G.speed = chart.speed;
    Events.preload(chart);
    $('diffSel').value = G.pack ? G.variation + '|' + d : d;
    toast('Dificultad: ' + d.toUpperCase() + ` (${chart.notes.length} notas)`);
    restart();            // se reinicia la canción con las notas nuevas (y se cierra el menú)
    ModUI.check(chart);
  } catch (err) { toast('Error: ' + err.message); }
}
/* cambia de variación: pantalla de carga → chart + audio (solo el de esa variación) + personajes/escenario de su metadata */
async function loadVariation(pack, vid, diff) {
  const va = pack.vars.find(x => x.id === vid); if (!va) throw new Error('no existe la variación ' + vid);
  const chart = Chart.parse(va.chart, va.meta, diff);
  G.raw = va.chart; G.meta = va.meta; G.pack = pack; G.variation = vid;
  const au = packAudio(pack, vid);
  SongLoad.missing = [...pack.missing, ...au.notes.map(n => `audio (${vid}): ${n}`)];
  await loadChart(chart, au.list, { label: vid === 'default' ? 'Cargando…' : `Cargando variación ${vid}…`, minMs: 450 });
  toast(`${chart.title} · ${vid === 'default' ? chart.difficulty : chart.difficulty + ' (' + vid + ')'} · audio: ${au.list.map(t => t.name).join(', ') || 'ninguno'}`, 3500);
}
function togglePanel(id) {
  UI.panel = UI.panel === id ? null : id;
  $('panelOpts').hidden = UI.panel !== 'chart'; $('panelAssets').hidden = UI.panel !== 'assets';
  $('pausePanel').classList.toggle('show', !!UI.panel);
  document.body.classList.toggle('panel-abierto', !!UI.panel);   // el botón de pantalla completa no tapa el panel
  if (UI.panel === 'assets') { renderAssetList(); UserAssets.render(); }
  syncTimeBar();
}
function syncTimeBar() { $('timeBar').hidden = !(UI.kind === 'pause' && UI.menu === 'pause' && !UI.panel); }
function renderAssetList() {
  const lines = Scene.loading ? ['Cargando…'] : statusLines();
  $('assetList').innerHTML = lines.map(l => `<div class="${l.startsWith('✘') ? 'bad' : 'ok'}">${escHtml(l)}</div>`).join('');
}

/* cada frame mientras el menú está abierto: letras animadas (AtlasText a 24 fps) */
function uiTick() {
  if (!UI.kind) return;
  const t = performance.now();
  const base = clamp(Math.min(innerWidth * 0.06, innerHeight * 0.075), 24, 52);
  for (const it of UI.items) {
    const c = Fonts.toCanvas('bold', it.label, it.el.classList.contains('sel') ? base * 1.08 : base, t, it.canvas);
    it.el.classList.toggle('alfabeto', !!c);
  }
  const title = TITLES[UI.menu in PARENT ? UI.menu : UI.kind];
  const tc = title ? Fonts.toCanvas('bold', title, clamp(innerWidth * 0.07, 30, 64), t, $('ovTitleCanvas')) : null;
  $('ovTitleText').textContent = title ? title.toUpperCase() : '';
  $('ovTitle').classList.toggle('alfabeto', !!tc);
  $('ovTitle').hidden = !title;
  if (UI.kind === 'pause' && !TB.drag) updateTimeBar();
}

function hideOverlay() { overlay.classList.remove('show'); document.body.classList.remove('panel-abierto'); Sfx.stopLoop(); UI.kind = G.overlayKind = null; UI.waitKey = null; }
function openOverlay(kind, menu) {
  if (Loader.active) return;
  G.paused = true; UI.kind = G.overlayKind = kind; UI.openedAt = performance.now();
  Music.pause();                                   // guarda la posición exacta y detiene las fuentes (síncrono)
  G.songPos = Music.position();
  for (let i = 0; i < 4; i++) release(i);
  const acc = G.judged ? (G.accSum / G.judged * 100).toFixed(2) + '%' : '—';
  const meta = [G.chart.title, G.chart.artist ? 'Artista: ' + G.chart.artist : '', G.chart.difficulty ? 'Dificultad: ' + G.chart.difficulty.toUpperCase() : '',
    `Puntuación: ${formatMoney(G.score)}`, `Fallos: ${G.misses}`, `Precisión: ${acc}`].filter(Boolean);
  $('pauseMeta').innerHTML = meta.map(l => `<div>${escHtml(l)}</div>`).join('');
  $('pauseMeta').insertAdjacentHTML('beforeend', clearPercentHtml(kind));
  $('modeSel').value = G.mode;
  fillDiffSel();
  UI.waitKey = null;
  buildMenu(menu || kind);
  UI.panel = null; document.body.classList.remove('panel-abierto'); $('pausePanel').classList.remove('show'); $('panelOpts').hidden = $('panelAssets').hidden = true;
  syncTimeBar();
  overlay.classList.add('show');
  if (kind === 'pause' && Sfx.has('pauseMusic')) Sfx.playLoop('pauseMusic', 0.5, 8);
  uiTick();
}
function closeOverlay() {
  hideOverlay();
  G.paused = false; lastFrame = performance.now();
  if (G.songPos >= songLength()) return;
  Music.play(G.songPos);                           // reanuda EXACTAMENTE donde se pausó (mismo reloj para notas y audio)
}
/* alternar pausa con protección contra pulsaciones repetidas muy rápidas */
function togglePause() {
  const now = performance.now();
  if (now - UI.lastToggle < 90) return false;
  UI.lastToggle = now;
  if (G.overlayKind) { if (G.overlayKind === 'pause' || G.overlayKind === 'ready') closeOverlay(); else return false; }
  else openOverlay('pause');
  return true;
}
/* % de precisión con la fuente freeplay-clear (al terminar la canción) */
function clearPercentHtml(kind) {
  if (kind !== 'end' || !G.judged || !Fonts.has('freeplay-clear')) return '';
  const pct = String(Math.floor(G.accSum / G.judged * 100));
  const c = Fonts.toCanvas('freeplay-clear', pct, 40);
  return c ? `<div class="clear"><img alt="${pct}%" src="${c.toDataURL()}"><b>%</b></div>` : '';
}
function setMode(m) { const ch = G.mode !== m; G.mode = m; $('modeSel').value = m; if (ch && typeof resize === 'function' && G.chart) resize(); }
function fillDiffSel() {
  const ds = G.chart && G.chart.difficulties;
  if (G.pack && G.pack.entries.length > 1) {
    $('diffSel').innerHTML = G.pack.entries.map(en => `<option value="${escHtml(en.v + '|' + en.d)}">${escHtml(en.label)}</option>`).join('');
    $('diffSel').value = G.variation + '|' + G.chart.difficulty; $('diffRow').style.display = '';
  } else if (ds && ds.length > 1) {
    $('diffSel').innerHTML = ds.map(d => `<option value="${d.replace(/"/g, '')}">${d.replace(/</g, '')}</option>`).join('');
    $('diffSel').value = G.chart.difficulty; $('diffRow').style.display = '';
  } else $('diffRow').style.display = 'none';
}

let toastTimer = 0;
function toast(msg, ms = 2200) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms); }

/* ---------- barra de tiempo (solo en la pausa): tiempo actual / total, arrastrable ---------- */
const TB = { drag: false };
const fmtTime = ms => { ms = Math.max(0, ms); const s = Math.floor(ms / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
function updateTimeBar(pos) {
  if (!G.chart) return;
  const total = songLength(), p = pos ?? Math.max(0, G.songPos);
  $('tbFill').style.width = (clamp(p / total, 0, 1) * 100) + '%';
  $('tbText').textContent = `${fmtTime(p)} / ${fmtTime(total)}`;
}
function tbPos(e) { const r = $('tbTrack').getBoundingClientRect(); return clamp((e.clientX - r.left) / r.width, 0, 1) * songLength(); }
$('tbTrack').addEventListener('pointerdown', e => {
  if (UI.kind !== 'pause') return;
  TB.drag = true; $('tbTrack').setPointerCapture(e.pointerId); $('timeBar').classList.add('drag');
  const p = tbPos(e); seekTo(p); updateTimeBar(p); e.preventDefault();
});
$('tbTrack').addEventListener('pointermove', e => { if (!TB.drag) return; const p = tbPos(e); seekTo(p); updateTimeBar(p); });
const tbEnd = e => { if (!TB.drag) return; TB.drag = false; $('timeBar').classList.remove('drag'); updateTimeBar(); };
$('tbTrack').addEventListener('pointerup', tbEnd); $('tbTrack').addEventListener('pointercancel', tbEnd);

/* ---------- botones / opciones ---------- */
$('pauseBtn').addEventListener('click', () => { if (!G.overlayKind || G.overlayKind === 'pause') togglePause(); });
$('modeSel').addEventListener('change', e => { setMode(e.target.value); toast('Modo: ' + e.target.selectedOptions[0].textContent); });
$('btnLoad').addEventListener('click', () => $('fileInput').click());
$('btnDemo').addEventListener('click', async () => {
  const song = await loadSongById(ASSET_CFG.defaultSongId).catch(() => null);
  G.pack = null; G.variation = 'default';
  if (song) { if (G.mode === 'demo') setMode('keyboard'); await loadChart(song.chart, song.audio); toast('Canción "test" cargada'); }
  else { G.raw = G.meta = null; setMode('demo'); await loadChart(Chart.makeDemo(), []); toast('Canción demo cargada'); }
});
$('diffSel').addEventListener('change', e => changeDifficulty(e.target.value));
$('fileInput').addEventListener('change', async e => {
  try { await handleFiles([...e.target.files]); } catch (err) { console.error(err); toast('Error al cargar: ' + err.message); }
  e.target.value = '';
});
document.addEventListener('visibilitychange', () => { if (document.hidden && !G.overlayKind && !Loader.active) openOverlay('pause'); });

async function handleFiles(files) {
  const { raw, meta, inst, voices, pack } = await readChartFiles(files);
  if (G.mode === 'demo') setMode('keyboard');
  if (pack) {
    // V-Slice: empieza en la variación por defecto (o la primera) con "normal" si existe
    const first = pack.entries.find(e => e.v === 'default' && e.d === 'normal') || pack.entries.find(e => e.v === 'default') || pack.entries[0];
    if (!first) throw new Error('el chart no tiene notas');
    await loadVariation(pack, first.v, first.d);
    return;
  }
  G.pack = null; G.variation = 'default';
  const chart = Chart.parse(raw, meta);
  G.raw = raw; G.meta = meta;
  const sc = chart.scene || {}, lc = x => String(x || '').toLowerCase();
  const audio = [];
  if (inst) audio.push({ blob: inst, role: 'inst', name: 'Inst' });
  (inst ? voices : voices.slice(0, 1)).forEach((v, i) => {
    const n = lc(v.name);
    const role = sc.bf && n.includes('-' + lc(sc.bf) + '.') ? 'player' : sc.dad && n.includes('-' + lc(sc.dad) + '.') ? 'opponent' : inst ? 'voices' : 'inst';
    audio.push({ blob: v.blob, role, name: v.name });
  });
  await loadChart(chart, audio, { label: 'Cargando chart…' });
  if (!Music.has) toast(`Chart cargado: ${chart.notes.length} notas (sin audio)`);
}

/* ---------- teclado ---------- */
window.addEventListener('keydown', e => {
  if (Loader.active || ModUI.open || Movil.portrait) return;
  if (G.overlayKind) {
    if (e.target && /SELECT|INPUT|TEXTAREA/.test(e.target.tagName)) return;
    // botones del panel (Assets cargados / Chart y modo): Enter/Espacio los activa el navegador, no el menú
    if (e.target && e.target.tagName === 'BUTTON' && e.target.closest('#pausePanel') && (e.key === 'Enter' || e.key === ' ')) return;
    // Asignar Teclas: esperando una tecla
    if (UI.waitKey !== null) {
      e.preventDefault();
      if (e.key === 'Escape') { UI.waitKey = null; buildMenu('keybinds', true); return; }
      if (RESERVED_KEYS.includes(e.key) || e.key in ARROW_KEYS || e.key === 'Unidentified' || e.key === 'Dead') { toast('Esa tecla no se puede asignar'); return; }
      const lane = UI.waitKey; UI.waitKey = null; Opts.setKey(lane, e.key);
      buildMenu('keybinds', true); toast(`${LANE_ES[lane]}: ${keyName(Opts.keys[lane])}`);
      return;
    }
    if (e.repeat && (e.key === 'Escape' || e.key === 'Enter')) { e.preventDefault(); return; }
    if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') { e.preventDefault(); select(UI.sel - 1); return; }
    if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') { e.preventDefault(); select(UI.sel + 1); return; }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(UI.items[UI.sel].id); return; }
    if (e.key === 'Escape' || e.key === 'Backspace' || e.key === 'p' || e.key === 'P') { e.preventDefault(); goBack(); return; }
    return;
  }
  const lane = Opts.laneOf(e.key);
  if (lane !== undefined) {
    e.preventDefault();
    if (e.repeat) return;
    if (G.mode === 'mobile') setMode('keyboard');
    press(lane);
    return;
  }
  if (e.repeat) return;
  if (e.key === 'Escape' || e.key === 'Enter' || e.key === 'p' || e.key === 'P') { e.preventDefault(); togglePause(); return; }
  if (e.key === 'o' || e.key === 'O') { e.preventDefault(); openOverlay('pause', 'options'); return; }   // atajo: Opciones
});
window.addEventListener('keyup', e => {
  const lane = Opts.laneOf(e.key);
  if (lane !== undefined) release(lane);
});

/* táctil: ver js/movil.js (zonas de toque, controles V-Slice, orientación y pantalla completa) */
