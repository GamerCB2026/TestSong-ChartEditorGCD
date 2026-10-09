/* =====================================================================
   texturas.js — TODAS las imágenes del juego pasan por aquí (v3.3.0):
   personajes (sparrow, multisparrow, Animate Atlas, multianimateatlas),
   escenario, notas, HUD, iconos, fuentes, imágenes de los .hxc, selectores
   de carpeta / zip y el panel "Assets cargados".

   · Se decodifican FUERA del hilo principal: PNG/JPG/WebP con
     createImageBitmap(blob) y ASTC/KTX en Workers (js/astc.js). Nunca se
     dibuja un <img> sin decodificar (Chrome lo decodificaba en pleno juego).
   · Resultado: un objeto Tex (ImageBitmap + tamaño lógico). Si se reduce la
     resolución (Optimización → Texturas 75/50 %) los recortes de los XML /
     JSON siguen en píxeles originales: blit() hace la conversión.
   · Hojas enormes (p. ej. BOYFRIEND 8192x4096): se recortan solo los frames
     que se usan y la hoja completa se suelta de la memoria.
   · Búsqueda sin spam de 404: cada carpeta recuerda qué formato funcionó
     (png / astc / ktx2 / ktx), una ruta que dio 404 no se vuelve a pedir y,
     si existe texturas.json (lista de archivos), solo se pide lo que hay.
   · ASTC con WebGL + WEBGL_compressed_texture_astc: la textura del mundo se
     sube COMPRIMIDA a la GPU (sin decodificar).
   ===================================================================== */
'use strict';

class Tex {
  constructor(o) { this.kx = 1; this.ky = 1; this.bmp = null; Object.assign(this, o); }
  get naturalWidth() { return this.w; } get naturalHeight() { return this.h; }
  get width() { return this.w; } get height() { return this.h; }
  get assetPath() { return this.path; } set assetPath(v) { this.path = v; }
  get ready() { return !!this.bmp; }
  dropBitmap() { if (this.bmp && this.bmp.close) { try { this.bmp.close(); } catch (e) {} } this.bmp = null; this.dropped = true; }
}

/* drawImage con el recorte en píxeles ORIGINALES (la textura puede estar reducida o recortada) */
function blit(c, t, sx, sy, sw, sh, dx, dy, dw, dh) {
  if (!t) return;
  if (t instanceof Tex) {
    const src = t.bmp;
    if (!src) { Tex_ensure(t); return; }          // ASTC solo en la GPU o hoja soltada: se prepara y se dibuja en el siguiente frame
    c.drawImage(src, sx * t.kx, sy * t.ky, sw * t.kx, sh * t.ky, dx, dy, dw, dh);
  } else c.drawImage(t, sx, sy, sw, sh, dx, dy, dw, dh);
}
function blitAll(c, t, dx, dy, dw, dh) {
  if (!t) return;
  const w = t.naturalWidth || t.width, h = t.naturalHeight || t.height;
  blit(c, t, 0, 0, w, h, dx, dy, dw ?? w, dh ?? h);
}

