/* =====================================================================
   v3.7.0 — Motor de scripts REAL (fase 1)
   · ScriptLog: consola de scripts (Optimización → Consola de scripts o ?consola=1).
     Un error de script se anota aquí y NUNCA detiene el juego.
   · LuaScript + PsychRT: VM Lua 5.3 (fengari, js/vendor/fengari-web.js) con la API
     de Psych Engine (y lo básico de Kade): sprites, textos, tweens, timers, cámaras,
     propiedades, eventos, sonidos, shaders, runHaxeCode…
   · CneRT: scripts .hx de Codename ejecutados con el intérprete HScript (js/hscript.js).
   · ScriptHub: reparte el ciclo de vida (onCreate, onUpdate, onBeatHit, notas, eventos,
     pausa, fin…) a Lua, Codename y los módulos .hxc de V-Slice.
   ===================================================================== */

/* ---------- consola de scripts ---------- */
const ScriptLog = {
  list: [], errs: new Map(), el: null, flash: 0, total: 0, dirty: false,
  get on() { return (typeof Optim !== 'undefined' && Optim.s.consola) || /[?&]consola=1/.test(location.search); },
  push(lvl, src, msg) {
    msg = String(msg ?? '').replace(/\s+/g, ' ').slice(0, 300);
    const last = this.list[this.list.length - 1];
    if (last && last.src === src && last.msg === msg) last.n++;
    else { this.list.push({ lvl, src, msg, n: 1, t: Math.round(G.songPos || 0) }); if (this.list.length > 200) this.list.shift(); }
    if (lvl === 'error') { this.errs.set(src, (this.errs.get(src) || 0) + 1); this.total++; console.warn('[script]', src, msg); }
    this.dirty = true;
  },
  err(src, msg) { this.push('error', src, msg); },
  info(src, msg) { this.push('info', src, msg); },
  print(src, msg) { this.push('print', src, msg); this.flash = performance.now() + 5000; },
  clear() { this.list.length = 0; this.errs.clear(); this.total = 0; this.dirty = true; },
  tick() {
    const show = this.on || performance.now() < this.flash;
    if (!show) { if (this.el && !this.el.hidden) this.el.hidden = true; return; }
    if (!this.el) { this.el = document.createElement('div'); this.el.id = 'scriptLog'; this.el.className = 'script-log'; document.body.appendChild(this.el); this.dirty = true; }
    if (this.el.hidden) { this.el.hidden = false; this.dirty = true; }
    if (!this.dirty) return; this.dirty = false;
    const rows = this.on ? this.list.slice(-12) : this.list.filter(e => e.lvl === 'print').slice(-6);
    const head = this.on ? `<div class="sl-h">Consola de scripts · ${escHtml(ScriptHub.summary())}${this.total ? ` · <b>${this.total} error${this.total > 1 ? 'es' : ''}</b>` : ''}</div>` : '';
    this.el.innerHTML = head + rows.map(e => `<div class="sl-${e.lvl}">${e.lvl === 'error' ? '✘' : e.lvl === 'print' ? '›' : '·'} <i>${escHtml(e.src)}</i> ${escHtml(e.msg)}${e.n > 1 ? ` <u>×${e.n}</u>` : ''}</div>`).join('');
  },
};

/* ---------- utilidades comunes ---------- */
const SU = {
  color(c, def = 0xFFFFFFFF) {
    if (typeof c === 'number') return c > 0xFFFFFF ? c >>> 0 : (0xFF000000 | c) >>> 0;
    if (c == null || c === '') return def;
    const v = HOST.global('FlxColor').fromString(String(c)); return v == null ? def : v;
  },
  ease(name) {
    const n = String(name || 'linear').toLowerCase().replace(/[^a-z]/g, '');
    if (!SU._ease) { SU._ease = {}; for (const [k, f] of Object.entries(Ease)) if (typeof f === 'function') SU._ease[k.toLowerCase()] = f; }
    return SU._ease[n] || SU._ease[n.replace(/^cube/, 'cubic')] || Ease.linear;
  },
  cam(name) { const n = String(name || '').toLowerCase(); return /hud|other/.test(n) ? HOST.camHUD : HOST.camGame; },
  role(name) { const n = String(name ?? '').toLowerCase().trim(); return /^(dad|opponent|1|dadgroup)$/.test(n) ? 'dad' : /^(gf|girlfriend|2|gfgroup)$/.test(n) ? 'gf' : /^(bf|boyfriend|0|boyfriendgroup)$/.test(n) ? 'bf' : null; },
  half(side) { return NOTE_W * LAYOUT[side].k / 2; },
  /* receptor (strum) visto como objeto de Psych: x/y = esquina superior izquierda */
  lanes: {},
  lane(idx) {
    idx = ((+idx || 0) % 8 + 8) % 8;
    if (SU.lanes[idx]) return SU.lanes[idx];
    const side = idx < 4 ? 'opponent' : 'player', i = idx % 4, st = () => StrumState[side].lane[i];
    const bx = () => laneX(side, i) - SU.half(side) + StrumState[side].x, by = () => strumCY(side) - SU.half(side) + StrumState[side].y;
    return (SU.lanes[idx] = { __host: 'StrumNote', __open: true, ID: i, noteData: i, get player() { return side === 'player' ? 1 : 0; },
      get x() { return bx() + st().dx; }, set x(v) { st().dx = +v - bx(); },
      get y() { return by() + st().dy; }, set y(v) { st().dy = +v - by(); },
      get alpha() { return st().alpha; }, set alpha(v) { st().alpha = +v; }, get visible() { return st().visible; }, set visible(v) { st().visible = !!v; },
      get angle() { return st().angle; }, set angle(v) { st().angle = +v || 0; }, direction: 90, get downScroll() { return !!LAYOUT[side].down; }, set downScroll(v) {},
      scale: { x: 0.7, y: 0.7, set() {} }, get width() { return SU.half(side) * 2; }, get height() { return SU.half(side) * 2; }, set texture(v) {}, set useRGBShader(v) {} });
  },
  /* nota del chart vista desde Psych */
  note(n, i) {
    if (!n) return null;
    if (n.__pw) return n.__pw;
    return (n.__pw = { __host: 'Note', __open: true, get ID() { return i; }, get strumTime() { return n.time; }, set strumTime(v) {}, get noteData() { return n.lane; }, get mustPress() { return n.side === 'player'; },
      get noteType() { return n.kind || ''; }, set noteType(v) { n.kind = String(v || ''); }, isSustainNote: false, get sustainLength() { return n.sustain; }, get wasGoodHit() { return !!n.hit; }, get tooLate() { return !!n.missed; },
      get alpha() { return n.alpha ?? 1; }, set alpha(v) { n.alpha = +v; }, get multAlpha() { return n.alpha ?? 1; }, set multAlpha(v) { n.alpha = +v; }, get visible() { return n.alpha !== 0; }, set visible(v) { n.alpha = v ? 1 : 0; },
      get ignoreNote() { return !!n.ignore; }, set ignoreNote(v) { n.ignore = !!v; }, get hitByOpponent() { return n.side === 'opponent' && !!n.hit; }, copyAlpha: true, copyX: true, copyY: true, offsetX: 0, offsetY: 0, set texture(v) {}, noAnimation: false, noMissAnimation: false, hitHealth: 0.023, missHealth: 0.0475 });
  },
  group(name) {
    const n = String(name).replace(/\.members$/, '');
    if (n === 'strumLineNotes') return { len: 8, at: i => SU.lane(i) };
    if (n === 'opponentStrums') return { len: 4, at: i => SU.lane(i % 4) };
    if (n === 'playerStrums') return { len: 4, at: i => SU.lane(4 + (i % 4)) };
    if (n === 'unspawnNotes') { const a = G.chart ? G.chart.notes.filter(x => !x.judged && x.time - G.songPos > 2000) : []; return { len: a.length, at: i => SU.note(a[i], i) }; }
    if (n === 'notes') { const a = G.chart ? G.chart.notes.filter(x => !x.judged && x.time - G.songPos <= 2000) : []; return { len: a.length, at: i => SU.note(a[i], i) }; }
    return null;
  },
  /* "a.b[2].c" → ['a','b','2','c'] */
  parts(p) { return String(p ?? '').replace(/\[(\w+)\]/g, '.$1').split('.').filter(Boolean); },
  step(o, k) {
    if (o == null) return undefined;
    if (o instanceof HX.HxMap) return o.get(k);
    if (/^\d+$/.test(k)) { if (Array.isArray(o)) return o[+k]; if (o.members) return o.members[+k]; if (o.at) return o.at(+k); }
    if (k === 'length' && o.at && 'len' in o) return o.len;
    return o[k];
  },
  coerce(v) {
    if (typeof v !== 'string') return v;
    const s = v.trim(); if (s === 'true') return true; if (s === 'false') return false; if (s !== '' && isFinite(+s)) return +s; return v;
  },
};

