/* =====================================================================
   optimizacion.js — menú "Optimización" (Opciones y Pausa) — v3.3.0
   Ajustes guardados en localStorage; casi todos se aplican al momento.
   "Texturas" recarga personajes y escenario (pantalla de carga) porque las
   imágenes se vuelven a decodificar a otra resolución.
   También: medidor de FPS, contador en pantalla, límite de FPS, modo bajo
   rendimiento automático, protección contra tirones y vigilante del audio.
   ===================================================================== */
'use strict';

const OPTIM_KEY = 'testsong-gcd-optimizacion';
const OPTIM_DEF = {
  preset: 'alta',        // alta | media | baja | personalizado
  tex: 100,              // Texturas (personajes y escenario): 100 | 75 | 50 %
  res: 100,              // Resolución del mundo (escenario + personajes): 100 | 75 | 50 %
  stage: 'completo',     // completo | simple (solo el fondo) | oculto
  gf: true,              // GF visible
  anim: 'normal',        // normal | reducida (12 fps) | estatica
  bop: true,             // zoom/bop de cámara con el ritmo
  splashes: true,        // note splashes
  aa: true,              // antialiasing (suavizado de imágenes)
  fps: 0,                // límite de FPS: 30 | 60 | 120 | 0 = sin límite (lo que dé la pantalla)
  contador: false,       // contador de FPS
  renderer: 'auto',      // auto | webgl | canvas
  auto: true,            // modo bajo rendimiento automático
  tirones: true,         // protección contra tirones (las notas que pasaron durante un tirón no cuentan como fallo)
  shaders: true,         // v3.4.0: shaders cargados (post-proceso WebGL)
};
const OPTIM_PRESETS = {
  alta:  { tex: 100, res: 100, stage: 'completo', gf: true,  anim: 'normal',   bop: true,  splashes: true,  aa: true,  fps: 0,  shaders: true },
  media: { tex: 75,  res: 100, stage: 'simple',   gf: true,  anim: 'normal',   bop: true,  splashes: true,  aa: true,  fps: 60, shaders: true },
  baja:  { tex: 50,  res: 75,  stage: 'simple',   gf: false, anim: 'reducida', bop: false, splashes: false, aa: false, fps: 60, shaders: false },
};
const PRESET_KEYS = Object.keys(OPTIM_PRESETS.alta);

const Optim = {
  s: Object.assign({}, OPTIM_DEF),
  load() {
    try {
      const d = JSON.parse(localStorage.getItem(OPTIM_KEY) || '{}');
      for (const k of Object.keys(OPTIM_DEF)) if (d[k] !== undefined && typeof d[k] === typeof OPTIM_DEF[k]) this.s[k] = d[k];
    } catch (e) {}
    // URL (no se guarda): ?calidad=baja · ?render=webgl|canvas · ?fps=30 · ?contador=1 · ?tex=… (formato, ver texturas.js)
    const q = params.get('calidad'); if (q && OPTIM_PRESETS[q]) Object.assign(this.s, OPTIM_PRESETS[q], { preset: q });
    if (['auto', 'webgl', 'canvas'].includes(params.get('render'))) this.s.renderer = params.get('render');
    if (params.has('fps')) this.s.fps = +params.get('fps') || 0;
    if (params.has('contador')) this.s.contador = params.get('contador') !== '0';
    if (params.has('auto')) this.s.auto = params.get('auto') !== '0';
    if (params.has('texres')) this.s.tex = [100, 75, 50].includes(+params.get('texres')) ? +params.get('texres') : 100;
  },
  save() { try { localStorage.setItem(OPTIM_KEY, JSON.stringify(this.s)); } catch (e) {} },
  texScale() { return (this.s.tex || 100) / 100; },
  worldScale() { return (this.s.res || 100) / 100; },
  /* aplica un preset (Alta/Media/Baja). Devuelve true si cambió la resolución de texturas (hay que recargar) */
  setPreset(p) {
    const old = this.s.tex;
    if (OPTIM_PRESETS[p]) Object.assign(this.s, OPTIM_PRESETS[p]);
    this.s.preset = p; this.save(); this.applyLive();
    return this.s.tex !== old;
  },
  /* tras cambiar un ajuste suelto: si ya no coincide con ningún preset → Personalizado */
  touch() {
    const m = Object.keys(OPTIM_PRESETS).find(p => PRESET_KEYS.every(k => OPTIM_PRESETS[p][k] === this.s[k]));
    this.s.preset = m || 'personalizado'; this.save(); this.applyLive();
  },
  applyLive() {
    Perf.setCap(this.s.fps);
    Perf.showCounter(this.s.contador);
    if (typeof Stage_applyMode === 'function') Stage_applyMode();
    if (typeof resize === 'function' && typeof cv !== 'undefined') resize();
  },
};
Optim.load();

