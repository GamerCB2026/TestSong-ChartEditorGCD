/* =====================================================================
   personajes.js — personajes V-Slice (Animate Atlas / Sparrow), iconos de
   vida (HealthIcon) y dibujos improvisados de respaldo.

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
    this.bx = sc.position[0] - this.ref.w * this.ts / 2 + this.offsets[0];
    this.by = sc.position[1] - this.ref.h * this.ts + this.offsets[1];
    this.z = sc.zIndex ?? 0; this.stageCam = sc.cameraOffsets || [0, 0]; this.scroll = sc.scroll || [1, 1];
    this.alpha = sc.alpha ?? 1;
  }
  camPoint() {   // resetCameraFocusPoint: centro + cameraOffsets del personaje + cameraOffsets del escenario
    return [this.bx + this.ref.w * this.ts / 2 + this.camOff[0] + this.stageCam[0], this.by + this.ref.h * this.ts / 2 + this.camOff[1] + this.stageCam[1]];
  }
  /* Bopper.playAnimation(name, restart, ignoreOther): con ignoreOther la animación bloquea a todas las demás
     (canto y baile incluidos) hasta que termina; solo se puede reiniciar la misma. */
  play(name, restart, ignoreOther) {
    if (this.lock && !(this.curName === name && restart) && !(PLAYANIM_CFG.singRompeForzada && name.startsWith('sing'))) return false;
    const a = this.anims.get(name); if (!a) return false;
    if (!restart && this.curName === name && !this.finished()) return true;    // FlxAnimationController.play sin Force
    this.curName = name; this.cur = a; this.t0 = G.gameTime; this.finishFired = false;
    if (ignoreOther) this.lock = true;
    return true;
  }
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
      if (!n.startsWith('dance') && !n.startsWith('idle') && !this.finished()) return;
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
  /* evento PlayAnimation (PlayAnimationSongEvent): tempVocals = force; playAnimation(anim, force, force).
     Con force la animación se reproduce COMPLETA: ni el baile ni el canto la interrumpen hasta que termina.
     Sin force: el canto puede interrumpirla, pero el baile espera a que termine. */
  playEvent(name, force) {
    if (!this.anims.has(name)) return false;
    this.tempVocals = !!force;
    if (this.tempVocals) {
      const r = this.role === 'bf' ? 'player' : this.role === 'dad' ? 'opponent' : null;
      if (r && Music.getVolume(r) === 0) Music.setVolume(r, 1); else this.tempVocals = false;
    }
    const ok = this.play(name, !!force, !!force);
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
    if (!this.finishFired && this.finished()) { this.finishFired = true; this.onFinished(this.curName); }
    if (this.lock) return;
    if (this.curName.startsWith('sing') && !this.singing()) { this.missTint = false; this.dance(true); return; }
    // al terminar una animación pasa a "<anim>-hold" en loop si existe (sustain del canto, poses de Darnell…)
    if (this.finished() && !this.curName.endsWith('-hold') && this.anims.has(this.curName + '-hold') && (!this.curName.startsWith('sing') || G.gameTime < this.holdUntil)) this.play(this.curName + '-hold', true);
    else if (G.gameTime >= this.holdUntil && this.curName.startsWith('sing') && this.curName.endsWith('-hold')) this.play(this.curName.replace(/-hold$/, ''), false);
  }
  /* M = matriz mundo -> píxeles del canvas; R = destino (render.js: Canvas o WebGL) */
  draw(M, R) {
    const a = this.cur; if (!a || this.visible === false) return;
    const fr = a.frames[this.frameIdx()], s = this.ts, flip = this.flipX !== !!a.flipX, off = a.off || [0, 0];
    const alpha = this.alpha ?? 1, smooth = !this.isPixel && Optim.s.aa, tint = !!this.missTint, m = _charM;
    if (a.type === 'atlas') {
      mmul(m, M, mset(_charL, flip ? -s : s, 0, 0, s, this.bx - off[0] + (flip ? this.ref.maxX * s : -this.ref.minX * s), this.by - off[1] - this.ref.minY * s));
      atlasDibujarR(R, a.model, a.timeline, fr, m, alpha, smooth, tint);
    } else if (fr) {
      const rx = flip ? (fr.fw - fr.offX - fr.dw) : fr.offX;
      mmul(m, M, mset(_charL, flip ? -s : s, 0, 0, s, this.bx + rx * s - off[0] + (flip ? fr.dw * s : 0), this.by + fr.offY * s - off[1]));
      if (fr.rot) mmul(m, m, mset(_charL, 0, -1, 1, 0, 0, fr.dh));
      R.img(fr.img, fr.x, fr.y, fr.w, fr.h, m, alpha, smooth, tint);
    }
  }
}
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
  const dj = await fetchFirst(ASSET_CFG.charDataPaths.map(t => fillT(t, { id })));
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
  constructor(playerId) { this.playerId = playerId; this.anims = new Map(); this.kind = 'improvisado'; this.reset(); }
  reset() { this.cur = 'idle'; this.t0 = 0; this.bopAt = -1e9; }
  async load(charId, hi) {
    hi = hi || {};
    this.id = hi.id || charId || 'face';
    this.size = +hi.scale || 1; this.isPixel = !!hi.isPixel; this.offsets = Array.isArray(hi.offsets) ? hi.offsets : [0, 0];
    this.flipX = !!hi.flipX; if (this.playerId === 0) this.flipX = !this.flipX;   // initHealthIcon: "BF is looking the other way"
    this.anims = new Map(); this.kind = 'improvisado'; this.where = null; this.wanted = this.id; this.fallbackFace = false;
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
    if (fr) { ctx.imageSmoothingEnabled = !this.isPixel; drawSparrowFrame(ctx, fr, 0, 0, w / fr.fw, h / fr.fh); }
    else drawImprovIcon(this.playerId === 0 ? 'player' : 'opponent', w / 2, h / 2, w * 0.69, losing, this.flipX);
    ctx.restore();
  }
}

