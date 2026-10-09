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
      const sc = stage?.data?.characters?.[role] || { position: role === 'bf' ? [989.5, 885] : role === 'dad' ? [335, 885] : [751.5, 787], zIndex: role === 'bf' ? 300 : role === 'dad' ? 200 : 100 };
      c.place(sc);
      st.push(`✔ ${role}: ${c.id} — ${c.kind === 'atlas' ? 'Animate Atlas' : 'Sparrow'} (${c.where}) · ${c.anims.size} anims · ${c.flipX ? 'volteado' : 'sin voltear'}${role === 'bf' ? ' (jugador: !flipX del JSON)' : ''}${c.missing.length ? ' · faltan: ' + c.missing.join(', ') : ''}${c.fallbackFrom ? ` · (el chart pedía "${c.fallbackFrom}")` : ''}`);
    } else { Scene.chars[role] = null; Scene.errors[role] = c.error; st.push(`✘ ${role}: ${ids[role]} — ${c.error} → dibujo improvisado`); }
  }
  // iconos de vida (healthIcon del JSON o id del personaje)
  const iconData = role => { const c = Scene.chars[role]; const d = c ? c.data : DEFAULT_DATA.characters[ids[role]]; return [c ? c.id : ids[role], d && d.healthIcon]; };
  const [iP1, iP2] = await Promise.all([new HealthIcon(0).load(...iconData('bf')), new HealthIcon(1).load(...iconData('dad'))]);
  if (token !== Scene.token) return;
  Scene.icons = { player: iP1, opponent: iP2 }; Scene.baseIcons = { player: iP1, opponent: iP2 };
  Cam.stageZoom = +(stage?.data?.cameraZoom) || 1; Cam.zoom = Cam.stageZoom;
  // colores de la barra: rojo/verde del juego; si el JSON trae colores (estilo Psych) se usan
  for (const [role, k] of [['dad', 'opp'], ['bf', 'player']]) {
    const d = Scene.chars[role]?.data, col = d && (d.healthbar_colors || d.healthBarColor || d.healthbarColor || d.healthIcon?.color);
    let rgb = null;
    if (Array.isArray(col) && col.length >= 3) rgb = col.slice(0, 3).map(Number);
    else if (typeof col === 'string' && /^#?[0-9a-f]{6}/i.test(col)) rgb = hexRgb('#' + col.replace(/^#/, '').slice(0, 6));
    COLORS[k] = rgb ? `rgb(${rgb.join(',')})` : DEFAULT_COLORS[k];
  }
  const loadedProps = stage ? stage.props.filter(p => p.img || p.color || p.frames) : [];
  if (stage) st.push(`${loadedProps.length ? '✔' : '✘'} escenario: ${stage.data.name || stage.id} (${stage.from}) · props ${loadedProps.length}/${stage.props.length} · zoom ${stage.data.cameraZoom ?? 1}` +
    (stage.props.filter(p => !p.img && !p.color && !p.frames).length ? ' · faltan: ' + stage.props.filter(p => !p.img && !p.color && !p.frames).map(p => p.tried).join(', ') + ' → fondo improvisado' : ''));
  else st.push(`✘ escenario: ${ids.stage} — sin JSON → fondo improvisado`);
  if (stage && ids.stage !== stage.id) st.push(`✔ escenario del chart "${ids.stage}" → ${stage.id}`);
  st.push(`${notes.ok ? '✔' : '✘'} notas: ${notes.head.filter(Boolean).length}/4 cabezas (${notes.src.headFrom || '—'}), colas: ${notes.src.holdFrom || (notes.piece.filter(Boolean).length + '/4')}`);
  st.push(notes.placeholder.some(Boolean) ? '✘ receptores (strums): no hay noteStrumline.xml / NOTE_assets.xml / "<color> static0000.png" → receptor gris generado'
    : `✔ receptores: ${notes.src.strumSheet || notes.src.legacySheet || 'NoteAssets/*static*'}`);
  st.push(notes.hasSplash ? `✔ splashes: ${notes.src.splashSheet}.xml` : '✘ splashes: falta shared/images/noteSplashes.xml/.png → destello improvisado (solo en SICK)');
  for (const [k, ic] of [['jugador', iP1], ['rival', iP2]]) st.push(ic.ok ? `✔ icono ${k}: ${ic.where} — ${ic.kind}${ic.id !== ic.where ? '' : ''}` : `✘ icono ${k}: falta images/icons/icon-${ic.id}.png → cara improvisada`);
  Scene.status = st;
  Scene.world = !!(stage && (loadedProps.length || bf instanceof RealChar || dad instanceof RealChar));
  Cam.init = false; Scene.loading = false;
  const any = Scene.world || notes.ok || iP1.ok || iP2.ok;
  if (isFile && !(bf instanceof RealChar && dad instanceof RealChar)) toast('Abierto como archivo (file://): el navegador bloquea los assets. Usa GitHub Pages o un servidor local (python -m http.server).', 7000);
  else if (!any) toast('No encontré assets reales (data/, shared/images/…): uso los dibujos improvisados', 4000);
  console.info('[TestSong] assets\n' + statusLines().join('\n'));
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
  await Promise.all([loadScene(chart.scene || {}), opts.keepAudio ? null : Music.set(audio), Events.preload(chart)]);
  if (tok !== loadToken) return;
  Loader.finish();
  restart(true);
  if (!params.has('t') || opts.ready) openOverlay('ready');
  else closeOverlay();
}

