/* =====================================================================
   eventos.js — eventos de canción (chart "events": [{t, e, v}]).
   v3.8.0: los eventos de V-Slice (FocusCamera, ZoomCamera, SetCameraBop, ScrollSpeed,
   PlayAnimation, SetTargetBopSpeed, SetHealthIcon) y los .hxc (ScriptedSongEvent) los ejecuta
   el puerto de vslice.js: SongEventRegistry.queryEvents + PlayState.processSongEvents cada frame
   (eventos con t <= songPosition, también negativos en la cuenta atrás; > 1000 ms de antigüedad
   solo si processOldEvents). Aquí quedan los eventos propios de este motor (convertidos de
   Psych / Codename, cambio de personaje, medios) registrados como SongEvent en el mismo registro.
   ===================================================================== */
'use strict';

/* ---------- FlxEase (vslice.js = copia exacta de flixel/tweens/FlxEase.hx) ----------
   Ease.get(ease, dir): como SongEvent (distingue mayúsculas; inexistente → null).
   Ease.loose(...): búsqueda sin mayúsculas, solo para scripts .lua/.hx de Psych/Codename. */
const Ease = (() => {
  const E = Object.assign({}, VS.FlxEase);
  const lower = {}; for (const k of Object.keys(VS.FlxEase)) lower[k.toLowerCase()] = VS.FlxEase[k];
  E.get = (name, dir) => VS.easeFor(String(name ?? 'linear'), dir);
  E.loose = (name, dir) => {
    let n = String(name ?? 'linear').trim(); if (!n) n = 'linear';
    const d = dir === undefined || dir === null ? 'In' : String(dir);
    if (!/(in|out)$/i.test(n) && n.toLowerCase() !== 'linear') n += d;
    return VS.FlxEase[n] || lower[n.toLowerCase()] || null;
  };
  return E;
})();

/* Interpolación simple en tiempo de juego (solo la usan efectos propios del motor, no los eventos de V-Slice) */
function makeTween(from, to, durMs, ease) { return { from, to, t0: G.gameTime, dur: Math.max(0, durMs), ease: ease || Ease.linear }; }
function tweenValue(tw) {
  const k = tw.dur <= 0 ? 1 : clamp((G.gameTime - tw.t0) / tw.dur, 0, 1), e = tw.ease(k);
  return Array.isArray(tw.from) ? tw.from.map((f, i) => f + (tw.to[i] - f) * e) : tw.from + (tw.to - tw.from) * e;
}
const tweenDone = tw => tw.dur <= 0 || G.gameTime - tw.t0 >= tw.dur;

const getBool = (v, d) => v === undefined || v === null ? d : (v === true || v === 'true' || v === 1 || v === '1');
const getNum = (v, d) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };

/* nombres de personaje en PlayAnimation (PlayAnimationSongEvent) */
const roleOfTarget = t => { t = String(t ?? '').toLowerCase().trim(); return /^(bf|boyfriend|player|0)$/.test(t) ? 'bf' : /^(dad|opponent|1)$/.test(t) ? 'dad' : /^(gf|girlfriend|2)$/.test(t) ? 'gf' : null; };
/* eventos personalizados de "cambiar personaje" (V-Slice/.hxc): ChangeCharacter, Change Character, switchCharacter… */
const CHANGE_CHAR_RX = /^(change|switch|swap|set)[\s_-]?(char|character|player|opponent|dad|bf|gf)$/i;
function changeCharInfo(ev) {
  if (!ev || !CHANGE_CHAR_RX.test(ev.e || '')) return null;
  const v = ev.v && typeof ev.v === 'object' && !Array.isArray(ev.v) ? ev.v : Array.isArray(ev.v) ? { target: ev.v[0], char: ev.v[1] } : { char: ev.v };
  const id = v.char ?? v.character ?? v.id ?? v.newChar ?? v.newCharacter ?? v.charId ?? v.name ?? v.value2;
  if (typeof id !== 'string' || !id) return null;
  let role = roleOfTarget(v.target ?? v.role ?? v.strumline ?? v.who ?? v.type ?? v.value1);
  if (!role) { const m = /(player|bf|opponent|dad|gf)$/i.exec(ev.e); role = m ? roleOfTarget(m[1]) : 'dad'; }
  return { role, id: String(id) };
}

