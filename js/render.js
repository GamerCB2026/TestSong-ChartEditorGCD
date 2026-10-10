/* =====================================================================
   render.js — cómo se dibuja el MUNDO (escenario + personajes) — v3.3.0
   · "Canvas": el lienzo 2D de siempre (con ImageBitmap ya decodificados).
     Con "Resolución del mundo" < 100 % se dibuja en un lienzo más chico y se
     escala (el HUD y las notas siguen nítidos).
   · "WebGL": un <canvas> WebGL debajo del lienzo del HUD; todo el mundo se
     dibuja en lotes (pocas llamadas, sin cambios de estado del 2D). Si el
     navegador tiene WEBGL_compressed_texture_astc, las texturas ASTC se suben
     COMPRIMIDAS (sin decodificar en la CPU).
   Si en un frame hay algo que solo sabe dibujar el lienzo 2D (personaje o
   escenario improvisado, sprites de scripts .hxc en el mundo, efectos de
   cámara de los scripts) ese frame se dibuja con el lienzo directo.
   ===================================================================== */
'use strict';

/* matriz 2D [a,b,c,d,e,f]: o = p × q (q se aplica primero) — sin crear arrays */
function mmul(o, p, q) {
  const a = p[0] * q[0] + p[2] * q[1], b = p[1] * q[0] + p[3] * q[1], c = p[0] * q[2] + p[2] * q[3], d = p[1] * q[2] + p[3] * q[3];
  const e = p[0] * q[4] + p[2] * q[5] + p[4], f = p[1] * q[4] + p[3] * q[5] + p[5];
  o[0] = a; o[1] = b; o[2] = c; o[3] = d; o[4] = e; o[5] = f; return o;
}
function mset(o, a, b, c, d, e, f) { o[0] = a; o[1] = b; o[2] = c; o[3] = d; o[4] = e; o[5] = f; return o; }

/* tinte de "fallo" (CSS filter → matriz 3x3 exacta para WebGL) */
const MISS_FILTER = 'grayscale(.4) sepia(.6) hue-rotate(220deg) saturate(2) brightness(.75)';
const MISS_MATRIX = (() => {
  const mul = (A, B) => { const o = []; for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o.push(A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c]); return o; };
  const gray = a => { const k = 1 - a; return [0.2126 + 0.7874 * k, 0.7152 - 0.7152 * k, 0.0722 - 0.0722 * k, 0.2126 - 0.2126 * k, 0.7152 + 0.2848 * k, 0.0722 - 0.0722 * k, 0.2126 - 0.2126 * k, 0.7152 - 0.7152 * k, 0.0722 + 0.9278 * k]; };
  const sepia = a => { const k = 1 - a; return [0.393 + 0.607 * k, 0.769 - 0.769 * k, 0.189 - 0.189 * k, 0.349 - 0.349 * k, 0.686 + 0.314 * k, 0.168 - 0.168 * k, 0.272 - 0.272 * k, 0.534 - 0.534 * k, 0.131 + 0.869 * k]; };
  const hue = deg => { const r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
    return [0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928, 0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.140, 0.072 - c * 0.072 - s * 0.283, 0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072]; };
  const sat = s => [0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s, 0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s, 0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s];
  const bri = v => [v, 0, 0, 0, v, 0, 0, 0, v];
  // filtros en orden: el primero se aplica primero → M = B·S·H·Se·G
  return mul(bri(0.75), mul(sat(2), mul(hue(220), mul(sepia(0.6), gray(0.4)))));
})();