/* --- Icono improvisado (vector) --- */
function drawImprovIcon(side, cx, cy, size, losing, flipped) {
  ctx.save(); ctx.translate(cx, cy); ctx.scale(size / 100, size / 100);
  if (side === 'player' && flipped) ctx.scale(-1, 1);   // el dibujo ya mira a la izquierda
  const O = '#0b0b18';
  if (side === 'player') {
    poly([[-18, -22], [-46, -16], [-30, -4], [-48, 10], [-24, 10], [-38, 26], [-10, 18]], '#2ec7e6', O, 5);
    ell(0, 4, 34, 34, '#ffe1c4', O, 6);
    ctx.beginPath(); ctx.moveTo(-33, -6); ctx.quadraticCurveTo(-28, -44, 2, -42); ctx.quadraticCurveTo(32, -40, 34, -10); ctx.closePath();
    ctx.fillStyle = '#e3312f'; ctx.fill(); ctx.lineWidth = 5; ctx.strokeStyle = O; ctx.stroke();
    poly([[-34, -10], [-58, -4], [-56, 3], [-30, -2]], '#2f5fd0', O, 4);   // visera hacia el rival (izquierda)
    ell(-12, 6, 5, 9, '#111'); ell(4, 6, 4.5, 9, '#111');
    if (losing) { ctx.beginPath(); ctx.arc(-4, 30, 9, Math.PI + 0.3, -0.3); ctx.lineWidth = 4; ctx.stroke(); ell(24, -6, 5, 8, '#7fd8ff', O, 2); }
    else { ctx.beginPath(); ctx.arc(-4, 18, 10, 0.2, Math.PI - 0.2); ctx.lineWidth = 4; ctx.stroke(); }
  } else {
    ctx.beginPath(); ctx.moveTo(-36, -18); ctx.quadraticCurveTo(-44, 20, -34, 46); ctx.lineTo(34, 46); ctx.quadraticCurveTo(44, 20, 36, -18); ctx.closePath();
    ctx.fillStyle = '#0d0710'; ctx.fill(); ctx.lineWidth = 5; ctx.strokeStyle = O; ctx.stroke();
    ell(0, 6, 30, 36, '#f3d6b8', O, 6);
    ctx.beginPath(); ctx.moveTo(-34, -10); ctx.quadraticCurveTo(-10, -56, 34, -14); ctx.quadraticCurveTo(14, -24, 0, -16); ctx.quadraticCurveTo(-16, -24, -34, -10); ctx.closePath();
    ctx.fillStyle = '#0d0710'; ctx.fill(); ctx.stroke();
    ell(-11, 4, 6, losing ? 3 : 7, '#fff', O, 2.5); ell(11, 4, 6, losing ? 3 : 7, '#fff', O, 2.5);
    ell(-10, 5, 3, losing ? 2 : 3.5, '#d10f2f'); ell(12, 5, 3, losing ? 2 : 3.5, '#d10f2f');
    ctx.lineWidth = 4; ctx.strokeStyle = O; ctx.beginPath();
    if (losing) { ctx.moveTo(-20, -10); ctx.lineTo(-4, -4); ctx.moveTo(20, -10); ctx.lineTo(4, -4); ctx.stroke(); ctx.beginPath(); ctx.arc(0, 32, 9, Math.PI + 0.3, -0.3); ctx.stroke(); }
    else { ctx.moveTo(-20, -6); ctx.lineTo(-4, -10); ctx.moveTo(20, -6); ctx.lineTo(4, -10); ctx.stroke(); ctx.beginPath(); ctx.moveTo(-12, 24); ctx.quadraticCurveTo(2, 34, 14, 20); ctx.stroke(); }
  }
  ctx.restore();
}

