/* =====================================================================
   eventos.js — eventos de canción de V-Slice (chart "events": [{t, e, v}]):
   FocusCamera, ZoomCamera, SetCameraBop, PlayAnimation, SetHealthIcon,
   ScrollSpeed. Curvas FlxEase completas (linear, sineInOut, expoOut…).
   Los eventos de la canción "test"/legacy salen de mustHitSection (charts.js).
   ===================================================================== */
'use strict';

/* ---------- FlxEase (flixel/tweens/FlxEase.hx) ---------- */
const Ease = (() => {
  const PI2 = Math.PI / 2, EL = 2 * Math.PI / 0.45, B1 = 1 / 2.75, B2 = 2 / 2.75, B3 = 1.5 / 2.75, B4 = 2.5 / 2.75, B5 = 2.25 / 2.75, B6 = 2.625 / 2.75;
  const ssIO = t => t * t * (t * -2 + 3), sssIO = t => t * t * t * (t * (t * 6 - 15) + 10);
  const bounceOut = t => t < B1 ? 7.5625 * t * t : t < B2 ? 7.5625 * (t - B3) * (t - B3) + .75 : t < B4 ? 7.5625 * (t - B5) * (t - B5) + .9375 : 7.5625 * (t - B6) * (t - B6) + .984375;
  const E = {
    linear: t => t,
    quadIn: t => t * t, quadOut: t => -t * (t - 2), quadInOut: t => t <= .5 ? t * t * 2 : 1 - (--t) * t * 2,
    cubeIn: t => t * t * t, cubeOut: t => 1 + (--t) * t * t, cubeInOut: t => t <= .5 ? t * t * t * 4 : 1 + (--t) * t * t * 4,
    quartIn: t => t * t * t * t, quartOut: t => 1 - (t -= 1) * t * t * t, quartInOut: t => t <= .5 ? t * t * t * t * 8 : (1 - (t = t * 2 - 2) * t * t * t) / 2 + .5,
    quintIn: t => t * t * t * t * t, quintOut: t => (t = t - 1) * t * t * t * t + 1, quintInOut: t => ((t *= 2) < 1) ? (t * t * t * t * t) / 2 : ((t -= 2) * t * t * t * t + 2) / 2,
    smoothStepIn: t => 2 * ssIO(t / 2), smoothStepOut: t => 2 * ssIO(t / 2 + .5) - 1, smoothStepInOut: ssIO,
    smootherStepIn: t => 2 * sssIO(t / 2), smootherStepOut: t => 2 * sssIO(t / 2 + .5) - 1, smootherStepInOut: sssIO,
    sineIn: t => -Math.cos(PI2 * t) + 1, sineOut: t => Math.sin(PI2 * t), sineInOut: t => -Math.cos(Math.PI * t) / 2 + .5,
    bounceIn: t => 1 - bounceOut(1 - t), bounceOut, bounceInOut: t => t < .5 ? (1 - bounceOut(1 - 2 * t)) / 2 : (1 + bounceOut(2 * t - 1)) / 2,
    circIn: t => -(Math.sqrt(1 - t * t) - 1), circOut: t => Math.sqrt(1 - (t - 1) * (t - 1)),
    circInOut: t => t <= .5 ? (Math.sqrt(1 - t * t * 4) - 1) / -2 : (Math.sqrt(1 - (t * 2 - 2) * (t * 2 - 2)) + 1) / 2,
    expoIn: t => Math.pow(2, 10 * (t - 1)), expoOut: t => -Math.pow(2, -10 * t) + 1,
    expoInOut: t => t < .5 ? Math.pow(2, 10 * (t * 2 - 1)) / 2 : (-Math.pow(2, -10 * (t * 2 - 1)) + 2) / 2,
    backIn: t => t * t * (2.70158 * t - 1.70158), backOut: t => 1 - (--t) * t * (-2.70158 * t - 1.70158),
    backInOut: t => { t *= 2; if (t < 1) return t * t * (2.70158 * t - 1.70158) / 2; t--; return (1 - (--t) * t * (-2.70158 * t - 1.70158)) / 2 + .5; },
    elasticIn: t => -(Math.pow(2, 10 * (t -= 1)) * Math.sin((t - (0.4 / (2 * Math.PI) * Math.asin(1))) * (2 * Math.PI) / 0.4)),
    elasticOut: t => Math.pow(2, -10 * t) * Math.sin((t - (0.4 / (2 * Math.PI) * Math.asin(1))) * (2 * Math.PI) / 0.4) + 1,
    elasticInOut: t => t < .5 ? -.5 * (Math.pow(2, 10 * (t -= .5)) * Math.sin((t - (0.4 / 4)) * (2 * Math.PI) / 0.4))
      : Math.pow(2, -10 * (t -= .5)) * Math.sin((t - (0.4 / 4)) * (2 * Math.PI) / 0.4) * .5 + 1,
  };
  void EL;
  const lower = {}; for (const k of Object.keys(E)) lower[k.toLowerCase()] = E[k];
  /* V-Slice: ease "sine" + easeDir "InOut" o directamente "sineInOut". Desconocido → linear */
  E.get = (name, dir) => {
    let n = String(name || 'linear').trim();
    if (dir && !/(in|out)$/i.test(n) && n.toLowerCase() !== 'linear') n += dir;
    return lower[n.toLowerCase()] || lower[n.toLowerCase() + 'inout'] || E.linear;
  };
  return E;
})();

