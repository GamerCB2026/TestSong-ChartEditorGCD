/* =====================================================================
   stages.js — escenario V-Slice (data/stages/<id>.json: props, zIndex, scroll,
   cameraZoom, posiciones de bf/dad/gf), cámara del mundo con parallax y
   (v3.7.0: sin escenario improvisado; sin assets, fondo negro).
   ===================================================================== */
'use strict';

/* ---------- Escenario ---------- */
async function loadStage(id) {
  let sj = await fetchFirst(ASSET_CFG.stageDataPaths.map(t => fillT(t, { id })));
  let data = sj ? sj.data : null;
  // v3.5.0: escenarios de Psych (stages/<id>.json + .lua/.hx) y Codename (data/stages/<id>.xml) → formato V-Slice
  if (data && EngineData.isPsychStage(data)) data = await EngineData.psychStage(data, id);
  if (!data) { const x = await EngineData.findStage(id).catch(e => { console.warn('[motores]', e); return null; }); if (x) { data = x.data; sj = { path: x.path + ` (convertido de ${x.data.convertedFrom})` }; } }
  if (!data) data = DEFAULT_DATA.stages[id];
  if (!data) return null;
  // v3.3.0: los props se cargan en paralelo (antes uno por uno) y sus imágenes se decodifican fuera del hilo principal
  const props = await Promise.all((data.props || []).map(async p => {
    const ap = String(p.assetPath || '');
    const prop = { name: p.name || ap, pos: p.position || [0, 0], scale: p.scale === undefined ? [1, 1] : (Array.isArray(p.scale) ? p.scale : [p.scale, p.scale]),
      scroll: p.scroll || [1, 1], alpha: p.alpha ?? 1, z: p.zIndex ?? 0, flipX: !!p.flipX, flipY: !!p.flipY, isPixel: !!p.isPixel, danceEvery: p.danceEvery || 0 };
    if (ap.startsWith('#')) { prop.color = ap; return prop; }
    const pa = parseAssetPath(ap);
    const cands = ASSET_CFG.stageImagePaths.map(t => fillT(t, { stage: id, path: pa.path, dir: data.directory || 'shared' }));
    if (ap.includes(':')) cands.unshift(`${pa.lib}/images/${pa.path}.png`);
    if (Array.isArray(p.animations) && p.animations.length && p.animType !== 'animateatlas') {
      const xml = await fetchFirst(cands.map(c => c.replace(/\.png$/, '.xml')), 'text');
      if (xml) {
        try {
          const atlas = parseSparrow(xml.data), img = await loadImg([xml.path.replace(/\.xml$/, '.png')], { world: true });
          // v3.4.0: todas las animaciones del prop (PlayAnimation puede pedir cualquiera; los "boppers" bailan con el ritmo)
          prop.anims = new Map();
          if (img) for (const an of p.animations) {
            const fr = sparrowFrames(atlas, an.prefix || '', an.frameIndices, img);
            if (fr.length) prop.anims.set(an.name, { name: an.name, frames: fr, fps: +an.frameRate || 24, loop: !!an.looped, off: an.offsets || [0, 0] });
          }
          const a = p.animations.find(a => a.name === p.startingAnimation) || p.animations.find(a => a.name === 'idle') || p.animations[0];
          const st = prop.anims.get(a.name) || prop.anims.values().next().value;
          if (st) {
            // sin danceEvery el prop repite su animación inicial (como antes); con danceEvery baila en el beat (Bopper)
            Object.assign(prop, { img: null, sheet: img, path: xml.path, hasLR: prop.anims.has('danceLeft') && prop.anims.has('danceRight') });
            propSet(prop, st, !(prop.danceEvery > 0) ? (a.looped !== false) : st.loop);
            return prop;
          }
        } catch (e) { console.warn(e); }
      }
    }
    const img = await loadImg(cands, { world: true });
    prop.img = img; prop.path = img ? img.assetPath : null; prop.tried = cands[0];
    return prop;
  }));
  await TexLoad.cropFrames(props.flatMap(p => p.anims ? [...p.anims.values()].flatMap(a => a.frames) : (p.frames || [])));
  const st = { id, data, props, from: sj ? sj.path : '(JSON incluido en js/assets.js)' };
  stageModeFor(st);
  return st;
}
/* ---------- animaciones de props (Bopper / PlayAnimation sobre un prop con nombre) ---------- */
function propSet(p, a, loop) { p.cur = a.name; p.frames = a.frames; p.fps = a.fps; p.loop = loop ?? a.loop; p.off = a.off; p.t0 = G.gameTime || 0; }
function propFinished(p) { return !p.loop && (G.gameTime - (p.t0 || 0)) / 1000 * p.fps >= p.frames.length; }
function propPlay(name, anim, force) {
  const st = Scene.stage; if (!st) return false;
  const p = st.props.find(x => x.name === name) || st.props.find(x => String(x.name).toLowerCase() === String(name).toLowerCase());
  if (!p || !p.anims) return false;
  const a = p.anims.get(anim); if (!a) return false;
  if (p.lock && !(p.cur === anim && force)) return false;
  if (!force && p.cur === anim && !propFinished(p)) return true;
  propSet(p, a); if (force) p.lock = true;
  return true;
}
/* beat: los props con danceEvery bailan (danceLeft/danceRight o idle), sin cortar una animación especial */
function propsBeat(beat) {
  const st = Scene.stage; if (!st) return;
  for (const p of st.props) {
    if (!p.anims || !(p.danceEvery > 0)) continue;
    if (p.lock) { if (propFinished(p)) p.lock = false; else continue; }
    const every = Math.max(1, Math.round(p.danceEvery));
    if (((beat % every) + every) % every !== 0) continue;
    if (p.cur && !/^(idle|dance)/.test(p.cur) && !propFinished(p)) continue;
    let a;
    if (p.hasLR) { p.danced = !p.danced; a = p.anims.get(p.danced ? 'danceLeft' : 'danceRight'); }
    else a = p.anims.get('idle') || p.anims.get(p.cur);
    if (a) propSet(p, a);
  }
}
function propsReset() {
  const st = Scene.stage; if (!st) return;
  for (const p of st.props) if (p.anims && p.cur) { p.lock = false; p.t0 = 0; }
}

