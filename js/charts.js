/* =====================================================================
   charts.js — chart demo + lectores de charts (V-Slice .fnfc / chart.json,
   Psych, legacy) y zip mínimo para .fnfc.
   Formato interno: { title, artist, bpm, speed, notes:[{time,lane,side,sustain}], endTime, difficulties, difficulty, scene }
   ===================================================================== */
'use strict';

/* ---------- Conductor (cambios de BPM) ----------
   tc = [{ t (ms), bpm, beat }] ordenado; beat(ms) / step(ms) / crochet(ms) siguen a los timeChanges
   (V-Slice: metadata.timeChanges · Psych/Kade: changeBPM de las secciones · Codename: evento "BPM Change"). */
const Cond = {
  build(list, bpm0) {
    const pts = (Array.isArray(list) ? list : []).filter(p => p && +p.bpm > 0 && isFinite(+p.t)).map(p => ({ t: +p.t, bpm: +p.bpm })).sort((a, b) => a.t - b.t);
    if (!pts.length || pts[0].t > 0) pts.unshift({ t: 0, bpm: pts.length && !(+bpm0 > 0) ? pts[0].bpm : (+bpm0 || 100) });
    pts[0].t = 0;
    const out = [];
    for (const p of pts) {
      const last = out[out.length - 1];
      if (last && Math.abs(p.t - last.t) < 1e-6) { last.bpm = p.bpm; continue; }
      if (last && p.bpm === last.bpm) continue;
      out.push({ t: p.t, bpm: p.bpm, beat: last ? last.beat + (p.t - last.t) / (60000 / last.bpm) : 0 });
    }
    return out;
  },
  tc() { return (typeof G !== 'undefined' && G.chart && G.chart.tc) || [{ t: 0, bpm: 100, beat: 0 }]; },
  point(tc, ms) { let p = tc[0]; for (let i = 1; i < tc.length && tc[i].t <= ms; i++) p = tc[i]; return p; },
  pointB(tc, b) { let p = tc[0]; for (let i = 1; i < tc.length && tc[i].beat <= b; i++) p = tc[i]; return p; },
  /* listas sin "beat" (al convertir): se calcula al vuelo */
  norm(tc) { return tc.length && tc[0].beat !== undefined ? tc : this.build(tc, tc[0] && tc[0].bpm); },
  bpmAt(tc, ms) { return this.point(this.norm(tc), ms).bpm; },
  msOfBeat(tc, b) { tc = this.norm(tc); const p = this.pointB(tc, b); return p.t + (b - p.beat) * 60000 / p.bpm; },
  beat(ms) { const tc = this.tc(), p = this.point(tc, ms); return p.beat + (ms - p.t) / (60000 / p.bpm); },
  step(ms) { return this.beat(ms) * 4; },
  crochet(ms) { return 60000 / this.point(this.tc(), ms).bpm; },
  stepMs(ms) { return this.crochet(ms) / 4; },
};

