/* =====================================================================
   vslice.js — v3.8.0: puerto a JS del código de FNF V-Slice (FunkinCrew/Funkin, rama main,
   commit b2215482) y de las piezas de HaxeFlixel (FunkinCrew/flixel 141f23c) que usan los
   eventos de canción y los note kinds. Solo lógica (sin dibujo): la usan game.js / eventos.js /
   personajes.js / mods.js y las pruebas de paridad (TestSong-qa/paridad).
     · Constants.hx, Scoring.hx (PBOT1), FlxMath, FlxEase (fórmulas exactas)
     · FlxTween / VarTween / FlxTweenManager (tiempo acumulado, valores iniciales al primer
       update, onComplete después de actualizar todos los tweens)
     · FlxCamera.follow (LOCKON) + updateFollow + updateLerp(1 - (1 - lerp)^(elapsed·60))
     · FlxAnimation / FlxAnimationController.play (frames, finished, force)
     · Conductor (timeChanges con compás, beat/step/measure, roundDecimal)
     · ScriptEvent, NoteScriptEvent, HitNoteScriptEvent, GhostMissNoteScriptEvent,
       HoldNoteScriptEvent, SongEventScriptEvent, SongTimeScriptEvent, UpdateScriptEvent…
       con cancel()/stopPropagation() y ScriptEventDispatcher.callEvent
     · SongEventData, SongEventRegistry (queryEvents, resetEvents, handleSkippedEvents,
       eventos viejos > 1000 ms con processOldEvents) y los eventos de source/funkin/play/event
     · NoteKind / NoteKindManager (noanim, non_scoreable, scoreable, suffix, noteStyleId, params)
     · BaseCharacter / Bopper (dance, holdTimer, singTimeSteps, idleSuffix, canPlayOtherAnims)
     · PlayState: cámara (follow point, zoom, bop, tweens), vida, puntuación, combo, voces,
       goodNoteHit / onNoteMiss / ghostNoteMiss / processNotes / dispatchEvent / processSongEvents
   ===================================================================== */
'use strict';