/* ---------- Lua (fengari) ---------- */
const LuaVM = (() => {
  const F = window.fengari; if (!F) return null;
  return { lua: F.lua, lauxlib: F.lauxlib, lualib: F.lualib, S: F.to_luastring, J: F.to_jsstring };
})();
class LuaScript {
  constructor(name, text, rt) {
    this.name = name; this.rt = rt; this.closed = false; this.ops = 0; this.calls = 0; this.ms = 0; this.wantClose = false;
    const { lua, lauxlib, lualib, S } = LuaVM;
    const L = this.L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
    // tope de instrucciones por llamada (~20 M): un bucle infinito no congela la página
    lua.lua_sethook(L, (L2) => { if (++this.ops > 400) { this.ops = 0; lauxlib.luaL_error(L2, S('el script tardó demasiado (¿bucle infinito?)')); } }, lua.LUA_MASKCOUNT, 50000);
    for (const [k, v] of Object.entries(rt.globals(this))) this.setGlobal(k, v);
    for (const [n, f] of Object.entries(rt.api)) this.register(n, f);
    this.setGlobal('scriptName', name);
    const r = lauxlib.luaL_loadbuffer(L, S(text), null, S('@' + name));
    if (r !== 0) { this.fail('al compilar', this.popErr()); this.closed = true; return; }
    this.ops = 0;
    if (lua.lua_pcall(L, 0, 0, 0) !== 0) this.fail('al cargar', this.popErr());
  }
  fail(where, msg) { ScriptLog.err(this.name, `${where}: ${msg}`); }
  popErr() { const { lua, J } = LuaVM, L = this.L; const s = lua.lua_tostring(L, -1); const m = s ? J(s) : 'error'; lua.lua_pop(L, 1); return m.replace(/^@?[^:]*:(\d+):/, 'línea $1:'); }
  register(name, f) {
    const { lua, S } = LuaVM, self = this;
    lua.lua_pushjsfunction(this.L, L2 => {
      const n = lua.lua_gettop(L2), args = new Array(n);
      for (let i = 0; i < n; i++) args[i] = self.toJS(L2, i + 1, 0);
      let r;
      try { r = f.apply(self, args); }
      catch (e) { ScriptLog.err(self.name, `${name}(): ${e && e.message || e}`); r = undefined; }
      if (r === undefined) return 0;
      self.push(L2, r); return 1;
    });
    lua.lua_setglobal(this.L, S(name));
  }
  setGlobal(k, v) { if (this.closed) return; const { lua, S } = LuaVM; this.push(this.L, v); lua.lua_setglobal(this.L, S(k)); }
  toJS(L, i, d) {
    const { lua, J } = LuaVM;
    switch (lua.lua_type(L, i)) {
      case lua.LUA_TNIL: case lua.LUA_TNONE: return null;
      case lua.LUA_TBOOLEAN: return lua.lua_toboolean(L, i);
      case lua.LUA_TNUMBER: return lua.lua_tonumber(L, i);
      case lua.LUA_TSTRING: return J(lua.lua_tostring(L, i));
      case lua.LUA_TTABLE: {
        if (d > 6) return null;
        const ti = lua.lua_absindex(L, i), out = {}; let arr = true, n = 0;
        lua.lua_pushnil(L);
        while (lua.lua_next(L, ti) !== 0) {
          const kt = lua.lua_type(L, -2), k = kt === lua.LUA_TNUMBER ? lua.lua_tonumber(L, -2) : kt === lua.LUA_TSTRING ? J(lua.lua_tostring(L, -2)) : null;
          if (k !== null) { out[k] = this.toJS(L, -1, d + 1); n++; if (typeof k !== 'number') arr = false; }
          lua.lua_pop(L, 1);
        }
        if (arr) { const a = []; for (let j = 1; j <= n; j++) { if (!(j in out)) return out; a.push(out[j]); } return a; }
        return out;
      }
      default: return null;
    }
  }
  push(L, v, d = 0) {
    const { lua, S } = LuaVM;
    if (v === null || v === undefined || typeof v === 'function') return lua.lua_pushnil(L);
    if (typeof v === 'boolean') return lua.lua_pushboolean(L, v);
    if (typeof v === 'number') return Number.isInteger(v) && Math.abs(v) < 2 ** 52 ? lua.lua_pushinteger(L, v) : lua.lua_pushnumber(L, v);
    if (typeof v === 'string') return lua.lua_pushstring(L, S(v));
    if (d > 4) return lua.lua_pushnil(L);
    if (Array.isArray(v)) { lua.lua_createtable(L, v.length, 0); v.forEach((x, i) => { this.push(L, x, d + 1); lua.lua_rawseti(L, -2, i + 1); }); return; }
    if (typeof v === 'object' && (v.constructor === Object || v.constructor == null) && !v.__host) {
      lua.lua_createtable(L, 0, 4);
      for (const [k, x] of Object.entries(v)) { if (typeof x === 'function') continue; this.push(L, x, d + 1); lua.lua_setfield(L, -2, S(k)); }
      return;
    }
    return lua.lua_pushnil(L);   // objetos del juego: aquí nil
  }
  has(fn) { if (this.closed) return false; const { lua, S } = LuaVM; const t = lua.lua_getglobal(this.L, S(fn)); lua.lua_pop(this.L, 1); return t === lua.LUA_TFUNCTION; }
  call(fn, args) {
    if (this.closed) return undefined;
    const { lua, S } = LuaVM, L = this.L;
    if (lua.lua_getglobal(L, S(fn)) !== lua.LUA_TFUNCTION) { lua.lua_pop(L, 1); return undefined; }
    for (const a of args || []) this.push(L, a);
    this.ops = 0; const t0 = performance.now();
    let r;
    if (lua.lua_pcall(L, (args || []).length, 1, 0) !== 0) { this.fail(fn, this.popErr()); r = undefined; }
    else { r = this.toJS(L, -1, 0); lua.lua_pop(L, 1); }
    this.ms += performance.now() - t0; this.calls++;
    if (this.wantClose) this.close();
    return r;
  }
  close() { if (this.closed) return; this.closed = true; try { LuaVM.lua.lua_close(this.L); } catch (e) {} }
}