/* ---------- destino: lienzo 2D ---------- */
class CanvasTarget {
  constructor() { this.c = null; this.k = 1; this.kind = 'canvas'; }
  bind(c, k) { this.c = c; this.k = k; return this; }
  clear() { const c = this.c; c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.fillStyle = '#000'; c.fillRect(0, 0, c.canvas.width, c.canvas.height); }
  img(t, sx, sy, sw, sh, m, alpha, smooth, tint) {
    if (!t || alpha <= 0) return;
    const c = this.c, k = this.k;
    c.setTransform(m[0] * k, m[1] * k, m[2] * k, m[3] * k, m[4] * k, m[5] * k);
    c.globalAlpha = alpha > 1 ? 1 : alpha;
    if (c.imageSmoothingEnabled !== smooth) c.imageSmoothingEnabled = smooth;
    if (tint) c.filter = MISS_FILTER;
    blit(c, t, sx, sy, sw, sh, 0, 0, sw, sh);
    if (tint) c.filter = 'none';
  }
  rect(color, m, w, h, alpha) {
    const c = this.c, k = this.k;
    c.setTransform(m[0] * k, m[1] * k, m[2] * k, m[3] * k, m[4] * k, m[5] * k);
    c.globalAlpha = alpha > 1 ? 1 : alpha; c.fillStyle = color; c.fillRect(0, 0, w, h);
  }
  /* Canvas: solo AdjustColorShader se aproxima con un filtro CSS; los demás shaders de sprite necesitan WebGL */
  setShader(sh) { const c = this.c; c.filter = sh && sh.cssFilter ? sh.cssFilter() : 'none'; }
  done() { const c = this.c; c.globalAlpha = 1; c.imageSmoothingEnabled = true; c.filter = 'none'; }
}

