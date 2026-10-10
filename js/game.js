/* =====================================================================
   game.js — estado del juego, carga de la escena, lógica (notas, vida,
   puntuación PBOT1, cuenta regresiva, bops de cámara/iconos), render y bucle.
   API pública: window.GCDPlay (loadChart, restart, pause, resume, ...).
   ===================================================================== */
'use strict';

/* ---------- escena ---------- */
const Scene = { world: false, loading: false, stage: null, chars: { bf: null, dad: null, gf: null }, errors: {}, ids: null,
  notes: null, icons: { player: null, opponent: null }, focus: 'dad', status: [], token: 0 };

async function loadScene(ids) {
  ids = Object.assign({ bf: ASSET_CFG.chars.bf, dad: ASSET_CFG.chars.dad, gf: ASSET_CFG.chars.gf, stage: ASSET_CFG.stage }, ids || {});
  const key = JSON.stringify(ids);
  if (Scene.ids === key) return;
  Scene.ids = key; const token = ++Scene.token; Scene.loading = true;
  const isFile = location.protocol === 'file:';
  const loadRole = async role => {
    let c = await loadCharacter(role, ids[role]);
    // id del chart sin assets -> alias (bf-pixel -> bf) -> el personaje por defecto del rol
    const tries = uniq([ASSET_CFG.charAlias[ids[role]], ids[role].includes('-') ? ids[role].split('-')[0] : null, ASSET_CFG.chars[role]].filter(x => x && x !== ids[role]));
    for (const alt of tries) {
      if (!c.error) break;
      const c2 = await loadCharacter(role, alt); if (!c2.error) { c2.fallbackFrom = ids[role]; c = c2; }
    }
    return c;
  };
  // "stage" (legacy/Kade) = mainStage, halloween = spookyMansion… salvo que el mod traiga su propio escenario con ese id (Psych/Codename)
  const stageId = EngineData.hasOwnStage(ids.stage) ? ids.stage : ids.stage in ASSET_CFG.stageAlias ? ASSET_CFG.stageAlias[ids.stage] : (KADE_STAGES[ids.stage] || ids.stage);
  const [stage, bf, dad, gf, notes] = await Promise.all([
    loadStage(stageId).then(s => s || (stageId !== ASSET_CFG.stage ? loadStage(ASSET_CFG.stage) : null)),
    loadRole('bf'), loadRole('dad'), loadRole('gf'), Scene.notes ? Scene.notes : loadNoteSkin()]);
  if (token !== Scene.token) return;
  Scene.stage = stage; Scene.notes = notes;
  const st = [];
  for (const [role, c] of [['bf', bf], ['dad', dad], ['gf', gf]]) {
    if (c instanceof RealChar) {
      Scene.chars[role] = c; Scene.errors[role] = null;
      placeChar(c, role, stage);
      st.push(`✔ ${role}: ${c.id} — ${c.kind === 'atlas' ? 'Animate Atlas' : 'Sparrow'} (${c.where}) · ${c.anims.size} anims · ${c.flipX ? 'volteado' : 'sin voltear'}${role === 'bf' ? ' (jugador: !flipX del JSON)' : ''}${c.missing.length ? ' · faltan: ' + c.missing.join(', ') : ''}${c.fallbackFrom ? ` · (el chart pedía "${c.fallbackFrom}")` : ''}`);
    } else { Scene.chars[role] = null; Scene.errors[role] = c.error; st.push(`✘ ${role}: ${ids[role]} — ${c.error} → no se dibuja (falta el asset real)`); }
  }
  Scene.baseChars = Object.assign({}, Scene.chars);
  // parlantes de GF (parlantes.js): del escenario, del sprite de GF, asignados o por defecto (sin asset: ninguno)
  await Speaker.setup(stage, Scene.chars.gf, ids.gf).catch(e => { console.warn('[parlante]', e); Speaker.cur = null; Speaker.info = 'error: ' + e.message; });
  if (token !== Scene.token) return;
  // iconos de vida (healthIcon del JSON o id del personaje; sin icono → icon-face)
  const iconData = role => {
    const c = Scene.chars[role]; const d = c ? c.data : DEFAULT_DATA.characters[ids[role]];
    const user = UserAssets.iconIds[role];     // "Asignar icono"
    return user ? [user, Object.assign({}, d && d.healthIcon || {}, { id: user })] : [c ? c.id : ids[role], d && d.healthIcon];
  };
  const [iP1, iP2] = await Promise.all([new HealthIcon(0).load(...iconData('bf')), new HealthIcon(1).load(...iconData('dad'))]);
  if (token !== Scene.token) return;
  Scene.icons = { player: iP1, opponent: iP2 }; Scene.baseIcons = { player: iP1, opponent: iP2 };
  VS.play.stageZoom = stage ? (+(stage?.data?.cameraZoom) || 1) : 1.05; VS.play.resetCameraZoom();   // PlayState: stageZoom (sin escenario 1.05)
  applyBarColors();
  const loadedProps = stage ? stage.props.filter(p => p.img || p.color || p.frames) : [];
  if (stage) st.push(`${loadedProps.length ? '✔' : '✘'} escenario: ${stage.data.name || stage.id} (${stage.from}) · props ${loadedProps.length}/${stage.props.length} · zoom ${stage.data.cameraZoom ?? 1}` +
    (stage.props.filter(p => !p.img && !p.color && !p.frames).length ? ' · faltan: ' + stage.props.filter(p => !p.img && !p.color && !p.frames).map(p => p.tried).join(', ') + ' → fondo improvisado' : ''));
  else st.push(`✘ escenario: ${ids.stage} — sin JSON → fondo negro`);
  if (stage && ids.stage !== stage.id) st.push(`✔ escenario del chart "${ids.stage}" → ${stage.id}`);
  st.push(`${notes.ok ? '✔' : '✘'} notas: ${notes.head.filter(Boolean).length}/4 cabezas (${notes.src.headFrom || '—'}), colas: ${notes.src.holdFrom || (notes.piece.filter(Boolean).length + '/4')}`);
  st.push(notes.placeholder.some(Boolean) ? '✘ receptores (strums): no hay noteStrumline.xml / NOTE_assets.xml / "<color> static0000.png" → sin receptores (no se generan)'
    : `✔ receptores: ${notes.src.strumSheet || notes.src.legacySheet || 'NoteAssets/*static*'}`);
  st.push(notes.hasSplash ? `✔ splashes: ${notes.src.splashSheet}.xml` : '✘ splashes: falta shared/images/noteSplashes.xml/.png → sin splashes');
  for (const [k, ic] of [['jugador', iP1], ['rival', iP2]]) st.push(ic.ok ? `✔ icono ${k}: ${ic.where} — ${ic.kind}${ic.fallbackFace ? ` (no hay icon-${ic.wanted}: se usa icon-face)` : ''}` : `✘ icono ${k}: falta images/icons/icon-${ic.id}.png (y icon-face.png) → sin icono`);
  st.push(`${Speaker.cur ? '✔' : Speaker.need ? '✘' : '·'} parlantes GF: ${Speaker.info}`);   // v3.7.0: sin asset real no se dibuja ningún parlante
  Scene.status = st;
  Scene.world = !!(stage && (loadedProps.length || bf instanceof RealChar || dad instanceof RealChar));
  // v3.3.0: se liberan las hojas enormes ya recortadas y se suben/calientan todas las texturas
  // mientras se ve "Cargando…" (antes la primera vez que aparecía cada imagen había un tirón)
  TexLoad.endScene();
  try { Render.forgetTextures(); const n = Render.prewarm(worldTextures()); st.push(`✔ render: ${Render.name()} · ${n} texturas precargadas · calidad ${Optim.s.preset} (texturas ${Optim.s.tex}%, mundo ${Optim.s.res}%)`); }
  catch (e) { console.warn('[TestSong] precarga', e); }
  st.push(...TexLoad.statusLines());
  G.vsChart = null; Scene.loading = false;   // personajes nuevos → PlayState.create otra vez
  const any = Scene.world || notes.ok || iP1.ok || iP2.ok;
  if (isFile && !(bf instanceof RealChar && dad instanceof RealChar)) toast('Abierto como archivo (file://): el navegador bloquea los assets. Usa GitHub Pages o un servidor local (python -m http.server).', 7000);
  else if (!any) toast('No encontré assets reales (data/, shared/images/…): la pantalla queda en negro (mira Asignar assets o la consola)', 5000);
  console.info('[TestSong] assets\n' + statusLines().join('\n'));
  // v3.7.0: lo que falta (ya no hay dibujos improvisados) también va a la consola de scripts
  if (typeof ScriptLog !== 'undefined') for (const l of statusLines()) if (l.startsWith('✘')) ScriptLog.info('asset', l.slice(2));
}