/* ---------- Psych (y Kade) ---------- */
const PsychRT = {
  scripts: [], objs: new Map(), tweens: new Map(), timers: new Map(), sounds: new Map(), vars: new Map(), store: new Map(), haxe: null, haxeCache: new Map(), seq: 0, game: null, stubs: {},
  stop() {
    for (const s of this.scripts) s.close();
    this.scripts = []; this.objs.clear(); this.tweens.clear(); this.timers.clear(); this.vars.clear(); this.store.clear(); this.haxe = null; this.haxeCache.clear(); SU.lanes = {}; this.stubs = {};
    for (const s of this.sounds.values()) try { s.stop(); } catch (e) {}
    this.sounds.clear();
  },
  /* .lua del mod para esta canción / escenario (orden de Psych: escenario, globales, canción, eventos, tipos de nota) */
  find(songId, stageId) {
    const keys = [...ModText.map.keys()].filter(k => /\.lua$/.test(k)), out = [];
    const sid = String(songId || '').toLowerCase(), ids = uniq([sid, sid.replace(/\s+/g, '-'), sid.replace(/-/g, ' ')]).filter(Boolean);
    const add = k => { if (k && !out.includes(k)) out.push(k); };
    const st = String(stageId || '').toLowerCase();
    if (st) add(keys.find(k => k === `stages/${st}.lua`));
    for (const k of keys) if (/^scripts\/[^/]+\.lua$/.test(k)) add(k);
    for (const id of ids) for (const k of keys) if (k.startsWith(`data/${id}/`) || k.startsWith(`songs/${id}/`)) add(k);
    const evNames = new Set((G.chart?.events || []).map(e => e.pe && e.pe.name).filter(Boolean));
    for (const n of evNames) add(keys.find(k => k === `custom_events/${String(n).toLowerCase()}.lua`));
    const kinds = new Set((G.chart?.notes || []).map(n => n.kind).filter(Boolean));
    for (const n of kinds) add(keys.find(k => k === `custom_notetypes/${String(n).toLowerCase()}.lua`));
    return out;
  },
  start(songId, stageId) {
    this.stop();
    const list = this.find(songId, stageId);
    if (!list.length) return 0;
    if (!LuaVM) { ScriptLog.err('Lua', 'falta js/vendor/fengari-web.js: los scripts .lua no se ejecutan'); return 0; }
    for (const k of list) this.load(k);
    // las piezas que la lectura estática del .lua ya había puesto en el escenario las dibuja ahora el script real
    if (Scene.stage) for (const tag of this.objs.keys()) { const p = Scene.stage.props.find(q => q.name === tag); if (p) p.visible = false; }
    this.callAll('onCreatePost', []);
    return this.scripts.length;
  },
  load(key) {
    const text = ModText.map.get(key); if (text == null) return null;
    let s; try { s = new LuaScript(key, text, this); } catch (e) { ScriptLog.err(key, 'no se pudo crear la VM: ' + e.message); return null; }
    this.scripts.push(s);
    if (!s.closed) { s.call('onCreate', []); ScriptLog.info(key, 'cargado'); }
    return s;
  },
  callAll(fn, args) {
    let stop = false;
    for (let i = 0; i < this.scripts.length; i++) { const s = this.scripts[i]; if (s.closed) continue; if (s.call(fn, args) === 'Function_Stop') stop = true; }
    return stop;
  },
  setAll(k, v) { for (const s of this.scripts) if (!s.closed) s.setGlobal(k, v); },
  /* variables globales de Psych */
  globals() {
    const c = G.chart || {}, bpm = 60000 / Cond.crochet(Math.max(0, G.songPos || 0));
    const g = {
      Function_Stop: 'Function_Stop', Function_Continue: 'Function_Continue', Function_StopLua: 'Function_StopLua', Function_StopHScript: 'Function_StopHScript', Function_StopAll: 'Function_StopAll',
      luaDebugMode: false, luaDeprecatedWarnings: true, inChartEditor: false, version: '0.7.3', buildTarget: 'browser',
      curBpm: bpm, bpm, crochet: Cond.crochet(0), stepCrochet: Cond.stepMs(0), songLength: typeof songLength === 'function' ? songLength() : 0,
      songName: c.title || '', songPath: SongImport.cur || '', startedCountdown: false, curStage: Scene.stage ? Scene.stage.id : '', isStoryMode: false, difficulty: 1, difficultyName: c.difficulty || 'normal', weekRaw: 0, week: '', seenCutscene: true, hasVocals: true,
      scrollSpeed: G.speed || 1, isPixelStage: false, cameraX: 0, cameraY: 0, screenWidth: V.w, screenHeight: V.h,
      curBeat: 0, curStep: 0, curDecBeat: 0, curDecStep: 0, curSection: 0, mustHitSection: false, altAnim: false, gfSection: false,
      score: 0, misses: 0, hits: 0, combo: 0, rating: 0, ratingName: '', ratingFC: '', healthGainMult: 1, healthLossMult: 1, playbackRate: 1, instakillOnMiss: false, botPlay: isBot(), practice: false,
      downscroll: Opts.isDown(), middlescroll: !!Opts.middlescroll, framerate: 60, ghostTapping: true, hideHud: false, timeBarType: 'Time Left', scoreZoom: true, cameraZoomOnBeat: true, flashingLights: true, noteOffset: 0, healthBarAlpha: 1, noResetButton: false, lowQuality: false, shadersEnabled: true,
      boyfriendName: Scene.chars.bf?.id || 'bf', dadName: Scene.chars.dad?.id || 'dad', gfName: Scene.chars.gf?.id || 'gf',
      // Kade
      scrollspeed: G.speed || 1, hudWidth: V.w, hudHeight: V.h, hudZoom: 1, cameraZoom: Cam.zoom, cameraAngle: 0, camHudAngle: 0, followXOffset: 0, followYOffset: 0, showOnlyStrums: false, strumLine1Visible: true, strumLine2Visible: true,
    };
    for (let i = 0; i < 4; i++) {
      const o = SU.lane(i), p = SU.lane(4 + i);
      g['defaultOpponentStrumX' + i] = o.x; g['defaultOpponentStrumY' + i] = o.y; g['defaultPlayerStrumX' + i] = p.x; g['defaultPlayerStrumY' + i] = p.y;
      g['defaultStrum' + i + 'X'] = o.x; g['defaultStrum' + i + 'Y'] = o.y; g['defaultStrum' + (4 + i) + 'X'] = p.x; g['defaultStrum' + (4 + i) + 'Y'] = p.y;
    }
    for (const [r, k] of [['bf', 'Boyfriend'], ['dad', 'Opponent'], ['gf', 'Girlfriend']]) { const ch = Scene.chars[r]; g['default' + k + 'X'] = ch ? ch.bx : 0; g['default' + k + 'Y'] = ch ? ch.by : 0; }
    return g;
  },
  /* ---- objeto "game" (PlayState.instance de Psych) ---- */
  gameObj() {
    if (this.game) return this.game;
    const self = this;
    const stub = k => this.stubs[k] || (this.stubs[k] = { __host: k, alpha: 1, visible: true, x: 0, y: 0, angle: 0, scale: { x: 1, y: 1 }, text: '', color: 0xFFFFFFFF });
    const hud = k => ({ __host: k, get alpha() { return HudState[k].alpha; }, set alpha(v) { HudState[k].alpha = +v; }, get visible() { return HudState[k].visible; }, set visible(v) { HudState[k].visible = !!v; }, x: 0, y: 0, angle: 0, scale: { x: 1, y: 1 } });
    const hb = hud('healthBar'), st = hud('scoreTxt');
    const camFollow = { __host: 'camFollow', get x() { return (Cam.follow || [Cam.x])[0]; }, set x(v) { Cam.followTo(+v, (Cam.follow || [0, Cam.y])[1]); }, get y() { return (Cam.follow || [0, Cam.y])[1]; }, set y(v) { Cam.followTo((Cam.follow || [Cam.x])[0], +v); }, setPosition(x, y) { Cam.followTo(+x, +y); }, set(x, y) { Cam.followTo(+x, +y); } };
    const grp = n => { const g = SU.group(n); return { __host: n, len: g.len, at: g.at, get length() { return g.len; }, get members() { return Array.from({ length: g.len }, (_, i) => g.at(i)); }, forEach: f => { for (let i = 0; i < g.len; i++) f(g.at(i)); } }; };
    this.game = {
      __host: 'PlayState',
      get health() { return G.health; }, set health(v) { HOST.ps.health = v; },
      get songScore() { return G.score; }, set songScore(v) { G.score = +v || 0; }, get songMisses() { return G.misses; }, set songMisses(v) { G.misses = +v || 0; },
      get combo() { return G.combo; }, set combo(v) { G.combo = +v || 0; }, get songHits() { return G.judged - G.misses; },
      get defaultCamZoom() { return Cam.stageZoom; }, set defaultCamZoom(v) { v = +v; if (v > 0) Cam.stageZoom = v; },
      camZooming: true, camZoomingMult: 1, camZoomingDecay: 1, cameraSpeed: 1, isCameraOnForcedPos: false, inCutscene: false, startingSong: false, endingSong: false, generatedMusic: true, canPause: true, showRating: true, showCombo: true, showComboNum: true,
      get songSpeed() { return G.speed; }, set songSpeed(v) { if (+v > 0) { G.speed = +v; G.speedTween = null; if (G.speedSide) { G.speedSide.player = G.speedSide.opponent = +v; } } },
      get camFollow() { return camFollow; }, get camFollowPos() { return camFollow; },
      get camGame() { return HOST.camGame; }, get camHUD() { return HOST.camHUD; }, get camOther() { return HOST.camHUD; },
      get boyfriend() { return CharW.get('bf'); }, get dad() { return CharW.get('dad'); }, get gf() { return CharW.get('gf'); },
      get boyfriendGroup() { return CharW.get('bf'); }, get dadGroup() { return CharW.get('dad'); }, get gfGroup() { return CharW.get('gf'); },
      get healthBar() { return hb; }, get healthBarBG() { return hb; }, get iconP1() { return hb; }, get iconP2() { return hb; }, get scoreTxt() { return st; },
      get timeBar() { return stub('timeBar'); }, get timeBarBG() { return stub('timeBarBG'); }, get timeTxt() { return stub('timeTxt'); }, get botplayTxt() { return stub('botplayTxt'); },
      get strumLineNotes() { return grp('strumLineNotes'); }, get playerStrums() { return grp('playerStrums'); }, get opponentStrums() { return grp('opponentStrums'); },
      get notes() { return grp('notes'); }, get unspawnNotes() { return grp('unspawnNotes'); },
      get curBeat() { return Math.floor(Cond.beat(G.songPos)); }, get curStep() { return Math.floor(Cond.step(G.songPos)); },
      get SONG() { return self.SONG(); },
      getLuaObject: tag => self.objs.get(String(tag)) || null,
      setVar: (k, v) => { self.vars.set(String(k), v); }, getVar: k => self.vars.get(String(k)) ?? null,
      get variables() { return { set: (k, v) => self.vars.set(k, v), get: k => self.vars.get(k), exists: k => self.vars.has(k), remove: k => self.vars.delete(k) }; },
      createRuntimeShader: name => uniformProxy(new SprShader(null, String(name)).fromKey(String(name))),
      initLuaShader: () => true, add: o => HOST.ps.add(o), remove: o => HOST.ps.remove(o), insert: (i, o) => HOST.ps.insert(i, o),
      addBehindGF: o => { if (o instanceof HxSprite) o.zIndex = self.behindZ(); return HOST.ps.add(o); }, addBehindBF: o => self.game.addBehindGF(o), addBehindDad: o => self.game.addBehindGF(o),
      triggerEvent: (n, a, b) => self.trigger(n, a, b), endSong: () => { if (typeof openOverlay === 'function') openOverlay('end'); },
    };
    return this.game;
  },
  SONG() { const c = G.chart || {}; return { song: c.title || '', bpm: c.bpm || 100, speed: G.speed || 1, player1: Scene.chars.bf?.id || 'bf', player2: Scene.chars.dad?.id || 'dad', gfVersion: Scene.chars.gf?.id || 'gf', stage: Scene.stage?.id || '', needsVoices: true }; },
  behindZ() { const zs = ['gf', 'dad', 'bf'].map(r => Scene.chars[r]).filter(Boolean).map(c => c.z); return (zs.length ? Math.min(...zs) : 0) - 1 + (++this.seq) * 1e-4; },
  /* raíz de una ruta: sprite/texto de Lua → variable → personaje → cámara → PlayState → pieza del escenario → valor guardado */
  root(name) {
    if (this.objs.has(name)) return this.objs.get(name);
    if (this.vars.has(name)) return this.vars.get(name);
    if (/^(dad|bf|gf|boyfriend|girlfriend|dadgroup|gfgroup|boyfriendgroup)$/i.test(name)) return CharW.get(SU.role(name));
    if (name === 'camGame') return HOST.camGame;
    if (name === 'camHUD' || name === 'camOther') return HOST.camHUD;
    const g = this.gameObj(); if (name in g) return g[name];
    const p = Scene.stage && Scene.stage.props.find(q => q.name === name); if (p) return propW(p);
    if (this.store.has(name)) return this.store.get(name);
    return undefined;
  },
  resolve(path) { const ps = SU.parts(path); if (!ps.length) return undefined; let o = this.root(ps[0]); for (let i = 1; i < ps.length && o != null; i++) o = SU.step(o, ps[i]); return o; },
  getProp(path) { const v = this.resolve(path); if (v && typeof v === 'object' && 'len' in v && 'at' in v) return v.len; return v === undefined ? null : v; },
  setProp(path, val) {
    const ps = SU.parts(path); if (!ps.length) return;
    const k = ps[ps.length - 1];
    if (ps.length === 1) { const g = this.gameObj(); if (k in g) { try { g[k] = val; } catch (e) {} return; } if (this.vars.has(k)) { this.vars.set(k, val); return; } this.store.set(k, val); return; }
    let o = this.root(ps[0]); for (let i = 1; i < ps.length - 1 && o != null; i++) o = SU.step(o, ps[i]);
    if (o == null) { ScriptLog.err('setProperty', `"${path}" no existe`); return; }
    if (o instanceof HX.HxMap) o.set(k, val); else if (/^\d+$/.test(k) && o.at) { /* grupo: no se reemplazan miembros */ } else o[k] = val;
  },
  coerce: SU.coerce,
  obj(tag) { tag = String(tag ?? ''); const o = this.resolve(tag); if (o == null) ScriptLog.err('objeto', `"${tag}" no existe`); return o; },
  trigger(name, v1, v2) {
    const bpm = 60000 / Cond.crochet(Math.max(0, G.songPos));
    for (const ev of Chart.psychEvent(G.songPos, String(name), v1 ?? '', v2 ?? '', bpm)) Events.fire(ev, false);
  },
  tweenDone(tag, vars) { if (this.tweens.get(tag) && this.tweens.get(tag).finished) this.tweens.delete(tag); this.callAll('onTweenCompleted', [tag, vars ?? null]); },
  tween(tag, target, props, dur, ease, vars, opts = {}) {
    tag = String(tag ?? ''); if (this.tweens.has(tag)) this.tweens.get(tag).cancel();
    if (target == null) return null;
    const tw = new HxTween(target, props, +dur || 0, Object.assign({ ease: SU.ease(ease) }, opts, { onComplete: () => { if (!(tw.type & 6)) this.tweenDone(tag, typeof vars === 'string' ? vars : null); } }));
    if (tag) this.tweens.set(tag, tw);
    return tw;
  },
};

