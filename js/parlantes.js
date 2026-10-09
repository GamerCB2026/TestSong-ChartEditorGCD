/* =====================================================================
   parlantes.js — parlantes de GF (v3.4.0).
   En V-Slice la GF base (gf, gf-christmas, gf-pixel, gf-tankmen…) trae los
   parlantes DENTRO de su sprite; otras (nene → A-Bot, GFs de mods…) usan un
   parlante aparte: un prop del escenario o un sprite propio.
   Orden de detección:
     1. el escenario ya tiene un prop de parlante (speaker / abot / stereo…) → nada
     2. "Asignar parlante" (Assets cargados) → ese sprite
     3. el JSON de la GF trae "speaker" (ruta de imagen o { assetPath, offsets, scale })
     4. la GF lleva parlantes en su sprite (gf*, o "speaker": false) → nada
     5. parlante por defecto: images/speakers(.xml/.png) o abot/abotSystem (Animate)
     6. si no hay ninguno: parlantes improvisados (dibujo vectorial)
   ===================================================================== */
'use strict';

const SPEAKER_CFG = {
  stagePropRx: /speaker|abot|stereo|parlante|bocina/i,
  bakedRx: /^gf($|-)/i,                            // GF con parlantes en su sprite
  defaultPaths: ['shared:speakers', 'shared:characters/speakers', 'shared:stageSpeakers', 'shared:characters/abot/abotSystem', 'shared:abot/abotSystem'],
  offset: [0, 0],                                  // ajuste fino (px del mundo) del parlante bajo la GF
};

