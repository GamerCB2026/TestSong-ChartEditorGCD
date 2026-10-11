/* =====================================================================
   v4.0.0 — Cinemáticas, videos e interacción de los scripts .hxc (V-Slice)
   · Cutscene: retener la canción (cuenta atrás cancelada, final cancelado, video a mitad)
     y PlayState.instance.startCountdown() / endSong(true) / isInCutscene
   · VideoCutscene.play(path, tipo) y FunkinVideoSprite / FlxVideoSprite (hxvlc) con sus señales
   · FlxG.keys (justPressed.SPACE…), FlxG.mouse y FlxG.touches + overlapsPoint (botones en pantalla)
   · PlayStatePlaylist, Paths.videos, CharacterDataParser (lista e info de personajes del mod)
   ===================================================================== */
'use strict';

/* url de un video del mod YA (ModRes.get es asíncrono: la primera vez daba null) */
function modVideoUrl(r) { const f = ModRes.findUser('video', r.key, r.lib); if (f) return VFS.url(f); return ModRes.get('video', r.key, r.lib); }

/* ---------- señal (FlxSignal / lime Event) ---------- */
class HxSignal {
  constructor() { this.fns = []; this.__host = 'FlxSignal'; this.__open = true; }
  add(f) { if (typeof f === 'function' && !this.fns.some(x => x.f === f)) this.fns.push({ f, once: false }); }
  addOnce(f) { if (typeof f === 'function') this.fns.push({ f, once: true }); }
  remove(f) { this.fns = this.fns.filter(x => x.f !== f); }
  removeAll() { this.fns = []; }
  has(f) { return this.fns.some(x => x.f === f); }
  dispatch(...a) { const l = this.fns; this.fns = l.filter(x => !x.once); for (const x of l) Mods.safe(() => x.f(...a)); }
}

/* ---------- retener la canción mientras pasa una cinemática ---------- */
const Cutscene = {
  hold: null, t0: 0, endOk: false, videos: 0, gen: 0,
  start(kind) {
    if (this.hold) return;
    this.gen++;
    this.hold = kind; this.t0 = performance.now();
    if (Music.playing) Music.pause();
    G.songPos = Music.position();
    for (let i = 0; i < 4; i++) release(i);
  },
  release() {
    const k = this.hold; if (!k) return;
    this.hold = null;
    if (k === 'end') { this.endOk = true; try { openOverlay('end'); } finally { this.endOk = false; } return; }
    if (!G.paused && !G.overlayKind && G.songPos < songLength()) Music.play(G.songPos);
  },
  reset() { this.hold = null; this.endOk = false; this.videos = 0; },
  /* seguridad: si un script cancela la cuenta atrás o el final y no hay nada en marcha, se sigue solo */
  tick() {
    if (!this.hold || G.paused) return;
    // ocupado = video, timers o tweens de los scripts en marcha (intros hechas con FlxTimer/FlxTween); límite 90 s
    const busy = VideoSync.list.length || this.videos || ModRT.timers.some(t => t.active && t.loops !== 0) || (ModRT.tweenMgr && ModRT.tweenMgr._tweens.some(t => t.active !== false && !((+t.type || 8) & 6)));
    if (busy) this.tIdle = performance.now();
    const now = performance.now();
    if ((!busy && now - Math.max(this.t0, this.tIdle || 0) > 2500) || now - this.t0 > 90000) {
      if (typeof ScriptLog !== 'undefined') ScriptLog.info('hxc', `un script canceló ${this.hold === 'end' ? 'el final' : 'la cuenta atrás'} y no abrió ninguna cinemática: se sigue`);
      this.release();
    }
  },
};

