/* =====================================================================
   assets.js — carga de archivos (fetch, imágenes, Sparrow XML) y JSON por defecto.
   Si un archivo no existe se devuelve null y el juego no dibuja nada en su lugar (v3.7.0).
   Con file:// el navegador bloquea fetch(): usa GitHub Pages o un servidor local.
   ===================================================================== */
'use strict';

/* JSON por defecto (copias de data/characters/*.json y data/stages/mainStage.json): se usan si esos archivos no están */
const DEFAULT_DATA = {"characters":{"bf":{"version":"1.0.0","name":"Boyfriend","renderType":"multianimateatlas","assetPath":"shared:characters/bf","flipX":true,"offsets":[17,14],"cameraOffsets":[-18,36],"death":{"cameraOffsets":[-73,42]},"animations":[{"name":"idle","prefix":"Idle"},{"name":"singLEFT","prefix":"Left"},{"name":"singDOWN","prefix":"Down"},{"name":"singUP","prefix":"Up"},{"name":"singRIGHT","prefix":"Right"},{"name":"singLEFTmiss","prefix":"Left Miss"},{"name":"singDOWNmiss","prefix":"Down Miss"},{"name":"singUPmiss","prefix":"Up Miss"},{"name":"singRIGHTmiss","prefix":"Right Miss"},{"name":"hey","prefix":"Hey"},{"name":"cheer","prefix":"Cheer"},{"assetPath":"shared:characters/bf-death","name":"firstDeath","prefix":"Death Intro","offsets":[22,15]},{"assetPath":"shared:characters/bf-death","name":"deathLoop","prefix":"Death Loop","looped":true,"offsets":[22,15]},{"assetPath":"shared:characters/bf-death","name":"deathConfirm","prefix":"Death Confirm","offsets":[22,15]},{"assetPath":"shared:characters/bfFakeOut","name":"fakeoutDeath","prefix":"fake out death BF","animType":"symbol","offsets":[-3,-65]},{"name":"scared","prefix":"Scared"}]},"dad":{"version":"1.0.0","name":"Daddy Dearest","assetPath":"shared:characters/dad","renderType":"animateatlas","singTime":8.0,"offsets":[13,3],"cameraOffsets":[11,6],"animations":[{"name":"idle","prefix":"Idle"},{"name":"idle-hold","prefix":"Idle","frameIndices":[11,12,0,1],"looped":true},{"name":"singUP","prefix":"Up"},{"name":"singUP-hold","prefix":"Up","frameIndices":[3,4,5],"looped":true},{"name":"singDOWN","prefix":"Down"},{"name":"singLEFT","prefix":"Left"},{"name":"singLEFT-hold","prefix":"Left","frameIndices":[3,4,5],"looped":true},{"name":"singRIGHT","prefix":"Right"},{"name":"singRIGHT-hold","prefix":"Right","looped":true,"frameIndices":[3,4,5]}]},"gf":{"version":"1.0.0","name":"Girlfriend","renderType":"animateatlas","assetPath":"shared:characters/gf","startingAnimation":"danceRight","offsets":[-12,4],"cameraOffsets":[12,8],"animations":[{"name":"danceLeft","prefix":"Idle","frameIndices":[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14]},{"name":"danceRight","prefix":"Idle","frameIndices":[15,16,17,18,19,20,21,22,23,24,25,26,27,28,29]},{"name":"singLEFT","prefix":"Left"},{"name":"singDOWN","prefix":"Down"},{"name":"singUP","prefix":"Up"},{"name":"singRIGHT","prefix":"Right"},{"name":"cheer","prefix":"Cheer"},{"name":"combo50","prefix":"Cheer"},{"name":"drop70","prefix":"Crying","frameIndices":[0,1,2,3,4,5,6,7,8,9,10,11,12]},{"name":"hairBlow","prefix":"Idle (Hair blowing)","frameIndices":[0,1,2,3]},{"name":"hairFall","prefix":"Hair landing","frameIndices":[0,1,2,3,4,5,6,7,8,9,10,11]},{"name":"scared","prefix":"Fear","frameIndices":[0,1,2,3,0,1,2,3,0,1,2,3]}]}},"stages":{"mainStage":{"props":[{"danceEvery":0,"zIndex":10,"position":[-600,-200],"scale":[1,1],"animType":"sparrow","name":"stageBack","isPixel":false,"assetPath":"stageback","scroll":[0.9,0.9],"animations":[]},{"danceEvery":0,"zIndex":20,"position":[-650,600],"scale":[1.1,1.1],"animType":"sparrow","name":"stageFront","isPixel":false,"assetPath":"stagefront","scroll":[0.9,0.9],"animations":[]},{"danceEvery":0,"zIndex":30,"position":[-500,-300],"scale":[0.9,0.9],"animType":"sparrow","name":"stageCurtains","isPixel":false,"assetPath":"stagecurtains","scroll":[1.3,1.3],"animations":[]}],"cameraZoom":1.1,"version":"1.0.0","characters":{"bf":{"zIndex":300,"position":[989.5,885],"cameraOffsets":[-100,-100]},"dad":{"zIndex":200,"position":[335,885],"cameraOffsets":[150,-100]},"gf":{"zIndex":100,"cameraOffsets":[0,0],"position":[751.5,787]}},"name":"Main Stage","directory":"week1"}}};

