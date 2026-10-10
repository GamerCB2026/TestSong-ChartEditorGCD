/* =====================================================================
   importar.js — Pausa → "Chart y modo" (v3.6.0): CARGADOR DE MOTOR.
   Se elige el motor (V-Slice, Psych, Codename, Kade) y la carpeta o el .zip
   del mod. Se registra TODO el mod (imágenes, personajes, escenarios, audio,
   scripts, shaders, videos) y se listan sus canciones; al elegir una se carga
   sola con lo que necesita (chart, metadata, audio, personajes, escenario,
   iconos, scripts de eventos / note kinds / escenario, shaders, videos).
   · V-Slice: .hxc (scripts de escenario, eventos, note kinds, módulos);
     data/songs/<id>/<id>-metadata[-var].json + <id>-chart[-var].json; songs/<id>/Inst… Voices…
   · Psych / Kade: .lua; data/<canción>/<canción>-<dif>.json · songs/<canción>/Inst.ogg…
   · Codename: .hx; songs/<canción>/charts/<dif>.json · songs/<canción>/song/Inst.ogg…
   ===================================================================== */
'use strict';

const ENGINE_LAYOUT = {
  vslice: { name: 'V-Slice', hint: 'data/songs/<id>/<id>-chart.json + -metadata.json (y -<variación>) · songs/<id>/Inst.ogg, Voices-<personaje>.ogg · scripts/**/*.hxc · data/characters · data/stages · images/ · shaders/' },
  psych: { name: 'Psych Engine', hint: 'data/<canción>/<canción>-<dif>.json · songs/<canción>/Inst.ogg, Voices.ogg · characters/*.json · stages/*.json + .lua · images/ · shaders/' },
  codename: { name: 'Codename Engine', hint: 'songs/<canción>/charts/<dif>.json + meta.json · songs/<canción>/song/Inst.ogg · data/characters/*.xml · data/stages/*.xml + .hx · images/ · shaders/' },
  kade: { name: 'Kade Engine', hint: 'data/<canción>/<canción>-<dif>.json · songs/<canción>/Inst.ogg, Voices.ogg · characters · images/' },
};
const DIFF_ORDER = ['easy', 'normal', 'hard', 'erect', 'nightmare'];
const sortDiffs = ds => ds.slice().sort((a, b) => { const ia = DIFF_ORDER.indexOf(a), ib = DIFF_ORDER.indexOf(b); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b); });
/* carpetas de primer nivel de un mod (lo de antes es la carpeta raíz del mod / del zip) */
const MOD_TOP = /^(characters|stages|images|data|shared|preload|videos|sounds|music|shaders|fonts|week\d+|weekend\d+|songs|scripts|custom_events|custom_notetypes|weeks|notetypes|events)$/i;
const TEXT_EXT = /\.(frag|vert|glsl|lua|hx|hxs|hxc|txt)$/i;