/* ---------- entrada: teclado (FlxG.keys), ratón (FlxG.mouse) y toques (FlxG.touches) ---------- */
const FLX_KEY_ALIAS = { ZERO: '0', ONE: '1', TWO: '2', THREE: '3', FOUR: '4', FIVE: '5', SIX: '6', SEVEN: '7', EIGHT: '8', NINE: '9', CONTROL: 'CONTROL', ALT: 'ALT', SHIFT: 'SHIFT', ESCAPE: 'ESCAPE', BACKSPACE: 'BACKSPACE', ENTER: 'ENTER', SPACE: 'SPACE', TAB: 'TAB', PERIOD: '.', COMMA: ',', MINUS: '-', PLUS: '+', SLASH: '/', SEMICOLON: ';', QUOTE: "'", LBRACKET: '[', RBRACKET: ']', BACKSLASH: '\\', GRAVEACCENT: '`', NUMPADZERO: '0', NUMPADONE: '1', NUMPADTWO: '2', NUMPADTHREE: '3', NUMPADFOUR: '4', NUMPADFIVE: '5', NUMPADSIX: '6', NUMPADSEVEN: '7', NUMPADEIGHT: '8', NUMPADNINE: '9' };
const flxKey = k => { if (typeof k === 'number') return String.fromCharCode(k).toUpperCase(); k = String(k).toUpperCase(); return FLX_KEY_ALIAS[k] || k; };
const keyList = set => new Proxy({}, { get(_, k) { if (typeof k === 'symbol') return undefined; if (k === '__host') return 'FlxKeyList'; if (k === 'ANY') return set().size > 0; return set().has(flxKey(k)); }, has: () => true });
const FlxKeys = {
  __host: 'FlxKeyboard', __open: true, enabled: true,
  justPressed: keyList(() => KeyState.just), pressed: keyList(() => KeyState.down), justReleased: keyList(() => KeyState.rel), released: new Proxy({}, { get(_, k) { return typeof k === 'string' && !KeyState.down.has(flxKey(k)); } }),
  anyJustPressed: a => (a || []).some(k => KeyState.just.has(flxKey(k))), anyPressed: a => (a || []).some(k => KeyState.down.has(flxKey(k))),
  anyJustReleased: a => (a || []).some(k => KeyState.rel.has(flxKey(k))),
  checkStatus: (k, st) => { k = flxKey(k); return st === 2 || st === 'JUST_PRESSED' ? KeyState.just.has(k) : st === -1 || st === 'JUST_RELEASED' ? KeyState.rel.has(k) : KeyState.down.has(k); },
  firstJustPressed: () => { const v = [...KeyState.just][0]; return v || -1; }, firstPressed: () => { const v = [...KeyState.down][0]; return v || -1; },
  reset() {},
};
/* punteros: posición en la pantalla del juego (V.w × V.h) y en el mundo de cada cámara */
const Ptr = {
  list: new Map(), ended: [], mouse: { x: 0, y: 0, down: false, just: false, rel: false, wheel: 0 },
  toGame(e) { return { x: (e.clientX - V.ox) / V.s, y: (e.clientY - V.oy) / V.s }; },
  world(sx, sy, cam) {
    const w = cam && cam.__which === 'hud' ? 'hud' : 'game';
    if (w === 'hud') { const z = VS.play.camHUD.zoom || 1; return { x: (sx - V.w / 2) / z + V.w / 2, y: (sy - V.h / 2) / z + V.h / 2 }; }
    const c = VS.play.camera, z = c.zoom || 1;
    return { x: c.scroll.x + (sx - V.w / 2) / z + V.w / 2, y: c.scroll.y + (sy - V.h / 2) / z + V.h / 2 };
  },
  frame() { const m = this.mouse; m.just = m.rel = false; m.wheel = 0; for (const t of this.list.values()) t.just = false; this.ended.length = 0; },
};
const ptrObj = (src, isTouch) => ({
  __host: isTouch ? 'FlxTouch' : 'FlxMouse', __open: true,
  get x() { return Ptr.world(src().x, src().y, null).x; }, get y() { return Ptr.world(src().x, src().y, null).y; },
  get screenX() { return src().x; }, get screenY() { return src().y; }, get viewX() { return src().x; }, get viewY() { return src().y; },
  get justPressed() { return !!src().just; }, get pressed() { return !!src().down; }, get justReleased() { return !!src().rel; }, get released() { return !src().down; },
  get touchPointID() { return src().id ?? 0; }, get wheel() { return src().wheel || 0; }, visible: true, enabled: true,
  getScreenPosition(cam, pt) { const p = pt || vsPt(); return p.set(src().x, src().y); },
  getWorldPosition(cam, pt) { const w = Ptr.world(src().x, src().y, cam); const p = pt || vsPt(); return p.set(w.x, w.y); },
  getPosition(pt) { return this.getWorldPosition(null, pt); },
  overlaps(obj, cam) { return overlapsAt(obj, src().x, src().y, cam); },
  load() {}, unload() {}, useSystemCursor: true,
});
function objCam(o) { if (!o) return null; if (o.cameras && o.cameras[0]) return o.cameras[0]; if (o.camera && o.camera.__which) return o.camera; return o.__role ? HOST.camGame : null; }
function overlapsAt(obj, sx, sy, cam) {
  if (!obj) return false;
  if (obj.members && Array.isArray(obj.members)) return obj.members.some(m => overlapsAt(m, sx, sy, cam));
  const w = Ptr.world(sx, sy, cam || objCam(obj) || HOST.camGame);
  return pointIn(obj, w.x, w.y);
}
function pointIn(o, x, y) {
  const ox = +o.x || 0, oy = +o.y || 0, ww = +o.width || 0, hh = +o.height || 0;
  return x >= ox && x <= ox + ww && y >= oy && y <= oy + hh;
}
addEventListener('pointerdown', e => {
  const p = Ptr.toGame(e);
  if (e.pointerType === 'touch' || e.pointerType === 'pen') Ptr.list.set(e.pointerId, { id: e.pointerId, x: p.x, y: p.y, down: true, just: true, rel: false });
  const m = Ptr.mouse; m.x = p.x; m.y = p.y; m.down = true; m.just = true;   // el ratón también sigue al primer dedo (FlxG.mouse en móvil)
}, true);
addEventListener('pointermove', e => { const p = Ptr.toGame(e), t = Ptr.list.get(e.pointerId); if (t) { t.x = p.x; t.y = p.y; } const m = Ptr.mouse; if (e.pointerType === 'mouse' || t) { m.x = p.x; m.y = p.y; } }, true);
const ptrUp = e => { const t = Ptr.list.get(e.pointerId); if (t) { t.down = false; t.rel = true; Ptr.list.delete(e.pointerId); Ptr.ended.push(t); } const m = Ptr.mouse; if (m.down) { m.down = false; m.rel = true; } };
addEventListener('pointerup', ptrUp, true); addEventListener('pointercancel', ptrUp, true);
addEventListener('wheel', e => { Ptr.mouse.wheel = e.deltaY < 0 ? 1 : e.deltaY > 0 ? -1 : 0; }, { capture: true, passive: true });
const FlxMouse = ptrObj(() => Ptr.mouse, false);
const touchObjs = new Map();
const touchOf = t => { let o = touchObjs.get(t); if (!o) { o = ptrObj(() => t, true); touchObjs.set(t, o); } return o; };
const FlxTouches = {
  __host: 'FlxTouchManager', __open: true,
  get list() { return [...Ptr.list.values(), ...Ptr.ended].map(touchOf); },
  getFirst() { const t = [...Ptr.list.values()][0]; return t ? touchOf(t) : null; },
  getByID(id) { const t = Ptr.list.get(id); return t ? touchOf(t) : null; },
  justStarted(a) { return [...Ptr.list.values()].filter(t => t.just).map(touchOf); },
  justReleased(a) { return Ptr.ended.map(touchOf); },
};

