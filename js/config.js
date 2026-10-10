/* =====================================================================
   Test Song · Chart Editor GCD — config.js
   Configuración, constantes del juego (FNF V-Slice) y utilidades comunes.
   Todos los js/ son scripts clásicos que comparten el ámbito global; el orden
   de carga está en index.html.
   ===================================================================== */
'use strict';

const params = new URLSearchParams(location.search);

/* ---------- Valores del juego (FunkinCrew/Funkin: Constants.hx, Scoring.hx, PlayState.hx) ---------- */
const FNF = {
  WIDTH: 1280, HEIGHT: 720,
  STRUMLINE_X_OFFSET: 48, STRUMLINE_Y_OFFSET: 24,
  STRUMLINE_SIZE: 104, NOTE_SPACING: 112, INITIAL_OFFSET: -0.275 * 104,
  NOTE_SCALE: 0.7,                // notestyle "funkin": note / noteStrumline / holdNote scale
  PIXELS_PER_MS: 0.45,
  HIT_WINDOW_MS: 160,
  HEALTH_MAX: 2, HEALTH_START: 1,
  HEALTH_SICK: 0.03, HEALTH_GOOD: 0.015, HEALTH_BAD: 0, HEALTH_SHIT: -0.02,
  HEALTH_MISS: -0.08, HEALTH_HOLD_PER_SEC: 0.12,
  COLOR_HEALTH_RED: '#ff0000', COLOR_HEALTH_GREEN: '#66ff33',
  HEALTH_BAR_W: 601, HEALTH_BAR_H: 19,     // healthBar.png
  ICON_SIZE: 150, ICON_POSITION_OFFSET: 26, ICON_BOP_SCALE: 0.2,
  ICON_WINNING: 1.6, ICON_LOSING: 0.4,     // 0.8*2 / 0.2*2
  BOP_INTENSITY: 1.015, HUD_BOP: 0.03, ZOOM_RATE: 4,   // cámara: bop cada 4 beats
  CAMERA_FOLLOW_RATE: 0.04,
  COUNTDOWN_VOLUME: 0.6,
  RATING_SCALE: 0.65, COMBO_NUM_SCALE: 0.45,
  SPLASH_ALPHA: 0.8, SPLASH_OFFSETS: [25, -5],
};

const CONFIG = {
  demoBpm: 120,
  demoSpeed: 1.7,
  // PBOT1: ventanas (ms), vida y precisión
  judgments: [
    { id: 'sick', ms: 45,  health: FNF.HEALTH_SICK, acc: 1.00, color: '#7df9ff', text: 'SICK!!' },
    { id: 'good', ms: 90,  health: FNF.HEALTH_GOOD, acc: 0.75, color: '#8dff7d', text: 'GOOD' },
    { id: 'bad',  ms: 135, health: FNF.HEALTH_BAD,  acc: 0.40, color: '#ffd27d', text: 'BAD' },
    { id: 'shit', ms: 160, health: FNF.HEALTH_SHIT, acc: 0.10, color: '#ff8a7d', text: 'SHIT' },
  ],
  demoOppDrain: 0.03,                       // solo en demo: el rival baja la vida para que la barra se mueva
  showComboSprite: params.get('combo') === '1',   // combo.png (legacy). V-Slice ya no lo muestra.
};

const LANE_COLORS = ['#c24b99', '#00ffff', '#12fa05', '#f9393f'];
const LANE_DARK   = ['#6e2457', '#007b8a', '#0a7d03', '#8c1b1f'];
const LANE_NAMES  = ['left', 'down', 'up', 'right'];
const LANE_DIRS   = ['LEFT', 'DOWN', 'UP', 'RIGHT'];
const ARROW_KEYS = { ArrowLeft: 0, ArrowDown: 1, ArrowUp: 2, ArrowRight: 3 };   // las flechas siempre funcionan (2ª asignación)
const DEFAULT_KEYS = ['a', 's', 'w', 'd'];                                        // Asignar Teclas (se guardan en localStorage)
const DEFAULT_COLORS = { opp: FNF.COLOR_HEALTH_RED, player: FNF.COLOR_HEALTH_GREEN };
const COLORS = Object.assign({}, DEFAULT_COLORS);   // se reemplazan si el JSON del personaje trae colores (estilo Psych)

/* ---------- Rutas de assets (estructura V-Slice; se prueban en orden) ----------
   {lib}:{path} como en V-Slice: "shared:characters/bf" -> shared/images/characters/bf
   "default:" (o sin prefijo) -> images/...  */
