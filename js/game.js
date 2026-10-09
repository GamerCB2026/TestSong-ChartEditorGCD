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
  const stageId = ids.stage in ASSET_CFG.stageAlias ? ASSET_CFG.stageAlias[ids.stage] : ids.stage;   // "stage" (legacy) = mainStage
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
    } else { Scene.chars[role] = null; Scene.errors[role] = c.error; st.push(`✘ ${role}: ${ids[role]} — ${c.error} → dibujo improvisado`); }
  }
  Scene.baseChars = Object.assign({}, Scene.chars);
  // parlantes de GF (parlantes.js): del escenario, del sprite de GF, asignados, por defecto o improvisados
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
  Cam.stageZoom = +(stage?.data?.cameraZoom) || 1; Cam.zoom = Cam.stageZoom;
  applyBarColors();
  const loadedProps = stage ? stage.props.filter(p => p.img || p.color || p.frames) : [];
  if (stage) st.push(`${loadedProps.length ? '✔' : '✘'} escenario: ${stage.data.name || stage.id} (${stage.from}) · props ${loadedProps.length}/${stage.props.length} · zoom ${stage.data.cameraZoom ?? 1}` +
    (stage.props.filter(p => !p.img && !p.color && !p.frames).length ? ' · faltan: ' + stage.props.filter(p => !p.img && !p.color && !p.frames).map(p => p.tried).join(', ') + ' → fondo improvisado' : ''));
  else st.push(`✘ escenario: ${ids.stage} — sin JSON → fondo improvisado`);
  if (stage && ids.stage !== stage.id) st.push(`✔ escenario del chart "${ids.stage}" → ${stage.id}`);
  st.push(`${notes.ok ? '✔' : '✘'} notas: ${notes.head.filter(Boolean).length}/4 cabezas (${notes.src.headFrom || '—'}), colas: ${notes.src.holdFrom || (notes.piece.filter(Boolean).length + '/4')}`);
  st.push(notes.placeholder.some(Boolean) ? '✘ receptores (strums): no hay noteStrumline.xml / NOTE_assets.xml / "<color> static0000.png" → receptor gris generado'
    : `✔ receptores: ${notes.src.strumSheet || notes.src.legacySheet || 'NoteAssets/*static*'}`);
  st.push(notes.hasSplash ? `✔ splashes: ${notes.src.splashSheet}.xml` : '✘ splashes: falta shared/images/noteSplashes.xml/.png → destello improvisado (solo en SICK)');
  for (const [k, ic] of [['jugador', iP1], ['rival', iP2]]) st.push(ic.ok ? `✔ icono ${k}: ${ic.where} — ${ic.kind}${ic.fallbackFace ? ` (no hay icon-${ic.wanted}: se usa icon-face)` : ''}` : `✘ icono ${k}: falta images/icons/icon-${ic.id}.png (y icon-face.png) → cara improvisada`);
  st.push(`${Speaker.cur && !Speaker.cur.improv ? '✔' : Speaker.need ? '✘' : '✔'} parlantes GF: ${Speaker.info}`);
  Scene.status = st;
  Scene.world = !!(stage && (loadedProps.length || bf instanceof RealChar || dad instanceof RealChar));
  // v3.3.0: se liberan las hojas enormes ya recortadas y se suben/calientan todas las texturas
  // mientras se ve "Cargando…" (antes la primera vez que aparecía cada imagen había un tirón)
  TexLoad.endScene();
  try { Render.forgetTextures(); const n = Render.prewarm(worldTextures()); st.push(`✔ render: ${Render.name()} · ${n} texturas precargadas · calidad ${Optim.s.preset} (texturas ${Optim.s.tex}%, mundo ${Optim.s.res}%)`); }
  catch (e) { console.warn('[TestSong] precarga', e); }
  st.push(...TexLoad.statusLines());
  Cam.init = false; Scene.loading = false;
  const any = Scene.world || notes.ok || iP1.ok || iP2.ok;
  if (isFile && !(bf instanceof RealChar && dad instanceof RealChar)) toast('Abierto como archivo (file://): el navegador bloquea los assets. Usa GitHub Pages o un servidor local (python -m http.server).', 7000);
  else if (!any) toast('No encontré assets reales (data/, shared/images/…): uso los dibujos improvisados', 4000);
  console.info('[TestSong] assets\n' + statusLines().join('\n'));
}