/* coloca un personaje en su sitio del escenario (Stage.addCharacter) */
function placeChar(c, role, stage) {
  stage = stage || Scene.stage;
  const sc = stage?.data?.characters?.[role] || { position: role === 'bf' ? [989.5, 885] : role === 'dad' ? [335, 885] : [751.5, 787], zIndex: role === 'bf' ? 300 : role === 'dad' ? 200 : 100 };
  c.place(sc);
  if (role === 'gf' && stage?.data?.hideGf) c.visible = false;   // Psych: hide_girlfriend
}
/* colores de la barra: rojo/verde del juego; si el JSON trae colores (estilo Psych) se usan */
function applyBarColors() {
  for (const [role, k] of [['dad', 'opp'], ['bf', 'player']]) {
    const d = Scene.chars[role]?.data, col = d && (d.healthbar_colors || d.healthBarColor || d.healthbarColor || d.healthIcon?.color);
    let rgb = null;
    if (Array.isArray(col) && col.length >= 3) rgb = col.slice(0, 3).map(Number);
    else if (typeof col === 'string' && /^#?[0-9a-f]{6}/i.test(col)) rgb = hexRgb('#' + col.replace(/^#/, '').slice(0, 6));
    COLORS[k] = rgb ? `rgb(${rgb.join(',')})` : DEFAULT_COLORS[k];
  }
}

function statusLines() {
  const out = Scene.status.slice();
  for (const v of AssetLog.extra.values()) out.push((v.ok ? '✔ ' : '✘ ') + v.text);
  const cd = [0, 1, 2, 3].filter(i => Sfx.found['count' + i]);
  out.push(cd.length ? `✔ sonidos cuenta regresiva: ${cd.length}/4 (${Sfx.found.count0 || Sfx.found['count' + cd[0]]}…)` : '✘ sonidos cuenta regresiva: faltan shared/sounds/gameplay/countdown/funkin/introTHREE.ogg…');
  const ms = [1, 2, 3].filter(n => Sfx.found['miss' + n]);
  out.push(ms.length ? `✔ sonidos de fallo: ${ms.length}/3` : '✘ sonidos de fallo: faltan shared/sounds/missnote1.ogg, missnote2.ogg, missnote3.ogg');
  out.push(Sfx.found.pauseMusic ? `✔ música de pausa: ${Sfx.found.pauseMusic}` : '✘ música de pausa: falta music/breakfast/breakfast.ogg');
  out.push(Sfx.found.scrollMenu ? `✔ sonido de menú: ${Sfx.found.scrollMenu}` : '✘ sonido de menú: falta sounds/scrollMenu.ogg');
  out.push(Music.has ? `✔ música de la canción: ${Music.tracks.map(t => (t.name || t.role) + ' [' + t.role + ']').join(', ')} · ${Music.mode === 'webaudio' ? 'Web Audio (reloj del AudioContext)' : '<audio> + resincronización'}` : '✘ música de la canción: no hay Inst/Voices (demo sin audio)');
  if (G.chart) out.push(`✔ chart: ${G.chart.title} · formato ${G.chart.format || '?'} · ${G.chart.notes.length} notas · dificultad ${G.chart.difficulty || '—'} · eventos: ${Events.summary()}`);
  if (G.pack) out.push(`✔ variación: ${G.variation} · disponibles: ${G.pack.vars.map(v => v.id).join(', ')} · ${G.pack.entries.length} dificultades`);
  out.push(...StageRT.status());
  for (const rec of Mods.scripts.values()) out.push(`✔ script ${rec.name}: ${[...rec.events, ...rec.kinds, ...rec.modules].join(', ') || 'sin registros'} (imitación)`);
  if (G.chart) { const u = ModUI.unknown(G.chart); if (u.ev.size || u.nk.size) out.push(`✘ sin .hxc: ${[...u.ev.keys(), ...u.nk.keys()].join(', ')} (Assets cargados → Eventos / note kinds)`); }
  out.push(...Events.statusLines());
  out.push(...Shaders.statusLines());
  out.push(...UserAssets.statusLines());
  if (typeof EngineFX !== 'undefined') out.push(...EngineFX.status());
  if (SongImport.mod) out.push(`✔ mod: ${SongImport.mod.name} (${ENGINE_LAYOUT[SongImport.mod.engine].name}) · ${SongImport.mod.files} archivos · ${SongImport.counts().txt}`);
  for (const m of SongLoad.missing) out.push('✘ ' + m);
  if (!Sfx.unlocked) out.push('… el sonido se activa al primer toque/tecla (regla del navegador)');
  return out;
}

/* ---------- estado ---------- */
const G = {
  chart: null, raw: null, meta: null,
  mode: params.get('modo') || 'demo',
  songPos: 0, gameTime: 0, paused: false, overlayKind: null,
  healthLerp: FNF.HEALTH_START,   // health, score, combo… → VS.play (más abajo)
  strums: { opponent: { confirmAt: [-1e9, -1e9, -1e9, -1e9], hold: [0, 0, 0, 0] },
            player:   { confirmAt: [-1e9, -1e9, -1e9, -1e9], hold: [0, 0, 0, 0], pressed: [false, false, false, false], pressAt: [0, 0, 0, 0], confirmHeld: [false, false, false, false] } },
  autoFocus: false, demoHold: [null, null, null, null], drawIdx: { player: 0, opponent: 0 },
};
const isBot = () => G.mode === 'demo' || G.mode === 'botplay';

/* Carga un chart: pantalla negra "Cargando…" hasta tener escenario, personajes, iconos, audio y
   eventos listos; después se dibuja todo de una vez (sin pasos intermedios). */
let loadToken = 0;
async function loadChart(chart, audio = [], opts = {}) {
  const tok = ++loadToken;
  if (!opts.keepLoader) Loader.reset(opts.label);
  Loader.active = true; G.paused = true; Music.pause(); hideOverlay();
  G.chart = chart; G.vsChart = null;
  // personajes / escenario elegidos en "Assets cargados" mandan sobre los del chart
  const ids = Object.assign({}, chart.scene || {}, UserAssets.overrides());
  await Promise.all([loadScene(ids), opts.keepAudio ? null : Music.set(audio), Events.preload(chart), Mods.ready, opts.minMs ? new Promise(ok => setTimeout(ok, opts.minMs)) : null]);
  if (tok !== loadToken) return;
  Loader.finish();
  restart(true);
  if (!params.has('t') || opts.ready) openOverlay('ready');
  else closeOverlay();
  ModUI.check(chart);    // eventos / note kinds desconocidos → ventana para cargar sus .hxc
}

/* =====================================================================
   v3.8.0 — PlayState de V-Slice (vslice.js → VS.PlayCore): eventos, note kinds,
   vida/puntuación PBOT1, combo, voces, cámara, scroll speed, Conductor y
   personajes salen del port. Aquí solo queda lo que es de este motor
   (audio, dibujo, scripts .lua/.hx, modo demo).
   ===================================================================== */
/* VoicesGroup: voz del jugador / del rival (una sola pista "Voices" = sistema antiguo, la usa el jugador) */
const VOCALS = {
  get legacyVoiceSystem() { if (this._tr !== Music.tracks) { this._tr = Music.tracks; this._legacy = !Music.tracks.some(t => t.role === 'player' || t.role === 'opponent'); } return this._legacy; },
  legacyVoiceUsesPlayer: true,
  get playerVolume() { return Music.getVolume(this.legacyVoiceSystem ? 'voices' : 'player'); },
  set playerVolume(v) { v = +v; if (Music.getVolume('player') !== v) Music.setVolume('player', v); if (this.legacyVoiceSystem && Music.getVolume('voices') !== v) Music.setVolume('voices', v); },
  get opponentVolume() { return Music.getVolume('opponent'); },
  set opponentVolume(v) { v = +v; if (Music.getVolume('opponent') !== v) Music.setVolume('opponent', v); },
};
/* PlayState.currentStage: personajes (Stage.getBoyfriend…), props con nombre y la lista para dispatchToCharacters */
const STAGE_HOST = {
  getBoyfriend: () => Scene.chars.bf, getDad: () => Scene.chars.dad, getGirlfriend: () => Scene.chars.gf,
  getNamedProp: name => propTarget(name),
  _list: [],
  characters() {   // dad, bf, gf (orden de Stage.dispatchToCharacters); se rehace solo si cambian
    const c = Scene.chars;
    if (this._d !== c.dad || this._b !== c.bf || this._g !== c.gf) { this._d = c.dad; this._b = c.bf; this._g = c.gf; this._list = [c.dad, c.bf, c.gf].filter(Boolean); }
    return this._list;
  },
};
/* el escenario como destino de dispatchEvent: Stage.onScriptEvent pasa el evento a los boppers (props) y luego el script */
const STAGE_TARGET = { __host: 'Stage', __callEvent(e) { if (e.type === 'SONG_STEP_HIT') propsStep(e.step); StageRT.adapter.__callEvent(e); } };
const PLAY_HOST = {
  modules: () => Mods.moduleTargets(),
  song: null,
  stageScript: () => STAGE_TARGET,
  vocals: VOCALS,
  _warned: new Set(),
  warn(m) { if (this._warned.has(m)) return; this._warned.add(m); console.warn('[V-Slice]', m); },
  setHealthIcon: (which, data, shouldBop) => Events.setIcon(which, data, shouldBop),
  playMissSound: (lo, hi) => playMissSound(lo, hi),
  displayRating: id => displayRating(id),
  displayCombo: c => displayCombo(c),
  playNoteSplash: n => { if (Optim.s.splash !== false) spawnSplash(n.side, n.lane); },
  onStrumHit(n) { const s = G.strums[n.side]; s.confirmAt[n.lane] = G.gameTime; if (n.side === 'player') s.confirmHeld[n.lane] = true; },
  afterHit(n) {
    n.judged = n.hit = true;
    if (ScriptHub.on) ScriptHub.noteHit(n, n.side === 'player');    // goodNoteHit / opponentNoteHit (.lua) · onPlayerHit / onDadHit (.hx)
    if (n.side === 'opponent' && G.mode === 'demo' && VS.play.health > 0.35) VS.play.health -= CONFIG.demoOppDrain;   // demo: la barra se mueve
  },
  afterMiss(n) { n.judged = n.missed = true; if (ScriptHub.on) ScriptHub.noteMiss(n); },
  afterHoldDrop(hn) { if (hn.parent) hn.parent.dropped = true; },
  /* HealthIcon.onStepHit: bop cada 4 steps */
  onStepHit(step) {
    if (step % 4 === 0) for (const k in Scene.icons) { const ic = Scene.icons[k]; if (ic && ic.shouldBop !== false) ic.bop(); }
    if (step >= 0 && ScriptHub.on) ScriptHub.step(step);
  },
  onBeatHit(beat) {
    Speaker.beat(beat);
    if (beat >= -4 && beat <= -1) { Sfx.play('count' + (beat + 4), FNF.COUNTDOWN_VOLUME); ScriptHub.countdown(beat + 4); }   // introTHREE/TWO/ONE/GO
    if (beat >= 0 && ScriptHub.on) ScriptHub.beat(beat);
  },
  onHealthZero() { if (!isBot() && !G.paused) openOverlay('over'); },
  onEventFired: (ev, canceled) => Events.onFired(ev, canceled),
  /* FlxState.update de los miembros: animaciones de los personajes */
  updateMembers(elapsed) { const l = STAGE_HOST.characters(); for (let i = 0; i < l.length; i++) l[i].animation.update(elapsed); },
};
VS.play = new VS.PlayCore(PLAY_HOST);
VS.play.currentStage = STAGE_HOST;
/* G.health, G.score… = los de PlayState (las demás partes del motor y los scripts .lua/.hx los siguen usando) */
Object.defineProperties(G, {
  health: { get: () => VS.play.health, set: v => { VS.play.health = +v; }, configurable: true },
  score: { get: () => VS.play.songScore, set: v => { VS.play.songScore = +v || 0; }, configurable: true },
  combo: { get: () => VS.play.tallies.combo, set: v => { VS.play.tallies.combo = +v || 0; }, configurable: true },
  misses: { get: () => VS.play.tallies.missed, set: v => { VS.play.tallies.missed = +v || 0; }, configurable: true },
  judged: { get: () => { const t = VS.play.tallies; return t.sick + t.good + t.bad + t.shit + t.missed; }, set() {}, configurable: true },
  accSum: { get: () => { const t = VS.play.tallies; let s = 0; for (const j of CONFIG.judgments) s += (t[j.id] || 0) * j.acc; return s; }, set() {}, configurable: true },
  speed: { get: () => VS.play.playerStrumline.scrollSpeed, set: v => { if (+v > 0) VS.play.playerStrumline.scrollSpeed = VS.play.opponentStrumline.scrollSpeed = +v; }, configurable: true },
  hudZoom: { get: () => VS.play.camHUD.zoom, set: v => { VS.play.camHUD.zoom = +v; }, configurable: true },
});

/* Conductor de V-Slice con los timeChanges del chart (incluye compases de V-Slice: n/d) */
function conductorFor(c) {
  const raw = Array.isArray(c.timeChanges) ? c.timeChanges : [];
  const list = (c.tc || [{ t: 0, bpm: c.bpm || 100 }]).map(p => { const r = raw.find(x => Math.abs((+x.t || 0) - p.t) < 1e-6); return { t: p.t, bpm: p.bpm, n: r && r.n || 4, d: r && r.d || 4 }; });
  VS.play.conductor.mapTimeChanges(list);
}
function syncPlayMode() {
  const P = VS.play;
  P.isBotPlayMode = G.mode === 'botplay';
  P.demoAutoplay = G.mode === 'demo';
  P.zoomCameraPref = !!Optim.s.bop;
  P.ghostTappingFeature = G.mode === 'mobile';   // FEATURE_GHOST_TAPPING solo en móvil (como el juego)
}
function stageZoomOf() { const st = Scene.stage; return st ? (+(st.data && st.data.cameraZoom) || 1) : 1.05; }

/* Reinicia la canción (paused = queda detenida esperando "Jugar").
   Primera vez con este chart = PlayState.create (cámara en el rival, Conductor 5 beats antes);
   después = reintentar (needsReset: SongRetryEvent, resetStage, resetCamera, regenNoteData…) */
function restart(paused) {
  const c = G.chart, P = VS.play;
  const start = params.has('t') && !G.startedOnce ? Math.max(0, +params.get('t') || 0) : 0;   // startTimestamp
  G.startedOnce = true;
  Music.pause();
  Popups.length = 0; Splashes.length = 0;
  Mods.resetRuntime(true);
  Events.reset();
  syncPlayMode();
  P.stageZoom = stageZoomOf();
  resetActors();
  G.drawIdx = { player: 0, opponent: 0 };
  if (G.vsChart !== c) {
    G.vsChart = c;
    conductorFor(c);
    P.startTimestamp = start;
    P.health = VS.C.HEALTH_STARTING; P.songScore = 0; for (const k in P.tallies) P.tallies[k] = 0;
    P.songEvents = c.events.map(e => { const d = new VS.SongEventData(e.t, e.e, e.v); if (e.pe) d.pe = e.pe; if (e.ce) d.ce = e.ce; if (e.psych) d.psych = e.psych; return d; });   // pe/ce: onEvent de .lua / Codename
    P.setNotes(c.notes, c.speed);
    // PlayState.initCharacters: "Camera starts at dad"
    const dad = Scene.chars.dad, fp = dad ? dad.cameraFocusPoint : { x: (focusPoint('dad') || [640, 360])[0], y: (focusPoint('dad') || [640, 360])[1] };
    P.cameraFollowPoint.setPosition(fp.x, fp.y);
    P.cancelScrollSpeedTweens(); P.playerStrumline.keysHeld.fill(false);
    P.begin(start);
  } else P.retry(start, 0);
  G.demoHold = [null, null, null, null];
  G.songPos = P.conductor.songPosition;
  Music.seek(G.songPos);
  VOCALS.playerVolume = 1; VOCALS.opponentVolume = 1; Music.setVolume('voices', 1);
  G.healthLerp = P.health;
  if (paused === true) return;
  closeOverlay();
}
/* BaseCharacter.resetCharacter + props + iconos + receptores */
function resetActors() {
  for (const ch of Object.values(Scene.chars)) if (ch) ch.reset();
  propsReset();
  for (const ic of Object.values(Scene.icons)) if (ic) ic.reset();
  for (const s of Object.values(G.strums)) { s.confirmAt.fill(-1e9); s.hold.fill(0); }
  G.strums.player.pressed.fill(false); G.strums.player.confirmHeld.fill(false);
}
/* Buscar (barra de tiempo de la pausa) = probar desde esa posición (startTimestamp del editor de charts de V-Slice):
   las notas anteriores se saltan, los eventos se reinician y los viejos con processOldEvents (FocusCamera, ZoomCamera,
   SetCameraBop, ScrollSpeed, SetHealthIcon) se aplican ya; la cámara salta a su sitio */
function seekTo(pos) {
  const P = VS.play, total = songLength();
  pos = clamp(pos, 0, Math.max(0, total - 50));
  Popups.length = 0; Splashes.length = 0;
  Mods.resetRuntime(false);
  Events.reset();
  syncPlayMode();
  resetActors();
  G.drawIdx = { player: 0, opponent: 0 };
  P.startTimestamp = pos;
  P.cancelAllCameraTweens(); P.cancelScrollSpeedTweens();
  for (const s of [P.playerStrumline, P.opponentStrumline]) { s.scrollSpeed = P.chartScrollSpeed; s.keysHeld.fill(false); }
  P.prevScrollTargets = [];
  P.regenNoteData(pos);
  P.startingSong = false; P.isInCountdown = false;
  P.conductor.update(pos, false, true);
  P.processSongEvents();
  P.resetCamera(false, true, true);
  if (P.cameraZoomTween) P.cameraZoomTween.cancel();
  P.camera.zoom = P.currentCameraZoom * P.cameraBopMultiplier;
  G.songPos = pos; Music.seek(pos);
  G.demoHold = [null, null, null, null];
}
function songLength() { return Math.max(G.chart.endTime - 1800, Music.duration || 0) || G.chart.endTime; }

/* compatibilidad: scripts .lua/.hx que suman vida (el límite lo pone PlayState.update) */
function changeHealth(delta) { if (Number.isFinite(delta)) VS.play.health += delta; }

/* En demo el bot falla a propósito en "olas" para que la barra de vida se mueva */
function demoShouldMiss(n) {
  if (G.health < 0.55) return false;
  const wave = 0.5 + 0.5 * Math.sin(n.time / 5200);
  return n.seed < 0.06 + 0.5 * wave * wave;
}
/* demo: teclas sintéticas (como un jugador perfecto que a veces falla), así la lógica es la del jugador */
function demoInput(pos) {
  const P = VS.play, pl = P.playerStrumline, hold = G.demoHold;
  for (let l = 0; l < 4; l++) if (hold[l] != null && pos >= hold[l]) { hold[l] = null; P.inputReleaseQueue.push({ noteDirection: l, songPos: pos }); G.strums.player.pressed[l] = false; }
  for (let i = 0, a = pl.notes; i < a.length; i++) {
    const n = a[i];
    if (!n.alive || n.hasBeenHit || !n.mayHit || pos < n.time || n.demoSkip) continue;
    if (demoShouldMiss(n) || (n.kind && NoteKinds.isHurt(n.kind))) { n.demoSkip = true; continue; }   // deja pasar la nota (o esquiva la que hace daño)
    if (hold[n.lane] != null) { P.inputReleaseQueue.push({ noteDirection: n.lane, songPos: pos }); }
    P.inputPressQueue.push({ noteDirection: n.lane, songPos: n.time });
    hold[n.lane] = n.time + Math.max(80, n.sustain);
    G.strums.player.pressed[n.lane] = true;
  }
}

/* ---------- update ---------- */
function update(dt) {
  const c = G.chart, P = VS.play;
  G.gameTime += dt;
  // reloj maestro: la posición de la canción sale siempre del reloj del audio (nunca se acumula dt)
  Music.tick();
  G.songPos = Music.position();
  syncPlayMode();
  // FlxG.plugins (tweens/timers de los scripts) → estado (PlayCore.update en el orden de PlayState)
  Mods.updatePlugins(dt);
  if (P.demoAutoplay) demoInput(G.songPos);
  P.update(dt / 1000, { songPos: G.songPos });
  P.justPressedAny = false;
  G.songPos = P.conductor.songPosition;
  Mods.update(dt); CamFX.tick();
  // convertidos sin FocusCamera: la cámara sigue a quien canta (como el modo automático de Psych)
  if (G.autoFocus && G.songPos >= 0) autoFocusStep();
  G.healthLerp = lerp(G.health, G.healthLerp, Math.pow(0.85, dt / (1000 / 60)));
  // receptores: brillo mientras se sostiene una nota larga (Strumline.playConfirmHold)
  const so = G.strums.opponent; so.hold[0] = so.hold[1] = so.hold[2] = so.hold[3] = 0;
  for (const side of ['opponent', 'player']) {
    const hs = P[side + 'Strumline'].holdNotes, st = G.strums[side];
    for (let i = 0; i < hs.length; i++) { const hn = hs[i]; if (hn.alive && hn.hitNote && !hn.missedNote && hn.sustainLength > 0 && G.songPos >= hn.strumTime) { st.confirmAt[hn.noteDirection] = G.gameTime; if (side === 'opponent') st.hold[hn.noteDirection] = 1; } }
  }
  const ip = Scene.icons.player, io = Scene.icons.opponent;
  if (ip) ip.updateAnim(G.health); if (io) io.updateAnim(FNF.HEALTH_MAX - G.health);
  updatePopups(dt);
  const end = Math.max(c.endTime, Music.duration + 300);
  if (G.songPos > end) { if (G.mode === 'demo') restart(); else openOverlay('end'); }
}
function autoFocusStep() {
  const P = VS.play, pos = G.songPos, cr = P.conductor.beatLengthMs * 2;
  let best = null;
  for (let k = 0; k < 2; k++) {   // v3.8.0: sin array por frame
    const s = k ? P.playerStrumline : P.opponentStrumline, a = s.noteData; for (let i = s.nextNoteIndex > 8 ? s.nextNoteIndex - 8 : 0; i < a.length; i++) { const n = a[i]; if (n.time < pos - 50) continue; if (!best || n.time < best.time) best = n; break; }
  }
  if (!best || best.time - pos > cr) return;
  const role = best.side === 'player' ? 'bf' : 'dad';
  if (Scene.focus === role && G.autoFocusSet) return;
  Scene.focus = role; G.autoFocusSet = true;
  const ch = Scene.chars[role], p = ch ? ch.cameraFocusPoint : null, f = p ? null : focusPoint(role);
  if (p || f) P.cameraFollowPoint.setPosition(p ? p.x : f[0], p ? p.y : f[1]);
}

/* ---------- input (PlayState.onKeyPress / onKeyRelease → cola, se procesa en el update) ---------- */
function press(lane) {
  if (G.paused) return;
  if (G.mode === 'demo') { setMode('keyboard'); toast('Modo Teclado activado ⌨'); }
  const st = G.strums.player; st.pressed[lane] = true; st.pressAt[lane] = G.gameTime; st.confirmHeld[lane] = false;
  // posición exacta del audio en el momento de la tecla (no la del último frame: con pocos FPS eso desfasaba el juicio)
  const pos = Music.playing ? Music.position() : G.songPos;
  VS.play.inputPressQueue.push({ noteDirection: lane, songPos: pos });
  VS.play.justPressedAny = true;
}
function release(lane) {
  const st = G.strums.player; st.pressed[lane] = false; st.confirmHeld[lane] = false;
  VS.play.inputReleaseQueue.push({ noteDirection: lane, songPos: Music.playing ? Music.position() : G.songPos });
}

/* ---------- layout (pantalla del juego 1280x720 escalada para caber) ---------- */
const V = { w: 1280, h: 720, s: 1, ox: 0, oy: 0, portrait: false };
const LAYOUT = { opponent: {}, player: {}, bar: {}, popup: {}, clip: {}, portrait: false };
/* Solo horizontal (en celular vertical se muestra "Gira tu dispositivo"). En celular la pantalla del juego
   se ensancha al aspecto del teléfono (como V-Slice móvil: FlxG.width crece) para llenarla sin barras. */
function resize() {
  DPR = Math.min(2, window.devicePixelRatio || 1); W = innerWidth; H = innerHeight;
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  V.portrait = LAYOUT.portrait = false;
  const wide = Movil.isTouch() && W > H;
  V.h = FNF.HEIGHT; V.w = wide ? Math.max(FNF.WIDTH, Math.round(FNF.HEIGHT * W / H)) : FNF.WIDTH;
  V.s = Math.min(W / V.w, H / V.h); V.ox = (W - V.w * V.s) / 2; V.oy = (H - V.h * V.s) / 2;
  const vsArrows = G.mode === 'mobile' && Opts.vslice === 'arrows', vsToque = G.mode === 'mobile' && Opts.vslice === 'toque';
  for (const s of ['player', 'opponent']) { LAYOUT[s].lanes = null; LAYOUT[s].tintIdle = null; LAYOUT[s].strumAlpha = null; }
  if (vsToque) {
    // v3.5.0 "Toque" = disposición de V-Slice móvil: 4 receptores GRANDES del jugador repartidos abajo
    // (← abajo-izquierda, ↓ a su derecha, ↑ y → en la mitad derecha), morados/grises semitransparentes;
    // se tocan directamente (cada uno con ~¼ del ancho a su alrededor). El centro queda libre para los
    // personajes. Rival pequeño arriba a la izquierda, con sus flechas que brillan. Ajustes: TOQUE_CFG.
    const T = TOQUE_CFG, kp = T.escala, ko = T.escalaRival;
    LAYOUT.player.lanes = T.lanes.map(f => f * V.w);
    Object.assign(LAYOUT.player, { x: 0, y: V.h - NOTE_W * kp - T.margenAbajo, k: kp, spacing: 1, down: true, alpha: 1, strumAlpha: T.alphaReceptor, tintIdle: T.tinte, splitX: null, hideNotes: false });
    Object.assign(LAYOUT.opponent, { x: FNF.STRUMLINE_X_OFFSET - 30, y: FNF.STRUMLINE_Y_OFFSET * 0.4, k: ko, spacing: 1, down: false, alpha: 1, splitX: null, hideNotes: false });
    Object.assign(LAYOUT.bar, { x: (V.w - FNF.HEALTH_BAR_W) / 2, y: V.h * 0.1 });
  } else if (vsArrows) {
    // FunkinHitbox "Arrows" (PlayState.initNoteHitbox): strumline del jugador grande abajo al centro, downscroll forzado,
    // rival en mini modo (0.4, solo receptores) arriba a la izquierda, barra de vida arriba
    const amp = (V.w / V.h) / (FNF.WIDTH / FNF.HEIGHT);
    const kp = (V.h / V.w) * 1.95 * amp, pitch = (V.h / V.w) * 2.8 * amp * FNF.NOTE_SPACING, ko = 0.4 * amp;
    const px = V.w / 2 - (FNF.INITIAL_OFFSET * kp + 1.5 * pitch) - NOTE_W * kp / 2;
    Object.assign(LAYOUT.player, { x: px, y: (V.h - NOTE_W * kp) * 0.95 - 24, k: kp, spacing: pitch / (FNF.NOTE_SPACING * kp), down: true, alpha: 1, splitX: null, hideNotes: false });
    Object.assign(LAYOUT.opponent, { x: FNF.STRUMLINE_X_OFFSET - 30, y: FNF.STRUMLINE_Y_OFFSET * 0.3, k: ko, spacing: 1, down: false, alpha: 1, splitX: null, hideNotes: true });
    Object.assign(LAYOUT.bar, { x: (V.w - FNF.HEALTH_BAR_W) / 2, y: V.h * 0.1 });
  } else {
    const down = Opts.isDown(), sy = down ? V.h - NOTE_W - FNF.STRUMLINE_Y_OFFSET : FNF.STRUMLINE_Y_OFFSET;
    const mid = Opts.middlescroll, centerX = V.w / 2 - (FNF.INITIAL_OFFSET + 1.5 * FNF.NOTE_SPACING) - NOTE_W / 2;
    // middlescroll (como Psych/V-Slice): jugador al centro; rival a los lados (2 y 2) y transparente
    Object.assign(LAYOUT.opponent, { x: FNF.STRUMLINE_X_OFFSET, y: sy, k: 1, spacing: 1, down, alpha: mid ? 0.35 : 1, splitX: mid ? V.w / 2 + FNF.STRUMLINE_X_OFFSET : null, hideNotes: false });
    Object.assign(LAYOUT.player, { x: mid ? centerX : V.w / 2 + FNF.STRUMLINE_X_OFFSET, y: sy, k: 1, spacing: 1, down, alpha: 1, splitX: null, hideNotes: false });
    Object.assign(LAYOUT.bar, { x: (V.w - FNF.HEALTH_BAR_W) / 2, y: down ? V.h * 0.1 : V.h * 0.9 });
  }
  Object.assign(LAYOUT.popup, { rx: V.w * 0.474, ry: V.h * 0.45 - 60, nx: V.w * 0.507, ny: V.h * 0.44 });
  improvLayout();
  if (typeof Movil !== 'undefined') Movil.check();
}
window.addEventListener('resize', resize);

/* ---------- render ---------- */
const beatPos = () => Cond.beat(G.songPos);
const beatFrac = () => { const b = beatPos(); return b - Math.floor(b); };
const bob = () => Math.pow(1 - beatFrac(), 3);        // 1 justo en el beat → 0

/* pantalla de carga: negro + "Cargando…" + progreso (nada del juego se dibuja hasta terminar) */
function drawLoading() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  const r = Loader.ratio(), bw = Math.min(260, W * 0.5), x = W - bw - 24, y = H - 28;
  ctx.font = `16px ${VCR_FONT}`; ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = '#fff';
  ctx.globalAlpha = 0.75 + 0.25 * Math.sin(performance.now() / 250);
  ctx.fillText(`${Loader.label} ${Math.floor(r * 100)}%`, W - 24, y - 10);
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#333'; ctx.fillRect(x, y, bw, 4);
  ctx.fillStyle = '#fff'; ctx.fillRect(x, y, bw * r, 4);
}