/* Registro de lo que se encontró / faltó (se muestra en Pausa → Assets cargados) */
const AssetLog = {
  extra: new Map(),   // clave -> { ok, text }
  set(key, ok, text) { this.extra.set(key, { ok, text }); },
};

/* Progreso de carga (pantalla negra "Cargando…"): cada fetch/imagen cuenta como una tarea */
const Loader = {
  started: 0, done: 0, shown: 0, active: true, label: 'Cargando…',
  begin() { this.started++; }, end() { this.done++; },
  track(promise) { this.begin(); return Promise.resolve(promise).finally(() => this.end()); },
  // el total no se conoce de antemano (muchas rutas se prueban en cadena): se usa el total de la última carga
  expected() { try { return +localStorage.getItem('testsong-gcd-carga') || 140; } catch (e) { return 140; } },
  ratio() {
    const r = this.started ? this.done / Math.max(this.started, this.exp || 140) : 0;
    this.shown = Math.max(this.shown, Math.min(0.99, r)); return this.active ? this.shown : 1;
  },
  reset(label) { this.started = this.done = 0; this.shown = 0; this.active = true; this.label = label || 'Cargando…'; this.exp = this.expected(); },
  finish() { this.active = false; try { if (this.started > 10) localStorage.setItem('testsong-gcd-carga', String(this.started)); } catch (e) {} },
};

/* Archivos que el usuario cargó (personajes, escenario, recursos de scripts .hxc).
   Se buscan ANTES que la red con la misma ruta del juego (p. ej. shared/images/characters/bf/Animation.json). */
