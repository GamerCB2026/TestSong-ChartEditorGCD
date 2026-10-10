/* =====================================================================
   personajes.js — personajes V-Slice (Animate Atlas / Sparrow), iconos de
   vida (HealthIcon). v3.7.0: sin dibujos improvisados.

   Volteo (igual que Stage.addCharacter en FunkinCrew/Funkin):
     bf  (jugador)  → flipX = !json.flipX   (bf.json trae flipX:true → se dibuja SIN voltear, mirando a la izquierda)
     dad / gf       → flipX =  json.flipX
   Las direcciones de canto NO se intercambian al voltear (playSingAnimation usa la
   dirección tal cual: singLEFT siempre es singLEFT).
   ===================================================================== */
'use strict';

/* PlayAnimation con "force": la animación se reproduce completa (ni el baile ni el canto la cortan).
   En el código actual de V-Slice (BaseCharacter: ignoreExclusionPref = ['sing']) el canto SÍ puede cortarla;
   pon singRompeForzada: true para imitar eso exactamente. */
const PLAYANIM_CFG = { singRompeForzada: false };

/* ---------- utilidades de dibujo ---------- */
function rr(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h); }
function ell(x, y, rx, ry, fill, stroke, lw) { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.lineWidth = lw; ctx.strokeStyle = stroke; ctx.stroke(); } }
function poly(pts, fill, stroke, lw) { ctx.beginPath(); pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.lineWidth = lw; ctx.strokeStyle = stroke; ctx.lineJoin = 'round'; ctx.stroke(); } }
function limb(pts, color, w, outline = '#120818') {
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const [c, lw] of [[outline, w + 5], [color, w]]) { ctx.beginPath(); pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.strokeStyle = c; ctx.lineWidth = lw; ctx.stroke(); }
}
function text(t, x, y, size, color = '#fff', align = 'center', weight = '900', font = '"Trebuchet MS", "Segoe UI", sans-serif', italic = true) {
  ctx.font = `${italic ? 'italic ' : ''}${weight} ${size}px ${font}`; ctx.textAlign = align; ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(3, size * 0.18); ctx.strokeStyle = '#000'; ctx.strokeText(t, x, y);
  ctx.fillStyle = color; ctx.fillText(t, x, y);
}

