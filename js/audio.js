/* =====================================================================
   audio.js — música (Inst + Voices) y efectos (cuenta regresiva, fallos,
   menú, música de pausa). Los efectos usan Web Audio (baja latencia).
   Los navegadores no dejan sonar nada hasta el primer toque/tecla: el
   contexto se "desbloquea" en el primer gesto del usuario.
   ===================================================================== */
'use strict';

/* ---------- Música de la canción + RELOJ MAESTRO ----------
   Antes: Inst/Voices eran <audio> sueltos y la posición de la canción avanzaba con el dt de cada
   frame, corrigiéndose solo si el audio se alejaba >45 ms. Al pausar/reanudar rápido, play() es
   asíncrono: un pause() que llega antes de que la promesa de play() se resuelva la aborta, la
   pista queda pausada pero "started" sigue en true, y el reloj de las notas sigue avanzando sin
   corrección (y cada pista arranca en un momento distinto) → todo se desincroniza.
   Ahora: Inst y Voices se decodifican (Web Audio) y se programan con AudioBufferSourceNode en el
   MISMO instante del AudioContext. La posición de la canción se calcula siempre a partir de ese
   reloj (posición = inicio + (ahora - t0)); pausar guarda la posición exacta y para las fuentes,
   reanudar crea fuentes nuevas en esa posición. Todo es síncrono (sin promesas), así que pulsar
   pausa muy rápido no puede desincronizar nada. Inst y Voices comparten reloj de muestra: deriva 0.
   Si el navegador no decodifica el audio, se usa <audio> con reloj de performance.now() y
   resincronización (>20 ms, como resyncVocals de V-Slice). */