/* ---------- medidor de FPS / límite / tirones / vigilante del audio ---------- */
const Perf = {
  cap: 0, lastDraw: 0, el: null, frames: [], fps: 0, avgMs: 0, worstMs: 0, shownAt: 0,
  slowSince: 0, autoStep: 0, hitches: 0, lastHitch: 0, lastPlayPos: null, audioStall: 0, lastCtxT: -1, lastCtxAt: 0,
  setCap(f) { this.cap = f > 0 ? f : 0; },
  /* límite de FPS con requestAnimationFrame: se dibuja cuando pasó el intervalo (tolerancia de 1/4 de frame) */
  shouldDraw(now) {
    if (!this.cap) return true;
    const iv = 1000 / this.cap;
    if (now - this.lastDraw < iv - Math.min(4, iv * 0.25)) return false;
    this.lastDraw = Math.max(this.lastDraw + iv, now - iv); return true;
  },
  sample(dt, now) {
    const f = this.frames; f.push(dt); if (f.length > 240) f.shift();
    if (now - this.shownAt > 500) {
      this.shownAt = now;
      const last = f.slice(-60), sum = last.reduce((a, b) => a + b, 0);
      this.avgMs = sum / Math.max(1, last.length); this.fps = this.avgMs > 0 ? 1000 / this.avgMs : 0; this.worstMs = Math.max(0, ...last);
      if (this.el && !this.el.hidden) this.el.textContent = `FPS ${Math.round(this.fps)}${this.cap ? '/' + this.cap : ''} · ${this.avgMs.toFixed(1)} ms · peor ${Math.round(this.worstMs)} ms · ${Render.last === 'webgl' ? 'WebGL' : Render.last === 'canvas-bajo' ? 'Canvas ' + Optim.s.res + '%' : 'Canvas'}${Optim.s.preset !== 'alta' ? ' · ' + Optim.s.preset : ''}`;
      this.autoCheck(now);
    }
  },
  showCounter(on) {
    if (!this.el) { this.el = document.getElementById('fpsBox'); }
    if (this.el) this.el.hidden = !on;
  },
  /* modo bajo rendimiento: si jugando se queda por debajo de ~40 FPS durante 4 s, baja la calidad un paso
     (solo ajustes que no necesitan recargar: Alta → Media → Baja, sin cambiar "Texturas") */
  autoCheck(now) {
    if (!Optim.s.auto || G.paused || Loader.active || !G.chart) { this.slowSince = 0; return; }
    const target = this.cap ? Math.min(this.cap, 60) : 60;
    if (this.fps < target * 0.67 && this.frames.length >= 60) {
      if (!this.slowSince) this.slowSince = now;
      else if (now - this.slowSince > 4000 && now - this.autoStep > 8000) {
        this.slowSince = 0; this.autoStep = now;
        const order = ['alta', 'media', 'baja'], cur = Optim.s.preset === 'personalizado' ? 'alta' : Optim.s.preset, i = order.indexOf(cur);
        if (i >= 0 && i < order.length - 1) {
          const next = order[i + 1], keepTex = Optim.s.tex;
          Object.assign(Optim.s, OPTIM_PRESETS[next], { preset: next, tex: keepTex });
          Optim.touch();
          toast(`Modo bajo rendimiento: calidad ${next === 'media' ? 'Media' : 'Baja'} (${Math.round(this.fps)} FPS). Cámbialo en Opciones → Optimización`, 4500);
        } else if (Optim.s.res > 50) { Optim.s.res = Optim.s.res > 75 ? 75 : 50; Optim.touch(); toast(`Modo bajo rendimiento: resolución del mundo ${Optim.s.res}%`, 3500); }
      }
    } else this.slowSince = 0;
  },
  /* tirón (frame de más de 250 ms jugando): las notas que pasaron mientras la pantalla estaba congelada
     no cuentan como fallo (no se pudieron ver). El audio sigue siendo el reloj: todo queda sincronizado. */
  hitch(gap, fromPos, toPos) {
    this.hitches++; this.lastHitch = gap;
    if (!Optim.s.tirones || isBot() || !G.chart) return 0;
    let n = 0;
    for (let i = G.noteIdx || 0; i < G.chart.notes.length; i++) {
      const nt = G.chart.notes[i]; if (nt.time > toPos - FNF.HIT_WINDOW_MS) break;
      if (!nt.judged && nt.side === 'player' && nt.time >= fromPos - FNF.HIT_WINDOW_MS) { nt.judged = nt.skipped = true; n++; }
    }
    if (n) console.info(`[TestSong] tirón de ${Math.round(gap)} ms: ${n} nota(s) sin contar como fallo`);
    return n;
  },
  /* audio detenido (AudioContext suspendido o reloj congelado): la canción no puede quedar "pegada" */
  watchAudio(now) {
    if (G.paused || !Music.playing || Music.mode !== 'webaudio' || !Sfx.ctx || !Music.clockCtx) { this.audioStall = 0; this.lastCtxT = -1; return; }
    const c = Sfx.ctx, t = c.currentTime;
    if (c.state === 'running' && t !== this.lastCtxT) { this.lastCtxT = t; this.lastCtxAt = now; this.audioStall = 0; return; }
    if (this.lastCtxT < 0) { this.lastCtxT = t; this.lastCtxAt = now; return; }
    if (now - this.lastCtxAt > 600) {
      if (c.state !== 'running') c.resume().catch(() => {});
      if (now - this.lastCtxAt > 1500 && !this.audioStall) {
        this.audioStall = now;
        openOverlay('pause');
        toast('El audio del navegador se detuvo: la canción quedó en pausa. Pulsa Reanudar.', 5000);
      }
    }
  },
};