/* ---------- Personaje real ---------- */
const NEEDED_ANIM = /^(idle|danceLeft|danceRight|idle-hold|sing(LEFT|DOWN|UP|RIGHT)(miss)?(-[A-Za-z0-9]+)?(-hold)?|hey|cheer|combo\d+|drop\d+)$/;
class RealChar {
  constructor(role, id, data, anims, missing, kind, where) {
    Object.assign(this, { role, id, data, anims, missing, kind, where });
    this.scale = +data.scale || 1; this.isPixel = !!data.isPixel;
    // V-Slice Stage.addCharacter: el jugador se voltea respecto a su JSON
    this.flipX = role === 'bf' ? !data.flipX : !!data.flipX;
    this.offsets = data.offsets || [0, 0]; this.camOff = data.cameraOffsets || [0, 0];
    this.singTime = +data.singTime || 8; this.danceEvery = data.danceEvery ?? 1;
    this.hasLR = anims.has('danceLeft') && anims.has('danceRight'); this.danced = false;
    const refA = anims.get('idle') || anims.get('danceRight') || anims.get('danceLeft') || anims.values().next().value;
    this.ref = RealChar.box(refA, 0) || { minX: 0, minY: 0, maxX: 300, w: 300, h: 400 };
    this.singUntil = -1e9; this.holdUntil = -1e9; this.missTint = false;
    this.reset();
  }
  static box(a, i) {
    if (!a) return null;
    if (a.type === 'atlas') { const b = atlasBounds(a.model, a.timeline, a.frames[i]); return b && { minX: b.minX, minY: b.minY, maxX: b.maxX, w: b.maxX - b.minX, h: b.maxY - b.minY }; }
    const f = a.frames[i]; return f && { minX: 0, minY: 0, maxX: f.fw, w: f.fw, h: f.fh };
  }
  reset() {
    this.singUntil = this.holdUntil = -1e9; this.missTint = false; this.danced = false;
    this.lock = false; this.tempVocals = false; this.finishFired = true; this.idleSuffix = ''; this.altSing = false;
    const st = this.data.startingAnimation;
    this.play(st && this.anims.has(st) ? st : (this.hasLR ? 'danceRight' : 'idle'), true);
  }
  /* Stage.addCharacter: posición = pies (position) - origen (ancho/2, alto) + offsets globales */
  place(sc) {
    this.ts = this.scale * (+sc.scale || 1);
    const eng = this.data && this.data.convertedFrom;            // 'Psych' | 'Codename' | undefined (V-Slice)
    this.engine = eng || 'V-Slice';
    // Codename: el XML dice para qué lado se hizo (isPlayer); si se usa en el otro, los offsets se reflejan (isFlippedOffsets)
    this.mirrorOff = eng === 'Codename' && ((this.role === 'bf') !== !!this.data.cnePlayer);
    if (eng === 'Psych' || eng === 'Codename') {
      // v3.6.0: posición del escenario (esquina superior izquierda en Psych/Codename; en un escenario V-Slice se traduce desde los pies)
      let x = sc.position[0], y = sc.position[1];
      if (!sc.topLeft) { const d = TOPLEFT_TO_FEET[this.role] || TOPLEFT_TO_FEET.dad; x -= d[0]; y -= d[1]; }
      this.engX = x; this.engY = y;
      // Psych: x = escenario + position del JSON · Codename: offset = (volteado ? x : -x, -y) → se dibuja en x ∓ x
      this.bx = x + (this.mirrorOff ? -this.offsets[0] : this.offsets[0]); this.by = y + this.offsets[1];
    } else if (sc.topLeft) {
      // personaje V-Slice en escenario de Psych/Codename: se traslada (las posiciones por defecto coinciden con las de V-Slice)
      const d = TOPLEFT_TO_FEET[this.role] || TOPLEFT_TO_FEET.dad, x = sc.position[0] + d[0], y = sc.position[1] + d[1];
      this.bx = x - this.ref.w * this.ts / 2 + this.offsets[0]; this.by = y - this.ref.h * this.ts + this.offsets[1];
    } else {
      this.bx = sc.position[0] - this.ref.w * this.ts / 2 + this.offsets[0];
      this.by = sc.position[1] - this.ref.h * this.ts + this.offsets[1];
    }
    this.z = sc.zIndex ?? 0; this.stageCam = sc.cameraOffsets || [0, 0]; this.scroll = sc.scroll || [1, 1];
    this.alpha = sc.alpha ?? 1;
  }
  camPoint() {
    const w = this.ref.w * this.ts, h = this.ref.h * this.ts, sc = this.stageCam, co = this.camOff;
    if (this.engine === 'Psych') {
      // Psych PlayState.moveCamera: getMidpoint() ± 100/150 + camera_position (bf: x restado) + camera_<rol> del escenario
      const mx = this.bx + w / 2, my = this.by + h / 2;
      if (this.role === 'bf') return [mx - 100 - co[0] + sc[0], my - 100 + co[1] + sc[1]];
      if (this.role === 'gf') return [mx + co[0] + sc[0], my + co[1] + sc[1]];
      return [mx + 150 + co[0] + sc[0], my - 100 + co[1] + sc[1]];
    }
    if (this.engine === 'Codename') {
      // Codename Character.getCameraPosition: midpoint + (isPlayer ? -100 : 150) + globalOffset + camx/camy (+ camxoffset del escenario)
      const mx = this.engX + w / 2, my = this.engY + h / 2;
      return [mx + (this.role === 'bf' ? -100 : 150) + this.offsets[0] + co[0] + sc[0], my - 100 + this.offsets[1] + co[1] + sc[1]];
    }
    // V-Slice resetCameraFocusPoint: centro + cameraOffsets del personaje + cameraOffsets del escenario
    return [this.bx + w / 2 + co[0] + sc[0], this.by + h / 2 + co[1] + sc[1]];
  }
  /* Bopper.playAnimation(name, restart, ignoreOther): con ignoreOther la animación bloquea a todas las demás
     (canto y baile incluidos) hasta que termina; solo se puede reiniciar la misma. */
  play(name, restart, ignoreOther) {
    if (this.lock && !(this.curName === name && restart) && !(PLAYANIM_CFG.singRompeForzada && name.startsWith('sing'))) return false;
    const a = this.anims.get(name); if (!a) return false;
    if (!restart && this.curName === name && !this.finished()) return true;    // FlxAnimationController.play sin Force
    this.curName = name; this.cur = a; this.t0 = G.gameTime; this.finishFired = false;
    if (ignoreOther) { this.lock = true; this.lockUntil = G.gameTime + this.animMs(a); }
    return true;
  }
  /* v3.5.0: duración de una pasada completa (hasta el último frame; en loop, un ciclo) */
  animMs(a) { return a.frames.length / Math.max(1, a.fps) * 1000; }
  doneOnce() { return G.gameTime - this.t0 >= this.animMs(this.cur); }
  frameIdx() {
    const a = this.cur, n = a.frames.length;
    const i = animFrame(G.gameTime - this.t0, a.fps);
    return a.loop ? ((i % n) + n) % n : clamp(i, 0, n - 1);
  }
  finished() { return !this.cur.loop && (G.gameTime - this.t0) / 1000 * this.cur.fps >= this.cur.frames.length; }
  singing() { return G.gameTime < this.singUntil; }
  isSingAnim() { const n = this.curName || ''; return n.startsWith('sing') && !n.endsWith('-end'); }
  /* BaseCharacter.dance: sin forzar no interrumpe el canto ni una animación especial que no terminó */
  dance(force) {
    if (!force) {
      if (this.singing() && this.isSingAnim()) return;
      const n = this.curName || '';
      if (!n.startsWith('dance') && !n.startsWith('idle') && !(this.finished() || (this.cur && this.cur.loop && this.doneOnce()))) return;
    }
    const sf = this.idleSuffix || '';
    if (this.hasLR) {
      this.danced = !this.danced;
      const n = (this.danced ? 'danceLeft' : 'danceRight');
      if (!this.play(n + sf, true) && sf) this.play(n, true);
    } else if (!this.play('idle' + sf, true) && sf) this.play('idle', true);
  }
  onBeat(beat) {
    if (this.singing() && this.isSingAnim()) return;
    const every = Math.max(1, Math.round(this.danceEvery || 1));
    if (((beat % every) + every) % every === 0) this.dance();
  }
  sing(lane, miss, holdMs, suffix = '') {
    if (this.lock && !PLAYANIM_CFG.singRompeForzada) return; // PlayAnimation forzada en curso: no canta hasta que termine
    const dir = LANE_DIRS[lane]; let n = 'sing' + dir + (miss ? 'miss' : '');   // sin intercambio LEFT/RIGHT (igual que el juego)
    this.missTint = false;
    if (!suffix && this.altSing) suffix = '-alt';          // Codename "Alt Animation Toggle"
    // note kind con sufijo (alt → singLEFT-alt): si el personaje no la tiene, canta la normal
    if (suffix && this.anims.has(n + suffix)) n += suffix;
    else if (!this.anims.has(n)) { if (miss) this.missTint = true; n = 'sing' + dir; }
    if (!this.play(n, true)) { this.play(this.hasLR ? 'danceRight' : 'idle', true); }
    const step = Cond.stepMs(G.songPos);
    this.holdUntil = G.gameTime + holdMs;
    this.singUntil = G.gameTime + holdMs + this.singTime * step * (miss ? 2 : 1);
  }
  /* evento PlayAnimation (PlayAnimationSongEvent): tempVocals = force.
     v3.5.0: SIEMPRE completa (canto y baile bloqueados hasta el último frame; loop = un ciclo).
     PLAYANIM_CFG.singRompeForzada = true deja que el canto la corte. */
  playEvent(name, force) {
    if (!this.anims.has(name)) return false;
    this.tempVocals = !!force;
    if (this.tempVocals) {
      const r = this.role === 'bf' ? 'player' : this.role === 'dad' ? 'opponent' : null;
      if (r && Music.getVolume(r) === 0) Music.setVolume(r, 1); else this.tempVocals = false;
    }
    // v3.5.0: la animación de PlayAnimation SIEMPRE se reproduce completa (con o sin force):
    // canto y baile esperan hasta su último frame; si es en loop, un ciclo completo
    const ok = this.play(name, !!force || this.curName !== name || this.finished(), true);
    if (ok) { this.singUntil = -1e9; this.holdUntil = -1e9; }
    return ok;
  }
  /* animaciones de GF (combo/drop) y especiales de note kinds: sin bloqueo; el baile espera a que terminen */
  special(name) { if (this.anims.has(name)) { this.play(name, true); this.singUntil = -1e9; return true; } return false; }
  holdOn() { if (this.lock && !PLAYANIM_CFG.singRompeForzada) return; this.holdUntil = Math.max(this.holdUntil, G.gameTime + 60); this.singUntil = Math.max(this.singUntil, G.gameTime + this.singTime * Cond.stepMs(G.songPos)); }
  /* Bopper/BaseCharacter.onAnimationFinished */
  onFinished(name) {
    this.lock = false;
    if ((name.endsWith('-end') && !name.startsWith('idle') && !name.startsWith('dance')) || name.startsWith('combo') || name.startsWith('drop')) this.dance(true);
    if (this.tempVocals) {
      const r = this.role === 'bf' ? 'player' : this.role === 'dad' ? 'opponent' : null;
      if (r && Music.getVolume(r) === 1) Music.setVolume(r, 0);
      this.tempVocals = false;
    }
  }
  update() {
    if (!this.cur) return;
    if (!this.finishFired && (this.finished() || (this.lock && this.cur.loop && this.doneOnce()))) { this.finishFired = true; this.onFinished(this.curName); }
    if (this.lock) return;
    if (this.curName.startsWith('sing') && !this.singing()) { this.missTint = false; this.dance(true); return; }
    // al terminar una animación pasa a "<anim>-hold" en loop si existe (sustain del canto, poses de Darnell…)
    if (this.finished() && !this.curName.endsWith('-hold') && this.anims.has(this.curName + '-hold') && (!this.curName.startsWith('sing') || G.gameTime < this.holdUntil)) this.play(this.curName + '-hold', true);
    else if (G.gameTime >= this.holdUntil && this.curName.startsWith('sing') && this.curName.endsWith('-hold')) this.play(this.curName.replace(/-hold$/, ''), false);
  }
  /* M = matriz mundo -> píxeles del canvas; R = destino (render.js: Canvas o WebGL) */
  draw(M, R) {
    const a = this.cur; if (!a || this.visible === false) return;
    const fr = a.frames[this.frameIdx()], s = this.ts, flip = this.flipX !== !!a.flipX, off0 = a.off || [0, 0], off = this.mirrorOff ? [-off0[0], off0[1]] : off0;
    const alpha = this.alpha ?? 1, smooth = !this.isPixel && Optim.s.aa, tint = !!this.missTint, m = _charM;
    // v3.5.0: shader del personaje puesto por el script del escenario (AdjustColor / DropShadow…)
    const sh = this.shader || null; R.setShader(sh);
    if (sh && sh.updateFrameInfo && fr) sh.angleOffset = fr.rot ? -90 : 0;
    try { this.drawInner(a, fr, s, flip, off, alpha, smooth, tint, m, M, R); } finally { if (sh) R.setShader(null); }
  }
  drawInner(a, fr, s, flip, off, alpha, smooth, tint, m, M, R) {
    if (a.type === 'atlas') {
      mmul(m, M, mset(_charL, flip ? -s : s, 0, 0, s, this.bx - off[0] + (flip ? this.ref.maxX * s : -this.ref.minX * s), this.by - off[1] - this.ref.minY * s));
      atlasDibujarR(R, a.model, a.timeline, fr, m, alpha, smooth, tint);
    } else if (fr) {
      const rx = flip ? (fr.fw - fr.offX - fr.dw) : fr.offX;
      mmul(m, M, mset(_charL, flip ? -s : s, 0, 0, s, this.bx + rx * s - off[0] + (flip ? fr.dw * s : 0), this.by + fr.offY * s - off[1]));
      if (fr.rot) mmul(m, m, mset(_charL, 0, -1, 1, 0, 0, fr.dh));
      R.img(fr.img, fr.x, fr.y, fr.w, fr.h, m, alpha, smooth, tint, this.rgb);
    }
  }
}
const TOPLEFT_TO_FEET = { bf: [219.5, 785], dad: [235, 785], gf: [351.5, 657] };   // Psych (770,100) → V-Slice (989.5,885)…
const _charM = [1, 0, 0, 1, 0, 0], _charL = [1, 0, 0, 1, 0, 0];
/* frame de una animación según Optimización → Animaciones (normal / reducida a 12 fps / estática) */
function animFrame(ms, fps) {
  const mode = Optim.s.anim;
  if (mode === 'estatica') return 0;
  if (mode === 'reducida' && fps > 12) { const q = Math.floor(ms / 1000 * 12) / 12; return Math.floor(q * fps + 1e-6); }
  return Math.floor(ms / 1000 * fps);
}