const Chart = {
  makeDemo() {
    const bpm = CONFIG.demoBpm, crochet = 60000 / bpm, step = crochet / 4, rnd = mulberry32(2026);
    const patterns = [
      [0, 4, 8, 12], [0, 2, 4, 6, 8, 12], [0, 4, 6, 8, 10, 12], [0, 3, 6, 8, 12, 14],
      [0, 2, 4, 8, 10, 12, 14], [0, 4, 8, 10, 12], [0, 2, 6, 8, 12], [0, 6, 8, 10, 12, 14],
    ];
    const notes = [];
    const pairs = 14;                       // 14 pares de compases (rival llama, jugador responde)
    for (let p = 0; p < pairs; p++) {
      const pat = patterns[(p + Math.floor(rnd() * 3)) % patterns.length];
      let prev = -1; const seq = [];
      pat.forEach((s, i) => {
        let lane = Math.floor(rnd() * 4); if (lane === prev) lane = (lane + 1 + Math.floor(rnd() * 3)) % 4; prev = lane;
        const next = pat[i + 1] ?? 16;
        const sustain = (next - s >= 4 && rnd() < 0.45) ? step * (next - s - 1.5) : 0;
        seq.push({ s, lane, sustain });
      });
      for (const side of ['opponent', 'player']) {
        const barStart = (p * 2 + (side === 'player' ? 1 : 0)) * 4 * crochet + 2 * crochet;
        seq.forEach(n => notes.push({ time: barStart + n.s * step, lane: n.lane, side, sustain: n.sustain, seed: rnd() }));
      }
    }
    const events = [];
    for (let p = 0; p < pairs; p++) for (const k of [0, 1]) events.push({ t: (p * 2 + k) * 4 * crochet, e: 'FocusCamera', v: { char: k ? 0 : 1 } });
    return this.finalize({ title: 'Demo GCD', artist: 'Chart Editor GCD · Demo', bpm, speed: CONFIG.demoSpeed, notes, events, isDemo: true, format: 'demo generada' });
  },

  /* ---------- detección del formato ----------
     V-Slice (song-chart.json + song-metadata.json / .fnfc), Psych 0.6 / 0.7 / 1.0, Codename (charts/<dif>.json + meta.json + events.json),
     Kade (KE1 / eventObjects) y legacy (FNF 0.2.x). Todos se convierten al formato interno (notas en ms + eventos estilo V-Slice). */
  detect(raw, meta) {
    if (!raw || typeof raw !== 'object') return 'desconocido';
    if (raw.codenameChart || Array.isArray(raw.strumLines)) return 'Codename';
    if (raw.notes && !Array.isArray(raw.notes) && typeof raw.notes === 'object' && !raw.song && Object.values(raw.notes).some(Array.isArray)) return 'V-Slice';
    const song = raw.song && typeof raw.song === 'object' ? raw.song : raw;
    if (typeof song.format === 'string' && /^psych_v1/.test(song.format)) return 'Psych 1.0';
    const secs = Array.isArray(song.notes) ? song.notes : [];
    if (song.chartVersion && /^KE/i.test(String(song.chartVersion)) || Array.isArray(song.eventObjects) || (song.noteStyle !== undefined && !Array.isArray(song.events))) return 'Kade';
    if (secs.some(s => s && s.sectionBeats !== undefined) || song.gfVersion !== undefined && Array.isArray(song.events) && secs.every(s => !s || s.lengthInSteps === undefined)) return 'Psych 0.7';
    if (Array.isArray(song.events) || secs.some(s => s && Array.isArray(s.sectionNotes) && s.sectionNotes.some(n => Array.isArray(n) && n[1] < 0)) || song.player3 !== undefined || song.gfVersion !== undefined) return 'Psych 0.6';
    if (secs.length || (song.notes && typeof song.notes === 'object')) return 'legacy';
    if (Array.isArray(raw) || Array.isArray(raw.notes)) return 'simple';
    return 'desconocido';
  },

  /** raw = JSON del chart, meta = JSON de metadata (opcional), extra = { events } (events.json de Codename) */
  parse(raw, meta, wantedDiff, extra) {
    if (!raw || typeof raw !== 'object') throw new Error('JSON vacío');
    const fmt = this.detect(raw, meta);
    if (fmt === 'V-Slice') return this.fromVSlice(raw, meta, wantedDiff);
    if (fmt === 'Codename') return this.fromCodename(raw, meta, extra, wantedDiff);
    const c = this.fromSections(raw, wantedDiff, fmt, extra);
    if (c) return c;
    // Simple: { bpm, notes:[{t,d,l}] } o [{time,column}]
    const arr = Array.isArray(raw) ? raw : Array.isArray(raw.notes) ? raw.notes : null;
    if (arr) {
      const notes = arr.map(n => {
        const d = (n.d ?? n.column ?? n.lane ?? 0) | 0;
        return { time: +(n.t ?? n.time ?? 0), lane: d % 4, side: d % 8 < 4 ? 'player' : 'opponent', sustain: +(n.l ?? n.sustain ?? 0), kind: n.k || '' };
      });
      return this.finalize({ title: raw.title || raw.songName || 'Canción', artist: raw.artist || '', bpm: raw.bpm || 100, speed: raw.speed || 1.6, notes, events: raw.events || [], format: 'simple' });
    }
    throw new Error('Formato de chart no reconocido');
  },
  pickDiff(diffs, wanted) {
    return (wanted && diffs.includes(wanted)) ? wanted : (['normal', 'hard', 'easy'].find(d => diffs.includes(d)) || diffs[0]);
  },

  /* V-Slice: { notes: { easy:[{t,d,l,k,p}] }, scrollSpeed:{...}, events:[{t,e,v}] } + metadata (timeChanges, playData) */
  fromVSlice(raw, meta, wantedDiff) {
    const diffs = Object.keys(raw.notes).filter(k => Array.isArray(raw.notes[k]));
    const diff = this.pickDiff(diffs, wantedDiff);
    const list = raw.notes[diff] || [];
    const ss = raw.scrollSpeed || {};
    const speed = +(ss[diff] ?? ss.default ?? ss.normal ?? 1.6) || 1.6;
    const tcs = (Array.isArray(meta?.timeChanges) ? meta.timeChanges : []).filter(t => +t.bpm > 0).map(t => ({ t: +t.t || 0, bpm: +t.bpm }));
    const bpm = tcs[0]?.bpm || raw.bpm || 100;
    const notes = list.map(n => ({ time: +n.t, lane: (n.d | 0) % 4, side: ((n.d | 0) % 8) < 4 ? 'player' : 'opponent', sustain: +(n.l || 0), kind: n.k || '', params: Array.isArray(n.p) ? n.p : null, raw: n.d | 0 }));
    const pc = meta?.playData?.characters || {};
    const scene = { bf: pc.player, dad: pc.opponent, gf: pc.girlfriend, stage: meta?.playData?.stage };
    const events = (Array.isArray(raw.events) ? raw.events : []).map(e => ({ t: +e.t || 0, e: String(e.e || ''), v: e.v }));
    return this.finalize({ title: meta?.songName || 'Canción', artist: meta?.artist || '', bpm, timeChanges: tcs, speed, notes, events, difficulties: diffs, difficulty: diff, scene,
      noteStyle: meta?.playData?.noteStyle, format: 'V-Slice' });
  },

  /* Psych 0.6 / 0.7 / 1.0, Kade y legacy: { song: { notes:[secciones], bpm, speed, events } } */
  fromSections(raw, wantedDiff, fmt, extra) {
    const song = raw.song && typeof raw.song === 'object' ? raw.song : raw;
    let secs = song.notes, diffs = null, diff = null;
    if (secs && !Array.isArray(secs) && typeof secs === 'object') {          // canción "test" (FNF SongConverter): notas por dificultad
      diffs = Object.keys(secs).filter(k => Array.isArray(secs[k]));
      if (diffs.length) { diff = this.pickDiff(diffs, wantedDiff); secs = secs[diff]; }
    }
    if (!Array.isArray(secs) || !secs.some(s => s && Array.isArray(s.sectionNotes))) return null;
    const psychV1 = fmt === 'Psych 1.0';
    const notes = [], events = [], tcs = [];
    const bpm0 = +song.bpm || 100;
    let bpm = bpm0, t = 0, lastFocus = null;
    tcs.push({ t: 0, bpm: bpm0 });
    secs.forEach(sec => {
      if (!sec) return;
      if (sec.changeBPM && +sec.bpm > 0 && +sec.bpm !== bpm) { bpm = +sec.bpm; tcs.push({ t, bpm }); }
      const steps = +sec.lengthInSteps || (+sec.sectionBeats ? sec.sectionBeats * 4 : 16);
      // cámara: V-Slice convierte mustHitSection en eventos FocusCamera (gfSection → GF)
      const focus = sec.gfSection ? 2 : (sec.mustHitSection ? 0 : 1);
      if (focus !== lastFocus) { events.push({ t, e: 'FocusCamera', v: { char: focus }, auto: true }); lastFocus = focus; }
      (sec.sectionNotes || []).forEach(n => {
        if (!Array.isArray(n)) return;
        if (typeof n[1] !== 'number' || n[1] < 0) { if (typeof n[2] === 'string') events.push(...this.psychEvent(+n[0], n[2], n[3], n[4], bpm)); return; }
        const d = n[1] | 0; if (typeof n[0] !== 'number') return;
        const first = d % 8 < 4;
        const isPlayer = psychV1 ? first : (sec.mustHitSection ? first : !first);
        // tipo de nota: Psych → texto (n[3]); Kade → n[3] = true (alt); sección altAnim → la nota del rival usa "-alt"
        let kind = typeof n[3] === 'string' ? n[3] : (n[3] === true ? 'Alt Animation' : '');
        if (!kind && sec.altAnim && !isPlayer) kind = 'Alt Animation';
        if (!kind && sec.gfSection && !isPlayer && !psychV1 && fmt.startsWith('Psych')) kind = 'GF Sing';
        notes.push({ time: n[0], lane: d % 4, side: isPlayer ? 'player' : 'opponent', sustain: Math.max(0, +(n[2] || 0)), kind });
      });
      t += steps * (60000 / bpm / 4);
    });
    // events.json de Psych (aparte del chart) se suma a song.events
    const pEvs = [...(Array.isArray(song.events) ? song.events : []), ...(extra && Array.isArray(extra.psychEvents) ? extra.psychEvents : [])];
    pEvs.forEach(ev => (Array.isArray(ev[1]) ? ev[1] : []).forEach(x => events.push(...this.psychEvent(+ev[0], x[0], x[1], x[2], Cond.bpmAt(tcs, +ev[0])))));
    if (Array.isArray(raw.events)) raw.events.forEach(e => { if (e && e.e) events.push({ t: +e.t || 0, e: String(e.e), v: e.v }); });
    // Kade 1.8: eventObjects [{ name, position (beat), value, type: "BPM Change" | "Scroll Speed Change" }]
    if (Array.isArray(song.eventObjects)) {
      const kt = [{ t: 0, bpm: bpm0 }];
      const objs = song.eventObjects.slice().sort((a, b) => (+a.position || 0) - (+b.position || 0));
      for (const o of objs) {
        const ms = Cond.msOfBeat(kt, +o.position || 0);
        if (o.type === 'BPM Change' && +o.value > 0) { if (ms > 0 || +o.value !== bpm0) { kt.push({ t: ms, bpm: +o.value }); tcs.push({ t: ms, bpm: +o.value }); } }
        else if (o.type === 'Scroll Speed Change' && +o.value > 0) events.push({ t: ms, e: 'ScrollSpeed', v: { scroll: +o.value, absolute: true, ease: 'INSTANT' } });
      }
    }
    const sp = song.speed && typeof song.speed === 'object' ? (song.speed[diff] ?? song.speed.normal ?? Object.values(song.speed)[0]) : song.speed;
    const scene = { bf: song.player1, dad: song.player2, gf: song.gfVersion || song.player3 || song.gf, stage: song.stage || song.stageDefault || (typeof KADE_SONG_STAGE !== 'undefined' && KADE_SONG_STAGE[String(song.song || '').toLowerCase().replace(/\s+/g, '-')]) || undefined };
    const label = raw.generatedBy && fmt === 'legacy' ? `legacy (${raw.generatedBy})` : fmt;
    return this.finalize({ title: song.song || song.songName || 'Canción', artist: song.artist || '', bpm: bpm0, timeChanges: tcs, speed: +sp || 1.6, notes, events, scene,
      difficulties: diffs || null, difficulty: diff, voiceList: Array.isArray(song.voiceList) ? song.voiceList : null, needsVoices: song.needsVoices !== false,
      noteStyle: song.noteStyle || song.arrowSkin || null, format: label });
  },

  /* Codename: { strumLines:[{ characters:[id], type:0 rival|1 jugador|2 extra, position, notes:[{time,id,sLen,type}] }], noteTypes:[...],
     events:[{time,name,params}], scrollSpeed, stage } + meta.json { name, bpm, displayName, difficulties } + events.json { events } */
  fromCodename(raw, meta, extra, wantedDiff) {
    meta = meta || raw.meta || {};
    const sl = Array.isArray(raw.strumLines) ? raw.strumLines : [];
    const roleOf = (s, i) => {
      const pos = String(s && s.position || '').toLowerCase();
      if (pos === 'girlfriend' || pos === 'gf' || (s && s.type === 2)) return 'gf';
      if (s && s.type === 1) return 'bf';
      if (s && s.type === 0) return 'dad';
      return i === 1 ? 'bf' : i === 0 ? 'dad' : 'gf';
    };
    const roleChar = { bf: 0, dad: 1, gf: 2 };
    const types = Array.isArray(raw.noteTypes) ? raw.noteTypes : [];
    const notes = [];
    sl.forEach((s, i) => {
      const role = roleOf(s, i);
      for (const n of (s && s.notes) || []) {
        if (!isFinite(+n.time)) continue;
        let kind = +n.type > 0 ? String(types[+n.type - 1] || '') : '';
        if (role === 'gf' && !kind) kind = 'GF Sing';
        notes.push({ time: +n.time, lane: (n.id | 0) % 4, side: role === 'bf' ? 'player' : 'opponent', sustain: Math.max(0, +(n.sLen || 0)), kind });
      }
    });
    const bpm0 = +meta.bpm || +raw.bpm || 100;
    const tcs = [{ t: 0, bpm: bpm0 }];
    const evs = [...(Array.isArray(raw.events) ? raw.events : []), ...(extra && Array.isArray(extra.events) ? extra.events : [])].sort((a, b) => (+a.time || 0) - (+b.time || 0));
    const events = [];
    for (const ev of evs) {
      const t = +ev.time || 0, p = Array.isArray(ev.params) ? ev.params : [], name = String(ev.name || ''), n0 = events.length;
      switch (name) {
        case 'BPM Change': case 'Continuous BPM Change': if (+p[0] > 0) tcs.push({ t, bpm: +p[0] }); break;
        case 'Camera Movement': { const s = sl[+p[0] | 0]; events.push({ t, e: 'FocusCamera', v: { char: roleChar[roleOf(s, +p[0] | 0)] }, auto: true }); break; }
        case 'Camera Position': events.push({ t, e: 'FocusCamera', v: { char: -1, x: +p[0] || 0, y: +p[1] || 0, ease: p[2] ? String(p[4] || 'linear') + (p[5] && p[4] !== 'linear' ? p[5] : '') : 'CLASSIC', duration: +p[3] || 4 } }); break;
        case 'Add Camera Zoom': events.push({ t, e: '_AddCameraZoom', v: String(p[1] || 'camGame') === 'camHUD' ? { game: 0, hud: +p[0] || 0.03 } : { game: +p[0] || 0.015, hud: 0 } }); break;
        case 'Camera Modulo Change': events.push({ t, e: 'SetCameraBop', v: { rate: +p[0] || 4, intensity: p[1] !== undefined ? +p[1] || 1 : 1 } }); break;
        case 'Camera Zoom': events.push({ t, e: 'ZoomCamera', v: { zoom: +p[1] || 1, mode: String(p[6] || 'direct').toLowerCase() === 'stage' ? 'stage' : 'direct', ease: p[0] === false ? 'INSTANT' : String(p[4] || 'linear'), easeDir: p[5] || undefined, duration: +p[3] || 4 } }); break;
        case 'Play Animation': { const s = sl[+p[0] | 0]; events.push({ t, e: 'PlayAnimation', v: { target: roleOf(s, +p[0] | 0), anim: String(p[1] || 'idle'), force: p[2] !== false } }); break; }
        case 'Scroll Speed Change': events.push({ t, e: 'ScrollSpeed', v: { scroll: +p[1] || 1, absolute: true, ease: p[0] ? String(p[3] || 'linear') : 'INSTANT', easeDir: p[4] || undefined, duration: +p[2] || 4 } }); break;
        case 'Alt Animation Toggle': { const s = sl[+p[2] | 0]; events.push({ t, e: '_AltAnim', v: { role: roleOf(s, +p[2] | 0), sing: !!p[0], idle: !!p[1] } }); break; }
        case 'Change Character': events.push({ t, e: 'ChangeCharacter', v: { target: roleOf(sl[+p[0] | 0], +p[0] | 0), char: String(p[1] || '') } }); break;
        case 'Time Signature Change': break;
        case 'Camera Flash': events.push({ t, e: '_CamFlash', v: { reversed: !!p[0], color: p[1] ?? 0xFFFFFFFF, steps: +p[2] || 4, cam: String(p[3] || 'camHUD') } }); break;
        default: events.push({ t, e: name, v: p });
      }
      // v3.7.0: nombre y parámetros originales → onEvent(event) de los scripts .hx de Codename
      const ce = { name, params: p };
      if (events.length > n0) events[n0].ce = ce; else events.push({ t, e: '_ScriptEvent', v: {}, ce });
    }
    const chars = {}; sl.forEach((s, i) => { const r = roleOf(s, i); if (!chars[r] && s && Array.isArray(s.characters) && s.characters[0]) chars[r] = String(s.characters[0]); });
    const diffs = Array.isArray(meta.difficulties) && meta.difficulties.length ? meta.difficulties.map(String) : null;
    return this.finalize({ title: meta.displayName || meta.name || raw.song || 'Canción', artist: meta.artist || meta.composer || '', bpm: bpm0, timeChanges: tcs, speed: +raw.scrollSpeed || 1.6, notes, events,
      scene: { bf: chars.bf, dad: chars.dad, gf: chars.gf, stage: raw.stage }, difficulties: diffs, difficulty: wantedDiff || (diffs ? this.pickDiff(diffs) : null), needsVoices: meta.needsVoices !== false,
      noteStyle: raw.noteSkin || null, format: 'Codename' });
  },

  /* Eventos de Psych → eventos de V-Slice equivalentes (o internos "_…" que esta página imita) */
  /* v3.7.0: cada evento de Psych lleva su nombre y valores originales (pe) → onEvent de los scripts .lua */
  psychEvent(t, name, v1, v2, bpm) {
    const out = this.psychEvent0(t, name, v1, v2, bpm), pe = { name: String(name || ''), v1: v1 ?? '', v2: v2 ?? '' };
    if (out.length) out[0].pe = pe; else out.push({ t, e: '_ScriptEvent', v: {}, pe });
    return out;
  },
  psychEvent0(t, name, v1, v2, bpm) {
    const who = x => { x = String(x ?? '').toLowerCase().trim(); return /^(1|dad|opponent)$/.test(x) ? 'dad' : /^(2|gf|girlfriend)$/.test(x) ? 'gf' : 'bf'; };
    const s1 = String(v1 ?? '').trim(), s2 = String(v2 ?? '').trim();
    switch (String(name || '')) {
      case 'Hey!': { const w = s1.toLowerCase(); const out = [];
        if (!/^(gf|girlfriend|1)$/.test(w)) out.push({ t, e: 'PlayAnimation', v: { target: 'bf', anim: 'hey', force: true } });
        if (!/^(bf|boyfriend|0)$/.test(w)) out.push({ t, e: 'PlayAnimation', v: { target: 'gf', anim: 'cheer', force: true } });
        return out; }
      case 'Play Animation': return [{ t, e: 'PlayAnimation', v: { target: who(v2), anim: s1, force: true } }];
      case 'Change Scroll Speed': { const sec = +v2 || 0; return [{ t, e: 'ScrollSpeed', v: { scroll: s1 === '' ? 1 : (+v1 || 1), absolute: false, duration: sec * 1000 / (60000 / bpm / 4), ease: sec ? 'linear' : 'INSTANT' } }]; }
      case 'Camera Follow Pos': return (s1 === '' && s2 === '') ? [{ t, e: 'FocusCamera', v: { char: -2 } }] : [{ t, e: 'FocusCamera', v: { char: -1, x: +v1 || 0, y: +v2 || 0, ease: 'CLASSIC' } }];
      case 'Add Camera Zoom': return [{ t, e: '_AddCameraZoom', v: { game: s1 === '' ? 0.015 : +v1 || 0, hud: s2 === '' ? 0.03 : +v2 || 0 } }];
      case 'Change Character': return s2 ? [{ t, e: 'ChangeCharacter', v: { target: who(v1), char: s2 } }] : [];
      case 'Set GF Speed': return [{ t, e: '_SetGFSpeed', v: { speed: Math.max(1, Math.round(+v1 || 1)) } }];
      case 'Alt Idle Animation': return [{ t, e: '_AltAnim', v: { role: who(v1), idleSuffix: s2 } }];
      case 'Screen Shake': {
        const pr = s => { const a = s.split(',').map(x => parseFloat(x)); return { dur: a[0] || 0, i: a[1] || 0 }; };
        return [{ t, e: '_ScreenShake', v: { game: pr(s1), hud: pr(s2) } }];
      }
      case 'Play Sound': return s1 ? [{ t, e: '_PlaySound', v: { sound: s1, volume: s2 === '' ? 1 : +v2 || 0 } }] : [];
      case 'Set Property': return s1 ? [{ t, e: '_SetProperty', v: { path: s1, value: v2 ?? '' } }] : [];
      default: return [{ t, e: String(name || ''), v: { value1: v1 ?? '', value2: v2 ?? '' }, psych: true }];
    }
  },

  finalize(c) {
    if (c.scene) { for (const k of Object.keys(c.scene)) if (!c.scene[k] || typeof c.scene[k] !== 'string') delete c.scene[k]; }
    c.notes = c.notes.filter(n => isFinite(n.time)).sort((a, b) => a.time - b.time);
    c.events = (c.events || []).filter(e => e && e.e && isFinite(e.t)).sort((a, b) => a.t - b.t);
    c.hasFocusEvents = c.events.some(e => e.e === 'FocusCamera');
    const rnd = mulberry32(77);
    c.notes.forEach(n => { if (n.seed === undefined) n.seed = rnd(); });
    c.tc = Cond.build(c.timeChanges, c.bpm); c.bpm = c.tc[0].bpm;
    c.crochet = 60000 / c.bpm;
    c.endTime = c.notes.reduce((m, n) => Math.max(m, n.time + n.sustain), 0) + 1800;
    return c;
  },
};