const Speaker = {
  cur: null, info: '', user: null,     // user: { ap, label } puesto por "Asignar parlante"
  /* ¿hace falta un parlante aparte? */
  detect(stage, gf, gfId) {
    if (stage && stage.props.some(p => SPEAKER_CFG.stagePropRx.test(p.name || '') && (p.img || p.frames || p.color))) return { need: false, why: 'el escenario ya tiene parlante (' + stage.props.find(p => SPEAKER_CFG.stagePropRx.test(p.name || '')).name + ')' };
    if (!gf && !gfId) return { need: false, why: 'sin GF' };
    const d = gf && gf.data || {};
    if (d.speaker === false) return { need: false, why: `${gfId}: "speaker": false` };
    if (d.speaker) return { need: true, why: `${gfId}: parlante del JSON (${typeof d.speaker === 'string' ? d.speaker : d.speaker.assetPath})`, json: d.speaker };
    if (SPEAKER_CFG.bakedRx.test(gfId || '')) return { need: false, why: `${gfId}: parlantes incluidos en su sprite` };
    return { need: true, why: `${gfId} no trae parlantes en su sprite` };
  },
  async setup(stage, gf, gfId) {
    this.cur = null;
    const det = this.detect(stage, gf, gfId);
    this.need = det.need;
    if (!det.need && !this.user) { this.info = det.why; return; }
    const tries = [];
    if (this.user) tries.push({ ap: this.user.ap, rt: this.user.rt, src: 'asignado: ' + this.user.label, cfg: this.user });
    if (det.json) { const j = typeof det.json === 'string' ? { assetPath: det.json } : det.json; tries.push({ ap: j.assetPath, rt: j.renderType, src: 'JSON de ' + gfId, cfg: j }); }
    for (const ap of SPEAKER_CFG.defaultPaths) tries.push({ ap, src: 'por defecto', cfg: {} });
    for (const t of tries) {
      if (!t.ap) continue;
      const g = await loadGraphic(parseAssetPath(t.ap), t.rt).catch(() => null);
      const prop = g && this.fromGraphic(g, t.cfg);
      if (prop) { this.cur = prop; this.info = `parlante ${t.src} (${g.where})${det.need ? '' : ' · forzado aunque ' + det.why}`; return; }
      if (!g && t.ap === t.cfg.assetPath) {
        const img = await loadImg(ASSET_CFG.libImagePaths.map(x => fillT(x, parseAssetPath(t.ap)) + '.png'), { world: true }).catch(() => null);
        if (img) { this.cur = this.base({ img }, t.cfg); this.info = `parlante ${t.src} (imagen)`; return; }
      }
    }
    this.cur = this.base({ img: this.improvCanvas(), improv: true }, {});
    this.info = det.need ? `${det.why} → parlantes improvisados (puedes "Asignar parlante")` : 'parlantes improvisados';
  },
  base(o, cfg) {
    return Object.assign({ name: 'parlante GF', scale: [+(cfg.scale || 1), +(cfg.scale || 1)], scroll: [1, 1], alpha: 1, flipX: false, flipY: false, isPixel: !!cfg.isPixel,
      offsets: Array.isArray(cfg.offsets) ? cfg.offsets : [0, 0], pos: [0, 0], z: 0, danceEvery: 1, speaker: true }, o);
  },
  fromGraphic(g, cfg) {
    if (g.type === 'atlas') {
      const tl = g.model.principal; if (!tl || !(tl.frameCount > 0)) return null;
      const frames = Array.from({ length: tl.frameCount }, (_, i) => i), b = atlasBounds(g.model, tl, 0) || { minX: 0, minY: 0, maxX: 400, maxY: 300 };
      return this.base({ atlas: { model: g.model, timeline: tl, frames, fps: 24, b } }, cfg);
    }
    if (g.type === 'sparrow') {
      const groups = new Map();
      for (const f of g.atlas.frames) { const k = f.nombre.replace(/\d+$/, ''); if (!groups.has(k)) groups.set(k, []); }
      const names = [...groups.keys()];
      const pick = names.find(n => /bump|beat|idle|bop|speaker/i.test(n)) || names[0];
      const fr = sparrowFrames(g.atlas, pick || '', null, g.img);
      if (!fr.length) return null;
      const p = this.base({}, cfg);
      p.anims = new Map([['idle', { name: 'idle', frames: fr, fps: 24, loop: false, off: [0, 0] }]]);
      propSet(p, p.anims.get('idle'), fr.length === 1);
      return p;
    }
    return null;
  },
  /* parlantes improvisados (mismo dibujo del escenario improvisado) en un lienzo → textura normal (WebGL o 2D) */
  improvCanvas() {
    if (this._cv) return this._cv;
    const c = document.createElement('canvas'); c.width = 520; c.height = 420;
    const x = c.getContext('2d'), size = 600, w = size * 0.5, h = size * 0.6;
    x.translate(c.width / 2, c.height - 6);
    const rr2 = (X, Y, Wd, Hd, r) => { x.beginPath(); x.moveTo(X + r, Y); x.arcTo(X + Wd, Y, X + Wd, Y + Hd, r); x.arcTo(X + Wd, Y + Hd, X, Y + Hd, r); x.arcTo(X, Y + Hd, X, Y, r); x.arcTo(X, Y, X + Wd, Y, r); x.closePath(); };
    const circ = (cx, cy, r, fill) => { x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fillStyle = fill; x.fill(); x.lineWidth = 5; x.strokeStyle = '#000'; x.stroke(); };
    rr2(-w * 1.02, -h * 0.18, w * 2.04, h * 0.18, 10); x.fillStyle = '#2b2036'; x.fill(); x.lineWidth = 5; x.strokeStyle = '#000'; x.stroke();
    for (const dx of [-w * 0.98, w * 0.02]) {
      rr2(dx, -h, w * 0.96, h * 0.84, 16); x.fillStyle = '#22182e'; x.fill(); x.lineWidth = 6; x.strokeStyle = '#000'; x.stroke();
      circ(dx + w * 0.48, -h * 0.72, w * 0.22, '#3a2c4c'); circ(dx + w * 0.48, -h * 0.72, w * 0.09, '#110a18');
      circ(dx + w * 0.48, -h * 0.38, w * 0.3, '#3a2c4c'); circ(dx + w * 0.48, -h * 0.38, w * 0.13, '#110a18');
    }
    c.naturalWidth = c.width; c.naturalHeight = c.height;
    this._cv = c; return c;
  },
  /* posición: centrado bajo los pies de la GF, detrás de ella */
  place() {
    const p = this.cur; if (!p) return null;
    const gf = Scene.chars.gf, sc = Scene.stage?.data?.characters?.gf;
    let fx, fy, z, scroll;
    if (gf) { fx = gf.bx + gf.ref.w * gf.ts / 2 - gf.offsets[0]; fy = gf.by + gf.ref.h * gf.ts - gf.offsets[1]; z = gf.z - 1; scroll = gf.scroll; }
    else if (sc) { fx = sc.position[0]; fy = sc.position[1]; z = (sc.zIndex ?? 100) - 1; scroll = sc.scroll || [1, 1]; }
    else return null;
    const [w, h] = this.size(p);
    p.pos = [fx - w / 2 + p.offsets[0] + SPEAKER_CFG.offset[0], fy - h + p.offsets[1] + SPEAKER_CFG.offset[1]];
    p.z = z; p.scroll = scroll;
    return p;
  },
  size(p) {
    if (p.atlas) { const b = p.atlas.b; return [(b.maxX - b.minX) * p.scale[0], (b.maxY - b.minY) * p.scale[1]]; }
    if (p.frames) { const f = p.frames[0]; return [f.fw * p.scale[0], f.fh * p.scale[1]]; }
    if (p.img) return [(p.img.naturalWidth || p.img.width) * p.scale[0], (p.img.naturalHeight || p.img.height) * p.scale[1]];
    return [0, 0];
  },
  beat(b) {
    const p = this.cur; if (!p) return;
    p.bopAt = G.gameTime;
    if (p.anims) { const a = p.anims.get('idle'); if (a && a.frames.length > 1) propSet(p, a, false); }
    if (p.atlas) p.atlasT0 = G.gameTime;
  },
  draw(v, zoom, R) {
    const p = this.cur; if (!p || (typeof Optim !== 'undefined' && !Optim.s.gf)) return;
    if (p.atlas) {
      const M = worldMatrix(v, zoom, p.scroll[0], p.scroll[1], _spM), a = p.atlas, b = a.b;
      const n = a.frames.length, i = clamp(animFrame(G.gameTime - (p.atlasT0 || 0), a.fps), 0, n - 1);
      mmul(M, M, mset(_spL, p.scale[0], 0, 0, p.scale[1], p.pos[0] - b.minX * p.scale[0], p.pos[1] - b.minY * p.scale[1]));
      atlasDibujarR(R, a.model, a.timeline, a.frames[i], M, p.alpha, !p.isPixel && Optim.s.aa, false);
      return;
    }
    if (p.improv) {
      // bop del dibujo improvisado (como el escenario improvisado)
      const k = clamp((G.gameTime - (p.bopAt || -1e9)) / 220, 0, 1), s = 1 + 0.04 * (1 - k) * (1 - k);
      const [w, h] = this.size({ img: p.img, scale: [1, 1] });
      const save = p.scale; p.scale = [save[0] * s, save[1] * (2 - s)];
      const pos = p.pos; p.pos = [pos[0] - w * (s - 1) / 2, pos[1] + h * (s - 1)];
      drawProp(p, v, zoom, R); p.scale = save; p.pos = pos;
      return;
    }
    drawProp(p, v, zoom, R);
  },
  textures() {
    const p = this.cur; if (!p) return [];
    if (p.atlas) return [...p.atlas.model.sprites.values()].map(s => s.img);
    if (p.frames) return uniq(p.frames.map(f => f.img));
    return p.img ? [p.img] : [];
  },
};
const _spM = [1, 0, 0, 1, 0, 0], _spL = [1, 0, 0, 1, 0, 0];
