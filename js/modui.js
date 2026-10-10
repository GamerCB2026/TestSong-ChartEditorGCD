/* =====================================================================
   modui.js — ventana (estilo FNF) para eventos y note kinds que esta página
   no conoce: lista cada id desconocido del chart con un botón para cargar su
   .hxc; después muestra qué se pudo imitar, qué no, y qué archivos pide el
   script (Paths.image/sound/music/video/frag, módulos, clases de otros .hxc)
   con un selector de archivo para cada uno, con el nombre/ruta exactos.
   ===================================================================== */
'use strict';

const ModUI = {
  open: false, dismissed: new Set(), lastLoaded: [],
  /* eventos y note kinds del chart sin implementación */
  unknown(chart) {
    const ev = new Map(), nk = new Map();
    if (!chart) return { ev, nk };
    // v3.7.0: los eventos de Psych/Codename (pe/ce) los ejecutan sus scripts (.lua / .hx) o no hacen nada, como en el motor: no se piden .hxc
    const txt = k => typeof ModText !== 'undefined' && ModText.map.has(k);
    const scripted = n => { const l = String(n).toLowerCase(); return txt(`custom_notetypes/${l}.lua`) || txt(`data/notes/${l}.hx`); };
    for (const e of chart.events || []) if (e.e && !e.pe && !e.ce && !Events.isBuiltin(e.e) && !Mods.events.has(e.e) && !changeCharInfo(e)) ev.set(e.e, (ev.get(e.e) || 0) + 1);
    for (const n of chart.notes || []) if (n.kind && !NoteKinds.known(n.kind) && !scripted(n.kind)) nk.set(n.kind, (nk.get(n.kind) || 0) + 1);
    return { ev, nk };
  },
  used(chart) {
    const ev = new Map(), nk = new Map();
    for (const e of (chart && chart.events) || []) if (Mods.events.has(e.e)) ev.set(e.e, (ev.get(e.e) || 0) + 1);
    for (const n of (chart && chart.notes) || []) if (n.kind) nk.set(n.kind, (nk.get(n.kind) || 0) + 1);
    return { ev, nk };
  },
  check(chart) {
    const u = this.unknown(chart);
    // v3.4.0: también se abre si un evento necesita un personaje / sonido que no se encontró
    const miss = Events.requirements().filter(r => this.reqStatus(r) === 'missing').map(r => r.type + ':' + r.key);
    const key = (chart.title || '') + '|' + [...u.ev.keys(), '#', ...u.nk.keys(), '#', ...miss].join(',');
    if ((u.ev.size || u.nk.size || miss.length) && !this.dismissed.has(key)) { this.key = key; this.show(); }
  },
  show() {
    this.open = true; $('modModal').hidden = false; this.render();
    if (G.chart && !G.overlayKind && !Loader.active) openOverlay('pause');
  },
  hide() { this.open = false; $('modModal').hidden = true; if (this.key) this.dismissed.add(this.key); },

  /* ¿la ruta de llamada (FlxG.camera.flash…) existe en la imitación? */
  supported(path) {
    try {
      const parts = path.split('.'); let o = HOST.global(parts[0]);
      if (o === undefined && Mods.classes.has(parts[0])) return true;
      for (let i = 1; i < parts.length; i++) { if (o == null || HX.isStub(o)) return false; o = o[parts[i]]; }
      return typeof o === 'function' && !HX.isStub(o);
    } catch (e) { return false; }
  },
  /* archivos / módulos / clases que piden los scripts cargados */
  requirements() {
    const out = [], seen = new Set();
    const add = r => { const k = r.type + '|' + r.kind + '|' + r.key + '|' + (r.lib || ''); if (!seen.has(k)) { seen.add(k); out.push(r); } };
    for (const rec of Mods.scripts.values()) {
      const a = rec.analysis || {};
      for (const r of a.res || []) {
        if (r.kind === 'atlas') { add({ type: 'note', key: `Paths.animateAtlas("${r.key}") (Animate Atlas en scripts): no se imita`, from: rec.name }); continue; }
        add({ type: 'res', kind: r.kind, key: r.key, lib: r.lib || null, from: rec.name });
      }
      for (const m of a.modules || []) add({ type: 'module', key: m, from: rec.name });
      for (const s of a.scripted || []) add({ type: s.base === 'hxc' ? 'hxcfile' : 'scripted', key: s.name, from: rec.name, base: s.base });
      for (const c of a.custom || []) { const n = c.split('.').pop(); if (!/^\*$/.test(n)) add({ type: 'class', key: c, short: n, from: rec.name }); }
    }
    for (const k of Mods.kinds.values()) if (k.styleId) add({ type: 'notestyle', key: k.styleId, from: k.file });
    for (const r of Events.requirements()) add(r);        // personajes de "Change Character", sonidos de "Play Sound"…
    if (typeof Shaders !== 'undefined') for (const r of Shaders.requirements()) add(r);
    return out;
  },
  reqStatus(r) {
    if (r.type === 'res') return ModRes.status(r.kind, r.key, r.lib);
    if (r.type === 'module') return Mods.modules.has(r.key) ? 'ok' : 'missing';
    if (r.type === 'scripted' || r.type === 'class') return Mods.classes.has(r.short || r.key) ? 'ok' : 'missing';
    if (r.type === 'hxcfile') return [...Mods.scripts.keys()].some(n => n.toLowerCase() === r.key.split('/').pop().toLowerCase()) ? 'ok' : 'missing';
    if (r.type === 'notestyle') { const s = NoteStyles.map.get(r.key); return s ? s.status : 'none'; }
    if (r.type === 'evchar') return Events.charStatus(r.key);
    if (r.type === 'shader') return Shaders.reqStatus(r);
    return 'none';
  },
  reqLabel(r) {
    if (r.type === 'res') {
      const exp = ModRes.expected(r.kind, r.key, r.lib);
      if (r.kind === 'sparrow') return `${exp} + ${exp.replace(/\.xml$/, '.png')} (o .astc)`;
      if (r.kind === 'image') return exp + (/\.png$/i.test(exp) ? ' (o .astc)' : '');
      return exp;
    }
    if (r.type === 'module') return `módulo "${r.key}" (ModuleHandler.getModule) → su .hxc`;
    if (r.type === 'scripted') return `clase scripted "${r.key}" (${r.base}) → su .hxc`;
    if (r.type === 'class') return `import ${r.key} → el .hxc que define "${r.short}"`;
    if (r.type === 'hxcfile') return `${r.key}`;
    if (r.type === 'evchar') return `personaje "${r.key}" (${UserAssets.ROLE_ES[r.role] || r.role}): data/characters/${r.key}.json + su .xml/.png (o .astc) o carpeta Animate`;
    if (r.type === 'shader') return `shaders/${r.key}`;
    if (r.type === 'notestyle') {
      const s = NoteStyles.map.get(r.key), need = s && s.sheetKey && s.status !== 'ok' ? ` + images/${s.sheetKey}.xml + images/${s.sheetKey}.png/.astc` : '';
      return `data/notestyles/${r.key}.json${need}`;
    }
    return r.key;
  },
  reqAccept(r) {
    if (r.type === 'evchar') return '.json,.xml,.png,.txt,' + ASTC_ACCEPT;
    if (r.type === 'shader') return '.frag,.vert,.glsl';
    if (r.type !== 'res') return r.type === 'notestyle' ? '.json,.xml,.png,' + ASTC_ACCEPT : '.hxc';
    return { image: '.png,.jpg,.jpeg,.webp,' + ASTC_ACCEPT, sparrow: '.xml,.png,' + ASTC_ACCEPT, sound: '.ogg,.mp3,.wav', music: '.ogg,.mp3,.wav', video: '.mp4,.webm', gif: '.gif', frag: '.frag,.glsl', font: '.ttf,.otf,.woff,.woff2', json: '.json' }[r.kind] || '';
  },

  /* ---- carga de archivos ---- */
  pick(accept, multiple, dir) {
    return new Promise(ok => {
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = accept || ''; inp.multiple = !!multiple;
      if (dir) { inp.webkitdirectory = true; inp.setAttribute('webkitdirectory', ''); }
      inp.style.display = 'none'; document.body.appendChild(inp);
      inp.addEventListener('change', () => { ok([...inp.files]); inp.remove(); }, { once: true });
      inp.addEventListener('cancel', () => { ok([]); inp.remove(); }, { once: true });
      inp.click();
    });
  },
  async loadHxc(files) {
    const loaded = [];
    for (const f of files) {
      if (!/\.hxc$/i.test(f.name)) continue;
      const text = await f.text();
      try {
        const rec = Mods.load(f.name, text);
        Mods.saveScript(f.name, text);
        loaded.push(rec);
      } catch (e) {
        console.warn('[hxc]', f.name, e);
        Mods.failed = Mods.failed || new Map(); Mods.failed.set(f.name, e.message);
        toast(`${f.name}: no se pudo leer (${e.message})`, 5000);
      }
    }
    if (loaded.length) {
      this.lastLoaded = loaded.map(r => r.name);
      const ids = loaded.flatMap(r => [...r.events, ...r.kinds, ...r.modules]);
      toast(`✔ ${ids.length ? 'Implementado: ' + ids.join(', ') : loaded.map(r => r.name).join(', ')} — ${AVISO_IMITACION}`, 6500);
      await Promise.all([...ModRes.cache.values()].map(r => r.p).filter(Boolean)).catch(() => {});
    }
    this.render();
    return loaded;
  },
  /* archivo pedido por un script: se guarda con la ruta que espera el juego */
  async provide(r, files) {
    if (r.type === 'evchar') { await UserAssets.provideEventChar(r.key, r.role, files); this.render(); return; }
    if (r.type === 'shader') { await Shaders.provide(r, files); this.render(); return; }
    for (const f of files) {
      const ext = (f.name.split('.').pop() || '').toLowerCase();
      if (ext === 'hxc') { await this.loadHxc([f]); continue; }
      let path;
      if (r.type === 'notestyle') {
        if (ext === 'json') path = `data/notestyles/${r.key}.json`;
        else { const s = NoteStyles.map.get(r.key); const base = 'images/' + (s && s.sheetKey ? s.sheetKey : f.name.replace(/\.\w+$/, '')); path = base + '.' + ext; }
      } else {
        path = ModRes.expected(r.kind, r.key, r.lib);
        if (r.kind === 'sparrow') path = path.replace(/\.xml$/, '.' + (ASTC.isName(f.name) ? 'png' : ext));   // .astc/.ktx: misma ruta que la PNG (se reconoce por el contenido)
        else if (!/\.\w+$/.test(path.split('/').pop())) path += '.' + ext;
        else if (r.kind === 'sound' || r.kind === 'music' || r.kind === 'video') path = path.replace(/\.\w+$/, '.' + ext);
      }
      VFS.put(path, f, f.name); Mods.saveFile(path, f, f.name);
    }
    if (r.type === 'res') {
      // el mismo recurso puede pedirse con y sin librería (Paths.sound("x", "shared") / Paths.sound("x")): se recargan todos
      const same = this.requirements().filter(o => o.type === 'res' && o.key === r.key && (o.kind === r.kind || (r.kind === 'sparrow' && o.kind === 'image')));
      for (const o of same) ModRes.forget(o.kind, o.key, o.lib);
      if (r.kind === 'sparrow') ModRes.forget('image', r.key, r.lib);
      await Promise.all(same.map(o => ModRes.load(o.kind, o.key, o.lib)));
    }
    if (r.type === 'notestyle') { NoteStyles.map.delete(r.key); NoteStyles.request(r.key); await new Promise(ok => setTimeout(ok, 300)); }
    this.render();
  },
  /* carpeta del mod: .hxc se cargan; el resto se registra con su ruta desde images/, sounds/, data/… */
  async loadFolder(files) {
    const hxc = files.filter(f => /\.hxc$/i.test(f.name));
    let n = 0;
    for (const f of files) {
      if (/\.hxc$/i.test(f.name)) continue;
      const rel = (f.webkitRelativePath || f.name).replace(/\\/g, '/');
      const parts = rel.split('/'); const i = parts.findIndex(p => /^(images|sounds|music|videos|shaders|fonts|data|songs)$/i.test(p));
      if (i < 0) continue;
      const lib = i > 0 && /^(shared|preload|week\d+|weekend\d+|[\w-]+)$/.test(parts[i - 1]) && parts[i - 1] !== 'assets' && i > 1 ? parts[i - 1] : null;
      const path = (lib && lib !== 'preload' ? lib + '/' : '') + parts.slice(i).join('/');
      VFS.put(path, f, f.name); n++;
    }
    const loaded = hxc.length ? await this.loadHxc(hxc) : [];
    // se guardan (IndexedDB) solo los archivos que piden los scripts
    for (const r of this.requirements()) if (r.type === 'res') {
      const u = ModRes.findUser(r.kind, r.key, r.lib); if (u) { Mods.saveFile(ModRes.expected(r.kind, r.key, r.lib), u.blob, u.name); ModRes.forget(r.kind, r.key, r.lib); ModRes.load(r.kind, r.key, r.lib); }
    }
    toast(`Carpeta: ${loaded.length} .hxc cargados · ${n} archivos registrados`, 4000);
    setTimeout(() => this.render(), 400);
  },

  /* ---- dibujo ---- */
  render() {
    const box = $('modBody'); if (!box) return;
    const u = this.unknown(G.chart), used = this.used(G.chart), reqs = this.requirements();
    const esc = escHtml, h = [];
    h.push(`<div class="aviso">⚠ ${esc(AVISO_IMITACION)}</div>`);
    // desconocidos del chart
    const rows = [];
    for (const [id, n] of u.ev) rows.push(`<div class="mrow bad"><span><b>Evento</b> <code>${esc(id)}</code> ×${n}</span><button class="btn mini" data-act="hxc" type="button">📄 Cargar .hxc</button></div>`);
    for (const [id, n] of u.nk) rows.push(`<div class="mrow bad"><span><b>Note kind</b> <code>${esc(id)}</code> ×${n}</span><button class="btn mini" data-act="hxc" type="button">📄 Cargar .hxc</button></div>`);
    h.push(`<h4>Desconocidos en el chart</h4>${rows.join('') || '<div class="mrow ok"><span>✔ Todos los eventos y note kinds del chart tienen implementación.</span></div>'}`);
    // implementados por .hxc
    const impl = [];
    for (const e of Mods.events.values()) impl.push(`<div class="mrow ok"><span>✔ Evento <code>${esc(e.id)}</code> — ${esc(e.title)} <i>(${esc(e.file)})</i>${used.ev.get(e.id) ? ' · en el chart ×' + used.ev.get(e.id) : ''}</span></div>`);
    for (const k of Mods.kinds.values()) impl.push(`<div class="mrow ok"><span>✔ Note kind <code>${esc(k.id)}</code> — ${esc(k.desc)}${k.styleId ? ' · estilo ' + esc(k.styleId) : ''}${k.hurt ? ' · hace daño (el bot la evita)' : ''} <i>(${esc(k.file)})</i>${used.nk.get(k.id) ? ' · en el chart ×' + used.nk.get(k.id) : ''}</span></div>`);
    for (const m of Mods.modules.values()) impl.push(`<div class="mrow ok"><span>✔ Módulo <code>${esc(m.id)}</code> <i>(${esc(m.file)})</i></span></div>`);
    if (impl.length) h.push(`<h4>Implementado desde .hxc (imitación)</h4>${impl.join('')}<div class="aviso chico">${esc(AVISO_IMITACION)}</div>`);
    // archivos pedidos
    if (reqs.length) {
      h.push('<h4>Archivos que piden los scripts</h4>');
      reqs.forEach((r, i) => {
        if (r.type === 'note') { h.push(`<div class="mrow warn"><span>✘ ${esc(r.key)} <i>(${esc(r.from)})</i></span></div>`); return; }
        const st = this.reqStatus(r), ok = st === 'ok';
        const src = r.type === 'res' && ok ? (ModRes.cache.get(ModRes.keyOf(r.kind, r.key, r.lib)) || {}).from : '';
        h.push(`<div class="mrow ${ok ? 'ok' : st === 'loading' ? 'warn' : 'bad'}"><span>${ok ? '✔' : st === 'loading' ? '…' : '✘'} <code>${esc(this.reqLabel(r))}</code>${src ? ' · ' + esc(src) : ''} <i>(${esc(r.from)})</i></span>${ok ? '' : `<button class="btn mini" data-act="req" data-i="${i}" type="button">📎 Elegir archivo</button>`}</div>`);
      });
    }
    // informe por script
    const rep = [];
    for (const rec of Mods.scripts.values()) {
      const a = rec.analysis || {}, calls = (a.calls || []).filter(c => !/^(Std|Math|StringTools|Reflect|Lambda|Type)\./.test(c));
      const saveC = calls.filter(c => /^Save\./.test(c)), rest = calls.filter(c => !/^Save\./.test(c));
      const sup = rest.filter(c => this.supported(c)), uns = rest.filter(c => !this.supported(c));
      const notes = [...(HX.notes.get(rec.name) || [])];
      rep.push(`<details class="mrep"><summary><b>${esc(rec.name)}</b> — ${[rec.events.length && 'eventos: ' + rec.events.join(', '), rec.kinds.length && 'kinds: ' + rec.kinds.join(', '), rec.modules.length && 'módulos: ' + rec.modules.join(', '), rec.others.length && 'otras clases: ' + rec.others.join(', ')].filter(Boolean).map(esc).join(' · ') || 'sin clases registrables'}</summary>
        ${sup.length ? `<div class="ok">✔ imitado: ${sup.map(esc).join(', ')}</div>` : ''}
        ${uns.length ? `<div class="bad">✘ no imitado (se ignora): ${uns.map(esc).join(', ')}</div>` : ''}
        ${saveC.length ? `<div class="warn">• ${saveC.map(esc).join(', ')}: opciones guardadas del mod → se asumen activadas</div>` : ''}
        ${(a.dynamic || []).length ? `<div class="warn">• ${a.dynamic.map(esc).join('<br>• ')}</div>` : ''}
        ${notes.length ? `<div class="warn">Durante la ejecución:<br>• ${notes.slice(0, 30).map(esc).join('<br>• ')}</div>` : ''}</details>`);
    }
    for (const [n, err] of (Mods.failed || new Map())) rep.push(`<div class="mrow bad"><span>✘ ${esc(n)}: ${esc(err)}</span></div>`);
    if (rep.length) h.push(`<h4>Informe de los scripts</h4>${rep.join('')}`);
    box.innerHTML = h.join('');
    box.querySelectorAll('[data-act="hxc"]').forEach(b => b.addEventListener('click', async e => { e.stopPropagation(); await this.loadHxc(await this.pick('.hxc', true)); }));
    box.querySelectorAll('[data-act="req"]').forEach(b => b.addEventListener('click', async e => {
      e.stopPropagation(); const r = reqs[+b.dataset.i];
      const files = await this.pick(this.reqAccept(r), r.kind === 'sparrow' || r.type === 'notestyle' || r.type === 'evchar', r.type === 'evchar' && e.shiftKey);
      if (files.length) await this.provide(r, files);
    }));
  },
};

$('modClose').addEventListener('click', e => { e.stopPropagation(); ModUI.hide(); });
$('modHxc').addEventListener('click', async e => { e.stopPropagation(); await ModUI.loadHxc(await ModUI.pick('.hxc', true)); });
$('modFolder').addEventListener('click', async e => { e.stopPropagation(); const f = await ModUI.pick('', true, true); if (f.length) await ModUI.loadFolder(f); });
$('modForget').addEventListener('click', async e => {
  e.stopPropagation();
  await Mods.clearSaved();
  for (const rec of [...Mods.scripts.values()]) Mods.unregister(rec);
  ModRes.cache.clear();
  toast('Scripts y archivos guardados borrados de este navegador'); ModUI.render();
});
$('modModal').addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); ModUI.hide(); } e.stopPropagation(); });