/* Reinicia la canción (paused = queda detenida esperando "Jugar") */
function restart(paused) {
  const c = G.chart;
  c.notes.forEach(n => { n.judged = n.hit = n.missed = n.holding = n.dropped = n.skipped = false; });
  const start = params.has('t') && !G.startedOnce ? +params.get('t') : -c.crochet * 5;   // Countdown.hx: empieza 5 beats antes
  G.startedOnce = true;
  Music.pause(); Music.seek(start);
  G.songPos = start;
  G.health = G.healthLerp = FNF.HEALTH_START;
  G.score = G.misses = G.combo = G.judged = G.accSum = 0;
  G.lastBeat = Math.floor(G.songPos / c.crochet); G.hudZoom = 1; Cam.bop = 1;
  Popups.length = 0; Splashes.length = 0;
  resetActors();
  Cam.init = false; Scene.focus = 'dad';
  Events.seek(Math.max(0, start));         // eventos en t<=0 (p. ej. FocusCamera inicial) se aplican al instante
  if (start > 0) skipNotesBefore(start);
  Music.setVolume('player', 1); Music.setVolume('voices', 1);
  if (paused === true) return;
  closeOverlay();
}
function resetActors() {
  for (const ch of [G.dad, G.bf]) { ch.pose = 'idle'; ch.poseUntil = -1e9; ch.miss = false; }
  for (const ch of Object.values(Scene.chars)) if (ch) ch.reset();
  for (const ic of Object.values(Scene.icons)) if (ic) ic.reset();
  for (const s of Object.values(G.strums)) { s.confirmAt.fill(-1e9); s.hold.fill(0); }
  G.strums.player.pressed.fill(false); G.strums.player.confirmHeld.fill(false);
}
/* notas anteriores a la posición: se saltan sin contar fallos ni tocar la vida */
function skipNotesBefore(pos) {
  for (const n of G.chart.notes) {
    const skip = n.time < pos;
    n.judged = n.skipped = skip; n.hit = n.missed = n.holding = n.dropped = false;
  }
}
/* Buscar (barra de tiempo de la pausa): canción + chart + eventos juntos */
function seekTo(pos) {
  const c = G.chart, total = songLength();
  pos = clamp(pos, 0, Math.max(0, total - 50));
  G.songPos = pos; Music.seek(pos);
  skipNotesBefore(pos);
  G.lastBeat = Math.floor(pos / c.crochet);
  Popups.length = 0; Splashes.length = 0;
  resetActors();
  Cam.init = false;
  Events.seek(pos);
  if (!c.hasFocusEvents) Scene.focus = nextFocus(pos) || Scene.focus;
}
function songLength() { return Math.max(G.chart.endTime - 1800, Music.duration || 0) || G.chart.endTime; }
function nextFocus(pos) { const n = G.chart.notes.find(n => n.time >= pos); return n ? (n.side === 'player' ? 'bf' : 'dad') : null; }

function changeHealth(delta) {
  G.health = clamp(G.health + delta, 0, FNF.HEALTH_MAX);
  if (G.health <= 0 && !isBot()) openOverlay('over');
}

function sing(ch, lane, miss = false, holdMs = 0) {
  ch.pose = LANE_NAMES[lane]; ch.miss = miss; ch.poseAt = G.gameTime;
  ch.poseUntil = G.gameTime + Math.max(G.chart.crochet * 0.85, holdMs);
  const real = Scene.chars[ch === G.bf ? 'bf' : 'dad'];
  if (real) real.sing(lane, miss, holdMs);
}

/* Scoring.hx (PBOT1) */
function scoreNote(ms) {
  if (ms > 160) return -100;
  if (ms < 5) return 500;
  return Math.floor(500 * (1 - 1 / (1 + Math.exp(-0.08 * (ms - 54.99)))) + 9);
}