/* API de Psych (this = el LuaScript que llama). Cada función va protegida: un error se anota y el juego sigue. */
PsychRT.api = (() => {
  const P = PsychRT, O = t => P.obj(t);
  const spr = tag => P.objs.get(String(tag)) || P.resolve(String(tag));
  const text = tag => { const o = P.objs.get(String(tag)); if (!(o instanceof HxText)) { ScriptLog.err('texto', `"${tag}" no es un texto de Lua`); return null; } return o; };
  const lane = i => SU.lane(i);
  const paths = () => HOST.global('Paths');
  const H = {
    actor(id) { if (typeof id === 'number' || /^\d+$/.test(String(id))) return SU.lane(+id); return P.resolve(String(id)); },
    cls(cls) {
      const n = String(cls || '').split('.').pop();
      switch (n) {
        case 'FlxG': return HOST.global('FlxG');
        case 'PlayState': return { instance: P.gameObj(), get SONG() { return P.SONG(); }, isStoryMode: false, storyDifficulty: 1, get curStage() { return Scene.stage?.id || ''; } };
        case 'ClientPrefs': { const p = H.prefs(); return Object.assign({ data: p }, p); }
        case 'Conductor': return HOST.global('Conductor').instance;
        case 'GameOverSubstate': if (!P.store.has('__go')) P.store.set('__go', { characterName: 'bf-dead', deathSoundName: 'fnf_loss_sfx', loopSoundName: 'gameOver', endSoundName: 'gameOverEnd' }); return P.store.get('__go');
        case 'Main': return { fpsVar: { visible: false } };
        case 'Lib': return { application: { window: { title: document.title } } };
      }
      const g = HOST.global(n); if (g !== undefined) return g;
      ScriptLog.err('getPropertyFromClass', `clase "${cls}" no imitada`); return undefined;
    },
    prefs() { return { downScroll: Opts.isDown(), middleScroll: !!Opts.middlescroll, ghostTapping: true, flashing: true, camZooms: true, lowQuality: false, shaders: true, framerate: 60, noteOffset: 0, hideHud: false, globalAntialiasing: true, antialiasing: true }; },
    grp(group) { const g = SU.group(group); if (g) return g; const o = P.resolve(String(group)); if (!o) return null; const m = o.members || o; return { len: m.length, at: i => m[i] }; },
    ktw(s, id, props, t, ease, cb) { return new HxTween(H.actor(id), props, +t || 0, { ease: SU.ease(ease), onComplete: () => { if (cb) s.call(String(cb), [id]); } }); },
  };
  const api = {
    /* sprites */
    makeLuaSprite(tag, image, x = 0, y = 0) {
      tag = String(tag); const old = P.objs.get(tag); if (old) old.destroy();
      const s = new HxSprite(+x || 0, +y || 0); s.__tag = tag;
      if (image) s.loadGraphic(paths().image(String(image)));
      P.objs.set(tag, s); return true;
    },
    makeAnimatedLuaSprite(tag, image, x = 0, y = 0) {
      tag = String(tag); const old = P.objs.get(tag); if (old) old.destroy();
      const s = new HxSprite(+x || 0, +y || 0); s.__tag = tag; if (image) s.loadSparrow(String(image));
      P.objs.set(tag, s); return true;
    },
    makeGraphic(tag, w = 256, h = 256, color = 'FFFFFF') { const s = spr(tag); if (s && s.makeGraphic) s.makeGraphic(+w || 1, +h || 1, SU.color(color)); },
    loadGraphic(tag, image) { const s = spr(tag); if (s && s.loadGraphic) s.loadGraphic(paths().image(String(image))); },
    loadFrames(tag, image) { const s = spr(tag); if (s && s.loadSparrow) s.loadSparrow(String(image)); },
    addLuaSprite(tag, front = false) {
      const s = P.objs.get(String(tag)); if (!s) return ScriptLog.err(this.name, `addLuaSprite: "${tag}" no existe`);
      if (!s.onHud) s.zIndex = front ? 5000 + (++P.seq) * 1e-3 : P.behindZ();
      if (!ModRT.sprites.includes(s)) ModRT.sprites.push(s);
    },
    removeLuaSprite(tag, destroy = true) { const s = P.objs.get(String(tag)); if (!s) return; const i = ModRT.sprites.indexOf(s); if (i >= 0) ModRT.sprites.splice(i, 1); if (destroy !== false) P.objs.delete(String(tag)); },
    luaSpriteExists(tag) { const s = P.objs.get(String(tag)); return !!s && !(s instanceof HxText); },
    luaTextExists(tag) { return P.objs.get(String(tag)) instanceof HxText; },
    luaSoundExists(tag) { return P.sounds.has(String(tag)); },
    setObjectCamera(tag, cam = 'game') { const s = spr(tag); if (!s) return false; if ('cameras' in s) s.cameras = /hud|other/i.test(String(cam)) ? [HOST.camHUD] : null; return true; },
    setObjectOrder(tag, pos) { const s = spr(tag); if (s && 'zIndex' in s) s.zIndex = +pos || 0; },
    getObjectOrder(tag) { const s = spr(tag); return s ? +s.zIndex || 0 : -1; },
    scaleObject(tag, x = 1, y) { const s = spr(tag); if (s && s.scale) { s.scale.x = +x; s.scale.y = +(y ?? x); } },
    setGraphicSize(tag, x = 0, y = 0) { const s = spr(tag); if (s && s.setGraphicSize) s.setGraphicSize(+x || 0, +y || 0); },
    updateHitbox() {}, updateHitboxFromGroup() {},
    screenCenter(tag, pos = 'xy') { const s = spr(tag); if (s && s.screenCenter) { const p = String(pos).toLowerCase(); s.screenCenter(p === 'x' ? 0x01 : p === 'y' ? 0x10 : 0x11); } },
    setScrollFactor(tag, x = 1, y) { const s = spr(tag); if (s && s.scrollFactor) { if (s.scrollFactor.set) s.scrollFactor.set(+x, +(y ?? x)); else { s.scrollFactor.x = +x; s.scrollFactor.y = +(y ?? x); } } },
    setBlendMode(tag, b = '') { const s = spr(tag); if (s) s.blend = /add/i.test(String(b)) ? 'add' : null; },
    getMidpointX(tag) { const s = spr(tag); return s ? s.x + (s.width || 0) / 2 : 0; }, getMidpointY(tag) { const s = spr(tag); return s ? s.y + (s.height || 0) / 2 : 0; },
    getGraphicMidpointX(tag) { return api.getMidpointX(tag); }, getGraphicMidpointY(tag) { return api.getMidpointY(tag); },
    getScreenPositionX(tag) { const s = spr(tag); return s ? s.x : 0; }, getScreenPositionY(tag) { const s = spr(tag); return s ? s.y : 0; },
    objectsOverlap() { return false; }, getPixelColor() { return 0; },
    /* animaciones */
    addAnimationByPrefix(tag, name, prefix, fps = 24, loop = true) { const s = spr(tag); if (s && s.animation && s.animation.addByPrefix) { s.animation.addByPrefix(String(name), String(prefix), +fps || 24, loop !== false); if (!s.animation.cur) s.animation.play(String(name)); } },
    addAnimationByIndices(tag, name, prefix, idx = '', fps = 24, loop = false) { const s = spr(tag); if (s && s.animation && s.animation.addByIndices) { const list = Array.isArray(idx) ? idx.map(Number) : String(idx).split(',').map(x => parseInt(x)).filter(x => !isNaN(x)); s.animation.addByIndices(String(name), String(prefix), list, '', +fps || 24, !!loop); if (!s.animation.cur) s.animation.play(String(name)); } },
    addAnimationByIndicesLoop(tag, name, prefix, idx, fps = 24) { api.addAnimationByIndices(tag, name, prefix, idx, fps, true); },
    addAnimation(tag, name, frames = [], fps = 24, loop = true) { const s = spr(tag); if (s && s.animation && s.animation.add) s.animation.add(String(name), frames, +fps || 24, loop !== false); },
    addOffset(tag, anim, x = 0, y = 0) { const s = spr(tag); if (s) (s.__offs || (s.__offs = {}))[anim] = [+x || 0, +y || 0]; },
    playAnim(tag, anim, forced = false) {
      const s = spr(tag); if (!s) return false; anim = String(anim);
      if (s instanceof HxSprite) { s.animation.play(anim, !!forced); const o = s.__offs && s.__offs[anim]; if (o) s.offset.set(o[0], o[1]); return true; }
      if (s.playAnimation) { s.playAnimation(anim, !!forced); return true; }
      return false;
    },
    objectPlayAnimation(tag, anim, forced) { return api.playAnim(tag, anim, forced); },
    characterPlayAnim(ch, anim, forced = false) { CharW.get(SU.role(ch) || 'bf').playAnimation(String(anim), !!forced); },
    characterDance(ch) { CharW.get(SU.role(ch) || 'bf').dance(true); },
    getCharacterX(ch) { return CharW.get(SU.role(ch) || 'bf').x; }, getCharacterY(ch) { return CharW.get(SU.role(ch) || 'bf').y; },
    setCharacterX(ch, v) { CharW.get(SU.role(ch) || 'bf').x = +v; }, setCharacterY(ch, v) { CharW.get(SU.role(ch) || 'bf').y = +v; },
    /* propiedades */
    getProperty(path) { return P.getProp(path); },
    setProperty(path, v) { P.setProp(String(path), v); return true; },
    getPropertyFromClass(cls, path) { const o = H.cls(cls); if (o === undefined) return null; let v = o; for (const k of SU.parts(path)) v = SU.step(v, k); return v === undefined ? null : v; },
    setPropertyFromClass(cls, path, val) {
      const o = H.cls(cls); if (o === undefined) return false;
      const ps = SU.parts(path); let t = o; for (let i = 0; i < ps.length - 1 && t != null; i++) t = SU.step(t, ps[i]);
      if (t != null) { try { t[ps[ps.length - 1]] = val; } catch (e) {} }
      return true;
    },
    getPropertyFromGroup(group, idx, field) { const g = H.grp(group); if (!g) return null; const o = g.at(+idx || 0); if (o == null) return null; let v = o; for (const k of SU.parts(field)) v = SU.step(v, k); return v === undefined ? null : v; },
    setPropertyFromGroup(group, idx, field, val) {
      const g = H.grp(group); if (!g) return; const o = g.at(+idx || 0); if (o == null) return;
      const ps = SU.parts(field); let t = o; for (let i = 0; i < ps.length - 1 && t != null; i++) t = SU.step(t, ps[i]);
      if (t != null) t[ps[ps.length - 1]] = val;
    },
    removeFromGroup() {}, addToGroup() {},
    setVar(k, v) { P.vars.set(String(k), v); return true; }, getVar(k) { return P.vars.get(String(k)) ?? null; },
    /* tweens */
    doTweenX(tag, vars, value, dur, ease) { P.tween(tag, O(vars), { x: +value }, dur, ease, vars); },
    doTweenY(tag, vars, value, dur, ease) { P.tween(tag, O(vars), { y: +value }, dur, ease, vars); },
    doTweenAngle(tag, vars, value, dur, ease) { P.tween(tag, O(vars), { angle: +value }, dur, ease, vars); },
    doTweenAlpha(tag, vars, value, dur, ease) { P.tween(tag, O(vars), { alpha: +value }, dur, ease, vars); },
    doTweenZoom(tag, vars, value, dur, ease) { P.tween(tag, SU.cam(vars), { zoom: +value }, dur, ease, vars); },
    doTweenColor(tag, vars, color, dur, ease) {
      const o = O(vars); if (!o) return; tag = String(tag); if (P.tweens.has(tag)) P.tweens.get(tag).cancel();
      const tw = HOST.global('FlxTween').color(o, +dur || 0, o.color ?? 0xFFFFFFFF, SU.color(color), { ease: SU.ease(ease), onComplete: () => { tw.finished = true; P.tweenDone(tag, String(vars)); } });
      P.tweens.set(tag, tw);
    },
    startTween(tag, vars, values = {}, dur = 1, opts = {}) {
      const o = O(vars); if (!o || !values || typeof values !== 'object') return;
      opts = opts || {};
      const props = {}; for (const [k, v] of Object.entries(values)) props[k] = +v;
      const type = { persist: 1, looping: 2, pingpong: 4, oneshot: 8, backward: 16 }[String(opts.type || 'oneshot').toLowerCase()] || 8;
      const s = this, extra = { type, startDelay: +opts.startDelay || 0, loopDelay: +opts.loopDelay || 0 };
      if (opts.onUpdate) extra.onUpdate = () => s.call(String(opts.onUpdate), [String(tag), String(vars)]);
      if (opts.onStart) extra.onStart = () => s.call(String(opts.onStart), [String(tag), String(vars)]);
      const tw = P.tween(tag, o, props, dur, opts.ease, String(vars), extra);
      if (tw && opts.onComplete) { const oc = tw.opts.onComplete; tw.opts.onComplete = t => { oc(t); s.call(String(opts.onComplete), [String(tag), String(vars)]); }; }
    },
    noteTweenX(tag, note, value, dur, ease) { P.tween(tag, lane(note), { x: +value }, dur, ease, null); },
    noteTweenY(tag, note, value, dur, ease) { P.tween(tag, lane(note), { y: +value }, dur, ease, null); },
    noteTweenAngle(tag, note, value, dur, ease) { P.tween(tag, lane(note), { angle: +value }, dur, ease, null); },
    noteTweenAlpha(tag, note, value, dur, ease) { P.tween(tag, lane(note), { alpha: +value }, dur, ease, null); },
    noteTweenDirection(tag, note, value, dur, ease) { P.tween(tag, lane(note), { direction: +value }, dur, ease, null); },
    cancelTween(tag) { const t = P.tweens.get(String(tag)); if (t) { t.cancel(); P.tweens.delete(String(tag)); } },
    /* timers */
    runTimer(tag, time = 1, loops = 1) {
      tag = String(tag); api.cancelTimer(tag); loops = +(loops ?? 1); if (!isFinite(loops)) loops = 1;
      const tm = new HxTimer().start(+time || 0, t => { const left = t.loops > 0 ? t.loops - t.elapsedLoops : 0; if (t.finished) P.timers.delete(tag); P.callAll('onTimerCompleted', [tag, t.elapsedLoops, left]); }, loops);
      P.timers.set(tag, tm);
    },
    cancelTimer(tag) { const t = P.timers.get(String(tag)); if (t) { t.cancel(); P.timers.delete(String(tag)); } },
    /* cámara */
    cameraShake(cam, intensity = 0.05, dur = 0.5) { SU.cam(cam).shake(+intensity || 0, +dur || 0); },
    cameraFlash(cam, color = 'FFFFFF', dur = 1, forced = false) { SU.cam(cam).flash(SU.color(color), +dur || 0, null, !!forced); },
    cameraFade(cam, color = '000000', dur = 1, forced = false) { SU.cam(cam).fade(SU.color(color, 0xFF000000), +dur || 0, false, null, !!forced); },
    cameraSetTarget(target) { const r = SU.role(target) || 'bf'; Events.fire({ t: G.songPos, e: 'FocusCamera', v: { char: r === 'dad' ? 1 : r === 'gf' ? 2 : 0 } }, false); return r === 'dad'; },
    getCameraFollowX() { return (Cam.follow || [Cam.x])[0]; }, getCameraFollowY() { return (Cam.follow || [0, Cam.y])[1]; },
    setCameraFollowPoint(x, y) { Cam.followTo(+x, +y); }, addCameraFollowPoint(x, y) { const f = Cam.follow || [Cam.x, Cam.y]; Cam.followTo(f[0] + (+x || 0), f[1] + (+y || 0)); },
    setCameraScroll(x, y) { Cam.followTo(+x + V.w / 2, +y + V.h / 2); },
    /* eventos y canción */
    triggerEvent(name, v1 = '', v2 = '') { P.trigger(name, v1, v2); return true; },
    startCountdown() { return true; }, startDialogue() { return false; }, startVideo(v) { Mods.playVideo(`videos/${v}.mp4`); return true; },
    endSong() { if (typeof openOverlay === 'function') setTimeout(() => openOverlay('end'), 0); return true; },
    restartSong() { if (typeof restart === 'function') setTimeout(() => restart(false), 0); return true; },
    exitSong() { return api.endSong(); },
    getSongPosition() { return G.songPos; },
    getHealth() { return G.health; }, setHealth(v) { HOST.ps.health = +v; }, addHealth(v) { HOST.ps.health = G.health + (+v || 0); },
    getScore() { return G.score; }, setScore(v) { G.score = +v || 0; }, addScore(v) { G.score += +v || 0; },
    getMisses() { return G.misses; }, setMisses(v) { G.misses = +v || 0; }, addMisses(v) { G.misses += +v || 0; },
    getHits() { return G.judged - G.misses; }, setHits() {}, addHits() {}, setRatingPercent() {}, setRatingName() {}, setRatingFC() {},
    setHealthBarColors() { ScriptLog.info(this.name, 'setHealthBarColors: la barra usa los colores de los iconos'); }, setTimeBarColors() {},
    /* sonido */
    playSound(snd, vol = 1, tag = null) { const s = HOST.global('FlxG').sound.play(paths().sound(String(snd)), vol ?? 1); if (tag) { const old = P.sounds.get(String(tag)); if (old) old.stop(); P.sounds.set(String(tag), s); } return tag; },
    playMusic(snd, vol = 1, loop = false) { const old = P.sounds.get('__music'); if (old) old.stop(); P.sounds.set('__music', HOST.global('FlxG').sound.play(paths().music(String(snd)), vol ?? 1, !!loop)); },
    stopSound(tag) { const s = P.sounds.get(String(tag)); if (s) { s.stop(); P.sounds.delete(String(tag)); } },
    pauseSound(tag) { const s = P.sounds.get(String(tag)); if (s) s.pause(); }, resumeSound(tag) { const s = P.sounds.get(String(tag)); if (s) s.resume(); },
    soundFadeIn(tag, d, from = 0, to = 1) { const s = P.sounds.get(String(tag)); if (s) s.fadeIn(d, from, to); }, soundFadeOut(tag) { const s = P.sounds.get(String(tag)); if (s) s.fadeOut(); },
    setSoundVolume(tag, v) { const s = P.sounds.get(String(tag)); if (s) { s.volume = +v; if (s.gain) s.gain.gain.value = +v; } },
    getSoundVolume(tag) { const s = P.sounds.get(String(tag)); return s ? s.volume : 0; }, getSoundTime() { return 0; }, setSoundTime() {},
    precacheImage(k) { ModRes.load('image', String(k), null); }, precacheSound(k) { ModRes.load('sound', String(k), null); }, precacheMusic(k) { ModRes.load('music', String(k), null); },
    /* textos */
    makeLuaText(tag, txt = '', width = 0, x = 0, y = 0) {
      tag = String(tag); const old = P.objs.get(tag); if (old) old.destroy();
      const t = new HxText(+x || 0, +y || 0, +width || 0, String(txt ?? ''), 16);
      t.setFormat('vcr.ttf', 16, 0xFFFFFFFF, 'center', 2, 0xFF000000); t.borderSize = 2; t.cameras = [HOST.camHUD]; t.__tag = tag;
      P.objs.set(tag, t);
    },
    addLuaText(tag) { const t = P.objs.get(String(tag)); if (t && !ModRT.sprites.includes(t)) ModRT.sprites.push(t); },
    removeLuaText(tag, destroy = true) { api.removeLuaSprite(tag, destroy); },
    setTextString(tag, s) { const t = text(tag); if (t) t.text = String(s ?? ''); }, getTextString(tag) { const t = text(tag); return t ? t.text : null; },
    setTextSize(tag, n) { const t = text(tag); if (t) t.size = +n || 8; }, getTextSize(tag) { const t = text(tag); return t ? t.size : 0; },
    setTextWidth(tag, n) { const t = text(tag); if (t) t.fieldWidth = +n || 0; }, getTextWidth(tag) { const t = text(tag); return t ? t.width : 0; },
    setTextHeight() {}, setTextAutoSize() {},
    setTextBorder(tag, size = 1, color = '000000') { const t = text(tag); if (t) { t.borderStyle = +size > 0 ? 2 : 0; t.borderSize = +size || 0; t.borderColor = SU.color(color, 0xFF000000); } },
    setTextColor(tag, c) { const t = text(tag); if (t) t.color = SU.color(c); },
    setTextFont(tag, f) { const t = text(tag); if (t) t.font = String(f); }, getTextFont(tag) { const t = text(tag); return t ? t.font : null; },
    setTextItalic(tag, v) { const t = text(tag); if (t) t.italic = !!v; },
    setTextAlignment(tag, a = 'left') { const t = text(tag); if (t) t.alignment = String(a).toLowerCase(); },
    /* shaders (Psych 0.7) */
    initLuaShader(name) { return true; },
    setSpriteShader(tag, name) { const s = spr(tag); if (!s) return false; s.shader = uniformProxy(new SprShader(null, String(name)).fromKey(String(name))); return true; },
    removeSpriteShader(tag) { const s = spr(tag); if (s) s.shader = null; return true; },
    setShaderFloat(tag, p, v) { const s = spr(tag); if (s && s.shader) s.shader.setFloat(p, v); }, setShaderInt(tag, p, v) { const s = spr(tag); if (s && s.shader) s.shader.setInt(p, v); },
    setShaderBool(tag, p, v) { const s = spr(tag); if (s && s.shader) s.shader.setBool(p, v); },
    setShaderFloatArray(tag, p, v) { const s = spr(tag); if (s && s.shader) s.shader.setFloatArray(p, v); }, setShaderIntArray(tag, p, v) { api.setShaderFloatArray(tag, p, v); }, setShaderBoolArray(tag, p, v) { const s = spr(tag); if (s && s.shader) s.shader.setBoolArray(p, v); },
    getShaderFloat(tag, p) { const s = spr(tag); return s && s.shader ? s.shader.getFloat(p) : null; }, getShaderInt(tag, p) { return api.getShaderFloat(tag, p); }, getShaderBool(tag, p) { const s = spr(tag); return s && s.shader ? s.shader.getBool(p) : null; },
    setShaderSampler2D() { ScriptLog.info(this.name, 'setShaderSampler2D (textura extra) no se imita'); },
    /* HScript dentro de Lua */
    runHaxeCode(code, vars) { return P.runHaxe(this, String(code ?? ''), vars); },
    runHaxeFunction(fn, args) { const h = P.haxe; if (!h || !h.hasTop(String(fn))) { ScriptLog.err(this.name, `runHaxeFunction: "${fn}" no existe`); return null; } try { return h.callTop(String(fn), Array.isArray(args) ? args : []) ?? null; } catch (e) { ScriptLog.err(this.name, 'runHaxeFunction: ' + e.message); return null; } },
    addHaxeLibrary() {},
    /* scripts */
    debugPrint(...a) { ScriptLog.print(this.name, a.map(x => (x === null ? 'nil' : typeof x === 'object' ? JSON.stringify(x) : String(x))).join(' ')); },
    close() { this.wantClose = true; return true; },
    callOnLuas(fn, args = [], ignoreStops, ignoreSelf = true) { for (const s of P.scripts) if (!s.closed && (!ignoreSelf || s !== this)) s.call(String(fn), Array.isArray(args) ? args : []); },
    callScript(name, fn, args = []) { const s = P.scripts.find(x => x.name.includes(String(name).toLowerCase().replace(/\.lua$/, ''))); return s ? s.call(String(fn), Array.isArray(args) ? args : []) ?? null : null; },
    setOnLuas(k, v) { P.setAll(String(k), v); },
    getRunningScripts() { return P.scripts.filter(s => !s.closed).map(s => s.name); },
    isRunning(n) { return P.scripts.some(s => !s.closed && s.name.includes(String(n).toLowerCase())); },
    addLuaScript(path) { let k = ModText.key(String(path)); if (!/\.lua$/.test(k)) k += '.lua'; if (!ModText.map.has(k)) { ScriptLog.err(this.name, `addLuaScript: no existe ${k}`); return; } if (!P.scripts.some(s => s.name === k)) P.load(k); },
    removeLuaScript(path) { const s = P.scripts.find(x => x.name.includes(String(path).toLowerCase())); if (s) s.close(); },
    /* archivos ("carpeta imaginaria") */
    checkFileExists(p) { return HOST.global('FileSystem').exists(String(p)); },
    getTextFromFile(p) { return HOST.global('File').getContent(String(p)); },
    directoryFileList(p) { return VFS.list(String(p)); },
    saveFile(p, t) { ModText.put(String(p), String(t)); return true; }, deleteFile() { return false; },
    getModSetting() { return null; }, getDataFromSave() { return null; }, initSaveData() {}, flushSaveData() {}, setDataFromSave() {},
    /* utilidades */
    getRandomInt(a = 0, b = 2147483647, excl = '') { const ex = String(excl || '').split(',').map(x => parseInt(x)).filter(x => !isNaN(x)); for (let i = 0; i < 50; i++) { const v = randInt(+a, +b); if (!ex.includes(v)) return v; } return +a; },
    getRandomFloat(a = 0, b = 1) { return rand(+a, +b); }, getRandomBool(c = 50) { return Math.random() * 100 < +c; },
    getColorFromHex(c) { return SU.color(c); }, getColorFromString(c) { return SU.color(c); }, getColorFromName(c) { return SU.color(c); },
    stringStartsWith(s, p) { return String(s).startsWith(String(p)); }, stringEndsWith(s, p) { return String(s).endsWith(String(p)); },
    stringSplit(s, d) { return String(s).split(String(d)); }, stringTrim(s) { return String(s).trim(); },
    keyJustPressed(k) { return KeyState.justAct(k); }, keyPressed(k) { return KeyState.act(k); }, keyReleased(k) { return KeyState.relAct(k); },
    keyboardJustPressed(k) { return KeyState.just.has(String(k).toUpperCase()); }, keyboardPressed(k) { return KeyState.down.has(String(k).toUpperCase()); }, keyboardReleased(k) { return KeyState.rel.has(String(k).toUpperCase()); },
    mouseClicked() { return false; }, mousePressed() { return false; }, mouseReleased() { return false; }, getMouseX() { return 0; }, getMouseY() { return 0; },
    anyGamepadJustPressed() { return false; }, gamepadJustPressed() { return false; }, gamepadPressed() { return false; },
    changePresence() {}, setHudVisible(v) { HOST.camHUD.visible = !!v; },
    /* Kade (modchart.lua): actores = receptores 0-7 o nombres de sprite */
    setActorX(x, id) { const o = H.actor(id); if (o) o.x = +x; }, setActorY(y, id) { const o = H.actor(id); if (o) o.y = +y; },
    setActorAlpha(a, id) { const o = H.actor(id); if (o) o.alpha = +a; }, setActorAngle(a, id) { const o = H.actor(id); if (o) o.angle = +a; },
    setActorScale(s, id) { const o = H.actor(id); if (o && o.scale) { o.scale.x = +s; o.scale.y = +s; } },
    getActorX(id) { const o = H.actor(id); return o ? o.x : 0; }, getActorY(id) { const o = H.actor(id); return o ? o.y : 0; }, getActorAlpha(id) { const o = H.actor(id); return o ? o.alpha : 0; }, getActorAngle(id) { const o = H.actor(id); return o ? o.angle : 0; },
    getActorWidth(id) { const o = H.actor(id); return o ? o.width || 0 : 0; }, getActorHeight(id) { const o = H.actor(id); return o ? o.height || 0 : 0; },
    tweenPos(id, x, y, t, cb) { H.ktw(this, id, { x: +x, y: +y }, t, 'linear', cb); }, tweenPosXAngle(id, x, a, t, cb) { H.ktw(this, id, { x: +x, angle: +a }, t, 'linear', cb); }, tweenPosYAngle(id, y, a, t, cb) { H.ktw(this, id, { y: +y, angle: +a }, t, 'linear', cb); },
    tweenAngle(id, a, t, cb) { H.ktw(this, id, { angle: +a }, t, 'linear', cb); }, tweenFadeIn(id, a, t, cb) { H.ktw(this, id, { alpha: +a }, t, 'circIn', cb); }, tweenFadeOut(id, a, t, cb) { H.ktw(this, id, { alpha: +a }, t, 'circOut', cb); },
    setCamZoom(z) { HOST.camGame.zoom = +z; }, setHudZoom(z) { G.hudZoom = +z; }, setHudAngle(a) { HOST.camHUD.angle = +a; }, setCamAngle(a) { HOST.camGame.angle = +a; }, setHudPosition(x, y) { HOST.camHUD.x = +x; HOST.camHUD.y = +y; },
  };
  return api;
})();