const VFS = {
  files: new Map(),
  norm: p => String(p || '').replace(/\\/g, '/').replace(/^\.?\//, '').replace(/^assets\//i, '').replace(/^([a-z0-9_-]+):/i, '$1/').toLowerCase(),
  put(path, blob, name) {
    const k = this.norm(path), old = this.files.get(k);
    if (old && old.url && old.blob !== blob) URL.revokeObjectURL(old.url);
    this.files.set(k, { blob, name: name || String(path).split('/').pop(), url: old && old.blob === blob ? old.url : null, path: k });
    return k;
  },
  get(path) { return this.files.get(this.norm(path)) || null; },
  has(path) { return this.files.has(this.norm(path)); },
  url(f) { return f.url || (f.url = URL.createObjectURL(f.blob)); },
  /* v3.7.0: "carpeta imaginaria" → hijos directos de una carpeta del mod (FileSystem.readDirectory) */
  list(dir) { const d = this.norm(dir).replace(/\/+$/, ''), pre = d ? d + '/' : '', out = new Set(); for (const k of [...this.files.keys(), ...(typeof ModText !== 'undefined' ? ModText.map.keys() : [])]) if (k.startsWith(pre)) out.add(k.slice(pre.length).split('/')[0]); return [...out]; },
  isDir(dir) { const d = this.norm(dir).replace(/\/+$/, '') + '/'; for (const k of this.files.keys()) if (k.startsWith(d)) return true; return false; },
  byBase(name) { name = String(name).toLowerCase(); for (const [k, f] of this.files) if (k.split('/').pop() === name) return f; return null; },
};

async function fetchFirst(list, kind) {
  Loader.begin();
  try { return await fetchFirstRaw(list, kind); } finally { Loader.end(); }
}
/* v3.3.0: si dos cargas piden la misma ruta a la vez (p. ej. bf y dad con el mismo personaje) se hace UNA petición */
const _inflight = new Map();
async function fetchShared(p) {
  let pr = _inflight.get(p);
  if (!pr) { pr = fetch(assetUrl(p), { cache: 'no-cache' }); _inflight.set(p, pr); pr.finally(() => _inflight.delete(p)).catch(() => {}); }
  return (await pr).clone();
}
async function fetchFirstRaw(list, kind) {
  for (const p of uniq(list)) {
    const f = VFS.get(p); if (!f) continue;
    try {
      if (kind === 'text') return { data: await f.blob.text(), path: p, user: true };
      if (kind === 'blob') return { data: f.blob, path: p, user: true };
      if (kind === 'buffer') return { data: await f.blob.arrayBuffer(), path: p, user: true };
      return { data: JSON.parse(await f.blob.text()), path: p, user: true };
    } catch (e) { console.warn('[VFS] archivo inválido', p, e); }
  }
  for (const p of uniq(list)) {
    // v3.3.0: una ruta que ya dio 404 no se vuelve a pedir; con texturas.json "completo" solo se piden las que existen
    if (TexLoad.missing.has(p) || (TexLoad.manifestAll && /\.(xml|json|txt|png|astc|ktx2?|jpe?g|webp)$/i.test(p) && !TexLoad.inManifest(p))) { TexLoad.stats.avoided++; continue; }
    try {
      const r = await fetchShared(p);
      if (!r.ok) { if (r.status === 404) TexLoad.missing.add(p); continue; }
      if (kind === 'text') return { data: await r.text(), path: p };
      if (kind === 'blob') return { data: await r.blob(), path: p };
      if (kind === 'buffer') return { data: await r.arrayBuffer(), path: p };
      return { data: await r.json(), path: p };
    } catch (e) { /* 404, JSON inválido o file:// */ }
  }
  return null;
}
/* Imágenes (PNG/JPG/WebP y ASTC/KTX): js/texturas.js (loadImg, Tex, blit) */
function parseAssetPath(ap) {
  const s = String(ap || ''); const i = s.indexOf(':');
  return i > 0 ? { lib: s.slice(0, i), path: s.slice(i + 1) } : { lib: 'shared', path: s };
}

/* ---------- Sparrow (portado de Chart Editor GCD js/VisualizarPersonajes.js) ---------- */
function parseSparrow(texto) {
  // Lector tolerante (como Flixel): las fuentes del juego traen nombres como "&0000" o "<0000" que no son XML válido.
  const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const ent = v => v.replace(/&(amp|lt|gt|quot|apos);/g, (m, k) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[k]);
  const frames = []; let orden = 0;
  const re = /<SubTexture\b([\s\S]*?)\/?>(?=\s*(?:<|$))/g; let m;
  while ((m = re.exec(texto))) {
    const at = {}; let a; const ra = /([\w:-]+)\s*=\s*"([^"]*)"/g;
    while ((a = ra.exec(m[1]))) at[a[1]] = ent(a[2]);
    const nombre = at.name || '';
    const x = num(at.x, 0), y = num(at.y, 0), w = num(at.width, 0), h = num(at.height, 0);
    if (w <= 0 || h <= 0) continue;
    const rot = at.rotated === 'true', dw = rot ? h : w, dh = rot ? w : h;
    const rec = 'frameX' in at;
    const offX = rec ? -num(at.frameX, 0) : 0, offY = rec ? -num(at.frameY, 0) : 0;
    let fw = rec ? num(at.frameWidth, dw) : dw, fh = rec ? num(at.frameHeight, dh) : dh;
    if (fw <= 0) fw = dw; if (fh <= 0) fh = dh;
    const mm = /(\d+)(?:\.png)?$/i.exec(nombre);
    frames.push({ nombre, x, y, w, h, rot, dw, dh, offX, offY, fw, fh, num: mm ? parseInt(mm[1], 10) : -1, orden: orden++ });
  }
  if (!frames.length) throw new Error('El XML no tiene SubTexture');
  const ip = /<TextureAtlas\b[^>]*\bimagePath\s*=\s*"([^"]*)"/.exec(texto);
  return { frames, imagePath: ip ? ip[1] : null };
}
function sparrowFrames(atlas, prefijo, indices, img) {
  const co = atlas.frames.filter(f => f.nombre.startsWith(prefijo)).sort((a, b) => (a.num - b.num) || (a.orden - b.orden));
  const out = indices && indices.length ? indices.map(i => co.find(f => f.num === i) || co[i]).filter(Boolean) : co;
  return out.map(f => Object.assign({}, f, { img }));
}
/* Dibuja un frame Sparrow con su "trim" (offX/offY) en (x,y) = esquina del frame completo */
function drawSparrowFrame(ctx, fr, x, y, sx = 1, sy = sx) {
  ctx.save(); ctx.translate(x, y); ctx.scale(sx, sy); ctx.translate(fr.offX, fr.offY);
  if (fr.rot) { ctx.translate(0, fr.dh); ctx.rotate(-Math.PI / 2); }
  blit(ctx, fr.img, fr.x, fr.y, fr.w, fr.h, 0, 0, fr.w, fr.h);
  ctx.restore();
}
/* Busca <base>.xml + <base>.png/.astc (también imagePath del XML). Devuelve { atlas, img, where } o null */
async function loadSparrowSheet(bases, opts) {
  for (const b of uniq(bases)) {
    const xml = await fetchFirst([b + '.xml'], 'text');
    if (!xml) continue;
    let atlas; try { atlas = parseSparrow(xml.data); } catch (e) { console.warn(b, e); continue; }
    const dir = b.includes('/') ? b.slice(0, b.lastIndexOf('/') + 1) : '';
    const img = await loadImg([b + '.png', ...(atlas.imagePath ? [dir + atlas.imagePath] : [])], opts);
    if (img) return { atlas, img, where: b };
  }
  return null;
}