/* ---------- eventos propios del motor como SongEvent (mismo registro, mismo despacho) ---------- */
class EngineSongEvent extends VS.SongEvent {
  constructor(id, processOld, fn, title) { super(id, { processOldEvents: processOld }); this.fn = fn; this.title = title || id; this.engine = true; }
  handleEvent(data) { this.fn(Events.vals({ e: data.eventKind, v: data.value }), data); }
  getTitle() { return this.title; }
}

const Events = {
  fired: 0, log: [], iconCache: new Map(), charCache: new Map(), soundCache: new Map(),
  INTERNAL: ['ChangeCharacter', '_AddCameraZoom', '_SetGFSpeed', '_AltAnim', '_ScreenShake', '_PlaySound', '_SetProperty', '_CamFlash', '_ScriptEvent', '_CamFollowAuto'],
  get list() { return (G.chart && G.chart.events) || []; },
  stepMs() { return VS.play ? VS.play.conductor.stepLengthMs : Cond.stepMs(G.songPos); },
  isBuiltin(name) { return VS.SongEventRegistry.builtinIds.has(name) || this.INTERNAL.includes(name); },
  /* valor "v" como objeto (solo para los eventos propios; los de V-Slice leen data.value tal cual) */
  vals(ev) {
    const v = ev.v;
    if (v && typeof v === 'object' && !Array.isArray(v)) return v;
    if (ev.e === 'PlayAnimation') return { anim: v };
    return {};
  },
  /* estado inicial de lo que NO es de PlayState (iconos y personajes cambiados por eventos) */
  reset() {
    this.log.length = 0;
    if (Scene.baseIcons) { Scene.icons.player = Scene.baseIcons.player; Scene.icons.opponent = Scene.baseIcons.opponent; }
    if (Scene.baseChars) {
      let changed = false;
      for (const r of ['bf', 'dad', 'gf']) if (Scene.chars[r] !== Scene.baseChars[r]) { Scene.chars[r] = Scene.baseChars[r]; changed = true; }
      if (changed && typeof applyBarColors === 'function') applyBarColors();
    }
    for (const c of Object.values(Scene.chars)) if (c) { c._idleSuffix = ''; c.altSing = false; if (c.baseDanceEvery !== undefined) c.danceEvery = c.baseDanceEvery; }
    G.autoFocus = !(G.chart && G.chart.hasFocusEvents);
  },
  /* lo llama PlayCore.processSongEvents al ejecutar uno (registro + scripts .lua/.hx) */
  onFired(ev, canceled) {
    this.fired++; this.log.push(ev.eventKind + '@' + Math.round(ev.time) + (canceled ? '(cancelado)' : '')); if (this.log.length > 20) this.log.shift();
    let handled = false;
    if (!canceled && typeof ScriptHub !== 'undefined') handled = ScriptHub.event({ t: ev.time, e: ev.eventKind, v: ev.value, pe: ev.pe, ce: ev.ce, psych: ev.psych });
    if (!canceled && !handled && !VS.SongEventRegistry.getEvent(ev.eventKind)) this.unhandled(ev);   // un .lua/.hx que lo maneja: no se buscan medios
  },
  /* evento sin SongEvent registrado: V-Slice solo avisa. Extra de este motor: cambio de personaje / medios que nombra */
  unhandled(data) {
    const ev = { t: data.time, e: data.eventKind, v: data.value };
    const cc = changeCharInfo(ev);
    if (cc) { this.changeChar(cc.role, cc.id, false); return; }
    if (VS.play && VS.play.conductor.songPosition - data.time > 1000) return;
    this.playMedia(ev);
  },
  /* ejecutar un evento ya (triggerEvent de Psych, cameraSetTarget…): SongEventScriptEvent + handleEvent */
  fire(ev) {
    if (!VS.play) return;
    const d = new VS.SongEventData(ev.t ?? G.songPos, ev.e, ev.v);
    if (ev.pe) d.pe = ev.pe; if (ev.ce) d.ce = ev.ce; if (ev.psych) d.psych = ev.psych;
    const e = new VS.SongEventScriptEvent(d); VS.play.dispatchEvent(e);
    if (!e.eventCanceled) VS.SongEventRegistry.handleEvent(d);
    this.onFired(d, e.eventCanceled);
  },
  registerEngineEvents() {
    const R = VS.SongEventRegistry, add = (id, old, fn) => R.register(new EngineSongEvent(id, old, fn));
    add('ChangeCharacter', true, v => this.changeChar(v.target, v.char, false));
    add('_CamFollowAuto', true, () => { G.autoFocus = true; });      // Psych "Camera Follow Pos" vacío
    add('_AddCameraZoom', false, v => {
      const P = VS.play; if (!Optim.s.bop || !P) return;
      if (P.camera.zoom < 1.35 * P.stageZoom) { P.cameraBopMultiplier += getNum(v.game, 0.015) / Math.max(0.1, P.currentCameraZoom); P.camHUD.zoom += getNum(v.hud, 0.03); }
    });
    add('_SetGFSpeed', true, v => { const gf = Scene.chars.gf; if (gf) { if (gf.baseDanceEvery === undefined) gf.baseDanceEvery = gf.danceEvery; gf.danceEvery = Math.max(1, getNum(v.speed, 1)); } });
    add('_AltAnim', true, v => {
      const c = Scene.chars[v.role]; if (!c) return;
      if (v.sing !== undefined) c.altSing = !!v.sing;
      if (v.idle !== undefined) c.idleSuffix = v.idle ? '-alt' : '';
      if (v.idleSuffix !== undefined) c.idleSuffix = String(v.idleSuffix || '');
    });
    add('_ScreenShake', false, v => { for (const w of ['game', 'hud']) { const o = v[w]; if (o && o.dur > 0 && o.i > 0) CamFX[w].shake = { i: o.i, t0: G.gameTime, dur: o.dur * 1000, axes: 0x11 }; } });
    add('_ScriptEvent', false, () => {});
    add('_SetProperty', true, v => { if (typeof PsychRT !== 'undefined') PsychRT.setProp(String(v.path || ''), PsychRT.coerce(v.value)); });
    add('_CamFlash', false, v => {
      const cam = /hud|other/i.test(v.cam) ? HOST.camHUD : HOST.camGame, dur = getNum(v.steps, 4) * this.stepMs() / 1000;
      let col = v.color; if (Array.isArray(col)) col = (0xFF000000 | ((col[0] & 255) << 16) | ((col[1] & 255) << 8) | (col[2] & 255)) >>> 0; else if (typeof col === 'string') col = HOST.global('FlxColor').fromString(col) ?? 0xFFFFFFFF;
      if (v.reversed) cam.fade(col >>> 0, dur, false, () => cam.stopFade(), true); else cam.flash(col >>> 0, dur, null, true);
    });
    add('_PlaySound', false, v => {
      const buf = this.soundCache.get(String(v.sound)); const c = Sfx.ensureCtx && Sfx.ensureCtx();
      if (buf && c) { const src = c.createBufferSource(), g = c.createGain(); g.gain.value = getNum(v.volume, 1); src.buffer = buf; src.connect(g).connect(c.destination); src.start(); }
    });
  },
  /* cambio de personaje: ya está cargado y subido a la GPU desde la pantalla de carga → sin tirón */
  changeChar(target, id, instant) {
    const role = roleOfTarget(target) || (['bf', 'dad', 'gf'].includes(target) ? target : null); if (!role || !id) return;
    const base = Scene.baseChars && Scene.baseChars[role];
    let c = null, icon = null;
    if (base && base.id === id) { c = base; icon = Scene.baseIcons && Scene.baseIcons[role === 'bf' ? 'player' : 'opponent']; }
    else { const rec = this.charCache.get(role + '|' + id); if (!rec || !(rec.char instanceof RealChar)) { if (!instant) console.warn('[eventos] personaje sin cargar:', id); return; } c = rec.char; icon = rec.icon; }
    const old = Scene.chars[role];
    if (old === c) return;
    placeChar(c, role);
    if (old && !instant) { c.hasDanced = old.hasDanced; }
    c.reset();
    Scene.chars[role] = c;
    if (role !== 'gf' && icon && icon.ok) Scene.icons[role === 'bf' ? 'player' : 'opponent'] = icon;
    applyBarColors();
    // (la cámara no se mueve sola: en V-Slice el siguiente FocusCamera usa el cameraFocusPoint del nuevo personaje)
  },
  playMedia(ev) {
    for (const m of this.mediaOf(ev)) {
      if (m.kind === 'video') { const url = ModRes.get('video', m.key, null); if (url) { VideoSync.play(url, m.key, ev.t); this.lastMedia = 'video ' + m.key; } }
      else if (m.kind === 'gif') { const url = ModRes.get('gif', m.key, null); if (url) { VideoSync.play(url, m.key, ev.t, { gif: true, ms: 3000 }); this.lastMedia = 'gif ' + m.key; } }
      else if (m.kind === 'sound') { const buf = ModRes.get('sound', m.key, null), c = Sfx.ensureCtx && Sfx.ensureCtx(); if (buf && c) { const src = c.createBufferSource(); src.buffer = buf; src.connect(c.destination); src.start(); this.lastMedia = 'sonido ' + m.key; } }
    }
  },
  /* SetHealthIconSongEvent → iconP1 / iconP2.configure(data) */
  setIcon(ch, data, shouldBop) {
    const v = { id: data.id, scale: data.scale, flipX: data.flipX, isPixel: data.isPixel, offsetX: data.offsets[0], offsetY: data.offsets[1] };
    const key = this.iconKey(ch, v);
    const apply = ic => { if (ic && ic.ok) { ic.shouldBop = shouldBop !== false; Scene.icons[ch === 0 ? 'player' : 'opponent'] = ic; } };
    const cached = this.iconCache.get(key);
    if (cached && cached.then) cached.then(apply); else if (cached) apply(cached);
    else this.loadIcon(ch, v).then(apply);
  },
  iconKey(ch, v) { return JSON.stringify([ch, v.id, v.scale, v.flipX, v.isPixel, v.offsetX, v.offsetY]); },
  loadIcon(ch, v) {
    const key = this.iconKey(ch, v), id = String(v.id ?? 'face');
    const p = new HealthIcon(ch === 0 ? 0 : 1).load(id, { id, scale: getNum(v.scale, 1), flipX: getBool(v.flipX, false), isPixel: getBool(v.isPixel, false), offsets: [getNum(v.offsetX, 0), getNum(v.offsetY, 0)] })
      .then(ic => { this.iconCache.set(key, ic); return ic; });
    this.iconCache.set(key, p);
    return p;
  },

  /* ---------- análisis por variación: qué eventos usa el chart y qué assets necesitan ---------- */
  analyze(chart) {
    const counts = new Map(), chars = new Map(), icons = new Set(), sounds = new Set();
    for (const ev of (chart && chart.events) || []) {
      counts.set(ev.e, (counts.get(ev.e) || 0) + 1);
      const v = this.vals(ev);
      if (ev.e === 'ChangeCharacter' && v.char) { const role = roleOfTarget(v.target) || 'dad', k = role + '|' + v.char; chars.set(k, { role, id: String(v.char), n: (chars.get(k)?.n || 0) + 1, from: 'Change Character' }); }
      else if (ev.e === 'SetHealthIcon') icons.add(String(v.id ?? 'face'));
      else if (ev.e === '_PlaySound' && v.sound) sounds.add(String(v.sound));
      else { const cc = changeCharInfo(ev); if (cc) { const k = cc.role + '|' + cc.id; chars.set(k, { role: cc.role, id: cc.id, n: (chars.get(k)?.n || 0) + 1, from: ev.e }); } }
    }
    // v3.5.0: TODOS los eventos (también los desconocidos): personajes, imágenes, videos, gifs y sonidos que nombran
    const media = new Map();
    for (const ev of this.allEvents(chart)) {
      if (!counts.has(ev.e)) counts.set(ev.e, 0);
      for (const m of this.mediaOf(ev)) {
        if (m.kind === 'char') { if (![...chars.values()].some(c => c.id === m.key)) chars.set(m.role + '|' + m.key, { role: m.role, id: m.key, n: 1, from: ev.e }); }
        else if (m.kind === 'sound') sounds.add(m.key);
        else { const k = m.kind + '|' + m.key; const o = media.get(k); if (o) o.n++; else media.set(k, { kind: m.kind, key: m.key, n: 1, from: ev.e }); }
      }
    }
    // personajes que piden los .hxc cargados (CharacterDataParser.fetchCharacter("…"))
    for (const rec of Mods.scripts.values()) for (const id of (rec.analysis && rec.analysis.chars) || []) { const k = 'dad|' + id; if (![...chars.values()].some(c => c.id === id)) chars.set(k, { role: 'dad', id, n: 0, from: rec.name }); }
    return { counts, chars: [...chars.values()], icons: [...icons], sounds: [...sounds], media: [...media.values()] };
  },
  /* eventos de TODAS las dificultades y variaciones cargadas (paquete V-Slice o canción de Psych/Codename/Kade) */
  allEvents(chart) {
    const key = G.pack || G.set || G.raw;
    if (this._allKey !== key || this._allChart !== chart) {
      const out = [...((chart && chart.events) || [])];
      try {
        if (G.pack) for (const va of G.pack.vars) for (const d of (Chart.parse(va.chart, va.meta).difficulties || [])) out.push(...Chart.parse(va.chart, va.meta, d).events);
        else if (G.set) for (const d of Object.keys(G.set.diffs)) out.push(...Chart.parse(G.set.diffs[d], G.set.meta, d, G.set.extra).events);
      } catch (e) { console.warn('[eventos] análisis de variaciones', e); }
      this._allKey = key; this._allChart = chart; this._all = out;
    }
    return this._all;
  },
  /* lo que nombra un evento: "video.mp4", "images/x.png", "sonido.ogg", "cutscene.gif", ids de personaje… */
  mediaOf(ev) {
    if (ev._media) return ev._media;
    const out = [], v = this.vals(ev), name = String(ev.e || '');
    const strs = []; const walk = (x, k, d) => { if (d > 3 || x == null) return; if (typeof x === 'string') strs.push([k, x.trim()]); else if (Array.isArray(x)) x.forEach((y, i) => walk(y, k, d + 1)); else if (typeof x === 'object') for (const [kk, y] of Object.entries(x)) walk(y, kk, d + 1); };
    walk(v, '', 0); if (typeof ev.v === 'string') strs.push(['', ev.v.trim()]);
    const clean = s => s.replace(/^assets\/(\w+\/)?/, '').replace(/^(shared|preload|week\d+):/, '');
    const isVidEv = /video|cutscene|movie|mp4/i.test(name), isSndEv = /sound|sfx|audio|play\s*snd/i.test(name), isImgEv = /image|sprite|graphic|overlay|picture|flash\s*image|show/i.test(name);
    const isGifEv = /gif/i.test(name), isCharEv = /char(acter)?|swap|player\s*change|change\s*(bf|dad|gf|opponent|player)/i.test(name) && !/icon|color|colour|camera|focus|anim/i.test(name);
    for (const [k, raw] of strs) {
      if (!raw || raw.length > 120 || /^(true|false|null|-?\d+(\.\d+)?|#?[0-9a-f]{6,8}|linear|classic|instant|in|out|inout)$/i.test(raw)) continue;
      const s = clean(raw), base = s.replace(/^(videos|images|sounds|music)\//i, '');
      if (/\.(mp4|webm)$/i.test(s) || /^videos\//i.test(s) || (isVidEv && /^[\w\/ -]+$/.test(s) && !/^(skip|true|false)$/i.test(s))) out.push({ kind: 'video', key: base.replace(/\.(mp4|webm)$/i, '') + (/\.webm$/i.test(s) ? '.webm' : '') });
      else if (/\.gif$/i.test(s) || (isGifEv && /^[\w\/ -]+$/.test(s))) out.push({ kind: 'gif', key: base.replace(/\.gif$/i, '') });
      else if (/\.(ogg|mp3|wav)$/i.test(s) || /^sounds\//i.test(s) || (isSndEv && /^[\w\/ -]+$/.test(s))) out.push({ kind: 'sound', key: base.replace(/\.(ogg|mp3|wav)$/i, '') });
      else if (/\.(png|jpe?g|webp)$/i.test(s) || /^images\//i.test(s) || (isImgEv && /^[\w\/-]+$/.test(s) && /[\/_-]|^[a-z]/i.test(s) && k !== 'target')) out.push({ kind: 'image', key: base.replace(/\.(png|jpe?g|webp)$/i, '') });
      else if (isCharEv && /^[a-z0-9][\w.-]*$/i.test(s) && !/^(bf|dad|gf|boyfriend|girlfriend|opponent|player|0|1|2)$/i.test(s) && ev.e !== 'ChangeCharacter' && !changeCharInfo(ev)) {
        const role = /bf|boyfriend|player|^0$/i.test(String(v.target ?? v.char ?? v.value1 ?? '')) ? 'bf' : /gf|girlfriend|^2$/i.test(String(v.target ?? v.value1 ?? '')) ? 'gf' : 'dad';
        out.push({ kind: 'char', key: s, role });
      }
    }
    return (ev._media = out);
  },
  charStatus(id) {
    for (const [k, r] of this.charCache) if (k.endsWith('|' + id)) return r.loading ? 'loading' : r.char instanceof RealChar ? 'ok' : 'missing';
    return 'none';
  },
  /* lo que falta (para la ventana de "Eventos y note kinds") */
  requirements() {
    const out = [];
    if (!G.chart) return out;
    const a = this.analyze(G.chart);
    for (const c of a.chars) out.push({ type: 'evchar', key: c.id, role: c.role, from: `${c.from}${c.n ? ' ×' + c.n : ''}` });
    for (const sn of a.sounds) out.push({ type: 'res', kind: 'sound', key: sn, lib: null, from: 'evento Play Sound' });
    for (const m of a.media) out.push({ type: 'res', kind: m.kind, key: m.key, lib: null, from: `evento ${m.from}${m.n > 1 ? ' ×' + m.n : ''}` });
    return out;
  },
  async preloadChar(role, id) {
    const key = role + '|' + id;
    const rec = { loading: true, char: null, icon: null };
    this.charCache.set(key, rec);
    const c = await loadCharacter(role, id).catch(e => ({ error: e.message }));
    rec.loading = false;
    if (!(c instanceof RealChar)) { rec.char = c; return rec; }
    rec.char = c;
    rec.icon = await new HealthIcon(role === 'bf' ? 0 : 1).load(c.id, c.data && c.data.healthIcon).catch(() => null);
    return rec;
  },
  /* precarga (pantalla de carga): iconos de SetHealthIcon, personajes de Change Character, sonidos de Play Sound */
  preload(chart) {
    this.iconCache.clear(); this.soundCache.clear();
    const keep = new Map(); for (const [k, r] of this.charCache) if (r.char instanceof RealChar) keep.set(k, r);
    this.charCache = keep;
    const tasks = [];
    for (const ev of chart.events || []) if (ev.e === 'SetHealthIcon') {
      const r = this.vals(ev), ch = r.char ?? 0, v = { id: r.id ?? 'face', scale: r.scale ?? 1.0, flipX: r.flipX ?? false, isPixel: r.isPixel ?? false, offsetX: r.offsetX ?? 0.0, offsetY: r.offsetY ?? 0.0 };
      if ((ch === 0 || ch === 1) && !this.iconCache.has(this.iconKey(ch, v))) tasks.push(this.loadIcon(ch, v));
    }
    const a = this.analyze(chart);
    for (const c of a.chars) if (!this.charCache.has(c.role + '|' + c.id)) tasks.push(this.preloadChar(c.role, c.id));
    for (const sn of a.sounds) tasks.push(ModRes.load('sound', sn, null).then(buf => { if (buf) this.soundCache.set(sn, buf); }).catch(() => {}));
    for (const m of a.media) tasks.push(Promise.resolve(ModRes.load(m.kind, m.key, null)).catch(() => {}));
    // recursos que piden los .hxc cargados (imágenes, sparrow, sonidos…): listos antes de jugar
    for (const rec of Mods.scripts.values()) for (const r of (rec.analysis && rec.analysis.res) || []) if (r.kind !== 'atlas') tasks.push(Promise.resolve(ModRes.load(r.kind, r.key, r.lib)).catch(() => {}));
    return Promise.all(tasks).then(() => {
      // texturas de los personajes de los eventos: recortadas y subidas ya (al cambiar no hay tirón)
      try { if (typeof Render !== 'undefined') Render.prewarm(this.eventTextures()); } catch (e) { console.warn('[eventos] precarga GPU', e); }
    });
  },
  eventTextures() {
    const set = new Set();
    for (const r of this.charCache.values()) if (r.char instanceof RealChar) for (const a of r.char.anims.values()) {
      if (a.type === 'atlas') for (const sp of a.model.sprites.values()) set.add(sp.img); else for (const f of a.frames) if (f && f.img) set.add(f.img);
    }
    return [...set];
  },
  summary() {
    const c = {}; for (const e of this.list) c[e.e] = (c[e.e] || 0) + 1;
    return Object.entries(c).map(([k, n]) => `${k}×${n}${this.isBuiltin(k) ? '' : VS.SongEventRegistry.getEvent(k) ? ' (.hxc)' : CHANGE_CHAR_RX.test(k) ? ' (imitado: cambio de personaje)' : ' (sin .hxc)'}`).join(', ') || 'ninguno';
  },
  statusLines() {
    const out = [];
    for (const [k, r] of this.charCache) {
      const [role, id] = k.split('|');
      out.push(r.char instanceof RealChar ? `✔ evento cambio de personaje: ${id} (${role}) precargado · ${r.char.anims.size} anims` : `✘ evento cambio de personaje: falta ${id} (data/characters/${id}.json + su imagen) → Eventos / note kinds`);
    }
    return out;
  },
};
Events.registerEngineEvents();
