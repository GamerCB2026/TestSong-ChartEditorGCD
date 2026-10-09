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
    if (c.error && ids[role] !== role && ASSET_CFG.chars[role] !== ids[role]) {   // id del chart sin assets -> el personaje por defecto
      const c2 = await loadCharacter(role, ASSET_CFG.chars[role]); if (!c2.error) { c2.fallbackFrom = ids[role]; c = c2; }
    }
    return c;
  };
  const [stage, bf, dad, gf, notes] = await Promise.all([
    loadStage(ids.stage).then(s => s || (ids.stage !== ASSET_CFG.stage ? loadStage(ASSET_CFG.stage) : null)),
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
  Scene.icons = { player: iP1, opponent: iP2 };
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
  st.push(`${notes.ok ? '✔' : '✘'} notas: ${notes.head.filter(Boolean).length}/4 cabezas, ${notes.piece.filter(Boolean).length}/4 hold piece, ${notes.end.filter(Boolean).length}/4 hold end`);
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
  out.push(Music.has ? `✔ música de la canción (${Music.tracks.length} pista/s)` : '✘ música de la canción: no hay Inst/Voices (demo sin audio)');
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
  lastBeat: -999, hudZoom: 1,
};
const isBot = () => G.mode === 'demo' || G.mode === 'botplay';

function loadChart(chart, audioBlobs = []) {
  G.chart = chart;
  loadScene(chart.scene || {});
  Music.set(audioBlobs);
  restart();
  if (Music.has && !params.has('t')) openOverlay('ready');
}

function restart() {
  const c = G.chart;
  c.notes.forEach(n => { n.judged = n.hit = n.missed = n.holding = n.dropped = false; });
  Music.pause(); Music.started = false;
  G.songPos = params.has('t') && G.gameTime === 0 ? +params.get('t') : -c.crochet * 5;   // Countdown.hx: empieza 5 beats antes
  G.health = G.healthLerp = FNF.HEALTH_START;
  G.score = G.misses = G.combo = G.judged = G.accSum = 0;
  G.lastBeat = Math.floor(G.songPos / c.crochet); G.hudZoom = 1; Cam.bop = 1;
  Popups.length = 0; Splashes.length = 0;
  for (const ch of [G.dad, G.bf]) { ch.pose = 'idle'; ch.poseUntil = -1e9; ch.miss = false; }
  for (const ch of Object.values(Scene.chars)) if (ch) ch.reset();
  for (const ic of Object.values(Scene.icons)) if (ic) ic.reset();
  Cam.init = false; Scene.focus = 'dad';
  for (const s of Object.values(G.strums)) { s.confirmAt.fill(-1e9); s.hold.fill(0); }
  G.strums.player.pressed.fill(false); G.strums.player.confirmHeld.fill(false);
  closeOverlay(true);
}

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
  if (n.side === 'player') s.confirmHeld[n.lane] = true;
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
  if (beat % FNF.ZOOM_RATE === 0 && G.hudZoom < 1.35) { Cam.bop = FNF.BOP_INTENSITY; G.hudZoom += FNF.HUD_BOP; }
  if (beat >= -4 && beat <= -1) Sfx.play('count' + (beat + 4), FNF.COUNTDOWN_VOLUME);   // introTHREE/TWO/ONE/GO
}

