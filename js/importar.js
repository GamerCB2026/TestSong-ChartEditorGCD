/* =====================================================================
   importar.js — Pausa → "Chart y modo" (v3.4.0):
   · V-Slice: "Asignar Chart" (song-chart[-var].json / .fnfc) + "Asignar Metadata"
     (song-metadata[-var].json): se listan TODAS las variaciones que declara la
     metadata (playData.songVariations) y se elige cuál jugar.
   · "Asignar Song": carpeta con el audio → Inst[-var].ogg, Voices-<personaje>[-var].ogg,
     Voices-Player/Opponent.ogg, Voices.ogg (para la canción normal y cada variación).
   · Otros motores (Psych 0.6/0.7/1.0, Codename, Kade): carpeta de la canción o del mod
     con su estructura propia; se detecta el formato y se convierte al interno.
   ===================================================================== */
'use strict';

const ENGINE_LAYOUT = {
  psych: { name: 'Psych Engine', hint: 'data/<canción>/<canción>-<dif>.json (+ events.json) · songs/<canción>/Inst.ogg, Voices.ogg o Voices-Player.ogg / Voices-Opponent.ogg' },
  codename: { name: 'Codename Engine', hint: 'songs/<canción>/charts/<dif>.json (+ events.json) · songs/<canción>/song/Inst.ogg, Voices.ogg · songs/<canción>/meta.json' },
  kade: { name: 'Kade Engine', hint: 'data/<canción>/<canción>-<dif>.json · songs/<canción>/Inst.ogg, Voices.ogg' },
};
const DIFF_ORDER = ['easy', 'normal', 'hard', 'erect', 'nightmare'];
const sortDiffs = ds => ds.slice().sort((a, b) => { const ia = DIFF_ORDER.indexOf(a), ib = DIFF_ORDER.indexOf(b); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b); });

