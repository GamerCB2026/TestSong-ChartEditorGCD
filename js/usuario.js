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
  /* imágenes: la PNG pedida también vale como .astc / .ktx / .ktx2 (texturas de los ports móviles); se empareja por nombre sin extensión */
  IMG: /\.(png|astc|ktx2?)$/i,
  stem: s => String(s).toLowerCase().replace(/\.(png|astc|ktx2?)$/i, ''),
  findFile(files, rel, name, ext) {
    if (ext !== 'png') return files.find(f => this.rel(f).toLowerCase().endsWith('/' + rel) || this.rel(f).toLowerCase() === rel) || files.find(f => f.name.toLowerCase() === name);
    const imgs = files.filter(f => this.IMG.test(f.name)), r = this.stem(rel), n = this.stem(name);
    const pref = list => list.find(f => /\.png$/i.test(f.name)) || list[0];   // si están las dos, la PNG
    const byRel = imgs.filter(f => { const x = this.stem(this.rel(f)); return x.endsWith('/' + r) || x === r; });
    return pref(byRel.length ? byRel : imgs.filter(f => this.stem(f.name) === n));
  },
  /* ruta de VFS con la extensión real del archivo elegido (x.png → x.astc si se eligió un .astc) */
  realExt(path, file) { const m = /\.(astc|ktx2?)$/i.exec(file && file.name || ''); return m ? path.replace(/\.png$/i, m[0].toLowerCase()) : path; },

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
        needs.push({ ext, rel: k.toLowerCase(), name: (name + '.' + ext).toLowerCase(), label: ext === 'png' ? k + ' (o .astc)' : k, prop: p.name || ap,
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
      const f = this.findFile(files, nd.rel, nd.name, nd.ext);
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
    let data; try { data = normalizeCharData(JSON.parse(await f.text())); } catch (e) { toast('JSON inválido: ' + e.message); return; }
    if (!Array.isArray(data.animations)) { toast('Ese JSON no parece un personaje de V-Slice (no tiene "animations")', 4000); return; }
    const id = f.name.replace(/\.json$/i, '');
    this.roles[role] = this.charRecord(id, data, f);
    this.render();
    toast(`${this.ROLE_ES[role]}: ${data.name || id} (${data.renderType || 'sparrow'}) — elige sus archivos`, 3500);
  },
  /* necesidades de un JSON de personaje V-Slice (según su renderType) */
  charRecord(id, data, f) {
    const rt = String(data.renderType || 'sparrow').toLowerCase();
    const atlas = rt.includes('animateatlas'), multi = rt.startsWith('multi');
    const mainAp = data.assetPath || `characters/${id}`;
    const aps = [mainAp];
    if (multi) for (const a of data.animations) if (a.assetPath && !aps.includes(a.assetPath)) aps.push(a.assetPath);
    const needs = [];
    aps.forEach((ap, idx) => {
      const pa = parseAssetPath(ap), name = pa.path.split('/').pop(), base = `${pa.lib}/images/${pa.path}`;
      const optional = idx > 0 && !data.animations.some(a => a.assetPath === ap && NEEDED_ANIM.test(a.name));
      if (atlas) needs.push({ kind: 'atlas', ap, base, dir: name.toLowerCase(), main: idx === 0, optional, label: `${pa.path}/ (Animation.json + spritemap1.json + spritemap1.png/.astc…)`, files: null });
      else for (const ext of ['xml', 'png']) needs.push({ kind: ext, ap, base, main: idx === 0, optional, name: (name + '.' + ext).toLowerCase(), rel: (pa.path + '.' + ext).toLowerCase(), label: `${pa.path}.${ext}${ext === 'png' ? ' (o .astc)' : ''}`, file: null });
    });
    const notes = [];
    if (rt === 'packer') notes.push('renderType "packer" (txt) no se imita: se intenta como Sparrow');
    return { id, data, rt, atlas, multi, needs, notes, json: f };
  },
  matchChar(role, files, rec) {
    const c = rec || this.roles[role]; if (!c) return 0; let n = 0;
    const dirOf = f => { const r = this.rel(f); return r.includes('/') ? r.slice(0, r.lastIndexOf('/')) : ''; };
    if (c.atlas) {
      const groups = new Map();
      for (const f of files) { const d = dirOf(f); if (!groups.has(d)) groups.set(d, []); groups.get(d).push(f); }
      const withAnim = [...groups.entries()].filter(([, fs]) => fs.some(f => f.name === 'Animation.json'));
      const used = new Set();
      for (const nd of c.needs) {
        let g = withAnim.find(([d]) => !used.has(d) && d.split('/').pop().toLowerCase() === nd.dir);
        if (!g && nd.main) g = withAnim.find(([d]) => !used.has(d) && (withAnim.length === 1 || d === ''));
        if (g) { used.add(g[0]); nd.files = g[1].filter(f => /\.(json|png|astc|ktx2?)$/i.test(f.name)); n++; }
      }
      return n;
    }
    const xmls = files.filter(f => /\.xml$/i.test(f.name)), pngs = files.filter(f => this.IMG.test(f.name));
    for (const nd of c.needs) {
      let f = this.findFile(files, nd.rel, nd.name, nd.kind);
      if (!f && nd.main) {
        // un solo .xml/.png elegido para el gráfico principal: se usa aunque el nombre no coincida
        if (nd.kind === 'xml' && xmls.length === 1) f = xmls[0];
        if (nd.kind === 'png') { const x = c.needs.find(o => o.main && o.kind === 'xml'); const same = x && x.file && pngs.find(p => this.stem(p.name) === x.file.name.replace(/\.xml$/i, '').toLowerCase()); f = same || (pngs.length === 1 ? pngs[0] : null); }
      }
      if (f) { nd.file = f; n++; }
    }
    return n;
  },
  async charFiles(role, dir) {
    const c = this.roles[role]; if (!c) { toast(`Primero "Cargar ${this.ROLE_ES[role]}" (su JSON)`); return; }
    const files = await this.pick(dir ? '' : (c.atlas ? '.json,.png,' + ASTC_ACCEPT : '.xml,.png,.txt,' + ASTC_ACCEPT), true, dir); if (!files.length) return;
    const n = this.matchChar(role, files); this.render();
    toast(`${this.ROLE_ES[role]}: ${n} coincidencia(s)`);
  },
  ready(c) { return c.needs.filter(n => !n.optional).every(n => n.file || (n.files && n.files.length)); },
  remove(role) { if (role === 'stage') { this.stage = null; delete this.applied.stage; } else { this.roles[role] = null; delete this.applied[role]; } this.render(); },

  /* ---------- personaje que pide un evento (Change Character…) ---------- */
  async provideEventChar(id, role, files) {
    const jsons = files.filter(f => /\.json$/i.test(f.name) && !/^(Animation|spritemap\d*)\.json$/i.test(f.name));
    let jf = jsons.find(f => f.name.toLowerCase() === id.toLowerCase() + '.json');
    let data = null;
    for (const f of jf ? [jf] : jsons) { try { const d = normalizeCharData(JSON.parse(await f.text())); if (Array.isArray(d.animations)) { data = d; jf = f; break; } } catch (e) {} }
    if (!data) { toast(`Falta data/characters/${id}.json (el JSON del personaje) entre los archivos`, 4500); return false; }
    const rec = this.charRecord(id, data, jf);
    const n = this.matchChar(role, files, rec);
    this.putChar(rec);
    this.putIcons(files, data);
    Events.charCache.delete(role + '|' + id);
    const r = await Events.preloadChar(role, id);
    if (r.char instanceof RealChar) { try { Render.prewarm(Events.eventTextures()); } catch (e) {} toast(`✔ Personaje "${id}" listo para el evento (${r.char.anims.size} anims)`, 3500); }
    else toast(`✘ "${id}": ${r.char && r.char.error || 'no se pudo cargar'} (${n} archivo(s) reconocidos)`, 5000);
    return r.char instanceof RealChar;
  },
  /* iconos que vienen junto al personaje (icon-<id>.png/.astc [+ .xml]) → images/icons/ */
  putIcons(files, data) {
    const hi = data && data.healthIcon && data.healthIcon.id ? String(data.healthIcon.id).toLowerCase() : null;
    for (const f of files.filter(x => this.IMG.test(x.name) && /^icon-/i.test(x.name))) {
      const st = this.stem(f.name);
      if (hi && st !== 'icon-' + hi && files.filter(x => /^icon-/i.test(x.name) && this.IMG.test(x.name)).length > 1) continue;
      const id = hi && files.filter(x => /^icon-/i.test(x.name) && this.IMG.test(x.name)).length === 1 ? hi : st.replace(/^icon-/, '');
      this.put(this.realExt(`images/icons/icon-${id}.png`, f), f, f.name);
      const xml = files.find(x => /\.xml$/i.test(x.name) && this.stem(x.name) === st); if (xml) this.put(`images/icons/icon-${id}.xml`, xml, xml.name);
    }
  },
  putChar(c) {
    this.put(`data/characters/${c.id}.json`, c.json, c.json.name);
    for (const nd of c.needs) {
      if (nd.file) this.put(this.realExt(`${nd.base}.${nd.kind}`, nd.file), nd.file, nd.file.name);
      if (nd.files) for (const f of nd.files) this.put(`${nd.base}/${f.name}`, f, f.name);
    }
  },

  /* ---------- Asignar icono (Player / Enemigo) ---------- */
  iconIds: {},
  iconIdFor(role) {
    const c = Scene.chars[role], hi = c && c.data && c.data.healthIcon;
    return String((hi && hi.id) || (c && c.id) || (role === 'bf' ? 'bf' : 'dad'));
  },
  async assignIcon(role) {
    const files = await this.pick('.png,.xml,.json,' + ASTC_ACCEPT, true); if (!files.length) return;
    let want = this.iconIdFor(role);
    // un JSON de personaje: su healthIcon.id
    for (const f of files.filter(x => /\.json$/i.test(x.name))) { try { const d = JSON.parse(await f.text()); if (d.healthIcon && d.healthIcon.id) want = String(d.healthIcon.id); else if (Array.isArray(d.animations)) want = f.name.replace(/\.json$/i, ''); } catch (e) {} }
    const imgs = files.filter(f => this.IMG.test(f.name)), xmls = files.filter(f => /\.xml$/i.test(f.name));
    const byName = (list, id) => list.find(f => this.stem(f.name) === 'icon-' + id.toLowerCase() || this.stem(f.name) === id.toLowerCase());
    let img = byName(imgs, want), xml = byName(xmls, want), id = want;
    if (!img) {
      // sin coincidencia por healthIcon: la imagen elegida (si es una sola, o la primera icon-*)
      img = imgs.length === 1 ? imgs[0] : imgs.find(f => /^icon-/i.test(f.name)) || imgs[0];
      if (!img) { toast('Elige un icono .png / .astc (icon-<id>.png, frames de 150×150) o su .xml'); return; }
      id = this.stem(img.name).replace(/^icon-/, '');
      xml = byName(xmls, id) || (xmls.length === 1 ? xmls[0] : null);
    }
    const uid = 'usuario-' + role + '-' + id.replace(/[^\w-]/g, '_');
    for (const d of ASSET_CFG.iconDirs) {
      this.put(this.realExt(`${d}icon-${uid}.png`, img), img, img.name);
      if (xml) this.put(`${d}icon-${uid}.xml`, xml, xml.name);
    }
    this.iconIds[role] = uid;
    const c = Scene.chars[role], hi = Object.assign({}, c && c.data && c.data.healthIcon || {}, { id: uid });
    const ic = await new HealthIcon(role === 'bf' ? 0 : 1).load(uid, hi);
    if (!ic.ok || ic.fallbackFace) { toast('✘ No se pudo leer ese icono', 3500); return; }
    const k = role === 'bf' ? 'player' : 'opponent';
    Scene.icons[k] = ic; if (Scene.baseIcons) Scene.baseIcons[k] = ic;
    this.iconInfo = this.iconInfo || {}; this.iconInfo[role] = `${img.name}${xml ? ' + ' + xml.name : ''} (healthIcon "${want}"${id !== want ? ', elegido a mano' : ''}) — ${ic.kind}`;
    toast(`✔ Icono ${this.ROLE_ES[role]}: ${img.name} (${ic.kind})`, 3000);
    this.render();
  },

  /* ---------- Asignar parlante (GF) ---------- */
  async assignSpeaker(dir) {
    const files = await this.pick(dir ? '' : '.xml,.png,.json,' + ASTC_ACCEPT, true, dir); if (!files.length) return;
    const anim = files.find(f => f.name === 'Animation.json');
    let ap, label;
    if (anim) {
      const d = this.rel(anim).split('/').slice(0, -1).join('/') || 'atlas';
      for (const f of files.filter(x => this.rel(x).startsWith(d + '/') || !this.rel(x).includes('/'))) if (/\.(json|png|astc|ktx2?)$/i.test(f.name)) this.put(`shared/images/parlante-usuario/${f.name}`, f, f.name);
      ap = 'shared:parlante-usuario'; label = d + '/ (Animate)';
    } else {
      const xml = files.find(f => /\.xml$/i.test(f.name)), img = (xml && files.find(f => this.IMG.test(f.name) && this.stem(f.name) === this.stem(xml.name).replace(/\.xml$/i, ''))) || files.find(f => this.IMG.test(f.name));
      if (!img) { toast('Elige la hoja del parlante: .png/.astc + .xml (Sparrow), o una carpeta Animate'); return; }
      if (xml) this.put('shared/images/parlante-usuario.xml', xml, xml.name);
      this.put(this.realExt('shared/images/parlante-usuario.png', img), img, img.name);
      ap = 'shared:parlante-usuario'; label = img.name + (xml ? ' + ' + xml.name : '');
    }
    Speaker.user = { ap, label, rt: anim ? 'animateatlas' : 'sparrow' };
    await this.reloadSpeaker();
    toast(Speaker.cur && !Speaker.cur.improv ? `✔ Parlante asignado: ${label}` : '✘ No se pudo leer el parlante', 3500);
  },
  async reloadSpeaker() {
    const ids = Scene.ids ? JSON.parse(Scene.ids) : {};
    await Speaker.setup(Scene.stage, Scene.chars.gf, (Scene.chars.gf && Scene.chars.gf.id) || ids.gf);
    try { Render.prewarm(Speaker.textures()); } catch (e) {}
    this.render(); if (typeof renderAssetList === 'function') renderAssetList();
  },

  /* ---------- Cargar shaders ---------- */
  async loadShader(kind) {
    const files = await this.pick(kind === 'hxc' ? '.hxc' : '.frag,.vert,.glsl', true); if (!files.length) return;
    if (!Render.wantGL()) toast('Los shaders necesitan WebGL (Optimización → Render: Auto/WebGL). Se cargan pero no se ven con Canvas.', 5000);
    let sh = null;
    if (kind === 'hxc') { for (const f of files.filter(x => /\.hxc$/i.test(x.name))) sh = await Shaders.addHxc(f); }
    else sh = await Shaders.addFrag(files);
    if (sh) {
      const miss = Shaders.requirements().filter(r => r.sh === sh && r.sh[r.part] == null);
      if (miss.length) { toast(`${sh.name}: falta ${miss.map(r => r.key).join(' y ')} (no está en shaders/) → elígelo`, 5000); for (const r of miss) { const fs = await this.pick(r.part === 'vert' ? '.vert,.glsl' : '.frag,.glsl', false); if (fs.length) await Shaders.provide(r, fs); } }
      toast(sh.prog ? `✔ Shader ${sh.name} activo${Optim.s.shaders ? '' : ' (Optimización → Shaders está en Off)'}` : `✘ Shader ${sh.name}: ${sh.error}`, 5000);
    }
    this.render();
  },

  /* ---------- aplicar ---------- */
  put(path, blob, name) { this.registered.push(VFS.put(path, blob, name)); },
  register() {
    const ov = {};
    const st = this.stage;
    if (st) {
      this.put(`data/stages/${st.id}.json`, st.json, st.fileName);
      for (const nd of st.needs) if (nd.file) for (const p of nd.paths) this.put(this.realExt(p, nd.file), nd.file, nd.file.name);
      ov.stage = st.id;
    }
    for (const role of ['bf', 'gf', 'dad']) {
      const c = this.roles[role]; if (!c) continue;
      this.putChar(c);
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
    for (const r of ['bf', 'dad']) if (this.iconInfo && this.iconInfo[r]) out.push(`✔ icono ${this.ROLE_ES[r]} asignado: ${this.iconInfo[r]}`);
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
    // iconos (Player / Enemigo)
    const icoTxt = role => { const ic = Scene.icons[role === 'bf' ? 'player' : 'opponent']; return ic ? (ic.ok ? `${ic.where ? ic.where.split('/').pop() : ''} (${ic.kind}${ic.fallbackFace ? ', sin icon-' + escHtml(ic.wanted) + ' → icon-face' : ''})` : 'sin icono (falta, no se dibuja)') : '—'; };
    h.push(`<h4>Iconos</h4><div class="ua-roles">${['bf', 'dad'].map(r => `<button class="btn mini" type="button" data-ua="icon:${r}">🙂 Asignar icono ${this.ROLE_ES[r]}</button>`).join('')}</div>
      <div class="ua-info">${['bf', 'dad'].map(r => `<div class="ok">${this.ROLE_ES[r]} (healthIcon "${escHtml(this.iconIdFor(r))}"): ${escHtml(icoTxt(r))}</div>`).join('')}</div>`);
    // parlante de GF
    h.push(`<h4>Parlante de GF</h4><div class="ua-roles"><button class="btn mini" type="button" data-ua="spk">🔊 Asignar parlante</button><button class="btn mini alt" type="button" data-ua="spkdir">📁 Parlante Animate (carpeta)</button></div>
      <div class="ua-info"><div class="${Speaker.cur && !Speaker.cur.improv ? 'ok' : Speaker.need ? 'warn' : 'ok'}">${escHtml(Speaker.info || '—')}</div>
      ${Speaker.cur ? `<div class="ua-off">Ajuste X <input type="number" step="10" data-spk="0" value="${SPEAKER_CFG.offset[0]}"> Y <input type="number" step="10" data-spk="1" value="${SPEAKER_CFG.offset[1]}"></div>` : ''}</div>`);
    // shaders
    h.push(`<h4>Shaders (WebGL)</h4><div class="ua-roles"><button class="btn mini" type="button" data-ua="shhxc">✨ Cargar shader (.hxc)</button><button class="btn mini alt" type="button" data-ua="shfrag">✨ Cargar .frag / .vert</button></div>`);
    if (Shaders.list.length) h.push(`<div class="ua-info">${Shaders.list.map((sh, i) => `<div class="${sh.prog ? 'ok' : 'bad'}">${sh.prog ? '✔' : '✘'} ${escHtml(sh.name)}${sh.prog ? '' : ' — ' + escHtml(sh.error)} <label><input type="checkbox" data-sh="${i}" ${sh.on ? 'checked' : ''}> activo</label> <button class="btn mini x" type="button" data-ua="shrm:${i}">✕</button></div>`).join('')}
      <div class="row"><label for="shTarget">Aplicar a</label><select id="shTarget"><option value="mundo" ${Shaders.target === 'mundo' ? 'selected' : ''}>Cámara del juego (mundo)</option><option value="todo" ${Shaders.target === 'todo' ? 'selected' : ''}>Todo (mundo + HUD)</option></select></div>
      ${!Optim.s.shaders ? '<div class="warn">Optimización → Shaders está en Off</div>' : ''}${!Render.wantGL() ? '<div class="warn">Render actual: Canvas → los shaders no se ven (Optimización → Render: WebGL)</div>' : ''}</div>`);
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
      else if (a.startsWith('icon:')) this.assignIcon(a.slice(5)).catch(err => toast('Error: ' + err.message));
      else if (a === 'spk' || a === 'spkdir') this.assignSpeaker(a === 'spkdir').catch(err => toast('Error: ' + err.message));
      else if (a === 'shhxc' || a === 'shfrag') this.loadShader(a === 'shhxc' ? 'hxc' : 'frag').catch(err => toast('Error: ' + err.message));
      else if (a.startsWith('shrm:')) { Shaders.remove(+a.slice(5)); this.render(); }
    }));
    box.querySelectorAll('[data-sh]').forEach(c => c.addEventListener('change', e => { e.stopPropagation(); const sh = Shaders.list[+c.dataset.sh]; if (sh) sh.on = c.checked; }));
    box.querySelectorAll('[data-spk]').forEach(c => c.addEventListener('change', e => { e.stopPropagation(); SPEAKER_CFG.offset[+c.dataset.spk] = +c.value || 0; }));
    const st2 = $('shTarget'); if (st2) st2.addEventListener('change', e => { e.stopPropagation(); Shaders.target = st2.value; });
  },
};