/* HUD (camHUD): pantalla del juego escalada, con su propio zoom desde el centro */
function drawHudLayer() {
  const hz = G.hudZoom, k = DPR * V.s * hz;
  ctx.setTransform(k, 0, 0, k, DPR * (V.ox + V.s * V.w / 2 * (1 - hz)), DPR * (V.oy + V.s * V.h / 2 * (1 - hz)));
  const ms = ModRT.sprites;   // (sin crear arrays por frame)
  for (let i = 0; i < ms.length; i++) { const sp = ms[i]; if (sp.onHud && sp.behind) { ctx.save(); sp.render(null); ctx.restore(); } }   // insert(indexOf(strumLine) - 1)
  drawStrumsAndNotes();
  for (let i = 0; i < ms.length; i++) { const sp = ms[i]; if (sp.onHud && !sp.behind) { ctx.save(); sp.render(null); ctx.restore(); } }
  drawHUD();
}
function render(dt = 16) {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  if (Loader.active || !G.chart) { Render.showGL(false); drawLoading(); return; }
  // efectos de cámara de los scripts (rotar/mover/alpha/shake de camHUD): el HUD se dibuja aparte y se pega transformado
  let hudLayer = null;
  if (CamFX.active('hud')) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height); drawHudLayer(); hudLayer = CamFX.snapshot('hud'); }
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0, 0, W, H);
  if (Scene.world) {
    // v3.3.0: el mundo se dibuja con WebGL (lotes) o con el lienzo 2D (directo o a menor resolución)
    let R = null;
    try { R = Render.beginWorld(worldNeedsDirect()); renderWorld(G.paused ? 0 : dt, 1, R); }
    catch (e) { reportOnce('mundo', e); }
    try { if (R) Render.endWorld(R); } catch (e) { reportOnce('fin del mundo', e); }
    // v3.4.0: shaders cargados (post-proceso WebGL de la cámara del juego)
    if (Shaders.list.length && Shaders.target === 'mundo') { try { Shaders.apply(R === GLW ? GLW.cv : cv); } catch (e) { reportOnce('shader', e); } }
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.globalAlpha = 1; ctx.filter = 'none';
  } else {
    Render.showGL(false);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, cv.width, cv.height);   // v3.7.0: sin escenario ni personajes reales → negro
    ctx.restore();
  }
  CamFX.applyGame();            // camGame: ángulo, desplazamiento, alpha, shake
  CamFX.overlay('game');        // camGame.flash / fade
  if (hudLayer) CamFX.drawLayer(hudLayer, 'hud'); else drawHudLayer();
  CamFX.overlay('hud');
  if (Shaders.list.length && Shaders.target === 'todo' && Shaders.active()) {
    try {
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (Render.glShown) { ctx.globalCompositeOperation = 'destination-over'; ctx.drawImage(GLW.cv, 0, 0, cv.width, cv.height); }
      ctx.restore(); Shaders.apply(cv);
    } catch (e) { reportOnce('shader', e); }
  }
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  drawTouchZones();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

