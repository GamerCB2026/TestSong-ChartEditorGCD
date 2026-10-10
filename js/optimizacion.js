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
  preset: 'alta',        // alta | media | baja | potato | personalizado
  tex: 100,              // Texturas (personajes y escenario): 100 | 75 | 50 | 25 %
  res: 100,              // Resolución del mundo (escenario + personajes): 100 | 75 | 50 %
  stage: 'completo',     // completo | simple (solo el fondo) | oculto
  gf: true,              // GF visible
  anim: 'normal',        // normal | reducida (12 fps) | estatica
  bop: true,             // zoom/bop de cámara con el ritmo
  splashes: true,        // note splashes
  aa: true,              // antialiasing (suavizado de imágenes)
  fps: 0,                // límite de FPS: 30 | 60 | 120 | 0 = sin límite (lo que dé la pantalla)
  contador: false,       // contador de FPS
  consola: false,        // v3.7.0: consola de scripts (errores y debugPrint de .lua / .hx / .hxc)
  renderer: 'auto',      // auto | webgl | canvas
  auto: true,            // modo bajo rendimiento automático
  tirones: true,         // protección contra tirones (las notas que pasaron durante un tirón no cuentan como fallo)
  shaders: true,         // v3.4.0: shaders cargados (post-proceso WebGL)
};
const OPTIM_PRESETS = {
  alta:  { tex: 100, res: 100, stage: 'completo', gf: true,  anim: 'normal',   bop: true,  splashes: true,  aa: true,  fps: 0,  shaders: true },
  media: { tex: 75,  res: 100, stage: 'simple',   gf: true,  anim: 'normal',   bop: true,  splashes: true,  aa: true,  fps: 60, shaders: true },
  baja:  { tex: 50,  res: 75,  stage: 'simple',   gf: false, anim: 'reducida', bop: false, splashes: false, aa: false, fps: 60, shaders: false },
  // v3.8.0: Modo Potato (PCs muy débiles): texturas mínimas, sin escenario ni GF, animaciones estáticas, sin shaders ni splashes, 30 FPS
  potato: { tex: 25, res: 50,  stage: 'oculto',   gf: false, anim: 'estatica', bop: false, splashes: false, aa: false, fps: 30, shaders: false },
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
    if (params.has('consola')) this.s.consola = params.get('consola') !== '0';   // v3.7.0
    if (params.has('auto')) this.s.auto = params.get('auto') !== '0';
    if (params.has('texres')) this.s.tex = [100, 75, 50, 25].includes(+params.get('texres')) ? +params.get('texres') : 100;
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
  cap: 0, lastDraw: 0, el: null, fps: 0, avgMs: 0, worstMs: 0, shownAt: 0, lastLabel: '',
  // v3.8.0: anillo fijo (sin push/shift/slice por frame): duración y momento de cada frame
  ringDt: new Float32Array(256), ringAt: new Float64Array(256), ringN: 0, ringI: 0,
  slowSince: 0, autoStep: 0, hitches: 0, lastHitch: 0, lastPlayPos: null, audioStall: 0, lastCtxT: -1, lastCtxAt: 0,
  get frames() { const o = []; for (let k = Math.min(this.ringN, 256); k > 0; k--) o.push(this.ringDt[(this.ringI - k + 256) & 255]); return o; },   // compatibilidad (solo lectura)
  setCap(f) { this.cap = f > 0 ? f : 0; },
  /* límite de FPS con requestAnimationFrame: se dibuja cuando pasó el intervalo (tolerancia de 1/4 de frame) */
  shouldDraw(now) {
    if (!this.cap) return true;
    const iv = 1000 / this.cap;
    if (now - this.lastDraw < iv - Math.min(4, iv * 0.25)) return false;
    this.lastDraw = Math.max(this.lastDraw + iv, now - iv); return true;
  },
  resetWindow() { this.ringN = 0; this.slowSince = 0; },
  sample(dt, now) {
    const i = this.ringI; this.ringDt[i] = dt; this.ringAt[i] = now; this.ringI = (i + 1) & 255; this.ringN++;
    if (now - this.shownAt < 250) return;   // v3.8.0: estadística cada 250 ms sobre el último segundo
    this.shownAt = now;
    let sum = 0, worst = 0, n = 0;
    for (let k = 1, lim = Math.min(this.ringN, 256); k <= lim; k++) {
      const j = (this.ringI - k + 256) & 255; if (now - this.ringAt[j] > 1000) break;
      const d = this.ringDt[j]; sum += d; n++; if (d > worst) worst = d;
    }
    this.avgMs = n ? sum / n : 0; this.fps = this.avgMs > 0 ? 1000 / this.avgMs : 0; this.worstMs = worst; this.winN = n; this.winSpan = n ? now - this.ringAt[(this.ringI - n + 256) & 255] : 0;
    if (this.el && !this.el.hidden) {
      const t = `FPS ${Math.round(this.fps)}${this.cap ? '/' + this.cap : ''} · ${this.avgMs.toFixed(1)} ms · peor ${Math.round(this.worstMs)} ms · ${Render.last === 'webgl' ? 'WebGL' : Render.last === 'canvas-bajo' ? 'Canvas ' + Optim.s.res + '%' : 'Canvas'}${Optim.s.preset !== 'alta' ? ' · ' + Optim.s.preset : ''}`;
      if (t !== this.lastLabel) { this.lastLabel = t; this.el.textContent = t; }
    }
    this.autoCheck(now);
  },
  showCounter(on) {
    if (!this.el) { this.el = document.getElementById('fpsBox'); }
    if (this.el) this.el.hidden = !on;
  },
  /* modo bajo rendimiento (v3.8.0, más rápido): ventana de 1 s medida cada 250 ms.
     · por debajo de ~67 % del objetivo durante 1,5 s → baja un paso (Alta → Media → Baja → Potato), pasos cada 3 s
     · por debajo de 20 FPS durante 1 s → salta directo a Potato
     Sin recargar: se mantiene la resolución de "Texturas" (cambiarla recarga con pantalla de carga). */
  autoCheck(now) {
    if (!Optim.s.auto || G.paused || Loader.active || !G.chart) { this.slowSince = 0; this.ringN = 0; return; }
    if (this.winSpan < 900 || this.winN < 8) return;   // necesita ~1 s de frames jugando
    const target = this.cap ? Math.min(this.cap, 60) : 60;
    const order = ['alta', 'media', 'baja', 'potato'], cur = Optim.s.preset === 'personalizado' ? 'alta' : Optim.s.preset, i = order.indexOf(cur);
    const potatoTarget = cur === 'potato' ? Math.min(target, 30) : target;
    if (this.fps < potatoTarget * 0.67) {
      if (!this.slowSince) this.slowSince = now;
      const slowFor = now - this.slowSince, critical = this.fps < 20;
      if ((critical ? slowFor >= 1000 : slowFor >= 1500) && now - this.autoStep >= 3000) {
        this.slowSince = 0; this.autoStep = now;
        if (i >= 0 && i < order.length - 1) {
          const next = critical && i < 2 ? 'potato' : order[i + 1], keepTex = Optim.s.tex;
          Object.assign(Optim.s, OPTIM_PRESETS[next], { preset: next, tex: keepTex });
          Optim.touch();
          this.ringN = 0;   // nueva ventana con la calidad nueva
          toast(`Modo bajo rendimiento: calidad ${({ media: 'Media', baja: 'Baja', potato: 'Potato' })[next]} (${Math.round(this.fps)} FPS). Cámbialo en Opciones → Optimización`, 4500);
        } else if (Optim.s.res > 50) { Optim.s.res = Optim.s.res > 75 ? 75 : 50; Optim.touch(); this.ringN = 0; toast(`Modo bajo rendimiento: resolución del mundo ${Optim.s.res}%`, 3500); }
      }
    } else this.slowSince = 0;
  },
  /* tirón (frame de más de 250 ms jugando): las notas que pasaron mientras la pantalla estaba congelada
     no cuentan como fallo (no se pudieron ver). El audio sigue siendo el reloj: todo queda sincronizado. */
  hitch(gap, fromPos, toPos) {
    this.hitches++; this.lastHitch = gap;
    if (!Optim.s.tirones || isBot() || !G.chart) return 0;
    let n = 0;
    for (let i = 0; i < G.chart.notes.length; i++) {
      const nt = G.chart.notes[i]; if (nt.time > toPos - FNF.HIT_WINDOW_MS) break;
      if (!nt.judged && !nt.hasBeenHit && !nt.hasMissed && nt.side === 'player' && nt.time >= fromPos - FNF.HIT_WINDOW_MS) { VS.play.skipNote(nt); n++; }
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