function hitNote(n, diff) {
  n.judged = n.hit = true; n.holding = n.sustain > 0;
  const s = G.strums[n.side]; s.confirmAt[n.lane] = G.gameTime;
  if (n.side === 'player') { s.confirmHeld[n.lane] = true; Music.setVolume('player', 1); Music.setVolume('voices', 1); }
  sing(n.side === 'player' ? G.bf : G.dad, n.lane, false, n.sustain);
  if (n.side === 'opponent') {
    if (G.mode === 'demo' && G.health > 0.35) changeHealth(-CONFIG.demoOppDrain);
    return;
  }
  const j = CONFIG.judgments.find(j => diff <= j.ms) || CONFIG.judgments[CONFIG.judgments.length - 1];
  G.score += scoreNote(diff); G.judged++; G.accSum += j.acc;
  if (j.id === 'bad' || j.id === 'shit') breakCombo(); else { G.combo++; comboMilestone(); }
  changeHealth(j.health);
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
  n.judged = n.missed = true;
  if (G.combo >= 10) displayCombo(0);
  G.misses++; G.judged++; G.score -= 100; breakCombo();
  sing(G.bf, n.lane, true);
  Music.setVolume('player', 0); Music.setVolume('voices', 0);     // V-Slice: se silencia la voz del jugador
  playMissSound();
  changeHealth(FNF.HEALTH_MISS);
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
  for (const ic of Object.values(Scene.icons)) if (ic) ic.bop();                // HealthIcon.onStepHit (cada 4 steps)
  if (Cam.zoomRate > 0 && beat % Cam.zoomRate === 0 && G.hudZoom < 1.35) { Cam.bop = Cam.bopIntensity; G.hudZoom += Cam.hudIntensity; }   // SetCameraBop
  if (beat >= -4 && beat <= -1) Sfx.play('count' + (beat + 4), FNF.COUNTDOWN_VOLUME);   // introTHREE/TWO/ONE/GO
}