/* runHaxeCode: HScript (el mismo intérprete de los .hxc) con "game" = PlayState de Psych */
PsychRT.runHaxe = function (lua, code, vars) {
  try {
    let h = this.haxeCache.get(code);
    if (!h) {
      h = new HX.Script(lua.name + ' (runHaxeCode)', code, CneRT.host({ game: this.gameObj(), PlayState: { __host: 'PlayState', instance: this.gameObj() } }));
      if (h.errors.length) ScriptLog.err(lua.name, 'runHaxeCode: ' + h.errors[0]);
      this.haxeCache.set(code, h);
    }
    const env = { game: this.gameObj() };
    for (const [k, v] of this.vars) env[k] = v;
    if (vars && typeof vars === 'object' && !Array.isArray(vars)) Object.assign(env, vars);
    const r = h.runTop(env);
    if (h.top.some(st => st.k === 'fndecl')) this.haxe = h;
    return r === undefined ? null : r;
  } catch (e) { ScriptLog.err(lua.name, 'runHaxeCode: ' + (e && e.message || e)); return null; }
};

/* teclas para keyJustPressed / keyboardJustPressed */
const KeyState = {
  down: new Set(), just: new Set(), rel: new Set(),
  DIRS: { left: 0, down: 1, up: 2, right: 3, note_left: 0, note_down: 1, note_up: 2, note_right: 3 },
  KEYS: [['LEFT', 'A', 'D'], ['DOWN', 'S', 'F'], ['UP', 'W', 'J'], ['RIGHT', 'D', 'K']],
  act(k) { k = String(k).toLowerCase(); if (k in this.DIRS) return !!(G.strums && G.strums.player.pressed[this.DIRS[k]]); if (k === 'accept') return this.down.has('ENTER') || this.down.has('SPACE'); if (k === 'back') return this.down.has('ESCAPE') || this.down.has('BACKSPACE'); if (k === 'space') return this.down.has('SPACE'); if (k === 'reset') return this.down.has('R'); return false; },
  justAct(k) { k = String(k).toLowerCase(); if (k in this.DIRS) return this.KEYS[this.DIRS[k]].some(x => this.just.has(x)); if (k === 'accept') return this.just.has('ENTER') || this.just.has('SPACE'); if (k === 'back') return this.just.has('ESCAPE'); if (k === 'space') return this.just.has('SPACE'); if (k === 'reset') return this.just.has('R'); return false; },
  relAct(k) { k = String(k).toLowerCase(); if (k in this.DIRS) return this.KEYS[this.DIRS[k]].some(x => this.rel.has(x)); return false; },
  name(e) { const k = e.key || ''; if (k === ' ') return 'SPACE'; if (k.startsWith('Arrow')) return k.slice(5).toUpperCase(); return k.toUpperCase(); },
  frame() { if (this.just.size) this.just.clear(); if (this.rel.size) this.rel.clear(); },
};
addEventListener('keydown', e => { const n = KeyState.name(e); if (!KeyState.down.has(n)) KeyState.just.add(n); KeyState.down.add(n); }, true);
addEventListener('keyup', e => { const n = KeyState.name(e); KeyState.down.delete(n); KeyState.rel.add(n); }, true);

