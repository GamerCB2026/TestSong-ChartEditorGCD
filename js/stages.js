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
function propByName(name) {
  const st = Scene.stage; if (!st) return null;
  return st.props.find(x => x.name === name) || st.props.find(x => String(x.name).toLowerCase() === String(name).toLowerCase()) || null;
}
/* v3.8.0: FlxAnimationController.play del prop (lo que hace PlayAnimation sobre un prop): sin forzar, la misma
   animación sin terminar sigue; si no, empieza de nuevo. No bloquea nada (el siguiente bop la puede cortar, como en V-Slice). */
function propAnimPlay(p, anim, force) {
  const a = p && p.anims && p.anims.get(anim); if (!a) return false;
  if (!force && p.cur === anim && !propFinished(p)) return true;
  propSet(p, a); return true;
}
function propPlay(name, anim, force) { return propAnimPlay(propByName(name), anim, force); }
/* Bopper.correctAnimationName: quita "-sufijo" hasta encontrar una que exista */
function propCorrect(p, name) { while (true) { if (p.anims.has(name)) return name; const i = name.lastIndexOf('-'); if (i === -1) return null; name = name.substring(0, i); } }
/* Bopper.onStepHit → dance(shouldBop = true): props de Stage (boppers), en el orden de Stage.onScriptEvent */
function propsStep(step) {
  const st = Scene.stage; if (!st) return;
  for (const p of st.props) {
    if (!p.anims || !(p.danceEvery > 0)) continue;
    if ((step % (p.danceEvery * 4)) !== 0) continue;
    if (p.shouldAlternate == null) p.shouldAlternate = p.anims.has('danceLeft');
    let n;
    if (p.shouldAlternate) { n = p.hasDanced ? 'danceRight' : 'danceLeft'; p.hasDanced = !p.hasDanced; }
    else n = 'idle';
    const c = propCorrect(p, n + (p.idleSuffix || ''));
    if (c) propAnimPlay(p, c, true);
  }
}
/* lo que ven los eventos SetTargetBopSpeed / PlayAnimation (Stage.getNamedProp) */
function propTarget(name) {
  const p = propByName(name); if (!p) return null;
  return p.__vs || (p.__vs = { isBopper: !!p.anims, isCharacter: false, name: p.name,
    get danceEvery() { return p.danceEvery || 0; }, set danceEvery(v) { p.danceEvery = +v; },
    playPropAnimation(anim, force) { propAnimPlay(p, String(anim), !!force); },
    animation: { play: (anim, force = false) => propAnimPlay(p, String(anim), !!force) } });
}
function propsReset() {
  const st = Scene.stage; if (!st) return;
  for (const p of st.props) {
    if (p.danceEvery0 === undefined) p.danceEvery0 = p.danceEvery; else p.danceEvery = p.danceEvery0;
    p.hasDanced = false;
    if (p.anims && p.cur) { p.t0 = 0; }
  }
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

/* ---------- Cámara del mundo = FlxG.camera de PlayState (vslice.js) ----------
   v3.8.0: Cam es solo una vista de VS.play: scroll + seguimiento LOCKON con lerp 0.04 ajustado por elapsed,
   tweens de FlxTween, currentCameraZoom × cameraBopMultiplier. x/y = centro de la vista (scroll + 640/360). */
const Cam = {
  get P() { return VS.play; },
  get x() { return this.P.camera.scroll.x + 640; }, set x(v) { this.P.camera.scroll.x = +v - 640; },
  get y() { return this.P.camera.scroll.y + 360; }, set y(v) { this.P.camera.scroll.y = +v - 360; },
  get zoom() { return this.P.currentCameraZoom; }, set zoom(v) { this.P.currentCameraZoom = +v; },
  get viewZoom() { return this.P.camera.zoom; }, set viewZoom(v) { this.P.camera.zoom = +v; },
  get bop() { return this.P.cameraBopMultiplier; }, set bop(v) { this.P.cameraBopMultiplier = +v; },
  get stageZoom() { return this.P.stageZoom; }, set stageZoom(v) { this.P.stageZoom = +v; },
  get zoomRate() { return this.P.cameraZoomRate; }, set zoomRate(v) { this.P.cameraZoomRate = +v; },
  get zoomOffset() { return this.P.cameraZoomRateOffset; }, set zoomOffset(v) { this.P.cameraZoomRateOffset = +v; },
  get bopIntensity() { return this.P.cameraBopIntensity; }, set bopIntensity(v) { this.P.cameraBopIntensity = +v; },
  get hudIntensity() { return this.P.hudCameraZoomIntensity; }, set hudIntensity(v) { this.P.hudCameraZoomIntensity = +v; },
  get follow() { const f = this.P.cameraFollowPoint; return [f.x, f.y]; },
  get tween() { const t = this.P.cameraFollowTween; return t && t.active ? t : null; },
  get zoomTween() { const t = this.P.cameraZoomTween; return t && t.active ? t : null; },
  /* CLASSIC de FocusCamera: el punto se mueve y la cámara lo sigue con lerp (null = volver al enfoque automático) */
  followTo(x, y) {
    if (x === null || x === undefined) { G.autoFocus = true; return; }
    G.autoFocus = false; this.P.resetCamera(false, false, false); this.P.cancelCameraFollowTween(); this.P.cameraFollowPoint.setPosition(+x, +y);
  },
  /* tweenCameraToPosition (dur en ms; 0 = al instante) */
  tweenTo(x, y, durMs, ease) { G.autoFocus = false; this.P.tweenCameraToPosition(+x, +y, Math.max(0, +durMs || 0) / 1000, ease || null); },
  zoomTo(z, durMs, ease) { this.P.tweenCameraZoom(+z, Math.max(0, +durMs || 0) / 1000, true, ease || null); },
};

/* punto de enfoque de un personaje (cameraFocusPoint); si no hay assets, la posición del escenario */
function focusPoint(role) {
  const c = Scene.chars[role]; if (c) return c.camPoint();
  const sc = Scene.stage?.data?.characters?.[role] || DEFAULT_DATA.stages.mainStage.characters[role];
  return sc ? [sc.position[0] + (sc.cameraOffsets?.[0] || 0), sc.position[1] - 200 + (sc.cameraOffsets?.[1] || 0)] : null;
}

const _view = { k: 1, vx: 0, vy: 0, zoom: 1 }, _pz = +params.get('zoom') || 1;   // ?zoom=0.8 para alejar la cámara
function worldView(dt) {
  const pz = _pz;
  // igual que el juego: 1280x720 escalado para caber; lo que sobra a los lados muestra más escenario
  // (en celular horizontal la pantalla se ensancha como en V-Slice móvil)
  const k = V.s, vx = (W - 1280 * V.s) / 2, vy = (H - 720 * V.s) / 2, zoom = Cam.viewZoom * pz;
  void dt;
  _view.k = k; _view.vx = vx; _view.vy = vy; _view.zoom = zoom; return _view;   // (sin objeto nuevo por frame)
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

const _layers = [], _layerPool = [];
/* (rendimiento: objetos de capa reutilizados; antes se creaba uno por prop/personaje en cada frame) */
function pushLayer(z, k, o) { const i = _layers.length; const l = _layerPool[i] || (_layerPool[i] = { z: 0, k: 0, o: null, i: 0 }); l.z = z; l.k = k; l.o = o; l.i = i; _layers.push(l); }
const _byZ = (a, b) => (a.z - b.z) || (a.i - b.i);
const _roles = ['gf', 'dad', 'bf'];
function renderWorld(dt, bump, R) {
  const v = worldView(dt), zoom = v.zoom * bump;
  const st = Scene.stage;
  const direct = R.kind === 'canvas' && R.c === ctx;
  // fondo base (por si los props no cubren la pantalla)
  R.clear();
  // v3.7.0: sin props reales el fondo queda negro (ya no hay escenario improvisado)
  // capas ordenadas por zIndex (sin crear funciones por frame)
  const layers = _layers; layers.length = 0;
  if (st) { const ps = st.props; for (let i = 0; i < ps.length; i++) { const p = ps[i]; if (p.img || p.color || p.frames) pushLayer(p.z, 0, p); } }
  for (let r = 0; r < 3; r++) {
    const role = _roles[r], c = Scene.chars[role];
    if (role === 'gf' && !Optim.s.gf) continue;                                 // Optimización → GF oculta
    if (c) pushLayer(c.z, 1, c);
  }
  // parlantes de GF (parlantes.js), detrás de ella
  if (Speaker.cur && Optim.s.gf && Speaker.place()) pushLayer(Speaker.cur.z, 4, Speaker);
  // sprites creados por scripts .hxc (FunkinSprite añadidos a PlayState/escenario)
  const ms = ModRT.sprites; for (let i = 0; i < ms.length; i++) { const sp = ms[i]; if (!sp.onHud && (direct || sp.glOk)) pushLayer(sp.zIndex ?? 5000, 3, sp); }
  const lv = Cam.lastView || (Cam.lastView = { v: null, zoom: 1 }); lv.v = v; lv.zoom = zoom;
  layers.sort(_byZ);
  for (let li = 0; li < layers.length; li++) {
    const l = layers[li];
    try {
      if (l.k === 0) drawProp(l.o, v, zoom, R);
      else if (l.k === 1) { const c = l.o; c.update(); c.draw(worldMatrix(v, zoom, c.scroll[0], c.scroll[1], _cM), R); }
      else if (l.k === 4) Speaker.draw(v, zoom, R);
      else if (l.o.glOk) l.o.renderR(lv, R);                          // v3.5.0: también con WebGL (FlxBackdrop, coches…)
      else { ctx.save(); l.o.render(lv); ctx.restore(); }
    } catch (e) { reportOnce('capa ' + (l.o && (l.o.name || l.o.id) || l.k), e); }   // una capa rota no deja sin HUD al juego
  }
}
const _cM = [1, 0, 0, 1, 0, 0];
const _reported = new Set();
function reportOnce(key, e) { if (_reported.has(key)) return; _reported.add(key); console.error('[TestSong] error dibujando ' + key + ' (se omite):', e); }

/* v3.7.0: se quitó el escenario improvisado (cielo, ciudad, piso, focos). Quedan solo las medidas de pantalla */
const L = {};
function improvLayout() { L.floorY = H * 0.8; L.charH = H * 0.5; L.horizon = L.floorY - H * 0.26; L.oppX = W * 0.25; L.plX = W * 0.75; }

