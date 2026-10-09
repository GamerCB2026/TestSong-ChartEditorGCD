/* =====================================================================
   audio.js — música (Inst + Voices) y efectos (cuenta regresiva, fallos,
   menú, música de pausa). Los efectos usan Web Audio (baja latencia).
   Los navegadores no dejan sonar nada hasta el primer toque/tecla: el
   contexto se "desbloquea" en el primer gesto del usuario.
   ===================================================================== */
'use strict';

/* ---------- Música de la canción ---------- */
const Music = {
  tracks: [], started: false, urls: [],
  set(blobs) { this.clear(); blobs.filter(Boolean).forEach(b => { const u = URL.createObjectURL(b); this.urls.push(u); const a = new Audio(u); a.preload = 'auto'; this.tracks.push(a); }); },
  clear() { this.tracks.forEach(a => a.pause()); this.urls.forEach(u => URL.revokeObjectURL(u)); this.tracks = []; this.urls = []; this.started = false; },
  get has() { return this.tracks.length > 0; },
  get playing() { return this.has && !this.tracks[0].paused && !this.tracks[0].ended; },
  get duration() { return this.has && isFinite(this.tracks[0].duration) ? this.tracks[0].duration * 1000 : 0; },
  time() { return this.tracks[0].currentTime * 1000; },
  play(ms) { this.started = true; this.tracks.forEach(a => { try { a.currentTime = Math.max(0, ms / 1000); } catch (e) {} a.play().catch(() => {}); }); },
  pause() { this.tracks.forEach(a => a.pause()); },
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