/* ---------- videos: FunkinVideoSprite / FlxVideoSprite / FlxVideo (hxvlc) ---------- */
class HxVideoSprite extends HxSprite {
  constructor(x = 0, y = 0) {
    super(x, y);
    this.__video = true; this.it = null; this.url = null; this.key = ''; this.vol = 1; this.w0 = 1280; this.h0 = 720;
    const self = this;
    this.bitmap = {
      __host: 'FlxVideoBitmap', __open: true,
      onEndReached: new HxSignal(), onEncounteredError: new HxSignal(), onFormatSetup: new HxSignal(), onOpening: new HxSignal(), onPlaying: new HxSignal(), onStopped: new HxSignal(), onPaused: new HxSignal(),
      get bitmapData() { return { width: self.w0, height: self.h0, __host: 'BitmapData' }; },
      get volumeAdjust() { return self.vol; }, set volumeAdjust(v) { self.vol = +v; if (self.it) self.it.v.volume = Math.max(0, Math.min(1, +v || 0)); if (self.it) self.it.v.muted = !(+v > 0); },
      get volume() { return Math.round(self.vol * 100); }, set volume(v) { this.volumeAdjust = (+v || 0) / 100; },
      get mute() { return !!(self.it && self.it.v.muted); }, set mute(v) { if (self.it) self.it.v.muted = !!v; },
      get time() { return self.it ? self.it.v.currentTime * 1000 : 0; }, set time(v) { if (self.it) self.it.v.currentTime = (+v || 0) / 1000; },
      get length() { return self.it && isFinite(self.it.v.duration) ? self.it.v.duration * 1000 : 0; }, get duration() { return this.length; },
      get isPlaying() { return !!(self.it && !self.it.v.paused); }, get rate() { return self.it ? self.it.v.playbackRate : 1; }, set rate(v) { if (self.it) self.it.v.playbackRate = +v || 1; },
      get position() { return self.it && self.it.v.duration ? self.it.v.currentTime / self.it.v.duration : 0; },
      pause: () => self.pause(), resume: () => self.resume(), play: () => self.play(), stop: () => self.stop(),
    };
  }
  load(path, opts) {
    const r = ModRes.parsePath(String(path || '')); const url = modVideoUrl(r);
    this.key = r.key;
    if (!url) { HX.note(`video ${r.key}: falta el archivo`); if (typeof ScriptLog !== 'undefined') ScriptLog.info('asset', `video ${r.key}: falta el archivo`); setTimeout(() => this.bitmap.onEncounteredError.dispatch('no existe'), 0); return false; }
    this.url = url; return true;
  }
  play() {
    if (G.seekReplay || !this.url) return false;
    if (this.it) { this.it.userPaused = false; this.it.v.play().catch(() => {}); return true; }
    // a mitad de canción el video sigue a la canción; si la canción está retenida (cinemática) corre solo
    const free = !!Cutscene.hold || !Music.playing;
    this.it = VideoSync.play(this.url, this.key, G.songPos, { free, volume: this.vol, muted: !(this.vol > 0),
      onEnd: () => { this.it = null; this.bitmap.onEndReached.dispatch(); }, onError: () => this.bitmap.onEncounteredError.dispatch('error'),
      onMeta: v => { this.w0 = v.videoWidth || 1280; this.h0 = v.videoHeight || 720; this.bitmap.onFormatSetup.dispatch(); this.bitmap.onOpening.dispatch(); } });
    this.applyStyle(); this.bitmap.onPlaying.dispatch();
    return true;
  }
  applyStyle() { if (!this.it) return; const s = this.it.v.style; s.opacity = String(this.visible === false ? 0 : Math.max(0, Math.min(1, +this.alpha))); }
  pause() { if (this.it) { this.it.userPaused = true; this.it.v.pause(); this.bitmap.onPaused.dispatch(); } }
  resume() { if (this.it) { this.it.userPaused = false; this.it.v.play().catch(() => {}); } }
  stop() { if (this.it) { VideoSync.remove(this.it, true); this.it = null; this.bitmap.onStopped.dispatch(); } }
  hideVideo() { this.stop(); }
  destroy() { this.stop(); }
  kill() { this.stop(); this.alive = false; }
  tick() { super.tick && super.tick(); this.applyStyle(); }
  renderR() {}   // se ve como capa HTML (encima del juego)
}

