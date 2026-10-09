/* =====================================================================
   charts.js — chart demo + lectores de charts (V-Slice .fnfc / chart.json,
   Psych, legacy) y zip mínimo para .fnfc.
   Formato interno: { title, artist, bpm, speed, notes:[{time,lane,side,sustain}], endTime, difficulties, difficulty, scene }
   ===================================================================== */
'use strict';

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

  /** raw = JSON del chart, meta = JSON de metadata (opcional) */
  parse(raw, meta, wantedDiff) {
    if (!raw || typeof raw !== 'object') throw new Error('JSON vacío');
    const pickDiff = diffs => (wantedDiff && diffs.includes(wantedDiff)) ? wantedDiff
      : (['normal', 'hard', 'easy'].find(d => diffs.includes(d)) || diffs[0]);
    // V-Slice: { notes: { easy:[{t,d,l,k}], normal:[...] }, scrollSpeed:{...}, events:[{t,e,v}] }
    if (raw.notes && !Array.isArray(raw.notes) && typeof raw.notes === 'object' && !raw.song) {
      const diffs = Object.keys(raw.notes).filter(k => Array.isArray(raw.notes[k]));
      const diff = pickDiff(diffs);
      const list = raw.notes[diff] || [];
      const ss = raw.scrollSpeed || {};
      const speed = +(ss[diff] ?? ss.default ?? ss.normal ?? 1.6) || 1.6;
      const bpm = meta?.timeChanges?.[0]?.bpm || raw.bpm || 100;
      const notes = list.map(n => ({ time: +n.t, lane: (n.d | 0) % 4, side: ((n.d | 0) % 8) < 4 ? 'player' : 'opponent', sustain: +(n.l || 0), kind: n.k || '', params: Array.isArray(n.p) ? n.p : null, raw: n.d | 0 }));
      const pc = meta?.playData?.characters || {};
      const scene = { bf: pc.player, dad: pc.opponent, gf: pc.girlfriend, stage: meta?.playData?.stage };
      const events = (Array.isArray(raw.events) ? raw.events : []).map(e => ({ t: +e.t || 0, e: String(e.e || ''), v: e.v }));
      return this.finalize({ title: meta?.songName || 'Canción', artist: meta?.artist || '', bpm, speed, notes, events, difficulties: diffs, difficulty: diff, scene, format: 'V-Slice' });
    }
    // Legacy / Psych / SongConverter: { song: { notes:[secciones] | {normal:[secciones]}, bpm, speed: n | {normal:n} } }
    const song = raw.song && typeof raw.song === 'object' ? raw.song : raw;
    let secs = song.notes, diffs = null, diff = null;
    if (secs && !Array.isArray(secs) && typeof secs === 'object') {          // formato de la canción "test" (FNF SongConverter): notas por dificultad
      diffs = Object.keys(secs).filter(k => Array.isArray(secs[k]));
      if (diffs.length) { diff = pickDiff(diffs); secs = secs[diff]; }
    }
    if (Array.isArray(secs) && secs.some(s => s && Array.isArray(s.sectionNotes))) {
      const psychV1 = typeof song.format === 'string' && song.format.startsWith('psych_v1');
      const notes = [], events = [];
      const bpm0 = +song.bpm || 100;
      let bpm = bpm0, t = 0, lastFocus = null;
      secs.forEach(sec => {
        if (sec.changeBPM && +sec.bpm > 0) bpm = +sec.bpm;
        const steps = +sec.lengthInSteps || (+sec.sectionBeats ? sec.sectionBeats * 4 : 16);
        // cámara: V-Slice convierte mustHitSection en eventos FocusCamera
        const focus = sec.gfSection ? 2 : (sec.mustHitSection ? 0 : 1);
        if (focus !== lastFocus) { events.push({ t, e: 'FocusCamera', v: { char: focus }, auto: true }); lastFocus = focus; }
        (sec.sectionNotes || []).forEach(n => {
          if (!Array.isArray(n)) return;
          if (typeof n[1] !== 'number' || n[1] < 0) { if (typeof n[2] === 'string') events.push(...this.psychEvent(+n[0], n[2], n[3], n[4], bpm)); return; }
          const d = n[1] | 0; if (typeof n[0] !== 'number') return;
          const first = d % 8 < 4;
          const isPlayer = psychV1 ? first : (sec.mustHitSection ? first : !first);
          notes.push({ time: n[0], lane: d % 4, side: isPlayer ? 'player' : 'opponent', sustain: +(n[2] || 0), kind: typeof n[3] === 'string' ? n[3] : '' });
        });
        t += steps * (60000 / bpm / 4);
      });
      if (Array.isArray(song.events)) song.events.forEach(ev => (Array.isArray(ev[1]) ? ev[1] : []).forEach(x => events.push(...this.psychEvent(+ev[0], x[0], x[1], x[2], bpm0))));
      if (Array.isArray(raw.events)) raw.events.forEach(e => { if (e && e.e) events.push({ t: +e.t || 0, e: String(e.e), v: e.v }); });
      const sp = song.speed && typeof song.speed === 'object' ? (song.speed[diff] ?? song.speed.normal ?? Object.values(song.speed)[0]) : song.speed;
      const scene = { bf: song.player1, dad: song.player2, gf: song.gfVersion || song.player3 || song.gf, stage: song.stage || song.stageDefault };
      return this.finalize({ title: song.song || song.songName || 'Canción', artist: song.artist || '', bpm: bpm0, speed: +sp || 1.6, notes, events, scene,
        difficulties: diffs || null, difficulty: diff, voiceList: Array.isArray(song.voiceList) ? song.voiceList : null, needsVoices: song.needsVoices !== false,
        format: raw.generatedBy ? `legacy (${raw.generatedBy})` : psychV1 ? 'Psych 1.0' : 'legacy/Psych' });
    }
    // Simple: { bpm, notes:[{t,d,l}] } o [{time,column}]
    const arr = Array.isArray(raw) ? raw : Array.isArray(raw.notes) ? raw.notes : null;
    if (arr) {
      const notes = arr.map(n => {
        const d = (n.d ?? n.column ?? n.lane ?? 0) | 0;
        return { time: +(n.t ?? n.time ?? 0), lane: d % 4, side: d % 8 < 4 ? 'player' : 'opponent', sustain: +(n.l ?? n.sustain ?? 0) };
      });
      return this.finalize({ title: raw.title || raw.songName || 'Canción', artist: raw.artist || '', bpm: raw.bpm || 100, speed: raw.speed || 1.6, notes, events: raw.events || [] });
    }
    throw new Error('Formato de chart no reconocido');
  },

  /* Eventos de Psych → eventos de V-Slice equivalentes */
  psychEvent(t, name, v1, v2, bpm) {
    const who = x => { x = String(x ?? '').toLowerCase().trim(); return /^(1|dad|opponent)$/.test(x) ? 'dad' : /^(2|gf|girlfriend)$/.test(x) ? 'gf' : 'bf'; };
    switch (String(name || '')) {
      case 'Hey!': { const w = String(v1 || '').toLowerCase(); const out = [];
        if (!/^(gf|girlfriend|1)$/.test(w)) out.push({ t, e: 'PlayAnimation', v: { target: 'bf', anim: 'hey', force: true } });
        if (!/^(bf|boyfriend|0)$/.test(w)) out.push({ t, e: 'PlayAnimation', v: { target: 'gf', anim: 'cheer', force: true } });
        return out; }
      case 'Play Animation': return [{ t, e: 'PlayAnimation', v: { target: who(v2), anim: String(v1 || ''), force: true } }];
      case 'Change Scroll Speed': { const sec = +v2 || 0; return [{ t, e: 'ScrollSpeed', v: { scroll: +v1 || 1, absolute: false, duration: sec * 1000 / (60000 / bpm / 4), ease: sec ? 'linear' : 'INSTANT' } }]; }
      case 'Camera Follow Pos': return (v1 === '' && v2 === '') ? [] : [{ t, e: 'FocusCamera', v: { char: -1, x: +v1 || 0, y: +v2 || 0, ease: 'CLASSIC' } }];
      default: return [];
    }
  },

  finalize(c) {
    if (c.scene) { for (const k of Object.keys(c.scene)) if (!c.scene[k] || typeof c.scene[k] !== 'string') delete c.scene[k]; }
    c.notes = c.notes.filter(n => isFinite(n.time)).sort((a, b) => a.time - b.time);
    c.events = (c.events || []).filter(e => e && e.e && isFinite(e.t)).sort((a, b) => a.t - b.t);
    c.hasFocusEvents = c.events.some(e => e.e === 'FocusCamera');
    const rnd = mulberry32(77);
    c.notes.forEach(n => { if (n.seed === undefined) n.seed = rnd(); });
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
