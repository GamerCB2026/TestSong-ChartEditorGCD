/* =====================================================================
   stages.js — escenario V-Slice (data/stages/<id>.json: props, zIndex, scroll,
   cameraZoom, posiciones de bf/dad/gf), cámara del mundo con parallax y
   escenario improvisado de respaldo.
   ===================================================================== */
'use strict';

/* ---------- Escenario ---------- */
async function loadStage(id) {
  const sj = await fetchFirst(ASSET_CFG.stageDataPaths.map(t => fillT(t, { id })));
  const data = sj ? sj.data : DEFAULT_DATA.stages[id];
  if (!data) return null;
  const props = [];
  for (const p of data.props || []) {
    const ap = String(p.assetPath || '');
    const prop = { name: p.name || ap, pos: p.position || [0, 0], scale: p.scale === undefined ? [1, 1] : (Array.isArray(p.scale) ? p.scale : [p.scale, p.scale]),
      scroll: p.scroll || [1, 1], alpha: p.alpha ?? 1, z: p.zIndex ?? 0, flipX: !!p.flipX, flipY: !!p.flipY, isPixel: !!p.isPixel, danceEvery: p.danceEvery || 0 };
    if (ap.startsWith('#')) { prop.color = ap; props.push(prop); continue; }
    const pa = parseAssetPath(ap);
    const cands = ASSET_CFG.stageImagePaths.map(t => fillT(t, { stage: id, path: pa.path, dir: data.directory || 'shared' }));
    if (ap.includes(':')) cands.unshift(`${pa.lib}/images/${pa.path}.png`);
    if (Array.isArray(p.animations) && p.animations.length && p.animType !== 'animateatlas') {
      const xml = await fetchFirst(cands.map(c => c.replace(/\.png$/, '.xml')), 'text');
      if (xml) {
        try {
          const atlas = parseSparrow(xml.data), img = await loadImg([xml.path.replace(/\.xml$/, '.png')]);
          const a = p.animations.find(a => a.name === p.startingAnimation) || p.animations.find(a => a.name === 'idle') || p.animations[0];
          const frames = img ? sparrowFrames(atlas, a.prefix || '', a.frameIndices, img) : [];
          if (frames.length) { Object.assign(prop, { frames, fps: +a.frameRate || 24, loop: a.looped !== false, img, path: xml.path, off: a.offsets || [0, 0] }); props.push(prop); continue; }
        } catch (e) { console.warn(e); }
      }
    }
    const img = await loadImg(cands);
    prop.img = img; prop.path = img ? img.assetPath : null; prop.tried = cands[0];
    props.push(prop);
  }
  return { id, data, props, from: sj ? sj.path : '(JSON incluido en js/assets.js)' };
}

/* ---------- Cámara del mundo (FlxG.camera de 1280x720 con zoom del escenario) ----------
   Como PlayState de V-Slice: la cámara sigue a cameraFollowPoint con lerp (CLASSIC) o se mueve con
   un tween (FocusCamera con ease); zoom = currentCameraZoom × cameraBopMultiplier. */
const Cam = { x: 640, y: 360, init: false, bop: 1, stageZoom: 1, zoom: 1, zoomTween: null, follow: null, tween: null,
  zoomRate: FNF.ZOOM_RATE, bopIntensity: FNF.BOP_INTENSITY, hudIntensity: FNF.HUD_BOP,
  resetEvents() {
    this.follow = null; this.tween = null; this.zoomTween = null; this.zoom = this.stageZoom; this.bop = 1;
    this.zoomRate = FNF.ZOOM_RATE; this.bopIntensity = FNF.BOP_INTENSITY; this.hudIntensity = FNF.HUD_BOP;
  },
  followTo(x, y) { this.tween = null; this.follow = [x, y]; },
  tweenTo(x, y, dur, ease) {
    this.follow = [x, y];
    if (dur <= 0 || !this.init) { this.tween = null; this.x = x; this.y = y; this.init = true; }
    else this.tween = makeTween([this.x, this.y], [x, y], dur, ease);
  },
  zoomTo(z, dur, ease) { if (dur <= 0) { this.zoomTween = null; this.zoom = z; } else this.zoomTween = makeTween(this.zoom, z, dur, ease); },
};