const Music = {
  tracks: [], mode: 'none', playing: false, startPos: 0, t0: 0, clockCtx: false, lastPos: 0, token: 0, lastResync: 0,
  sourcesAlive: 0, resyncs: 0,
  get has() { return this.tracks.length > 0; },
  get started() { return this.playing; },
  get duration() { return this.tracks.reduce((m, t) => Math.max(m, t.dur || 0), 0); },
  /* list: [{ blob | buffer, role: 'inst'|'player'|'opponent'|'voices', name }] */
  async set(list) {
    this.clear();
    list = (list || []).filter(x => x && (x.blob || x.buffer));
    if (!list.length) return;
    const c = Sfx.ensureCtx();
    const decoded = await Promise.all(list.map(async x => {
      try {
        const ab = x.buffer || await x.blob.arrayBuffer();
        if (!c) throw new Error('sin Web Audio');
        return await new Promise((ok, bad) => { const p = c.decodeAudioData(ab.slice(0), ok, bad); if (p && p.then) p.then(ok, bad); });
      } catch (e) { console.warn('[audio] no se pudo decodificar', x.name || x.role, e); return null; }
    }));
    if (decoded.every(Boolean)) {
      this.mode = 'webaudio';
      this.tracks = list.map((x, i) => { const g = c.createGain(); g.connect(c.destination); return { role: x.role || 'voices', name: x.name, buffer: decoded[i], gain: g, src: null, dur: decoded[i].duration * 1000 }; });
    } else {
      this.mode = 'element';
      this.tracks = await Promise.all(list.map(x => new Promise(res => {
        const url = URL.createObjectURL(x.blob || new Blob([x.buffer])); const el = new Audio(url); el.preload = 'auto';
        const t = { role: x.role || 'voices', name: x.name, el, url, dur: 0 };
        const done = () => { t.dur = isFinite(el.duration) ? el.duration * 1000 : 0; res(t); };
        el.addEventListener('loadedmetadata', done, { once: true }); el.addEventListener('error', done, { once: true }); setTimeout(done, 4000);
      })));
    }
  },
  clear() {
    this.stopSources();
    for (const t of this.tracks) { if (t.el) { t.el.pause(); URL.revokeObjectURL(t.url); } if (t.gain) t.gain.disconnect(); }
    this.tracks = []; this.mode = 'none'; this.playing = false; this.startPos = this.lastPos = 0;
  },
  ctxNow() { return Sfx.ctx.currentTime * 1000; },
  now() {
    if (!this.clockCtx) return performance.now();
    // currentTime avanza por bloques (~3-10 ms): se estima el instante real con el desfase mínimo
    // observado entre performance.now() y currentTime (sigue la deriva lentamente; se reinicia si el contexto se detuvo)
    const c = this.ctxNow(), p = performance.now(), off = p - c;
    if (this._off === undefined || off < this._off || off > this._off + 50) this._off = off; else this._off += 0.01;
    return clamp(p - this._off, c, c + 40);
  },
  /* posición de la canción (ms) = reloj maestro */
  position() {
    if (!this.playing) return this.startPos;
    let p = this.startPos + (this.now() - this.t0);
    // modo <audio>: una vez que la Inst suena, ella es el reloj (como Conductor con FlxG.sound.music.time)
    const m = this.mode === 'element' && this.tracks[0] && this.tracks[0].el;
    if (m && !m.paused && !m.ended && p >= 0 && m.currentTime > 0) {
      const ct = m.currentTime * 1000, now = performance.now(), off = now - ct;
      if (this._eoff === undefined || off < this._eoff || off > this._eoff + 80) this._eoff = off; else this._eoff += 0.01;
      p = clamp(now - this._eoff, ct, ct + 60);
    }
    if (p > this.lastPos) this.lastPos = p;      // monotónica
    return this.lastPos;
  },
  /* posición real del audio que suena (para la prueba de sincronía) */
  audioPos() {
    const t = this.tracks[0]; if (!t) return null;
    if (t.el) return t.el.paused ? null : t.el.currentTime * 1000;
    if (!t.src || !this.clockCtx) return null;
    const el = this.ctxNow() - t.when * 1000; if (el < 0) return null;
    return t.offset * 1000 + el;
  },
  stopSources() {
    for (const t of this.tracks) {
      if (t.src) { try { t.src.onended = null; t.src.stop(); } catch (e) {} try { t.src.disconnect(); } catch (e) {} t.src = null; this.sourcesAlive--; }
      if (t.el && !t.el.paused) t.el.pause();
    }
  },
  play(pos) {
    this.stopSources(); this.token++; this._eoff = undefined;
    const c = Sfx.ctx;
    this.clockCtx = this.mode === 'webaudio' && !!c && c.state === 'running';
    this.startPos = this.lastPos = pos; this.t0 = this.clockCtx ? this.ctxNow() : performance.now(); this.playing = true;
    if (this.clockCtx) {
      const delay = Math.max(0, -pos) / 1000, offset = Math.max(0, pos) / 1000, when = c.currentTime + delay;
      for (const t of this.tracks) {
        if (offset >= t.buffer.duration) continue;
        const src = c.createBufferSource(); src.buffer = t.buffer; src.connect(t.gain);
        src.start(when, offset); t.src = src; t.when = when; t.offset = offset; this.sourcesAlive++;
        src.onended = () => { if (t.src === src) { t.src = null; this.sourcesAlive--; } };
      }
    } else if (this.mode === 'element' && pos >= 0) this.startElements(pos);
  },
  startElements(pos) {
    const tok = this.token;
    for (const t of this.tracks) {
      if (pos >= t.dur && t.dur) continue;
      try { t.el.currentTime = pos / 1000; } catch (e) {}
      const p = t.el.play();
      if (p && p.then) p.then(() => { if (tok !== this.token || !this.playing) t.el.pause(); }).catch(() => {});
    }
  },
  pause() {
    if (this.playing) { this.startPos = this.position(); this.playing = false; }
    this.token++; this.stopSources();
  },
  seek(pos) { if (this.playing) this.play(pos); else { this.startPos = this.lastPos = pos; } },
  /* cada frame: cambia al reloj del AudioContext cuando se desbloquea; en modo <audio>, resincroniza */
  tick() {
    if (!this.playing || !this.has) return;
    const c = Sfx.ctx;
    if (this.mode === 'webaudio' && !this.clockCtx && c && c.state === 'running') { this.play(this.position()); return; }
    if (this.mode === 'element') {
      const pos = this.position(), now = performance.now();
      if (pos < 0) return;
      if (this.tracks.some(t => t.el.paused && !t.el.ended && pos < t.dur - 50)) { if (now - this.lastResync > 300) { this.lastResync = now; this.startElements(pos); } return; }
      if (now - this.lastResync < 500) return;
      // resyncVocals de V-Slice: las voces se alinean a la Inst si se alejan más de 20 ms
      const inst = this.tracks[0].el.currentTime * 1000;
      for (const t of this.tracks.slice(1)) if (!t.el.paused && Math.abs(t.el.currentTime * 1000 - inst) > 20) { t.el.currentTime = inst / 1000; this.resyncs++; this.lastResync = now; }
    }
  },
  /* V-Slice: la voz del jugador se silencia al fallar y vuelve al acertar */
  setVolume(role, v) { this.vol = this.vol || {}; this.vol[role] = v; for (const t of this.tracks) if (t.role === role) { if (t.gain) t.gain.gain.value = v; if (t.el) t.el.volume = v; } },
  getVolume(role) { return this.vol && role in this.vol ? this.vol[role] : 1; },
};