/* ---------- funkin.util.SongSequence: callbacks a tiempos de la canción (ms = time·mult·1000 + startTime) ---------- */
class HxSongSequence {
  constructor(events, mult = 1, start = true) {
    this.__host = 'SongSequence'; this.__open = true; this._running = false; this.startTime = 0;
    mult = Math.max(0, +mult || 0);
    this.events = (events || []).map(e => ({ time: (+e.time || 0) * mult * 1000, callback: e.callback })).sort((a, b) => a.time - b.time);
    if (!this.events.length) return;
    this.running = !!start; SongSeq.list.push(this);
  }
  get running() { return this._running && !this.completed; }
  set running(v) { if (this.completed) return; v = !!v; if (v !== this._running) this.startTime = VS.play.conductor.songPosition - this.startTime; this._running = v; }
  get completed() { return this.events.length === 0; }
  onUpdate() {
    if (!this.running) return;
    const pos = VS.play.conductor.songPosition;
    while (this.events.length && this.events[0].time + this.startTime <= pos) { const e = this.events.shift(); if (typeof e.callback === 'function') Mods.safe(() => e.callback()); }
    if (this.completed) this.destroy();
  }
  destroy() { this.events.length = 0; const i = SongSeq.list.indexOf(this); if (i >= 0) SongSeq.list.splice(i, 1); }
}
const SongSeq = { list: [], tick() { if (G.paused || !this.list.length) return; for (const s of [...this.list]) s.onUpdate(); }, clear() { this.list.length = 0; } };