const SongImport = {
  sel: 'vslice', engine: null, mod: null, cur: null, gen: 0, busy: false,
  relOf: f => (f.webkitRelativePath || f._rel || f.name).replace(/\\/g, '/'),
  isAudio: n => /\.(ogg|mp3|wav)$/i.test(n),
  mime(n) { return /\.mp3$/i.test(n) ? 'audio/mpeg' : /\.wav$/i.test(n) ? 'audio/wav' : /\.ogg$/i.test(n) ? 'audio/ogg' : /\.png$/i.test(n) ? 'image/png' : /\.mp4$/i.test(n) ? 'video/mp4' : /\.webm$/i.test(n) ? 'video/webm' : /\.gif$/i.test(n) ? 'image/gif' : /\.json$/i.test(n) ? 'application/json' : ''; },
  /* ruta dentro del mod: desde la primera carpeta conocida (data/, images/, songs/…) */
  strip(rel) { const p = rel.split('/').filter(Boolean); const i = p.findIndex((s, k) => k < p.length - 1 && MOD_TOP.test(s)); return i < 0 ? null : p.slice(i).join('/'); },

  /* ---------- entrada: carpeta o .zip ---------- */
  fromFolder(files) { return files.map(f => ({ rel: this.relOf(f), name: f.name, blob: f })); },
  async fromZip(file) {
    const out = [];
    for (const e of await Zip.read(await file.arrayBuffer())) {
      if (e.name.endsWith('/')) continue;
      const name = e.name.split('/').pop(); if (!name || name.startsWith('.')) continue;
      out.push({ rel: e.name, name, blob: new Blob([await e.data()], { type: this.mime(name) }) });
    }
    return out;
  },
  async pickMod(zip) {
    const files = zip ? await ModUI.pick('.zip', false) : await ModUI.pick('', true, true);
    if (!files.length) return;
    this.busy = true; this.render();
    try {
      const entries = zip ? await this.fromZip(files[0]) : this.fromFolder(files);
      const name = zip ? files[0].name.replace(/\.zip$/i, '') : (this.relOf(files[0]).split('/')[0] || 'mod');
      await this.mount(entries, this.sel, name);
    } finally { this.busy = false; this.render(); }
  },

  /* ---------- registro del mod ---------- */
  unmount() {
    const m = this.mod; if (!m) return;
    for (const k of m.keys) { const f = VFS.files.get(k); if (f && f.url) URL.revokeObjectURL(f.url); VFS.files.delete(k); }
    for (const rec of m.recs) if (Mods.scripts.get(rec.name) === rec) Mods.unregister(rec);
    try { StageRT.key = null; StageRT.start(); } catch (e) {}
    ModText.map.clear(); CamFilters.clear(); if (typeof ModRes !== 'undefined') ModRes.cache.clear();
    this.mod = null; this.cur = null; this.engine = null; Scene.ids = null;
  },
  async mount(entries, engine, name) {
    this.unmount();
    const m = { name, engine, keys: [], recs: [], fails: [], files: 0, images: 0, scripts: [], songs: new Map(), entries: [] };
    for (const e of entries) {
      const rel = this.strip(e.rel); if (!rel) continue;
      e.path = rel; m.entries.push(e); m.files++;
      m.keys.push(VFS.put(rel, e.blob, e.name));
      // V-Slice busca las imágenes y sonidos también en la librería shared/
      if (/^(images|sounds|music)\//i.test(rel)) m.keys.push(VFS.put('shared/' + rel, e.blob, e.name));
      if (/^images\/.*\.(png|astc|ktx2?|jpe?g|webp)$/i.test(rel)) m.images++;
      // v3.7.0: también json/xml pequeños → Assets.getText / File.getContent síncronos desde los scripts
      if (TEXT_EXT.test(e.name) || (/\.(json|xml|ini|csv)$/i.test(e.name) && e.blob.size < 512 * 1024)) ModText.put(rel, await e.blob.text());
    }
    // scripts del motor
    const scriptRx = engine === 'vslice' ? /\.hxc$/i : engine === 'codename' ? /\.(hx|hxs)$/i : /\.lua$/i;
    for (const e of m.entries) if (scriptRx.test(e.name)) m.scripts.push(e.path);
    if (engine === 'vslice') {
      for (const e of m.entries) {
        if (!/\.hxc$/i.test(e.name)) continue;
        try { m.recs.push(Mods.load(e.name, ModText.get(e.path))); }
        catch (err) { console.warn('[hxc]', e.path, err); m.fails.push(`${e.name}: ${err.message}`); Mods.failed = Mods.failed || new Map(); Mods.failed.set(e.name, err.message); }
      }
      m.songs = await this.vsSongs(m.entries);
    } else m.songs = this.groupEngine(await this.items(m.entries, engine), engine);
    this.mod = m; this.gen++; Scene.ids = null; StageRT.key = null;
    const c = this.counts();
    toast(`✔ ${ENGINE_LAYOUT[engine].name} · ${name}: ${m.files} archivos · ${c.txt} · ${m.images} imágenes · ${m.songs.size} canción(es)${m.fails.length ? ' · ✘ ' + m.fails.length + ' script(s) con error' : ''}`, 5000);
    if (!m.songs.size) toast(`No encontré canciones de ${ENGINE_LAYOUT[engine].name} (${ENGINE_LAYOUT[engine].hint})`, 7000);
    return m;
  },
  counts() {
    const m = this.mod; if (!m) return { txt: '' };
    if (m.engine !== 'vslice') return { txt: `${m.scripts.length} script(s) ${m.engine === 'codename' ? '.hx' : '.lua'}` };
    const n = k => m.recs.reduce((a, r) => a + (r[k] ? r[k].length : 0), 0);
    return { txt: `${m.scripts.length} .hxc (${n('events')} eventos · ${n('kinds')} note kinds · ${n('stages')} escenarios · ${n('modules') - n('stages')} módulos)` };
  },
  /* V-Slice: data/songs/<id>/<id>-chart[-var].json + <id>-metadata[-var].json; audio en songs/<id>/ */
  async vsSongs(entries) {
    const songs = new Map();
    const song = id => { if (!songs.has(id)) songs.set(id, { id, title: id, charts: {}, metas: {}, audio: new Map(), engine: 'vslice' }); return songs.get(id); };
    for (const e of entries) {
      const p = e.path.toLowerCase().split('/');
      if (p[0] === 'data' && p[1] === 'songs' && p.length === 4 && p[3].endsWith('.json')) {
        const id = p[2], idRx = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), m = new RegExp('^' + idRx + '-(chart|metadata)(?:-([a-z0-9_-]+))?\\.json$').exec(p[3]); if (!m) continue;
        let j; try { j = JSON.parse(await e.blob.text()); } catch (err) { console.warn('json inválido', e.path); continue; }
        const s = song(id), v = m[2] || 'default';
        if (m[1] === 'chart') s.charts[v] = j; else { s.metas[v] = j; if (v === 'default' && j.songName) s.title = j.songName; }
      }
    }
    for (const e of entries) {
      const p = e.path.toLowerCase().split('/');
      if (p[0] === 'songs' && p.length === 3 && this.isAudio(p[2]) && songs.has(p[1])) songs.get(p[1]).audio.set(e.name.toLowerCase(), { blob: e.blob, name: e.name });
    }
    for (const [k, s] of [...songs]) if (!Object.keys(s.charts).length) songs.delete(k);
    for (const s of songs.values()) {
      const vars = uniq(['default', ...Object.keys(s.charts)]).filter(v => s.charts[v]);
      s.diffs = vars.map(v => { const md = s.metas[v] && s.metas[v].playData && s.metas[v].playData.difficulties; return (v === 'default' ? '' : v + ': ') + (md || Object.keys(s.charts[v].notes || {})).join(', '); });
    }
    return songs;
  },
  /* Psych / Codename / Kade → [{ name, rel, json|blob }] para groupEngine */
  async items(entries, engine) {
    const out = [];
    for (const e of entries) {
      const p = e.path.toLowerCase().split('/');
      if (this.isAudio(e.name) && p[0] === 'songs') { out.push({ name: e.name, rel: e.path, blob: e.blob }); continue; }
      if (!/\.json$/i.test(e.name)) continue;
      const chartJson = engine === 'codename' ? p[0] === 'songs' : (p[0] === 'data' && p.length === 3 && !/^(characters|stages|weeks|songs|notestyles|players|ui)$/.test(p[1])) || (p[0] === 'songs' && p.length === 3);
      if (!chartJson) continue;
      try { out.push({ name: e.name, rel: e.path, json: JSON.parse(await e.blob.text()) }); } catch (err) { console.warn('json inválido', e.path); }
    }
    return out;
  },
  /* agrupa por canción según la estructura de cada motor */
  groupEngine(items, engine) {
    const songs = new Map();
    const song = id => { if (!songs.has(id)) songs.set(id, { id, title: id, diffs: {}, meta: null, extra: { events: [], psychEvents: [] }, audio: new Map(), format: '', engine }); return songs.get(id); };
    const parts = it => it.rel.split('/');
    const audioItems = items.filter(i => i.blob), jsonItems = items.filter(i => i.json);
    for (const it of jsonItems) {
      const p = parts(it), base = it.name.replace(/\.json$/i, ''), lower = base.toLowerCase();
      const fmt = Chart.detect(it.json);
      if (engine === 'codename') {
        const ci = p.findIndex(x => x.toLowerCase() === 'charts');
        const sid = (ci > 0 ? p[ci - 1] : (p.length > 1 ? p[p.length - 2] : (it.json.meta && it.json.meta.name) || 'cancion'));
        if (lower === 'meta') { song(sid).meta = it.json; continue; }
        if (lower === 'events' && Array.isArray(it.json.events)) { song(ci > 0 ? p[ci - 1] : sid).extra.events.push(...it.json.events); continue; }
        if (fmt !== 'Codename') continue;
        const s = song(sid); s.diffs[lower] = it.json; s.format = 'Codename';
      } else {
        // Psych / Kade: data/<canción>/<canción>[-dif].json (+ events.json)
        const di = p.findIndex(x => x.toLowerCase() === 'data');
        const dirName = p.length > 1 ? p[p.length - 2] : '';
        if (lower === 'events') { const ev = it.json.song && it.json.song.events || it.json.events; if (Array.isArray(ev)) song((dirName || 'cancion').toLowerCase()).extra.psychEvents.push(...ev); continue; }
        if (!['Psych 0.6', 'Psych 0.7', 'Psych 1.0', 'Kade', 'legacy'].includes(fmt)) continue;
        let sid = (dirName && (di < 0 || p.length - 2 > di) ? dirName : (it.json.song && it.json.song.song) || base).toLowerCase();
        let diff = 'normal';
        const m = new RegExp('^' + sid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '-(.+)$', 'i').exec(base);
        if (m) diff = m[1].toLowerCase();
        else if (lower !== sid) { const k = /-(easy|normal|hard|erect|nightmare|[a-z]+)$/i.exec(base); if (k && !dirName) { diff = k[1].toLowerCase(); sid = base.slice(0, -k[0].length).toLowerCase(); } else if (lower !== sid) diff = lower; }
        const s = song(sid); s.diffs[diff] = it.json; s.format = s.format && s.format !== fmt ? s.format : fmt;
        s.title = (it.json.song && it.json.song.song) || sid;
      }
    }
    // audio: songs/<canción>/… (Codename: songs/<canción>/song/…); si no se puede ubicar, va a todas
    for (const a of audioItems) {
      const p = parts(a).map(x => x.toLowerCase());
      const si = p.lastIndexOf('songs');
      const sid = si >= 0 && p.length > si + 2 ? p[si + 1] : (engine === 'codename' && p.length > 2 && p[p.length - 2] === 'song' ? p[p.length - 3] : (p.length > 1 ? p[p.length - 2] : ''));
      const targets = songs.has(sid) ? [songs.get(sid)] : [...songs.values()].filter(s => s.id.toLowerCase() === sid || s.title.toLowerCase() === sid);
      for (const s of (targets.length ? targets : songs.values())) s.audio.set(a.name.toLowerCase(), { blob: a.blob, name: a.name });
    }
    for (const [k, s] of [...songs]) if (!Object.keys(s.diffs).length) songs.delete(k);
    for (const s of songs.values()) if (s.meta) s.title = s.meta.displayName || s.meta.name || s.title;
    return songs;
  },

  /* ---------- jugar una canción del mod ---------- */
  async play(id, diff) {
    const m = this.mod, s = m && m.songs.get(id); if (!s) return;
    this.engine = m.engine; this.cur = id; Scene.ids = null; StageRT.key = null;
    if (G.mode === 'demo') setMode('keyboard');
    if (m.engine === 'vslice') {
      const pack = buildSongPack(s.charts, s.metas, s.audio);
      const ent = pack.entries.find(e => e.v === 'default' && e.d === (diff || 'normal')) || pack.entries.find(e => e.v === 'default') || pack.entries[0];
      if (!ent) { toast(`${s.title}: el chart no tiene notas`); return; }
      G.set = null;
      await loadVariation(pack, ent.v, ent.d);
    } else await loadEngineSong(s, diff);
    // el script de escenario / shaders del mod se aplican ya (aunque el juego siga en pausa)
    try { StageRT.key = null; StageRT.tick(); } catch (e) { console.warn('[mod] escenario', e); }
    this.render();
  },

  /* ---------- panel ---------- */
  render() {
    const box = $('impBox'); if (!box) return;
    const esc = escHtml, h = [], m = this.mod, L = ENGINE_LAYOUT[this.sel];
    h.push(`<h4>Motor</h4><div class="imp-eng">${Object.entries(ENGINE_LAYOUT).map(([k, v]) => `<button class="btn mini ${k === this.sel ? 'sel' : 'alt'}" type="button" data-eng="${k}">${esc(v.name)}</button>`).join('')}</div>`);
    h.push(`<p class="hint">${esc(L.hint)}</p>`);
    h.push(`<div class="imp-row"><button class="btn mini" type="button" data-imp="dir" ${this.busy ? 'disabled' : ''}>📁 Carpeta del mod</button><button class="btn mini alt" type="button" data-imp="zip" ${this.busy ? 'disabled' : ''}>🗜 .zip del mod</button>${this.sel === 'vslice' ? '<button class="btn mini alt" type="button" data-imp="gcd">📀 Chart GCD</button>' : ''}</div>`);
    if (this.busy) h.push('<div class="imp-st">⏳ Leyendo el mod…</div>');
    if (m) {
      const c = this.counts();
      h.push(`<div class="imp-st">✔ <b>${esc(m.name)}</b> (${esc(ENGINE_LAYOUT[m.engine].name)}) · ${m.files} archivos · ${esc(c.txt)} · ${m.images} imágenes · ${m.songs.size} canción(es)${m.fails.length ? '<br>✘ ' + esc(m.fails.join(' · ')) : ''}</div>`);
      if (m.songs.size) {
        h.push('<h4>Canciones</h4><div class="imp-songs">');
        for (const s of m.songs.values()) {
          const info = m.engine === 'vslice' ? s.diffs.join(' · ') : sortDiffs(Object.keys(s.diffs)).join(', ') + ' · ' + s.format;
          h.push(`<button class="btn imp-song ${this.cur === s.id && m.engine === this.engine ? 'sel' : ''}" type="button" data-song="${esc(s.id)}"><b>${esc(s.title)}</b><small>${esc(info)}</small></button>`);
        }
        h.push('</div>');
      }
    }
    box.innerHTML = h.join('');
    const run = p => Promise.resolve(p).catch(err => { console.error(err); toast('Error: ' + err.message, 5000); this.busy = false; this.render(); });
    box.querySelectorAll('[data-eng]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); e.preventDefault(); this.sel = b.dataset.eng; this.render(); }));
    box.querySelectorAll('[data-imp]').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation(); e.preventDefault();
      const a = b.dataset.imp;
      if (a === 'gcd') toast('Chart GCD: Próximamente');
      else run(this.pickMod(a === 'zip'));
    }));
    box.querySelectorAll('[data-song]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); e.preventDefault(); run(this.play(b.dataset.song)); }));
  },
};

