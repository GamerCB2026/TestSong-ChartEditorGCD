/* =====================================================================
   SongScripts.js — scripts .hxc por CANCIÓN, el mismo sistema que ya
   usa el motor para escenarios / personajes / módulos (class X extends
   Song, registrado en Mods.songs y despachado por PlayState).

   Al cargar una canción se buscan, en este orden, los .hxc de:
     data/songs/<id>/<id>.hxc
     data/songs/<id>/script.hxc
     data/songs/<id>/scripts.hxc
     scripts/songs/<id>.hxc
     data/scripts/songs/<id>.hxc
     songs/<id>/<id>.hxc
     scripts/<id>.hxc

   Si el archivo ya declara `class … extends Song` (u otra clase del
   motor), se carga tal cual. Si solo trae callbacks sueltos
   (onCreate, onUpdate, onBeatHit, onStepHit, onNoteHit, onMiss,
   onSongStart, onSongEnd…), se envuelven en una clase Song con ese id.

   Los callbacks que ya soporta la arquitectura llegan por
   Mods.songTarget() → dispatchEvent (CREATE, UPDATE, SONG_BEAT_HIT,
   SONG_STEP_HIT, NOTE_HIT, NOTE_MISS, SONG_START, SONG_END, etc.).
   ===================================================================== */
'use strict';

const SongScripts = {
  loaded: new Map(),   // path -> { name, ids }
  lastIds: [],

  /* ids posibles de la canción actual (carpeta, título, id del chart) */
  idsOf(chart) {
    const ids = [];
    const add = (x) => {
      const s = String(x || '').trim();
      if (!s) return;
      const l = s.toLowerCase();
      if (!ids.includes(l)) ids.push(l);
      const slug = l.replace(/\s+/g, '-');
      if (slug && !ids.includes(slug)) ids.push(slug);
      const tight = l.replace(/[^a-z0-9]+/g, '');
      if (tight && tight !== l && !ids.includes(tight)) ids.push(tight);
    };
    if (typeof SongImport !== 'undefined' && SongImport.cur) add(SongImport.cur);
    if (chart) {
      add(chart.songId); add(chart.id); add(chart.folder); add(chart.title);
      if (chart.scene && chart.scene.song) add(chart.scene.song);
    }
    if (typeof SongLoad !== 'undefined' && Array.isArray(SongLoad.files)) {
      for (const f of SongLoad.files) {
        const n = String(f || '').replace(/\\/g, '/');
        const m = n.match(/(?:data\/)?songs\/([^/]+)\//i);
        if (m) add(m[1]);
      }
    }
    if (typeof ASSET_CFG !== 'undefined' && ASSET_CFG.defaultSongId) add(ASSET_CFG.defaultSongId);
    return ids;
  },

  pathsFor(id) {
    const s = String(id || '');
    return [
      `data/songs/${s}/${s}.hxc`,
      `data/songs/${s}/script.hxc`,
      `data/songs/${s}/scripts.hxc`,
      `scripts/songs/${s}.hxc`,
      `data/scripts/songs/${s}.hxc`,
      `songs/${s}/${s}.hxc`,
      `scripts/${s}.hxc`,
    ];
  },

  /* Si el texto no declara una clase del motor, lo envuelve en `extends Song`. */
  wrap(id, text) {
    const src = String(text || '').replace(/^\uFEFF/, '');
    if (/\bextends\s+(Song|Module|Stage|NoteKind|SongEvent|BaseCharacter|Character|Boyfriend)\b/i.test(src)) return src;
    const cls = 'Song_' + String(id).replace(/[^A-Za-z0-9_]/g, '_') + '_auto';
    const has = n => new RegExp('function\\s+' + n + '\\b').test(src);
    let alias = '';
    if (has('onMiss') && !has('onNoteMiss')) alias += '  public function onNoteMiss(event) { return onMiss(event); }\n';
    if (has('create') && !has('onCreate')) alias += '  public function onCreate(event) { return create(event); }\n';
    if (has('update') && !has('onUpdate')) alias += '  public function onUpdate(event) { return update(event); }\n';

    return 'class ' + cls + ' extends Song {\n  public function new() { super("' + String(id).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"); }\n' + src + '\n' + alias + '}\n';
  },

  async loadFile(path, ids) {
    if (this.loaded.has(path)) return this.loaded.get(path);
    const r = await fetchFirst([path], 'text');
    if (!r) return null;
    const id = ids[0] || 'song';
    const name = 'song:' + path;
    try {
      if (typeof Mods === 'undefined' || !Mods.load) throw new Error('Mods no está listo');
      /* si ya había un script con ese nombre (recarga), unregister va dentro de load */
      Mods.load(name, this.wrap(id, r.data));
      const rec = { name, path, ids: ids.slice() };
      this.loaded.set(path, rec);
      console.info('[SongScripts] cargado', path, 'para', ids.join(', '));
      return rec;
    } catch (e) {
      console.warn('[SongScripts]', path, e);
      if (typeof ScriptLog !== 'undefined') ScriptLog.err(path, e.message || String(e));
      return null;
    }
  },

  async attach(chart) {
    const ids = this.idsOf(chart || (typeof G !== 'undefined' ? G.chart : null));
    this.lastIds = ids;
    if (!ids.length) return [];
    const seen = new Set();
    const paths = [];
    for (const id of ids) for (const p of this.pathsFor(id)) {
      if (seen.has(p)) continue;
      seen.add(p);
      paths.push(p);
    }
    const found = [];
    /* se prueban en serie por id (el primero que exista basta; el resto del mismo id se sigue buscando por si hay varios) */
    for (const p of paths) {
      const rec = await this.loadFile(p, ids);
      if (rec) found.push(rec);
    }
    if (typeof Mods !== 'undefined') Mods._songT = null;   // fuerza onCreate al reactivar ScriptedSong
    return found;
  },

  install() {
    if (this._ok) return;
    this._ok = true;
    if (typeof loadChart === 'function') {
      const prev = loadChart;
      loadChart = async function (chart, audio, opts) {
        const pre = SongScripts.attach(chart);
        const r = await prev(chart, audio, opts);
        try { await pre; } catch (e) { console.warn('[SongScripts]', e); }
        return r;
      };
    }
    /* si boot() ya dejó un chart en marcha (carrera rara), engancharlo */
    if (typeof G !== 'undefined' && G.chart) this.attach(G.chart).catch(e => console.warn('[SongScripts]', e));
  },
};

SongScripts.install();