const VS = (() => {
  /* ---------- funkin.util.Constants (expresiones copiadas tal cual) ---------- */
  const HEALTH_MAX = 2.0;
  const C = {
    HEALTH_MAX, HEALTH_STARTING: HEALTH_MAX / 2.0, HEALTH_MIN: 0.0,
    HEALTH_KILLER_BONUS: 2.0 / 100.0 * HEALTH_MAX, HEALTH_SICK_BONUS: 1.5 / 100.0 * HEALTH_MAX,
    HEALTH_GOOD_BONUS: 0.75 / 100.0 * HEALTH_MAX, HEALTH_BAD_BONUS: 0.0 / 100.0 * HEALTH_MAX,
    HEALTH_SHIT_BONUS: -1.0 / 100.0 * HEALTH_MAX, HEALTH_HOLD_BONUS_PER_SECOND: 6.0 / 100.0 * HEALTH_MAX,
    HEALTH_MISS_PENALTY: -4.0 / 100.0 * HEALTH_MAX, HEALTH_GHOST_MISS_PENALTY: -4.0 / 100.0 * HEALTH_MAX,
    HEALTH_HOLD_DROP_PENALTY_PER_SECOND: 0 / 100.0 * HEALTH_MAX, HEALTH_HOLD_DROP_PENALTY_MAX: 0 / 100.0 * HEALTH_MAX,
    HEALTH_MINE_PENALTY: -15.0 / 100.0 * HEALTH_MAX,
    SCORE_GHOST_MISS_PENALTY: -10.0, SCORE_HOLD_BONUS_PER_SECOND: 250.0, SCORE_HOLD_DROP_PENALTY_PER_SECOND: -125.0,
    HOLD_DROP_PENALTY_THRESHOLD_MS: 160.0,
    JUDGEMENT_KILLER_COMBO_BREAK: false, JUDGEMENT_SICK_COMBO_BREAK: false, JUDGEMENT_GOOD_COMBO_BREAK: false,
    JUDGEMENT_BAD_COMBO_BREAK: true, JUDGEMENT_SHIT_COMBO_BREAK: true,
    HIT_WINDOW_MS: 160.0, PIXELS_PER_MS: 0.45, STEPS_PER_BEAT: 4, SECS_PER_MIN: 60, MS_PER_SEC: 1000,
    DEFAULT_BPM: 100.0, DEFAULT_TIME_SIGNATURE_NUM: 4, DEFAULT_TIME_SIGNATURE_DEN: 4,
    DEFAULT_BOP_INTENSITY: 1.015, DEFAULT_ZOOM_RATE: 4, DEFAULT_ZOOM_OFFSET: 0, DEFAULT_PROP_RATE: 1,
    DEFAULT_CAMERA_FOLLOW_RATE: 0.04, DEFAULT_HEALTH_ICON: 'face', GHOST_TAP_DELAY: 3 / 8,
    ANIMATION_HOLD_SUFFIX: '-hold', ANIMATION_END_SUFFIX: '-end',
    // CharacterData
    DEFAULT_SINGTIME: 8.0, DEFAULT_DANCEEVERY: 1.0,
  };

  /* ---------- flixel.math.FlxMath ---------- */
  const fround = v => Math.floor(v + 0.5);              // Math.fround de Haxe (JS/interp)
  const FlxMath = { fround,
    lerp: (a, b, ratio) => a + ratio * (b - a),
    roundDecimal(v, p) { let mult = 1; for (let i = 0; i < p; i++) mult *= 10; return fround(v * mult) / mult; },
    bound: (v, min, max) => { const lb = (min != null && v < min) ? min : v; return (max != null && lb > max) ? max : lb; },
  };

  /* ---------- flixel.tweens.FlxEase (copia exacta) ---------- */
  const PI2 = Math.PI / 2, B1 = 1 / 2.75, B2 = 2 / 2.75, B3 = 1.5 / 2.75, B4 = 2.5 / 2.75, B5 = 2.25 / 2.75, B6 = 2.625 / 2.75;
  const ELASTIC_AMPLITUDE = 1, ELASTIC_PERIOD = 0.4;
  const smoothStepInOut = t => t * t * (t * -2 + 3), smootherStepInOut = t => t * t * t * (t * (t * 6 - 15) + 10);
  const bounceOut = t => { if (t < B1) return 7.5625 * t * t; if (t < B2) return 7.5625 * (t - B3) * (t - B3) + .75; if (t < B4) return 7.5625 * (t - B5) * (t - B5) + .9375; return 7.5625 * (t - B6) * (t - B6) + .984375; };
  const FlxEase = {
    linear: t => t,
    quadIn: t => t * t, quadOut: t => -t * (t - 2), quadInOut: t => t <= .5 ? t * t * 2 : 1 - (--t) * t * 2,
    cubeIn: t => t * t * t, cubeOut: t => 1 + (--t) * t * t, cubeInOut: t => t <= .5 ? t * t * t * 4 : 1 + (--t) * t * t * 4,
    quartIn: t => t * t * t * t, quartOut: t => 1 - (t -= 1) * t * t * t, quartInOut: t => t <= .5 ? t * t * t * t * 8 : (1 - (t = t * 2 - 2) * t * t * t) / 2 + .5,
    quintIn: t => t * t * t * t * t, quintOut: t => (t = t - 1) * t * t * t * t + 1, quintInOut: t => ((t *= 2) < 1) ? (t * t * t * t * t) / 2 : ((t -= 2) * t * t * t * t + 2) / 2,
    smoothStepIn: t => 2 * smoothStepInOut(t / 2), smoothStepOut: t => 2 * smoothStepInOut(t / 2 + 0.5) - 1, smoothStepInOut,
    smootherStepIn: t => 2 * smootherStepInOut(t / 2), smootherStepOut: t => 2 * smootherStepInOut(t / 2 + 0.5) - 1, smootherStepInOut,
    sineIn: t => -Math.cos(PI2 * t) + 1, sineOut: t => Math.sin(PI2 * t), sineInOut: t => -Math.cos(Math.PI * t) / 2 + .5,
    bounceIn: t => 1 - bounceOut(1 - t), bounceOut, bounceInOut: t => t < 0.5 ? (1 - bounceOut(1 - 2 * t)) / 2 : (1 + bounceOut(2 * t - 1)) / 2,
    circIn: t => -(Math.sqrt(1 - t * t) - 1), circOut: t => Math.sqrt(1 - (t - 1) * (t - 1)),
    circInOut: t => t <= .5 ? (Math.sqrt(1 - t * t * 4) - 1) / -2 : (Math.sqrt(1 - (t * 2 - 2) * (t * 2 - 2)) + 1) / 2,
    expoIn: t => Math.pow(2, 10 * (t - 1)), expoOut: t => -Math.pow(2, -10 * t) + 1,
    expoInOut: t => t < .5 ? Math.pow(2, 10 * (t * 2 - 1)) / 2 : (-Math.pow(2, -10 * (t * 2 - 1)) + 2) / 2,
    backIn: t => t * t * (2.70158 * t - 1.70158), backOut: t => 1 - (--t) * (t) * (-2.70158 * t - 1.70158),
    backInOut: t => { t *= 2; if (t < 1) return t * t * (2.70158 * t - 1.70158) / 2; t--; return (1 - (--t) * (t) * (-2.70158 * t - 1.70158)) / 2 + .5; },
    elasticIn: t => -(ELASTIC_AMPLITUDE * Math.pow(2, 10 * (t -= 1)) * Math.sin((t - (ELASTIC_PERIOD / (2 * Math.PI) * Math.asin(1 / ELASTIC_AMPLITUDE))) * (2 * Math.PI) / ELASTIC_PERIOD)),
    elasticOut: t => (ELASTIC_AMPLITUDE * Math.pow(2, -10 * t) * Math.sin((t - (ELASTIC_PERIOD / (2 * Math.PI) * Math.asin(1 / ELASTIC_AMPLITUDE))) * (2 * Math.PI) / ELASTIC_PERIOD) + 1),
    elasticInOut: t => { if (t < 0.5) return -0.5 * (Math.pow(2, 10 * (t -= 0.5)) * Math.sin((t - (ELASTIC_PERIOD / 4)) * (2 * Math.PI) / ELASTIC_PERIOD)); return Math.pow(2, -10 * (t -= 0.5)) * Math.sin((t - (ELASTIC_PERIOD / 4)) * (2 * Math.PI) / ELASTIC_PERIOD) * 0.5 + 1; },
  };
  /* SongEvent: nombre = ease + easeDir (easeDir "In" por defecto; se ignora si el ease ya termina en In/Out/InOut
     o es "linear"); Reflect.field(FlxEase, nombre) distingue mayúsculas → null = el evento no hace nada */
  const EASE_TYPE_DIR_REGEX = /(In|Out|InOut)$/i;
  function easeFor(ease, easeDir) {
    let dir = easeDir ?? 'In';
    if (EASE_TYPE_DIR_REGEX.test(ease) || ease === 'linear') dir = '';
    const f = FlxEase[`${ease}${dir}`];
    return typeof f === 'function' ? f : null;
  }

  /* ---------- flixel.tweens.FlxTween / VarTween / FlxTweenManager ---------- */
  const T_PERSIST = 1, T_LOOPING = 2, T_PINGPONG = 4, T_ONESHOT = 8, T_BACKWARD = 16;
  class FlxTween {
    constructor(opts, manager) {
      opts = opts || {};
      this.manager = manager; this.ease = typeof opts.ease === 'function' ? opts.ease : null;
      this.onStart = opts.onStart || null; this.onUpdate = opts.onUpdate || null; this.onComplete = opts.onComplete || null;
      this.type = opts.type || T_ONESHOT; this.backward = (this.type & T_BACKWARD) > 0;
      this.startDelay = +opts.startDelay || 0; this.loopDelay = +opts.loopDelay || 0; this.framerate = +opts.framerate || 0;
      this.duration = 0; this.executions = 0; this.scale = 0; this.active = false; this.finished = false;
      this._secondsSinceStart = 0; this._delayToUse = 0; this._running = false;
    }
    get percent() { return this.duration ? Math.max(this._secondsSinceStart - this._delayToUse, 0) / this.duration : 0; }
    start() {
      this._secondsSinceStart = 0; this._delayToUse = this.executions > 0 ? this.loopDelay : this.startDelay;
      if (this.duration === 0) { this.active = false; return this; }
      this.active = true; this._running = false; this.finished = false; return this;
    }
    update(elapsed) {
      let preTick = this._secondsSinceStart; this._secondsSinceStart += elapsed; let postTick = this._secondsSinceStart;
      const delay = this.executions > 0 ? this.loopDelay : this.startDelay;
      if (this._secondsSinceStart < delay) return;
      if (this.framerate > 0) { preTick = fround(preTick * this.framerate) / this.framerate; postTick = fround(postTick * this.framerate) / this.framerate; }
      this.scale = Math.max(postTick - delay, 0) / this.duration;
      if (this.ease) this.scale = this.ease(this.scale);
      if (this.backward) this.scale = 1 - this.scale;
      if (this._secondsSinceStart > delay && !this._running) { this._running = true; if (this.onStart) this.onStart(this); }
      if (this._secondsSinceStart >= this.duration + delay) { this.scale = this.backward ? 0 : 1; this.finished = true; }
      else if (postTick > preTick && this.onUpdate) this.onUpdate(this);
    }
    finish() {
      this.executions++;
      if (this.onComplete) this.onComplete(this);
      const type = this.type & ~T_BACKWARD;
      if (type === T_PERSIST || type === T_ONESHOT) {
        this.onEnd(); this._secondsSinceStart = this.duration + this.startDelay;
        if (type === T_ONESHOT && this.manager) this.manager.remove(this);
      }
      if (type === T_LOOPING || type === T_PINGPONG) {
        this._secondsSinceStart = (this._secondsSinceStart - this._delayToUse) % this.duration + this._delayToUse;
        this.scale = Math.max(this._secondsSinceStart - this._delayToUse, 0) / this.duration;
        if (this.ease && this.scale > 0 && this.scale < 1) this.scale = this.ease(this.scale);
        if (type === T_PINGPONG) { this.backward = !this.backward; if (this.backward) this.scale = 1 - this.scale; }
        this.restart();
      }
    }
    restart() { if (this.active) this.start(); }
    /* onEnd → setVarsOnEnd (las cadenas then() no se usan en los eventos) */
    onEnd() { this.active = false; this._running = false; this.finished = true; }
    cancel() { this.onEnd(); if (this.manager) this.manager.remove(this); }
  }
  class VarTween extends FlxTween {
    tween(object, properties, duration) {
      this._object = object; this.duration = duration; this._infos = [];
      for (const path of Object.keys(properties)) {
        let target = object; const parts = path.split('.'), field = parts.pop();
        for (const c of parts) target = target[c];
        this._infos.push({ object: target, field, startValue: NaN, range: properties[path] });
      }
      this.start(); return this;
    }
    update(elapsed) {
      const delay = this.executions > 0 ? this.loopDelay : this.startDelay;
      if (this._secondsSinceStart < delay) { super.update(elapsed); return; }
      if (Number.isNaN(this._infos[0].startValue)) for (const i of this._infos) { const v = +i.object[i.field]; i.startValue = v; i.range = i.range - v; }
      super.update(elapsed);
      if (this.active) for (const i of this._infos) i.object[i.field] = i.startValue + i.range * this.scale;
    }
  }
  class NumTween extends FlxTween {
    tween(from, to, duration, fn) { this._from = this.value = from; this._range = to - from; this.duration = duration; this._fn = fn || null; this.start(); return this; }
    update(elapsed) { super.update(elapsed); this.value = this._from + this._range * this.scale; if (this._fn) this._fn(this.value); }
  }
  class FlxTweenManager {
    constructor() { this._tweens = []; }
    tween(object, values, duration = 1, opts) { const t = new VarTween(opts, this); t.tween(object, values, duration); return this.add(t); }
    num(from, to, duration = 1, opts, fn) { const t = new NumTween(opts, this); t.tween(from, to, duration, fn); return this.add(t); }
    add(t) { if (t == null) return null; this._tweens.push(t); return t; }
    /* FlxArrayUtil.fastSplice: el último ocupa el hueco (cambia el orden, como en Flixel) */
    remove(t) { if (t == null) return null; t.active = false; const a = this._tweens, i = a.indexOf(t); if (i !== -1) { a[i] = a[a.length - 1]; a.pop(); } return t; }
    update(elapsed) {
      let finished = null;
      // (for-in de Haxe sobre la lista viva = índice; además no crea una copia por frame)
      for (let i = 0, a = this._tweens; i < a.length; i++) {
        const t = a[i]; if (!t.active) continue;
        t.update(elapsed);
        if (t.finished) (finished || (finished = [])).push(t);
      }
      if (finished) while (finished.length) finished.shift().finish();
    }
    clear() { for (const t of this._tweens.slice()) this.remove(t); }
    cancelTweensOf(o) { for (const t of this._tweens.slice()) if (t._object === o) t.cancel(); }
  }

  /* ---------- flixel.FlxCamera (seguimiento LOCKON + lerp; scroll = esquina superior izquierda) ---------- */
  class FlxCamera {
    constructor(w = 1280, h = 720) {
      this.width = w; this.height = h; this.scroll = { x: 0, y: 0 }; this.zoom = 1; this.target = null; this.followLerp = 1;
      this.followActive = true; this.deadzone = null; this._scrollTarget = { x: 0, y: 0 }; this.targetOffset = { x: 0, y: 0 };
    }
    follow(target, lerp = 1) {
      this.target = target; this.followLerp = lerp;
      const w = target ? target.width || 0 : 0, h = target ? target.height || 0 : 0;
      this.deadzone = { x: (this.width - w) / 2, y: (this.height - h) / 2 - h * 0.25, width: w, height: h };
    }
    focusOn(p) { this.scroll.x = p.x - this.width * 0.5; this.scroll.y = p.y - this.height * 0.5; }
    updateFollow() {
      const t = this.target, dz = this.deadzone, st = this._scrollTarget;
      if (!dz) { st.x = t.x + (t.width || 0) / 2 + this.targetOffset.x - this.width * 0.5; st.y = t.y + (t.height || 0) / 2 + this.targetOffset.y - this.height * 0.5; return; }
      const tx = t.x + this.targetOffset.x, ty = t.y + this.targetOffset.y;
      let edge = tx - dz.x; if (st.x > edge) st.x = edge;
      edge = tx + (t.width || 0) - dz.x - dz.width; if (st.x < edge) st.x = edge;
      edge = ty - dz.y; if (st.y > edge) st.y = edge;
      edge = ty + (t.height || 0) - dz.y - dz.height; if (st.y < edge) st.y = edge;
    }
    updateLerp(elapsed) {
      if (this.followLerp >= 1.0) { this.scroll.x = this._scrollTarget.x; this.scroll.y = this._scrollTarget.y; }
      else if (this.followLerp > 0.0) {
        const a = 1.0 - Math.pow(1.0 - this.followLerp, elapsed * 60);
        this.scroll.x += (this._scrollTarget.x - this.scroll.x) * a; this.scroll.y += (this._scrollTarget.y - this.scroll.y) * a;
      }
    }
    update(elapsed) { if (this.target != null && this.followActive) { this.updateFollow(); this.updateLerp(elapsed); } }
    get centerX() { return this.scroll.x + this.width * 0.5; }
    get centerY() { return this.scroll.y + this.height * 0.5; }
  }

  /* ---------- flixel.animation.FlxAnimation + FlxAnimationController.play ---------- */
  class FlxAnim {
    constructor(name, numFrames, frameRate, looped) {
      this.name = name; this.numFrames = Math.max(1, numFrames | 0); this.frameRate = frameRate; this.looped = !!looped;
      this.frameDuration = frameRate > 0 ? 1.0 / frameRate : 0; this.curFrame = 0; this._frameTimer = 0; this.finished = true; this.paused = true;
    }
  }
  class AnimController {
    constructor(onFinish) { this.anims = new Map(); this.curAnim = null; this.onFinish = onFinish || null; }
    add(name, numFrames, frameRate, looped) { this.anims.set(name, new FlxAnim(name, numFrames, frameRate, looped)); }
    exists(name) { return this.anims.has(name); }
    get name() { return this.curAnim ? this.curAnim.name : ''; }
    get finished() { return this.curAnim ? this.curAnim.finished : true; }
    play(name, force = false, frame = 0) {
      const a = this.anims.get(name); if (!a) return false;
      if (this.curAnim && name !== this.curAnim.name) { this.curAnim.finished = true; this.curAnim.paused = true; }
      this.curAnim = a;
      if (!force && !a.finished) { a.paused = false; return true; }
      a.paused = false; a._frameTimer = 0; a.finished = a.frameDuration === 0;
      a.curFrame = Math.min(frame, a.numFrames - 1);
      if (a.finished && this.onFinish) this.onFinish(a.name);
      return true;
    }
    update(elapsed) {
      const a = this.curAnim; if (!a || a.frameDuration === 0 || a.finished || a.paused) return;
      a._frameTimer += elapsed;
      while (a._frameTimer > a.frameDuration && !a.finished) {
        a._frameTimer -= a.frameDuration;
        if (a.looped && a.curFrame === a.numFrames - 1) a.curFrame = 0;
        else if (!a.looped && a.curFrame + 1 > a.numFrames - 1) { a.finished = true; if (this.onFinish) this.onFinish(a.name); }
        else a.curFrame++;
        if (a.finished) break;
      }
    }
  }

  /* ---------- funkin.Conductor ---------- */
  class Conductor {
    constructor() {
      this.timeChanges = []; this.currentTimeChange = null; this.songPosition = 0; this.bpmOverride = null;
      this.currentMeasure = 0; this.currentBeat = 0; this.currentStep = 0; this.currentMeasureTime = 0; this.currentBeatTime = 0; this.currentStepTime = 0;
      this.instrumentalOffset = 0; this.formatOffset = 0; this.globalOffset = 0;
      this.onStepHit = null; this.onBeatHit = null; this.onMeasureHit = null;
    }
    get bpm() {
      if (this.bpmOverride != null) return this.bpmOverride;
      if (this.currentTimeChange == null) return C.DEFAULT_BPM;
      const ps = VS.play;   // get_bpm: en la cuenta atrás manda el timeChange de startTimestamp
      if (ps != null && ps.conductor === this && ps.startingSong) {
        for (let i = 0; i < this.timeChanges.length; i++) { if (ps.startTimestamp >= this.timeChanges[i].timeStamp) this.currentTimeChange = this.timeChanges[i]; if (ps.startTimestamp < this.timeChanges[i].timeStamp) break; }
      }
      return this.currentTimeChange.bpm;
    }
    get startingBPM() { if (this.bpmOverride != null) return this.bpmOverride; const tc = this.timeChanges[0]; return tc == null ? C.DEFAULT_BPM : tc.bpm; }
    get timeSignatureNumerator() { return this.currentTimeChange == null ? C.DEFAULT_TIME_SIGNATURE_NUM : this.currentTimeChange.timeSignatureNum; }
    get timeSignatureDenominator() { return this.currentTimeChange == null ? C.DEFAULT_TIME_SIGNATURE_DEN : this.currentTimeChange.timeSignatureDen; }
    get beatLengthMs() { return ((C.SECS_PER_MIN / this.bpm) * C.MS_PER_SEC) * (4 / this.timeSignatureDenominator); }
    get stepLengthMs() { return this.beatLengthMs / C.STEPS_PER_BEAT; }
    get measureLengthMs() { return this.beatLengthMs * this.timeSignatureNumerator; }
    get stepsPerMeasure() { return Math.trunc(this.timeSignatureNumerator * C.STEPS_PER_BEAT); }
    get combinedOffset() { return this.instrumentalOffset + this.formatOffset + this.globalOffset; }
    /* SongTimeChange: { timeStamp (t), bpm, timeSignatureNum (n), timeSignatureDen (d), beatTime } */
    mapTimeChanges(list) {
      const src = (list || []).map(tc => ({ timeStamp: +(tc.timeStamp ?? tc.t ?? 0), bpm: +tc.bpm, timeSignatureNum: +(tc.timeSignatureNum ?? tc.n ?? 4) || 4, timeSignatureDen: +(tc.timeSignatureDen ?? tc.d ?? 4) || 4, beatTime: 0 }))
        .filter(tc => tc.bpm > 0).sort((a, b) => a.timeStamp - b.timeStamp);
      this.timeChanges = [];
      for (const tc of src) {
        if (tc.timeStamp < 0.0) tc.timeStamp = 0.0;
        tc.beatTime = 0.0;
        if (tc.timeStamp > 0.0 && this.timeChanges.length > 0) {
          const p = this.timeChanges[this.timeChanges.length - 1];
          tc.beatTime = FlxMath.roundDecimal(p.beatTime + ((tc.timeStamp - p.timeStamp) * p.bpm / C.SECS_PER_MIN / C.MS_PER_SEC * (p.timeSignatureDen / 4)), 4);
        }
        this.timeChanges.push(tc);
      }
      this.update(this.songPosition, false);
    }
    update(songPos, applyOffsets = true, silent = false) {
      if (applyOffsets) songPos += this.combinedOffset;
      const oldMeasure = this.currentMeasure, oldBeat = this.currentBeat, oldStep = this.currentStep;
      this.songPosition = songPos;
      this.currentTimeChange = this.timeChanges[0] || null;
      if (this.songPosition > 0.0) for (const tc of this.timeChanges) { if (this.songPosition >= tc.timeStamp) this.currentTimeChange = tc; if (this.songPosition < tc.timeStamp) break; }
      if (this.currentTimeChange != null && this.songPosition > 0.0) {
        const tc = this.currentTimeChange;
        this.currentStepTime = FlxMath.roundDecimal((tc.beatTime * C.STEPS_PER_BEAT) + (this.songPosition - tc.timeStamp) / this.stepLengthMs, 6);
        this.currentBeatTime = this.currentStepTime / C.STEPS_PER_BEAT;
        this.currentMeasureTime = this.getTimeInMeasures(this.songPosition);
      } else {
        this.currentStepTime = FlxMath.roundDecimal(this.songPosition / this.stepLengthMs, 4);
        this.currentBeatTime = this.currentStepTime / C.STEPS_PER_BEAT;
        this.currentMeasureTime = this.currentStepTime / this.stepsPerMeasure;
      }
      this.currentStep = Math.floor(this.currentStepTime); this.currentBeat = Math.floor(this.currentBeatTime); this.currentMeasure = Math.floor(this.currentMeasureTime);
      if (silent) return;
      if (this.currentStep !== oldStep && this.onStepHit) this.onStepHit();
      if (this.currentBeat !== oldBeat && this.onBeatHit) this.onBeatHit();
      if (this.currentMeasure !== oldMeasure && this.onMeasureHit) this.onMeasureHit();
    }
    static stepLen(tc) { return (((C.SECS_PER_MIN / tc.bpm) * C.MS_PER_SEC) * (4 / tc.timeSignatureDen)) / C.STEPS_PER_BEAT; }
    getTimeInMeasures(ms) {
      if (!this.timeChanges.length) return ms / this.stepLengthMs / this.stepsPerMeasure;
      let r = 0; ms = ms < 0 ? 0 : ms; let last = this.timeChanges[0], i = -1;
      for (const tc of this.timeChanges) {
        if (ms >= tc.timeStamp) {
          if (ms < tc.timeStamp || i === this.timeChanges.length - 1) { last = tc; break; }
          r += (tc.timeStamp - last.timeStamp) / Conductor.stepLen(last) / (last.timeSignatureNum * C.STEPS_PER_BEAT);
          last = tc;
        }
        i++;
      }
      return r + (ms - last.timeStamp) / Conductor.stepLen(last) / (last.timeSignatureNum * C.STEPS_PER_BEAT);
    }
    getTimeInSteps(ms) {
      if (!this.timeChanges.length) return Math.floor(ms / this.stepLengthMs);
      let r = 0; ms = ms < 0 ? 0 : ms; let last = this.timeChanges[0], i = -1;
      for (const tc of this.timeChanges) {
        if (ms >= tc.timeStamp) {
          if (ms < tc.timeStamp || i === this.timeChanges.length - 1) { last = tc; break; }
          r += (tc.beatTime - last.beatTime) * C.STEPS_PER_BEAT; last = tc;
        }
        i++;
      }
      return r + (ms - last.timeStamp) / Conductor.stepLen(last);
    }
    getStepTimeInMs(stepTime) {
      if (!this.timeChanges.length) return stepTime * this.stepLengthMs;
      let r = 0; stepTime = stepTime < 0 ? 0 : stepTime; let last = this.timeChanges[0], i = -1;
      for (const tc of this.timeChanges) {
        if (stepTime >= tc.beatTime * C.STEPS_PER_BEAT) {
          if (stepTime < tc.beatTime * C.STEPS_PER_BEAT || i === this.timeChanges.length - 1) { last = tc; break; }
          r += tc.timeStamp - last.timeStamp; last = tc;
        }
        i++;
      }
      return r + (stepTime - last.beatTime * C.STEPS_PER_BEAT) * Conductor.stepLen(last);
    }
    getBeatTimeInMs(beatTime) { return this.getStepTimeInMs(beatTime * C.STEPS_PER_BEAT); }
    /* tc del punto que rige "ms" (para beatLengthMs en cualquier tiempo, como currentTimeChange) */
    timeChangeAt(ms) { let p = this.timeChanges[0] || null; if (ms > 0) for (const tc of this.timeChanges) { if (ms >= tc.timeStamp) p = tc; else break; } return p; }
  }

  /* ---------- funkin.modding.events.ScriptEvent (+ subclases) ---------- */
  class ScriptEvent {
    constructor(type, cancelable = false) { this.type = type; this.cancelable = cancelable; this.eventCanceled = false; this.shouldPropagate = true; this.__host = 'ScriptEvent'; this.__open = true; }
    cancelEvent() { if (this.cancelable) this.eventCanceled = true; }
    cancel() { this.cancelEvent(); }
    stopPropagation() { this.shouldPropagate = false; }
    toString() { return `ScriptEvent(type=${this.type}, cancelable=${this.cancelable})`; }
  }
  class NoteScriptEvent extends ScriptEvent {
    constructor(type, note, healthChange, comboCount = 0, cancelable = false) { super(type, cancelable); this.note = note; this.healthChange = healthChange; this.comboCount = comboCount; this.playSound = true; this.__host = 'NoteScriptEvent'; }
  }
  class HitNoteScriptEvent extends NoteScriptEvent {
    constructor(note, healthChange, score, judgement, isComboBreak, comboCount = 0, hitDiff = 0, doesNotesplash = false) {
      super('NOTE_HIT', note, healthChange, comboCount, true);
      this.score = score; this.judgement = judgement; this.isComboBreak = isComboBreak; this.doesNotesplash = doesNotesplash; this.hitDiff = hitDiff; this.__host = 'HitNoteScriptEvent';
    }
  }
  class HoldNoteScriptEvent extends NoteScriptEvent {
    constructor(type, holdNote, healthChange, score, isComboBreak, comboCount = 0) {
      super(type, null, healthChange, comboCount, true); this.holdNote = holdNote; this.score = score; this.isComboBreak = isComboBreak; this.__host = 'HoldNoteScriptEvent';
    }
  }
  class GhostMissNoteScriptEvent extends ScriptEvent {
    constructor(dir, hasPossibleNotes, healthChange, scoreChange) {
      super('NOTE_GHOST_MISS', true); this.dir = dir; this.hasPossibleNotes = hasPossibleNotes; this.healthChange = healthChange; this.scoreChange = scoreChange; this.playSound = true; this.playAnim = true; this.__host = 'GhostMissNoteScriptEvent';
    }
  }
  class SongEventScriptEvent extends ScriptEvent { constructor(eventData) { super('SONG_EVENT', true); this.eventData = eventData; this.__host = 'SongEventScriptEvent'; } }
  class UpdateScriptEvent extends ScriptEvent { constructor(elapsed) { super('UPDATE', false); this.elapsed = elapsed; this.__host = 'UpdateScriptEvent'; } }
  class SongTimeScriptEvent extends ScriptEvent { constructor(type, beat, step) { super(type, true); this.beat = beat; this.step = step; this.__host = 'SongTimeScriptEvent'; } }
  class CountdownScriptEvent extends ScriptEvent { constructor(type, step, cancelable = true) { super(type, cancelable); this.step = step; this.__host = 'CountdownScriptEvent'; } }
  class SongRetryEvent extends ScriptEvent { constructor(difficulty) { super('SONG_RETRY', false); this.difficulty = difficulty; this.__host = 'SongRetryEvent'; } }
  class PauseScriptEvent extends ScriptEvent { constructor(gitaroo) { super('PAUSE', true); this.gitaroo = gitaroo; this.__host = 'PauseScriptEvent'; } }
  class SongLoadScriptEvent extends ScriptEvent { constructor(id, difficulty, notes, events) { super('SONG_LOADED', false); this.id = id; this.difficulty = difficulty; this.notes = notes; this.events = events; this.__host = 'SongLoadScriptEvent'; } }

  /* ScriptEventDispatcher.callEvent: onScriptEvent siempre; luego el método del tipo si shouldPropagate */
  const METHOD = {
    CREATE: 'onCreate', DESTROY: 'onDestroy', UPDATE: 'onUpdate', ADDED: 'onAdd',
    NOTE_INCOMING: 'onNoteIncoming', NOTE_HIT: 'onNoteHit', NOTE_MISS: 'onNoteMiss', NOTE_HOLD_DROP: 'onNoteHoldDrop',
    SONG_BEAT_HIT: 'onBeatHit', SONG_STEP_HIT: 'onStepHit', NOTE_GHOST_MISS: 'onNoteGhostMiss', SONG_START: 'onSongStart',
    SONG_END: 'onSongEnd', SONG_RETRY: 'onSongRetry', GAME_OVER: 'onGameOver', PAUSE: 'onPause', RESUME: 'onResume',
    SONG_EVENT: 'onSongEvent', COUNTDOWN_START: 'onCountdownStart', COUNTDOWN_STEP: 'onCountdownStep', COUNTDOWN_END: 'onCountdownEnd',
    SONG_LOADED: 'onSongLoaded',
  };
  const ScriptEventDispatcher = {
    callEvent(target, event) {
      if (target == null || event == null) return;
      if (typeof target.__callEvent === 'function') { target.__callEvent(event); return; }   // adaptador (script .hxc)
      if (typeof target.onScriptEvent === 'function') target.onScriptEvent(event);
      if (!event.shouldPropagate) return;
      const m = METHOD[event.type];
      if (m && typeof target[m] === 'function') target[m](event);
    },
  };

  /* ---------- funkin.data.song.SongData.SongEventData (getters como en el código) ---------- */
  const fieldOf = (value, key) => (value != null && typeof value === 'object' && !Array.isArray(value)) ? value[key] : undefined;
  class SongEventData {
    constructor(time, eventKind, value) { this.time = +time || 0; this.eventKind = String(eventKind); this.value = value === undefined ? null : value; this.activated = false; this.__host = 'SongEventData'; this.__open = true; }
    get t() { return this.time; } get e() { return this.eventKind; } get v() { return this.value; }
    get stepTime() { return VS.conductor ? VS.conductor.getTimeInSteps(this.time) : 0; }
    valueAsStruct(defaultKey = 'key') {
      if (this.value == null) return {};
      if (Array.isArray(this.value)) { const r = {}; r[defaultKey] = this.value; return r; }
      if (typeof this.value === 'object') return this.value;
      const r = {}; r[defaultKey] = this.value; return r;
    }
    getDynamic(k) { const v = fieldOf(this.value, k); return v === undefined ? null : v; }
    getBool(k) { const v = fieldOf(this.value, k); return v == null ? null : v; }
    getInt(k) {
      const v = fieldOf(this.value, k); if (v == null) return null;
      if (typeof v === 'number') return v;   // cast: un Float queda Float
      if (typeof v === 'string') { const n = parseInt(v); return Number.isNaN(n) ? null : n; }   // Std.parseInt
      return v;
    }
    getFloat(k) {
      const v = fieldOf(this.value, k); if (v == null) return null;
      if (typeof v === 'number') return v;
      if (typeof v === 'string') return parseFloat(v);   // Std.parseFloat → NaN si no es número
      return v;
    }
    getString(k) { const v = fieldOf(this.value, k); return v == null ? null : v; }
    getArray(k) { const v = fieldOf(this.value, k); return v == null ? null : v; }
    getBoolArray(k) { return this.getArray(k); } getIntArray(k) { return this.getArray(k); } getFloatArray(k) { return this.getArray(k); } getStringArray(k) { return this.getArray(k); }
    getHandler() { return SongEventRegistry.getEvent(this.eventKind); }
    getSchema() { const h = this.getHandler(); return h ? h.getEventSchema() : null; }
    getTitle() { const h = this.getHandler(); return h ? h.getTitle() : 'Unknown Event'; }
    toString() { return `SongEventData(${this.time}ms, ${this.eventKind}: ${JSON.stringify(this.value)})`; }
  }

  /* ---------- funkin.play.event.SongEvent + eventos de play/event/*.hx ---------- */
  const DEFAULT_EASE = 'linear', DEFAULT_EASE_DIR = 'In';
  class SongEvent {
    constructor(id, opts) { this.id = id; this.processOldEvents = !!(opts && opts.processOldEvents); this.__host = 'SongEvent'; }
    handleEvent(data) { throw new Error(`SongEvent.handleEvent() must be overridden! (${this.id})`); }
    precache() {}
    getEventSchema() { return null; }
    getTitle() { return this.id.charAt(0).toUpperCase() + this.id.slice(1); }
    toString() { return `SongEvent(${this.id})`; }
  }
  const P = () => VS.play;
  const stepSec = duration => P().conductor.stepLengthMs * duration / C.MS_PER_SEC;

  class FocusCameraSongEvent extends SongEvent {
    constructor() { super('FocusCamera', { processOldEvents: true }); }
    handleEvent(data) {
      const ps = P(); if (ps == null || ps.currentStage == null) return;
      if (ps.isMinimalMode) return;
      let posX = data.getFloat('x'); if (posX == null) posX = 0;
      let posY = data.getFloat('y'); if (posY == null) posY = 0;
      let char = data.getInt('char'); if (char == null) char = data.value; if (char == null) char = 0;
      let duration = data.getFloat('duration'); if (duration == null) duration = 4.0;
      let ease = data.getString('ease'); if (ease == null) ease = 'CLASSIC';
      let easeDir = data.getString('easeDir') ?? DEFAULT_EASE_DIR;
      if (EASE_TYPE_DIR_REGEX.test(ease) || ease === 'linear') easeDir = '';
      const st = ps.currentStage; let targetX = posX, targetY = posY;
      switch (char) {
        case -1: break;
        case 0: { const c = st.getBoyfriend(); if (c == null) return; targetX += c.cameraFocusPoint.x; targetY += c.cameraFocusPoint.y; break; }
        case 1: { const c = st.getDad(); if (c == null) return; targetX += c.cameraFocusPoint.x; targetY += c.cameraFocusPoint.y; break; }
        case 2: { const c = st.getGirlfriend(); if (c == null) return; targetX += c.cameraFocusPoint.x; targetY += c.cameraFocusPoint.y; break; }
        default: break;
      }
      switch (ease) {
        case 'CLASSIC': ps.resetCamera(false, false, false); ps.cancelCameraFollowTween(); ps.cameraFollowPoint.setPosition(targetX, targetY); break;
        case 'INSTANT': ps.tweenCameraToPosition(targetX, targetY, 0); break;
        default: {
          const durSeconds = stepSec(duration), fn = FlxEase[`${ease}${easeDir}`];
          if (typeof fn !== 'function') { ps.warn(`Invalid ease function: ${ease}${easeDir}`); return; }
          ps.tweenCameraToPosition(targetX, targetY, durSeconds, fn);
        }
      }
    }
    getTitle() { return 'Focus Camera'; }
    getEventSchema() { return [{ name: 'char', title: 'Target', defaultValue: 0, type: 'enum', keys: { Position: -1, Player: 0, Opponent: 1, Girlfriend: 2 } }, { name: 'x', title: 'X Position', defaultValue: 0, step: 10.0, type: 'float', units: 'px' }, { name: 'y', title: 'Y Position', defaultValue: 0, step: 10.0, type: 'float', units: 'px' }, { name: 'duration', title: 'Duration', defaultValue: 4.0, step: 0.5, type: 'float', units: 'steps' }, { name: 'ease', title: 'Easing Type', defaultValue: 'linear', type: 'enum' }, { name: 'easeDir', title: 'Easing Direction', defaultValue: 'In', type: 'enum' }]; }
  }
  class ZoomCameraSongEvent extends SongEvent {
    constructor() { super('ZoomCamera', { processOldEvents: true }); }
    handleEvent(data) {
      const ps = P(); if (ps == null || ps.currentStage == null) return;
      if (ps.isMinimalMode) return;
      const zoom = data.getFloat('zoom') ?? 1.0;
      const sx = data.getFloat('widescreenScaleX') ?? 0.0, sy = data.getFloat('widescreenScaleY') ?? 0.0;
      const ws = ps.wideScale || { x: 1, y: 1 };
      const scaledZoom = zoom + (zoom * ((ws.x - 1) * sx + (ws.y - 1) * sy));
      const duration = data.getFloat('duration') ?? 4.0;
      const mode = data.getString('mode') ?? 'direct', isDirectMode = mode === 'direct';
      const ease = data.getString('ease') ?? DEFAULT_EASE;
      let easeDir = data.getString('easeDir') ?? DEFAULT_EASE_DIR;
      if (EASE_TYPE_DIR_REGEX.test(ease) || ease === 'linear') easeDir = '';
      switch (ease) {
        case 'INSTANT': ps.tweenCameraZoom(scaledZoom, 0, isDirectMode); break;
        default: {
          const durSeconds = stepSec(duration), fn = FlxEase[`${ease}${easeDir}`];
          if (typeof fn !== 'function') { ps.warn(`Invalid ease function: ${ease}${easeDir}`); return; }
          ps.tweenCameraZoom(scaledZoom, durSeconds, isDirectMode, fn);
        }
      }
    }
    getTitle() { return 'Zoom Camera'; }
    getEventSchema() { return [{ name: 'zoom', title: 'Zoom Level', defaultValue: 1.0, step: 0.05, type: 'float', units: 'x' }, { name: 'duration', title: 'Duration', defaultValue: 4.0, step: 0.5, type: 'float', units: 'steps' }, { name: 'mode', title: 'Mode', defaultValue: 'direct', type: 'enum', keys: { Stage: 'stage', Direct: 'direct' } }, { name: 'ease', title: 'Easing Type', defaultValue: 'linear', type: 'enum' }, { name: 'easeDir', title: 'Easing Direction', defaultValue: 'In', type: 'enum' }]; }
  }
  class SetCameraBopSongEvent extends SongEvent {
    constructor() { super('SetCameraBop', { processOldEvents: true }); }
    handleEvent(data) {
      const ps = P(); if (ps == null) return;
      if (ps.isMinimalMode) return;
      const rate = data.getInt('rate') ?? C.DEFAULT_ZOOM_RATE;
      const offset = data.getInt('offset') ?? C.DEFAULT_ZOOM_OFFSET;
      const intensity = data.getFloat('intensity') ?? 1.0;
      ps.cameraBopIntensity = (C.DEFAULT_BOP_INTENSITY - 1.0) * intensity + 1.0;
      ps.hudCameraZoomIntensity = (C.DEFAULT_BOP_INTENSITY - 1.0) * intensity * 2.0;
      ps.cameraZoomRate = rate;
      ps.cameraZoomRateOffset = offset;
    }
    getTitle() { return 'Set Camera Bop'; }
    getEventSchema() { return [{ name: 'intensity', title: 'Intensity', defaultValue: 1.0, step: 0.1, type: 'float', units: 'x' }, { name: 'rate', title: 'Rate', defaultValue: 4, step: 1, type: 'int', units: 'beats/zoom' }, { name: 'offset', title: 'Offset', defaultValue: 0, step: 1, type: 'int', units: 'beats' }]; }
  }
  class ScrollSpeedEvent extends SongEvent {
    constructor() { super('ScrollSpeed', { processOldEvents: true }); }
    handleEvent(data) {
      const ps = P(); if (ps == null) return;
      let scroll = data.getFloat('scroll') ?? 1;
      const duration = data.getFloat('duration') ?? 4.0;
      const ease = data.getString('ease') ?? DEFAULT_EASE;
      let easeDir = data.getString('easeDir') ?? DEFAULT_EASE_DIR;
      if (EASE_TYPE_DIR_REGEX.test(ease) || ease === 'linear') easeDir = '';
      const strumline = data.getString('strumline') ?? 'both';
      const absolute = data.getBool('absolute') ?? false;
      if (!absolute) scroll = scroll * (ps.chartScrollSpeed ?? 1.0);
      const names = strumline === 'both' ? ['playerStrumline', 'opponentStrumline'] : [strumline + 'Strumline'];
      switch (ease) {
        case 'INSTANT': ps.tweenScrollSpeed(scroll, 0, null, names); break;
        default: {
          const durSeconds = stepSec(duration), fn = FlxEase[`${ease}${easeDir}`];
          if (typeof fn !== 'function') { ps.warn(`Invalid ease function: ${ease}${easeDir}`); return; }
          ps.tweenScrollSpeed(scroll, durSeconds, fn, names);
        }
      }
    }
    getTitle() { return 'Scroll Speed'; }
    getEventSchema() { return [{ name: 'scroll', title: 'Target Value', defaultValue: 1.0, step: 0.1, type: 'float', units: 'x' }, { name: 'duration', title: 'Duration', defaultValue: 4.0, step: 0.5, type: 'float', units: 'steps' }, { name: 'ease', title: 'Easing Type', defaultValue: 'linear', type: 'enum' }, { name: 'easeDir', title: 'Easing Direction', defaultValue: 'In', type: 'enum' }, { name: 'strumline', title: 'Target Strumlines', defaultValue: 'both', type: 'enum', keys: { Both: 'both', Player: 'player', Opponent: 'opponent' } }, { name: 'absolute', title: 'Absolute', defaultValue: false, type: 'bool' }]; }
  }
  class SetTargetBopSpeedSongEvent extends SongEvent {
    constructor() { super('SetTargetBopSpeed', { processOldEvents: false }); }
    handleEvent(data) {
      const ps = P(); if (ps == null || ps.currentStage == null) return;
      const st = ps.currentStage;
      const targetName = data.getString('target') ?? 'boyfriend';
      const rate = data.getFloat('rate') ?? C.DEFAULT_PROP_RATE;
      let target = null;
      switch (targetName) {
        case 'boyfriend': case 'bf': case 'player': target = st.getBoyfriend(); break;
        case 'dad': case 'opponent': target = st.getDad(); break;
        case 'girlfriend': case 'gf': target = st.getGirlfriend(); break;
        default: target = st.getNamedProp ? st.getNamedProp(targetName) : null;
      }
      if (target == null) return;
      if (target.isCharacter || target.isBopper) target.danceEvery = rate;
    }
    getTitle() { return 'Set Target Bop Speed'; }
    getEventSchema() { return [{ name: 'target', title: 'Target', type: 'string', defaultValue: 'boyfriend' }, { name: 'rate', title: 'Bop Rate', defaultValue: 1.0, step: 0.25, type: 'float', units: 'beats/bop' }]; }
  }
  class PlayAnimationSongEvent extends SongEvent {
    constructor() { super('PlayAnimation', { processOldEvents: false }); }
    handleEvent(data) {
      const ps = P(); if (ps == null || ps.currentStage == null) return;
      const targetName = data.getString('target') ?? 'boyfriend', anim = data.getString('anim') ?? 'idle', force = data.getBool('force') ?? false;
      const st = ps.currentStage; let target = null;
      switch (targetName) {
        case 'boyfriend': case 'bf': case 'player': target = st.getBoyfriend(); break;
        case 'dad': case 'opponent': target = st.getDad(); break;
        case 'girlfriend': case 'gf': target = st.getGirlfriend(); break;
        default: target = st.getNamedProp ? st.getNamedProp(targetName) : null;
      }
      if (target == null) return;
      if (target.isCharacter) { target.tempVocals = force; target.playAnimation(anim, force, force); }
      else target.playPropAnimation(anim, force);
    }
    getTitle() { return 'Play Animation'; }
    getEventSchema() { return [{ name: 'target', title: 'Target', type: 'string', defaultValue: 'boyfriend' }, { name: 'anim', title: 'Animation', type: 'string', defaultValue: 'idle' }, { name: 'force', title: 'Force', type: 'bool', defaultValue: false }]; }
  }
  class SetHealthIconSongEvent extends SongEvent {
    constructor() { super('SetHealthIcon', { processOldEvents: true }); }
    handleEvent(data) {
      const ps = P(); if (ps == null) return;
      const offsets = [data.value?.offsetX ?? 0.0, data.value?.offsetY ?? 0.0];
      const v = data.value || {};
      const iconData = { id: v.id ?? C.DEFAULT_HEALTH_ICON, scale: v.scale ?? 1.0, flipX: v.flipX ?? false, isPixel: v.isPixel ?? false, offsets };
      switch (v.char ?? 0) {
        case 0: ps.setHealthIcon(0, iconData, v.shouldBop ?? true); break;
        case 1: ps.setHealthIcon(1, iconData, v.shouldBop ?? true); break;
        default: ps.warn('Unknown character index: ' + data.value?.char);
      }
    }
    getTitle() { return 'Set Health Icon'; }
    getEventSchema() { return [{ name: 'char', title: 'Character', defaultValue: 0, type: 'enum', keys: { Player: 0, Opponent: 1 } }, { name: 'id', title: 'Health Icon ID', defaultValue: 'bf', type: 'string' }, { name: 'scale', title: 'Scale', defaultValue: 1.0, type: 'float' }, { name: 'flipX', title: 'Flip X?', defaultValue: false, type: 'bool' }, { name: 'isPixel', title: 'Is Pixel?', defaultValue: false, type: 'bool' }, { name: 'offsetX', title: 'X Offset', defaultValue: 0, type: 'float' }, { name: 'offsetY', title: 'Y Offset', defaultValue: 0, type: 'float' }]; }
  }

  /* ---------- funkin.data.event.SongEventRegistry ---------- */
  const SongEventRegistry = {
    eventCache: new Map(), nextEventIndex: 0, allEventHandlers: [],
    registerBaseEvents() {
      for (const E of [FocusCameraSongEvent, ZoomCameraSongEvent, SetCameraBopSongEvent, ScrollSpeedEvent, SetTargetBopSpeedSongEvent, PlayAnimationSongEvent, SetHealthIconSongEvent]) { const e = new E(); this.eventCache.set(e.id, e); }
    },
    register(ev) { this.eventCache.set(ev.id, ev); },
    unregister(id) { this.eventCache.delete(id); if (!this.builtinIds.has(id)) { /* vuelve el integrado si lo había */ } },
    builtinIds: new Set(['FocusCamera', 'ZoomCamera', 'SetCameraBop', 'ScrollSpeed', 'SetTargetBopSpeed', 'PlayAnimation', 'SetHealthIcon']),
    listEventIds() { return [...this.eventCache.keys()]; },
    getEvent(id) { return this.eventCache.get(id) || null; },
    getEventSchema(id) { const e = this.getEvent(id); return e ? e.getEventSchema() : null; },
    handleEvent(data) {
      const h = this.getEvent(data.eventKind);
      if (h != null) h.handleEvent(data);
      else if (VS.play) VS.play.warn(`WARNING: No event handler for event with kind: ${data.eventKind}`);
      data.activated = true;
    },
    queryEvents(events, currentTime, startIndex) {
      startIndex = startIndex ?? this.nextEventIndex;
      const result = [];
      for (let i = startIndex; i < events.length; i++) {
        if (events[i].activated) continue;
        if (events[i].time > currentTime) { this.nextEventIndex = i; return result; }
        result.push(events[i]);
      }
      return result;
    },
    handleSkippedEvents(events, currentTime) {
      for (const e of events) { if (e.time > currentTime) e.activated = false; if (e.time < currentTime) e.activated = true; }
    },
    resetEvents(events) {
      events.sort((a, b) => a.time - b.time);   // SortUtil.eventDataByTime (orden estable)
      this.nextEventIndex = 0; this.allEventHandlers.length = 0;
      for (const e of events) { e.activated = false; const h = this.getEvent(e.eventKind); if (h != null && !this.allEventHandlers.includes(h)) this.allEventHandlers.push(h); }
    },
    callEvent(scriptEvent) { const a = this.allEventHandlers; for (let i = 0, n = a.length; i < n; i++) ScriptEventDispatcher.callEvent(a[i], scriptEvent); },
  };
  SongEventRegistry.registerBaseEvents();

  /* ---------- funkin.play.notes.notekind ---------- */
  class NoteKind {
    constructor(noteKind, description = '', noteStyleId = null, params = null, noanim = null, suffix = null) {
      this.noteKind = noteKind; this.description = description; this.noteStyleId = noteStyleId ?? null; this.params = params ?? [];
      this.noanim = noanim ?? false; this.suffix = suffix ?? ''; this.scoreable = true; this.__host = 'NoteKind';
    }
    toString() { return this.noteKind; }
    onScriptEvent(e) {} onCreate(e) {} onDestroy(e) {} onUpdate(e) {} onNoteIncoming(e) {} onNoteHit(e) {} onNoteMiss(e) {} onNoteHoldDrop(e) {}
  }
  class NoAnimNoteKind extends NoteKind { constructor() { super('noanim', 'No Animation', null, null, true); } }
  class NonScoreableNoteKind extends NoteKind {
    constructor() { super('non_scoreable', 'Non-scoreable'); this.scoreable = false; }
    onNoteMiss(event) { event.note.visible = false; event.cancel(); }
  }
  const NoteKindManager = {
    noteKinds: new Map(), fallbacks: new Map(),
    initialize() { this.noteKinds.clear(); this.registerBaseNoteKinds(); },
    registerBaseNoteKinds() { for (const K of [NoAnimNoteKind, NonScoreableNoteKind]) { const k = new K(); this.noteKinds.set(k.noteKind, k); } },
    register(kind) { this.noteKinds.set(kind.noteKind, kind); },
    unregister(id) { this.noteKinds.delete(id); if (id === 'noanim' || id === 'non_scoreable') this.registerBaseNoteKinds(); },
    /* tipos del juego base cuyo script no está cargado (alt, hey, ugh…): imitación, solo si no hay script */
    getNoteKind(id) { if (id == null) return null; return this.noteKinds.get(id) || this.fallbacks.get(id) || null; },
    listNoteKinds() { return [...this.noteKinds.keys()]; },
    callEvent(event) {
      if (event instanceof NoteScriptEvent) {
        const k = this.getNoteKind(event.note != null ? event.note.kind : null);
        if (k != null) ScriptEventDispatcher.callEvent(k, event);
      } else for (const k of this.noteKinds.values()) ScriptEventDispatcher.callEvent(k, event);
    },
    getNoteStyleId(noteKind, suffix, hasStyle) {
      if (suffix === '') suffix = null;
      let id = this.getNoteKind(noteKind)?.noteStyleId ?? null;
      if (id != null && suffix != null) id = (hasStyle && hasStyle(`${id}-${suffix}`)) ? `${id}-${suffix}` : id;
      return id;
    },
    getParams(noteKind) { if (noteKind == null) return []; return this.getNoteKind(noteKind)?.params ?? []; },
  };
  NoteKindManager.initialize();

  /* ---------- Bopper + BaseCharacter (reglas de animación) ----------
     Se mezcla en los personajes (personajes.js) y en los de prueba. Necesita: this.animation (AnimController),
     this.characterType ('BF' | 'DAD' | 'GF' | 'OTHER'), this.singTimeSteps, this.danceEvery, this.ignoreExclusionPref. */
  const DIRS = ['LEFT', 'DOWN', 'UP', 'RIGHT'];
  const BaseCharacterMixin = {
    initCharacterState() {
      this.holdTimer = 0; this.hasDanced = false; this.shouldAlternate = null; this.canPlayOtherAnims = true; this.tempVocals = false;
      this._idleSuffix = ''; this.shouldBop = false; this.isDead = false; this.isCharacter = true;
      this.dropNoteCounts = [...this.animation.anims.keys()].filter(k => /^drop\d+$/.test(k)).map(k => +k.slice(4)).sort((a, b) => a - b);
    },
    get idleSuffix() { return this._idleSuffix; },
    set idleSuffix(v) { this._idleSuffix = v; this.dance(); },
    getCurrentAnimation() { return this.animation.curAnim ? this.animation.curAnim.name : ''; },
    hasAnimation(n) { return this.animation.exists(n); },
    isAnimationFinished() { return this.animation.finished; },
    isSinging() { const a = this.getCurrentAnimation(); return a.startsWith('sing') && !a.endsWith(C.ANIMATION_END_SUFFIX); },
    update_shouldAlternate() { this.shouldAlternate = this.hasAnimation('danceLeft'); },
    correctAnimationName(name, fallback) {
      if (this.hasAnimation(name)) return name;
      if (name.lastIndexOf('-') !== -1) return this.correctAnimationName(name.substring(0, name.lastIndexOf('-')));
      if (fallback != null) { if (fallback === name) return null; return this.correctAnimationName('idle'); }
      return null;
    },
    /* Bopper.playAnimation + BaseCharacter.playAnimation (tempVocals) */
    playAnimation(name, restart = false, ignoreOther = false) {
      if (this.tempVocals && this.vocals) {
        if (this.characterType === 'BF' && this.vocals.playerVolume === 0) this.vocals.playerVolume = 1;
        else if (this.characterType === 'DAD' && this.vocals.opponentVolume === 0) this.vocals.opponentVolume = 1;
        else if (this.characterType !== 'BF' || this.characterType !== 'DAD') this.tempVocals = false;
      }
      if (!this.canPlayOtherAnims) {
        const id = name;
        if (this.getCurrentAnimation() === id && restart) { /* se permite reiniciar la misma */ }
        else if (this.ignoreExclusionPref != null && this.ignoreExclusionPref.length > 0) {
          let detected = false; for (const e of this.ignoreExclusionPref) if (id.startsWith(e)) { detected = true; break; }
          if (!detected) return;
        } else return;
      }
      const correct = this.correctAnimationName(name); if (correct == null) return;
      this.animation.play(correct, restart, 0);
      if (ignoreOther) this.canPlayOtherAnims = false;
      if (this.onAnimationPlayed) this.onAnimationPlayed(correct);
    },
    /* Bopper.dance + BaseCharacter.dance */
    dance(force = false) {
      if (this.isCharacter) {
        if (this.isDead) return;
        if (!force) {
          if (this.isSinging()) return;
          const cur = this.getCurrentAnimation();
          if (!cur.startsWith('dance') && !cur.startsWith('idle') && !this.isAnimationFinished()) return;
        }
      }
      if (this.shouldAlternate == null) this.update_shouldAlternate();
      if (this.shouldAlternate) { this.playAnimation(this.hasDanced ? `danceRight${this._idleSuffix}` : `danceLeft${this._idleSuffix}`, force); this.hasDanced = !this.hasDanced; }
      else this.playAnimation(`idle${this._idleSuffix}`, force);
    },
    /* Bopper.onStepHit */
    onStepHit(event) { if (this.danceEvery > 0 && (event.step % (this.danceEvery * C.STEPS_PER_BEAT)) === 0) this.dance(this.shouldBop); },
    onBeatHit(event) {},
    /* Bopper.onAnimationFinished + BaseCharacter.onAnimationFinished (lo llama AnimController) */
    onAnimationFinished(name) {
      if (!this.canPlayOtherAnims) this.canPlayOtherAnims = true;
      if (!this.isCharacter) return;
      if ((name.endsWith(C.ANIMATION_END_SUFFIX) && !name.startsWith('idle') && !name.startsWith('dance')) || name.startsWith('combo') || name.startsWith('drop')) this.dance(true);
      if (this.tempVocals && this.vocals) {
        if (this.characterType === 'BF' && this.vocals.playerVolume === 1) this.vocals.playerVolume = 0;
        if (this.characterType === 'DAD' && this.vocals.opponentVolume === 1) this.vocals.opponentVolume = 0;
        this.tempVocals = false;
      }
    },
    /* BaseCharacter.onUpdate (UpdateScriptEvent; las animaciones ya avanzaron en el update de los miembros) */
    onUpdate(event) {
      const input = this.inputState ? this.inputState() : { justPressed: false, holding: false };
      if (input.justPressed && this.characterType === 'BF') this.holdTimer = 0;
      if (this.isDead) return;
      if (this.isAnimationFinished() && !this.getCurrentAnimation().endsWith(C.ANIMATION_HOLD_SUFFIX) && this.hasAnimation(this.getCurrentAnimation() + C.ANIMATION_HOLD_SUFFIX))
        this.playAnimation(this.getCurrentAnimation() + C.ANIMATION_HOLD_SUFFIX);
      if (this.isSinging()) {
        this.holdTimer += event.elapsed;
        let singTimeSec = this.singTimeSteps * (this.conductor().stepLengthMs / C.MS_PER_SEC);
        if (this.getCurrentAnimation().endsWith('miss')) singTimeSec *= 2;
        const shouldStopSinging = this.characterType === 'BF' ? !input.holding : true;
        if (this.holdTimer > singTimeSec && shouldStopSinging) {
          this.holdTimer = 0;
          let cur = this.getCurrentAnimation();
          if (cur.endsWith(C.ANIMATION_HOLD_SUFFIX)) cur = cur.substring(0, cur.length - C.ANIMATION_HOLD_SUFFIX.length);
          const endAnimation = cur + C.ANIMATION_END_SUFFIX;
          if (this.hasAnimation(endAnimation)) this.playAnimation(endAnimation);
          else this.dance(true);
        }
      } else this.holdTimer = 0;
    },
    playSingAnimation(dir, miss = false, suffix = '') {
      const anim = `sing${DIRS[dir]}${miss ? 'miss' : ''}${suffix !== '' ? `-${suffix}` : ''}`;
      this.playAnimation(anim, true);
    },
    playComboAnimation(comboCount) { const a = `combo${comboCount}`; if (this.hasAnimation(a)) this.playAnimation(a, true, true); },
    playComboDropAnimation(comboCount) { let d = null; for (const c of this.dropNoteCounts) if (comboCount >= c) d = `drop${c}`; if (d != null) this.playAnimation(d, true, true); },
    onNoteHit(event) {
      if (event.eventCanceled) return;
      const nd = event.note.noteData, kind = NoteKindManager.getNoteKind(nd.kind);
      this.curNoteKind = kind;
      if ((nd.getMustHitNote() && this.characterType === 'BF') || (!nd.getMustHitNote() && this.characterType === 'DAD')) {
        if (kind != null) { if (!kind.noanim) { this.playSingAnimation(nd.getDirection(), false, kind.suffix ?? 'null'); this.holdTimer = 0; } }
        else { this.playSingAnimation(nd.getDirection(), false, this.defaultSingSuffix ? this.defaultSingSuffix() : ''); this.holdTimer = 0; }
      } else if (this.characterType === 'GF' && nd.getMustHitNote()) {
        if (event.judgement === 'sick' || event.judgement === 'good') this.playComboAnimation(event.comboCount);
        else this.playComboDropAnimation(event.comboCount);
      }
    },
    onNoteMiss(event) {
      if (event.eventCanceled) return;
      const nd = event.note.noteData;
      if (nd.getMustHitNote() && this.characterType === 'BF') this.playSingAnimation(nd.getDirection(), true);
      else if (!nd.getMustHitNote() && this.characterType === 'DAD') this.playSingAnimation(nd.getDirection(), true);
      else if (nd.getMustHitNote() && this.characterType === 'GF') this.playComboDropAnimation(event.comboCount);
    },
    onNoteHoldDrop(event) {
      if (event.eventCanceled) return;
      const nd = event.holdNote.noteData;
      if (nd.getMustHitNote() && this.characterType === 'BF') this.playSingAnimation(nd.getDirection(), true);
      else if (!nd.getMustHitNote() && this.characterType === 'DAD') this.playSingAnimation(nd.getDirection(), true);
      else if (nd.getMustHitNote() && event.isComboBreak && this.characterType === 'GF') this.playComboDropAnimation(event.comboCount);
    },
    onNoteGhostMiss(event) {
      if (event.eventCanceled || !event.playAnim) return;
      if (this.characterType === 'BF') this.playSingAnimation(event.dir, true);
    },
    onScriptEvent(e) {}, onSongRetry(e) {}, onSongEvent(e) {}, onSongStart(e) {}, onSongEnd(e) {}, onGameOver(e) {}, onPause(e) {}, onResume(e) {},
    onCountdownStart(e) {}, onCountdownStep(e) {}, onCountdownEnd(e) {}, onSongLoaded(e) {}, onNoteIncoming(e) {}, onCreate(e) {}, onDestroy(e) {},
  };
  function mixCharacter(proto) {
    for (const k of Object.getOwnPropertyNames(BaseCharacterMixin)) Object.defineProperty(proto, k, Object.getOwnPropertyDescriptor(BaseCharacterMixin, k));
  }

  /* ---------- Scoring.hx (PBOT1) ---------- */
  const Scoring = {
    PBOT1_MAX_SCORE: 500, PBOT1_SCORING_OFFSET: 54.99, PBOT1_SCORING_SLOPE: 0.080, PBOT1_MIN_SCORE: 9.0, PBOT1_MISS_SCORE: -100, PBOT1_PERFECT_THRESHOLD: 5.0,
    PBOT1_KILLER_THRESHOLD: 12.5, PBOT1_SICK_THRESHOLD: 45.0, PBOT1_GOOD_THRESHOLD: 90.0, PBOT1_BAD_THRESHOLD: 135.0, PBOT1_SHIT_THRESHOLD: 160.0,
    scoreNote(msTiming) {
      const absTiming = Math.abs(msTiming);
      if (absTiming > this.PBOT1_SHIT_THRESHOLD) return this.PBOT1_MISS_SCORE;
      if (absTiming < this.PBOT1_PERFECT_THRESHOLD) return this.PBOT1_MAX_SCORE;
      const factor = 1.0 - (1.0 / (1.0 + Math.exp(-this.PBOT1_SCORING_SLOPE * (absTiming - this.PBOT1_SCORING_OFFSET))));
      return Math.trunc(this.PBOT1_MAX_SCORE * factor + this.PBOT1_MIN_SCORE);
    },
    judgeNote(msTiming) {
      const a = Math.abs(msTiming);
      if (a <= this.PBOT1_SICK_THRESHOLD) return 'sick';
      if (a <= this.PBOT1_GOOD_THRESHOLD) return 'good';
      if (a <= this.PBOT1_BAD_THRESHOLD) return 'bad';
      if (a <= this.PBOT1_SHIT_THRESHOLD) return 'shit';
      return 'miss';
    },
    getMissScore() { return this.PBOT1_MISS_SCORE; },
  };

  /* SongNoteData (la vista que ven los scripts: note.noteData) */
  function makeNoteData(n) {
    const par = k => { for (const p of (Array.isArray(n.params) ? n.params : [])) if (p && (p.name ?? p.n) === k) return p.value ?? p.v; return null; };
    return { __host: 'SongNoteData', __open: true, get time() { return n.time; }, get data() { return n.raw ?? (n.side === 'player' ? n.lane : n.lane + 4); }, get length() { return n.sustain; },
      get kind() { return n.kind || null; }, get params() { return n.params || []; }, getDirection: () => n.lane, getMustHitNote: () => n.side === 'player',
      getStrumlineIndex: () => (n.side === 'player' ? 0 : 1), getParam: par, getFloat: k => { const v = par(k); return v == null ? null : +v; }, getInt: k => { const v = par(k); return v == null ? null : parseInt(v); },
      getString: k => { const v = par(k); return v == null ? null : String(v); }, getBool: k => { const v = par(k); return v == null ? null : v; }, toString: () => `SongNoteData(${n.time}ms, ${n.lane}, ${n.kind || ''})` };
  }

  /* ---------- PlayState (la parte que tocan los eventos y los note kinds) ----------
     host: { stage, modules(), song, stageScript, vocals, keys, fx…, warn } — ver game.js y TestSong-qa/paridad */
  function compactDead(a) { let j = 0; for (let i = 0; i < a.length; i++) { const x = a[i]; if (x.alive) a[j++] = x; } a.length = j; }
  class PlayCore {
    constructor(host) {
      this.host = host || {};
      this.tweens = new FlxTweenManager();
      this.conductor = new Conductor();
      this.camera = new FlxCamera(1280, 720);
      const fp = { x: 0, y: 0, width: 0, height: 0, setPosition(x, y) { this.x = x; this.y = y; }, getPosition() { return { x: this.x, y: this.y }; } };
      this.cameraFollowPoint = fp;
      this.camHUD = { zoom: 1 };
      this.defaultHUDCameraZoom = 1.0; this.stageZoom = 1.05; this.currentCameraZoom = 1.0; this.cameraBopMultiplier = 1.0;
      this.cameraBopIntensity = C.DEFAULT_BOP_INTENSITY; this.hudCameraZoomIntensity = (C.DEFAULT_BOP_INTENSITY - 1.0) * 2.0;
      this.cameraZoomRate = C.DEFAULT_ZOOM_RATE; this.cameraZoomRateOffset = C.DEFAULT_ZOOM_OFFSET;
      this.cameraFollowTween = null; this.cameraZoomTween = null; this.scrollSpeedTweens = []; this.prevScrollTargets = [];
      this.playbackRate = 1.0; this.isMinimalMode = false; this.isBotPlayMode = false; this.isPracticeMode = false; this.ghostTappingFeature = false;
      this.zoomCameraPref = true; this.wideScale = { x: 1, y: 1 };
      this.health = C.HEALTH_STARTING; this.songScore = 0;
      this.tallies = { sick: 0, good: 0, bad: 0, shit: 0, missed: 0, combo: 0, maxCombo: 0, totalNotesHit: 0, totalNotes: 0 };
      this.chartScrollSpeed = 1.0;
      this.playerStrumline = this.makeStrumline(true); this.opponentStrumline = this.makeStrumline(false);
      this.songEvents = []; this.notes = [];
      this.inputPressQueue = []; this.inputReleaseQueue = [];
      this.startTimestamp = 0; this.startingSong = true; this.isInCountdown = false;
      this.currentStage = null; this.subState = null;
      this.conductor.onStepHit = () => this.stepHit();
      this.conductor.onBeatHit = () => this.beatHit();
      this.log = [];
    }
    warn(m) { if (this.host.warn) this.host.warn(m); }
    makeStrumline(isPlayer) {
      return { isPlayer, scrollSpeed: 1.0, notes: [], holdNotes: [], nextNoteIndex: 0, _sweep: 0, noteData: [], ghostTapTimer: 0, keysHeld: [false, false, false, false] };
    }

    /* ----- cámara ----- */
    resetCamera(resetZoom = true, cancelTweens = true, snap = true) {
      if (cancelTweens) this.cancelAllCameraTweens();
      this.camera.follow(this.cameraFollowPoint, C.DEFAULT_CAMERA_FOLLOW_RATE);
      this.camera.targetOffset.x = 0; this.camera.targetOffset.y = 0;
      if (this.subState != null) this.camera.followLerp = 0;
      if (resetZoom) this.resetCameraZoom();
      if (snap) this.camera.focusOn(this.cameraFollowPoint.getPosition());
    }
    resetCameraZoom() {
      if (this.isMinimalMode) return;
      this.currentCameraZoom = this.stageZoom; this.camera.zoom = this.currentCameraZoom; this.cameraBopMultiplier = 1.0;
    }
    tweenCameraToPosition(x = 0, y = 0, duration = 0, ease = null) { this.cameraFollowPoint.setPosition(x, y); this.tweenCameraToFollowPoint(duration, ease); }
    tweenCameraToFollowPoint(duration = 0, ease = null) {
      this.cancelCameraFollowTween();
      if (duration === 0) this.resetCamera(false, false);
      else {
        this.camera.target = null;
        const adjusted = duration / this.playbackRate;
        const fx = this.cameraFollowPoint.x - this.camera.width * 0.5, fy = this.cameraFollowPoint.y - this.camera.height * 0.5;
        this.cameraFollowTween = this.tweens.tween(this.camera.scroll, { x: fx, y: fy }, adjusted, { ease, onComplete: () => this.resetCamera(false, false) });
      }
    }
    cancelCameraFollowTween() { if (this.cameraFollowTween != null) this.cameraFollowTween.cancel(); }
    tweenCameraZoom(zoom = 1, duration = 0, direct = false, ease = null) {
      this.cancelCameraZoomTween();
      const targetZoom = zoom * (direct ? 1.0 : this.stageZoom);
      if (duration === 0) this.currentCameraZoom = targetZoom;
      else this.cameraZoomTween = this.tweens.tween(this, { currentCameraZoom: targetZoom }, duration / this.playbackRate, { ease });
    }
    cancelCameraZoomTween() { if (this.cameraZoomTween != null) this.cameraZoomTween.cancel(); }
    cancelAllCameraTweens() { this.cancelCameraFollowTween(); this.cancelCameraZoomTween(); }
    tweenScrollSpeed(speed, duration = 0, ease = null, strumlines = []) {
      this.cancelScrollSpeedTweens();
      for (const [value, name] of this.prevScrollTargets) { const s = this[name]; if (s) s.scrollSpeed = value; }
      this.prevScrollTargets = [];
      for (const name of strumlines) {
        const value = speed ?? 0, s = this[name];
        if (!s) { this.warn(`ScrollSpeed: no existe la strumline "${name}"`); continue; }
        if (duration === 0) s.scrollSpeed = value;
        else this.scrollSpeedTweens.push(this.tweens.tween(s, { scrollSpeed: value }, duration / this.playbackRate, { ease }));
        this.prevScrollTargets.push([value, name]);
      }
    }
    cancelScrollSpeedTweens() { for (const t of this.scrollSpeedTweens) if (t != null) t.cancel(); this.scrollSpeedTweens = []; }
    setHealthIcon(which, data, shouldBop) { if (this.host.setHealthIcon) this.host.setHealthIcon(which, data, shouldBop); }

    /* ----- PlayState.dispatchEvent: Module → Song → Events → Notes → Stage → Conversation → Characters ----- */
    dispatchEvent(event) {
      const h = this.host;
      if (h.modules) for (const m of h.modules()) ScriptEventDispatcher.callEvent(m, event);
      if (h.song) ScriptEventDispatcher.callEvent(h.song, event);
      if (this.songEvents != null && this.songEvents.length > 0) SongEventRegistry.callEvent(event);
      NoteKindManager.callEvent(event);
      if (h.stageScript) ScriptEventDispatcher.callEvent(h.stageScript(), event);
      if (this.currentStage != null) this.dispatchToCharacters(event);
      if (h.afterDispatch) h.afterDispatch(event);     // extra de este motor (registro de pruebas)
    }
    dispatchToCharacters(event) {
      // Stage.dispatchToCharacters: dad, bf, gf y luego los demás (el host da la lista ya en ese orden)
      const st = this.currentStage, list = st.characters ? st.characters() : null; if (!list) return;
      for (let i = 0; i < list.length; i++) ScriptEventDispatcher.callEvent(list[i], event);
    }
    stepHit() {
      if (this.subState != null) return false;
      const event = new SongTimeScriptEvent('SONG_STEP_HIT', this.conductor.currentBeat, this.conductor.currentStep);
      this.dispatchEvent(event);
      if (event.eventCanceled) return false;
      if (this.host.onStepHit) this.host.onStepHit(this.conductor.currentStep);   // iconos
      if (this.zoomCameraPref && this.camHUD.zoom < (1.35 * this.defaultHUDCameraZoom) && this.cameraZoomRate > 0
        && (this.conductor.currentStep + this.cameraZoomRateOffset * C.STEPS_PER_BEAT) % (this.cameraZoomRate * C.STEPS_PER_BEAT) === 0) {
        this.cameraBopMultiplier = this.cameraBopIntensity;
        this.camHUD.zoom += this.hudCameraZoomIntensity * this.defaultHUDCameraZoom;
      }
      return true;
    }
    beatHit() {
      if (this.subState != null) return false;
      const event = new SongTimeScriptEvent('SONG_BEAT_HIT', this.conductor.currentBeat, this.conductor.currentStep);
      this.dispatchEvent(event);
      if (event.eventCanceled) return false;
      if (this.host.onBeatHit) this.host.onBeatHit(this.conductor.currentBeat);
      return true;
    }

    /* ----- eventos de canción ----- */
    setSongEvents(list) {
      this.songEvents = list.map(e => {
        if (e instanceof SongEventData) return e;
        const d = new SongEventData(e.t ?? e.time, e.e ?? e.eventKind, e.v ?? e.value);
        if (e.pe) d.pe = e.pe; if (e.ce) d.ce = e.ce; if (e.psych) d.psych = e.psych;   // datos originales (onEvent de .lua / Codename)
        return d;
      });
      SongEventRegistry.resetEvents(this.songEvents);
    }
    processSongEvents() {
      if (this.songEvents.length > 0) {
        const toActivate = SongEventRegistry.queryEvents(this.songEvents, this.conductor.songPosition);
        for (const ev of toActivate) {
          const eventAge = this.conductor.songPosition - ev.time;
          if (eventAge > 1000) {
            const h = SongEventRegistry.getEvent(ev.eventKind);
            if (h == null || !h.processOldEvents) { ev.activated = true; continue; }
          }
          const e = new SongEventScriptEvent(ev);
          this.dispatchEvent(e);
          if (!e.eventCanceled) SongEventRegistry.handleEvent(ev);
          if (this.host.onEventFired) this.host.onEventFired(ev, e.eventCanceled);
        }
      }
    }

    /* ----- notas (Strumline + NoteSprite + SustainTrail) ----- */
    setNotes(list, scrollSpeed) {
      this.chartScrollSpeed = scrollSpeed ?? 1.0;
      for (const s of [this.playerStrumline, this.opponentStrumline]) { s.noteData = []; s.scrollSpeed = this.chartScrollSpeed; }
      this.notes = list;
      for (const n of list) (n.side === 'player' ? this.playerStrumline : this.opponentStrumline).noteData.push(n);
      this.regenNoteData(this.startTimestamp);
    }
    regenNoteData(startTime = 0) {
      this.tallies.totalNotes = 0;
      for (const s of [this.playerStrumline, this.opponentStrumline]) {
        s.noteData.sort((a, b) => a.time - b.time); s.notes = []; s.holdNotes = []; s.nextNoteIndex = 0; s.ghostTapTimer = 0; s._sweep = 0;
        for (const n of s.noteData) {
          const kind = NoteKindManager.getNoteKind(n.kind);
          const scoreable = kind != null ? kind.scoreable : true;
          if (s.isPlayer && n.time >= startTime && scoreable) this.tallies.totalNotes++;
          this.initNoteSprite(n, s);
        }
      }
      this.setSongEvents(this.songEvents);   // regenNoteData → SongLoadScriptEvent → resetEvents
    }
    initNoteSprite(n, strumline) {
      const kind = NoteKindManager.getNoteKind(n.kind);
      n.alive = false; n.built = false; n.visible = true; n.alpha = 1;
      n.hasBeenHit = false; n.hasMissed = false; n.tooEarly = true; n.mayHit = false; n.handledMiss = false;
      n.lowPriority = false; n.scoreable = kind != null ? kind.scoreable : true; n.strumline = strumline;
      n.holdNoteSprite = null; n.direction = n.lane; n.strumTime = n.time; n.__host = 'NoteSprite'; n.__open = true;
      if (!n.noteData) n.noteData = makeNoteData(n);
      if (!n.getParam) n.getParam = name => { for (const p of (Array.isArray(n.params) ? n.params : [])) if (p && (p.name ?? p.n) === name) return p.value ?? p.v; return null; };
      n.judged = n.hit = n.missed = n.holding = n.dropped = n.passed = n.skipped = false;
    }
    renderDistanceMs(s) { return 720 / C.PIXELS_PER_MS / (s.scrollSpeed < 1 ? s.scrollSpeed : 1); }
    /* Strumline.updateNotes (corre en el update de los miembros, antes de la lógica de PlayState) */
    updateStrumline(s) {
      const pos = this.conductor.songPosition, songStart = this.startTimestamp;
      const hitWindowStart = pos - C.HIT_WINDOW_MS, renderWindowStart = pos + this.renderDistanceMs(s);
      for (let i = s.nextNoteIndex; i < s.noteData.length; i++) {
        const note = s.noteData[i];
        if (note.skipped || note.time < songStart || note.time < hitWindowStart) { note.skipped = note.judged = true; s.nextNoteIndex = i + 1; continue; }
        if (note.time > renderWindowStart) break;
        note.alive = true; note.built = true; s.notes.push(note);
        if (note.sustain > 0) {
          const hn = { strumTime: note.time, fullSustainLength: note.sustain, sustainLength: note.sustain, hitNote: false, missedNote: false, handledMiss: false,
            scoreable: note.scoreable, noteData: note.noteData, noteDirection: note.lane, alive: true, visible: true, parent: note };
          note.holdNoteSprite = hn; s.holdNotes.push(hn);
        }
        s.nextNoteIndex = i + 1;
        if (this.host.onNoteIncoming) this.host.onNoteIncoming(note);
      }
      for (let i = 0, a = s.notes; i < a.length; i++) {
        const note = a[i]; if (!note.alive) continue;
        const offscreen = (pos - note.time) * C.PIXELS_PER_MS * s.scrollSpeed > 220;
        if (note.handledMiss && offscreen) this.killNote(note);
      }
      for (let i = 0, a = s.holdNotes; i < a.length; i++) {
        const hn = a[i]; if (!hn.alive) continue;
        if (pos > hn.strumTime && hn.hitNote && !hn.missedNote) {
          if (s.isPlayer && !s.keysHeld[hn.noteDirection]) { hn.missedNote = true; hn.visible = true; hn.alpha = 0; }
        }
        const renderWindowEnd = hn.strumTime + hn.fullSustainLength + C.HIT_WINDOW_MS + (this.renderDistanceMs(s) / 8);
        if (hn.missedNote && pos >= renderWindowEnd) { hn.visible = false; hn.alive = false; }
        else if (hn.hitNote && hn.sustainLength <= 0) { hn.visible = false; hn.alive = false; }
        else if (hn.missedNote && (hn.fullSustainLength > hn.sustainLength)) { hn.visible = true; }
        else if (pos > hn.strumTime && hn.hitNote) {
          hn.visible = true; hn.sustainLength = (hn.strumTime + hn.fullSustainLength) - pos;
          if (hn.sustainLength <= 10) hn.visible = false;
        } else hn.visible = true;
      }
      // (rendimiento: los grupos de V-Slice reciclan los sprites muertos; aquí se compactan para no recorrerlos cada frame)
      if (++s._sweep >= 60) { s._sweep = 0; compactDead(s.notes); compactDead(s.holdNotes); }
      if (this.ghostTappingFeature && s.isPlayer && s.ghostTapTimer > 0 && !s.notes.some(n => n.alive && !n.hasBeenHit)) s.ghostTapTimer = Math.max(0, s.ghostTapTimer - this._elapsed);
    }
    /* este motor: nota saltada por un tirón de la pantalla (no cuenta como fallo) */
    skipNote(note) { note.skipped = note.judged = true; note.hasBeenHit = true; this.killNote(note); }
    killNote(note) {
      note.visible = false; note.alive = false;
      if (note.holdNoteSprite != null) { note.holdNoteSprite.missedNote = true; note.holdNoteSprite.visible = false; }
    }
    strumHitNote(s, note, removeNote = true) {
      note.hasBeenHit = true;
      if (removeNote) this.killNote(note); else { note.alpha = 0.5; note.desaturated = true; }
      const hn = note.holdNoteSprite;
      if (hn != null) { hn.hitNote = true; hn.missedNote = false; hn.sustainLength = Math.min(hn.fullSustainLength, (hn.strumTime + hn.fullSustainLength) - this.conductor.songPosition); }
      if (this.ghostTappingFeature) s.ghostTapTimer = C.GHOST_TAP_DELAY;
      if (this.host.onStrumHit) this.host.onStrumHit(note, removeNote);
    }
    getNotesMayHit(s) { return s.notes.filter(n => n != null && n.alive && !n.hasBeenHit && n.mayHit); }
    mayGhostTap(s) {
      if (this.getNotesMayHit(s).length > 0) return false;
      if (s.holdNotes.some(h => h.alive && (h.hitNote || h.missedNote) && h.sustainLength > 0)) return false;
      return s.ghostTapTimer === 0;
    }
    processWindow(note, isControlled) {
      const pos = this.conductor.songPosition, start = note.time - C.HIT_WINDOW_MS, center = note.time, end = note.time + C.HIT_WINDOW_MS;
      // (rendimiento: código entero en vez de un objeto por nota y frame: 0 = no seguir, 1 = seguir, 3 = botplayHit)
      if (note.hasMissed || note.hasBeenHit) return 0;
      if (pos > end) { note.tooEarly = false; note.hasMissed = true; note.mayHit = false; if (note.holdNoteSprite != null) note.holdNoteSprite.missedNote = true; return 1; }
      if (!isControlled && pos >= center) return 3;
      if (note.holdNoteSprite != null) note.holdNoteSprite.missedNote = false;
      if (pos >= start) { note.tooEarly = false; note.hasMissed = false; note.mayHit = true; return 1; }
      note.tooEarly = true; note.mayHit = false; note.hasMissed = false;
      return 1;
    }
    /* PlayState.processNotes */
    processNotes(elapsed) {
      const opp = this.opponentStrumline, pl = this.playerStrumline, st = this.currentStage, h = this.host;
      for (let i = 0, a = opp.notes; i < a.length; i++) {
        const note = a[i]; if (note == null || !note.alive) continue;
        const r = this.processWindow(note, false);
        if (r === 3) {
          const event = new HitNoteScriptEvent(note, 0.0, 0, 'perfect', false, 0);
          this.dispatchEvent(event);
          if (event.eventCanceled) continue;
          if (h.vocals && h.vocals.legacyVoiceSystem) { if (h.vocals.legacyVoiceUsesPlayer) h.vocals.playerVolume = 1; else h.vocals.opponentVolume = 1; }
          this.strumHitNote(opp, note);
          if (h.afterHit) h.afterHit(note, event, false);
        }
      }
      for (let i = 0, a = opp.holdNotes; i < a.length; i++) {
        const hn = a[i];
        if (hn == null || !hn.alive || hn.noteData == null) continue;
        if (hn.hitNote && !hn.missedNote && hn.sustainLength > 0) { const d = st && st.getDad(); if (d && d.isSinging()) d.holdTimer = 0; }
        if (hn.missedNote && !hn.handledMiss) { hn.handledMiss = true; if (hn.scoreable && st && st.getDad()) st.getDad().playSingAnimation(hn.noteData.getDirection(), true); }
      }
      for (let i = 0, a = pl.notes; i < a.length; i++) {
        const note = a[i]; if (note == null || !note.alive) continue;
        const ctl = this.demoAutoplay ? true : !this.isBotPlayMode;
        const r = this.processWindow(note, ctl);
        if (r === 3) {
          const event = new HitNoteScriptEvent(note, 0.0, 0, 'perfect', false, 0);
          this.dispatchEvent(event);
          if (event.eventCanceled) continue;
          this.strumHitNote(pl, note);
          if (h.afterHit) h.afterHit(note, event, true);
        }
        if (r === 0) continue;
        if (note.hasMissed && !note.handledMiss) {
          const event = new NoteScriptEvent('NOTE_MISS', note, C.HEALTH_MISS_PENALTY, this.tallies.combo, true);
          this.dispatchEvent(event);
          if (event.eventCanceled) continue;
          if (!this.isBotPlayMode) this.onNoteMiss(note, event.playSound, event.healthChange);
          note.handledMiss = true;
          if (h.afterMiss) h.afterMiss(note, event);
        }
      }
      for (let i = 0, a = pl.holdNotes; i < a.length; i++) {
        const hn = a[i];
        if (hn == null || !hn.alive) continue;
        if (hn.hitNote && !hn.missedNote && hn.sustainLength > 0) {
          if (!this.isBotPlayMode && hn.scoreable) { this.health += C.HEALTH_HOLD_BONUS_PER_SECOND * elapsed; this.songScore += C.SCORE_HOLD_BONUS_PER_SECOND * elapsed; }
          if (this.isBotPlayMode && st && st.getBoyfriend() && st.getBoyfriend().isSinging()) st.getBoyfriend().holdTimer = 0;
        }
        if (hn.missedNote && !hn.handledMiss) {
          hn.handledMiss = true;
          if (!this.isBotPlayMode && hn.scoreable) {
            if (hn.sustainLength > C.HOLD_DROP_PENALTY_THRESHOLD_MS) {
              const remainingLengthSec = hn.sustainLength / C.MS_PER_SEC;
              const healthChangeUncapped = remainingLengthSec * C.HEALTH_HOLD_DROP_PENALTY_PER_SECOND;
              const healthChangeMax = C.HEALTH_HOLD_DROP_PENALTY_MAX - (hn.hitNote ? -C.HEALTH_MISS_PENALTY : 0);
              const healthChange = FlxMath.bound(healthChangeUncapped, healthChangeMax, 0);
              const scoreChange = C.SCORE_HOLD_DROP_PENALTY_PER_SECOND * remainingLengthSec;
              const event = new HoldNoteScriptEvent('NOTE_HOLD_DROP', hn, healthChange, scoreChange, true, this.tallies.combo);
              this.dispatchEvent(event);
              if (event.eventCanceled) continue;
              this.applyScore(event.score, '', event.healthChange, event.isComboBreak);
              if (event.playSound) {
                if (h.vocals) { if (h.vocals.legacyVoiceSystem && !h.vocals.legacyVoiceUsesPlayer) h.vocals.opponentVolume = 0; h.vocals.playerVolume = 0; }
                if (h.playMissSound) h.playMissSound(0.5, 0.6);
              }
              if (h.afterHoldDrop) h.afterHoldDrop(hn, event);
            }
          }
        }
      }
      if (h.syncNoteFlags) h.syncNoteFlags();
    }
    /* PlayState.processInputQueue (entrada: { noteDirection, songPos } con la posición exacta del audio al tocar) */
    processInputQueue() {
      if (this.inputPressQueue.length + this.inputReleaseQueue.length === 0) return;
      const pl = this.playerStrumline;
      const notesInRange = this.getNotesMayHit(pl);
      const byDir = [[], [], [], []];
      for (const n of notesInRange) byDir[n.direction].push(n);
      while (this.inputPressQueue.length > 0) {
        const input = this.inputPressQueue.shift(); if (input == null) continue;
        pl.keysHeld[input.noteDirection] = true;
        if (this.host.onPressKey) this.host.onPressKey(input.noteDirection);
        if (this.isBotPlayMode) continue;
        const inDir = byDir[input.noteDirection];
        const ghost = this.ghostTappingFeature ? (!this.mayGhostTap(pl) && inDir.length === 0) : inDir.length === 0;
        if (ghost) this.ghostNoteMiss(input.noteDirection, notesInRange.length > 0);
        else if (inDir.length === 0) { /* toque fantasma permitido (FEATURE_GHOST_TAPPING) */ }
        else {
          let target = inDir.find(n => !n.lowPriority); if (target == null) target = inDir[0]; if (target == null) continue;
          this.goodNoteHit(target, input);
          inDir.splice(inDir.indexOf(target), 1);
        }
      }
      while (this.inputReleaseQueue.length > 0) {
        const input = this.inputReleaseQueue.shift(); if (input == null) continue;
        pl.keysHeld[input.noteDirection] = false;
        if (this.host.onReleaseKey) this.host.onReleaseKey(input.noteDirection);
      }
    }
    goodNoteHit(note, input) {
      const pos = input && input.songPos != null ? input.songPos : this.conductor.songPosition;
      const noteDiff = Math.trunc(pos - note.noteData.time);       // Std.int(songPosition - time - latencia)
      const score = Scoring.scoreNote(noteDiff), daRating = Scoring.judgeNote(noteDiff);
      let healthChange = 0.0, isComboBreak = false;
      switch (daRating) {
        case 'sick': healthChange = C.HEALTH_SICK_BONUS; isComboBreak = C.JUDGEMENT_SICK_COMBO_BREAK; break;
        case 'good': healthChange = C.HEALTH_GOOD_BONUS; isComboBreak = C.JUDGEMENT_GOOD_COMBO_BREAK; break;
        case 'bad': healthChange = C.HEALTH_BAD_BONUS; isComboBreak = C.JUDGEMENT_BAD_COMBO_BREAK; break;
        case 'shit': healthChange = C.HEALTH_SHIT_BONUS; isComboBreak = C.JUDGEMENT_SHIT_COMBO_BREAK; break;
      }
      const event = new HitNoteScriptEvent(note, healthChange, score, daRating, isComboBreak, note.scoreable ? this.tallies.combo + 1 : this.tallies.combo, noteDiff, daRating === 'sick');
      this.dispatchEvent(event);
      if (event.eventCanceled) { if (this.host.onHitCanceled) this.host.onHitCanceled(note, event); return; }
      const h = this.host;
      this.strumHitNote(this.playerStrumline, note, !event.isComboBreak);
      if (event.doesNotesplash && h.playNoteSplash) h.playNoteSplash(note);
      if (h.vocals) { if (h.vocals.legacyVoiceSystem && !h.vocals.legacyVoiceUsesPlayer) h.vocals.opponentVolume = 1; h.vocals.playerVolume = 1; }
      if (note.scoreable) {
        this.tallies.totalNotesHit++;
        this.applyScore(event.score, event.judgement, event.healthChange, event.isComboBreak);
        this.popUpScore(event.judgement);
      }
      if (h.afterHit) h.afterHit(note, event, true);
    }
    onNoteMiss(note, playSound = false, healthChange) {
      this.applyScore(Scoring.getMissScore(), 'miss', healthChange, true);
      if (playSound) {
        const bf = this.currentStage && this.currentStage.getBoyfriend(), temp = !!(bf && bf.tempVocals);
        if (this.host.vocals && !temp) this.host.vocals.playerVolume = 0;
        if (this.host.playMissSound) this.host.playMissSound(0.5, 0.6);
      }
    }
    ghostNoteMiss(direction, hasPossibleNotes = true) {
      const event = new GhostMissNoteScriptEvent(direction, hasPossibleNotes, C.HEALTH_GHOST_MISS_PENALTY, C.SCORE_GHOST_MISS_PENALTY);
      this.dispatchEvent(event);
      if (event.eventCanceled) return;
      this.health += event.healthChange; this.songScore += event.scoreChange;
      if (event.playSound) {
        const bf = this.currentStage && this.currentStage.getBoyfriend(), temp = !!(bf && bf.tempVocals);
        if (this.host.vocals && !temp) this.host.vocals.playerVolume = 0;
        if (this.host.playMissSound) this.host.playMissSound(0.1, 0.2);
      }
      if (this.host.afterGhostMiss) this.host.afterGhostMiss(direction, event);
    }
    applyScore(score, daRating, healthChange, isComboBreak) {
      const t = this.tallies;
      switch (daRating) { case 'sick': t.sick++; break; case 'good': t.good++; break; case 'bad': t.bad++; break; case 'shit': t.shit++; break; case 'miss': t.missed++; break; }
      this.health += healthChange;
      if (isComboBreak) { if (t.combo >= 10 && this.host.displayCombo) this.host.displayCombo(0); t.combo = 0; }
      else { t.combo++; if (t.combo > t.maxCombo) t.maxCombo = t.combo; }
      this.songScore += score;
    }
    popUpScore(daRating, combo) {
      if (daRating === 'miss') return;
      if (combo == null) combo = this.tallies.combo;
      if (this.host.displayRating) this.host.displayRating(daRating);
      if (combo >= 10 && this.host.displayCombo) this.host.displayCombo(combo);
      if (this.host.vocals) this.host.vocals.playerVolume = 1;
    }

    /* ----- un frame, en el orden de FlxGame/PlayState ----- */
    /* opts.songPos: posición de la canción que da el audio (si no, se avanza con elapsed como en la cuenta atrás) */
    update(elapsed, opts) {
      opts = opts || {};
      this._elapsed = elapsed;
      // FlxG.plugins.update → FlxTween.globalManager
      this.tweens.update(elapsed);
      // FlxState.update: miembros (animaciones de personajes, strumlines con la posición del frame anterior)
      if (this.host.updateMembers) this.host.updateMembers(elapsed);
      this.updateStrumline(this.playerStrumline); this.updateStrumline(this.opponentStrumline);
      // MusicBeatState: UpdateScriptEvent
      const ue = this._updateEvent || (this._updateEvent = new UpdateScriptEvent(0));   // (rendimiento: un solo objeto)
      ue.elapsed = elapsed; ue.eventCanceled = false; ue.shouldPropagate = true;
      this.dispatchEvent(ue);
      // Conductor
      // (V-Slice: en la cuenta atrás suma elapsed; luego sigue al audio. Aquí opts.songPos = reloj del audio de este motor)
      const next = opts.songPos != null ? opts.songPos : this.conductor.songPosition + elapsed * 1000;
      if (this.startingSong) {
        if (this.isInCountdown) {
          this.conductor.update(next, false);
          if (this.conductor.songPosition >= (this.startTimestamp + this.conductor.combinedOffset)) this.startSong();
        }
      } else this.conductor.update(next, false);
      if (this.health > C.HEALTH_MAX) this.health = C.HEALTH_MAX;
      if (this.health < C.HEALTH_MIN) this.health = C.HEALTH_MIN;
      const dt = elapsed * 60;
      if (this.subState == null && this.cameraZoomRate > 0.0) {
        this.cameraBopMultiplier = FlxMath.lerp(1.0, this.cameraBopMultiplier, Math.pow(0.95, dt));
        this.camera.zoom = this.currentCameraZoom * this.cameraBopMultiplier;
        this.camHUD.zoom = FlxMath.lerp(this.defaultHUDCameraZoom, this.camHUD.zoom, Math.pow(0.95, dt));
      }
      if (this.health <= C.HEALTH_MIN && !this.isPracticeMode && this.host.onHealthZero) this.host.onHealthZero();
      this.processSongEvents();
      this.processInputQueue();
      this.processNotes(elapsed);
      // FlxG.cameras.update
      this.camera.update(elapsed);
    }
    startSong() {
      this.startingSong = false; this.isInCountdown = false;
      if (this.host.onSongStart) this.host.onSongStart();
      this.dispatchEvent(new ScriptEvent('SONG_START'));
    }
    /* PlayState.create (cámara + conductor antes de la cuenta atrás) */
    begin(startTimestamp = 0) {
      this.startTimestamp = startTimestamp;
      this.resetCamera();
      this.conductor.update(this.conductor.beatLengthMs * -5 + startTimestamp, true, true);
      this.startingSong = true; this.isInCountdown = true;
    }
    /* PlayState.update con needsReset (reintentar) */
    retry(startTimestamp = this.startTimestamp, vwooshDelay = 0) {
      this.startTimestamp = startTimestamp; this.prevScrollTargets = [];
      this.dispatchEvent(new SongRetryEvent(null));
      this.resetCamera();
      this.startingSong = true; this.isInCountdown = true;
      this.cancelScrollSpeedTweens();
      for (const s of [this.playerStrumline, this.opponentStrumline]) { s.scrollSpeed = this.chartScrollSpeed; s.keysHeld.fill(false); }   // (V-Slice no lo restaura: ver README)
      this.regenNoteData(startTimestamp);
      this.cameraBopIntensity = C.DEFAULT_BOP_INTENSITY; this.hudCameraZoomIntensity = (this.cameraBopIntensity - 1.0) * 2.0; this.cameraZoomRate = C.DEFAULT_ZOOM_RATE;
      this.health = C.HEALTH_STARTING; this.songScore = 0; this.tallies.combo = 0;
      for (const k of ['sick', 'good', 'bad', 'shit', 'missed', 'maxCombo', 'totalNotesHit']) this.tallies[k] = 0;
      this.conductor.update(-vwooshDelay * 1000 + startTimestamp + this.conductor.beatLengthMs * -5);
    }
  }

  return {
    C, Constants: C, FlxMath, FlxEase, easeFor, EASE_TYPE_DIR_REGEX, FlxTween, VarTween, NumTween, FlxTweenManager, TWEEN_TYPE: { PERSIST: T_PERSIST, LOOPING: T_LOOPING, PINGPONG: T_PINGPONG, ONESHOT: T_ONESHOT, BACKWARD: T_BACKWARD },
    FlxCamera, FlxAnim, AnimController, Conductor, Scoring,
    ScriptEvent, NoteScriptEvent, HitNoteScriptEvent, HoldNoteScriptEvent, GhostMissNoteScriptEvent, SongEventScriptEvent, UpdateScriptEvent, SongTimeScriptEvent,
    CountdownScriptEvent, SongRetryEvent, PauseScriptEvent, SongLoadScriptEvent, ScriptEventDispatcher, METHOD,
    SongEventData, SongEvent, SongEventRegistry, FocusCameraSongEvent, ZoomCameraSongEvent, SetCameraBopSongEvent, ScrollSpeedEvent, SetTargetBopSpeedSongEvent, PlayAnimationSongEvent, SetHealthIconSongEvent,
    NoteKind, NoAnimNoteKind, NonScoreableNoteKind, NoteKindManager, BaseCharacterMixin, mixCharacter, makeNoteData, PlayCore, DIRS,
    play: null, get conductor() { return this.play ? this.play.conductor : null; },
  };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = VS;