/* ---------- VideoCutscene (funkin.play.cutscene.VideoCutscene) ---------- */
const VideoCutsceneJS = {
  __host: 'VideoCutscene', __open: true, cur: null, type: 0,
  play(path, type = 'STARTING') {
    if (G.seekReplay) return;
    const T = String(type).toUpperCase(), kind = T === 'ENDING' || T === '2' ? 'end' : T === 'MIDSONG' || T === '1' ? 'mid' : (VS.play.startingSong ? 'countdown' : 'mid');
    const r = ModRes.parsePath(String(path || '')); const url = modVideoUrl(r);
    if (!Cutscene.hold) Cutscene.start(kind);
    if (!url) { HX.note(`VideoCutscene ${r.key}: falta el archivo`); if (typeof ScriptLog !== 'undefined') ScriptLog.info('asset', `video ${r.key}: falta el archivo (se salta la cinemática)`); this.finish(); return; }
    Cutscene.videos++;
    this.cur = VideoSync.play(url, r.key, G.songPos, { free: true, onEnd: () => { this.cur = null; Cutscene.videos = Math.max(0, Cutscene.videos - 1); this.finish(); } });
    HOST.ps.isInCutscene = true;
  },
  finish() { HOST.ps.isInCutscene = false; Cutscene.release(); },
  isPlaying() { return !!this.cur; },
  finishVideo(delay) { if (this.cur) VideoSync.remove(this.cur); else this.finish(); },
  pauseVideo() { if (this.cur) { this.cur.userPaused = true; this.cur.v.pause(); } }, resumeVideo() { if (this.cur) { this.cur.userPaused = false; this.cur.v.play().catch(() => {}); } },
  restartVideo() { if (this.cur) this.cur.v.currentTime = 0; },
};

/* ---------- personajes del mod (CharacterDataParser) ---------- */
function modCharIds() {
  const ids = new Set(['bf', 'dad', 'gf']);
  const rx = /(?:^|\/)data\/characters\/[^/]+\.json$/i;   // (las claves del VFS van en minúsculas: se usa el nombre real del archivo)
  if (typeof VFS !== 'undefined' && VFS.files) for (const [k, f] of VFS.files) if (rx.test(k)) ids.add(String(f.name || k.split('/').pop()).replace(/\.json$/i, ''));
  for (const r of ['bf', 'dad', 'gf']) if (Scene.chars[r]) ids.add(Scene.chars[r].id);
  return [...ids];
}
function modCharData(id) {
  const t = ModText.map.get(ModText.key(`data/characters/${id}.json`));
  if (t) { try { const d = JSON.parse(t); d.__open = true; d.id = id; return d; } catch (e) {} }
  const loaded = ['bf', 'dad', 'gf'].map(r => Scene.chars[r]).find(c => c && c.id === id);
  if (loaded && loaded.data) return Object.assign({ __open: true, id }, loaded.data);
  return modCharIds().includes(id) ? { __open: true, id, renderType: 'sparrow' } : null;
}