function update(dt) {
  const c = G.chart;
  G.gameTime += dt;
  G.songPos += dt;
  if (Music.has) {
    if (!Music.started && G.songPos >= 0) Music.play(G.songPos);
    else if (Music.playing) { const t = Music.time(); if (Math.abs(t - G.songPos) > 45) G.songPos = t; }
  }
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
    if (!focusSet) { focusSet = true; if (diff < c.crochet * 2 && G.songPos >= 0) Scene.focus = n.side === 'player' ? 'bf' : 'dad'; }
    if (n.side === 'opponent') { if (diff <= 0) hitNote(n, 0); continue; }
    if (isBot() && diff <= 0) {
      if (G.mode === 'demo' && demoShouldMiss(n)) { /* deja pasar la nota */ }
      else { hitNote(n, 0); continue; }
    }
    if (diff < -FNF.HIT_WINDOW_MS) missNote(n);
  }
  for (const [ic, hp] of [[Scene.icons.player, G.health], [Scene.icons.opponent, FNF.HEALTH_MAX - G.health]]) if (ic) ic.updateAnim(hp);
  updatePopups(dt);

  const end = Math.max(c.endTime, Music.duration);
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
    const down = CONFIG.downscroll === true, sy = down ? V.h - NOTE_W - FNF.STRUMLINE_Y_OFFSET : FNF.STRUMLINE_Y_OFFSET;
    Object.assign(LAYOUT.opponent, { x: FNF.STRUMLINE_X_OFFSET, y: sy, k: 1, spacing: 1, down });
    Object.assign(LAYOUT.player, { x: V.w / 2 + FNF.STRUMLINE_X_OFFSET, y: sy, k: 1, spacing: 1, down });
    Object.assign(LAYOUT.bar, { x: (V.w - FNF.HEALTH_BAR_W) / 2, y: down ? V.h * 0.1 : V.h * 0.9 });
  } else {
    // celular vertical: rival en mini arriba, jugador grande abajo (como el modo móvil del juego)
    V.w = 720; V.s = W / V.w; V.h = H / V.s; V.ox = 0; V.oy = 0;
    const center = k => V.w / 2 - (FNF.INITIAL_OFFSET + 1.5 * FNF.NOTE_SPACING) * k - NOTE_W * k / 2;
    const ko = 0.55, kp = Math.min(1.3, (V.w - 40) / (4 * FNF.NOTE_SPACING));
    const down = CONFIG.downscroll !== false;
    Object.assign(LAYOUT.opponent, { x: center(ko), y: FNF.STRUMLINE_Y_OFFSET + 10, k: ko, spacing: 1, down: false });
    Object.assign(LAYOUT.player, { x: center(kp), y: down ? V.h - NOTE_W * kp - FNF.STRUMLINE_Y_OFFSET - 40 : V.h * 0.62, k: kp, spacing: 1, down });
    Object.assign(LAYOUT.bar, { x: (V.w - FNF.HEALTH_BAR_W) / 2, y: FNF.STRUMLINE_Y_OFFSET + NOTE_W * ko + 70 });
    Object.assign(LAYOUT.clip, { oppBottom: V.h * 0.6, playerTop: LAYOUT.bar.y + 110 });
  }
  Object.assign(LAYOUT.popup, { rx: V.w * 0.474, ry: (portrait ? V.h * 0.42 : V.h * 0.45) - 60, nx: V.w * 0.507, ny: portrait ? V.h * 0.41 : V.h * 0.44 });
  improvLayout();
}
window.addEventListener('resize', resize);

/* ---------- render ---------- */
const beatPos = () => G.songPos / G.chart.crochet;
const beatFrac = () => { const b = beatPos(); return b - Math.floor(b); };
const bob = () => Math.pow(1 - beatFrac(), 3);        // 1 justo en el beat → 0

function render(dt = 16) {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
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
  if (!G.paused) update(dt);
  render(dt);
  uiTick();
  requestAnimationFrame(frame);
}

/* Carga automática: si existe song-chart.json (+ song-metadata.json, Inst.ogg, Voices.ogg) junto al index, se usa ese chart */
async function autoLoad() {
  if (!/^https?:/.test(location.protocol)) return false;
  const chartList = params.get('chart') ? [params.get('chart')] : ASSET_CFG.defaultSong.chart;
  const r = await fetchFirst(chartList);
  if (!r) return false;
  try {
    const metaR = await fetchFirst(params.get('meta') ? [params.get('meta')] : ASSET_CFG.defaultSong.meta);
    const blobs = [];
    const inst = await fetchFirst(ASSET_CFG.defaultSong.inst.flatMap(b => [b + '.ogg', b + '.mp3']), 'blob');
    if (inst) { blobs.push(inst.data); const v = await fetchFirst(ASSET_CFG.defaultSong.voices.flatMap(b => [b + '.ogg', b + '.mp3']), 'blob'); if (v) blobs.push(v.data); }
    G.raw = r.data; G.meta = metaR ? metaR.data : null; G.mode = params.get('modo') || 'keyboard';
    loadChart(Chart.parse(G.raw, G.meta), blobs);
    openOverlay('ready');
    return true;
  } catch (e) { console.warn('song-chart.json no válido, usando demo', e); return false; }
}

/* API pública para el Chart Editor GCD */
window.GCDPlay = {
  loadChart(raw, meta, audioBlobs = []) { G.raw = raw; G.meta = meta; loadChart(Chart.parse(raw, meta), audioBlobs); },
  restart, pause: () => openOverlay('pause'), resume: () => closeOverlay(), setMode, state: G, scene: Scene, layout: LAYOUT,
  reloadAssets: ids => { Scene.ids = null; Scene.notes = null; return loadScene(ids); },
  status: statusLines,
};
window.addEventListener('message', e => {
  const d = e.data;
  if (d && d.type === 'gcd-chart' && d.chart) { try { window.GCDPlay.loadChart(d.chart, d.meta || null); openOverlay('ready'); } catch (err) { toast('Chart inválido: ' + err.message); } }
});

/* ---------- inicio: se dibuja de inmediato (escenario, personajes, strums, barra, iconos) ---------- */
resize();
setMode(['demo', 'keyboard', 'mobile', 'botplay'].includes(G.mode) ? G.mode : 'demo');
loadChart(Chart.makeDemo());
Promise.all([Fonts.load(), loadHudAssets(), loadSounds()]).catch(e => console.warn(e));
autoLoad();
if (params.has('pausa')) setTimeout(() => openOverlay('pause'), +params.get('pausa') || 3000);
requestAnimationFrame(frame);