const SongImport = {
  vs: { charts: {}, metas: {}, chartNames: [], metaNames: [], audio: new Map(), audioFrom: '', sel: null },
  eng: { engine: 'psych', songs: null, song: null, audioFrom: '' },
  relOf: f => (f.webkitRelativePath || f._rel || f.name).replace(/\\/g, '/'),
  isAudio: n => /\.(ogg|mp3|wav)$/i.test(n),
  audioType: n => /\.mp3$/i.test(n) ? 'audio/mpeg' : /\.wav$/i.test(n) ? 'audio/wav' : 'audio/ogg',

  /* archivos (y el contenido de .fnfc/.zip) → [{ name, rel, json|blob }] */
  async expand(files) {
    const out = [];
    for (const f of files) {
      const n = f.name.toLowerCase(), rel = this.relOf(f);
      if (/\.(fnfc|zip)$/.test(n)) {
        for (const ent of await Zip.read(await f.arrayBuffer())) {
          const en = ent.name.split('/').pop();
          if (/\.json$/i.test(en)) { try { out.push({ name: en, rel: ent.name, json: JSON.parse(new TextDecoder().decode(await ent.data())) }); } catch (e) { console.warn('json inválido', ent.name); } }
          else if (this.isAudio(en)) out.push({ name: en, rel: ent.name, blob: new Blob([await ent.data()], { type: this.audioType(en) }) });
        }
      } else if (/\.json$/.test(n)) { try { out.push({ name: f.name, rel, json: JSON.parse(await f.text()) }); } catch (e) { toast(`${f.name}: JSON inválido (${e.message})`, 4000); } }
      else if (this.isAudio(n)) out.push({ name: f.name, rel, blob: f });
    }
    return out;
  },
  /* audio: nombre en minúsculas → { blob, name } (lo que espera packAudio) */
  audioMap(items) { const m = new Map(); for (const it of items) if (it.blob) m.set(it.name.toLowerCase(), { blob: it.blob, name: it.name }); return m; },
  varOf(name) { const m = /-(?:chart|metadata)-([a-z0-9_-]+)\.json$/i.exec(name); return m ? m[1].toLowerCase() : 'default'; },

  /* ---------- V-Slice ---------- */
  async assignChart() {
    const files = await ModUI.pick('.json,.fnfc,.zip', true); if (!files.length) return;
    const items = await this.expand(files);
    let nc = 0, nm = 0;
    for (const it of items) {
      if (!it.json) continue;
      if (it.json.timeChanges || it.json.playData) { this.vs.metas[this.varOf(it.name)] = it.json; this.vs.metaNames.push(it.name); nm++; continue; }
      if (Chart.detect(it.json) !== 'V-Slice') { toast(`${it.name}: no es un chart de V-Slice (${Chart.detect(it.json)}) → usa "Otros motores"`, 4500); continue; }
      this.vs.charts[this.varOf(it.name)] = it.json; this.vs.chartNames.push(it.name); nc++;
    }
    const au = items.filter(i => i.blob);
    if (au.length) { for (const [k, v] of this.audioMap(au)) this.vs.audio.set(k, v); this.vs.audioFrom = files[0].name; }
    toast(`Chart: ${nc} archivo(s)${nm ? ` · metadata: ${nm}` : ''}${au.length ? ` · audio: ${au.length}` : ''}`);
    this.render();
  },
  async assignMeta() {
    const files = await ModUI.pick('.json', true); if (!files.length) return;
    let n = 0;
    for (const it of await this.expand(files)) {
      if (!it.json || !(it.json.timeChanges || it.json.playData)) { toast(`${it.name}: no parece una metadata de V-Slice (sin timeChanges/playData)`, 4000); continue; }
      this.vs.metas[this.varOf(it.name)] = it.json; this.vs.metaNames.push(it.name); n++;
    }
    if (n) toast(`Metadata: ${n} archivo(s) · variaciones: ${this.variations().join(', ')}`, 3500);
    this.render();
  },
  async assignSong(dir) {
    const files = await ModUI.pick('.ogg,.mp3,.wav', true, dir); if (!files.length) return;
    const au = (await this.expand(files.filter(f => this.isAudio(f.name)))).filter(i => i.blob);
    if (!au.length) { toast('No encontré .ogg/.mp3/.wav en lo que elegiste'); return; }
    this.vs.audio = this.audioMap(au); this.vs.audioFrom = dir ? (this.relOf(files[0]).split('/')[0] || 'carpeta') : `${au.length} archivo(s)`;
    toast(`Song: ${au.length} pistas (${au.map(a => a.name).slice(0, 6).join(', ')}${au.length > 6 ? '…' : ''})`, 3500);
    this.render();
  },
  /* todas las variaciones que declara la metadata (+ las que tienen chart o metadata propia) */
  variations() {
    const m0 = this.vs.metas.default || Object.values(this.vs.metas)[0];
    const listed = m0 && m0.playData && Array.isArray(m0.playData.songVariations) ? m0.playData.songVariations.map(v => String(v).toLowerCase()) : [];
    return uniq(['default', ...listed, ...Object.keys(this.vs.metas), ...Object.keys(this.vs.charts)]);
  },
  vsPack() {
    if (!Object.keys(this.vs.charts).length) return null;
    const charts = Object.assign({}, this.vs.charts);
    // un solo chart sin sufijo de variación: es el de la canción normal
    if (!charts.default && Object.keys(charts).length === 1 && !Object.keys(this.vs.metas).length) { charts.default = Object.values(charts)[0]; }
    return buildSongPack(charts, this.vs.metas, this.vs.audio);
  },
  async playVS() {
    const pack = this.vsPack();
    if (!pack || !pack.entries.length) { toast('Falta el chart (song-chart.json) de V-Slice'); return; }
    const v = this.vs.sel && pack.vars.some(x => x.id === this.vs.sel) ? this.vs.sel : (pack.vars.find(x => x.id === 'default') || pack.vars[0]).id;
    const ent = pack.entries.find(e => e.v === v && e.d === 'normal') || pack.entries.find(e => e.v === v);
    if (!ent) { toast(`La variación "${v}" no tiene chart: asigna song-chart-${v}.json`, 4000); return; }
    if (G.mode === 'demo') setMode('keyboard');
    G.set = null;
    await loadVariation(pack, ent.v, ent.d);
  },

  /* ---------- otros motores ---------- */
  async pickEngine(dir) {
    const files = await ModUI.pick('.json,.ogg,.mp3,.wav,.xml,.png,.lua,.hx', true, dir); if (!files.length) return;
    // v3.5.0: personajes / escenarios / imágenes / scripts del mod quedan disponibles en su formato (motores.js)
    const mounted = EngineData.mount(files); if (mounted) { Scene.ids = null; console.info(`[motores] ${mounted} archivo(s) del mod disponibles (personajes, escenarios, imágenes)`); }
    const items = await this.expand(files);
    const songs = this.groupEngine(items, this.eng.engine);
    if (!songs.size) { toast(`No encontré charts de ${ENGINE_LAYOUT[this.eng.engine].name} (${ENGINE_LAYOUT[this.eng.engine].hint})`, 6000); return; }
    this.eng.songs = songs; this.eng.song = [...songs.keys()][0];
    this.eng.audioFrom = dir ? (this.relOf(files[0]).split('/')[0] || 'carpeta') : `${files.length} archivo(s)`;
    const s = songs.get(this.eng.song);
    toast(`${ENGINE_LAYOUT[this.eng.engine].name}: ${songs.size} canción(es) · "${s.title}" ${Object.keys(s.diffs).length} dificultad(es) · formato ${s.format}`, 4000);
    this.render();
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
  async playEngine(diff) {
    const s = this.eng.songs && this.eng.songs.get(this.eng.song); if (!s) { toast('Primero elige la carpeta de la canción'); return; }
    if (G.mode === 'demo') setMode('keyboard');
    await loadEngineSong(s, diff);
  },

  /* ---------- panel ---------- */
  render() {
    const box = $('impBox'); if (!box) return;
    const esc = escHtml, h = [];
    const vars = this.variations(), pack = this.vsPack();
    h.push('<h4>V-Slice</h4><div class="imp-row"><button class="btn mini" type="button" data-imp="chart">📄 Asignar Chart</button><button class="btn mini alt" type="button" data-imp="meta">🗒 Asignar Metadata</button></div>');
    h.push(`<div class="imp-st">${this.vs.chartNames.length ? '✔ chart: ' + esc(uniq(this.vs.chartNames).join(', ')) : '✘ sin chart'} · ${this.vs.metaNames.length ? '✔ metadata: ' + esc(uniq(this.vs.metaNames).join(', ')) : '✘ sin metadata'}</div>`);
    if (this.vs.chartNames.length || this.vs.metaNames.length) {
      h.push('<div class="imp-vars">');
      for (const v of vars) {
        const va = pack && pack.vars.find(x => x.id === v), sel = (this.vs.sel || 'default') === v;
        let info = va ? `${pack.entries.filter(e => e.v === v).map(e => e.d).join(', ')}` : (this.vs.charts[v] ? 'chart sin dificultades' : 'falta song-chart' + (v === 'default' ? '' : '-' + v) + '.json');
        if (va && this.vs.audio.size) { const au = packAudio(pack, v); info += ' · ' + (au.notes.length ? '✘ ' + au.notes.join(', ') : '✔ ' + au.list.map(t => t.name).join(', ')); }
        h.push(`<label class="imp-var ${va ? '' : 'falta'} ${sel ? 'sel' : ''}"><input type="radio" name="impVar" value="${esc(v)}" ${sel ? 'checked' : ''} ${va ? '' : 'disabled'}><b>${esc(v === 'default' ? 'normal (default)' : v)}</b> <small>${esc(info)}</small></label>`);
      }
      h.push('</div>');
    }
    h.push(`<button class="btn mini" type="button" data-imp="songdir">🎵 Asignar Song (carpeta)</button><button class="btn mini alt" type="button" data-imp="songfiles">🎵 …o elegir archivos de audio</button>`);
    h.push(`<div class="imp-st">${this.vs.audio.size ? `✔ audio (${esc(this.vs.audioFrom)}): ${esc([...this.vs.audio.values()].map(a => a.name).join(', '))}` : 'Inst.ogg / Inst-&lt;var&gt;.ogg · Voices-&lt;personaje&gt;[-&lt;var&gt;].ogg · Voices-Player/Opponent.ogg · Voices.ogg'}</div>`);
    h.push(`<button class="btn go" type="button" data-imp="playvs" ${pack && pack.entries.length ? '' : 'disabled'}>▶ Jugar ${esc(this.vs.sel && this.vs.sel !== 'default' ? 'variación ' + this.vs.sel : 'V-Slice')}</button>`);
    // otros motores
    const L = ENGINE_LAYOUT[this.eng.engine];
    h.push(`<h4>Psych · Codename · Kade</h4><div class="row"><label for="engSel">Motor</label><select id="engSel">${Object.entries(ENGINE_LAYOUT).map(([k, v]) => `<option value="${k}" ${k === this.eng.engine ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</select></div>`);
    h.push(`<p class="hint">${esc(L.hint)}</p><div class="imp-row"><button class="btn mini" type="button" data-imp="engdir">📁 Carpeta (canción o mod)</button><button class="btn mini alt" type="button" data-imp="engfiles">📎 Archivos</button></div>`);
    const songs = this.eng.songs;
    if (songs && songs.size) {
      const s = songs.get(this.eng.song) || [...songs.values()][0];
      if (songs.size > 1) h.push(`<div class="row"><label for="engSong">Canción</label><select id="engSong">${[...songs.values()].map(x => `<option value="${esc(x.id)}" ${x === s ? 'selected' : ''}>${esc(x.title)}</option>`).join('')}</select></div>`);
      const ds = sortDiffs(Object.keys(s.diffs)), au = engineAudio(s.audio, null);
      h.push(`<div class="imp-st">✔ ${esc(s.title)} · formato ${esc(s.format)} · dificultades: ${esc(ds.join(', '))}${s.meta ? ' · meta.json' : ''}${s.extra.events.length || s.extra.psychEvents.length ? ' · events.json' : ''}<br>${au.list.length ? '✔ audio: ' + esc(au.list.map(t => t.name).join(', ')) : '✘ sin audio (Inst.ogg / Voices.ogg)'}</div>`);
      h.push(`<div class="imp-row">${ds.map(d => `<button class="btn mini go" type="button" data-imp="playeng:${esc(d)}">▶ ${esc(d)}</button>`).join('')}</div>`);
    }
    box.innerHTML = h.join('');
    box.querySelectorAll('[data-imp]').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation(); e.preventDefault();
      const a = b.dataset.imp, run = p => Promise.resolve(p).catch(err => { console.error(err); toast('Error: ' + err.message, 5000); });
      if (a === 'chart') run(this.assignChart());
      else if (a === 'meta') run(this.assignMeta());
      else if (a === 'songdir') run(this.assignSong(true));
      else if (a === 'songfiles') run(this.assignSong(false));
      else if (a === 'playvs') run(this.playVS());
      else if (a === 'engdir') run(this.pickEngine(true));
      else if (a === 'engfiles') run(this.pickEngine(false));
      else if (a.startsWith('playeng:')) run(this.playEngine(a.slice(8)));
    }));
    box.querySelectorAll('input[name="impVar"]').forEach(r => r.addEventListener('change', e => { e.stopPropagation(); this.vs.sel = r.value; this.render(); }));
    const es = $('engSel'); if (es) es.addEventListener('change', e => { e.stopPropagation(); this.eng.engine = es.value; this.eng.songs = null; this.render(); });
    const ss = $('engSong'); if (ss) ss.addEventListener('change', e => { e.stopPropagation(); this.eng.song = ss.value; this.render(); });
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