/* =====================================================================
   ZIP mínimo (.fnfc de V-Slice es un zip) usando DecompressionStream
   ===================================================================== */
const Zip = {
  async read(buf) {
    const dv = new DataView(buf), u8 = new Uint8Array(buf);
    let eocd = -1;
    for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('No es un zip/.fnfc válido');
    const count = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true);
    const out = [], dec = new TextDecoder();
    for (let k = 0; k < count; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
      const local = dv.getUint32(p + 42, true), name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
      p += 46 + nlen + elen + clen;
      const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
      const raw = u8.slice(start, start + csize);
      out.push({ name, data: async () => {
        if (method === 0) return raw.buffer;
        if (method !== 8) throw new Error('Compresión zip no soportada');
        if (typeof DecompressionStream === 'undefined') throw new Error('Tu navegador no puede descomprimir .fnfc');
        return new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer();
      } });
    }
    return out;
  },
};

/* Lee los archivos elegidos (.fnfc/.zip, .json, audio) → { raw, meta, inst, voices, pack }
   pack (V-Slice): variaciones de la canción (song-metadata.json → playData.songVariations;
   song-chart-<var>.json / song-metadata-<var>.json) + audio por variación. */
async function readChartFiles(files) {
  const jsons = [], audio = new Map();     // audio: nombre en minúsculas → { blob, name }
  const audioType = n => n.endsWith('.mp3') ? 'audio/mpeg' : n.endsWith('.wav') ? 'audio/wav' : 'audio/ogg';
  const addAudio = (name, blob) => { const b = name.split('/').pop(); audio.set(b.toLowerCase(), { blob, name: b }); };
  for (const f of files) {
    const n = f.name.toLowerCase();
    if (n.endsWith('.fnfc') || n.endsWith('.zip')) {
      for (const ent of await Zip.read(await f.arrayBuffer())) {
        const en = ent.name.toLowerCase();
        if (en.endsWith('.json')) { try { jsons.push({ name: en.split('/').pop(), data: JSON.parse(new TextDecoder().decode(await ent.data())) }); } catch (e) { console.warn('json inválido en el .fnfc', en, e); } }
        else if (/\.(ogg|mp3|wav)$/.test(en)) addAudio(ent.name, new Blob([await ent.data()], { type: audioType(en) }));
      }
    } else if (n.endsWith('.json')) jsons.push({ name: n, data: JSON.parse(await f.text()) });
    else if (/\.(ogg|mp3|wav)$/.test(n)) addAudio(f.name, f);
  }
  const isMeta = j => j && (j.timeChanges || j.playData);
  const isVSChart = j => j && j.notes && !Array.isArray(j.notes) && typeof j.notes === 'object' && !j.song;
  const charts = {}, metas = {}; let raw = null, meta = null;
  for (const j of jsons) {
    if (j.name === 'manifest.json' && j.data && j.data.songId && !isMeta(j.data)) continue;
    const vm = /-(?:chart|metadata)-([a-z0-9_]+)\.json$/.exec(j.name), v = vm ? vm[1] : 'default';
    if (isMeta(j.data)) { if (!(v in metas)) metas[v] = j.data; if (!meta) meta = j.data; }
    else { if (isVSChart(j.data) && !(v in charts)) charts[v] = j.data; if (!raw) raw = j.data; }
  }
  if (charts.default) raw = charts.default;
  if (metas.default) meta = metas.default;
  if (!raw) throw new Error('no encontré el chart (.json) dentro de lo que cargaste');
  const list = [...audio.values()];
  const inst = (audio.get('inst.ogg') || audio.get('inst.mp3') || list.find(a => /^inst/i.test(a.name)) || {}).blob || null;
  const voices = list.filter(a => !/^inst/i.test(a.name));
  let pack = null;
  if (isVSChart(raw)) pack = buildSongPack(charts.default ? charts : { default: raw }, metas, audio);
  return { raw, meta, inst, voices, pack };
}

