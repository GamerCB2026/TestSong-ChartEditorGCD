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
    // v3.8.0: estado de animación = FlxAnimationController + Bopper/BaseCharacter (vslice.js)
    this.characterType = role === 'bf' ? 'BF' : role === 'dad' ? 'DAD' : role === 'gf' ? 'GF' : 'OTHER';
    this.singTimeSteps = data.singTime ?? 8; this.danceEvery = data.danceEvery ?? 1; this.ignoreExclusionPref = ['sing'];
    this.hasLR = anims.has('danceLeft') && anims.has('danceRight');
    this.animation = new VS.AnimController(n => this.onAnimationFinished(n));
    for (const [n, a] of anims) this.animation.add(n, a.frames.length, a.fps || 24, !!a.loop);
    this.initCharacterState();
    const refA = anims.get('idle') || anims.get('danceRight') || anims.get('danceLeft') || anims.values().next().value;
    this.ref = RealChar.box(refA, 0) || { minX: 0, minY: 0, maxX: 300, w: 300, h: 400 };
    this.reset();
  }
  static box(a, i) {
    if (!a) return null;
    if (a.type === 'atlas') { const b = atlasBounds(a.model, a.timeline, a.frames[i]); return b && { minX: b.minX, minY: b.minY, maxX: b.maxX, w: b.maxX - b.minX, h: b.maxY - b.minY }; }
    const f = a.frames[i]; return f && { minX: 0, minY: 0, maxX: f.fw, w: f.fw, h: f.fh };
  }
  /* BaseCharacter.resetCharacter (+ estado limpio para reiniciar la canción igual cada vez) */
  reset() {
    this.initCharacterState(); this.altSing = false; this.danceEvery = this.data.danceEvery ?? 1;
    const st = this.data.startingAnimation;
    if (st && this.hasAnimation(st)) this.playAnimation(st, true); else this.dance(true);
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
  /* v3.8.0: el canto, el baile, holdTimer, '-hold'/'-end', exclusiones (canPlayOtherAnims) y tempVocals los hace
     BaseCharacterMixin (port de Bopper/BaseCharacter); aquí solo quedan accesos y compatibilidad. */
  get charRole() { return this.role; }
  /* BaseCharacter.cameraFocusPoint (+ cameraOffsets del escenario, como Stage.resetStage) */
  get cameraFocusPoint() { const p = this.camPoint(), o = this._cfp || (this._cfp = { x: 0, y: 0 }); o.x = p[0]; o.y = p[1]; return o; }
  get curName() { return this.animation.name; }
  get cur() { return this.anims.get(this.animation.name) || this.anims.values().next().value; }
  conductor() { return VS.play.conductor; }
  get vocals() { return VS.play && VS.play.host ? VS.play.host.vocals : null; }
  inputState() { const p = VS.play; return p ? { justPressed: p.justPressedAny, holding: p.playerStrumline.keysHeld.some(Boolean) } : { justPressed: false, holding: false }; }
  defaultSingSuffix() { return this.altSing ? 'alt' : ''; }
  frameIdx() {
    const ca = this.animation.curAnim; if (!ca) return 0;
    const mode = Optim.s.anim;
    if (mode === 'estatica') return 0;
    if (mode === 'reducida' && ca.frameRate > 12) return Math.floor(Math.floor(ca.curFrame * 12 / ca.frameRate) * ca.frameRate / 12);
    return ca.curFrame;
  }
  finished() { return this.animation.finished; }
  /* compatibilidad (scripts Psych/Codename, kinds de respaldo) */
  play(name, restart = false, ignoreOther = false) { if (!this.hasAnimation(name)) return false; this.playAnimation(name, restart, ignoreOther); return this.curName === name; }
  sing(lane, miss = false, _holdMs = 0, suffix = '') { this.playSingAnimation(lane, !!miss, String(suffix || '').replace(/^-/, '') || this.defaultSingSuffix()); this.holdTimer = 0; }
  playEvent(name, force) { if (!this.hasAnimation(name)) return false; this.tempVocals = !!force; this.playAnimation(name, !!force, !!force); return true; }
  special(name) { if (!this.hasAnimation(name)) return false; this.playAnimation(name, true, true); return true; }
  update() {}
  /* M = matriz mundo -> píxeles del canvas; R = destino (render.js: Canvas o WebGL) */
  draw(M, R) {
    const a = this.cur; if (!a || this.visible === false) return;
    const fr = a.frames[this.frameIdx()], s = this.ts, flip = this.flipX !== !!a.flipX, off0 = a.off || [0, 0], off = this.mirrorOff ? [-off0[0], off0[1]] : off0;
    const alpha = this.alpha ?? 1, smooth = !this.isPixel && Optim.s.aa, tint = false, m = _charM;
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
VS.mixCharacter(RealChar.prototype);   // v3.8.0: Bopper + BaseCharacter
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
