/* =====================================================================
   shaders.js — "Cargar shaders" (v3.4.0): post-proceso WebGL con shaders
   GLSL estilo Flixel/OpenFL (FlxRuntimeShader / FlxShader):
     #pragma header, bitmap, openfl_TextureCoordv, openfl_TextureSize,
     flixel_texture2D(), iTime / iResolution (estilo Shadertoy)…
   · El usuario asigna el .hxc del shader: si usa Paths.frag("x") / Paths.vert("x")
     se buscan en shaders/ (carpeta del sitio) y, si faltan, se piden.
   · También se puede cargar un .frag (y .vert) directamente.
   · Se aplica a la cámara del juego (mundo) o a todo; respeta Optimización → Shaders
     y solo funciona con WebGL. Si no compila, se avisa y se desactiva (el juego sigue).
   ===================================================================== */
'use strict';

const SHADER_DIRS = ['shaders/', 'shared/shaders/', 'assets/shaders/', 'assets/shared/shaders/', 'preload/shaders/'];

const Shaders = {
  list: [],           // [{ id, name, frag, vert, needFrag, needVert, uniforms, timeU, target, on, error, prog }]
  gl: null, cv: null, failed: false, lastError: '', target: 'mundo',
  /* ---------- carga ---------- */
  async addHxc(file) {
    const text = await file.text();
    const fr = [...text.matchAll(/Paths\.frag\(\s*["']([^"']+)["']/g)].map(m => m[1]);
    const vr = [...text.matchAll(/Paths\.vert\(\s*["']([^"']+)["']/g)].map(m => m[1]);
    const inl = /(?:FlxRuntimeShader|FlxShader)\s*\(\s*(['"])([\s\S]*?#pragma header[\s\S]*?)\1/.exec(text);   // shader escrito dentro del .hxc
    const uniforms = {};
    for (const m of text.matchAll(/set(Float|Int|Bool)\(\s*["'](\w+)["']\s*,\s*(-?[\d.]+|true|false)\s*\)/g)) uniforms[m[2]] = m[1] === 'Bool' ? m[3] === 'true' : +m[3];
    const timeU = [...text.matchAll(/set(?:Float)\(\s*["'](\w+)["']\s*,\s*[^)]*(?:elapsed|time|songPosition|Conductor)/gi)].map(m => m[1]);
    const sh = { id: file.name.replace(/\.hxc$/i, ''), name: file.name, frag: inl ? inl[2] : null, vert: null, fragKey: fr[0] || null, vertKey: vr[0] || null, uniforms, timeU, on: true, error: '' };
    if (!sh.frag && !sh.fragKey) { sh.error = 'el .hxc no usa Paths.frag(…) ni trae el shader dentro: carga el .frag directamente'; }
    this.list.push(sh);
    await this.fetchDefaults(sh);
    this.rebuild(sh);
    return sh;
  },
  async addFrag(files) {
    const frag = files.find(f => /\.(frag|glsl)$/i.test(f.name)), vert = files.find(f => /\.vert$/i.test(f.name));
    if (!frag) { toast('Elige un .frag (y su .vert si lo tiene)'); return null; }
    const sh = { id: frag.name.replace(/\.\w+$/, ''), name: frag.name, frag: await frag.text(), vert: vert ? await vert.text() : null, fragKey: null, vertKey: null, uniforms: {}, timeU: [], on: true, error: '' };
    this.list.push(sh); this.rebuild(sh); return sh;
  },
  /* shaders por defecto: carpeta shaders/ del sitio (o la ruta del juego) */
  async fetchDefaults(sh) {
    const get = async key => { const r = await fetchFirst(SHADER_DIRS.map(d => d + key), 'text').catch(() => null); return r ? r.data : null; };
    if (sh.fragKey && !sh.frag) { const f = VFS.get('shaders/' + sh.fragKey + '.frag'); sh.frag = f ? await f.blob.text() : await get(sh.fragKey + '.frag'); }
    if (sh.vertKey && !sh.vert) { const f = VFS.get('shaders/' + sh.vertKey + '.vert'); sh.vert = f ? await f.blob.text() : await get(sh.vertKey + '.vert'); }
  },
  requirements() {
    const out = [];
    for (const sh of this.list) {
      if (sh.fragKey) out.push({ type: 'shader', key: sh.fragKey + '.frag', sh, part: 'frag', from: sh.name });
      if (sh.vertKey) out.push({ type: 'shader', key: sh.vertKey + '.vert', sh, part: 'vert', from: sh.name });
    }
    return out;
  },
  reqStatus(r) { return r.sh[r.part] ? 'ok' : 'missing'; },
  async provide(r, files) {
    const f = files.find(x => new RegExp('\\.' + r.part + '$', 'i').test(x.name)) || files[0]; if (!f) return;
    r.sh[r.part] = await f.text();
    VFS.put('shaders/' + r.key, f, f.name);
    this.rebuild(r.sh);
  },
  remove(i) { const sh = this.list[i]; if (sh && sh.prog && this.gl) this.gl.deleteProgram(sh.prog); this.list.splice(i, 1); },

  /* ---------- WebGL ---------- */
  init() {
    if (this.gl || this.failed) return !!this.gl;
    try {
      this.cv = document.createElement('canvas');
      const gl = this.cv.getContext('webgl', { premultipliedAlpha: true, alpha: false, antialias: false, preserveDrawingBuffer: false });
      if (!gl) throw new Error('WebGL no disponible');
      this.gl = gl;
      this.vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.vb);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 0, 0, 1, -1, 1, 0, -1, 1, 0, 1, 1, 1, 1, 1]), gl.STATIC_DRAW);
      this.tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      this.cv.addEventListener('webglcontextlost', e => { e.preventDefault(); this.lost = true; });
      return true;
    } catch (e) { this.failed = true; this.lastError = e.message; return false; }
  },
  FRAG_HEADER: `#ifdef GL_ES
precision mediump float;
#endif
varying float openfl_Alphav;
varying vec4 openfl_ColorMultiplierv;
varying vec4 openfl_ColorOffsetv;
varying vec2 openfl_TextureCoordv;
uniform bool openfl_HasColorTransform;
uniform vec2 openfl_TextureSize;
uniform sampler2D bitmap;
uniform bool hasTransform;
uniform bool hasColorTransform;
vec4 flixel_texture2D(sampler2D b, vec2 uv) { return texture2D(b, uv); }
`,
  VERT_HEADER: `attribute float openfl_Alpha;
attribute vec4 openfl_ColorMultiplier;
attribute vec4 openfl_ColorOffset;
attribute vec4 openfl_Position;
attribute vec2 openfl_TextureCoord;
varying float openfl_Alphav;
varying vec4 openfl_ColorMultiplierv;
varying vec4 openfl_ColorOffsetv;
varying vec2 openfl_TextureCoordv;
uniform mat4 openfl_Matrix;
uniform bool openfl_HasColorTransform;
uniform vec2 openfl_TextureSize;
`,
  VERT_BODY: `openfl_Alphav = openfl_Alpha; openfl_TextureCoordv = openfl_TextureCoord; openfl_ColorMultiplierv = vec4(1.0); openfl_ColorOffsetv = vec4(0.0); gl_Position = openfl_Matrix * openfl_Position;`,
  prep(src, header, body) {
    let s = String(src || '').replace(/^\s*#version[^\n]*\n/, '');
    const hasHeader = /#pragma\s+header/.test(s);
    s = s.replace(/#pragma\s+header/g, header).replace(/#pragma\s+body/g, body || '');
    if (!hasHeader) s = (/precision\s+\w+\s+float/.test(s) ? '' : '#ifdef GL_ES\nprecision mediump float;\n#endif\n') + s;
    return s;
  },
  rebuild(sh) {
    sh.prog = null; sh.error = sh.error && !sh.frag ? sh.error : '';
    if (!sh.frag) { if (!sh.error) sh.error = `falta ${sh.fragKey}.frag`; return; }
    if (sh.vertKey && !sh.vert) { sh.error = `falta ${sh.vertKey}.vert`; return; }
    if (!this.init()) { sh.error = 'WebGL no disponible: ' + this.lastError; return; }
    const gl = this.gl;
    const comp = (type, src) => { const o = gl.createShader(type); gl.shaderSource(o, src); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) { const l = gl.getShaderInfoLog(o); gl.deleteShader(o); throw new Error(l || 'error de compilación'); } return o; };
    try {
      const fs = comp(gl.FRAGMENT_SHADER, this.prep(sh.frag, this.FRAG_HEADER));
      const vsSrc = sh.vert ? this.prep(sh.vert, this.VERT_HEADER, this.VERT_BODY) : this.VERT_HEADER + 'void main(void) {\n' + this.VERT_BODY + '\n}';
      const vs = comp(gl.VERTEX_SHADER, vsSrc);
      const pr = gl.createProgram(); gl.attachShader(pr, vs); gl.attachShader(pr, fs);
      gl.bindAttribLocation(pr, 0, 'openfl_Position'); gl.linkProgram(pr);
      if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr) || 'error al enlazar');
      sh.prog = pr; sh.loc = {};
      const n = gl.getProgramParameter(pr, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < n; i++) { const u = gl.getActiveUniform(pr, i); sh.loc[u.name.replace(/\[0\]$/, '')] = { l: gl.getUniformLocation(pr, u.name), type: u.type }; }
      sh.aPos = gl.getAttribLocation(pr, 'openfl_Position'); sh.aUV = gl.getAttribLocation(pr, 'openfl_TextureCoord'); sh.aAlpha = gl.getAttribLocation(pr, 'openfl_Alpha');
      sh.error = '';
    } catch (e) { sh.error = 'no compila: ' + String(e.message).split('\n').filter(Boolean).slice(0, 3).join(' · '); sh.prog = null; console.warn('[shader]', sh.name, e); }
  },
  active() { return Optim.s.shaders && Render.wantGL() && this.list.some(s => s.on && s.prog); },
  /* aplica los shaders activos a src (lienzo con el mundo) y deja el resultado en ctx */
  apply(src, region) {
    if (!this.active() || !this.init() || this.lost) return false;
    const gl = this.gl, w = src.width, h = src.height;
    if (this.cv.width !== w || this.cv.height !== h) { this.cv.width = w; this.cv.height = h; }
    gl.viewport(0, 0, w, h);
    let first = true, drawn = 0;
    gl.getError();                                              // limpia errores viejos
    for (const sh of this.list) {
      if (!sh.on || !sh.prog) continue;
      try {
        gl.bindTexture(gl.TEXTURE_2D, this.tex);
        // cada pasada lee el resultado anterior (encadenado como camera.filters); el lienzo no tiene alfa → RGB
        if (first) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
        else gl.copyTexImage2D(gl.TEXTURE_2D, 0, gl.RGB, 0, 0, w, h, 0);
        gl.useProgram(sh.prog);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vb);
        if (sh.aPos >= 0) { gl.enableVertexAttribArray(sh.aPos); gl.vertexAttribPointer(sh.aPos, 2, gl.FLOAT, false, 16, 0); }
        if (sh.aUV >= 0) { gl.enableVertexAttribArray(sh.aUV); gl.vertexAttribPointer(sh.aUV, 2, gl.FLOAT, false, 16, 8); }
        if (sh.aAlpha >= 0) { gl.disableVertexAttribArray(sh.aAlpha); gl.vertexAttrib1f(sh.aAlpha, 1); }
        const t = Math.max(0, G.songPos) / 1000;
        for (const [name, u] of Object.entries(sh.loc)) {
          const L = u.l;
          if (name === 'bitmap' || name === 'iChannel0') gl.uniform1i(L, 0);
          else if (name === 'openfl_Matrix') gl.uniformMatrix4fv(L, false, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
          else if (name === 'openfl_TextureSize') gl.uniform2f(L, w, h);
          else if (name === 'iResolution') { if (u.type === gl.FLOAT_VEC3) gl.uniform3f(L, w, h, 1); else gl.uniform2f(L, w, h); }
          else if (/^(iTime|time|uTime|iGlobalTime)$/.test(name) || sh.timeU.includes(name)) { if (u.type === gl.FLOAT) gl.uniform1f(L, t); }
          else if (name in sh.uniforms && u.type === gl.FLOAT) gl.uniform1f(L, +sh.uniforms[name]);
          else if (name in sh.uniforms && (u.type === gl.BOOL || u.type === gl.INT)) gl.uniform1i(L, sh.uniforms[name] ? 1 : 0);
        }
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        const e = gl.getError(); if (e !== gl.NO_ERROR && e !== gl.CONTEXT_LOST_WEBGL) throw new Error('WebGL error ' + e);
        first = false; drawn++;
      } catch (e) {
        // solo se apaga el shader que falló; el juego y los demás siguen
        sh.on = false; sh.error = 'error al aplicar: ' + e.message;
        toast(`Shader ${sh.name} desactivado: ${e.message}`, 4000); console.warn('[shader]', sh.name, e);
      }
    }
    if (!drawn) return false;
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1;
    ctx.drawImage(this.cv, 0, 0, cv.width, cv.height);
    ctx.restore();
    return true;
  },
  statusLines() {
    return this.list.map(sh => sh.prog ? `✔ shader ${sh.name}${sh.on && Optim.s.shaders ? '' : ' (apagado)'}${Render.wantGL() ? '' : ' — necesita WebGL (Optimización → Render)'}` : `✘ shader ${sh.name}: ${sh.error}`);
  },
};

/* =====================================================================
   v3.5.0 — shaders POR SPRITE (character.shader / getNamedProp(...).shader
   de los scripts de escenario). Clases del juego portadas de funkin:
   AdjustColorShader (usa shaders/adjustColor.frag del sitio) y
   DropShadowShader (luz de borde; su GLSL va dentro de la clase en el juego).
   Solo con Render WebGL; en Canvas AdjustColor se aproxima con un filtro CSS.
   ===================================================================== */
const SPR_FRAG = {
  // copia de shaders/adjustColor.frag (se reemplaza por la del sitio si existe)
  adjustColor: `#pragma header
uniform mat3 hueMatrix;
uniform float contrast;
uniform mat3 saturationMatrix;
uniform float brightness;
vec3 applyHSBCEffect(vec3 color)
{
  vec3 bh = (brightness + color) * hueMatrix;
  vec3 c = (bh - 0.25) * contrast + 0.25;
  vec3 s = c * saturationMatrix;
  return s;
}
void main()
{
  vec4 color4 = texture2D(bitmap, openfl_TextureCoordv);
  vec3 color3 = color4.a > 0.0 ? color4.rgb / color4.a : color4.rgb;
  color3 = applyHSBCEffect(color3);
  gl_FragColor = vec4(color3 * color4.a, color4.a);
}`,
  // DropShadowShader.hx (funkin) — sin derivadas (fwidth) para WebGL1
  dropShadow: `#pragma header
uniform vec4 uFrameBounds;
uniform float dist;
uniform float str;
uniform float thr;
uniform float angCos;
uniform float angSin;
uniform sampler2D altMask;
uniform bool useMask;
uniform float thr2;
uniform vec3 dropColor;
uniform mat3 hueMatrix;
uniform float contrast;
uniform mat3 saturationMatrix;
uniform float brightness;
const vec3 lumaValue = vec3(0.2126, 0.7152, 0.0722);
vec3 applyHSBCEffect(vec3 color)
{
  vec3 bh = (brightness + color) * hueMatrix;
  vec3 c = (bh - 0.25) * contrast + 0.25;
  vec3 s = c * saturationMatrix;
  return s;
}
float getLumaRGB(vec3 color) { return dot(color.rgb, lumaValue); }
vec4 getTexRGBA(vec2 uv) { return texture2D(bitmap, uv); }
float lwidth_manual(float center, vec2 uv, vec2 px)
{
  float right = getLumaRGB(getTexRGBA(uv + vec2(1.0, 0.0) * px).rgb);
  float down = getLumaRGB(getTexRGBA(uv + vec2(0.0, 1.0) * px).rgb);
  float diagonal = getLumaRGB(getTexRGBA(uv + vec2(1.0, 1.0) * px).rgb);
  float dx = abs(right - center); float dy = abs(down - center); float dd = abs(diagonal - center);
  return ((dx + dy + dd * 0.7) / (1.0 + 1.0 + 0.7)) * 2.0;
}
float getThreshold(vec2 uv)
{
  float threshold = thr;
  if (useMask) { if (texture2D(altMask, uv).b > 0.0) threshold = thr2; }
  return threshold;
}
vec4 createDropShadowEx(vec2 uv, vec2 ratio, vec2 size)
{
  vec4 color4 = texture2D(bitmap, uv);
  vec2 px = ratio;
  float color3_light = getLumaRGB(color4.rgb);
  float delta = lwidth_manual(color3_light, uv, px);
  float threshold = getThreshold(uv);
  float intensity = smoothstep(threshold - delta, threshold + delta, color3_light);
  float shadowAlpha = 0.0;
  vec3 color3_no_effect = color4.a > 0.0 ? color4.rgb / color4.a : color4.rgb;
  vec3 color3 = applyHSBCEffect(color3_no_effect);
  vec2 checked = vec2(uv.x + (dist * angCos * ratio.x), uv.y - (dist * angSin * ratio.y));
  if (checked.x > uFrameBounds.x && checked.y > uFrameBounds.y && checked.x < uFrameBounds.z && checked.y < uFrameBounds.w)
    shadowAlpha = texture2D(bitmap, checked).a;
  float rim = (1.0 - (shadowAlpha * str)) * intensity;
  color3 += dropColor * rim;
  return vec4(color3 * color4.a, color4.a);
}
void main()
{
  gl_FragColor = createDropShadowEx(openfl_TextureCoordv, 1.0 / openfl_TextureSize.xy, openfl_TextureSize.xy);
}`,
};
/* clases de shader del juego (funkin.graphics.shaders.*) que usan un .frag de shaders/ */
const SPR_CLASS_FRAG = { RuntimeRainShader: 'rain', PuddleShader: 'puddle', BuildingShader: 'building', WiggleEffect: 'wiggle', WiggleEffectRuntime: 'wiggle', MosaicEffect: 'mosaic',
  GaussianBlurShader: 'gaussianBlur', GrayscaleShader: 'grayscale', HSVShader: 'hsv', InverseDotsShader: 'InverseDots', PixelateShader: 'pixel', BlendModesShader: 'customBlend', RuntimeCustomBlendShader: 'customBlend' };
async function loadSprFrag(key) {
  const f = VFS.get('shaders/' + key + '.frag'); if (f) return f.blob.text();
  const r = await fetchFirstRaw(SHADER_DIRS.map(d => d + key + '.frag'), 'text').catch(() => null);
  return r ? r.data : null;
}
const sprHue = h => { const c = Math.cos(h), s = Math.sin(h), wR = 0.299, wG = 0.587, wB = 0.114;
  return [wR + (1 - wR) * c - wR * s, wG - wG * c - wG * s, wB - wB * c + (1 - wB) * s, wR - wR * c + 0.143 * s, wG + (1 - wG) * c + 0.140 * s, wB - wB * c - 0.283 * s, wR - wR * c - (1 - wR) * s, wG - wG * c + wG * s, wB + (1 - wB) * c + wB * s]; };
const sprSat = s => { const lr = 0.2126, lg = 0.7152, lb = 0.0722, i = 1 - s; return [lr * i + s, lg * i, lb * i, lr * i, lg * i + s, lb * i, lr * i, lg * i, lb * i + s]; };
const sprSatVal = v => { if (v > 0) v *= 3; return 1 + v / 100; };
const sprConVal = v => { v = 1 + v / 100; if (v > 1) v = (((0.00852259 * Math.pow(Math.E, 4.76454 * (v - 1))) * 1.01) - 0.0086078159) * 10 + 1; return v; };
class SprShader {
  constructor(src, name) { this.src = src || null; this.name = name || 'FlxRuntimeShader'; this.vals = {}; this.error = ''; this.__host = name || 'FlxRuntimeShader'; this.__open = true; }
  setFloat(n, v) { this.vals[n] = +v; } setInt(n, v) { this.vals[n] = +v | 0; } setBool(n, v) { this.vals[n] = !!v; }
  setFloatArray(n, a) { this.vals[n] = Array.from(a || [], Number); } setIntArray(n, a) { this.setFloatArray(n, a); } setBoolArray(n, a) { this.vals[n] = Array.from(a || []); }
  getFloat(n) { const v = this.vals[n]; return v === undefined ? null : +v; } getInt(n) { return this.getFloat(n); } getBool(n) { return !!this.vals[n]; }
  setSampler2D() { HX.note(`${this.name}.setSampler2D (textura extra) no se imita`); }
  get data() { return this; }
  cssFilter() { return 'none'; }
  /* frag de shaders/ (asíncrono) */
  fromKey(key) { this.fragKey = key; loadSprFrag(key).then(t => { if (t) this.src = t; else this.error = `falta shaders/${key}.frag`; }); return this; }
}
class AdjustColorShaderJS extends SprShader {
  constructor() {
    super(SPR_FRAG.adjustColor, 'AdjustColorShader');
    if (SPR_FRAG.siteAdjust) this.src = SPR_FRAG.siteAdjust;
    this._h = this._s = this._b = this._c = 0; this.hue = 0; this.saturation = 0; this.brightness = 0; this.contrast = 0;
  }
  get hue() { return this._h; } set hue(v) { this._h = +v || 0; this.vals.hueMatrix = sprHue(this._h * Math.PI / 180); }
  get saturation() { return this._s; } set saturation(v) { this._s = +v || 0; this.vals.saturationMatrix = sprSat(sprSatVal(this._s)); }
  get brightness() { return this._b; } set brightness(v) { this._b = +v || 0; this.vals.brightness = this._b / 255; }
  get contrast() { return this._c; } set contrast(v) { this._c = +v || 0; this.vals.contrast = sprConVal(this._c); }
  cssFilter() { return `hue-rotate(${this._h}deg) saturate(${sprSatVal(this._s)}) brightness(${Math.max(0, 1 + this._b / 255)}) contrast(${sprConVal(this._c)})`; }
  toString() { return `AdjustColorShader(${this._h}, ${this._s}, ${this._b}, ${this._c})`; }
}
class DropShadowShaderJS extends SprShader {
  constructor() {
    super(SPR_FRAG.dropShadow, 'DropShadowShader');
    this._ang = 0; this._angOff = 0; this.attachedSprite = null;
    this.angle = 0; this.distance = 15; this.strength = 1; this.threshold = 0.1; this.color = 0xFF000000; this.useAltMask = false; this.maskThreshold = 0;
    this.setAdjustColor(0, 0, 0, 0);
  }
  upd() { const a = (this._ang + this._angOff) * Math.PI / 180; this.vals.angCos = Math.cos(a); this.vals.angSin = Math.sin(a); }
  get angle() { return this._ang; } set angle(v) { this._ang = +v || 0; this.upd(); }
  get angleOffset() { return this._angOff; } set angleOffset(v) { this._angOff = +v || 0; this.upd(); }
  get distance() { return this.vals.dist; } set distance(v) { this.vals.dist = +v || 0; }
  get strength() { return this.vals.str; } set strength(v) { this.vals.str = +v; }
  get threshold() { return this.vals.thr; } set threshold(v) { this.vals.thr = +v; }
  get maskThreshold() { return this.vals.thr2; } set maskThreshold(v) { this.vals.thr2 = +v || 0; }
  get useAltMask() { return !!this.vals.useMask; } set useAltMask(v) { this.vals.useMask = false; if (v) HX.note('DropShadowShader.useAltMask (máscara alternativa) no se imita'); }
  get color() { return this._col; } set color(c) { this._col = c >>> 0; this.vals.dropColor = [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255]; }
  setAdjustColor(b, h, c, s) { this.baseBrightness = b; this.baseHue = h; this.baseContrast = c; this.baseSaturation = s;
    this.vals.brightness = (+b || 0) / 255; this.vals.hueMatrix = sprHue((+h || 0) * Math.PI / 180); this.vals.contrast = sprConVal(+c || 0); this.vals.saturationMatrix = sprSat(sprSatVal(+s || 0)); }
  updateFrameInfo(frame) { this.angleOffset = frame && frame.angle ? -frame.angle : 0; }
  loadAltMask() { HX.note('DropShadowShader.loadAltMask no se imita'); }
  cssFilter() { const b = this.baseBrightness || 0; return `hue-rotate(${this.baseHue || 0}deg) saturate(${sprSatVal(this.baseSaturation || 0)}) brightness(${Math.max(0, 1 + b / 255)}) contrast(${sprConVal(this.baseContrast || 0)})`; }
}
// adjustColor.frag del sitio (shaders/) si está
loadSprFrag('adjustColor').then(t => { if (t && /hueMatrix/.test(t)) SPR_FRAG.siteAdjust = t; }).catch(() => {});