/* Optimización → Escenario: completo / simple (solo el fondo) / oculto */
function stageModeFor(st) {
  const mode = Optim.s.stage, props = st.props.filter(p => p.img || p.color || p.frames);
  for (const p of props) p.optHidden = false;
  if (mode === 'oculto') for (const p of props) p.optHidden = true;
  else if (mode === 'simple') {
    // fondo = props quietos detrás de los personajes; de ellos, los 3 más grandes (en su orden de capas)
    const sc = st.data.characters || {}, minZ = Math.min(...['bf', 'dad', 'gf'].map(r => sc[r]?.zIndex ?? (r === 'gf' ? 100 : r === 'dad' ? 200 : 300)));
    const area = p => p.color ? Math.abs(p.scale[0] * p.scale[1]) : p.img ? p.img.naturalWidth * p.img.naturalHeight * Math.abs(p.scale[0] * p.scale[1]) : 0;
    const back = props.filter(p => !p.frames && p.z < minZ).sort((a, b) => area(b) - area(a)).slice(0, 3);
    for (const p of props) p.optHidden = !back.includes(p);
  }
}
function Stage_applyMode() { if (Scene.stage) stageModeFor(Scene.stage); }

/* ---------- Cámara del mundo (FlxG.camera de 1280x720 con zoom del escenario) ----------
   Como PlayState de V-Slice: la cámara sigue a cameraFollowPoint con lerp (CLASSIC) o se mueve con
   un tween (FocusCamera con ease); zoom = currentCameraZoom × cameraBopMultiplier. */