const TEX_FIRST = ['astc', 'ktx2', 'ktx'].includes(params.get('tex')) ? params.get('tex') : null;
const TexLoad = {
  cache: new Map(),        // ruta|escala → Promise<Tex|null>
  blobCache: new WeakMap(),// archivos del usuario
  missing: new Set(),      // rutas que dieron 404 (no se vuelven a pedir)
  probing: new Map(),    // carpeta → Promise (primera imagen probando el formato)
  dirFmt: new Map(),       // carpeta → formato que funcionó
  globalFmt: null,         // formato que usa el sitio (si una carpeta trae .astc, las demás probablemente también)
  manifest: null,          // Set de rutas de texturas.json (opcional)
  manifestAll: false,      // texturas.json con "completo": true → también filtra .xml/.json
  all: new Set(),          // texturas vivas (para el panel y precarga en la GPU)
  stats: { png: 0, astc: 0, ktx: 0, scaled: 0, cropped: 0, crops: 0, avoided: 0, http404: 0, direct: 0, errors: 0 },
  init() { try { const g = localStorage.getItem('testsong-gcd-tex'); if (['astc', 'ktx2', 'ktx'].includes(g)) this.globalFmt = g; } catch (e) {} },

  /* texturas.json (opcional, en la raíz): { "completo": true, "archivos": ["shared/images/…/spritemap1.astc", …] } */
  async loadManifest() {
    if (location.protocol === 'file:' || params.get('manifest') === '0') return;
    try {
      const r = await fetch(assetUrl(params.get('manifest') || 'texturas.json'), { cache: 'no-cache' });
      if (!r.ok) return;
      const d = await r.json(), list = Array.isArray(d) ? d : (d.archivos || d.files || []);
      if (!list.length) return;
      this.manifest = new Set(list.map(p => String(p).replace(/\\/g, '/').replace(/^\.?\//, '')));
      this.manifestAll = !!(d.completo || d.complete);
      AssetLog.set('manifest', true, `texturas.json: ${this.manifest.size} archivos → solo se piden los que existen (0 errores 404${this.manifestAll ? '' : ' en imágenes'})`);
    } catch (e) { /* sin manifiesto: búsqueda normal */ }
  },
  inManifest(p) { return !this.manifest || this.manifest.has(p); },

  /* escala de una textura: Texturas 100/75/50 % (solo personajes y escenario) y tope de tamaño */
  scaleFor(w, h, opts) {
    let s = opts && opts.world ? (typeof Optim !== 'undefined' ? Optim.texScale() : 1) : 1;
    const cap = 16384;   // límite de un ImageBitmap/canvas en la mayoría de navegadores
    if (Math.max(w, h) * s > cap) s = cap / Math.max(w, h);
    return s;
  },
  scaleKey(opts) { return (opts && opts.world ? 'w' + (typeof Optim !== 'undefined' ? Optim.texScale() : 1) + (Render.directAstcPossible() ? 'D' : '') : '1'); },
  learn(p, fmt) {
    const dir = p.slice(0, p.lastIndexOf('/') + 1);
    this.dirFmt.set(dir, fmt);
    if (fmt !== 'png' && this.globalFmt !== fmt) { this.globalFmt = fmt; try { localStorage.setItem('testsong-gcd-tex', fmt); } catch (e) {} }
  },
  extOrder(dir) {
    const pref = this.dirFmt.get(dir) || TEX_FIRST || this.globalFmt || 'png';
    const list = ['png', 'astc']; if (pref !== 'png' && pref !== 'astc') list.push(pref);
    return [pref, ...list.filter(e => e !== pref)];
  },
  made(t) {
    this.all.add(t);
    const f = t.fmt === 'png' ? 'png' : t.fmt === 'astc' ? 'astc' : 'ktx'; this.stats[f]++;
    if (t.bmp && (t.kx < 0.999 || t.ky < 0.999)) this.stats.scaled++;
    if (t.lazy) this.stats.direct++;
    return t;
  },
  /* ¿hoja "enorme"? (más de 4096x4096 px o más que el máximo de textura de la GPU) */
  isHuge(t) {
    const b = t.bmp; if (!b) return false;
    return b.width * b.height > 4096 * 4096 || Math.max(b.width, b.height) > Render.maxTexSize();
  },
  /* recorta de las hojas enormes solo los frames que se usan (objs: frames sparrow o piezas de un Animate Atlas) */
  async cropFrames(objs) {
    const groups = new Map();
    for (const o of objs) {
      const t = o && o.img;
      if (!(t instanceof Tex) || t.parent || t.lazy) continue;
      if (!t.cropCache && !this.isHuge(t)) continue;
      if (!groups.has(t)) groups.set(t, []);
      groups.get(t).push(o);
    }
    for (const [t, list] of groups) {
      t.cropCache = t.cropCache || new Map();
      const need = new Map();
      for (const o of list) { const k = o.x + ',' + o.y + ',' + o.w + ',' + o.h; if (!t.cropCache.has(k) && !need.has(k)) need.set(k, o); }
      if (need.size && !t.bmp) await Tex_ensure(t, true);
      if (need.size && t.bmp) {
        await Promise.all([...need].map(async ([k, o]) => {
          const sx = Math.max(0, Math.floor(o.x * t.kx)), sy = Math.max(0, Math.floor(o.y * t.ky));
          const sw = Math.max(1, Math.ceil((o.x + o.w) * t.kx) - sx), sh = Math.max(1, Math.ceil((o.y + o.h) * t.ky) - sy);
          try {
            const bmp = await createImageBitmap(t.bmp, sx, sy, sw, sh, { premultiplyAlpha: 'premultiply' });
            t.cropCache.set(k, new Tex({ w: o.w, h: o.h, bmp, kx: sw / o.w, ky: sh / o.h, path: t.path, fmt: t.fmt, via: t.via, parent: t, px: o.x, py: o.y }));
          } catch (e) { /* sin recorte: se dibuja desde la hoja */ }
        }));
        this.stats.crops += need.size;
      }
      if (!t.counted) { t.counted = true; this.stats.cropped++; }
      for (const o of list) { const c = t.cropCache.get(o.x + ',' + o.y + ',' + o.w + ',' + o.h); if (c) { o.img = c; o.x = 0; o.y = 0; } }
    }
  },
  /* al terminar de cargar la escena: las hojas recortadas se sueltan (memoria) */
  endScene() {
    for (const t of this.all) if (t.cropCache && t.bmp && !t.keepWhole) t.dropBitmap();
  },
  /* cambio de "Texturas" (100/75/50 %): todo se vuelve a cargar */
  reset() {
    for (const t of this.all) { if (t.cropCache) for (const c of t.cropCache.values()) c.dropBitmap(); t.dropBitmap(); }
    this.all.clear(); this.cache.clear(); this.blobCache = new WeakMap();
    for (const k of Object.keys(this.stats)) if (k !== 'http404' && k !== 'avoided') this.stats[k] = 0;
    if (typeof Render !== 'undefined') Render.forgetTextures();
  },
  statusLines() {
    const s = this.stats, out = [];
    const total = s.png + s.astc + s.ktx;
    if (total) out.push(`✔ texturas: ${total} (PNG ${s.png}${s.astc ? ', ASTC ' + s.astc : ''}${s.ktx ? ', KTX ' + s.ktx : ''}) · decodificadas fuera del hilo principal (ImageBitmap)` +
      `${s.direct ? ' · ' + s.direct + ' ASTC comprimidas directo en la GPU' : ''}${s.scaled ? ' · ' + s.scaled + ' reducidas (' + Math.round(Optim.texScale() * 100) + '%)' : ''}` +
      `${s.cropped ? ' · ' + s.cropped + ' hoja(s) enorme(s) recortada(s) en ' + s.crops + ' frames' : ''}`);
    const fm = [...this.dirFmt].filter(([, f]) => f !== 'png');
    if (fm.length || s.avoided) out.push(`✔ búsqueda de texturas: ${fm.length ? 'formato recordado en ' + fm.length + ' carpeta(s) (' + uniq(fm.map(x => x[1])).join(', ') + ')' : 'PNG'}${s.avoided ? ' · ' + s.avoided + ' peticiones 404 evitadas' : ''}${this.manifest ? ' · texturas.json' : ''}`);
    return out;
  },
};
TexLoad.init();

/* lista de rutas a probar por cada imagen pedida (x.png → x.png / x.astc / x.ktx2…, en el orden aprendido) */
function imgCandidates(list) {
  const out = [];
  for (const p of uniq(list)) {
    if (!/\.png$/i.test(p)) { out.push(p); continue; }
    const b = p.slice(0, -4), dir = p.slice(0, p.lastIndexOf('/') + 1);
    for (const e of TexLoad.extOrder(dir)) out.push(e === 'png' ? p : b + '.' + e);
    for (const e of ['.astc', '.ktx', '.ktx2']) if (VFS.has(b + e)) out.push(b + e);   // archivos del usuario
  }
  return uniq(out);
}
const imgFromUrl = url => new Promise(ok => { const img = new Image(); img.onload = () => ok(img.naturalWidth ? img : null); img.onerror = () => ok(null); img.src = url; });

/* RGBA (sin premultiplicar) → ImageBitmap premultiplicado (igual que una PNG) */
async function bitmapFromRGBA(data, w, h, s) {
  const id = new ImageData(data, w, h), o = { premultiplyAlpha: 'premultiply' };
  if (s < 1) Object.assign(o, { resizeWidth: Math.max(1, Math.round(w * s)), resizeHeight: Math.max(1, Math.round(h * s)), resizeQuality: 'high' });
  if (typeof createImageBitmap === 'function') { try { return await createImageBitmap(id, o); } catch (e) {} }
  const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').putImageData(id, 0, 0); return c;
}
async function texFromImage(blob, name, opts, head) {
  let w = 0, h = 0;
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4E && head[3] === 0x47 && head.length >= 24) { const dv = new DataView(head.buffer, head.byteOffset); w = dv.getUint32(16); h = dv.getUint32(20); }
  if (typeof createImageBitmap === 'function') {
    try {
      let s = w ? TexLoad.scaleFor(w, h, opts) : 1;
      const o = { premultiplyAlpha: 'premultiply' };
      if (s < 1) Object.assign(o, { resizeWidth: Math.max(1, Math.round(w * s)), resizeHeight: Math.max(1, Math.round(h * s)), resizeQuality: 'high' });
      let bmp = await createImageBitmap(blob, o);
      if (!w) {
        w = bmp.width; h = bmp.height; s = TexLoad.scaleFor(w, h, opts);
        if (s < 1) { const b2 = await createImageBitmap(bmp, { premultiplyAlpha: 'premultiply', resizeWidth: Math.max(1, Math.round(w * s)), resizeHeight: Math.max(1, Math.round(h * s)), resizeQuality: 'high' }); bmp.close(); bmp = b2; }
      }
      return new Tex({ w, h, bmp, kx: bmp.width / w, ky: bmp.height / h, path: name, fmt: 'png', via: 'ImageBitmap' });
    } catch (e) { /* formato que createImageBitmap no acepta: <img> */ }
  }
  const img = await imgFromUrl(URL.createObjectURL(blob)); if (!img) return null;
  try { await img.decode(); } catch (e) {}
  return new Tex({ w: img.naturalWidth, h: img.naturalHeight, bmp: img, path: name, fmt: 'png', via: '<img>' });
}
async function texFromAstc(buf, name, opts) {
  const info = ASTC.parse(buf), fmt = info.kind === 'astc' ? 'astc' : info.kind;
  const keep = opts.world && Render.glAstcAvailable() ? { buf, info } : null;   // para subirla comprimida si se usa WebGL
  if (opts.world && Render.directAstcPossible() && Render.astcFits(info)) {
    const hdr = await ASTC.hdrBlocks(buf, info);
    if (hdr && !Render.glAstcHdr()) { const m = ASTC.hdrMsg(name, hdr); ASTC.note(m); throw new Error(m); }
    ASTC.countDirect();
    return new Tex({ w: info.width, h: info.height, bmp: null, lazy: true, astc: { buf, info }, path: name, fmt, via: 'GPU directo (comprimida)' });
  }
  const r = await ASTC.decode(buf, name, { allowGpu: Loader.active });
  const bmp = await bitmapFromRGBA(r.data, r.width, r.height, TexLoad.scaleFor(r.width, r.height, opts));
  return new Tex({ w: r.width, h: r.height, bmp, kx: bmp.width / r.width, ky: bmp.height / r.height, path: name, fmt, via: r.via === 'GPU' ? 'GPU→RGBA' : 'Workers', astc: keep });
}
/* Blob (descarga o archivo del usuario) → Tex. Se reconoce por el CONTENIDO (un .astc guardado como .png también sirve) */
async function texFromBlob(blob, name, opts = {}) {
  const head = new Uint8Array(await blob.slice(0, 32).arrayBuffer());
  const t = ASTC.sniff(head) ? await texFromAstc(await blob.arrayBuffer(), name, opts) : await texFromImage(blob, name, opts, head);
  if (t) { t.srcBlob = blob; t.opts = opts; TexLoad.made(t); }
  return t;
}
/* Tex sin bitmap (ASTC solo en la GPU o hoja recortada que se soltó): se decodifica en segundo plano */
function Tex_ensure(t, wait) {
  if (t.bmp) return Promise.resolve(t);
  if (!t.ensuring) {
    t.ensuring = (async () => {
      try {
        if (t.astc) {
          const r = await ASTC.decode(t.astc.buf, t.path, { allowGpu: false });
          const bmp = await bitmapFromRGBA(r.data, r.width, r.height, TexLoad.scaleFor(r.width, r.height, t.opts || {}));
          Object.assign(t, { bmp, kx: bmp.width / t.w, ky: bmp.height / t.h, lazy: false });
        } else if (t.srcBlob) {
          const n = await texFromImage(t.srcBlob, t.path, t.opts || {}, new Uint8Array(await t.srcBlob.slice(0, 32).arrayBuffer()));
          if (n) Object.assign(t, { bmp: n.bmp, kx: n.kx, ky: n.ky });
        }
      } catch (e) { console.warn('[texturas] no se pudo preparar', t.path, e); }
      t.ensuring = null; t.dropped = false;
      return t;
    })();
  }
  return wait ? t.ensuring : null;
}

/* Blob del usuario → Tex (compatibilidad: modui / mods / usuario) */
function decodeImageBlob(blob, name, opts = {}) {
  let m = TexLoad.blobCache.get(blob); if (!m) TexLoad.blobCache.set(blob, m = new Map());
  const key = TexLoad.scaleKey(opts);
  if (!m.has(key)) m.set(key, texFromBlob(blob, String(name || 'imagen'), opts).catch(e => { ASTC.fail(String(name), e); return null; }));
  return m.get(key);
}
function loadOneImg(p, opts = {}) {
  const vf = VFS.get(p);
  if (vf) return decodeImageBlob(vf.blob, p, opts);
  const key = p + '|' + TexLoad.scaleKey(opts);
  if (TexLoad.cache.has(key)) return TexLoad.cache.get(key);
  if (TexLoad.missing.has(p) || !TexLoad.inManifest(p)) { TexLoad.stats.avoided++; return Promise.resolve(null); }
  const pr = (async () => {
    const r = await fetch(assetUrl(p), { cache: 'no-cache' }).catch(() => null);
    if (!r || !r.ok) { if (r && r.status === 404) { TexLoad.missing.add(p); TexLoad.stats.http404++; } return null; }
    const t = await texFromBlob(await r.blob(), p, opts);
    if (t) t.srcUrl = p;
    return t;
  })().catch(e => { TexLoad.stats.errors++; ASTC.fail(p, e); return null; });
  TexLoad.cache.set(key, pr);
  pr.then(t => { if (!t) TexLoad.cache.delete(key); });
  return pr;
}
/* lista de rutas (x.png…) → la primera textura que exista (o null). opts.world: personajes / escenario */
function loadImg(list, opts = {}) {
  return Loader.track((async () => {
    // carpeta todavía sin formato conocido: la primera imagen la "prueba" y las demás de esa carpeta esperan
    // (así, en una carpeta solo-ASTC, no se piden todas las .png que no existen)
    const p0 = uniq(list).find(p => /\.png$/i.test(p) && !VFS.has(p));
    let release = null;
    if (p0) {
      const dir = p0.slice(0, p0.lastIndexOf('/') + 1);
      if (!TexLoad.dirFmt.has(dir)) {
        const pr = TexLoad.probing.get(dir);
        if (pr) await pr;
        else { const d = new Promise(ok => { release = () => { TexLoad.probing.delete(dir); ok(); }; }); TexLoad.probing.set(dir, d); }
      }
    }
    try {
      let cands = imgCandidates(list);
      const user = cands.find(p => VFS.has(p));
      if (user) cands = [user, ...cands.filter(p => p !== user)];
      return await loadFirst(cands, opts);
    } finally { if (release) release(); }
  })());
}
async function loadFirst(cands, opts) {
  {
    for (const p of cands) {
      const img = await loadOneImg(p, opts).catch(() => null);
      if (img) {
        if (!VFS.has(p)) { const e = (/\.(png|astc|ktx2?)$/i.exec(p) || [])[1]; if (e) TexLoad.learn(p, e.toLowerCase()); }
        return img;
      }
    }
    return null;
  }
}