/* ---------- destino: WebGL (lotes de quads) ---------- */
const GLW = {
  gl: null, cv: null, ok: false, lost: false, astc: null, astcHdr: false, max: 4096, renderer: '', isGL2: false,
  MAXQ: 2048, data: null, n: 0, cur: null, curPm: -1, curTint: -1, recs: new WeakMap(), k: 1, kind: 'webgl', warned: new Set(),
  init() {
    if (this.gl || this.failed) return this.ok;
    try {
      const cv = document.getElementById('gameGL'); if (!cv) throw new Error('sin #gameGL');
      const o = { alpha: false, antialias: false, premultipliedAlpha: true, preserveDrawingBuffer: false, depth: false, stencil: false, powerPreference: 'high-performance' };
      let gl = cv.getContext('webgl2', o); this.isGL2 = !!gl; if (!gl) gl = cv.getContext('webgl', o) || cv.getContext('experimental-webgl', o);
      if (!gl) throw new Error('WebGL no disponible');
      this.cv = cv; this.gl = gl;
      cv.addEventListener('webglcontextlost', e => { e.preventDefault(); this.lost = true; this.recs = new WeakMap(); console.warn('[WebGL] contexto perdido: se usa Canvas'); }, false);
      cv.addEventListener('webglcontextrestored', () => { this.lost = false; this.setup(); }, false);
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      this.renderer = String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
      this.software = /swiftshader|llvmpipe|softpipe|software|microsoft basic/i.test(this.renderer);
      this.max = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096;
      const ext = params.get('astc') === 'sw' ? null : gl.getExtension('WEBGL_compressed_texture_astc');
      this.astc = ext; this.astcHdr = !!(ext && ext.getSupportedProfiles && ext.getSupportedProfiles().includes('hdr'));
      this.setup();
      this.ok = true;
    } catch (e) { this.failed = true; this.ok = false; console.warn('[WebGL]', e.message); }
    return this.ok;
  },
  setup() {
    const gl = this.gl;
    const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
    const vs = 'attribute vec2 a_p;attribute vec2 a_uv;attribute vec4 a_c;uniform vec2 u_res;varying vec2 v_uv;varying vec4 v_c;' +
      'void main(){v_uv=a_uv;v_c=a_c;gl_Position=vec4(a_p.x/u_res.x*2.0-1.0,1.0-a_p.y/u_res.y*2.0,0.0,1.0);}';
    const fs = '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n' +
      'uniform sampler2D u_t;uniform float u_pm;uniform float u_tint;uniform mat3 u_cm;varying vec2 v_uv;varying vec4 v_c;' +
      'void main(){vec4 c=texture2D(u_t,v_uv);if(u_pm>0.5)c.rgb*=c.a;if(u_tint>0.5)c.rgb=min(max(u_cm*c.rgb,vec3(0.0)),vec3(c.a));gl_FragColor=c*v_c;}';
    const pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(pr, 0, 'a_p'); gl.bindAttribLocation(pr, 1, 'a_uv'); gl.bindAttribLocation(pr, 2, 'a_c');
    gl.linkProgram(pr); if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
    gl.useProgram(pr); this.pr = pr;
    this.u = { res: gl.getUniformLocation(pr, 'u_res'), pm: gl.getUniformLocation(pr, 'u_pm'), tint: gl.getUniformLocation(pr, 'u_tint'), cm: gl.getUniformLocation(pr, 'u_cm'), t: gl.getUniformLocation(pr, 'u_t') };
    gl.uniform1i(this.u.t, 0);
    // matriz de columnas (GLSL) a partir de la de filas
    const M = MISS_MATRIX; gl.uniformMatrix3fv(this.u.cm, false, new Float32Array([M[0], M[3], M[6], M[1], M[4], M[7], M[2], M[5], M[8]]));
    this.data = new Float32Array(this.MAXQ * 4 * 8);
    this.vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.vb); gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    const idx = new Uint16Array(this.MAXQ * 6);
    for (let i = 0; i < this.MAXQ; i++) { const v = i * 4, o = i * 6; idx[o] = v; idx[o + 1] = v + 1; idx[o + 2] = v + 2; idx[o + 3] = v + 1; idx[o + 4] = v + 3; idx[o + 5] = v + 2; }
    this.ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.enableVertexAttribArray(1); gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 32, 0); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 32, 8); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 32, 16);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.disable(gl.DEPTH_TEST);
    this.white = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.white);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
    this.params(gl.LINEAR);
    this.whiteRec = { tex: this.white, w: 1, h: 1, kx: 1, ky: 1, ox: 0, oy: 0, pm: 0, flip: false, filter: gl.LINEAR };
    this.recs = new WeakMap(); this.cur = null;
  },
  params(f) { const gl = this.gl; gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); },
  astcFormat(info) {
    const i = ASTC.core.FOOT.findIndex(f => f[0] === info.bw && f[1] === info.bh);
    return i < 0 ? 0 : 0x93B0 + i;   // siempre el formato "lineal": los valores salen tal cual (igual que la PNG, sin conversión sRGB)
  },
  /* registro GL de una textura (se sube la primera vez) */
  rec(t) {
    let r = this.recs.get(t);
    if (r) return r.tex ? r : null;
    const gl = this.gl;
    const par = t instanceof Tex && t.parent && t.parent.astc && this.astc ? t.parent : null;
    if (par) { const pr = this.rec(par); if (!pr) return null; r = Object.assign({}, pr, { ox: t.px, oy: t.py }); this.recs.set(t, r); return r; }
    r = { tex: null }; this.recs.set(t, r);
    try {
      if (t instanceof Tex && t.astc && this.astc && Math.max(t.astc.info.width, t.astc.info.height) <= this.max) {
        const { buf, info } = t.astc, fmt = this.astcFormat(info);
        if (fmt) {
          const size = Math.ceil(info.width / info.bw) * Math.ceil(info.height / info.bh) * 16;
          const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex); this.params(gl.LINEAR);
          gl.compressedTexImage2D(gl.TEXTURE_2D, 0, fmt, info.width, info.height, 0, new Uint8Array(buf, info.offset, size));
          if (gl.getError() === gl.NO_ERROR) { Object.assign(r, { tex, w: info.width, h: info.height, kx: 1, ky: 1, ox: 0, oy: 0, pm: 1, flip: !!info.flipY, filter: gl.LINEAR, compressed: true }); this.cur = null; return r; }
          gl.deleteTexture(tex);
        }
      }
      const src = t instanceof Tex ? t.bmp : t;
      if (!src) { if (t instanceof Tex) Tex_ensure(t); this.recs.delete(t); return null; }
      const sw = src.width, shh = src.height;
      if (Math.max(sw, shh) > this.max) {   // más grande que la GPU: se reduce (una vez, en segundo plano)
        if (!this.warned.has(t)) { this.warned.add(t); console.warn('[WebGL] textura más grande que MAX_TEXTURE_SIZE', t.path || '', sw, shh); }
        this.recs.delete(t); this.shrink(t); return null;
      }
      const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex); this.params(gl.LINEAR);
      const isBmp = typeof ImageBitmap !== 'undefined' && src instanceof ImageBitmap;
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, !isBmp);   // los ImageBitmap ya vienen premultiplicados
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      Object.assign(r, { tex, w: sw, h: shh, kx: t instanceof Tex ? t.kx : 1, ky: t instanceof Tex ? t.ky : 1, ox: 0, oy: 0, pm: 0, flip: false, filter: gl.LINEAR });
      this.cur = null;
      return r;
    } catch (e) { console.warn('[WebGL] no se pudo subir', t && t.path, e); return null; }
  },
  async shrink(t) {
    if (!(t instanceof Tex) || t.shrinking || !t.bmp) return;
    t.shrinking = true;
    const s = this.max / Math.max(t.bmp.width, t.bmp.height);
    try { const b = await createImageBitmap(t.bmp, { premultiplyAlpha: 'premultiply', resizeWidth: Math.floor(t.bmp.width * s), resizeHeight: Math.floor(t.bmp.height * s), resizeQuality: 'high' }); t.bmp = b; t.kx *= s; t.ky *= s; } catch (e) {}
    t.shrinking = false;
  },
  forget() { this.recs = new WeakMap(); this.cur = null; },
  begin(k) {
    const gl = this.gl, w = Math.max(1, Math.round(cv.width * k)), h = Math.max(1, Math.round(cv.height * k));
    if (this.cv.width !== w || this.cv.height !== h) { this.cv.width = w; this.cv.height = h; }
    this.k = k; this.n = 0; this.cur = null; this.curPm = -1; this.curTint = -1; this.sp = null;
    gl.viewport(0, 0, w, h); gl.useProgram(this.pr); gl.uniform2f(this.u.res, w, h);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vb); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ib);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); gl.activeTexture(gl.TEXTURE0);
    this.draws = 0; this.quads = 0;
  },
  clear() { /* ya se limpió en begin() */ },
  flush() {
    if (!this.n) return;
    const gl = this.gl;
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data.subarray(0, this.n * 32));
    gl.drawElements(gl.TRIANGLES, this.n * 6, gl.UNSIGNED_SHORT, 0);
    this.draws++; this.quads += this.n; this.n = 0;
  },
  use(r, smooth, tint) {
    const gl = this.gl, f = smooth ? gl.LINEAR : gl.NEAREST, ti = tint ? 1 : 0;
    if (this.cur !== r || r.filter !== f || this.curTint !== ti) {
      this.flush();
      if (this.cur !== r || r.filter !== f) { gl.bindTexture(gl.TEXTURE_2D, r.tex); if (r.filter !== f) { gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f); r.filter = f; } }
      if (this.sp) { if (this.sp.loc.openfl_TextureSize && this.cur !== r) gl.uniform2f(this.sp.loc.openfl_TextureSize.l, r.w, r.h); this.cur = r; return; }
      if (this.curPm !== r.pm) { gl.uniform1f(this.u.pm, r.pm); this.curPm = r.pm; }
      if (this.curTint !== ti) { gl.uniform1f(this.u.tint, ti); this.curTint = ti; }
      this.cur = r;
    }
  },
  quad(r, sx, sy, sw, sh, m, cr, cg, cb, ca) {
    if (this.n >= this.MAXQ) this.flush();
    const k = this.k, d = this.data, o = this.n * 32;
    const a = m[0] * k, b = m[1] * k, c = m[2] * k, dd = m[3] * k, e = m[4] * k, f = m[5] * k;
    const u0 = (r.ox + sx) * r.kx / r.w, u1 = (r.ox + sx + sw) * r.kx / r.w;
    let v0 = (r.oy + sy) * r.ky / r.h, v1 = (r.oy + sy + sh) * r.ky / r.h;
    if (r.flip) { v0 = 1 - v0; v1 = 1 - v1; }
    // (0,0) (sw,0) (0,sh) (sw,sh)
    d[o] = e; d[o + 1] = f; d[o + 2] = u0; d[o + 3] = v0;
    d[o + 8] = a * sw + e; d[o + 9] = b * sw + f; d[o + 10] = u1; d[o + 11] = v0;
    d[o + 16] = c * sh + e; d[o + 17] = dd * sh + f; d[o + 18] = u0; d[o + 19] = v1;
    d[o + 24] = a * sw + c * sh + e; d[o + 25] = b * sw + dd * sh + f; d[o + 26] = u1; d[o + 27] = v1;
    for (let i = 0; i < 4; i++) { const j = o + i * 8 + 4; d[j] = cr; d[j + 1] = cg; d[j + 2] = cb; d[j + 3] = ca; }
    this.n++;
    // shader de sprite con uFrameBounds (DropShadowShader): cada quad lleva sus propios límites
    if (this.sp && this.sp.loc.uFrameBounds) { const gl = this.gl; this.n--; this.flush(); gl.uniform4f(this.sp.loc.uFrameBounds.l, Math.min(u0, u1), Math.min(v0, v1), Math.max(u0, u1), Math.max(v0, v1)); this.n = 0;
      // el quad ya está en data[0..]: se reescribe al principio
      if (o) for (let i = 0; i < 32; i++) d[i] = d[o + i];
      this.n = 1; this.flush(); }
  },
  /* ---------- v3.5.0: shaders por sprite (character.shader / prop.shader de los scripts) ---------- */
  sp: null, spProgs: new Map(),
  spVS: 'attribute vec2 a_p;attribute vec2 a_uv;attribute vec4 a_c;uniform vec2 u_res;varying vec2 openfl_TextureCoordv;varying float openfl_Alphav;varying vec4 v_c;' +
    'void main(){openfl_TextureCoordv=a_uv;openfl_Alphav=a_c.a;v_c=a_c;gl_Position=vec4(a_p.x/u_res.x*2.0-1.0,1.0-a_p.y/u_res.y*2.0,0.0,1.0);}',
  spHeader: '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n' +
    'varying vec2 openfl_TextureCoordv;varying float openfl_Alphav;varying vec4 v_c;uniform sampler2D bitmap;uniform vec2 openfl_TextureSize;uniform bool hasTransform;uniform bool hasColorTransform;' +
    'vec4 flixel_texture2D(sampler2D b, vec2 uv){return texture2D(b,uv);}\n',
  /* programa de un shader de sprite (se compila una vez por fuente) */
  spProg(sh) {
    const key = sh.src; let P = this.spProgs.get(key);
    if (P) return P.pr ? P : null;
    P = { pr: null, loc: {} }; this.spProgs.set(key, P);
    const gl = this.gl;
    try {
      let src = String(sh.src).replace(/^\s*#version[^\n]*\n/, '').replace(/#extension[^\n]*\n/g, '');
      src = src.replace(/#pragma\s+header/g, '').replace(/#pragma\s+body/g, '');
      src = src.replace(/\bvoid\s+main\s*\(\s*(void)?\s*\)/, 'void fx_main_()');
      const fsrc = this.spHeader + src + '\nvoid main(){fx_main_();gl_FragColor*=v_c;}';
      const comp = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) { const l = gl.getShaderInfoLog(o); gl.deleteShader(o); throw new Error(l); } return o; };
      const pr = gl.createProgram(); gl.attachShader(pr, comp(gl.VERTEX_SHADER, this.spVS)); gl.attachShader(pr, comp(gl.FRAGMENT_SHADER, fsrc));
      gl.bindAttribLocation(pr, 0, 'a_p'); gl.bindAttribLocation(pr, 1, 'a_uv'); gl.bindAttribLocation(pr, 2, 'a_c'); gl.linkProgram(pr);
      if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
      const n = gl.getProgramParameter(pr, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < n; i++) { const u = gl.getActiveUniform(pr, i); P.loc[u.name.replace(/\[0\]$/, '')] = { l: gl.getUniformLocation(pr, u.name), type: u.type }; }
      P.pr = pr; return P;
    } catch (e) { sh.error = 'no compila: ' + String(e.message).split('\n').filter(Boolean).slice(0, 2).join(' · '); console.warn('[shader de sprite]', sh.name, e); return null; }
  },
  /* activa (o quita con null) el shader de sprite para lo que se dibuje a continuación */
  setShader(sh) {
    if (sh && (sh.error || !sh.src)) sh = null;
    if (this.sp ? this.sp.sh === sh : !sh) return;
    this.flush();
    const gl = this.gl;
    if (!sh) { this.sp = null; gl.useProgram(this.pr); gl.uniform2f(this.u.res, this.cv.width, this.cv.height); this.cur = null; this.curPm = -1; this.curTint = -1; return; }
    const P = this.spProg(sh); if (!P) { if (this.sp) this.setShader(null); return; }
    gl.useProgram(P.pr);
    if (P.loc.u_res) gl.uniform2f(P.loc.u_res.l, this.cv.width, this.cv.height);
    if (P.loc.bitmap) gl.uniform1i(P.loc.bitmap.l, 0);
    for (const [name, u] of Object.entries(P.loc)) {
      let v = sh.vals[name]; if (v === undefined) v = sh[name]; if (v === undefined || v === null || typeof v === "object" && !Array.isArray(v)) continue;
      const a = Array.isArray(v) ? v : [v];
      if (u.type === gl.FLOAT) gl.uniform1f(u.l, +a[0]); else if (u.type === gl.FLOAT_VEC2) gl.uniform2fv(u.l, a); else if (u.type === gl.FLOAT_VEC3) gl.uniform3fv(u.l, a); else if (u.type === gl.FLOAT_VEC4) gl.uniform4fv(u.l, a);
      else if (u.type === gl.FLOAT_MAT3) gl.uniformMatrix3fv(u.l, false, a); else if (u.type === gl.FLOAT_MAT4) gl.uniformMatrix4fv(u.l, false, a);
      else if (u.type === gl.BOOL || u.type === gl.INT) gl.uniform1i(u.l, a[0] ? (+a[0] | 0) || 1 : 0);
    }
    if (P.loc.iTime || P.loc.uTime) gl.uniform1f((P.loc.iTime || P.loc.uTime).l, Math.max(0, G.songPos) / 1000);
    this.sp = { sh, loc: P.loc }; this.cur = null; this.curPm = -1; this.curTint = -1;
  },
  img(t, sx, sy, sw, sh, m, alpha, smooth, tint, rgb) {
    if (!t || alpha <= 0) return;
    const r = this.rec(t); if (!r) return;
    this.use(r, smooth, tint);
    const a = alpha > 1 ? 1 : alpha;
    if (rgb) this.quad(r, sx, sy, sw, sh, m, a * rgb[0], a * rgb[1], a * rgb[2], a);
    else this.quad(r, sx, sy, sw, sh, m, a, a, a, a);
  },
  rect(color, m, w, h, alpha) {
    const c = cssRgba(color), a = c[3] * (alpha > 1 ? 1 : alpha);
    this.use(this.whiteRec, true, false);
    this.quad(this.whiteRec, 0, 0, 1, 1, [m[0] * w, m[1] * w, m[2] * h, m[3] * h, m[4], m[5]], c[0] * a, c[1] * a, c[2] * a, a);
  },
  done() { this.setShader(null); this.flush(); },
};
const _cssCache = new Map();
function cssRgba(col) {
  let v = _cssCache.get(col); if (v) return v;
  const c = document.createElement('canvas').getContext('2d'); c.fillStyle = '#000'; c.fillStyle = col; c.fillRect(0, 0, 1, 1);
  const d = c.getImageData(0, 0, 1, 1).data; v = [d[0] / 255, d[1] / 255, d[2] / 255, d[3] / 255]; _cssCache.set(col, v); return v;
}