/* ---------- Efectos ---------- */
const Sfx = {
  ctx: null, buffers: {}, found: {}, missing: {}, unlocked: false,
  ensureCtx() {
    if (!this.ctx) { const AC = window.AudioContext || window.webkitAudioContext; if (AC) this.ctx = new AC(); }
    return this.ctx;
  },
  unlock() {
    const c = this.ensureCtx(); if (!c) return;
    if (c.state === 'suspended') c.resume().catch(() => {});
    this.unlocked = true;
  },
  /* Carga el primer archivo que exista de la lista de rutas base (sin extensión) */
  async load(key, bases) {
    const list = []; for (const b of bases) list.push(b + '.ogg', b + '.mp3');
    const r = await fetchFirst(list, 'buffer');
    if (!r) { this.missing[key] = bases[0] + '.ogg'; return null; }
    this.found[key] = r.path;
    const c = this.ensureCtx();
    if (!c) return null;
    try {
      const buf = await new Promise((ok, bad) => { const p = c.decodeAudioData(r.data.slice(0), ok, bad); if (p && p.then) p.then(ok, bad); });
      this.buffers[key] = buf; return buf;
    } catch (e) { console.warn('No se pudo decodificar', r.path, e); this.missing[key] = r.path + ' (formato no soportado)'; return null; }
  },
  has(key) { return !!this.buffers[key]; },
  play(key, volume = 1) {
    const c = this.ctx, b = this.buffers[key];
    if (!c || !b || c.state !== 'running') return null;
    const src = c.createBufferSource(), g = c.createGain();
    g.gain.value = volume; src.buffer = b; src.connect(g).connect(c.destination); src.start();
    return src;
  },
  /* música en bucle (pausa) con fundido de entrada como en PauseSubState */
  loopSrc: null, loopGain: null,
  playLoop(key, target = 0.5, fadeSec = 8) {
    this.stopLoop();
    const c = this.ctx, b = this.buffers[key];
    if (!c || !b || c.state !== 'running') return;
    const src = c.createBufferSource(), g = c.createGain();
    src.buffer = b; src.loop = true; g.gain.setValueAtTime(0, c.currentTime); g.gain.linearRampToValueAtTime(target, c.currentTime + fadeSec);
    src.connect(g).connect(c.destination);
    src.start(0, Math.random() * Math.max(0, b.duration / 2));   // el juego empieza en un punto aleatorio
    this.loopSrc = src; this.loopGain = g;
  },
  stopLoop() { if (this.loopSrc) { try { this.loopSrc.stop(); } catch (e) {} this.loopSrc = null; } },
};

async function loadSounds() {
  const tasks = [];
  ASSET_CFG.countdownSounds.forEach((n, i) => tasks.push(Sfx.load('count' + i, ASSET_CFG.countdownSoundDirs.map(d => d + n))));
  for (let n = 1; n <= 3; n++) tasks.push(Sfx.load('miss' + n, ASSET_CFG.missSounds.map(t => fillT(t, { n }))));
  for (const [k, list] of Object.entries(ASSET_CFG.menuSounds)) tasks.push(Sfx.load(k + 'Menu', list));
  tasks.push(Sfx.load('pauseMusic', ASSET_CFG.pauseMusic));
  await Promise.all(tasks);
}
function playMissSound(lo = 0.5, hi = 0.6) {
  const opts = [1, 2, 3].filter(n => Sfx.has('miss' + n));
  if (opts.length) Sfx.play('miss' + opts[randInt(0, opts.length - 1)], rand(lo, hi));
}

['pointerdown', 'keydown', 'touchstart'].forEach(ev => window.addEventListener(ev, () => Sfx.unlock(), { capture: true, passive: true }));
