/* =====================================================================
   motores.js (v3.5.0) — personajes y escenarios en el formato de CADA motor:
     · Psych Engine: characters/<id>.json (ya en personajes.js: normalizeCharData),
       stages/<id>.json (directory, defaultZoom, boyfriend/girlfriend/opponent,
       objects de Psych 1.0) + stages/<id>.lua (makeLuaSprite, makeAnimatedLuaSprite,
       addAnimationByPrefix/Indices, setScrollFactor, scaleObject, setProperty,
       addLuaSprite) o stages/<id>.hx (new BGSprite / FlxSprite + add)
     · Codename Engine: data/characters/<id>.xml y data/stages/<id>.xml
     · Kade Engine: personajes y escenarios fijos en el código → ids del juego base
       (stage → mainStage, halloween → spookyMansion, philly → phillyTrain…)
   Todo se convierte al formato V-Slice que ya entiende el resto del sitio.
   Se buscan con los ids del chart (player1 / player2 / gfVersion / stage).
   ===================================================================== */
'use strict';

const KADE_STAGES = { stage: 'mainStage', halloween: 'spookyMansion', philly: 'phillyTrain', limo: 'limoRide', mall: 'mallXmas', mallEvil: 'mallEvil', school: 'school', schoolEvil: 'schoolEvil', tank: 'tankmanBattlefield' };
// Kade (y FNF antiguo) sin "stage" en el chart: el escenario sale del nombre de la canción
const KADE_SONG_STAGE = { spookeez: 'halloween', south: 'halloween', monster: 'halloween', pico: 'philly', philly: 'philly', 'philly-nice': 'philly', blammed: 'philly', 'satin-panties': 'limo', high: 'limo', milf: 'limo', cocoa: 'mall', eggnog: 'mall', 'winter-horrorland': 'mallEvil', senpai: 'school', roses: 'school', thorns: 'schoolEvil', ugh: 'tank', guns: 'tank', stress: 'tank' };
const PSYCH_STAGE_DEF = { bf: [770, 100], gf: [400, 130], dad: [100, 100] };

