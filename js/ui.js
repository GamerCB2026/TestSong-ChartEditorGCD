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

const onOff = b => b ? 'On' : 'Off';
const BASE_MENUS = {
  pause: [['resume', 'Reanudar'], ['restart', 'Reiniciar'], ['options', 'Opciones'], ['optimizacion', 'Optimización'], ['chart', 'Chart y modo'], ['assets', 'Assets cargados']],
  ready: [['resume', 'Jugar'], ['options', 'Opciones'], ['optimizacion', 'Optimización'], ['chart', 'Chart y modo'], ['assets', 'Assets cargados']],
  over:  [['restart', 'Reintentar'], ['options', 'Opciones'], ['optimizacion', 'Optimización'], ['chart', 'Chart y modo'], ['assets', 'Assets cargados']],
  end:   [['restart', 'Otra vez'], ['options', 'Opciones'], ['optimizacion', 'Optimización'], ['chart', 'Chart y modo'], ['assets', 'Assets cargados']],
};
const TITLES = { pause: '', over: 'Perdiste', end: 'Cancion terminada', ready: 'Listo', options: 'Opciones', difficulty: 'Dificultad', keybinds: 'Asignar Teclas', optimizacion: 'Optimización' };
// menú Optimización: se abre desde la pausa (vuelve a la pausa) o desde Opciones (vuelve a Opciones)
const PARENT = { options: null, difficulty: 'options', keybinds: 'options', optimizacion: null };   // null = menú base (pausa/listo…)

