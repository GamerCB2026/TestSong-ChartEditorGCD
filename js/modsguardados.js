/* =====================================================================
   modsguardados.js — v3.9.0: "carpeta imaginaria" (VFS) y mods guardados
   · Assets cargados → árbol navegable del sistema de archivos virtual del mod
     montado (carpetas y archivos con tamaño; vista previa de imágenes, texto y audio)
   · Guardar el mod en el navegador (IndexedDB) con comprobación de espacio y progreso
   · Mods guardados: nombre, motor, tamaño y fecha; abrir (va directo a sus canciones
     en Chart y modo) y borrar. El motor (V-Slice / Psych / Codename / Kade) se guarda por mod.
   ===================================================================== */
'use strict';

const fmtBytes = n => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : n < 1073741824 ? (n / 1048576).toFixed(1) + ' MB' : (n / 1073741824).toFixed(2) + ' GB';

const ModStore = {
  db: null, busy: false, progress: '', list: [],
  async open() {
    if (this.db || !window.indexedDB) return this.db;
    this.db = await new Promise(ok => {
      const r = indexedDB.open('testsong-gcd-modsguardados', 1);
      r.onupgradeneeded = () => { r.result.createObjectStore('mods', { keyPath: 'id' }); r.result.createObjectStore('files'); };
      r.onsuccess = () => ok(r.result); r.onerror = () => ok(null);
    }).catch(() => null);
    return this.db;
  },
  tx(stores, mode) { return this.db.transaction(stores, mode); },
  req(r) { return new Promise((ok, ko) => { r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); }); },
  done(t) { return new Promise((ok, ko) => { t.oncomplete = () => ok(); t.onerror = () => ko(t.error); t.onabort = () => ko(t.error || new Error('cancelado')); }); },
  async refresh() {
    if (!await this.open()) { this.list = []; return this.list; }
    this.list = (await this.req(this.tx(['mods'], 'readonly').objectStore('mods').getAll())).sort((a, b) => b.date - a.date);
    return this.list;
  },
  /* guarda el mod montado (SongImport.mod): comprueba el espacio libre, escribe archivo por archivo con progreso */
  async save(onProgress) {
    const m = typeof SongImport !== 'undefined' && SongImport.mod;
    if (!m) { toast('No hay ningún mod montado'); return false; }
    if (!await this.open()) { toast('Este navegador no permite guardar (IndexedDB no disponible)', 4000); return false; }
    const entries = m.entries, size = entries.reduce((a, e) => a + (e.blob ? e.blob.size : 0), 0);
    try {
      if (navigator.storage && navigator.storage.estimate) {
        const est = await navigator.storage.estimate(), free = (est.quota || 0) - (est.usage || 0);
        if (est.quota && size * 1.1 > free) { toast(`No hay espacio: el mod ocupa ${fmtBytes(size)} y quedan ${fmtBytes(Math.max(0, free))} libres en el navegador`, 6000); return false; }
      }
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    } catch (e) {}
    const id = (m.name || 'mod') + '|' + m.engine;
    this.busy = true;
    try {
      await this.remove(id, true);
      const CH = 25;
      for (let i = 0; i < entries.length; i += CH) {
        const t = this.tx(['files'], 'readwrite'), os = t.objectStore('files');
        for (let j = i; j < Math.min(entries.length, i + CH); j++) { const e = entries[j]; os.put({ rel: e.rel || e.path, name: e.name, blob: e.blob }, id + '|' + String(j).padStart(6, '0')); }
        await this.done(t);
        const p = Math.min(entries.length, i + CH) / entries.length;
        this.progress = `Guardando… ${Math.round(p * 100)} %`; if (onProgress) onProgress(p);
      }
      const t = this.tx(['mods'], 'readwrite');
      t.objectStore('mods').put({ id, name: m.name || 'mod', engine: m.engine, size, count: entries.length, date: Date.now(), songs: [...m.songs.values()].map(s => s.title || s.id).slice(0, 30) });
      await this.done(t);
      this.progress = ''; await this.refresh();
      toast(`💾 ${m.name} guardado en el navegador (${fmtBytes(size)}, ${entries.length} archivos)`, 4000);
      return true;
    } catch (e) {
      console.warn('[mods guardados]', e); this.progress = '';
      await this.remove(id, true).catch(() => {});
      toast(/quota/i.test(String(e && (e.name || e.message))) ? 'Sin espacio en el navegador: no se guardó' : 'No se pudo guardar: ' + (e && e.message || e), 5000);
      return false;
    } finally { this.busy = false; }
  },
  async remove(id, quiet) {
    if (!await this.open()) return;
    const t = this.tx(['mods', 'files'], 'readwrite');
    t.objectStore('mods').delete(id);
    t.objectStore('files').delete(IDBKeyRange.bound(id + '|', id + '|\uffff'));
    await this.done(t);
    if (!quiet) { await this.refresh(); toast('🗑 Mod guardado borrado', 2500); }
  },
  /* abre un mod guardado: lo monta con su motor y va directo a su lista de canciones (Chart y modo) */
  async load(id) {
    if (!await this.open()) return;
    const meta = this.list.find(x => x.id === id) || await this.req(this.tx(['mods'], 'readonly').objectStore('mods').get(id));
    if (!meta) { toast('Ese mod ya no está guardado'); return; }
    const files = await this.req(this.tx(['files'], 'readonly').objectStore('files').getAll(IDBKeyRange.bound(id + '|', id + '|\uffff')));
    const entries = files.map(f => ({ rel: f.rel, name: f.name, blob: f.blob }));
    SongImport.sel = meta.engine; SongImport.busy = true; SongImport.render();
    try { await SongImport.mount(entries, meta.engine, meta.name); }
    finally { SongImport.busy = false; }
    if (typeof UI !== 'undefined' && UI.panel !== 'chart' && typeof togglePanel === 'function') togglePanel('chart'); else SongImport.render();
    const box = $('impBox'); if (box) { const s = box.querySelector('.imp-songs'); if (s) s.scrollIntoView({ block: 'nearest' }); }
  },
  /* lista de mods guardados dentro de un contenedor */
  renderList(box) {
    if (!box) return;
    const esc = escHtml, L = this.list, eng = e => (typeof ENGINE_LAYOUT !== 'undefined' && ENGINE_LAYOUT[e] ? ENGINE_LAYOUT[e].name : e);
    const h = ['<h4>💾 Mods guardados</h4>'];
    if (!L.length) h.push('<p class="hint">Ninguno. Monta un mod y pulsa "Guardar en el navegador" (Assets cargados).</p>');
    else h.push('<ul class="mg-list">' + L.map(x => `<li><button class="btn mini mg-open" type="button" data-mgopen="${esc(x.id)}" title="Abrir (va a sus canciones)">▶ <b>${esc(x.name)}</b></button> <small>${esc(eng(x.engine))} · ${fmtBytes(x.size)} · ${x.count} archivos · ${new Date(x.date).toLocaleString('es')}</small> <button class="btn mini warnb" type="button" data-mgdel="${esc(x.id)}" title="Borrar">🗑</button></li>`).join('') + '</ul>');
    box.innerHTML = h.join('');
    box.querySelectorAll('[data-mgopen]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); e.preventDefault(); this.load(b.dataset.mgopen).catch(err => toast('Error: ' + err.message, 5000)); }));
    box.querySelectorAll('[data-mgdel]').forEach(b => b.addEventListener('click', async e => {
      e.stopPropagation(); e.preventDefault();
      if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = '¿Borrar?'; setTimeout(() => { b.dataset.sure = ''; b.textContent = '🗑'; }, 3000); return; }
      await this.remove(b.dataset.mgdel); this.renderList(box); VfsUI.renderAll();
    }));
  },
};