/* variaciones disponibles: [{ id, chart, meta }] + entradas del menú de dificultad */
function buildSongPack(charts, metas, audio) {
  const m0 = metas.default || Object.values(metas)[0] || null;
  const listed = (m0 && m0.playData && Array.isArray(m0.playData.songVariations)) ? m0.playData.songVariations.map(String) : [];
  const vars = [], missing = [];
  for (const v of uniq(['default', ...listed, ...Object.keys(charts)])) {
    if (!charts[v]) { if (v !== 'default') missing.push(`variación "${v}": falta ${v === 'default' ? '' : '…-chart-' + v + '.json'}`); continue; }
    const meta = metas[v] || (v === 'default' ? m0 : null);
    if (!meta && v !== 'default') missing.push(`variación "${v}": falta …-metadata-${v}.json (uso la metadata por defecto)`);
    vars.push({ id: v, chart: charts[v], meta: meta || m0 });
  }
  const entries = [];
  for (const va of vars) {
    const inChart = Object.keys(va.chart.notes || {}).filter(k => Array.isArray(va.chart.notes[k]));
    const listedD = va.meta && va.meta.playData && Array.isArray(va.meta.playData.difficulties) ? va.meta.playData.difficulties.map(String) : [];
    const ds = listedD.length ? uniq([...listedD.filter(d => inChart.includes(d)), ...inChart.filter(d => !listedD.includes(d))]) : inChart;
    for (const d of ds) entries.push({ v: va.id, d, label: va.id === 'default' ? d : `${d} (${va.id})` });
  }
  return { vars, entries, audio, missing };
}