/* v3.4.0: personaje de Psych Engine (image, animations[{anim,name,fps,loop,indices,offsets}], flip_x…) → formato V-Slice */
function normalizeCharData(d) {
  if (!d || typeof d !== 'object' || !Array.isArray(d.animations)) return d;
  const psych = typeof d.image === 'string' && d.animations.some(a => a && a.anim !== undefined);
  if (!psych) return d;
  return {
    name: d.name || d.image, renderType: /^characters\/.*\/$/.test(d.image) ? 'animateatlas' : 'sparrow', assetPath: String(d.image).split(',')[0].trim(),
    scale: +d.scale || 1, flipX: !!d.flip_x, isPixel: !!d.no_antialiasing, singTime: (+d.sing_duration || 4) * 2,
    healthIcon: { id: d.healthicon || 'face' }, healthbar_colors: d.healthbar_colors,
    offsets: Array.isArray(d.position) ? d.position : [0, 0], cameraOffsets: Array.isArray(d.camera_position) ? d.camera_position : [0, 0],
    animations: d.animations.map(a => ({ name: a.anim, prefix: a.name, frameRate: +a.fps || 24, looped: !!a.loop, frameIndices: Array.isArray(a.indices) && a.indices.length ? a.indices : undefined, offsets: a.offsets || [0, 0] })),
    convertedFrom: 'Psych',
  };
}
async function loadCharacter(role, id) {
  const dj = await fetchFirst(ASSET_CFG.charDataPaths.map(t => fillT(t, { id }))) || await EngineData.findChar(id).catch(() => null);   // v3.5.0: + XML de Codename
  const data = normalizeCharData(dj ? dj.data : DEFAULT_DATA.characters[id]);
  if (!data) return { error: `no hay data/characters/${id}.json` };
  const mainAp = data.assetPath || `characters/${id}`;
  const main = await loadGraphic(parseAssetPath(mainAp), data.renderType);
  if (!main) return { error: `no encontré ${fillT(ASSET_CFG.libImagePaths[0], parseAssetPath(mainAp))}/ (Animation.json+spritemap) ni .xml/.png`, data, dataFrom: dj ? dj.path : 'incluido' };
  const extra = {}, anims = new Map(), missing = [];
  for (const a of data.animations || []) {
    // se cargan todas las animaciones del atlas principal (PlayAnimation puede pedir cualquiera);
    // las que usan otro atlas (muerte, fake out) solo si el juego las necesita aquí
    if (!NEEDED_ANIM.test(a.name) && a.assetPath && a.assetPath !== mainAp) continue;
    let g = main;
    if (a.assetPath && a.assetPath !== mainAp) {
      if (!(a.assetPath in extra)) extra[a.assetPath] = await loadGraphic(parseAssetPath(a.assetPath), a.renderType || data.renderType);
      g = extra[a.assetPath];
    }
    const base = { name: a.name, fps: +a.frameRate || 24, loop: !!a.looped, off: a.offsets || [0, 0], flipX: !!a.flipX };
    if (g && g.type === 'atlas') {
      const r = atlasBuscarAnimacion(g.model, { prefijo: a.prefix, indices: a.frameIndices || [], animType: a.animType });
      if (r && r.frames.length) { anims.set(a.name, Object.assign(base, { type: 'atlas', model: g.model, timeline: r.timeline, frames: r.frames })); continue; }
    } else if (g) {
      const fr = sparrowFrames(g.atlas, a.prefix || '', a.frameIndices, g.img);
      if (fr.length) { anims.set(a.name, Object.assign(base, { type: 'sparrow', frames: fr })); continue; }
    }
    missing.push(a.name);
  }
  if (!anims.size) return { error: 'ninguna animación del JSON coincide con el atlas', data };
  // v3.3.0: de las hojas enormes (8192x4096…) solo quedan en memoria los frames que se usan
  const objs = [];
  for (const a of anims.values()) { if (a.type === 'atlas') objs.push(...a.model.sprites.values()); else objs.push(...a.frames); }
  await TexLoad.cropFrames(uniq(objs));
  const ch = new RealChar(role, id, data, anims, missing, main.type, main.where);
  ch.dataFrom = dj ? dj.path : '(JSON incluido en js/assets.js)';
  return ch;
}