/* bucle principal (v3.3.0):
   · la lógica sigue al reloj del AUDIO (Music.position), así que notas y música no se desfasan aunque baje el FPS
   · dt nunca es negativo (antes un dt negativo tras cerrar la pausa daba un índice de frame negativo → error → sin HUD)
   · límite de FPS opcional, contador, tirones y vigilante del audio
   · un error en la lógica no impide dibujar, y un error al dibujar no detiene la lógica */
let lastFrame = performance.now(), lastPerfNow = 0;
function frame(now) {
  requestAnimationFrame(frame);
  if (!(now >= 0)) now = performance.now();
  if (!Perf.shouldDraw(now)) return;
  const raw = now - lastFrame;
  const dt = raw > 0 ? Math.min(100, raw) : 0; lastFrame = now;
  if (lastPerfNow) Perf.sample(Math.max(0, now - lastPerfNow), now); lastPerfNow = now;
  const playing = !G.paused && !Loader.active && G.chart;
  if (playing) {
    try {
      // tirón: la canción avanzó más de 250 ms entre dos frames (se mide con el reloj del audio, no con rAF)
      if (Music.playing) { const p = Music.position(); if (p - G.songPos > 250) Perf.hitch(p - G.songPos, G.songPos, p); }
      update(dt);
    } catch (e) { reportOnce('update:' + (e && e.message), e); }
    Perf.watchAudio(now);
  }
  try { render(dt); } catch (e) { reportOnce('render:' + (e && e.message), e); }
  try { uiTick(); } catch (e) { reportOnce('ui:' + (e && e.message), e); }
  document.body.classList.toggle('cargando', Loader.active);
}

