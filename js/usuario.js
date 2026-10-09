/* =====================================================================
   usuario.js — Pausa → "Assets cargados": cargar un escenario (.json de stage
   + carpeta con sus imágenes) y personajes propios (Player / GF / Enemigo:
   JSON de personaje V-Slice + los archivos que pide su renderType).
   "Aplicar cambios": pantalla negra de carga → sprites nuevos → la canción
   se reinicia. Los archivos quedan en memoria (VFS) con la ruta del juego.
   ===================================================================== */
'use strict';

const UserAssets = {
  stage: null,                      // { id, data, fileName, needs: [...] }
  roles: { bf: null, gf: null, dad: null },
  applied: {},                      // rol/escenario → id aplicado
  registered: [],                   // claves VFS puestas por este panel
  busy: false, lastApply: null,
  ROLE_ES: { bf: 'Player', gf: 'GF', dad: 'Enemigo' },
  overrides() { return Object.assign({}, this.applied); },

  /* ---------- selector de archivos ---------- */
  pick(accept, multiple, dir) { return ModUI.pick(accept, multiple, dir); },
  rel: f => (f.webkitRelativePath || f.name).replace(/\\/g, '/'),

  /* ---------- escenario ---------- */
  async loadStageJson() {
    const [f] = await this.pick('.json', false); if (!f) return;
    let data; try { data = JSON.parse(await f.text()); } catch (e) { toast('JSON inválido: ' + e.message); return; }
    if (!Array.isArray(data.props)) { toast('Ese JSON no parece un stage de V-Slice (no tiene "props")', 4000); return; }
    const id = f.name.replace(/\.json$/i, '');
    const needs = [], seen = new Set(), notes = [];
    for (const p of data.props) {
      const ap = String(p.assetPath || ''); if (!ap || ap.startsWith('#')) continue;
      const pa = parseAssetPath(ap), name = pa.path.split('/').pop();
      if (p.animType === 'animateatlas') notes.push(`${p.name || ap}: Animate Atlas en props no se imita (se intenta como imagen)`);
      const anim = Array.isArray(p.animations) && p.animations.length && p.animType !== 'animateatlas';
      for (const ext of anim ? ['xml', 'png'] : ['png']) {
        const k = pa.path + '.' + ext; if (seen.has(k)) continue; seen.add(k);
        needs.push({ ext, rel: k.toLowerCase(), name: (name + '.' + ext).toLowerCase(), label: k, prop: p.name || ap,
          paths: uniq([`${pa.lib}/images/${k}`, `shared/images/${k}`, `${data.directory || 'shared'}/images/${k}`, `shared/images/${id}/${k}`]), file: null });
      }
    }
    this.stage = { id, data, fileName: f.name, needs, notes, json: f };
    this.render();
    toast(`Stage "${data.name || id}": ${needs.length} imágenes. Ahora "Seleccionar carpeta" con sus imágenes.`, 4000);
  },
  matchStage(files) {
    const st = this.stage; if (!st) return 0; let n = 0;
    for (const nd of st.needs) {
      const f = files.find(f => this.rel(f).toLowerCase().endsWith('/' + nd.rel) || this.rel(f).toLowerCase() === nd.rel) || files.find(f => f.name.toLowerCase() === nd.name);
      if (f) { nd.file = f; n++; }
    }
    return n;
  },
  async stageFolder() {
    if (!this.stage) { toast('Primero "Cargar .json de stage"'); return; }
    const files = await this.pick('', true, true); if (!files.length) return;
    const n = this.matchStage(files); this.render();
    toast(`Carpeta: ${n}/${this.stage.needs.length} imágenes encontradas`);
  },

  /* ---------- personajes ---------- */
  async loadChar(role) {
    const [f] = await this.pick('.json', false); if (!f) return;
    let data; try { data = JSON.parse(await f.text()); } catch (e) { toast('JSON inválido: ' + e.message); return; }
    if (!Array.isArray(data.animations)) { toast('Ese JSON no parece un personaje de V-Slice (no tiene "animations")', 4000); return; }
    const id = f.name.replace(/\.json$/i, '');
    const rt = String(data.renderType || 'sparrow').toLowerCase();
    const atlas = rt.includes('animateatlas'), multi = rt.startsWith('multi');
    const mainAp = data.assetPath || `characters/${id}`;
    const aps = [mainAp];
    if (multi) for (const a of data.animations) if (a.assetPath && !aps.includes(a.assetPath)) aps.push(a.assetPath);
    const needs = [];
    aps.forEach((ap, idx) => {
      const pa = parseAssetPath(ap), name = pa.path.split('/').pop(), base = `${pa.lib}/images/${pa.path}`;
      const optional = idx > 0 && !data.animations.some(a => a.assetPath === ap && NEEDED_ANIM.test(a.name));
      if (atlas) needs.push({ kind: 'atlas', ap, base, dir: name.toLowerCase(), main: idx === 0, optional, label: `${pa.path}/ (Animation.json + spritemap1.json + spritemap1.png…)`, files: null });
      else for (const ext of ['xml', 'png']) needs.push({ kind: ext, ap, base, main: idx === 0, optional, name: (name + '.' + ext).toLowerCase(), rel: (pa.path + '.' + ext).toLowerCase(), label: `${pa.path}.${ext}`, file: null });
    });
    const notes = [];
    if (rt === 'packer') notes.push('renderType "packer" (txt) no se imita: se intenta como Sparrow');
    this.roles[role] = { id, data, rt, atlas, multi, needs, notes, json: f };
    this.render();
    toast(`${this.ROLE_ES[role]}: ${data.name || id} (${data.renderType || 'sparrow'}) — elige sus archivos`, 3500);
  },
  matchChar(role, files) {
    const c = this.roles[role]; if (!c) return 0; let n = 0;
    const dirOf = f => { const r = this.rel(f); return r.includes('/') ? r.slice(0, r.lastIndexOf('/')) : ''; };
    if (c.atlas) {
      const groups = new Map();
      for (const f of files) { const d = dirOf(f); if (!groups.has(d)) groups.set(d, []); groups.get(d).push(f); }
      const withAnim = [...groups.entries()].filter(([, fs]) => fs.some(f => f.name === 'Animation.json'));
      const used = new Set();
      for (const nd of c.needs) {
        let g = withAnim.find(([d]) => !used.has(d) && d.split('/').pop().toLowerCase() === nd.dir);
        if (!g && nd.main) g = withAnim.find(([d]) => !used.has(d) && (withAnim.length === 1 || d === ''));
        if (g) { used.add(g[0]); nd.files = g[1].filter(f => /\.(json|png)$/i.test(f.name)); n++; }
      }
      return n;
    }
    const xmls = files.filter(f => /\.xml$/i.test(f.name)), pngs = files.filter(f => /\.png$/i.test(f.name));
    for (const nd of c.needs) {
      let f = files.find(f => this.rel(f).toLowerCase().endsWith('/' + nd.rel)) || files.find(f => f.name.toLowerCase() === nd.name);
      if (!f && nd.main) {
        // un solo .xml/.png elegido para el gráfico principal: se usa aunque el nombre no coincida
        if (nd.kind === 'xml' && xmls.length === 1) f = xmls[0];
        if (nd.kind === 'png') { const x = c.needs.find(o => o.main && o.kind === 'xml'); const same = x && x.file && pngs.find(p => p.name.replace(/\.png$/i, '') === x.file.name.replace(/\.xml$/i, '')); f = same || (pngs.length === 1 ? pngs[0] : null); }
      }
      if (f) { nd.file = f; n++; }
    }
    return n;
  },
  async charFiles(role, dir) {
    const c = this.roles[role]; if (!c) { toast(`Primero "Cargar ${this.ROLE_ES[role]}" (su JSON)`); return; }
    const files = await this.pick(dir ? '' : (c.atlas ? '.json,.png' : '.xml,.png,.txt'), true, dir); if (!files.length) return;
    const n = this.matchChar(role, files); this.render();
    toast(`${this.ROLE_ES[role]}: ${n} coincidencia(s)`);
  },
  ready(c) { return c.needs.filter(n => !n.optional).every(n => n.file || (n.files && n.files.length)); },
  remove(role) { if (role === 'stage') { this.stage = null; delete this.applied.stage; } else { this.roles[role] = null; delete this.applied[role]; } this.render(); },

  /* ---------- aplicar ---------- */
  put(path, blob, name) { this.registered.push(VFS.put(path, blob, name)); },
  register() {
    const ov = {};
    const st = this.stage;
    if (st) {
      this.put(`data/stages/${st.id}.json`, st.json, st.fileName);
      for (const nd of st.needs) if (nd.file) for (const p of nd.paths) this.put(p, nd.file, nd.file.name);
      ov.stage = st.id;
    }
    for (const role of ['bf', 'gf', 'dad']) {
      const c = this.roles[role]; if (!c) continue;
      this.put(`data/characters/${c.id}.json`, c.json, c.json.name);
      for (const nd of c.needs) {
        if (nd.file) this.put(`${nd.base}.${nd.kind}`, nd.file, nd.file.name);
        if (nd.files) for (const f of nd.files) this.put(`${nd.base}/${f.name}`, f, f.name);
      }
      ov[role] = c.id;
    }
    return ov;
  },
  async apply() {
    if (this.busy) return;
    if (!this.stage && !Object.values(this.roles).some(Boolean)) { toast('No hay nada cargado todavía'); return; }
    const faltan = [this.stage && !this.stage.needs.every(n => n.file) ? 'escenario' : null, ...['bf', 'gf', 'dad'].map(r => this.roles[r] && !this.ready(this.roles[r]) ? this.ROLE_ES[r] : null)].filter(Boolean);
    this.busy = true;
    const t0 = performance.now();
    try {
      this.applied = Object.assign({}, this.applied, this.register());
      Loader.reset('Cargando assets…'); Loader.active = true;
      G.paused = true; Music.pause(); hideOverlay();
      Scene.ids = null;
      // la pantalla negra se ve al menos un momento (si todo viene de memoria la carga dura milisegundos)
      await Promise.all([loadScene(Object.assign({}, (G.chart && G.chart.scene) || {}, this.applied)), new Promise(ok => setTimeout(ok, 450))]);
      Loader.finish();
      restart(true);
      openOverlay('ready');
      this.lastApply = { ms: Math.round(performance.now() - t0), ids: Object.assign({}, this.applied) };
      const errs = ['bf', 'gf', 'dad'].filter(r => this.applied[r] && Scene.errors[r]).map(r => `${this.ROLE_ES[r]}: ${Scene.errors[r]}`);
      toast(errs.length ? '✘ ' + errs.join(' · ') : `✔ Cambios aplicados${faltan.length ? ' (faltan archivos de: ' + faltan.join(', ') + ')' : ''}`, 4500);
    } catch (e) { console.error(e); Loader.finish(); toast('Error al aplicar: ' + e.message, 5000); }
    finally { this.busy = false; }
  },
  statusLines() {
    const out = [];
    if (this.applied.stage) out.push(`✔ escenario propio: ${this.applied.stage}`);
    for (const r of ['bf', 'gf', 'dad']) if (this.applied[r]) out.push(`✔ ${this.ROLE_ES[r]} propio: ${this.applied[r]}`);
    return out;
  },

  /* ---------- panel ---------- */
  needRow(label, ok, opt) { return `<div class="${ok ? 'ok' : opt ? 'warn' : 'bad'}">${ok ? '✔' : '✘'} ${escHtml(label)}${opt && !ok ? ' (opcional)' : ''}</div>`; },
  render() {
    const box = $('uaBox'); if (!box) return;
    const h = [];
    const st = this.stage;
    h.push(`<div class="ua-sec"><button class="btn mini" type="button" data-ua="stage">🏞 Cargar .json de stage</button>
      <button class="btn mini alt" type="button" data-ua="stagedir">📁 Seleccionar carpeta</button>`);
    if (st) h.push(`<div class="ua-info"><b>${escHtml(st.data.name || st.id)}</b> (${escHtml(st.fileName)}) ${this.applied.stage === st.id ? '· aplicado' : ''} <button class="btn mini x" type="button" data-ua="rm:stage">✕</button>
      ${st.needs.map(n => this.needRow(n.label + (n.file ? ' → ' + n.file.name : ''), !!n.file)).join('')}${st.notes.map(t => `<div class="warn">• ${escHtml(t)}</div>`).join('')}</div>`);
    h.push('</div><div class="ua-roles">');
    for (const role of ['bf', 'gf', 'dad']) h.push(`<button class="btn mini" type="button" data-ua="char:${role}">👤 Cargar ${this.ROLE_ES[role]}</button>`);
    h.push('</div>');
    for (const role of ['bf', 'gf', 'dad']) {
      const c = this.roles[role]; if (!c) continue;
      h.push(`<div class="ua-info"><b>${this.ROLE_ES[role]}: ${escHtml(c.data.name || c.id)}</b> · ${escHtml(c.data.renderType || 'sparrow')} ${this.applied[role] === c.id ? '· aplicado' : ''} <button class="btn mini x" type="button" data-ua="rm:${role}">✕</button>
        ${c.needs.map(n => this.needRow(n.label + (n.file ? ' → ' + n.file.name : n.files ? ` → ${n.files.length} archivos` : ''), !!(n.file || (n.files && n.files.length)), n.optional)).join('')}
        ${c.notes.map(t => `<div class="warn">• ${escHtml(t)}</div>`).join('')}
        <div class="ua-btns"><button class="btn mini" type="button" data-ua="files:${role}">📎 Elegir archivos</button><button class="btn mini alt" type="button" data-ua="dir:${role}">📁 Seleccionar carpeta</button></div></div>`);
    }
    h.push(`<button class="btn apply" type="button" data-ua="apply">✔ Aplicar cambios</button>
      <button class="btn mini alt" type="button" data-ua="mods">🧩 Eventos / note kinds (.hxc)</button>`);
    box.innerHTML = h.join('');
    box.querySelectorAll('[data-ua]').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation(); e.preventDefault();
      const a = b.dataset.ua;
      if (a === 'stage') this.loadStageJson();
      else if (a === 'stagedir') this.stageFolder();
      else if (a === 'apply') this.apply();
      else if (a === 'mods') ModUI.show();
      else if (a.startsWith('char:')) this.loadChar(a.slice(5));
      else if (a.startsWith('files:')) this.charFiles(a.slice(6), false);
      else if (a.startsWith('dir:')) this.charFiles(a.slice(4), true);
      else if (a.startsWith('rm:')) this.remove(a.slice(3));
    }));
  },
};