/* coloca un personaje en su sitio del escenario (Stage.addCharacter) */
function placeChar(c, role, stage) {
  stage = stage || Scene.stage;
  const sc = stage?.data?.characters?.[role] || { position: role === 'bf' ? [989.5, 885] : role === 'dad' ? [335, 885] : [751.5, 787], zIndex: role === 'bf' ? 300 : role === 'dad' ? 200 : 100 };
  c.place(sc);
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
  for (const rec of Mods.scripts.values()) out.push(`✔ script ${rec.name}: ${[...rec.events, ...rec.kinds, ...rec.modules].join(', ') || 'sin registros'} (imitación)`);
  if (G.chart) { const u = ModUI.unknown(G.chart); if (u.ev.size || u.nk.size) out.push(`✘ sin .hxc: ${[...u.ev.keys(), ...u.nk.keys()].join(', ')} (Assets cargados → Eventos / note kinds)`); }
  out.push(...Events.statusLines());
  out.push(...Shaders.statusLines());
  out.push(...UserAssets.statusLines());
  for (const m of SongLoad.missing) out.push('✘ ' + m);
  if (!Sfx.unlocked) out.push('… el sonido se activa al primer toque/tecla (regla del navegador)');
  return out;
}

/* ---------- estado ---------- */
const G = {
  chart: null, raw: null, meta: null,
  mode: params.get('modo') || 'demo',
  songPos: 0, gameTime: 0, paused: false, overlayKind: null,
  health: FNF.HEALTH_START, healthLerp: FNF.HEALTH_START,
  score: 0, misses: 0, combo: 0, judged: 0, accSum: 0,
  dad: { pose: 'idle', poseAt: -1e9, poseUntil: -1e9, miss: false },
  bf:  { pose: 'idle', poseAt: -1e9, poseUntil: -1e9, miss: false },
  strums: { opponent: { confirmAt: [-1e9, -1e9, -1e9, -1e9], hold: [0, 0, 0, 0] },
            player:   { confirmAt: [-1e9, -1e9, -1e9, -1e9], hold: [0, 0, 0, 0], pressed: [false, false, false, false], pressAt: [0, 0, 0, 0], confirmHeld: [false, false, false, false] } },
  lastBeat: -999, hudZoom: 1, speed: 1.6, speedTween: null,
};
const isBot = () => G.mode === 'demo' || G.mode === 'botplay';

/* Carga un chart: pantalla negra "Cargando…" hasta tener escenario, personajes, iconos, audio y
   eventos listos; después se dibuja todo de una vez (sin personajes improvisados intermedios). */