/* audio de Psych / Codename / Kade: Inst.ogg + Voices-Player/Opponent.ogg (Psych 1.0), Voices-<personaje>.ogg o Voices.ogg */
function engineAudio(A, scene, suffix = '') {
  const get = b => { b = b.toLowerCase(); return A.get(b + '.ogg') || A.get(b + '.mp3') || A.get(b + '.wav') || null; };
  const out = [], notes = [], sc = scene || {};
  const suf = suffix ? '-' + suffix : '';
  const inst = (suf && get('Inst' + suf)) || get('Inst');
  if (inst) out.push({ blob: inst.blob, role: 'inst', name: inst.name }); else notes.push('falta Inst.ogg');
  const pl = (suf && get('Voices-Player' + suf)) || get('Voices-Player') || (sc.bf && get('Voices-' + sc.bf)) || null;
  const op = (suf && get('Voices-Opponent' + suf)) || get('Voices-Opponent') || (sc.dad && get('Voices-' + sc.dad)) || null;
  if (pl) out.push({ blob: pl.blob, role: 'player', name: pl.name });
  if (op) out.push({ blob: op.blob, role: 'opponent', name: op.name });
  if (!pl && !op) { const v = (suf && get('Voices' + suf)) || get('Voices'); if (v) out.push({ blob: v.blob, role: 'voices', name: v.name }); else notes.push('sin voces (Voices.ogg)'); }
  return { list: out, notes };
}

/* carga una canción de Psych / Codename / Kade (G.set: una dificultad por archivo) */
async function loadEngineSong(s, diff) {
  const ds = sortDiffs(Object.keys(s.diffs));
  const d = diff && s.diffs[diff] ? diff : (ds.includes('normal') ? 'normal' : ds[0]);
  const chart = Chart.parse(s.diffs[d], s.meta, d, s.extra);
  chart.difficulties = ds; chart.difficulty = d;
  if (s.title && (!chart.title || chart.title === 'Canción')) chart.title = s.title;
  G.set = s; G.pack = null; G.variation = 'default'; G.raw = s.diffs[d]; G.meta = s.meta;
  const au = engineAudio(s.audio, chart.scene);
  SongLoad.missing = au.notes.map(n => `audio: ${n}`);
  await loadChart(chart, au.list, { label: `Cargando ${chart.format}…`, minMs: 300 });
  toast(`${chart.title} · ${d} · ${chart.format} · ${chart.notes.length} notas · audio: ${au.list.map(t => t.name).join(', ') || 'ninguno'}`, 3500);
}