/* ---------- canción por defecto: "test" (data/songs/test/test.json + songs/test/*.ogg) ---------- */
const SongLoad = { missing: [], files: [] };
async function loadSongById(id) {
  SongLoad.missing = []; SongLoad.files = [];
  let r = params.get('chart') ? await fetchFirst([params.get('chart')]) : null;
  let dir = '';
  if (!r) { r = await fetchFirst(ASSET_CFG.songChartPaths.map(t => fillT(t, { id }))); dir = fillT(ASSET_CFG.songAudioDir, { id }); }
  if (!r) { r = await fetchFirst(ASSET_CFG.defaultSong.chart); dir = ''; }
  if (!r) { SongLoad.missing.push(`canción "${id}": falta ${fillT(ASSET_CFG.songChartPaths[1], { id })} → demo generada`); return null; }
  const metaR = await fetchFirst(params.get('meta') ? [params.get('meta')] : [...ASSET_CFG.songMetaPaths.map(t => fillT(t, { id })), ...ASSET_CFG.defaultSong.meta]);
  const chart = Chart.parse(r.data, metaR ? metaR.data : null, params.get('dif') || undefined);
  SongLoad.files.push(r.path); if (metaR) SongLoad.files.push(metaR.path);
  const audioUrl = b => [b + '.ogg', b + '.mp3'];
  const inst = await fetchFirst(audioUrl(dir + 'Inst'), 'blob');
  const audio = [];
  if (inst) audio.push({ blob: inst.data, role: 'inst', name: inst.path.split('/').pop() });
  else SongLoad.missing.push(`audio: falta ${dir}Inst.ogg (se juega sin música)`);
  // voces: voiceList del chart legacy (["BF","BF-pixel"] → Voices-bf.ogg, Voices-bf-pixel.ogg) o personajes de la metadata
  const sc = chart.scene || {};
  const names = uniq((chart.voiceList || [sc.bf || 'bf', sc.dad || 'dad']).map(v => String(v).toLowerCase()));
  const found = await Promise.all(names.map(n => fetchFirst(audioUrl(dir + 'Voices-' + n), 'blob')));
  names.forEach((n, i) => {
    if (!found[i]) return;
    const role = n === String(sc.bf || '').toLowerCase() ? 'player' : n === String(sc.dad || '').toLowerCase() ? 'opponent' : (i === 0 ? 'player' : 'opponent');
    audio.push({ blob: found[i].data, role, name: found[i].path.split('/').pop() });
  });
  if (!found.some(Boolean)) { const v = await fetchFirst(audioUrl(dir + 'Voices'), 'blob'); if (v) audio.push({ blob: v.data, role: 'voices', name: 'Voices.ogg' }); }
  G.raw = r.data; G.meta = metaR ? metaR.data : null;
  return { chart, audio };
}