/* audio de una variación (V-Slice): Inst[-<instrumental o variación>].ogg y Voices-<personaje>[-<variación>].ogg.
   Solo se devuelven las pistas de ESA variación (nunca todas a la vez). */
function packAudio(pack, vid) {
  const va = pack.vars.find(x => x.id === vid) || pack.vars[0];
  const pd = (va.meta && va.meta.playData) || {}, ch = pd.characters || {};
  const A = pack.audio, get = base => A.get(base.toLowerCase() + '.ogg') || A.get(base.toLowerCase() + '.mp3') || A.get(base.toLowerCase() + '.wav') || null;
  const suf = vid && vid !== 'default' ? '-' + vid : '';
  const out = [], notes = [];
  const instId = ch.instrumental || '';
  const inst = (instId && get('Inst-' + instId)) || (suf && get('Inst' + suf)) || get('Inst');
  if (inst) out.push({ blob: inst.blob, role: 'inst', name: inst.name }); else notes.push(`falta Inst${instId ? '-' + instId : suf}.ogg`);
  const voice = (role, id, list) => {
    const names = uniq([...(Array.isArray(list) && list.length ? list : []), id].filter(Boolean).map(String));
    for (const nm of names) { const f = (suf && get(`Voices-${nm}${suf}`)) || get(`Voices-${nm}`); if (f) { out.push({ blob: f.blob, role, name: f.name }); return; } }
    if (names.length) notes.push(`sin voces de ${role === 'player' ? 'jugador' : 'rival'} (Voices-${names[0]}${suf}.ogg)`);
  };
  voice('player', ch.player, ch.playerVocals);
  voice('opponent', ch.opponent, ch.opponentVocals);
  if (!out.some(t => t.role !== 'inst')) { const v = (suf && get('Voices' + suf)) || get('Voices'); if (v) out.push({ blob: v.blob, role: 'voices', name: v.name }); }
  return { list: out, notes };
}