const Cam = { x: 640, y: 360, init: false, bop: 1, stageZoom: 1, zoom: 1, zoomTween: null, follow: null, tween: null,
  zoomRate: FNF.ZOOM_RATE, zoomOffset: 0, bopIntensity: FNF.BOP_INTENSITY, hudIntensity: FNF.HUD_BOP,
  resetEvents() {
    this.follow = null; this.tween = null; this.zoomTween = null; this.zoom = this.stageZoom; this.bop = 1;
    this.zoomRate = FNF.ZOOM_RATE; this.zoomOffset = 0; this.bopIntensity = FNF.BOP_INTENSITY; this.hudIntensity = FNF.HUD_BOP;
  },
  /* CLASSIC: cancela el tween y mueve el punto que la cámara sigue con lerp (null = vuelve a seguir a Scene.focus) */
  followTo(x, y) { this.tween = null; this.follow = x === null || x === undefined ? null : [x, y]; },
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
  // igual que el juego: 1280x720 escalado para caber; lo que sobra a los lados muestra más escenario
  // (en celular horizontal la pantalla se ensancha como en V-Slice móvil)
  k = V.s; vx = (W - 1280 * V.s) / 2; vy = (H - 720 * V.s) / 2; zoom = Cam.zoom * pz;
  target = Cam.follow || pts[Scene.focus] || pts.dad || pts.bf || [640, 360];
  if (Cam.tween) { const p = tweenValue(Cam.tween); Cam.x = p[0]; Cam.y = p[1]; if (tweenDone(Cam.tween)) Cam.tween = null; }
  else if (!Cam.init) { Cam.x = target[0]; Cam.y = target[1]; Cam.init = true; }
  else { const f = 1 - Math.pow(1 - FNF.CAMERA_FOLLOW_RATE, dt / (1000 / 60)); Cam.x = lerp(Cam.x, target[0], f); Cam.y = lerp(Cam.y, target[1], f); }
  return { k, vx, vy, zoom };
}
/* matriz mundo -> canvas (px de dispositivo) para un scroll factor dado */
function worldMatrix(v, zoom, sfx, sfy, out) {
  const kz = v.k * zoom * DPR;
  const sx = Cam.x - 640, sy = Cam.y - 360;
  const e = DPR * (v.vx + v.k * 640) - kz * (sx * sfx + 640), f = DPR * (v.vy + v.k * 360) - kz * (sy * sfy + 360);
  return out ? mset(out, kz, 0, 0, kz, e, f) : [kz, 0, 0, kz, e, f];
}

const _pM = [1, 0, 0, 1, 0, 0], _pL = [1, 0, 0, 1, 0, 0];
function drawProp(p, v, zoom, R) {
  if (p.visible === false || p.optHidden) return;
  if (p.shader) { R.setShader(p.shader); try { drawPropInner(p, v, zoom, R); } finally { R.setShader(null); } }
  else drawPropInner(p, v, zoom, R);
}
function drawPropInner(p, v, zoom, R) {
  const M = worldMatrix(v, zoom, p.scroll[0], p.scroll[1], _pM), smooth = !p.isPixel && Optim.s.aa;
  mmul(M, M, mset(_pL, 1, 0, 0, 1, p.pos[0], p.pos[1]));
  if (p.color) { R.rect(p.color, M, p.scale[0], p.scale[1], p.alpha); return; }
  if (p.frames) {
    const n = p.frames.length, i0 = animFrame(G.gameTime - (p.t0 || 0), p.fps), i = p.loop ? ((i0 % n) + n) % n : clamp(i0, 0, n - 1);
    const fr = p.frames[i]; if (!fr) return;
    mmul(M, M, mset(_pL, p.scale[0], 0, 0, p.scale[1], 0, 0));
    mmul(M, M, mset(_pL, 1, 0, 0, 1, fr.offX - p.off[0], fr.offY - p.off[1]));
    if (fr.rot) mmul(M, M, mset(_pL, 0, -1, 1, 0, 0, fr.dh));
    if (p.shader && p.shader.updateFrameInfo) p.shader.angleOffset = fr.rot ? -90 : 0;
    R.img(fr.img, fr.x, fr.y, fr.w, fr.h, M, p.alpha, smooth, false, p.rgb);
  } else if (p.img) {
    const nw = p.img.naturalWidth, nh = p.img.naturalHeight, w = nw * p.scale[0], h = nh * p.scale[1];
    if (p.flipX || p.flipY) mmul(M, M, mset(_pL, p.flipX ? -1 : 1, 0, 0, p.flipY ? -1 : 1, p.flipX ? w : 0, p.flipY ? h : 0));
    mmul(M, M, mset(_pL, w / nw, 0, 0, h / nh, 0, 0));
    R.img(p.img, 0, 0, nw, nh, M, p.alpha, smooth, false, p.rgb);
  }
}