/* API pública para el Chart Editor GCD */
window.GCDPlay = {
  loadChart(raw, meta, audioBlobs = []) { G.raw = raw; G.meta = meta; return loadChart(Chart.parse(raw, meta), audioBlobs.map((b, i) => b && (b.blob ? b : { blob: b, role: i ? 'voices' : 'inst' }))); },
  restart, pause: () => openOverlay('pause'), resume: () => closeOverlay(), setMode, seek: seekTo, state: G, scene: Scene, layout: LAYOUT,
  music: Music, events: Events, cam: Cam, opts: Opts, loader: Loader, version: VERSION,
  perf: Perf, optim: Optim, tex: TexLoad, render: Render, astc: ASTC,
  mods: Mods, camfx: CamFX, noteKinds: NoteKinds, userAssets: UserAssets, modUI: ModUI, vfs: VFS, movil: Movil, hx: HX,
  get pack() { return G.pack; }, get variation() { return G.variation; }, get set() { return G.set; },
  cond: Cond, chartTools: Chart, speaker: Speaker, songImport: SongImport, shaders: typeof Shaders !== 'undefined' ? Shaders : null,
  reloadAssets: ids => { Scene.ids = null; Scene.notes = null; return loadScene(ids); },
  status: statusLines,
};
window.addEventListener('message', e => {
  const d = e.data;
  if (d && d.type === 'gcd-chart' && d.chart) { try { window.GCDPlay.loadChart(d.chart, d.meta || null); } catch (err) { toast('Chart inválido: ' + err.message); } }
});

