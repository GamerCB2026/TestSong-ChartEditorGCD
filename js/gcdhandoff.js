/* =====================================================================
   gcdhandoff.js (v4.2.0) — Chart Editor GCD → Vista → "FNF GCD".
   El editor deja el chart (.fnfc: chart + metadata + Inst + Voices) en
   IndexedDB (mismo origen: gamercb2026.github.io) o lo envía por postMessage
   (editor abierto en file:// u otro origen). Aquí se carga y se juega; luego
   un asistente pide los .json de personajes/stage, carpeta del stage, sprites,
   .hxc de eventos (+ extras) con botones Omitir / Quedarme con lo implementado.
   ===================================================================== */
'use strict';
const GCDHandoff = {
  DB: 'gcd-handoff', STORE: 'p', KEY: 'ultimo', done: false,
  idb(mode, fn) {
    return new Promise((ok, ko) => {
      if (!window.indexedDB) return ok(null);
      const rq = indexedDB.open(this.DB, 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore(this.STORE);
      rq.onerror = () => ko(rq.error);
      rq.onsuccess = () => { const db = rq.result, tx = db.transaction(this.STORE, mode), r = fn(tx.objectStore(this.STORE)); tx.oncomplete = () => { db.close(); ok(r && r.result); }; tx.onerror = () => { db.close(); ko(tx.error); }; };
    });
  },
  async fromIDB() {
    try { const p = await this.idb('readonly', s => s.get(this.KEY)); if (p && p.files && p.files.length) { this.idb('readwrite', s => s.delete(this.KEY)).catch(() => {}); return p; } } catch (e) { console.warn('[GCD] IndexedDB', e); }
    return null;
  },
  fromOpener(ms) {
    return new Promise(ok => {
      if (!window.opener) return ok(null);
      const t = setTimeout(() => { removeEventListener('message', on); ok(null); }, ms);
      const on = e => { const d = e.data; if (d && d.type === 'gcd-song' && Array.isArray(d.files)) { clearTimeout(t); removeEventListener('message', on); ok(d); } };
      addEventListener('message', on);
      try { window.opener.postMessage({ type: 'gcd-handoff-ready' }, '*'); } catch (e) { ok(null); }
    });
  },
  waitBoot() { return new Promise(ok => { const k = () => (G.chart && !Loader.active) ? ok() : setTimeout(k, 150); k(); }); },
  async start() {
    const p = new URLSearchParams(location.search); if (!p.has('gcd')) return;
    const data = (await this.fromOpener(2500)) || (await this.fromIDB());
    await this.waitBoot();
    if (!data) { toast('FNF GCD: no llegó ningún chart del Chart Editor GCD', 4000); return; }
    try { await this.play(data); } catch (e) { console.error('[GCD]', e); toast('Chart del editor inválido: ' + e.message, 5000); }
  },
  async play(data) {
    const files = data.files.map(f => new File([f.blob instanceof Blob ? f.blob : new Blob([f.blob])], f.name, { type: SongImport.mime(f.name) }));
    const r = await readChartFiles(files);
    if (r.pack && r.pack.vars.length) {
      const e = r.pack.entries[0] || { v: 'default', d: undefined };
      await loadVariation(r.pack, e.v, e.d);
    } else {
      const audio = []; if (r.inst) audio.push({ blob: r.inst, role: 'inst', name: 'Inst.ogg' });
      r.voices.forEach((v, i) => audio.push({ blob: v.blob, role: r.voices.length > 1 ? (i ? 'opponent' : 'player') : 'voices', name: v.name }));
      G.raw = r.raw; G.meta = r.meta; G.pack = null; G.set = null;
      await loadChart(Chart.parse(r.raw, r.meta), audio, { label: 'Cargando chart del editor…' });
    }
    this.done = true;
    toast('Chart recibido del Chart Editor GCD: ' + (data.song || G.chart.title || ''), 3500);
    this.full = true;   // v4.2.0: siempre se piden personajes / stage (lo que ya existe sale con ✔)
    this.checkMissing();
  },
  /* v4.1.0: asistente de assets faltantes al recibir un chart del Chart Editor GCD.
     Pide: .json de personajes, .json del stage, carpeta del stage, sprites de personajes
     (Sparrow / MultiSparrow / Animate Atlas…), .hxc de eventos + extras que piden esos eventos.
     Botones: Omitir (jugar con los de por defecto) / Quedarme con lo implementado (aplica lo cargado). */
  esc: s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
  scan() {
    const sc = (G.chart && G.chart.scene) || {}, out = { chars: [], stage: null, events: [], extras: [] };
    for (const role of ['bf', 'dad', 'gf']) {
      const c = Scene.chars[role];
      const falta = sc[role] && (!c || c.error || c.fallbackFrom);
      if (falta || this.full) out.chars.push({ role, id: sc[role] || (c && c.id) || '—', falta: !!falta, fallback: falta && c && !c.error ? (c.id || c.name || ASSET_CFG.chars[role]) : null });
    }
    const st = Scene.stage; out.stageFalta = !!(sc.stage && (!st || st.error || st.fallbackFrom));
    if (out.stageFalta || this.full) out.stage = sc.stage || (st && st.id) || '—';
    try { const u = ModUI.unknown(G.chart); out.events = [...u.ev.entries()].map(([k, n]) => ({ id: k, n })); out.kinds = [...u.nk.entries()].map(([k, n]) => ({ id: k, n })); } catch (e) { out.kinds = []; }
    try { out.extras = ModUI.requirements().filter(r => r.type !== 'note' && r.type !== 'module' && r.type !== 'class' && ModUI.reqStatus(r) === 'missing'); } catch (e) {}
    return out;
  },
  /* asistente completo (pide todo aunque exista): tras un chart del editor o desde los botones Importar */
  open(focus) { this.full = true; this.need = this.scan(); try { openOverlay('pause'); } catch (e) {} this.render(); const t = focus && this.box().querySelector(`[data-a="${focus}"]`); if (t) t.scrollIntoView({ block: 'center' }); },
  /* Test Song → "Chart GCD": abre el Chart Editor GCD para elegir un chart; el editor lo devuelve por postMessage */
  EDITOR_URL: 'https://gamercb2026.github.io/Chart-Editor-GCD/',
  pickFromEditor() {
    const win = window.open(this.EDITOR_URL + '?testsong=' + Date.now(), '_blank');
    if (!win) { toast('El navegador bloqueó la pestaña. Permite ventanas emergentes.', 4000); return; }
    toast('Chart Editor GCD abierto: elige un chart y pulsa "Jugar en Test Song"', 5000);
    if (this._pick) removeEventListener('message', this._pick);
    this._pick = async e => {
      if (e.source !== win) return;
      const d = e.data;
      if (d && d.type === 'gcd-picker-ready') { try { win.postMessage({ type: 'gcd-picker-ack' }, '*'); } catch (err) {} return; }
      if (!d || d.type !== 'gcd-song' || !Array.isArray(d.files)) return;
      removeEventListener('message', this._pick); this._pick = null;
      try { win.close(); } catch (err) {}
      try { window.focus(); } catch (err) {}
      try { this.viaEditor = true; await this.play(d); } catch (err) { console.error('[GCD]', err); toast('Chart del editor inválido: ' + err.message, 5000); }
    };
    addEventListener('message', this._pick);
  },
  checkMissing() {
    const m = this.scan();
    this.need = m;
    if (!this.full && !m.chars.length && !m.stage && !m.events.length && !(m.kinds || []).length && !m.extras.length) return;
    try { openOverlay('pause'); } catch (e) {}
    this.render();
  },
  box() {
    let box = $('gcdMissing');
    if (!box) {
      box = document.createElement('div'); box.id = 'gcdMissing'; box.setAttribute('role', 'dialog');
      box.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:9999;background:#15151c;color:#fff;border:2px solid #ff91f1;border-radius:12px;padding:16px 18px;width:min(94vw,560px);max-height:88vh;overflow:auto;font:14px/1.4 sans-serif;box-shadow:0 8px 30px #000a';
      box.addEventListener('keydown', e => e.stopPropagation());
      box.addEventListener('click', e => this.onClick(e));
      document.body.appendChild(box);
    }
    return box;
  },
  render() {
    const m = this.need || this.scan(), esc = this.esc, UA = UserAssets, box = this.box();
    const B = (a, txt, bg, extra = '') => `<button data-a="${a}" ${extra} style="margin:4px 4px 0 0;padding:7px 10px;border:0;border-radius:8px;cursor:pointer;font-weight:bold;background:${bg};color:${bg === '#444' || bg === '#2a2a36' ? '#fff' : '#111'}">${txt}</button>`;
    const ok = v => v ? '<span style="color:#7dff9a">✔</span>' : '<span style="color:#ff6b6b">✘</span>';
    const sec = (t, body) => `<div style="margin:10px 0;padding:8px 10px;background:#1e1e28;border-radius:8px"><b style="color:#ff91f1">${t}</b><div style="margin-top:4px">${body}</div></div>`;
    let h = `<b style="font-size:16px;color:#ff91f1">${this.full ? 'Chart GCD: personajes, stage e iconos' : 'Chart del Chart Editor GCD: faltan assets'}</b><div style="opacity:.8;margin:4px 0 6px">Agrega lo que falte o pulsa <b>Omitir</b>. Con <b>Quedarme con lo implementado</b> se aplica lo que ya cargaste y se juega.</div>`;
    // personajes
    if (m.chars.length) h += sec('1 · Personajes (.json + sprites)', m.chars.map(c => {
      const rec = UA.roles[c.role], kind = rec ? (rec.atlas ? 'Animate Atlas' : rec.multi ? 'MultiSparrow' : 'Sparrow') : '';
      const spr = rec ? UA.ready(rec) : false;
      return `<div style="margin:6px 0">${ok(rec && spr)} <b>${esc(UA.ROLE_ES[c.role])}</b>: "${esc(c.id)}"${c.falta ? ' <span style="color:#ff6b6b">(falta)</span>' : ''}${c.fallback ? ` <span style="opacity:.6">(ahora: ${esc(c.fallback)})</span>` : ''}<br>` +
        `${ok(rec)} JSON ${rec ? esc(rec.json.name) + ' · ' + kind : ''} ${B('cjson', 'Seleccionar .json', '#ff91f1', `data-r="${c.role}"`)}<br>` +
        `${ok(spr)} Sprites ${rec ? (rec.atlas ? '(carpeta con Animation.json + spritemap)' : rec.multi ? '(varios .xml + .png)' : '(.xml + .png / .astc)') : '(primero el .json)'} ` +
        `${B('cspr', 'Archivos', '#7fd3ff', `data-r="${c.role}"`)}${B('cdir', 'Carpeta', '#7fd3ff', `data-r="${c.role}"`)}` +
        (rec ? `<div style="opacity:.75;font-size:12px">${rec.needs.map(n => (n.file || (n.files && n.files.length) ? '✔ ' : n.optional ? '· ' : '✘ ') + esc(n.label)).join('<br>')}</div>` : '') + '</div>';
    }).join(''));
    // escenario
    if (m.stage) {
      const st = UA.stage, have = st ? st.needs.filter(n => n.file).length : 0;
      h += sec('2 · Escenario', `${m.stageFalta ? 'Falta' : 'Actual'}: "${esc(m.stage)}"<br>${ok(st)} .json del stage ${st ? esc(st.fileName) : ''} ${B('sjson', 'Seleccionar .json', '#ff91f1')}<br>` +
        `${ok(st && have === st.needs.length)} Carpeta del stage ${st ? `(${have}/${st.needs.length} imágenes)` : '(primero el .json)'} ${B('sdir', 'Seleccionar carpeta', '#7fd3ff')}`);
    }
    // eventos
    const evs = m.events.concat((m.kinds || []).map(k => ({ id: k.id + ' (note kind)', n: k.n })));
    if (evs.length || m.extras.length) {
      let body = evs.length ? evs.map(e => `✘ ${esc(e.id)} <span style="opacity:.6">×${e.n}</span>`).join('<br>') + '<br>' + B('hxc', 'Seleccionar .hxc', '#ff91f1') + B('hxdir', 'Carpeta del mod (scripts + extras)', '#7fd3ff') : '';
      if (m.extras.length) body += `<div style="margin-top:6px"><b>Extras que piden los eventos:</b>${m.extras.map((r, i) => `<div>✘ ${esc(typeof ModUI.reqLabel === 'function' ? ModUI.reqLabel(r) : (r.kind ? r.kind + ': ' : '') + r.key)} ${B('extra', 'Agregar', '#7fd3ff', `data-i="${i}"`)}</div>`).join('')}</div>`;
      h += sec('3 · Eventos (.hxc) y extras', body);
    }
    if (this.full) h += sec('4 · Iconos', ['bf', 'dad'].map(r => `${ok(UA.iconIds && UA.iconIds[r])} ${esc(UA.ROLE_ES[r])} ${B('icon', 'Importar icono', '#7fd3ff', `data-r="${r}"`)}`).join('<br>'));
    h += `<div style="margin-top:10px;display:flex;flex-wrap:wrap">${B('keep', 'Quedarme con lo implementado', '#7dff9a')}${B('skip', 'Omitir', '#444')}</div>`;
    box.innerHTML = h; box.hidden = false;
  },
  async onClick(e) {
    const b = e.target && e.target.closest && e.target.closest('button[data-a]'); if (!b) return;
    e.stopPropagation();
    const a = b.dataset.a, r = b.dataset.r, UA = UserAssets, box = this.box();
    try {
      if (a === 'skip' || a === 'keep') this.full = false;
      if (a === 'skip') { box.hidden = true; try { if (G.overlayKind) closeOverlay(); } catch (err) {} toast('Assets omitidos: se juega con los de por defecto', 3000); return; }
      if (a === 'keep') {
        box.hidden = true;
        const any = UA.stage || Object.values(UA.roles).some(Boolean);
        if (any) await UA.apply(); else { try { if (G.overlayKind) closeOverlay(); } catch (err) {} }
        return;
      }
      if (a === 'cjson') await UA.loadChar(r);
      else if (a === 'cspr') await UA.charFiles(r, false);
      else if (a === 'cdir') await UA.charFiles(r, true);
      else if (a === 'icon') await UA.assignIcon(r);
      else if (a === 'sjson') await UA.loadStageJson();
      else if (a === 'sdir') await UA.stageFolder();
      else if (a === 'hxc') await ModUI.loadHxc(await ModUI.pick('.hxc', true));
      else if (a === 'hxdir') { const f = await ModUI.pick('', true, true); if (f.length) await ModUI.loadFolder(f); }
      else if (a === 'extra') { const req = this.need.extras[+b.dataset.i]; if (req) { const f = await ModUI.pick(ModUI.reqAccept(req), true, false); if (f.length) await ModUI.provide(req, f); } }
    } catch (err) { console.warn('[GCD]', err); toast('Error: ' + err.message, 4000); }
    // eventos/extras se recalculan (un .hxc puede pedir más archivos); personajes/escenario se mantienen en la lista
    const fresh = this.scan(); this.need.events = fresh.events; this.need.kinds = fresh.kinds; this.need.extras = fresh.extras;
    try { $('modModal').hidden = true; } catch (err) {}
    this.render();
  },
};
window.GCDHandoff = GCDHandoff;
GCDHandoff.start();