/* Interpolación con curva (tiempo de juego: se congela en pausa) */
function makeTween(from, to, durMs, ease) { return { from, to, t0: G.gameTime, dur: Math.max(0, durMs), ease: ease || Ease.linear }; }
function tweenValue(tw) {
  const k = tw.dur <= 0 ? 1 : clamp((G.gameTime - tw.t0) / tw.dur, 0, 1), e = tw.ease(k);
  return Array.isArray(tw.from) ? tw.from.map((f, i) => f + (tw.to[i] - f) * e) : tw.from + (tw.to - tw.from) * e;
}
const tweenDone = tw => tw.dur <= 0 || G.gameTime - tw.t0 >= tw.dur;

/* ---------- Eventos ---------- */
const getBool = (v, d) => v === undefined || v === null ? d : (v === true || v === 'true' || v === 1 || v === '1');
const getNum = (v, d) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };

const Events = {
  idx: 0, fired: 0, log: [], iconCache: new Map(),
  get list() { return (G.chart && G.chart.events) || []; },
  stepMs() { return G.chart.crochet / 4; },
  /* valor "v" normalizado a objeto (algunos charts guardan solo el personaje) */
  vals(ev) {
    const v = ev.v;
    if (v && typeof v === 'object' && !Array.isArray(v)) return v;
    if (ev.e === 'FocusCamera') return { char: v };
    if (ev.e === 'ZoomCamera') return { zoom: v };
    if (ev.e === 'ScrollSpeed') return { scroll: v };
    if (ev.e === 'SetCameraBop') return { rate: v };
    return {};
  },
  /* estado inicial (al reiniciar / buscar) */
  reset() {
    this.idx = 0; this.log.length = 0;
    Cam.resetEvents();
    G.speed = G.chart.speed; G.speedTween = null;
    if (Scene.baseIcons) { Scene.icons.player = Scene.baseIcons.player; Scene.icons.opponent = Scene.baseIcons.opponent; }
  },
  /* al buscar una posición: se aplican al instante los eventos "de estado" anteriores (sin animaciones) */
  seek(pos) {
    this.reset();
    const list = this.list;
    while (this.idx < list.length && list[this.idx].t <= pos) { this.fire(list[this.idx], true); this.idx++; }
  },
  update(pos) {
    const list = this.list;
    while (this.idx < list.length && list[this.idx].t <= pos) { this.fire(list[this.idx], false); this.idx++; }
    if (G.speedTween) { G.speed = tweenValue(G.speedTween); if (tweenDone(G.speedTween)) G.speedTween = null; }
  },
  fire(ev, instant) {
    const v = this.vals(ev);
    this.fired++; this.log.push(ev.e + '@' + Math.round(ev.t)); if (this.log.length > 20) this.log.shift();
    const step = this.stepMs();
    switch (ev.e) {
      case 'FocusCamera': {
        const ch = Math.round(getNum(v.char, 0)), x = getNum(v.x, 0), y = getNum(v.y, 0);
        let tx = x, ty = y;
        if (ch !== -1) {
          const role = ch === 0 ? 'bf' : ch === 2 ? 'gf' : 'dad';
          const p = focusPoint(role); if (!p) return;
          tx += p[0]; ty += p[1]; Scene.focus = role;
        } else Scene.focus = null;
        const ease = String(v.ease ?? 'CLASSIC');
        if (instant || ease === 'INSTANT') Cam.tweenTo(tx, ty, 0);
        else if (ease === 'CLASSIC') Cam.followTo(tx, ty);
        else Cam.tweenTo(tx, ty, getNum(v.duration, 4) * step, Ease.get(ease, v.easeDir));
        break;
      }
      case 'ZoomCamera': {
        const zoom = getNum(v.zoom, 1), direct = String(v.mode ?? 'direct') === 'direct';   // V-Slice: modo "direct" (por defecto) o "stage" (× zoom del escenario)
        const target = zoom * (direct ? 1 : Cam.stageZoom);
        const ease = String(v.ease ?? 'linear');
        Cam.zoomTo(target, instant || ease === 'INSTANT' ? 0 : getNum(v.duration, 4) * step, Ease.get(ease, v.easeDir));
        break;
      }
      case 'SetCameraBop': {
        const rate = Math.round(getNum(v.rate, 4)), intensity = getNum(v.intensity, 1);
        Cam.zoomRate = rate; Cam.bopIntensity = (FNF.BOP_INTENSITY - 1) * intensity + 1; Cam.hudIntensity = (FNF.BOP_INTENSITY - 1) * intensity * 2;
        break;
      }
      case 'PlayAnimation': {
        if (instant) return;
        const tg = String(v.target ?? 'bf').toLowerCase(), anim = String(v.anim ?? 'idle'), force = getBool(v.force, false);
        const role = /^(bf|boyfriend|player|0)$/.test(tg) ? 'bf' : /^(dad|opponent|1)$/.test(tg) ? 'dad' : /^(gf|girlfriend|2)$/.test(tg) ? 'gf' : null;
        const c = role && Scene.chars[role];
        if (c) c.playEvent(anim, force);
        else if (role && role !== 'gf') { const st = role === 'bf' ? G.bf : G.dad; const lane = LANE_DIRS.findIndex(d => anim.toUpperCase().includes(d)); if (lane >= 0) sing(st, lane); }
        break;
      }
      case 'SetHealthIcon': {
        const ch = Math.round(getNum(v.char, 0)), key = this.iconKey(ch, v);
        const apply = ic => { if (ic && ic.ok) { Scene.icons[ch === 0 ? 'player' : 'opponent'] = ic; } };
        const cached = this.iconCache.get(key);
        if (cached && cached.then) cached.then(apply); else if (cached) apply(cached);
        else { const p = this.loadIcon(ch, v); p.then(apply); }
        break;
      }
      case 'ScrollSpeed': {
        const abs = getBool(v.absolute, false), target = getNum(v.scroll, 1) * (abs ? 1 : G.chart.speed);
        const ease = String(v.ease ?? 'linear');
        if (instant || ease === 'INSTANT' || getNum(v.duration, 4) <= 0) { G.speed = target; G.speedTween = null; }
        else G.speedTween = makeTween(G.speed, target, getNum(v.duration, 4) * step, Ease.get(ease, v.easeDir));
        break;
      }
      default:
        // eventos de mods: si se cargó su .hxc, se ejecuta handleEvent (imitación); al buscar no se reproducen
        if (!instant) { try { Mods.fireEvent(ev); } catch (e) { console.warn('[hxc] evento', ev.e, e); HX.note(`${ev.e}: error al ejecutar (${e.message})`); } }
        break;
    }
  },
  iconKey(ch, v) { return JSON.stringify([ch, v.id, v.scale, v.flipX, v.isPixel, v.offsetX, v.offsetY]); },
  loadIcon(ch, v) {
    const key = this.iconKey(ch, v);
    const p = new HealthIcon(ch === 0 ? 0 : 1).load(String(v.id ?? 'bf'), { id: String(v.id ?? 'bf'), scale: getNum(v.scale, 1), flipX: getBool(v.flipX, false), isPixel: getBool(v.isPixel, false), offsets: [getNum(v.offsetX, 0), getNum(v.offsetY, 0)] })
      .then(ic => { this.iconCache.set(key, ic); return ic; });
    this.iconCache.set(key, p);
    return p;
  },
  /* precarga (pantalla de carga): iconos de SetHealthIcon */
  preload(chart) {
    this.iconCache.clear();
    const tasks = [];
    for (const ev of chart.events || []) if (ev.e === 'SetHealthIcon') { const v = this.vals(ev); const ch = Math.round(getNum(v.char, 0)); if (!this.iconCache.has(this.iconKey(ch, v))) tasks.push(this.loadIcon(ch, v)); }
    return Promise.all(tasks);
  },
  summary() {
    const c = {}; for (const e of this.list) c[e.e] = (c[e.e] || 0) + 1;
    return Object.entries(c).map(([k, n]) => `${k}×${n}${Mods.BUILTIN_EVENTS.includes(k) ? '' : Mods.events.has(k) ? ' (.hxc)' : ' (sin .hxc)'}`).join(', ') || 'ninguno';
  },
};
