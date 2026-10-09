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
    return this.finalize({ title: 'Test Song', artist: 'Chart Editor GCD · Demo', bpm, speed: CONFIG.demoSpeed, notes, isDemo: true });
  },

  /** raw = JSON del chart, meta = JSON de metadata (opcional) */
  parse(raw, meta, wantedDiff) {
    if (!raw || typeof raw !== 'object') throw new Error('JSON vacío');
    // V-Slice: { notes: { easy:[{t,d,l}], normal:[...] }, scrollSpeed:{...} }
    if (raw.notes && !Array.isArray(raw.notes) && typeof raw.notes === 'object') {
      const diffs = Object.keys(raw.notes);
      const diff = (wantedDiff && diffs.includes(wantedDiff)) ? wantedDiff
        : (['hard', 'normal', 'easy'].find(d => diffs.includes(d)) || diffs[0]);
      const list = raw.notes[diff] || [];
      const ss = raw.scrollSpeed || {};
      const speed = +(ss[diff] ?? ss.default ?? ss.normal ?? 1.6) || 1.6;
      const bpm = meta?.timeChanges?.[0]?.bpm || raw.bpm || 100;
      const notes = list.map(n => ({ time: +n.t, lane: (n.d | 0) % 4, side: ((n.d | 0) % 8) < 4 ? 'player' : 'opponent', sustain: +(n.l || 0) }));
      const pc = meta?.playData?.characters || {};
      const scene = { bf: pc.player, dad: pc.opponent, gf: pc.girlfriend, stage: meta?.playData?.stage };
      return this.finalize({ title: meta?.songName || 'Canción', artist: meta?.artist || '', bpm, speed, notes, difficulties: diffs, difficulty: diff, scene });
    }
    // Psych / legacy: { song: { notes:[ {sectionNotes, mustHitSection} ], bpm, speed } }
    const song = raw.song && typeof raw.song === 'object' ? raw.song : raw;
    if (Array.isArray(song.notes) && song.notes.length && song.notes.some(s => s && Array.isArray(s.sectionNotes))) {
      const psychV1 = typeof song.format === 'string' && song.format.startsWith('psych_v1');
      const notes = [];
      song.notes.forEach(sec => (sec.sectionNotes || []).forEach(n => {
        const d = n[1] | 0; if (d < 0 || typeof n[0] !== 'number') return;
        const first = d % 8 < 4;
        const isPlayer = psychV1 ? first : (sec.mustHitSection ? first : !first);
        notes.push({ time: n[0], lane: d % 4, side: isPlayer ? 'player' : 'opponent', sustain: +(n[2] || 0) });
      }));
      const scene = { bf: song.player1, dad: song.player2, gf: song.gfVersion || song.player3 || song.gf, stage: song.stage };
      return this.finalize({ title: song.song || song.songName || 'Canción', artist: song.artist || '', bpm: song.bpm || 100, speed: song.speed || 1.6, notes, scene });
    }
    // Simple: { bpm, notes:[{t,d,l}] } o [{time,column}]
    const arr = Array.isArray(raw) ? raw : Array.isArray(raw.notes) ? raw.notes : null;
    if (arr) {
      const notes = arr.map(n => {
        const d = (n.d ?? n.column ?? n.lane ?? 0) | 0;
        return { time: +(n.t ?? n.time ?? 0), lane: d % 4, side: d % 8 < 4 ? 'player' : 'opponent', sustain: +(n.l ?? n.sustain ?? 0) };
      });
      return this.finalize({ title: raw.title || raw.songName || 'Canción', artist: raw.artist || '', bpm: raw.bpm || 100, speed: raw.speed || 1.6, notes });
    }
    throw new Error('Formato de chart no reconocido');
  },

  finalize(c) {
    if (c.scene) { for (const k of Object.keys(c.scene)) if (!c.scene[k] || typeof c.scene[k] !== 'string') delete c.scene[k]; }
    c.notes = c.notes.filter(n => isFinite(n.time)).sort((a, b) => a.time - b.time);
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

/* Lee los archivos elegidos (.fnfc/.zip, .json, audio) → { raw, meta, inst, voices } */
async function readChartFiles(files) {
  let raw = null, meta = null, inst = null; const voices = [];
  const classify = j => { if (j && (j.timeChanges || j.playData)) meta = j; else if (!raw) raw = j; };
  const audioType = n => n.endsWith('.mp3') ? 'audio/mpeg' : n.endsWith('.wav') ? 'audio/wav' : 'audio/ogg';
  const addAudio = (name, blob) => { const b = name.split('/').pop(); if (/^inst/.test(b)) inst = inst || blob; else voices.push(blob); };
  for (const f of files) {
    const n = f.name.toLowerCase();
    if (n.endsWith('.fnfc') || n.endsWith('.zip')) {
      for (const ent of await Zip.read(await f.arrayBuffer())) {
        const en = ent.name.toLowerCase();
        if (en.endsWith('.json')) classify(JSON.parse(new TextDecoder().decode(await ent.data())));
        else if (/\.(ogg|mp3|wav)$/.test(en)) addAudio(en, new Blob([await ent.data()], { type: audioType(en) }));
      }
    } else if (n.endsWith('.json')) classify(JSON.parse(await f.text()));
    else if (/\.(ogg|mp3|wav)$/.test(n)) addAudio(n, f);
  }
  if (!raw) throw new Error('no encontré el chart (.json) dentro de lo que cargaste');
  return { raw, meta, inst, voices };
}