/* --- Personajes improvisados (coordenadas locales: pies en y=0, mirando a +x) --- */
function armTarget(pose, base) {
  const t = { idle: base.idle, left: base.fwd, right: base.fwd, up: base.up, down: base.down }[pose] || base.idle;
  return t;
}
function drawRival(ch) {
  const O = '#120818', SK = '#f3d6b8', J = '#7b3fb8';
  const singing = ch.pose !== 'idle';
  // brazo trasero
  limb([[-20, -142], [-30, -112], [-30, -84]], '#5a2d8c', 13, O);
  // piernas
  ctx.lineWidth = 3; ctx.strokeStyle = O;
  rr(-20, -78, 15, 74, 4); ctx.fillStyle = '#2b1d44'; ctx.fill(); ctx.stroke();
  rr(5, -78, 15, 74, 4); ctx.fill(); ctx.stroke();
  ell(-10, -4, 15, 6, '#111', O, 2); ell(16, -4, 15, 6, '#111', O, 2);
  // torso
  rr(-31, -154, 62, 86, 12); ctx.fillStyle = J; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = O; ctx.stroke();
  poly([[-11, -153], [11, -153], [0, -116]], '#fff');
  poly([[-3, -148], [3, -148], [5, -122], [0, -114], [-5, -122]], '#d81b3a');
  ctx.fillStyle = '#1d1030'; ctx.fillRect(-30, -78, 60, 8);
  // cabeza
  ctx.fillStyle = SK; ctx.fillRect(-7, -164, 14, 14);
  ctx.beginPath(); ctx.moveTo(-4, -206); ctx.quadraticCurveTo(-40, -200, -36, -146); ctx.lineTo(-14, -148); ctx.quadraticCurveTo(-22, -176, -4, -184); ctx.closePath();
  ctx.fillStyle = '#0d0710'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = O; ctx.stroke();
  ell(3, -181, 22, 26, SK, O, 4);
  ctx.beginPath(); ctx.moveTo(-21, -186); ctx.quadraticCurveTo(-6, -216, 24, -197); ctx.quadraticCurveTo(12, -194, 6, -189); ctx.quadraticCurveTo(-6, -195, -21, -186); ctx.closePath();
  ctx.fillStyle = '#0d0710'; ctx.fill();
  // ojos
  ell(10, -182, 4.5, 5.5, '#fff', O, 1.5); ell(20, -182, 3.5, 5.5, '#fff', O, 1.5);
  ell(12, -181, 2.2, 2.6, '#d10f2f'); ell(21.5, -181, 1.8, 2.6, '#d10f2f');
  limb([[5, -190], [14, -187]], O, 1.5, O); limb([[18, -187], [25, -190]], O, 1.5, O);
  // boca
  if (singing) ell(15, -167, 5, ch.pose === 'up' ? 6.5 : ch.pose === 'down' ? 3 : 4.5, '#5a0a18', O, 2);
  else limb([[8, -167], [19, -169]], O, 1.5, O);
  // brazo con micrófono
  const h = armTarget(ch.pose, { idle: [38, -110], fwd: [52, -132], up: [38, -176], down: [40, -92] });
  limb([[22, -144], [(22 + h[0]) / 2 + 6, (-144 + h[1]) / 2 + 12], h], J, 13, O);
  ell(h[0], h[1], 7, 7, SK, O, 2.5);
  ctx.save(); ctx.translate(h[0], h[1]); ctx.rotate(-0.6); ctx.fillStyle = '#222'; ctx.fillRect(-2, -18, 5, 16); ell(0.5, -20, 6, 6, '#bbb', O, 2); ctx.restore();
}