/* ¿el mundo de este frame necesita el lienzo 2D directo? (cosas que solo sabe dibujar el 2D) */
function worldNeedsDirect() {
  const st = Scene.stage;
  if (CamFX.active('game')) return true;                                        // efectos de cámara de scripts
  for (const sp of ModRT.sprites) if (!sp.onHud && !sp.glOk) return true;      // sprites de scripts que solo sabe dibujar el 2D (texto, rotados, blend add)
  return false;
}

const _layers = [];
function renderWorld(dt, bump, R) {
  const v = worldView(dt), zoom = v.zoom * bump;
  const st = Scene.stage, sd = st ? st.data : {};
  const direct = R.kind === 'canvas' && R.c === ctx;
  // fondo base (por si los props no cubren la pantalla)
  R.clear();
  const M1 = worldMatrix(v, zoom, 1, 1);
  const toScreen = (wx, wy) => [(M1[0] * wx + M1[4]) / DPR, (M1[3] * wy + M1[5]) / DPR];
  // v3.7.0: sin props reales el fondo queda negro (ya no hay escenario improvisado)
  // capas ordenadas por zIndex (sin crear funciones por frame)
  const layers = _layers; layers.length = 0;
  if (st) for (const p of st.props) if (p.img || p.color || p.frames) layers.push({ z: p.z, k: 0, o: p });
  for (const role of ['gf', 'dad', 'bf']) {
    const c = Scene.chars[role], sc = sd.characters?.[role];
    if (role === 'gf' && !Optim.s.gf) continue;                                 // Optimización → GF oculta
    if (c) layers.push({ z: c.z, k: 1, o: c });
  }
  // parlantes de GF (parlantes.js), detrás de ella
  if (Speaker.cur && Optim.s.gf && Speaker.place()) layers.push({ z: Speaker.cur.z, k: 4, o: Speaker });
  // sprites creados por scripts .hxc (FunkinSprite añadidos a PlayState/escenario)
  for (const sp of ModRT.sprites) if (!sp.onHud && (direct || sp.glOk)) layers.push({ z: sp.zIndex ?? 5000, k: 3, o: sp });
  Cam.lastView = { v, zoom };
  layers.sort((a, b) => a.z - b.z);
  for (const l of layers) {
    try {
      if (l.k === 0) drawProp(l.o, v, zoom, R);
      else if (l.k === 1) { const c = l.o; c.update(); c.draw(worldMatrix(v, zoom, c.scroll[0], c.scroll[1], _cM), R); }
      else if (l.k === 4) Speaker.draw(v, zoom, R);
      else if (l.o.glOk) l.o.renderR({ v, zoom }, R);                          // v3.5.0: también con WebGL (FlxBackdrop, coches…)
      else { ctx.save(); l.o.render({ v, zoom }); ctx.restore(); }
    } catch (e) { reportOnce('capa ' + (l.o && (l.o.name || l.o.id) || l.k), e); }   // una capa rota no deja sin HUD al juego
  }
}
const _cM = [1, 0, 0, 1, 0, 0];
const _reported = new Set();
function reportOnce(key, e) { if (_reported.has(key)) return; _reported.add(key); console.error('[TestSong] error dibujando ' + key + ' (se omite):', e); }

/* v3.7.0: se quitó el escenario improvisado (cielo, ciudad, piso, focos). Quedan solo las medidas de pantalla */
const L = {};
function improvLayout() { L.floorY = H * 0.8; L.charH = H * 0.5; L.horizon = L.floorY - H * 0.26; L.oppX = W * 0.25; L.plX = W * 0.75; }