/* punto de enfoque de un personaje (cameraFocusPoint); si no hay assets, la posición del escenario */
function focusPoint(role) {
  const c = Scene.chars[role]; if (c) return c.camPoint();
  const sc = Scene.stage?.data?.characters?.[role] || DEFAULT_DATA.stages.mainStage.characters[role];
  return sc ? [sc.position[0] + (sc.cameraOffsets?.[0] || 0), sc.position[1] - 200 + (sc.cameraOffsets?.[1] || 0)] : null;
}

function worldView(dt) {
  const st = Scene.stage, sd = st ? st.data : {};
  const pts = {};
  for (const r of ['bf', 'dad', 'gf']) { const p = focusPoint(r); if (p) pts[r] = p; }
  if (Cam.zoomTween) { Cam.zoom = tweenValue(Cam.zoomTween); if (tweenDone(Cam.zoomTween)) Cam.zoomTween = null; }
  const pz = +params.get('zoom') || 1;   // ?zoom=0.8 para alejar la cámara
  let k, vx, vy, zoom, target;
  if (V.portrait) {
    // celular vertical: se ven los dos personajes a la vez (cámara fija entre ambos)
    k = W / 1280; vx = 0; vy = H * 0.44 - k * 360;
    const dx = sd.characters?.dad?.position?.[0] ?? 335, bx = sd.characters?.bf?.position?.[0] ?? 990;
    zoom = clamp(1280 / (Math.abs(bx - dx) + 560), 0.35, Cam.stageZoom * pz) * (Cam.zoom / (Cam.stageZoom || 1));
    const a = pts.dad || [dx, 600], b = pts.bf || [bx, 600];
    target = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    Cam.tween = null;
  } else {
    // igual que el juego: 1280x720 escalado para caber; lo que sobra a los lados muestra más escenario
    k = V.s; vx = V.ox; vy = V.oy; zoom = Cam.zoom * pz;
    target = Cam.follow || pts[Scene.focus] || pts.dad || pts.bf || [640, 360];
  }
  if (Cam.tween) { const p = tweenValue(Cam.tween); Cam.x = p[0]; Cam.y = p[1]; if (tweenDone(Cam.tween)) Cam.tween = null; }
  else if (!Cam.init) { Cam.x = target[0]; Cam.y = target[1]; Cam.init = true; }
  else { const f = 1 - Math.pow(1 - FNF.CAMERA_FOLLOW_RATE, dt / (1000 / 60)); Cam.x = lerp(Cam.x, target[0], f); Cam.y = lerp(Cam.y, target[1], f); }
  return { k, vx, vy, zoom };
}
/* matriz mundo -> canvas (px de dispositivo) para un scroll factor dado */
function worldMatrix(v, zoom, sfx, sfy) {
  const kz = v.k * zoom * DPR;
  const sx = Cam.x - 640, sy = Cam.y - 360;
  return [kz, 0, 0, kz, DPR * (v.vx + v.k * 640) - kz * (sx * sfx + 640), DPR * (v.vy + v.k * 360) - kz * (sy * sfy + 360)];
}

function drawProp(p, v, zoom) {
  const M = worldMatrix(v, zoom, p.scroll[0], p.scroll[1]);
  ctx.setTransform(M[0], M[1], M[2], M[3], M[4], M[5]);
  ctx.globalAlpha = p.alpha; ctx.imageSmoothingEnabled = !p.isPixel;
  ctx.translate(p.pos[0], p.pos[1]);
  if (p.color) { ctx.fillStyle = p.color; ctx.fillRect(0, 0, p.scale[0], p.scale[1]); }
  else if (p.frames) {
    const n = p.frames.length, i = p.loop ? Math.floor(G.gameTime / 1000 * p.fps) % n : Math.min(n - 1, Math.floor(G.gameTime / 1000 * p.fps));
    const fr = p.frames[i]; ctx.scale(p.scale[0], p.scale[1]);
    ctx.translate(fr.offX - p.off[0], fr.offY - p.off[1]);
    if (fr.rot) { ctx.translate(0, fr.dh); ctx.rotate(-Math.PI / 2); }
    ctx.drawImage(fr.img, fr.x, fr.y, fr.w, fr.h, 0, 0, fr.w, fr.h);
  } else if (p.img) {
    const w = p.img.naturalWidth * p.scale[0], h = p.img.naturalHeight * p.scale[1];
    if (p.flipX || p.flipY) { ctx.translate(p.flipX ? w : 0, p.flipY ? h : 0); ctx.scale(p.flipX ? -1 : 1, p.flipY ? -1 : 1); }
    ctx.drawImage(p.img, 0, 0, w, h);
  }
  ctx.globalAlpha = 1; ctx.imageSmoothingEnabled = true;
}