function update(dt) {
  const c = G.chart;
  G.gameTime += dt;
  // reloj maestro: la posición de la canción sale siempre del reloj del audio (nunca se acumula dt)
  Music.tick();
  G.songPos = Music.position();
  Events.update(G.songPos);
  const beat = Math.floor(G.songPos / c.crochet);
  if (beat !== G.lastBeat) { for (let b = G.lastBeat + 1; b <= beat && b - G.lastBeat < 8; b++) onBeat(b); G.lastBeat = beat; }

  // cámara / HUD: vuelven a 1 (0.95 por frame a 60 fps)
  const decay = Math.pow(0.95, dt / (1000 / 60));
  Cam.bop = lerp(1, Cam.bop, decay); G.hudZoom = lerp(1, G.hudZoom, decay);
  G.healthLerp = lerp(G.health, G.healthLerp, Math.pow(0.85, dt / (1000 / 60)));

  let focusSet = false;
  G.strums.opponent.hold.fill(0);
  for (const n of c.notes) {
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
    if (!focusSet && !c.hasFocusEvents) { focusSet = true; if (diff < c.crochet * 2 && G.songPos >= 0) Scene.focus = n.side === 'player' ? 'bf' : 'dad'; }
    if (n.side === 'opponent') { if (diff <= 0) hitNote(n, 0); continue; }
    if (isBot() && diff <= 0) {
      if (G.mode === 'demo' && demoShouldMiss(n)) { /* deja pasar la nota */ }
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
  let best = null;
  for (const n of G.chart.notes) {
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
function resize() {
  DPR = Math.min(2, window.devicePixelRatio || 1); W = innerWidth; H = innerHeight;
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  const portrait = H > W * 1.05;
  V.portrait = LAYOUT.portrait = portrait;
  if (!portrait) {
    V.w = FNF.WIDTH; V.h = FNF.HEIGHT; V.s = Math.min(W / V.w, H / V.h); V.ox = (W - V.w * V.s) / 2; V.oy = (H - V.h * V.s) / 2;
    const down = Opts.isDown(), sy = down ? V.h - NOTE_W - FNF.STRUMLINE_Y_OFFSET : FNF.STRUMLINE_Y_OFFSET;
    const mid = Opts.middlescroll, centerX = V.w / 2 - (FNF.INITIAL_OFFSET + 1.5 * FNF.NOTE_SPACING) - NOTE_W / 2;
    // middlescroll (como Psych/V-Slice): jugador al centro; rival a los lados (2 y 2) y transparente
    Object.assign(LAYOUT.opponent, { x: FNF.STRUMLINE_X_OFFSET, y: sy, k: 1, spacing: 1, down, alpha: mid ? 0.35 : 1, splitX: mid ? V.w / 2 + FNF.STRUMLINE_X_OFFSET : null });
    Object.assign(LAYOUT.player, { x: mid ? centerX : V.w / 2 + FNF.STRUMLINE_X_OFFSET, y: sy, k: 1, spacing: 1, down, alpha: 1, splitX: null });
    Object.assign(LAYOUT.bar, { x: (V.w - FNF.HEALTH_BAR_W) / 2, y: down ? V.h * 0.1 : V.h * 0.9 });
  } else {
    // celular vertical: rival en mini arriba, jugador grande abajo (como el modo móvil del juego)
    V.w = 720; V.s = W / V.w; V.h = H / V.s; V.ox = 0; V.oy = 0;
    const center = k => V.w / 2 - (FNF.INITIAL_OFFSET + 1.5 * FNF.NOTE_SPACING) * k - NOTE_W * k / 2;
    const ko = 0.55, kp = Math.min(1.3, (V.w - 40) / (4 * FNF.NOTE_SPACING));
    const down = Opts.isDown(), mid = Opts.middlescroll;
    const barTop = FNF.STRUMLINE_Y_OFFSET + NOTE_W * ko + 70;
    Object.assign(LAYOUT.opponent, { x: center(ko), y: FNF.STRUMLINE_Y_OFFSET + 10, k: ko, spacing: 1, down: false, alpha: mid ? 0.35 : 1, splitX: null });
    // downscroll: receptores abajo (las notas bajan... suben desde abajo); upscroll: receptores arriba, bajo la barra de vida
    Object.assign(LAYOUT.player, { x: center(kp), y: down ? V.h - NOTE_W * kp - FNF.STRUMLINE_Y_OFFSET - 40 : barTop + 120, k: kp, spacing: 1, down, alpha: 1, splitX: null });
    Object.assign(LAYOUT.bar, { x: (V.w - FNF.HEALTH_BAR_W) / 2, y: down ? barTop : V.h - 150 });
    Object.assign(LAYOUT.clip, { oppBottom: down ? V.h * 0.6 : barTop + 100, playerTop: down ? LAYOUT.bar.y + 110 : barTop + 100 });
  }
  Object.assign(LAYOUT.popup, { rx: V.w * 0.474, ry: (portrait ? V.h * 0.42 : V.h * 0.45) - 60, nx: V.w * 0.507, ny: portrait ? V.h * 0.41 : V.h * 0.44 });
  improvLayout();
}
window.addEventListener('resize', resize);

/* ---------- render ---------- */
const beatPos = () => G.songPos / G.chart.crochet;
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

function render(dt = 16) {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  if (Loader.active || !G.chart) { drawLoading(); return; }
  ctx.clearRect(0, 0, W, H);
  if (Scene.world) renderWorld(G.paused ? 0 : dt, Cam.bop);
  else {
    ctx.save();
    const z = Cam.bop; ctx.translate(W / 2, H / 2); ctx.scale(z, z); ctx.translate(-W / 2, -H / 2);
    drawStage();
    const s = L.charH / 215;
    drawCharacter(G.dad, drawRival, L.oppX, L.floorY, s, 1);
    drawCharacter(G.bf, drawBoy, L.plX, L.floorY, s * 1.05, -1);      // bf mira hacia el rival (izquierda)
    ctx.restore();
  }
  // HUD (camHUD): 1280x720 escalado, con su propio zoom desde el centro
  const hz = G.hudZoom, k = DPR * V.s * hz;
  ctx.setTransform(k, 0, 0, k, DPR * (V.ox + V.s * V.w / 2 * (1 - hz)), DPR * (V.oy + V.s * V.h / 2 * (1 - hz)));
  drawStrumsAndNotes();
  drawHUD();
  drawTouchZones();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

let lastFrame = performance.now();
function frame(now) {
  const dt = Math.min(50, now - lastFrame); lastFrame = now;
  try {
    if (!G.paused && !Loader.active && G.chart) update(dt);
    render(dt);
    uiTick();
  } catch (e) { console.error(e); }
  document.body.classList.toggle('cargando', Loader.active);
  requestAnimationFrame(frame);
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
  requestAnimationFrame(frame);
  Loader.reset('Cargando…');
  const [, , , song] = await Promise.all([
    Fonts.load(), loadHudAssets(), loadSounds(),
    /^https?:/.test(location.protocol) ? loadSongById(ASSET_CFG.defaultSongId).catch(e => { console.warn('canción por defecto no válida', e); SongLoad.missing.push('canción por defecto: ' + e.message); return null; }) : null,
  ]).catch(e => { console.warn(e); return []; });
  if (song) {
    if (!params.has('modo')) G.mode = 'keyboard';
    setMode(['demo', 'keyboard', 'mobile', 'botplay'].includes(G.mode) ? G.mode : 'keyboard');
    await loadChart(song.chart, song.audio, { keepLoader: true });
  } else {
    setMode(['demo', 'keyboard', 'mobile', 'botplay'].includes(G.mode) ? G.mode : 'demo');
    await loadChart(Chart.makeDemo(), [], { keepLoader: true });
  }
  if (params.has('pausa')) setTimeout(() => openOverlay('pause'), +params.get('pausa') || 3000);
}
boot();