let loadToken = 0;
async function loadChart(chart, audio = [], opts = {}) {
  const tok = ++loadToken;
  if (!opts.keepLoader) Loader.reset(opts.label);
  Loader.active = true; G.paused = true; Music.pause(); hideOverlay();
  G.chart = chart; G.speed = chart.speed;
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

/* Reinicia la canción (paused = queda detenida esperando "Jugar") */
function restart(paused) {
  const c = G.chart;
  c.notes.forEach(n => { n.judged = n.hit = n.missed = n.holding = n.dropped = n.skipped = n.passed = false; });
  const start = params.has('t') && !G.startedOnce ? +params.get('t') : -c.crochet * 5;   // Countdown.hx: empieza 5 beats antes
  G.startedOnce = true;
  Music.pause(); Music.seek(start);
  G.songPos = start;
  G.health = G.healthLerp = FNF.HEALTH_START;
  G.score = G.misses = G.combo = G.judged = G.accSum = 0;
  G.lastBeat = Math.floor(Cond.beat(G.songPos)); G.lastStep = Math.floor(Cond.step(G.songPos)); G.hudZoom = 1; Cam.bop = 1; G.noteIdx = 0;
  Popups.length = 0; Splashes.length = 0;
  resetActors();
  Cam.init = false; Scene.focus = 'dad';
  Mods.resetRuntime(true);
  Events.seek(Math.max(0, start));         // eventos en t<=0 (p. ej. FocusCamera inicial) se aplican al instante
  if (start > 0) skipNotesBefore(start);
  Music.setVolume('player', 1); Music.setVolume('voices', 1);
  if (paused === true) return;
  closeOverlay();
}
function resetActors() {
  for (const ch of [G.dad, G.bf]) { ch.pose = 'idle'; ch.poseUntil = -1e9; ch.miss = false; }
  for (const ch of Object.values(Scene.chars)) if (ch) ch.reset();
  propsReset();
  for (const ic of Object.values(Scene.icons)) if (ic) ic.reset();
  for (const s of Object.values(G.strums)) { s.confirmAt.fill(-1e9); s.hold.fill(0); }
  G.strums.player.pressed.fill(false); G.strums.player.confirmHeld.fill(false);
}
/* notas anteriores a la posición: se saltan sin contar fallos ni tocar la vida */
function skipNotesBefore(pos) {
  G.noteIdx = 0;
  for (const n of G.chart.notes) {
    const skip = n.time < pos;
    n.judged = n.skipped = skip; n.hit = n.missed = n.holding = n.dropped = n.passed = false;
  }
}
/* Buscar (barra de tiempo de la pausa): canción + chart + eventos juntos */
function seekTo(pos) {
  const c = G.chart, total = songLength();
  pos = clamp(pos, 0, Math.max(0, total - 50));
  G.songPos = pos; Music.seek(pos);
  skipNotesBefore(pos);
  G.lastBeat = Math.floor(Cond.beat(pos)); G.lastStep = Math.floor(Cond.step(pos));
  Popups.length = 0; Splashes.length = 0;
  resetActors();
  Cam.init = false;
  Mods.resetRuntime(false);
  Events.seek(pos);
  if (!c.hasFocusEvents) Scene.focus = nextFocus(pos) || Scene.focus;
}
function songLength() { return Math.max(G.chart.endTime - 1800, Music.duration || 0) || G.chart.endTime; }
function nextFocus(pos) { const n = G.chart.notes.find(n => n.time >= pos); return n ? (n.side === 'player' ? 'bf' : 'dad') : null; }

function changeHealth(delta) {
  if (!Number.isFinite(delta)) return;
  G.health = clamp(G.health + delta, 0, FNF.HEALTH_MAX);
  if (G.health <= 0 && !isBot()) openOverlay('over');
}

function sing(ch, lane, miss = false, holdMs = 0, suffix = '') {
  ch.pose = LANE_NAMES[lane]; ch.miss = miss; ch.poseAt = G.gameTime;
  ch.poseUntil = G.gameTime + Math.max(Cond.crochet(G.songPos) * 0.85, holdMs);
  const real = Scene.chars[ch === G.bf ? 'bf' : 'dad'];
  if (real) real.sing(lane, miss, holdMs, suffix);
}
/* animación especial (hey, ugh, golpes de Blazin'…): la primera que exista en el personaje */
function playSpecial(role, names, alt) {
  const c = Scene.chars[role]; if (!c) return false;
  const list = alt && names.length > 1 ? [names[1], names[0], ...names.slice(2)] : names;
  for (const nm of list) if (c.anims.has(nm)) { c.playEvent(nm, true); return true; }
  return false;
}
/* animación de una nota según su note kind (juego base imitado o .hxc) */
function noteAnim(n, kind, miss) {
  const isP = n.side === 'player', st = isP ? G.bf : G.dad, role = isP ? 'bf' : 'dad';
  const plain = () => sing(st, n.lane, miss, miss ? 0 : n.sustain, kind && kind.suffix || '');
  if (!kind || !kind.id) return plain();
  if (kind.blazin) {
    // weekend-1-*: Pico (jugador) y Darnell (rival) hacen los golpes; si no tienen esas anims, cantan normal
    if (miss) { if (!playSpecial('bf', ['hitHigh', 'hitLow'])) plain(); return; }
    const alt = Math.round(n.time / 10) % 2 === 1;
    const a = playSpecial('bf', kind.blazin[0], alt), b = playSpecial('dad', kind.blazin[1], alt);
    if (!(isP ? a : b)) plain();
    return;
  }
  if (kind.hurt && !miss && isP) return sing(st, n.lane, true);
  if (kind.noAnim && !miss) return;
  if (kind.gf) { const gf = Scene.chars.gf; if (gf) { gf.sing(n.lane, miss, miss ? 0 : n.sustain); return; } return plain(); }
  if (kind.special && !miss && playSpecial(role, kind.special)) return;
  plain();
}
const needsModEvent = n => (n.kind && Mods.kinds.has(n.kind)) || Mods.modules.size > 0;

/* Scoring.hx (PBOT1) */
function scoreNote(ms) {
  if (ms > 160) return -100;
  if (ms < 5) return 500;
  return Math.floor(500 * (1 - 1 / (1 + Math.exp(-0.08 * (ms - 54.99)))) + 9);
}

function hitNote(n, diff) {
  const kind = n.kind ? NoteKinds.get(n.kind) : null, isP = n.side === 'player';
  const j = CONFIG.judgments.find(j => diff <= j.ms) || CONFIG.judgments[CONFIG.judgments.length - 1];
  // onNoteHit de los scripts (.hxc): pueden cancelar la nota o cambiar la vida
  const ev = needsModEvent(n) ? Mods.noteEvent('NOTE_HIT', n, { judgement: j.id, score: isP ? scoreNote(diff) : 0, healthChange: isP ? (kind && kind.hitHealth != null ? kind.hitHealth : j.health) : 0, isComboBreak: false, hitDiff: diff }) : null;
  n.judged = n.hit = true; n.holding = n.sustain > 0 && !(ev && ev.canceled);
  if (ev && ev.canceled) return;
  const s = G.strums[n.side]; s.confirmAt[n.lane] = G.gameTime;
  if (isP) { s.confirmHeld[n.lane] = true; Music.setVolume('player', 1); Music.setVolume('voices', 1); }
  noteAnim(n, kind, false);
  if (!isP) {
    if (G.mode === 'demo' && G.health > 0.35) changeHealth(-CONFIG.demoOppDrain);
    return;
  }
  if (kind && kind.hurt) { changeHealth(ev ? +ev.healthChange || 0 : kind.hitHealth); playMissSound(); return; }   // nota "hurt": tocarla duele
  G.score += ev ? +ev.score || 0 : scoreNote(diff); G.judged++; G.accSum += j.acc;
  if (j.id === 'bad' || j.id === 'shit') breakCombo(); else { G.combo++; comboMilestone(); }
  changeHealth(ev ? +ev.healthChange || 0 : j.health);
  if (j.id === 'sick') spawnSplash(n.side, n.lane);
  displayRating(j.id);
  if (G.combo >= 10) displayCombo(G.combo);
}
function comboMilestone() { const gf = Scene.chars.gf; if (gf && gf.anims.has('combo' + G.combo)) gf.special('combo' + G.combo); }
function breakCombo() {
  const gf = Scene.chars.gf;
  if (gf) { const drops = [...gf.anims.keys()].filter(k => /^drop\d+$/.test(k)).map(k => +k.slice(4)).filter(v => G.combo >= v).sort((a, b) => b - a); if (drops.length) gf.special('drop' + drops[0]); }
  G.combo = 0;
}

function missNote(n) {
  const kind = n.kind ? NoteKinds.get(n.kind) : null;
  if (kind && kind.hurt && !Mods.kinds.has(n.kind)) { n.judged = n.passed = true; return; }   // dejar pasar una nota "hurt" no es fallo
  const ev = needsModEvent(n) ? Mods.noteEvent('NOTE_MISS', n, { healthChange: FNF.HEALTH_MISS, playSound: true }) : null;
  n.judged = n.missed = true;
  if (ev && ev.canceled) { n.missed = false; n.passed = true; return; }
  if (kind && kind.hurt) { n.missed = false; n.passed = true; if (ev) changeHealth(+ev.healthChange || 0); return; }
  if (G.combo >= 10) displayCombo(0);
  G.misses++; G.judged++; G.score -= 100; breakCombo();
  noteAnim(n, kind, true);
  Music.setVolume('player', 0); Music.setVolume('voices', 0);     // V-Slice: se silencia la voz del jugador
  if (!ev || ev.playSound !== false) playMissSound();
  changeHealth(ev ? +ev.healthChange || 0 : FNF.HEALTH_MISS);
}

/* En demo el bot falla a propósito en "olas" para que la barra de vida se mueva */
function demoShouldMiss(n) {
  if (G.health < 0.55) return false;
  const wave = 0.5 + 0.5 * Math.sin(n.time / 5200);
  return n.seed < 0.06 + 0.5 * wave * wave;
}

/* ---------- update ---------- */
function onBeat(beat) {
  for (const c of Object.values(Scene.chars)) if (c) c.onBeat(beat);
  for (const ic of Object.values(Scene.icons)) if (ic && ic.shouldBop !== false) ic.bop();   // HealthIcon.onStepHit (cada 4 steps)
  propsBeat(beat); Speaker.beat(beat);
  if (beat >= -4 && beat <= -1) Sfx.play('count' + (beat + 4), FNF.COUNTDOWN_VOLUME);   // introTHREE/TWO/ONE/GO
  if (Mods.modules.size) Mods.hook('onBeatHit', { beat });
}
/* PlayState.stepHit: bop de cámara cada "rate" beats (decimal) con "offset" (SetCameraBop), si el HUD está por debajo de 135 % */
function onStep(step) {
  const rate = Cam.zoomRate, spb = 4;
  if (Optim.s.bop && rate > 0 && G.hudZoom < 1.35) {
    const m = (step + Cam.zoomOffset * spb) % (rate * spb);
    if (Math.abs(m) < 1e-6 || Math.abs(Math.abs(m) - rate * spb) < 1e-6) { Cam.bop = Cam.bopIntensity; G.hudZoom += Cam.hudIntensity; }
  }
  if (Mods.modules.size) Mods.hook('onStepHit', { step });
}

function update(dt) {
  const c = G.chart;
  G.gameTime += dt;
  // reloj maestro: la posición de la canción sale siempre del reloj del audio (nunca se acumula dt)
  Music.tick();
  G.songPos = Music.position();
  Events.update(G.songPos);
  const step = Math.floor(Cond.step(G.songPos)), beat = Math.floor(step / 4);
  if (step !== G.lastStep) { if (G.lastStep == null || step < G.lastStep || step - G.lastStep > 32) G.lastStep = step - 1; for (let s2 = G.lastStep + 1; s2 <= step; s2++) onStep(s2); G.lastStep = step; }
  if (beat !== G.lastBeat) { for (let b = G.lastBeat + 1; b <= beat && b - G.lastBeat < 8; b++) onBeat(b); G.lastBeat = beat; }
  Mods.update(dt); CamFX.tick();

  // cámara / HUD: vuelven a 1 (0.95 por frame a 60 fps)
  const decay = Math.pow(0.95, dt / (1000 / 60));
  if (Cam.zoomRate > 0) { Cam.bop = lerp(1, Cam.bop, decay); G.hudZoom = lerp(1, G.hudZoom, decay); }   // solo con bop activo (como el juego)
  G.healthLerp = lerp(G.health, G.healthLerp, Math.pow(0.85, dt / (1000 / 60)));

  let focusSet = false;
  G.strums.opponent.hold.fill(0);
  // v3.3.0: índice de la primera nota sin terminar (antes se recorrían todas las ya jugadas cada frame)
  if (G.noteArr !== c.notes) { G.noteArr = c.notes; G.noteIdx = 0; }
  const notes = c.notes;
  while (G.noteIdx < notes.length && notes[G.noteIdx].judged && !notes[G.noteIdx].holding && notes[G.noteIdx].time < G.songPos - 1000) G.noteIdx++;
  for (let ni = G.noteIdx; ni < notes.length; ni++) {
    const n = notes[ni];
    if (n.time - G.songPos > 3000) break;
    if (n.judged) {
      if (n.holding) {
        if (G.songPos >= n.time + n.sustain) n.holding = false;
        else {
          const s = G.strums[n.side]; s.confirmAt[n.lane] = G.gameTime; if (n.side === 'opponent') s.hold[n.lane] = 1;
          const ch = n.side === 'player' ? G.bf : G.dad; ch.poseUntil = Math.max(ch.poseUntil, G.gameTime + 60);
          const real = Scene.chars[n.side === 'player' ? 'bf' : 'dad']; if (real) real.holdOn();
          if (n.side === 'player') changeHealth(FNF.HEALTH_HOLD_PER_SEC * dt / 1000);
        }
      }
      continue;
    }
    const diff = n.time - G.songPos;
    // cámara: enfoca a quien canta la próxima nota (como los eventos FocusCamera)
    // (solo si el chart no trae eventos FocusCamera; con eventos manda el evento, como en V-Slice)
    if (!focusSet && !c.hasFocusEvents) { focusSet = true; if (diff < Cond.crochet(G.songPos) * 2 && G.songPos >= 0) Scene.focus = n.side === 'player' ? 'bf' : 'dad'; }
    if (n.side === 'opponent') { if (diff <= 0) hitNote(n, 0); continue; }
    if (isBot() && diff <= 0) {
      if (n.kind && NoteKinds.isHurt(n.kind)) { /* el bot esquiva las notas que hacen daño */ }
      else if (G.mode === 'demo' && demoShouldMiss(n)) { /* deja pasar la nota */ }
      else { hitNote(n, 0); continue; }
    }
    if (diff < -FNF.HIT_WINDOW_MS) missNote(n);
  }
  for (const [ic, hp] of [[Scene.icons.player, G.health], [Scene.icons.opponent, FNF.HEALTH_MAX - G.health]]) if (ic) ic.updateAnim(hp);
  updatePopups(dt);

  const end = Math.max(c.endTime, Music.duration + 300);
  if (G.songPos > end) { if (G.mode === 'demo') restart(); else openOverlay('end'); }
}

/* ---------- input ---------- */
function press(lane) {
  if (G.paused) return;
  if (G.mode === 'demo') { setMode('keyboard'); toast('Modo Teclado activado ⌨'); }
  if (isBot()) return;
  const st = G.strums.player; st.pressed[lane] = true; st.pressAt[lane] = G.gameTime; st.confirmHeld[lane] = false;
  // posición exacta del audio en el momento de la tecla (no la del último frame: con pocos FPS eso desfasaba el juicio)
  if (Music.playing) G.songPos = Music.position();
  let best = null;
  const notes = G.chart.notes;
  for (let ni = G.noteIdx || 0; ni < notes.length; ni++) {
    const n = notes[ni];
    if (n.time - G.songPos > FNF.HIT_WINDOW_MS) break;
    if (n.judged || n.side !== 'player' || n.lane !== lane) continue;
    if (Math.abs(n.time - G.songPos) <= FNF.HIT_WINDOW_MS) { best = n; break; }
  }
  if (best) hitNote(best, Math.abs(best.time - G.songPos));
  // ghost tapping: sin penalización (opción por defecto del juego)
}
function release(lane) {
  const st = G.strums.player; st.pressed[lane] = false; st.confirmHeld[lane] = false;
  if (isBot()) return;
  for (const n of G.chart.notes) if (n.holding && n.side === 'player' && n.lane === lane) { n.holding = false; n.dropped = true; }
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
  const vsArrows = G.mode === 'mobile' && Opts.vslice === 'arrows';
  if (vsArrows) {
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
  const hudSprites = ModRT.sprites.filter(sp => sp.onHud);
  for (const sp of hudSprites) if (sp.behind) { ctx.save(); sp.render(null); ctx.restore(); }   // insert(indexOf(strumLine) - 1)
  drawStrumsAndNotes();
  for (const sp of hudSprites) if (!sp.behind) { ctx.save(); sp.render(null); ctx.restore(); }
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
    try { R = Render.beginWorld(worldNeedsDirect()); renderWorld(G.paused ? 0 : dt, Optim.s.bop ? Cam.bop : 1, R); }
    catch (e) { reportOnce('mundo', e); }
    try { if (R) Render.endWorld(R); } catch (e) { reportOnce('fin del mundo', e); }
    // v3.4.0: shaders cargados (post-proceso WebGL de la cámara del juego)
    if (Shaders.list.length && Shaders.target === 'mundo') { try { Shaders.apply(R === GLW ? GLW.cv : cv); } catch (e) { reportOnce('shader', e); } }
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.globalAlpha = 1; ctx.filter = 'none';
  } else {
    Render.showGL(false);
    ctx.save();
    const z = Cam.bop; ctx.translate(W / 2, H / 2); ctx.scale(z, z); ctx.translate(-W / 2, -H / 2);
    drawStage();
    const s = L.charH / 215;
    drawCharacter(G.dad, drawRival, L.oppX, L.floorY, s, 1);
    drawCharacter(G.bf, drawBoy, L.plX, L.floorY, s * 1.05, -1);      // bf mira hacia el rival (izquierda)
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