function renderWorld(dt, bump) {
  const v = worldView(dt), zoom = v.zoom * bump;
  const st = Scene.stage, sd = st ? st.data : {};
  const props = st ? st.props.filter(p => p.img || p.color || p.frames) : [];
  // fondo base (por si los props no cubren la pantalla)
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  const M1 = worldMatrix(v, zoom, 1, 1);
  const toScreen = (wx, wy) => [(M1[0] * wx + M1[4]) / DPR, (M1[3] * wy + M1[5]) / DPR];
  if (!props.length) {
    // escenario improvisado alineado con los pies de los personajes
    const feetY = sd.characters?.bf?.position?.[1] ?? 885;
    const save = { floorY: L.floorY, horizon: L.horizon, charH: L.charH };
    L.floorY = toScreen(0, feetY)[1]; L.charH = M1[3] / DPR * 400; L.horizon = L.floorY - L.charH * 0.55;
    ctx.save(); drawStage(!Scene.chars.gf); ctx.restore();
    Object.assign(L, save);
  }
  // capas ordenadas por zIndex
  const layers = props.map(p => ({ z: p.z, draw: () => drawProp(p, v, zoom) }));
  for (const role of ['gf', 'dad', 'bf']) {
    const c = Scene.chars[role], sc = sd.characters?.[role];
    if (c) layers.push({ z: c.z, draw: () => { c.update(); c.draw(worldMatrix(v, zoom, c.scroll[0], c.scroll[1])); } });
    else if (role !== 'gf' && sc) layers.push({ z: sc.zIndex ?? 0, draw: () => {
      // personaje improvisado en la posición del escenario (bf mira a la izquierda, dad a la derecha)
      const [x, y] = toScreen(sc.position[0], sc.position[1]);
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      const s = M1[3] / DPR * 400 / 215;
      if (role === 'bf') drawCharacter(G.bf, drawBoy, x, y, s, -1); else drawCharacter(G.dad, drawRival, x, y, s, 1);
    } });
  }
  layers.sort((a, b) => a.z - b.z).forEach(l => l.draw());
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

/* ---------- Escenario improvisado (sin assets) ---------- */
const L = {};   // medidas del escenario improvisado
function improvLayout() {
  const portrait = V.portrait;
  L.floorY = portrait ? H * 0.64 : H * 0.8;
  L.charH = portrait ? Math.min(H * 0.3, W * 0.58) : H * 0.5;
  L.horizon = L.floorY - (portrait ? H * 0.2 : H * 0.26);
  L.oppX = W * 0.25; L.plX = W * 0.75;
}
const rndS = mulberry32(99);
const STARS = Array.from({ length: 90 }, () => ({ x: rndS(), y: rndS(), r: 0.6 + rndS() * 1.6, p: rndS() * 6 }));
const BUILDINGS = []; { let x = -0.02; while (x < 1.02) { const w = 0.04 + rndS() * 0.06; BUILDINGS.push({ x, w, h: 0.25 + rndS() * 0.75, win: Array.from({ length: 24 }, () => rndS() < 0.35) }); x += w + 0.004; } }
function drawStage(speakers = true) {
  const b = bob();
  // cielo
  const sky = ctx.createLinearGradient(0, 0, 0, L.floorY);
  sky.addColorStop(0, '#07021a'); sky.addColorStop(0.55, '#2a0f4a'); sky.addColorStop(1, '#6a2275');
  ctx.fillStyle = sky; ctx.fillRect(-W, -H, W * 3, H * 3);
  // estrellas
  for (const s of STARS) { ctx.globalAlpha = 0.35 + 0.65 * Math.abs(Math.sin(G.gameTime / 900 + s.p)); ell(s.x * W, s.y * L.horizon * 0.9, s.r, s.r, '#fff'); }
  ctx.globalAlpha = 1;
  // luna
  ell(W * 0.14, L.horizon * 0.28, Math.min(W, H) * 0.07, Math.min(W, H) * 0.07, '#ffe9c4');
  ell(W * 0.14 + Math.min(W, H) * 0.025, L.horizon * 0.28 - Math.min(W, H) * 0.02, Math.min(W, H) * 0.06, Math.min(W, H) * 0.06, '#1b0936');
  // ciudad
  const cityH = (L.horizon) * 0.55;
  for (const bd of BUILDINGS) {
    const x = bd.x * W, w = bd.w * W, h = bd.h * cityH, y = L.horizon + 4 - h;
    ctx.fillStyle = '#1a0a30'; ctx.fillRect(x, y, w, h + H);
    ctx.fillStyle = '#ffd86b';
    const cols = 3, rows = 8, ww = w / (cols * 2 + 1), wh = h / (rows * 2 + 1);
    for (let i = 0; i < cols * rows; i++) if (bd.win[i % 24]) { const cx = i % cols, cy = Math.floor(i / cols); ctx.globalAlpha = 0.55 + 0.35 * b * (i % 2); ctx.fillRect(x + ww * (cx * 2 + 1), y + wh * (cy * 2 + 1), ww, wh); }
    ctx.globalAlpha = 1;
  }
  // pared / fondo del escenario
  const wall = ctx.createLinearGradient(0, L.horizon, 0, L.floorY);
  wall.addColorStop(0, '#2b123f'); wall.addColorStop(1, '#170827');
  ctx.fillStyle = wall; ctx.fillRect(-W, L.horizon, W * 3, L.floorY);
  // piso (madera con perspectiva)
  const topY = L.floorY - L.charH * 0.1;
  const fl = ctx.createLinearGradient(0, topY, 0, H);
  fl.addColorStop(0, '#7a4425'); fl.addColorStop(1, '#2e140a');
  poly([[-W * 0.2, topY], [W * 1.2, topY], [W * 1.6, H * 1.5], [-W * 0.6, H * 1.5]], fl);
  ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 2;
  for (let i = -6; i <= 16; i++) { const x0 = W * (i / 10); ctx.beginPath(); ctx.moveTo(x0, topY); ctx.lineTo(W / 2 + (x0 - W / 2) * 2.4, H * 1.5); ctx.stroke(); }
  ctx.fillStyle = '#a8653a'; ctx.fillRect(-W, topY - 3, W * 3, 5);
  // focos
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (const [sx, tx, col] of [[W * 0.05, W * 0.28, '255,80,200'], [W * 0.95, W * 0.72, '80,200,255']]) {
    const g = ctx.createLinearGradient(sx, 0, tx, L.floorY);
    g.addColorStop(0, `rgba(${col},${0.32 + 0.25 * b})`); g.addColorStop(1, `rgba(${col},0)`);
    poly([[sx - 12, -10], [sx + 12, -10], [tx + L.charH * 0.45, L.floorY + 10], [tx - L.charH * 0.45, L.floorY + 10]], g);
  }
  ctx.restore();
  if (speakers) drawSpeakers(W / 2, topY + L.charH * 0.04, L.charH * (V.portrait ? 0.34 : 0.42), b);
}

function drawSpeakers(cx, baseY, size, b) {
  const s = 1 + 0.05 * b;
  ctx.save(); ctx.translate(cx, baseY); ctx.scale(s, 2 - s);
  const w = size * 0.5, h = size * 0.75;
  for (const dx of [-w * 1.02, w * 0.02]) {
    rr(dx, -h, w, h, size * 0.05); ctx.fillStyle = '#22182e'; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = '#000'; ctx.stroke();
    ell(dx + w / 2, -h * 0.68, w * 0.26, w * 0.26, '#3a2c4c', '#000', 3); ell(dx + w / 2, -h * 0.68, w * 0.12 * (1 + 0.3 * b), w * 0.12 * (1 + 0.3 * b), '#110a18');
    ell(dx + w / 2, -h * 0.27, w * 0.36, w * 0.36, '#3a2c4c', '#000', 3); ell(dx + w / 2, -h * 0.27, w * 0.18 * (1 + 0.3 * b), w * 0.18 * (1 + 0.3 * b), '#110a18');
  }
  // logo GCD
  rr(-w * 0.62, -h - size * 0.17, w * 1.24, size * 0.15, 6); ctx.fillStyle = '#c24b99'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.stroke();
  ctx.font = `900 ${size * 0.1}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff'; ctx.fillText('GCD', 0, -h - size * 0.095);
  ctx.restore();
}