/* ---------- Codename (.hx con el intérprete HScript) ---------- */
const CneRT = {
  scripts: [],
  /* host de un script suelto: sus variables primero, luego lo del juego (HOST) */
  host(extra) {
    const ex = extra || {};
    return Object.assign(Object.create(HOST), { global(n, a) { if (n in ex && ex[n] !== undefined) return ex[n]; return HOST.global(n, a); } });
  },
  find(songId, stageId) {
    const keys = [...ModText.map.keys()].filter(k => /\.hxs?$/.test(k)), out = [];
    const add = k => { if (k && !out.includes(k)) out.push(k); };
    const sid = String(songId || '').toLowerCase(), st = String(stageId || '').toLowerCase();
    if (st) add(keys.find(k => k === `data/stages/${st}.hx` || k === `data/stages/${st}.hxs`));
    for (const k of keys) if (/^data\/scripts\/[^/]+\.hxs?$/.test(k)) add(k);
    if (sid) for (const k of keys) if (k.startsWith(`songs/${sid}/`) && /^songs\/[^/]+\/(scripts\/)?[^/]+\.hxs?$/.test(k)) add(k);
    for (const r of ['bf', 'dad', 'gf']) { const c = Scene.chars[r]; if (c) add(keys.find(k => k === `data/characters/${String(c.id).toLowerCase()}.hx`)); }
    const evs = new Set((G.chart?.events || []).map(e => e.ce && e.ce.name).filter(Boolean));
    for (const n of evs) add(keys.find(k => k === `data/events/${String(n).toLowerCase()}.hx`));
    const kinds = new Set((G.chart?.notes || []).map(n => n.kind).filter(Boolean));
    for (const n of kinds) add(keys.find(k => k === `data/notes/${String(n).toLowerCase()}.hx`));
    return out;
  },
  stop() { for (const s of this.scripts) this.callOne(s, 'destroy', []); this.scripts = []; },
  vars(file) {
    const self = this;
    const v = {
      boyfriend: CharW.get('bf'), bf: CharW.get('bf'), dad: CharW.get('dad'), gf: CharW.get('gf'), girlfriend: CharW.get('gf'),
      camGame: HOST.camGame, camHUD: HOST.camHUD, game: HOST.ps, PlayState: { __host: 'PlayState', instance: HOST.ps, get SONG() { return PsychRT.SONG(); } },
      stage: HOST.ps.currentStage, curBeat: 0, curStep: 0, curMeasure: 0,
      add: o => HOST.ps.add(o), remove: o => HOST.ps.remove(o), insert: (i, o) => HOST.ps.insert(i, o),
      disableScript: () => { const s = self.scripts.find(x => x.name === file); if (s) s.off = true; },
      importScript: p => ScriptLog.info(file, `importScript("${p}") no se imita`),
      __script__: { name: file },
    };
    // Codename: las piezas del escenario (XML) son variables con su nombre
    if (Scene.stage) for (const p of Scene.stage.props) if (p.name && /^[A-Za-z_]\w*$/.test(p.name) && !(p.name in v)) v[p.name] = propW(p);
    return v;
  },
  start(songId, stageId) {
    this.stop();
    for (const k of this.find(songId, stageId)) this.load(k);
    for (const s of this.scripts) this.callOne(s, 'postCreate', []);
    return this.scripts.length;
  },
  load(key) {
    const text = ModText.map.get(key); if (text == null) return null;
    let sc;
    try {
      sc = new HX.Script(key, text, this.host());
      if (sc.errors.length) ScriptLog.err(key, 'sintaxis: ' + sc.errors.slice(0, 2).join(' · '));
      const prev = HX.R.cur; HX.R.cur = key;
      try { sc.runTop(this.vars(key)); } finally { HX.R.cur = prev; }
    } catch (e) { ScriptLog.err(key, 'al cargar: ' + (e && e.message || e)); return null; }
    const s = { name: key, sc, off: false, ms: 0, calls: 0 };
    this.scripts.push(s);
    this.callOne(s, 'create', []);
    ScriptLog.info(key, 'cargado');
    return s;
  },
  callOne(s, fn, args) {
    if (s.off || !s.sc.hasTop(fn)) return undefined;
    const t0 = performance.now();
    try { return s.sc.callTop(fn, args); }
    catch (e) { ScriptLog.err(s.name, `${fn}: ${e && e.message || e}`); return undefined; }
    finally { s.ms += performance.now() - t0; s.calls++; }
  },
  call(fn, args) { for (const s of this.scripts) this.callOne(s, fn, args); const ev = args && args[0]; return !!(ev && ev.cancelled); },
  set(k, v) { for (const s of this.scripts) s.sc.setTop(k, v); },
  ev(extra) { const e = Object.assign({ __host: 'CancellableEvent', __open: true, cancelled: false, cancel() { e.cancelled = true; }, preventDefault() { e.cancelled = true; } }, extra); return e; },
};

