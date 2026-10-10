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
  /* V-Slice (SongEvent): nombre = ease + easeDir; easeDir por defecto "In" y se ignora si el ease ya termina en
     In/Out/InOut o es "linear". Un ease que no existe en FlxEase → null (el evento no hace nada, como el juego). */
  E.get = (name, dir) => {
    let n = String(name ?? 'linear').trim();
    if (!n) n = 'linear';
    const d = dir === undefined || dir === null ? 'In' : String(dir);
    if (!/(in|out)$/i.test(n) && n.toLowerCase() !== 'linear') n += d;
    return E[n] || lower[n.toLowerCase()] || null;
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

const Events = {
  idx: 0, fired: 0, log: [], iconCache: new Map(), charCache: new Map(), soundCache: new Map(), lastStep: null,
  INTERNAL: ['ChangeCharacter', '_AddCameraZoom', '_SetGFSpeed', '_AltAnim', '_ScreenShake', '_PlaySound', '_SetProperty', '_CamFlash', '_ScriptEvent'],
  get list() { return (G.chart && G.chart.events) || []; },
  stepMs() { return Cond.stepMs(G.songPos); },
  isBuiltin(name) { return Mods.BUILTIN_EVENTS.includes(name) || this.INTERNAL.includes(name); },
  /* valor "v" normalizado a objeto (algunos charts guardan solo el valor principal) */
  vals(ev) {
    const v = ev.v;
    if (v && typeof v === 'object' && !Array.isArray(v)) return v;
    if (ev.e === 'FocusCamera') return { char: v };
    if (ev.e === 'ZoomCamera') return { zoom: v };
    if (ev.e === 'ScrollSpeed') return { scroll: v };
    if (ev.e === 'SetCameraBop') return { rate: v };
    if (ev.e === 'PlayAnimation') return { anim: v };
    if (ev.e === 'SetHealthIcon') return { id: v };
    return {};
  },
  /* estado inicial (al reiniciar / buscar) */
  reset() {
    this.idx = 0; this.log.length = 0; this.lastStep = null;
    Cam.resetEvents();
    G.speed = G.chart.speed; G.speedTween = null; G.speedSide = { player: G.chart.speed, opponent: G.chart.speed }; G.speedTweens = {};
    if (Scene.baseIcons) { Scene.icons.player = Scene.baseIcons.player; Scene.icons.opponent = Scene.baseIcons.opponent; }
    if (Scene.baseChars) {
      let changed = false;
      for (const r of ['bf', 'dad', 'gf']) if (Scene.chars[r] !== Scene.baseChars[r]) { Scene.chars[r] = Scene.baseChars[r]; changed = true; }
      if (changed && typeof applyBarColors === 'function') applyBarColors();
    }
    for (const c of Object.values(Scene.chars)) if (c) { c.idleSuffix = ''; c.altSing = false; if (c.baseDanceEvery !== undefined) c.danceEvery = c.baseDanceEvery; }
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
    for (const side of ['player', 'opponent']) {
      const tw = G.speedTweens && G.speedTweens[side];
      if (tw) { G.speedSide[side] = tweenValue(tw); if (tweenDone(tw)) G.speedTweens[side] = null; }
    }
    G.speed = G.speedSide ? G.speedSide.player : G.speed;
  },
  fire(ev, instant) {
    const v = this.vals(ev);
    this.fired++; this.log.push(ev.e + '@' + Math.round(ev.t)); if (this.log.length > 20) this.log.shift();
    if (!instant) StageRT.songEvent(ev);            // v3.5.0: onSongEvent del script del escenario (p. ej. "blackIn")
    // v3.7.0: onEvent de los scripts .lua (Psych) / .hx (Codename) y onSongEvent de los módulos .hxc
    let scripted = false;
    if (!instant && typeof ScriptHub !== 'undefined') scripted = ScriptHub.event(ev);
    const step = this.stepMs();
    switch (ev.e) {
      case 'FocusCamera': {
        // FocusCameraSongEvent: x/y (0), char (0; -1 = solo posición), duration (4 steps), ease ("CLASSIC"), easeDir ("In")
        let ch = v.char === undefined || v.char === null || v.char === '' ? 0 : Math.round(getNum(v.char, 0));
        const x = getNum(v.x, 0), y = getNum(v.y, 0);
        if (ch === -2) { Cam.followTo(null); return; }      // Psych "Camera Follow Pos" vacío: vuelve a seguir a quien canta
        let tx = x, ty = y;
        const role = ch === 0 ? 'bf' : ch === 1 ? 'dad' : ch === 2 ? 'gf' : null;
        if (role) {
          if (!Scene.chars[role] && !(role !== 'gf' && focusPoint(role))) return;   // no hay personaje: no hace nada
          const p = focusPoint(role); if (!p) return;
          tx += p[0]; ty += p[1]; Scene.focus = role;
        }
        const ease = String(v.ease ?? 'CLASSIC');
        if (ease === 'CLASSIC') { if (instant) Cam.tweenTo(tx, ty, 0); else Cam.followTo(tx, ty); }
        else if (instant || ease === 'INSTANT') Cam.tweenTo(tx, ty, 0);
        else { const fn = Ease.get(ease, v.easeDir); if (!fn) return; Cam.tweenTo(tx, ty, getNum(v.duration, 4) * step, fn); }
        break;
      }
      case 'ZoomCamera': {
        // ZoomCameraSongEvent: zoom (1), duration (4), mode ("direct" = zoom tal cual · "stage" = × zoom del escenario), ease ("linear")
        const zoom = getNum(v.zoom, 1), direct = String(v.mode ?? 'direct') === 'direct';
        const target = zoom * (direct ? 1 : Cam.stageZoom);
        const ease = String(v.ease ?? 'linear');
        if (instant || ease === 'INSTANT') { Cam.zoomTo(target, 0); break; }
        const fn = Ease.get(ease, v.easeDir); if (!fn) return;
        Cam.zoomTo(target, getNum(v.duration, 4) * step, fn);
        break;
      }
      case 'SetCameraBop': {
        // SetCameraBopSongEvent: rate (4 beats, decimal), offset (0 beats), intensity (1)
        const intensity = getNum(v.intensity, 1);
        Cam.zoomRate = getNum(v.rate, FNF.ZOOM_RATE); Cam.zoomOffset = getNum(v.offset, 0);
        Cam.bopIntensity = (FNF.BOP_INTENSITY - 1) * intensity + 1; Cam.hudIntensity = (FNF.BOP_INTENSITY - 1) * intensity * 2;
        break;
      }
      case 'PlayAnimation': {
        if (instant) return;
        const tg = String(v.target ?? 'boyfriend'), anim = String(v.anim ?? 'idle'), force = getBool(v.force, false);
        const role = roleOfTarget(tg), c = role && Scene.chars[role];
        // v3.5.0: si el objetivo no tiene la animación pero otro personaje cargado sí, la hace ese
        const other = c && !c.anims.has(anim) ? ['bf', 'dad', 'gf'].map(r => Scene.chars[r]).find(x => x && x !== c && x.anims.has(anim)) : null;
        if (other) { other.playEvent(anim, force); this.lastPlayAnim = { anim, target: tg, by: other.role }; }
        else if (c) { c.playEvent(anim, force); this.lastPlayAnim = { anim, target: tg, by: c.role }; }
        else if (role) { if (role !== 'gf') { const st = role === 'bf' ? G.bf : G.dad; const lane = LANE_DIRS.findIndex(d => anim.toUpperCase().includes(d)); if (lane >= 0) sing(st, lane); } }
        else propPlay(tg, anim, force);                    // prop del escenario con nombre (getNamedProp)
        break;
      }
      case 'SetHealthIcon': {
        // SetHealthIconSongEvent: id ("face"), char (0 = jugador · 1 = rival), scale, flipX, isPixel, offsetX/Y, shouldBop
        const ch = Math.round(getNum(v.char, 0)); if (ch !== 0 && ch !== 1) return;
        const key = this.iconKey(ch, v);
        const apply = ic => { if (ic && ic.ok) { ic.shouldBop = getBool(v.shouldBop, true); Scene.icons[ch === 0 ? 'player' : 'opponent'] = ic; } };
        const cached = this.iconCache.get(key);
        if (cached && cached.then) cached.then(apply); else if (cached) apply(cached);
        else this.loadIcon(ch, v).then(apply);
        break;
      }
      case 'ScrollSpeed': {
        // ScrollSpeedEvent: scroll (1), duration (4), ease ("linear"), strumline ("both" | "player" | "opponent"), absolute (false → × velocidad del chart)
        const abs = getBool(v.absolute, false), target = getNum(v.scroll, 1) * (abs ? 1 : G.chart.speed);
        const sl = String(v.strumline ?? 'both').toLowerCase(), sides = sl === 'player' ? ['player'] : sl === 'opponent' ? ['opponent'] : ['player', 'opponent'];
        const ease = String(v.ease ?? 'linear'), dur = getNum(v.duration, 4);
        let fn = null;
        if (!(instant || ease === 'INSTANT')) { fn = Ease.get(ease, v.easeDir); if (!fn) return; }
        for (const sd of sides) {
          if (!fn || dur <= 0) { G.speedSide[sd] = target; G.speedTweens[sd] = null; }
          else G.speedTweens[sd] = makeTween(G.speedSide[sd], target, dur * step, fn);
        }
        G.speed = G.speedSide.player;
        break;
      }
      /* ---- eventos internos (convertidos de Psych / Codename) ---- */
      case 'ChangeCharacter': this.changeChar(v.target, v.char, instant); break;
      case '_AddCameraZoom': {
        if (instant || !Optim.s.bop) return;
        if (Cam.zoom * Cam.bop < 1.35 * Cam.stageZoom) { Cam.bop += getNum(v.game, 0.015) / Math.max(0.1, Cam.zoom); G.hudZoom += getNum(v.hud, 0.03); }
        break;
      }
      case '_SetGFSpeed': { const gf = Scene.chars.gf; if (gf) { if (gf.baseDanceEvery === undefined) gf.baseDanceEvery = gf.danceEvery; gf.danceEvery = Math.max(1, getNum(v.speed, 1)); } break; }
      case '_AltAnim': {
        const c = Scene.chars[v.role]; if (!c) return;
        if (v.sing !== undefined) c.altSing = !!v.sing;
        if (v.idle !== undefined) c.idleSuffix = v.idle ? '-alt' : '';
        if (v.idleSuffix !== undefined) c.idleSuffix = String(v.idleSuffix || '');
        break;
      }
      case '_ScreenShake': {
        if (instant) return;
        for (const w of ['game', 'hud']) { const o = v[w]; if (o && o.dur > 0 && o.i > 0) CamFX[w].shake = { i: o.i, t0: G.gameTime, dur: o.dur * 1000, axes: 0x11 }; }
        break;
      }
      case '_ScriptEvent': break;                    // solo para onEvent de los scripts
      case '_SetProperty': { if (!instant && typeof PsychRT !== 'undefined') PsychRT.setProp(String(v.path || ''), PsychRT.coerce(v.value)); break; }
      case '_CamFlash': {
        if (instant) return;
        const cam = /hud|other/i.test(v.cam) ? HOST.camHUD : HOST.camGame, dur = getNum(v.steps, 4) * step / 1000;
        let col = v.color; if (Array.isArray(col)) col = (0xFF000000 | ((col[0] & 255) << 16) | ((col[1] & 255) << 8) | (col[2] & 255)) >>> 0; else if (typeof col === 'string') col = HOST.global('FlxColor').fromString(col) ?? 0xFFFFFFFF;
        if (v.reversed) cam.fade(col >>> 0, dur, false, () => cam.stopFade(), true); else cam.flash(col >>> 0, dur, null, true);
        break;
      }
      case '_PlaySound': {
        if (instant) return;
        const buf = this.soundCache.get(String(v.sound)); const c = Sfx.ensureCtx && Sfx.ensureCtx();
        if (buf && c) { const src = c.createBufferSource(), g = c.createGain(); g.gain.value = getNum(v.volume, 1); src.buffer = buf; src.connect(g).connect(c.destination); src.start(); }
        break;
      }
      default: {
        // "cambiar personaje" de V-Slice/Codename/.hxc: si ningún .hxc lo implementa, se imita con el personaje precargado
        const cc = !Mods.events.has(ev.e) && changeCharInfo(ev);
        if (cc) { this.changeChar(cc.role, cc.id, instant); break; }
        // eventos de mods: si se cargó su .hxc, se ejecuta handleEvent (imitación); al buscar no se reproducen
        let done = false;
        if (!instant) { try { done = Mods.fireEvent(ev); } catch (e) { console.warn('[hxc] evento', ev.e, e); HX.note(`${ev.e}: error al ejecutar (${e.message})`); done = true; } }
        // v3.5.0: evento sin .hxc que nombra un video / gif / sonido / imagen → se muestra o suena (imitación)
        if (!done && !instant && !scripted) this.playMedia(ev);
        break;
      }
    }
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
    if (old && !instant) { c.danced = old.danced; }
    c.reset();
    Scene.chars[role] = c;
    if (role !== 'gf' && icon && icon.ok) Scene.icons[role === 'bf' ? 'player' : 'opponent'] = icon;
    applyBarColors();
    if (Scene.focus === role && !Cam.tween) { const p = focusPoint(role); if (p && Cam.follow) Cam.follow = p; }
  },
  playMedia(ev) {
    for (const m of this.mediaOf(ev)) {
      if (m.kind === 'video') { const url = ModRes.get('video', m.key, null); if (url) { VideoSync.play(url, m.key, ev.t); this.lastMedia = 'video ' + m.key; } }
      else if (m.kind === 'gif') { const url = ModRes.get('gif', m.key, null); if (url) { VideoSync.play(url, m.key, ev.t, { gif: true, ms: 3000 }); this.lastMedia = 'gif ' + m.key; } }
      else if (m.kind === 'sound') { const buf = ModRes.get('sound', m.key, null), c = Sfx.ensureCtx && Sfx.ensureCtx(); if (buf && c) { const src = c.createBufferSource(); src.buffer = buf; src.connect(c.destination); src.start(); this.lastMedia = 'sonido ' + m.key; } }
    }
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
    for (const ev of chart.events || []) if (ev.e === 'SetHealthIcon') { const v = this.vals(ev); const ch = Math.round(getNum(v.char, 0)); if (!this.iconCache.has(this.iconKey(ch, v))) tasks.push(this.loadIcon(ch, v)); }
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
    return Object.entries(c).map(([k, n]) => `${k}×${n}${this.isBuiltin(k) ? '' : Mods.events.has(k) ? ' (.hxc)' : CHANGE_CHAR_RX.test(k) ? ' (imitado: cambio de personaje)' : ' (sin .hxc)'}`).join(', ') || 'ninguno';
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