const ROOT = params.get('assets') ? params.get('assets').replace(/\/+$/, '') + '/' : '';
const ASSET_CFG = {
  chars: { bf: params.get('bf') || 'bf', dad: params.get('dad') || 'dad', gf: params.get('gf') || 'gf' },
  stage: params.get('stage') || 'mainStage',
  charDataPaths: ['data/characters/{id}.json', 'preload/data/characters/{id}.json', 'characters/{id}.json'],
  stageDataPaths: ['data/stages/{id}.json', 'preload/data/stages/{id}.json'],
  stageImagePaths: ['shared/images/{stage}/{path}.png', 'shared/images/{path}.png', '{dir}/images/{path}.png', 'images/{stage}/{path}.png', 'images/{path}.png'],
  libImagePaths: ['{lib}/images/{path}', 'shared/images/{path}', 'images/{path}'],

  // Notas sueltas (NoteAssets)
  noteDir: 'shared/images/NoteAssets/',
  noteColors: ['purple', 'blue', 'green', 'red'],                 // left, down, up, right
  noteHead: '{color}0000.png', holdPiece: '{color} hold piece0000.png', holdEnd: '{color} hold end0000.png',
  strumStatic: ['{color} static0000.png', 'arrow{DIR}0000.png'],
  strumPress: ['{color} press0000.png'],
  strumConfirm: ['{color} confirm0000.png'],
  // Hojas Sparrow (xml+png) del juego, si se suben:
  strumSheets: ['shared/images/noteStrumline'],           // staticLeft0 / pressLeft0 / confirmLeft0
  legacyNoteSheets: ['images/NOTE_assets', 'shared/images/NOTE_assets'],   // "purple instance 1" / "arrow static instance N" / "left press" / "left confirm"
  holdSheets: ['images/NOTE_hold_assets.png', 'shared/images/NOTE_hold_assets.png'],  // V-Slice: 8 columnas (pieza, final) x 4 carriles
  noteStyle: ['data/notestyle/funkin.json'],
  splashSheets: ['shared/images/noteSplashes', 'shared/images/NoteAssets/noteSplashes'],

  // Iconos: legacy icon-<id>.png (frames de 150x150) o animado icon-<id>.xml+png (idle/winning/losing/toWinning...)
  iconDirs: ['images/icons/', 'shared/images/icons/'],

  // HUD / UI
  healthBar: ['images/healthBar.png', 'shared/images/healthBar.png'],
  popupDirs: ['images/ui/popup/funkin/', 'shared/images/ui/popup/funkin/'],
  countdownDirs: ['shared/images/ui/countdown/funkin/', 'images/ui/countdown/funkin/'],
  countdownImages: [null, 'ready', 'set', 'go'],                  // three no tiene imagen en el juego
  fontDirs: ['images/fonts/', 'shared/images/fonts/'],

  // Sonidos (.ogg; si el navegador no puede, se prueba .mp3)
  countdownSoundDirs: ['shared/sounds/gameplay/countdown/funkin/', 'sounds/gameplay/countdown/funkin/'],
  countdownSounds: ['introTHREE', 'introTWO', 'introONE', 'introGO'],
  missSounds: ['shared/sounds/missnote{n}', 'sounds/missnote{n}'],
  menuSounds: { scroll: ['sounds/scrollMenu', 'shared/sounds/scrollMenu'] },
  pauseMusic: ['music/breakfast/breakfast', 'shared/music/breakfast/breakfast'],
  // Canción por defecto: "test" del juego (data/songs/test/test.json + songs/test/Inst.ogg, Voices-bf.ogg, Voices-bf-pixel.ogg).
  // ?song=<id> carga data/songs/<id>/<id>-chart.json (V-Slice) o <id>.json (legacy) + songs/<id>/...
  defaultSongId: params.get('song') || 'test',
  songChartPaths: ['data/songs/{id}/{id}-chart.json', 'data/songs/{id}/{id}.json', 'songs/{id}/{id}-chart.json', 'songs/{id}/{id}.json'],
  songMetaPaths: ['data/songs/{id}/{id}-metadata.json', 'songs/{id}/{id}-metadata.json'],
  songAudioDir: 'songs/{id}/',
  // compatibilidad: song-chart.json / song-metadata.json / Inst.ogg / Voices.ogg junto al index
  defaultSong: { chart: ['song-chart.json'], meta: ['song-metadata.json'], inst: ['Inst'], voices: ['Voices'] },
  // ids del chart sin assets -> alias (bf-pixel -> bf). Si tampoco existe, el personaje por defecto del rol.
  charAlias: { 'bf-pixel': 'bf', 'bf-car': 'bf', 'bf-christmas': 'bf', 'bf-holding-gf': 'bf', 'gf-pixel': 'gf', 'gf-car': 'gf', 'gf-christmas': 'gf' },
  stageAlias: { stage: 'mainStage', '': 'mainStage' },
};

/* ---------- utilidades ---------- */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const fillT = (t, v) => t.replace(/\{(\w+)\}/g, (m, k) => v[k] ?? m);
const assetUrl = p => ROOT + p.split('/').map(encodeURIComponent).join('/');
const uniq = a => [...new Set(a)];
const hexRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const VERSION = '3.5.0';
const cubeInOut = t => t < 0.5 ? 4 * t * t * t : 0.5 * Math.pow(2 * t - 2, 3) + 1;
const formatMoney = n => Math.round(n).toLocaleString('en-US');
const $ = id => document.getElementById(id);
const escHtml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

/* ---------- lienzo ---------- */
const cv = document.getElementById('game');
const ctx = cv.getContext('2d');
let W = 0, H = 0, DPR = 1;