/* ---------- inicio: pantalla negra de carga → todo listo a la vez ---------- */
async function boot() {
  resize();
  Optim.applyLive();
  requestAnimationFrame(frame);
  Loader.reset('Cargando…');
  await TexLoad.loadManifest().catch(() => {});
  Mods.ready = Mods.restore().catch(e => console.warn('[hxc] restore', e));   // scripts .hxc y archivos guardados (IndexedDB)
  const [, , , song] = await Promise.all([
    Fonts.load(), loadHudAssets(), loadSounds(),
    /^https?:/.test(location.protocol) ? loadSongById(ASSET_CFG.defaultSongId).catch(e => { console.warn('canción por defecto no válida', e); SongLoad.missing.push('canción por defecto: ' + e.message); return null; }) : null,
  ]).catch(e => { console.warn(e); return []; });
  if (song) {
    if (!params.has('modo')) G.mode = Movil.isTouch() && !matchMedia('(pointer: fine)').matches ? 'mobile' : 'keyboard';   // celular: táctil · PC: teclado
    setMode(['demo', 'keyboard', 'mobile', 'botplay'].includes(G.mode) ? G.mode : 'keyboard');
    await loadChart(song.chart, song.audio, { keepLoader: true });
  } else {
    setMode(['demo', 'keyboard', 'mobile', 'botplay'].includes(G.mode) ? G.mode : 'demo');
    await loadChart(Chart.makeDemo(), [], { keepLoader: true });
  }
  if (params.has('pausa')) setTimeout(() => openOverlay('pause'), +params.get('pausa') || 3000);
}
boot();