/* ---------- instalación en el host de los scripts ---------- */
(function install() {
  const G_ = HOST.G_, CT = HOST.CTORS, ps = HOST.ps;
  G_.FlxG.keys = FlxKeys; G_.FlxG.mouse = FlxMouse; G_.FlxG.touches = FlxTouches;
  G_.FlxKey = new Proxy({}, { get(_, k) { return typeof k === 'string' ? k : undefined; } });
  G_.HxSignal = HxSignal; G_.FlxSignal = { __host: 'FlxSignal' };
  G_.VideoCutscene = VideoCutsceneJS;
  G_.CountdownStep = { BEFORE: 'BEFORE', THREE: 'THREE', TWO: 'TWO', ONE: 'ONE', GO: 'GO', AFTER: 'AFTER' };
  G_.CutsceneType = { STARTING: 'STARTING', MIDSONG: 'MIDSONG', ENDING: 'ENDING' };
  G_.PlayStatePlaylist = { __host: 'PlayStatePlaylist', __open: true, isStoryMode: false, campaignId: null, campaignTitle: null, campaignDifficulty: 'normal', playlistSongIds: [], campaignScore: 0, reset() {} };
  G_.Paths.videos = (k, lib) => `assets/videos/videos/${k}.mp4`;
  Object.assign(G_.CharacterDataParser, {
    listCharacterIds: () => modCharIds(),
    fetchCharacterData: id => modCharData(String(id)), parseCharacterData: id => modCharData(String(id)),
    fetchCharacter: (id, debug) => { const c = ['bf', 'dad', 'gf'].find(r => Scene.chars[r] && Scene.chars[r].id === id); return ExtraChars.make(id); },
  });
  for (const n of ['FunkinVideoSprite', 'FlxVideoSprite', 'FlxVideo', 'VideoSprite']) CT[n] = a => new HxVideoSprite(...(a || []));
  CT.SongSequence = a => new HxSongSequence(a[0], a[1], a[2]);
  CT.FlxSignal = () => new HxSignal(); CT.FlxTypedSignal = () => new HxSignal(); CT.Event = () => new HxSignal();
  // PlayState.instance: cinemáticas y fin
  Object.defineProperty(ps, 'startCountdown', { value: () => { if (Cutscene.hold === 'countdown' || Cutscene.hold === 'mid') Cutscene.release(); }, configurable: true });
  Object.defineProperty(ps, 'endSong', { value: (ignoreCutscene) => { if (Cutscene.hold === 'end') Cutscene.release(); else { Cutscene.endOk = !!ignoreCutscene; try { openOverlay('end'); } finally { Cutscene.endOk = false; } } }, configurable: true });
  Object.defineProperty(ps, 'isInCutscene', { value: false, writable: true, configurable: true });
  // FlxSprite.overlapsPoint / FlxG.overlap sencillo (botones en pantalla de los mods)
  HxSprite.prototype.overlapsPoint = function (pt, inScreenSpace = false, cam = null) {
    if (!pt) return false;
    if (inScreenSpace) { const w = Ptr.world(pt.x, pt.y, cam || objCam(this) || HOST.camGame); return pointIn(this, w.x, w.y); }
    return pointIn(this, +pt.x || 0, +pt.y || 0);
  };
  HxSprite.prototype.overlaps = function (o) { if (!o) return false; const a = this, ax = +a.x, ay = +a.y, bx = +o.x, by = +o.y; return ax < bx + (+o.width || 0) && bx < ax + (+a.width || 0) && ay < by + (+o.height || 0) && by < ay + (+a.height || 0); };
  G_.FlxG.overlap = (a, b, cb) => { const la = a && a.members ? a.members : [a], lb = b && b.members ? b.members : [b]; let any = false; for (const x of la) for (const y of lb) if (x && y && x !== y && x.overlaps && x.overlaps(y)) { any = true; if (cb) Mods.safe(() => cb(x, y)); } return any; };
})();