/* ---------- árbol de la "carpeta imaginaria" ---------- */
const VfsUI = {
  tree() {
    const root = { dirs: new Map(), files: [], size: 0, count: 0 };
    const m = typeof SongImport !== 'undefined' && SongImport.mod;
    const own = m ? new Set(m.keys) : null;
    for (const [k, f] of VFS.files) {
      if (own && !own.has(k)) continue;
      if (m && /^shared\/(images|sounds|music)\//.test(k) && VFS.files.has(k.slice(7))) continue;   // copia de shared/ que crea el montaje
      const parts = k.split('/'); let n = root; const sz = f.blob ? f.blob.size : 0;
      root.size += sz; root.count++;
      for (let i = 0; i < parts.length - 1; i++) { if (!n.dirs.has(parts[i])) n.dirs.set(parts[i], { dirs: new Map(), files: [], size: 0, count: 0 }); n = n.dirs.get(parts[i]); n.size += sz; n.count++; }
      n.files.push({ name: f.name || parts[parts.length - 1], path: k, size: sz });
    }
    return root;
  },
  nodeHtml(n, prefix) {
    const esc = escHtml, h = [];
    for (const [d, c] of [...n.dirs].sort((a, b) => a[0].localeCompare(b[0]))) h.push(`<details data-vdir="${esc(prefix + d)}"><summary>📁 ${esc(d)} <small>${c.count} · ${fmtBytes(c.size)}</small></summary><div class="vfs-kids"></div></details>`);
    for (const f of n.files.sort((a, b) => a.name.localeCompare(b.name))) h.push(`<div class="vfs-file" data-vfile="${esc(f.path)}">${/\.(png|jpe?g|gif|webp)$/i.test(f.name) ? '🖼' : /\.(ogg|mp3|wav)$/i.test(f.name) ? '🔊' : /\.(hxc|hx|lua)$/i.test(f.name) ? '📜' : '📄'} ${esc(f.name)} <small>${fmtBytes(f.size)}</small></div>`);
    return h.join('') || '<div class="hint">(vacía)</div>';
  },
  find(root, path) { let n = root; for (const p of path.split('/')) { n = n.dirs.get(p); if (!n) return null; } return n; },
  render(box) {
    if (!box) return;
    const esc = escHtml, m = typeof SongImport !== 'undefined' && SongImport.mod, root = this.tree();
    const h = ['<h4>📂 Carpeta imaginaria (archivos del mod)</h4>'];
    if (!m) h.push('<p class="hint">No hay ningún mod montado (Chart y modo → Carpeta del mod / .zip, o abre uno guardado).</p>');
    else {
      h.push(`<div class="imp-st"><b>${esc(m.name)}</b> (${esc(typeof ENGINE_LAYOUT !== 'undefined' ? ENGINE_LAYOUT[m.engine].name : m.engine)}) · ${root.count} archivos · ${fmtBytes(root.size)} <button class="btn mini" type="button" id="mgSave" ${ModStore.busy ? 'disabled' : ''}>💾 Guardar en el navegador</button> <span id="mgProg" class="hint">${esc(ModStore.progress)}</span></div>`);
      h.push(`<div class="vfs-tree">${this.nodeHtml(root, '')}</div><div id="vfsPrev" class="vfs-prev"></div>`);
    }
    box.innerHTML = h.join('');
    const tree = box.querySelector('.vfs-tree');
    if (tree) {
      tree.addEventListener('toggle', e => {
        const d = e.target; if (!d.open || !d.dataset || !d.dataset.vdir) return;
        const kids = d.querySelector(':scope > .vfs-kids'); if (kids.dataset.ok) return;
        const n = this.find(root, d.dataset.vdir); kids.innerHTML = n ? this.nodeHtml(n, d.dataset.vdir + '/') : ''; kids.dataset.ok = '1';
      }, true);
      tree.addEventListener('click', e => { const f = e.target.closest('[data-vfile]'); if (!f) return; e.stopPropagation(); this.preview(f.dataset.vfile, box.querySelector('#vfsPrev')); tree.querySelectorAll('.vfs-file.sel').forEach(x => x.classList.remove('sel')); f.classList.add('sel'); });
    }
    const sb = box.querySelector('#mgSave');
    if (sb) sb.addEventListener('click', async e => {
      e.stopPropagation(); e.preventDefault(); sb.disabled = true;
      await ModStore.save(p => { const el = box.querySelector('#mgProg'); if (el) el.textContent = `Guardando… ${Math.round(p * 100)} %`; });
      this.renderAll();
    });
  },
  async preview(path, el) {
    if (!el) return;
    const f = VFS.get(path), esc = escHtml; if (!f) { el.innerHTML = ''; return; }
    const head = `<div class="hint"><b>${esc(path)}</b> · ${fmtBytes(f.blob.size)}</div>`;
    if (/\.(png|jpe?g|gif|webp)$/i.test(path)) { el.innerHTML = head + `<img alt="" src="${VFS.url(f)}">`; return; }
    if (/\.(ogg|mp3|wav)$/i.test(path)) { el.innerHTML = head + `<audio controls src="${VFS.url(f)}"></audio>`; return; }
    if (/\.(json|xml|txt|hxc|hx|hxs|lua|frag|vert|csv|ini|md|yaml|yml|hscript)$/i.test(path) || f.blob.size < 64 * 1024) {
      const t = await f.blob.slice(0, 6000).text();
      el.innerHTML = head + `<pre>${esc(t)}${f.blob.size > 6000 ? '\n…' : ''}</pre>`; return;
    }
    el.innerHTML = head + '<div class="hint">(sin vista previa)</div>';
  },
  async renderAll() {
    await ModStore.refresh().catch(() => {});
    this.render($('vfsBox')); ModStore.renderList($('mgBox')); ModStore.renderList($('mgBoxChart'));
  },
};