/* Carga un gráfico de personaje: Animate Atlas (carpeta) o Sparrow (xml+png). Devuelve null si no existe. */
async function loadGraphic(ap, renderType) {
  const bases = uniq(ASSET_CFG.libImagePaths.map(t => fillT(t, ap)));
  const tryAtlas = async () => {
    for (const b of bases) {
      const an = await fetchFirst([b + '/Animation.json']);
      if (!an) continue;
      let model; try { model = atlasParsearAnimacion(an.data); } catch (e) { console.warn(b, e); continue; }
      for (let i = 1; i <= 12; i++) {
        const sm = await fetchFirst(i === 1 ? [b + '/spritemap1.json', b + '/spritemap.json'] : [`${b}/spritemap${i}.json`]);
        if (!sm) break;
        let spm; try { spm = atlasLeerSpritemap(sm.data); } catch (e) { break; }
        const png = sm.path.replace(/\.json$/, '.png');
        const img = await loadImg([spm.imagen ? b + '/' + spm.imagen : png, png], { world: true });
        if (img) atlasAgregarSpritemap(model, spm, img);
      }
      if (!model.sprites.size) continue;
      return { type: 'atlas', model, where: b };
    }
    return null;
  };
  const trySparrow = async () => {
    const s = await loadSparrowSheet(bases, { world: true });
    return s ? { type: 'sparrow', atlas: s.atlas, img: s.img, where: s.where } : null;
  };
  const rt = String(renderType || '').toLowerCase();
  return rt.includes('sparrow') ? (await trySparrow() || await tryAtlas()) : (await tryAtlas() || await trySparrow());
}

/* Tinte por luminancia (para crear receptores grises a partir de la nota de color) */
function tintCanvas(img, dark, light) {
  const c = document.createElement('canvas'); c.width = img.naturalWidth || img.width; c.height = img.naturalHeight || img.height;
  const x = c.getContext('2d'); blitAll(x, img, 0, 0);
  try {
    const d = x.getImageData(0, 0, c.width, c.height), p = d.data;
    for (let i = 0; i < p.length; i += 4) {
      const l = (0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2]) / 255;
      p[i] = dark[0] + (light[0] - dark[0]) * l; p[i + 1] = dark[1] + (light[1] - dark[1]) * l; p[i + 2] = dark[2] + (light[2] - dark[2]) * l;
    }
    x.putImageData(d, 0, 0);
  } catch (e) {   // file:// (canvas "tainted"): silueta plana
    x.globalCompositeOperation = 'source-atop'; x.fillStyle = `rgb(${light.join(',')})`; x.fillRect(0, 0, c.width, c.height);
  }
  c.naturalWidth = c.width; c.naturalHeight = c.height;
  return c;
}