/* =====================================================================
   HealthIcon (components/HealthIcon.hx)
   - legacy: icon-<id>.png con frames de 150x150 (0 = normal, 1 = perdiendo, 2 = ganando)
   - nuevo:  icon-<id>.xml + icon-<id>.png (Sparrow) con idle / winning / losing /
             toWinning / toLosing / fromWinning / fromLosing
   Se busca en images/icons/ (como el juego), shared/images/icons/ y en una
   carpeta icon-<id>/ (icon-<id>/icon-<id>.xml|png).
   ===================================================================== */
const ICON_ANIMS = ['idle', 'winning', 'losing', 'toWinning', 'toLosing', 'fromWinning', 'fromLosing'];
class HealthIcon {
  constructor(playerId) { this.playerId = playerId; this.anims = new Map(); this.kind = 'sin icono'; this.reset(); }
  reset() { this.cur = 'idle'; this.t0 = 0; this.bopAt = -1e9; }
  async load(charId, hi) {
    hi = hi || {};
    this.id = hi.id || charId || 'face';
    this.size = +hi.scale || 1; this.isPixel = !!hi.isPixel; this.offsets = Array.isArray(hi.offsets) ? hi.offsets : [0, 0];
    this.flipX = !!hi.flipX; if (this.playerId === 0) this.flipX = !this.flipX;   // initHealthIcon: "BF is looking the other way"
    this.anims = new Map(); this.kind = 'sin icono'; this.where = null; this.wanted = this.id; this.fallbackFace = false;
    this.shouldBop = hi.shouldBop !== false;
    // sin icono propio → icon-face (Constants.DEFAULT_HEALTH_ICON), como el juego
    for (const id of uniq([this.id, 'face'])) {
      if (id === 'face' && this.id !== 'face') this.fallbackFace = true;
      const bases = []; for (const d of ASSET_CFG.iconDirs) bases.push(`${d}icon-${id}`, `${d}icon-${id}/icon-${id}`);
      const sheet = await loadSparrowSheet(bases);
      if (sheet) {
        for (const n of ICON_ANIMS) { const fr = sparrowFrames(sheet.atlas, n, null, sheet.img).filter(f => !ICON_ANIMS.some(o => o !== n && o.startsWith(n) && f.nombre.startsWith(o))); if (fr.length) this.anims.set(n, { frames: fr, loop: !/^(to|from)/.test(n) }); }
        if (!this.anims.size) { const fr = sheet.atlas.frames.map(f => Object.assign({}, f, { img: sheet.img })); this.anims.set('idle', { frames: fr, loop: true }); }
        this.kind = 'animado (Sparrow)'; this.where = sheet.where + '.xml'; break;
      }
      const img = await loadImg(bases.map(b => b + '.png'));
      if (img) {
        const fs = this.isPixel ? 32 : FNF.ICON_SIZE, iw = img.naturalWidth, ih = img.naturalHeight;
        const grid = (iw % fs === 0 && ih % fs === 0) ? fs : ih;            // frames de 150x150 (o cuadrados del alto)
        const cols = Math.max(1, Math.floor(iw / grid)), n = cols * Math.max(1, Math.floor(ih / grid));
        const frame = i => ({ img, x: (i % cols) * grid, y: Math.floor(i / cols) * grid, w: grid, h: grid, fw: grid, fh: grid, offX: 0, offY: 0, dw: grid, dh: grid, rot: false });
        this.anims.set('idle', { frames: [frame(0)], loop: true });
        if (n >= 2) this.anims.set('losing', { frames: [frame(1)], loop: true });
        if (n >= 3) this.anims.set('winning', { frames: [frame(2)], loop: true });
        this.kind = `legacy (${n} frame${n > 1 ? 's' : ''} de ${grid}px)`; this.where = img.assetPath; break;
      }
    }
    if (!this.anims.size) this.fallbackFace = false;
    this.reset();
    return this;
  }
  get ok() { return this.anims.size > 0; }
  play(name, fallback, restart) {
    let n = this.anims.has(name) ? name : (fallback && this.anims.has(fallback) ? fallback : null);
    if (!n) return;
    if (n !== this.cur || restart) { this.cur = n; this.t0 = G.gameTime; }
  }
  finished() { const a = this.anims.get(this.cur); return !a || a.loop || (G.gameTime - this.t0) / 1000 * 24 >= a.frames.length; }
  /* updateHealthIcon: máquina de estados del juego */
  updateAnim(health) {
    const WIN = FNF.ICON_WINNING, LOSE = FNF.ICON_LOSING;
    switch (this.cur) {
      case 'idle': if (health < LOSE) this.play('toLosing', 'losing'); else if (health > WIN) this.play('toWinning', 'winning'); else this.play('idle'); break;
      case 'winning': if (health < WIN) this.play('fromWinning', 'idle'); else this.play('winning', 'idle'); break;
      case 'losing': if (health > LOSE) this.play('fromLosing', 'idle'); else this.play('losing', 'idle'); break;
      case 'toLosing': if (this.finished()) this.play('losing', 'idle'); break;
      case 'toWinning': if (this.finished()) this.play('winning', 'idle'); break;
      case 'fromLosing': case 'fromWinning': if (this.finished()) this.play('idle'); break;
      default: this.play('idle');
    }
  }
  frame() {
    const a = this.anims.get(this.cur) || this.anims.get('idle'); if (!a) return null;
    const i = Math.floor((G.gameTime - this.t0) / 1000 * 24);
    return a.frames[a.loop ? i % a.frames.length : Math.min(i, a.frames.length - 1)];
  }
  /* ancho objetivo en px del HUD (setGraphicSize) incluyendo el "bop" */
  targetSize() {
    const fr = this.frame(), base = FNF.ICON_SIZE * this.size;
    const fw = fr ? fr.fw : 150, fh = fr ? fr.fh : 150;
    const tween = Math.min(Cond.stepMs(G.songPos) * 0.002, 0.175) * 1000, k = clamp((G.gameTime - this.bopAt) / tween, 0, 1);
    const bop = fw >= fh ? base * FNF.ICON_BOP_SCALE * (1 - k) : 0;
    const w = fw >= fh ? base + bop : (base * fw / fh) * (1 + FNF.ICON_BOP_SCALE * (1 - k));
    return { w, h: w * fh / fw };
  }
  bop() { this.bopAt = G.gameTime; }
  /* Dibuja con esquina (x,y) en px del HUD */
  draw(x, y, w, h, losing) {
    const fr = this.frame();
    ctx.save();
    ctx.translate(x + this.offsets[0] + (this.flipX ? w : 0), y + this.offsets[1]);
    if (this.flipX) ctx.scale(-1, 1);
    if (fr) { ctx.imageSmoothingEnabled = !this.isPixel; drawSparrowFrame(ctx, fr, 0, 0, w / fr.fw, h / fr.fh); }   // sin icono (ni icon-face): nada
    ctx.restore();
  }
}

/* v3.7.0: se quitaron el icono improvisado (vector) y los personajes improvisados: sin asset real no se dibuja nada */