/* ---------- reparto del ciclo de vida ---------- */
const ScriptHub = {
  engine: null, started: false, prevPos: null, lastSection: null, real: 0,
  get on() { return PsychRT.scripts.length > 0 || CneRT.scripts.length > 0; },
  summary() {
    const lua = PsychRT.scripts.filter(s => !s.closed).length, hx = CneRT.scripts.length, mods = Mods.modules.size, ev = Mods.events.size, kinds = Mods.kinds.size;
    const parts = []; if (lua) parts.push(`${lua} .lua`); if (hx) parts.push(`${hx} .hx`);
    if (mods || ev || kinds || StageRT.cur) parts.push(`.hxc: ${mods} módulos · ${ev} eventos · ${kinds} tipos de nota${StageRT.cur ? ' · escenario' : ''}`);
    return parts.length ? parts.join(' · ') : 'sin scripts';
  },
  /* desde StageRT.start (cargar canción / reiniciar / buscar). Devuelve true si hay scripts reales de Psych/Codename */
  start() {
    this.stop();
    ScriptLog.errs.clear(); ScriptLog.total = 0; ScriptLog.dirty = true;   // el conteo de errores es por canción (la lista queda como historial)
    this.engine = (typeof SongImport !== 'undefined' && SongImport.engine) || null; this.prevPos = G.songPos; this.lastSection = null; this.started = G.songPos >= 0;
    if (typeof HudState !== 'undefined') HudState.reset();
    if (!G.chart || !this.engine) return false;
    const song = SongImport.cur, stage = Scene.stage ? Scene.stage.id : null;
    if (this.engine !== 'vslice') { HOST.camGame._filters = []; HOST.camHUD._filters = []; CamFilters.clear('hxc:'); }
    let n = 0;
    try {
      if (this.engine === 'psych' || this.engine === 'kade') n = PsychRT.start(song, stage);
      else if (this.engine === 'codename') n = CneRT.start(song, stage);
    } catch (e) { ScriptLog.err('scripts', 'arranque: ' + (e && e.message || e)); }
    this.real = n;
    return n > 0;
  },
  stop() { try { PsychRT.stop(); CneRT.stop(); } catch (e) { console.warn('[scripts] stop', e); } this.real = 0; },
  update(dt) {
    const pos = G.songPos;
    if (!this.started && this.prevPos !== null && this.prevPos < 0 && pos >= 0) { this.started = true; this.songStart(); }
    this.prevPos = pos;
    const el = dt / 1000;
    if (PsychRT.scripts.length) {
      PsychRT.setAll('curDecBeat', Cond.beat(pos)); PsychRT.setAll('curDecStep', Cond.step(pos)); PsychRT.setAll('songPosition', pos);
      PsychRT.callAll('onUpdate', [el]); PsychRT.callAll('update', [el]); PsychRT.callAll('onUpdatePost', [el]);
    }
    if (CneRT.scripts.length) { CneRT.call('update', [el]); CneRT.call('postUpdate', [el]); }
    KeyState.frame();
  },
  beat(b) {
    if (PsychRT.scripts.length) { PsychRT.setAll('curBeat', b); PsychRT.setAll('curBpm', 60000 / Cond.crochet(G.songPos)); PsychRT.callAll('onBeatHit', []); PsychRT.callAll('beatHit', [b]); }
    if (CneRT.scripts.length) { CneRT.set('curBeat', b); CneRT.call('beatHit', [b]); if (b % 4 === 0) { CneRT.set('curMeasure', b / 4); CneRT.call('measureHit', [b / 4]); } }
  },
  step(s) {
    if (PsychRT.scripts.length) {
      PsychRT.setAll('curStep', s); PsychRT.callAll('onStepHit', []); PsychRT.callAll('stepHit', [s]);
      const sec = Math.floor(s / 16);
      if (s >= 0 && sec !== this.lastSection) { this.lastSection = sec; PsychRT.setAll('curSection', sec); PsychRT.setAll('mustHitSection', Scene.focus === 'bf'); PsychRT.callAll('onSectionHit', []); }
    }
    if (CneRT.scripts.length) { CneRT.set('curStep', s); CneRT.call('stepHit', [s]); }
  },
  noteHit(n, isP) {
    if (PsychRT.scripts.length) {
      const a = [G.chart.notes.indexOf(n), n.lane, n.kind || '', false];
      if (isP) { PsychRT.callAll('goodNoteHit', a); PsychRT.callAll('playerOneSing', [n.lane, n.time]); }
      else { PsychRT.callAll('opponentNoteHit', a); PsychRT.callAll('playerTwoSing', [n.lane, n.time]); }
    }
    if (CneRT.scripts.length) {
      const ev = CneRT.ev({ __host: 'NoteHitEvent', note: { __open: true, strumTime: n.time, noteData: n.lane, isSustainNote: false, noteType: n.kind || '', sustainLength: n.sustain }, direction: n.lane, noteType: n.kind || '', character: CharW.get(isP ? 'bf' : 'dad'), player: isP, preventAnim() {}, unmuteVocals() {} });
      CneRT.call(isP ? 'onPlayerHit' : 'onDadHit', [ev]); CneRT.call('onNoteHit', [ev]);
    }
  },
  noteMiss(n) {
    if (PsychRT.scripts.length) { PsychRT.callAll('noteMiss', [G.chart.notes.indexOf(n), n.lane, n.kind || '', false]); PsychRT.callAll('playerOneMiss', [n.lane, n.time]); }
    if (CneRT.scripts.length) CneRT.call('onPlayerMiss', [CneRT.ev({ __host: 'NoteMissEvent', note: { __open: true, strumTime: n.time, noteData: n.lane, noteType: n.kind || '' }, direction: n.lane, character: CharW.get('bf') })]);
  },
  /* evento del chart → onEvent (Lua / Codename) y onSongEvent (módulos .hxc). true = lo manejó un script (no se busca video/sonido) */
  event(ev) {
    let handled = false;
    if (ev.pe && PsychRT.scripts.length) {
      const has = PsychRT.scripts.some(s => !s.closed && s.has('onEvent'));
      PsychRT.callAll('onEvent', [ev.pe.name, String(ev.pe.v1 ?? ''), String(ev.pe.v2 ?? ''), ev.t]);
      if (has && ev.psych) handled = true;
    }
    if (ev.ce && CneRT.scripts.length) {
      const has = CneRT.scripts.some(s => s.sc.hasTop('onEvent'));
      CneRT.call('onEvent', [CneRT.ev({ __host: 'EventGameEvent', event: { name: ev.ce.name, params: ev.ce.params, time: ev.t } })]);
      if (has && Array.isArray(ev.v)) handled = true;
    }
    if (Mods.modules.size && !String(ev.e).startsWith('_')) {
      const data = { __host: 'SongEventScriptEvent', eventData: { __host: 'SongEventData', eventKind: ev.e, kind: ev.e, time: ev.t, value: ev.v ?? null } };
      for (const m of Mods.modules.values()) if (m.inst.active !== false && m.script.findMethod(m.cls, 'onSongEvent')) { try { m.script.callMethod(m.inst, 'onSongEvent', [data]); } catch (e) { ScriptLog.err(m.file, 'onSongEvent: ' + e.message); } }
    }
    return handled;
  },
  countdown(tick) {
    if (PsychRT.scripts.length) { if (tick === 0) { PsychRT.setAll('startedCountdown', true); PsychRT.callAll('onCountdownStarted', []); } PsychRT.callAll('onCountdownTick', [tick]); }
    if (CneRT.scripts.length) CneRT.call('onCountdown', [CneRT.ev({ __host: 'CountdownEvent', swagCounter: tick })]);
    if (Mods.hasHooks) { if (tick === 0) this.hx('onCountdownStart', { __host: 'CountdownScriptEvent' }); this.hx('onCountdownStep', { __host: 'CountdownScriptEvent', step: ['THREE', 'TWO', 'ONE', 'GO'][tick] || 'AFTER' }); }
  },
  hx(name, ev) { try { Mods.hook(name, ev); } catch (e) { ScriptLog.err('hxc', `${name}: ${e && e.message || e}`); } },
  songStart() {
    if (PsychRT.scripts.length) { PsychRT.callAll('onSongStart', []); PsychRT.callAll('start', [G.chart ? G.chart.title : '']); }
    if (CneRT.scripts.length) CneRT.call('onSongStart', []);
    if (Mods.hasHooks) this.hx('onSongStart', { __host: 'ScriptEvent' });
  },
  pause() {
    if (PsychRT.scripts.length) PsychRT.callAll('onPause', []);
    if (CneRT.scripts.length) CneRT.call('onGamePause', [CneRT.ev({ __host: 'PauseEvent' })]);
    if (Mods.hasHooks) this.hx('onPause', { __host: 'PauseScriptEvent' });
  },
  resume() {
    if (PsychRT.scripts.length) PsychRT.callAll('onResume', []);
    if (CneRT.scripts.length) CneRT.call('onResume', []);
    if (Mods.hasHooks) this.hx('onResume', { __host: 'ScriptEvent' });
  },
  songEnd() {
    if (PsychRT.scripts.length) PsychRT.callAll('onEndSong', []);
    if (CneRT.scripts.length) CneRT.call('onSongEnd', []);
    if (Mods.hasHooks) this.hx('onSongEnd', { __host: 'ScriptEvent' });
  },
  /* ms totales gastados en scripts (medición de lag) */
  cost() { let ms = 0, calls = 0; for (const s of PsychRT.scripts) { ms += s.ms; calls += s.calls; } for (const s of CneRT.scripts) { ms += s.ms; calls += s.calls; } return { ms, calls }; },
};

/* la consola se refresca 4 veces por segundo (también en la pausa) */
setInterval(() => { try { ScriptLog.tick(); } catch (e) {} }, 250);