function drawBoy(ch) {
  const O = '#0b0b18', SK = '#ffe1c4';
  const singing = ch.pose !== 'idle';
  limb([[-14, -90], [-24, -70], [-22, -54]], SK, 10, O);
  ctx.lineWidth = 3; ctx.strokeStyle = O; ctx.fillStyle = '#2f5fd0';
  rr(-16, -50, 13, 46, 4); ctx.fill(); ctx.stroke(); rr(3, -50, 13, 46, 4); ctx.fill(); ctx.stroke();
  ell(-8, -5, 13, 6, '#e3312f', O, 2.5); ell(13, -5, 13, 6, '#e3312f', O, 2.5);
  rr(-22, -98, 44, 54, 10); ctx.fillStyle = '#f4f4f4'; ctx.fill(); ctx.lineWidth = 4; ctx.stroke();
  ctx.fillStyle = '#e3312f'; ctx.fillRect(-20, -76, 40, 7);
  // pelo (detrás)
  poly([[-14, -132], [-42, -128], [-26, -118], [-44, -106], [-22, -104], [-34, -90], [-10, -98]], '#2ec7e6', O, 3);
  ell(2, -120, 25, 25, SK, O, 4);
  // gorra
  ctx.beginPath(); ctx.moveTo(-24, -126); ctx.quadraticCurveTo(-20, -152, 6, -150); ctx.quadraticCurveTo(26, -148, 27, -128); ctx.closePath();
  ctx.fillStyle = '#e3312f'; ctx.fill(); ctx.lineWidth = 3.5; ctx.strokeStyle = O; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(6, -149); ctx.quadraticCurveTo(25, -147, 27, -128); ctx.lineTo(8, -129); ctx.closePath(); ctx.fillStyle = '#fff'; ctx.fill(); ctx.stroke();
  poly([[20, -130], [44, -126], [42, -120], [18, -123]], '#2f5fd0', O, 3);
  // ojos
  ell(11, -117, 3.6, 6.5, '#111'); ell(20, -117, 3.2, 6.5, '#111');
  ell(12, -120, 1.3, 1.6, '#fff'); ell(21, -120, 1.2, 1.6, '#fff');
  // boca
  if (ch.miss) ell(16, -102, 4, 3, '#5a0a18', O, 2);
  else if (singing) ell(16, -103, 5.5, ch.pose === 'up' ? 6 : ch.pose === 'down' ? 2.6 : 4.2, '#5a0a18', O, 2);
  else { ctx.beginPath(); ctx.arc(15, -107, 6, 0.2, Math.PI - 0.2); ctx.lineWidth = 2.2; ctx.strokeStyle = O; ctx.stroke(); }
  // brazo con mic
  const h = armTarget(ch.pose, { idle: [30, -72], fwd: [44, -98], up: [30, -132], down: [32, -60] });
  limb([[16, -90], h], '#f4f4f4', 11, O); limb([[(16 + h[0]) / 2, (-90 + h[1]) / 2], h], SK, 9, O);
  ell(h[0], h[1], 6, 6, SK, O, 2.5);
  ctx.save(); ctx.translate(h[0], h[1]); ctx.rotate(-0.5); ctx.fillStyle = '#222'; ctx.fillRect(-2, -16, 5, 14); ell(0.5, -18, 5.5, 5.5, '#bbb', O, 2); ctx.restore();
}

function drawCharacter(ch, drawFn, x, footY, s, facing) {
  if (ch.pose !== 'idle' && G.gameTime > ch.poseUntil) { ch.pose = 'idle'; ch.miss = false; }
  let sx = 1, sy = 1, dx = 0, skew = 0;
  if (ch.pose === 'idle') { const b = bob(); sy = 1 - 0.045 * b; sx = 1 + 0.025 * b; }
  else {
    const k = Math.exp(-(G.gameTime - ch.poseAt) / 110);
    switch (ch.pose) {
      case 'left': dx = -10; skew = 0.09; break;
      case 'right': dx = 10; skew = -0.09; break;
      case 'up': sy = 1.07; sx = 0.96; break;
      case 'down': sy = 0.9; sx = 1.06; break;
    }
    sx += 0.04 * k; sy -= 0.03 * k;
  }
  ell(x, footY, s * 46, s * 9, 'rgba(0,0,0,.4)');
  ctx.save();
  ctx.translate(x + dx * s, footY);
  ctx.transform(1, 0, skew, 1, 0, 0);
  ctx.scale(sx * s * facing, sy * s);
  if (ch.miss && 'filter' in ctx) ctx.filter = 'grayscale(.5) sepia(.6) hue-rotate(220deg) saturate(2.2) brightness(.75)';
  drawFn(ch);
  ctx.restore();
}