/* ---------- Optimización: valores de cada ajuste (← → o Enter los recorren) ---------- */
const OPT_ITEMS = {
  preset:   { name: 'Calidad', vals: ['alta', 'media', 'baja', 'personalizado'], lab: { alta: 'Alta', media: 'Media', baja: 'Baja', personalizado: 'Personalizado' },
              hint: 'Alta: todo al máximo · Media: texturas 75 %, escenario simple, 60 FPS · Baja: texturas 50 %, mundo 75 %, sin GF, animaciones reducidas, sin bop ni splashes' },
  tex:      { name: 'Texturas', vals: [100, 75, 50], lab: v => v + '%', hint: 'Resolución de las imágenes de personajes y escenario (menos memoria y menos trabajo). Al cambiarla se recargan con pantalla de carga' },
  res:      { name: 'Resolución', vals: [100, 75, 50], lab: v => v + '%', hint: 'Resolución a la que se dibuja el mundo (escenario + personajes). Las notas y el HUD siguen nítidos' },
  stage:    { name: 'Escenario', vals: ['completo', 'simple', 'oculto'], lab: { completo: 'Completo', simple: 'Simple', oculto: 'Oculto' }, hint: 'Simple: solo el fondo (hasta 3 capas grandes, sin props animados ni de primer plano) · Oculto: fondo negro' },
  gf:       { name: 'GF', vals: [true, false], lab: v => v ? 'Visible' : 'Oculta', hint: 'Oculta a GF (un personaje grande menos que dibujar)' },
  anim:     { name: 'Animaciones', vals: ['normal', 'reducida', 'estatica'], lab: { normal: 'Normal', reducida: 'Reducidas', estatica: 'Estáticas' }, hint: 'Reducidas: personajes y props a 12 fps · Estáticas: primer frame de cada animación' },
  bop:      { name: 'Bop De Cámara', vals: [true, false], lab: onOff, hint: 'Zoom de la cámara y del HUD con el ritmo' },
  splashes: { name: 'Splashes', vals: [true, false], lab: onOff, hint: 'Salpicaduras al acertar SICK' },
  aa:       { name: 'Antialiasing', vals: [true, false], lab: onOff, hint: 'Suavizado de las imágenes al escalarlas (Off = más rápido, bordes pixelados)' },
  fps:      { name: 'Límite FPS', vals: [30, 60, 120, 0], lab: v => v ? String(v) : 'Sin límite', hint: 'Máximo de cuadros por segundo. 60 o 30 ahorran batería y dan un ritmo más estable en equipos lentos' },
  contador: { name: 'Contador FPS', vals: [false, true], lab: onOff, hint: 'Muestra FPS, tiempo por cuadro, el peor cuadro y el renderizador arriba a la izquierda' },
  renderer: { name: 'Render', vals: ['auto', 'webgl', 'canvas'], lab: v => ({ auto: 'Auto', webgl: 'WebGL', canvas: 'Canvas' }[v]),
              hint: 'Auto: WebGL si hay tarjeta gráfica (sube las texturas ASTC comprimidas a la GPU), si no Canvas' },
  auto:     { name: 'Bajo Rendimiento Auto', vals: [true, false], lab: onOff, hint: 'Si el juego va por debajo de ~40 FPS unos segundos, baja la calidad sola (te avisa)' },
  tirones:  { name: 'Anti Tirones', vals: [true, false], lab: onOff, hint: 'Si la pantalla se congela un momento, las notas que pasaron mientras tanto no cuentan como fallo' },
};
function optLabel(k) {
  const o = OPT_ITEMS[k], v = Optim.s[k], lab = typeof o.lab === 'function' ? o.lab(v) : o.lab[v];
  if (k === 'renderer' && v === 'auto') return `${o.name}: Auto (${Render.wantGL() ? 'WebGL' : 'Canvas'})`;
  return `${o.name}: ${lab}`;
}
function optCycle(k, dir = 1) {
  const o = OPT_ITEMS[k]; let vals = o.vals;
  if (k === 'preset') vals = vals.filter(v => v !== 'personalizado');
  const i = vals.indexOf(Optim.s[k]), v = vals[((i < 0 ? -1 : i) + dir + vals.length * 2) % vals.length];
  const oldTex = Optim.s.tex, oldRenderer = Optim.s.renderer;
  if (k === 'preset') Optim.setPreset(v);
  else { Optim.s[k] = v; Optim.touch(); }
  if (k === 'renderer' && v !== oldRenderer) {
    if (v === 'webgl' && !(GLW.init() && !GLW.lost)) toast('WebGL no está disponible en este navegador: se usa Canvas', 3500);
    reloadTextures('Cambiando renderizador…');
  } else if (Optim.s.tex !== oldTex) reloadTextures(`Texturas al ${Optim.s.tex}%…`);
  if (k === 'aa') toast('Antialiasing ' + onOff(v), 1500);
  buildMenu('optimizacion', true); Sfx.play('scrollMenu', 0.4);
}
/* recarga personajes/escenario (otra resolución de texturas u otro renderizador) sin perder la posición */
async function reloadTextures(label) {
  if (!G.chart) return;
  const pos = G.songPos, kind = UI.kind || 'pause', sel = UI.sel, from = UI.optFrom;
  Loader.reset(label); Loader.active = true; hideOverlay(); G.paused = true;
  try {
    TexLoad.reset(); Render.forgetTextures();
    Scene.ids = null; Scene.notes = null;
    const ids = Object.assign({}, G.chart.scene || {}, UserAssets.overrides());
    await Promise.all([loadScene(ids), new Promise(ok => setTimeout(ok, 300))]);
  } catch (e) { console.error(e); toast('Error al recargar: ' + e.message); }
  Loader.finish();
  G.songPos = pos; Music.seek(pos);
  openOverlay(kind === 'ready' ? 'ready' : 'pause', 'optimizacion');
  UI.optFrom = from; select(sel, true);
}

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
      ['optimizacion', 'Optimización'],
    ];
    case 'optimizacion': return [['back', 'Back'], ...Object.keys(OPT_ITEMS).map(k => ['opt:' + k, optLabel(k)])];
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
  if (menu === 'optimizacion' && !keepSel) UI.optFrom = UI.menu === 'options' ? 'options' : null;
  UI.menu = menu;
  const box = $('pauseItems'); box.innerHTML = '';
  box.classList.toggle('submenu', menu in PARENT);
  box.classList.toggle('largo', menu === 'optimizacion');
  UI.items = menuItems(menu).map(([id, label], i) => {
    const b = document.createElement('button'); b.className = 'pitem'; b.dataset.id = id; b.type = 'button';
    const cv2 = document.createElement('canvas'); const sp = document.createElement('span'); sp.textContent = label;
    b.append(cv2, sp);
    // solo con ratón (en táctil el "mouseenter" simulado elegía y cambiaba la opción con un solo toque)
    b.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse' && UI.waitKey === null && performance.now() - (UI.scrollAt || 0) > 300) select(i, true); });
    b.addEventListener('click', e => {
      e.stopPropagation(); if (UI.waitKey !== null) return;
      if (UI.swiped) { UI.swiped = false; return; }   // fue un deslizamiento, no un toque
      // lista larga (Optimización): el primer toque elige la opción (y la centra), el segundo cambia su valor
      if (menu === 'optimizacion' && i !== UI.sel && id !== 'back') { select(i); return; }
      select(i, true); activate(id);
    });
    box.appendChild(b);
    return { id, label, el: b, canvas: cv2, span: sp };
  });
  const sel = keepSel ? Math.min(UI.sel, UI.items.length - 1) : 0;
  UI.sel = -1; select(sel, true);
  $('optHint').textContent = menu === 'keybinds' ? (UI.waitKey !== null ? `Presiona una tecla para ${LANE_ES[UI.waitKey]} (Esc cancela)` : 'Enter: cambiar tecla · Las flechas ← ↓ ↑ → siempre funcionan · Esc: volver')
    : menu === 'options' ? 'Enter / clic: cambiar · Esc: volver · Se guarda en este navegador'
    : menu === 'optimizacion' ? optHintText()
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
  const largo = $('pauseItems').classList.contains('largo');
  UI.items.forEach((it, k) => {
    it.el.classList.toggle('sel', k === i);
    // lista larga: las opciones se alejan en curva a ambos lados y se desvanecen lejos de la elegida
    const d = k - i; it.el.style.setProperty('--d', largo ? Math.min(Math.abs(d), 4) : d);
    it.el.style.opacity = largo ? (d === 0 ? '' : String(Math.max(0, 0.6 - Math.max(0, Math.abs(d) - 2) * 0.2))) : '';
  });
  // lista larga (Optimización): se desplaza para que la opción elegida quede al centro
  const box = $('pauseItems');
  if (box.classList.contains('largo')) {
    const el = UI.items[i].el, y = el.offsetTop + el.offsetHeight / 2;
    const tr = `translateY(${-Math.round(y)}px)`;
    if (box.style.transform !== tr) { box.style.transform = tr; UI.scrollAt = performance.now(); }
    if (UI.menu === 'optimizacion') $('optHint').textContent = optHintText();
  } else box.style.transform = '';
}
function optHintText() {
  const it = UI.items[UI.sel], k = it && it.id.startsWith('opt:') ? it.id.slice(4) : null;
  const tip = k ? OPT_ITEMS[k].hint : 'Ajustes para que el juego vaya fluido en equipos lentos';
  return `${tip} · ← → / Enter: cambiar · Esc: volver · ${Render.name()}`;
}
function goBack() {
  if (UI.waitKey !== null) { UI.waitKey = null; buildMenu('keybinds', true); return; }
  if (UI.menu in PARENT) {
    const p = UI.menu === 'optimizacion' && UI.optFrom === 'options' ? 'options' : PARENT[UI.menu], from = UI.menu;
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
  else if (id === 'optimizacion') { if (UI.panel) togglePanel(null); buildMenu('optimizacion'); }
  else if (id.startsWith('opt:')) optCycle(id.slice(4), 1);
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
  const largo = UI.menu === 'optimizacion', bs = largo ? base * 0.72 : base;
  for (let k = 0; k < UI.items.length; k++) {
    const it = UI.items[k];
    if (largo && Math.abs(k - UI.sel) > 7 && it.canvas.width > 1) continue;   // las lejanas (fuera de pantalla) no se redibujan
    const c = Fonts.toCanvas('bold', it.label, it.el.classList.contains('sel') ? bs * 1.08 : bs, t, it.canvas);
    it.el.classList.toggle('alfabeto', !!c);
  }
  if (largo && UI.items[UI.sel]) { const el = UI.items[UI.sel].el, tr = `translateY(${-Math.round(el.offsetTop + el.offsetHeight / 2)}px)`, box = $('pauseItems'); if (box.style.transform !== tr) { box.style.transform = tr; UI.scrollAt = t; } }
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
    if (UI.menu === 'optimizacion' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'a' || e.key === 'A' || e.key === 'd' || e.key === 'D')) {
      e.preventDefault(); const id = UI.items[UI.sel].id; if (id.startsWith('opt:')) optCycle(id.slice(4), /Right|d|D/.test(e.key) ? 1 : -1); return;
    }
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
/* lista larga: rueda del ratón / deslizar el dedo para recorrerla */
overlay.addEventListener('wheel', e => { if (UI.menu !== 'optimizacion') return; e.preventDefault(); if (Math.abs(e.deltaY) > 4) select(UI.sel + Math.sign(e.deltaY)); }, { passive: false });
let _swipeY = null;
overlay.addEventListener('touchstart', e => { if (UI.menu === 'optimizacion' && e.touches.length === 1) { _swipeY = e.touches[0].clientY; UI.swiped = false; } }, { passive: true });
overlay.addEventListener('touchmove', e => {
  if (_swipeY === null || UI.menu !== 'optimizacion') return;
  const dy = e.touches[0].clientY - _swipeY, step = 36;
  if (Math.abs(dy) >= step) { select(UI.sel + (dy < 0 ? 1 : -1)); _swipeY = e.touches[0].clientY; UI.scrollAt = performance.now(); UI.swiped = true; }
}, { passive: true });
overlay.addEventListener('touchend', () => { _swipeY = null; }, { passive: true });