const EngineData = {
  /* ---------- utilidades ---------- */
  async text(paths) { const r = await fetchFirstRaw(paths, 'text').catch(() => null); return r; },
  num(v, d = 0) { const n = parseFloat(v); return isFinite(n) ? n : d; },
  indices(s) {
    if (s == null || s === '') return undefined;
    const out = [];
    for (const part of String(s).split(',')) { const m = /^\s*(-?\d+)\s*\.\.\s*(-?\d+)\s*$/.exec(part); if (m) { const a = +m[1], b = +m[2]; for (let i = a; a <= b ? i <= b : i >= b; i += a <= b ? 1 : -1) out.push(i); } else if (part.trim() !== '' && isFinite(+part)) out.push(+part); }
    return out.length ? out : undefined;
  },
  /* argumentos de una llamada Lua/Haxe: 'a', "b", 12, true, {1,2} */
  args(s) {
    const out = []; let cur = '', q = null, depth = 0;
    for (const ch of s) {
      if (q) { if (ch === q) q = null; else cur += ch; continue; }
      if (ch === '"' || ch === "'") { q = ch; cur += '\u0001'; continue; }
      if (ch === '{' || ch === '[' || ch === '(') depth++; if (ch === '}' || ch === ']' || ch === ')') depth--;
      if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
      cur += ch;
    }
    if (cur.trim() !== '') out.push(cur);
    return out.map(a => { a = a.trim(); if (a.startsWith('\u0001')) return a.slice(1).replace(/\u0001/g, ''); if (/^(true|false)$/.test(a)) return a === 'true'; if (/^[{[]/.test(a)) return a.replace(/[{}[\]\s]/g, '').split(',').filter(Boolean).map(Number); const n = parseFloat(a); return isFinite(n) && /^-?[\d.]+$/.test(a) ? n : a.replace(/\u0001/g, ''); });
  },
  calls(text, names) {
    const out = [], rx = new RegExp(`\\b(${names.join('|')})\\s*\\(`, 'g'); let m;
    text = text.replace(/--\[\[[\s\S]*?\]\]/g, '').replace(/--[^\n]*/g, '').replace(/\/\/[^\n]*/g, '');
    while ((m = rx.exec(text))) {
      let i = rx.lastIndex, d = 1, q = null;
      for (; i < text.length && d > 0; i++) { const c = text[i]; if (q) { if (c === q) q = null; continue; } if (c === '"' || c === "'") q = c; else if (c === '(') d++; else if (c === ')') d--; }
      out.push({ fn: m[1], a: this.args(text.slice(rx.lastIndex, i - 1)) });
    }
    return out;
  },

  /* ---------- Psych: stage JSON (+ .lua / .hx) ---------- */
  isPsychStage(d) { return !!d && !Array.isArray(d.props) && (Array.isArray(d.boyfriend) || 'defaultZoom' in d || Array.isArray(d.objects)); },
  async psychStage(d, id) {
    const ch = (pos, def, cam, z) => ({ position: Array.isArray(pos) ? pos.map(Number) : def, topLeft: true, cameraOffsets: Array.isArray(cam) ? cam.map(Number) : [0, 0], zIndex: z });
    const out = { name: id, version: '1.0.0', directory: d.directory || 'shared', cameraZoom: +d.defaultZoom || 1, isPixel: !!d.isPixelStage, props: [], convertedFrom: 'Psych',
      characters: { bf: ch(d.boyfriend, PSYCH_STAGE_DEF.bf, d.camera_boyfriend, 300), dad: ch(d.opponent, PSYCH_STAGE_DEF.dad, d.camera_opponent, 200), gf: ch(d.girlfriend, PSYCH_STAGE_DEF.gf, d.camera_girlfriend, 100) } };
    if (d.hide_girlfriend) out.hideGf = true;
    // Psych 1.0: objects del editor de escenarios (orden = capas; gf/dad/boyfriend marcan dónde van los personajes)
    if (Array.isArray(d.objects)) {
      let z = 10;
      for (const o of d.objects) {
        const role = { gf: 'gf', dad: 'dad', boyfriend: 'bf' }[o.type];
        if (role) { out.characters[role].zIndex = z; z += 10; continue; }
        const p = { name: o.name || o.image, position: [this.num(o.x), this.num(o.y)], scale: Array.isArray(o.scale) ? o.scale : [1, 1], scroll: Array.isArray(o.scroll) ? o.scroll : [1, 1], alpha: o.alpha ?? 1, zIndex: z, flipX: !!o.flipX, flipY: !!o.flipY, isPixel: o.antialiasing === false };
        if (o.type === 'square') { p.assetPath = '#' + String(o.color || 'FFFFFF').replace(/^(#|0x)/i, '').slice(-6); p.scale = [this.num(o.scale?.[0], 1), this.num(o.scale?.[1], 1)]; }
        else { p.assetPath = o.image; if (o.type === 'animatedSprite' && Array.isArray(o.animations)) { p.animType = 'sparrow'; p.animations = o.animations.map(a => ({ name: a.anim, prefix: a.name, frameRate: +a.fps || 24, looped: !!a.loop, frameIndices: Array.isArray(a.indices) && a.indices.length ? a.indices : undefined, offsets: a.offsets || [0, 0] })); p.startingAnimation = o.firstAnimation; } }
        out.props.push(p); z += 10;
      }
    }
    // script del escenario: stages/<id>.lua o .hx (sprites)
    const lua = await this.text([`stages/${id}.lua`, `mods/stages/${id}.lua`]);
    if (lua) { out.props.push(...this.luaProps(lua.data)); out.script = lua.path; }
    const hx = !lua && await this.text([`stages/${id}.hx`, `stages/${id}.hxs`]);
    if (hx) { out.props.push(...this.hxProps(hx.data)); out.script = hx.path; }
    return out;
  },
  luaProps(text) {
    const S = new Map(), order = [];
    const get = t => { if (!S.has(t)) S.set(t, { name: t, position: [0, 0], scale: [1, 1], scroll: [1, 1], alpha: 1, animations: [] }); return S.get(t); };
    for (const c of this.calls(text, ['makeLuaSprite', 'makeAnimatedLuaSprite', 'addAnimationByPrefix', 'addAnimationByIndices', 'addAnimationByIndicesLoop', 'objectPlayAnimation', 'playAnim', 'setScrollFactor', 'scaleObject', 'setProperty', 'addLuaSprite', 'makeGraphic', 'setObjectOrder'])) {
      const [t] = c.a; if (typeof t !== 'string') continue;
      switch (c.fn) {
        case 'makeLuaSprite': case 'makeAnimatedLuaSprite': { const p = get(t); p.assetPath = c.a[1] || null; p.position = [this.num(c.a[2]), this.num(c.a[3])]; if (c.fn === 'makeAnimatedLuaSprite') p.animType = 'sparrow'; break; }
        case 'makeGraphic': { const p = get(t); p.assetPath = '#' + String(c.a[3] || 'FFFFFF').replace(/^(#|0x)/i, '').slice(-6); p.scale = [this.num(c.a[1], 1), this.num(c.a[2], 1)]; break; }
        case 'addAnimationByPrefix': get(t).animations.push({ name: c.a[1], prefix: c.a[2], frameRate: this.num(c.a[3], 24), looped: c.a[4] !== false }); break;
        case 'addAnimationByIndices': case 'addAnimationByIndicesLoop': get(t).animations.push({ name: c.a[1], prefix: c.a[2], frameIndices: this.indices(Array.isArray(c.a[3]) ? c.a[3].join(',') : c.a[3]), frameRate: this.num(c.a[4], 24), looped: c.fn.endsWith('Loop') || c.a[5] === true }); break;
        case 'objectPlayAnimation': case 'playAnim': if (S.has(t)) get(t).startingAnimation = c.a[1]; break;
        case 'setScrollFactor': get(t).scroll = [this.num(c.a[1], 1), this.num(c.a[2], this.num(c.a[1], 1))]; break;
        case 'scaleObject': get(t).scale = [this.num(c.a[1], 1), this.num(c.a[2], this.num(c.a[1], 1))]; break;
        case 'setProperty': {
          const m = /^([\w]+)\.(alpha|visible|flipX|flipY|x|y|antialiasing|scale\.x|scale\.y|scrollFactor\.x|scrollFactor\.y)$/.exec(t); if (!m || !S.has(m[1])) break;
          const p = get(m[1]), v = c.a[1];
          if (m[2] === 'alpha') p.alpha = this.num(v, 1); else if (m[2] === 'visible') { if (v === false) p.alpha = 0; } else if (m[2] === 'flipX') p.flipX = !!v; else if (m[2] === 'flipY') p.flipY = !!v;
          else if (m[2] === 'x') p.position[0] = this.num(v); else if (m[2] === 'y') p.position[1] = this.num(v); else if (m[2] === 'antialiasing') p.isPixel = v === false;
          else if (m[2] === 'scale.x') p.scale[0] = this.num(v, 1); else if (m[2] === 'scale.y') p.scale[1] = this.num(v, 1);
          else if (m[2] === 'scrollFactor.x') p.scroll[0] = this.num(v, 1); else if (m[2] === 'scrollFactor.y') p.scroll[1] = this.num(v, 1);
          break;
        }
        case 'addLuaSprite': if (S.has(t) && !order.some(o => o.t === t)) order.push({ t, front: c.a[1] === true }); break;
      }
    }
    let back = 10, front = 1000;
    return order.map(({ t, front: f }) => { const p = S.get(t); if (!p.assetPath) return null; p.zIndex = f ? front++ * 1 : back++; if (!p.animations.length) delete p.animations; if (p.animType && p.animations && !p.startingAnimation) p.startingAnimation = p.animations[0].name; return p; }).filter(Boolean);
  },
  hxProps(text) {
    const out = [], vars = new Map(); let m, z = 10;
    const rx = /var\s+(\w+)(?::\w+)?\s*=\s*new\s+BGSprite\s*\(([^;]*)\)\s*;/g;
    while ((m = rx.exec(text))) { const a = this.args(m[2]); vars.set(m[1], { name: m[1], assetPath: a[0], position: [this.num(a[1]), this.num(a[2])], scroll: [this.num(a[3], 1), this.num(a[4], 1)], scale: [1, 1], alpha: 1, ...(Array.isArray(a[5]) || typeof a[5] === 'string' ? {} : {}) }); }
    const rx2 = /var\s+(\w+)(?::\w+)?\s*=\s*new\s+FlxSprite\s*\(([^)]*)\)\s*\.loadGraphic\s*\(\s*Paths\.image\s*\(\s*['"]([^'"]+)['"]/g;
    while ((m = rx2.exec(text))) { const a = this.args(m[2]); vars.set(m[1], { name: m[1], assetPath: m[3], position: [this.num(a[0]), this.num(a[1])], scroll: [1, 1], scale: [1, 1], alpha: 1 }); }
    const rx3 = /(\w+)\.(scrollFactor\.set|scale\.set|setGraphicSize)\s*\(([^)]*)\)|(\w+)\.(alpha)\s*=\s*([\d.]+)/g;
    while ((m = rx3.exec(text))) { if (m[1] && vars.has(m[1])) { const a = this.args(m[3]), p = vars.get(m[1]); if (m[2] === 'scrollFactor.set') p.scroll = [this.num(a[0], 1), this.num(a[1], this.num(a[0], 1))]; else if (m[2] === 'scale.set') p.scale = [this.num(a[0], 1), this.num(a[1], this.num(a[0], 1))]; } else if (m[4] && vars.has(m[4])) vars.get(m[4]).alpha = this.num(m[6], 1); }
    const rx4 = /\b(add|addBehindGF|addBehindDad|addBehindBF|insert)\s*\(\s*(?:\d+\s*,\s*)?(\w+)\s*\)/g;
    while ((m = rx4.exec(text))) { const p = vars.get(m[2]); if (p && !out.includes(p)) { p.zIndex = m[1] === 'add' && /foreground|front/i.test(m[2]) ? 1000 + z : m[1] === 'addBehindGF' ? Math.min(90, z) : z; z += 1; out.push(p); } }
    return out;
  },

  /* ---------- Codename: XML ---------- */
  xml(text) { const d = new DOMParser().parseFromString(text, 'application/xml'); if (d.querySelector('parsererror')) throw new Error('XML no válido'); return d.documentElement; },
  cneChar(text, id) {
    const r = this.xml(text), A = (e, n, d) => (e.hasAttribute(n) ? e.getAttribute(n) : d);
    const col = A(r, 'color', null);
    return {
      name: id, renderType: 'sparrow', assetPath: 'characters/' + A(r, 'sprite', id), scale: this.num(A(r, 'scale', 1), 1), flipX: A(r, 'flipX', 'false') === 'true',
      isPixel: A(r, 'antialiasing', 'true') === 'false', singTime: this.num(A(r, 'holdTime', 4), 4) * 2, healthIcon: { id: A(r, 'icon', id) },
      healthbar_colors: col ? col.replace(/^(#|0x)/i, '').slice(-6) : undefined,
      offsets: [this.num(A(r, 'x', 0)), this.num(A(r, 'y', 0))], cameraOffsets: [this.num(A(r, 'camx', 0)), this.num(A(r, 'camy', 0))],
      animations: [...r.getElementsByTagName('anim')].map(a => ({ name: A(a, 'name', ''), prefix: A(a, 'anim', ''), frameRate: this.num(A(a, 'fps', 24), 24), looped: A(a, 'loop', 'false') === 'true', frameIndices: this.indices(A(a, 'indices', '')), offsets: [this.num(A(a, 'x', 0)), this.num(A(a, 'y', 0))] })),
      cnePlayer: A(r, 'isPlayer', 'false') === 'true',
      convertedFrom: 'Codename',
    };
  },
  cneStage(text, id) {
    const r = this.xml(text), A = (e, n, d) => (e.hasAttribute(n) ? e.getAttribute(n) : d);
    const folder = String(A(r, 'folder', '')).replace(/^\/+/, '');
    const out = { name: A(r, 'name', id), version: '1.0.0', cameraZoom: this.num(A(r, 'zoom', 1), 1), props: [], characters: {}, convertedFrom: 'Codename' };
    const def = { bf: [770, 100], dad: [100, 100], gf: [400, 130] };
    let z = 10;
    for (const e of r.children) {
      const tag = e.tagName.toLowerCase();
      const role = { boyfriend: 'bf', bf: 'bf', player: 'bf', dad: 'dad', opponent: 'dad', girlfriend: 'gf', gf: 'gf' }[tag];
      if (role) { out.characters[role] = { position: [this.num(A(e, 'x', def[role][0])), this.num(A(e, 'y', def[role][1]))], topLeft: true, zIndex: z, cameraOffsets: [this.num(A(e, 'camxoffset', 0)), this.num(A(e, 'camyoffset', 0))], scroll: [this.num(A(e, 'scrollx', A(e, 'scroll', 1)), 1), this.num(A(e, 'scrolly', A(e, 'scroll', 1)), 1)] }; z += 10; continue; }
      if (tag !== 'sprite' && tag !== 'box' && tag !== 'solid') continue;
      const sc = this.num(A(e, 'scale', 1), 1);
      const p = { name: A(e, 'name', A(e, 'sprite', 'prop' + z)), position: [this.num(A(e, 'x', 0)), this.num(A(e, 'y', 0))], scale: [this.num(A(e, 'scalex', sc), sc), this.num(A(e, 'scaley', sc), sc)],
        scroll: [this.num(A(e, 'scrollx', A(e, 'scroll', 1)), 1), this.num(A(e, 'scrolly', A(e, 'scroll', 1)), 1)], alpha: this.num(A(e, 'alpha', 1), 1), zIndex: z, flipX: A(e, 'flipX', 'false') === 'true', isPixel: A(e, 'antialiasing', 'true') === 'false' };
      if (tag !== 'sprite') { p.assetPath = '#' + String(A(e, 'color', '#000000')).replace(/^(#|0x)/i, '').slice(-6); p.scale = [this.num(A(e, 'width', 100), 100), this.num(A(e, 'height', 100), 100)]; }
      else {
        p.assetPath = folder + A(e, 'sprite', p.name);
        const an = [...e.getElementsByTagName('anim')];
        if (an.length) { p.animType = 'sparrow'; p.animations = an.map(a => ({ name: A(a, 'name', ''), prefix: A(a, 'anim', ''), frameRate: this.num(A(a, 'fps', 24), 24), looped: A(a, 'loop', 'true') !== 'false', frameIndices: this.indices(A(a, 'indices', '')), offsets: [this.num(A(a, 'x', 0)), this.num(A(a, 'y', 0))] })); p.startingAnimation = an[0].getAttribute('name'); if (A(e, 'type', '') === 'beat') p.danceEvery = this.num(A(e, 'beatInterval', 1), 1); }
      }
      out.props.push(p); z += 10;
    }
    for (const role of ['bf', 'dad', 'gf']) if (!out.characters[role]) out.characters[role] = { position: def[role], topLeft: true, zIndex: role === 'bf' ? 300 : role === 'dad' ? 200 : 100 };
    return out;
  },

  /* ---------- búsqueda por id (lo que pide el chart) ---------- */
  async findChar(id) {
    const x = await this.text([`data/characters/${id}.xml`, `characters/${id}.xml`]);
    if (x) { try { return { data: this.cneChar(x.data, id), path: x.path }; } catch (e) { console.warn('[motores] personaje XML', id, e); } }
    return null;
  },
  async findStage(id) {
    const j = await fetchFirstRaw([`stages/${id}.json`, `mods/stages/${id}.json`]).catch(() => null);
    if (j && this.isPsychStage(j.data)) return { data: await this.psychStage(j.data, id), path: j.path };
    const x = await this.text([`data/stages/${id}.xml`, `stages/${id}.xml`]);
    if (x) { try { return { data: this.cneStage(x.data, id), path: x.path }; } catch (e) { console.warn('[motores] escenario XML', id, e); } }
    const lua = await this.text([`stages/${id}.lua`]);       // solo .lua (sin JSON): posiciones por defecto de Psych
    if (lua) return { data: await this.psychStage({}, id), path: lua.path };
    return null;
  },
  /* ¿hay un escenario de otro motor con este id? (para no convertir "stage" en mainStage si el mod trae el suyo) */
  hasOwnStage(id) { return !!(VFS.get(`stages/${id}.json`) || VFS.get(`stages/${id}.lua`) || VFS.get(`data/stages/${id}.xml`) || VFS.get(`data/stages/${id}.json`)); },
  /* carpeta de un mod (Psych/Codename/Kade): sus personajes, escenarios, imágenes y scripts quedan en las rutas que buscan los cargadores */
  mount(files) {
    const TOP = /^(characters|stages|images|data|shared|preload|videos|sounds|music|shaders|fonts|week\d+|songs)$/i;
    let n = 0;
    for (const f of files) {
      const rel = (f.webkitRelativePath || f._rel || f.name).replace(/\\/g, '/'), p = rel.split('/');
      if (!/\.(png|xml|json|lua|hx|hxs|txt|astc|ktx2?|jpe?g|webp|mp4|webm|gif|ogg|mp3|frag)$/i.test(f.name)) continue;
      let i = p.findIndex((s, k) => k < p.length - 1 && TOP.test(s)); if (i < 0) continue;
      if (/^assets$/i.test(p[i - 1] || '')) { /* assets/… */ }
      const path = p.slice(i).join('/');
      if (!VFS.get(path)) { VFS.put(path, f, f.name); n++; }
    }
    return n;
  },
};

/* =====================================================================
   v3.6.0 — EngineFX: shaders de los scripts de Psych (.lua) y Codename (.hx)
   (lectura estática de los scripts del escenario y de la canción):
     · Psych: initLuaShader("x"), setSpriteShader(tag, "x"), setShaderFloat/Int/Bool/
       FloatArray(tag, "u", v), runHaxeCode con ShaderFilter (filtro de cámara)
     · Codename: new CustomShader("x"), <obj>.shader = …, shader.u = v,
       camGame.addShader(…) / FlxG.camera.addShader(…)
   El .frag sale de shaders/ del mod (o del sitio). Las animaciones de uniforms
   en onUpdate no se ejecutan (iTime/uTime se actualizan solos).
   ===================================================================== */
const EngineFX = {
  info: [],
  texts(prefixes, ext) {
    const out = [];
    for (const [k, v] of ModText.map) if (k.endsWith(ext) && prefixes.some(p => (p.endsWith('/') ? k.startsWith(p) && !k.slice(p.length).includes('/') : k === p))) out.push([k, v]);
    return out;
  },
  scripts(engine, stageId, songId) {
    const st = String(stageId || '').toLowerCase(), sg = String(songId || '').toLowerCase();
    if (engine === 'psych' || engine === 'kade') return this.texts([`stages/${st}.lua`, `data/${sg}/`, `songs/${sg}/`, 'scripts/'], '.lua');
    if (engine === 'codename') return this.texts([`data/stages/${st}.hx`, `songs/${sg}/scripts/`, 'data/scripts/'], '.hx');
    return [];
  },
  mk(name) { const sh = new SprShader(null, name); sh.fromKey(name); return sh; },
  setU(sh, u, v) { if (!sh) return; sh.vals[u] = Array.isArray(v) ? v.map(Number) : typeof v === 'boolean' ? v : +v; },
  parseLua(text, out) {
    const named = new Map(), byTag = new Map();
    for (const c of EngineData.calls(text, ['initLuaShader', 'setSpriteShader', 'setShaderFloat', 'setShaderInt', 'setShaderBool', 'setShaderFloatArray', 'runHaxeCode'])) {
      const a = c.a;
      if (c.fn === 'initLuaShader') named.set(a[0], true);
      else if (c.fn === 'setSpriteShader') { const sh = this.mk(String(a[1])); byTag.set(String(a[0]), sh); out.sprites.push({ tag: String(a[0]), shader: sh }); }
      else if (c.fn === 'runHaxeCode') continue;
      else { const sh = byTag.get(String(a[0])); this.setU(sh, String(a[1]), a[2]); }
    }
    // runHaxeCode([[ ... ]]) con corchetes largos de Lua
    for (const m of text.matchAll(/runHaxeCode\s*\(\s*(?:\[(=*)\[([\s\S]*?)\]\1\]|"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')/g)) this.parseHaxeFilters(m[2] ?? m[3] ?? m[4] ?? '', byTag, out);
  },
  parseHaxeFilters(code, byTag, out) {
    for (const m of code.matchAll(/(camGame|camHUD|camOther|FlxG\.camera)[\w.]*\.(?:setFilters|filters)\s*(?:=|\()\s*\[([^\]]*)\]/g)) {
      if (m[1] !== 'camGame' && m[1] !== 'FlxG.camera') { out.notes.push(`filtro en ${m[1]} (solo se imita la cámara del juego)`); }
      for (const f of m[2].matchAll(/ShaderFilter\s*\(([^)]*\)?)\)/g)) {
        const t = /getLuaObject\(\s*['"]([^'"]+)['"]\s*\)/.exec(f[1]), r = /createRuntimeShader\(\s*['"]([^'"]+)['"]\s*\)/.exec(f[1]);
        const sh = t ? byTag.get(t[1]) : r ? this.mk(r[1]) : null;
        if (sh) out.cam.push(sh);
      }
    }
  },
  parseHx(text, out) {
    const vars = new Map();
    for (const m of text.matchAll(/(?:var|final)\s+(\w+)(?::\w+)?\s*=\s*new\s+CustomShader\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) vars.set(m[1], this.mk(m[2]));
    for (const m of text.matchAll(/([\w.]+)\.shader\s*=\s*(?:new\s+CustomShader\s*\(\s*['"]([^'"]+)['"]\s*\)|(\w+))/g)) {
      const sh = m[2] ? this.mk(m[2]) : vars.get(m[3]); if (sh) out.sprites.push({ tag: m[1].split('.').pop(), shader: sh });
    }
    for (const m of text.matchAll(/(\w+)\.(\w+)\s*=\s*(-?[\d.]+|true|false|\[[^\]]*\])\s*;/g)) { const sh = vars.get(m[1]); if (sh && m[2] !== 'shader') this.setU(sh, m[2], m[3] === 'true' ? true : m[3] === 'false' ? false : m[3].startsWith('[') ? m[3].replace(/[[\]\s]/g, '').split(',') : m[3]); }
    for (const m of text.matchAll(/(\w+)\.data\.(\w+)\.value\s*=\s*\[([^\]]*)\]/g)) { const sh = vars.get(m[1]); if (sh) this.setU(sh, m[2], m[3].split(',').map(Number)); }
    for (const m of text.matchAll(/(camGame|camHUD|FlxG\.camera)\.addShader\s*\(\s*(?:new\s+CustomShader\s*\(\s*['"]([^'"]+)['"]\s*\)|(\w+))\s*\)/g)) {
      if (m[1] === 'camHUD') { out.notes.push('camHUD.addShader (solo se imita la cámara del juego)'); continue; }
      const sh = m[2] ? this.mk(m[2]) : vars.get(m[3]); if (sh) out.cam.push(sh);
    }
  },
  /* se llama al (re)arrancar el escenario: aplica los shaders a personajes / props / cámara */
  apply(st) {
    CamFilters.clear('eng'); this.info = [];
    const engine = SongImport.engine, songId = G.set && G.set.id;
    if (!engine || engine === 'vslice' || !st) return;
    const out = { sprites: [], cam: [], notes: [] };
    for (const [path, text] of this.scripts(engine, st.id, songId)) {
      try { if (path.endsWith('.lua')) this.parseLua(text, out); else this.parseHx(text, out); }
      catch (e) { console.warn('[EngineFX]', path, e); out.notes.push(`${path}: ${e.message}`); }
    }
    const roleOf = t => ({ boyfriend: 'bf', bf: 'bf', player: 'bf', dad: 'dad', opponent: 'dad', gf: 'gf', girlfriend: 'gf' })[String(t).toLowerCase()];
    for (const { tag, shader } of out.sprites) {
      const r = roleOf(tag);
      if (r) { if (Scene.chars[r]) { Scene.chars[r].shader = shader; this.info.push(`${r}: ${shader.name === 'FlxRuntimeShader' ? shader.fragKey : shader.fragKey || shader.name}`); } continue; }
      const p = st.props.find(x => String(x.name).toLowerCase() === String(tag).toLowerCase());
      if (p) { p.shader = shader; this.info.push(`${p.name}: ${shader.fragKey}`); } else out.notes.push(`shader para "${tag}": no existe ese sprite`);
    }
    if (out.cam.length) { CamFilters.set('eng', out.cam); this.info.push('cámara: ' + out.cam.map(s => s.fragKey).join(', ')); }
    this.notes = out.notes;
  },
  status() { return this.info.length ? [`✔ shaders del mod (${SongImport.engine}): ${this.info.join(' · ')}${this.notes && this.notes.length ? ' · ' + this.notes.join(' · ') : ''}`] : []; },
};