const Render = {
  direct: new CanvasTarget(), low: new CanvasTarget(), lowCv: null, last: 'canvas', glShown: false, info: '',
  /* ¿qué renderizador se usa? Auto = WebGL si hay GPU de verdad (no emulada) */
  wantGL() {
    const m = typeof Optim !== 'undefined' ? Optim.s.renderer : 'auto';
    if (m === 'canvas') return false;
    if (!GLW.init() || GLW.lost) return false;
    return m === 'webgl' || !GLW.software;
  },
  maxTexSize() { return this.wantGL() ? GLW.max : 16384; },
  glAstcAvailable() { return this.wantGL() && !!GLW.astc; },
  directAstcPossible() { return this.glAstcAvailable() && params.get('astc') !== 'sw'; },
  glAstcHdr() { return GLW.astcHdr; },
  astcFits(info) { return Math.max(info.width, info.height) <= GLW.max; },
  forgetTextures() { if (GLW.gl) GLW.forget(); },
  name() { return this.wantGL() ? 'WebGL' + (GLW.astc ? ' + ASTC' : '') : 'Canvas'; },
  /* destino del mundo para este frame */
  beginWorld(needDirect) {
    const k = typeof Optim !== 'undefined' ? Optim.worldScale() : 1;
    let R;
    if (!needDirect && this.wantGL()) { GLW.begin(k); R = GLW; }
    else if (!needDirect && k < 0.999) {
      const c = this.lowCv || (this.lowCv = document.createElement('canvas')), w = Math.max(1, Math.round(cv.width * k)), h = Math.max(1, Math.round(cv.height * k));
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      R = this.low.bind(c.getContext('2d', { alpha: false }), k);
    } else R = this.direct.bind(ctx, 1);
    this.showGL(R === GLW);
    this.last = R === GLW ? 'webgl' : R === this.low ? 'canvas-bajo' : (needDirect && this.wantGL() ? 'canvas (frame especial)' : 'canvas');
    return R;
  },
  endWorld(R) {
    R.done();
    if (R === this.low) {
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.lowCv, 0, 0, cv.width, cv.height);
    }
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  },
  showGL(on) {
    if (on === this.glShown) return;
    this.glShown = on; document.body.classList.toggle('gl-on', on);
    if (GLW.cv) GLW.cv.hidden = !on;
  },
  /* precarga: sube a la GPU / calienta el lienzo con cada textura del mundo mientras se ve "Cargando…"
     (la primera vez que se dibuja una textura grande el navegador la sube: eso era un tirón en pleno juego) */
  prewarm(texs) {
    let n = 0;
    if (this.wantGL()) { GLW.begin(0.05); for (const t of texs) { const r = GLW.rec(t); if (r) { GLW.use(r, true, false); GLW.quad(r, 0, 0, 1, 1, [1, 0, 0, 1, 0, 0], 0, 0, 0, 0); n++; } } GLW.flush(); }
    else {
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
      for (const t of texs) { if (t instanceof Tex && !t.bmp) continue; blit(ctx, t, 0, 0, 1, 1, 0, 0, 1, 1); n++; }
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 2, 2); ctx.restore();
    }
    return n;
  },
};

/* texturas del mundo cargado (personajes + escenario), para la precarga */
function worldTextures() {
  const set = new Set();
  const addFrames = fr => { for (const f of fr || []) if (f && f.img) set.add(f.img); };
  for (const c of Object.values(Scene.chars)) if (c) for (const a of c.anims.values()) {
    if (a.type === 'atlas') for (const sp of a.model.sprites.values()) set.add(sp.img); else addFrames(a.frames);
  }
  if (Scene.stage) for (const p of Scene.stage.props) { if (p.img) set.add(p.img); addFrames(p.frames); if (p.anims) for (const a of p.anims.values()) addFrames(a.frames); }
  if (typeof Speaker !== 'undefined') for (const t of Speaker.textures()) set.add(t);
  return [...set];
}
