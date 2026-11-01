/* =====================================================================
   gcdhandoff.js — Chart Editor GCD → Vista → "FNF GCD".
   El editor deja el chart (.fnfc: chart + metadata + Inst + Voices) en
   IndexedDB (mismo origen: gamercb2026.github.io) o lo envía por postMessage
   (editor abierto en file:// u otro origen). Aquí se carga y se juega; luego
   una ventana avisa qué personajes / escenario faltan para agregarlos u omitirlos.
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
    this.checkMissing();
  },
  /* personajes / escenario que no existen aquí → ventana: agregarlos o seguir sin ellos */
  checkMissing() {
    const sc = (G.chart && G.chart.scene) || {}, miss = [];
    for (const role of ['bf', 'dad', 'gf']) { const c = Scene.chars[role]; if (sc[role] && (!c || c.error || c.fallbackFrom)) miss.push(`${UserAssets.ROLE_ES[role]}: "${sc[role]}"` + (c && !c.error ? ` (se usa "${c.id || c.name || ASSET_CFG.chars[role]}")` : '')); }
    const st = Scene.stage; if (sc.stage && (!st || st.error || st.fallbackFrom)) miss.push(`Escenario: "${sc.stage}"`);
    if (!miss.length) return;
    if (typeof closeOverlay === 'function') try { openOverlay('pause'); } catch (e) {}
    let box = $('gcdMissing');
    if (!box) {
      box = document.createElement('div'); box.id = 'gcdMissing';
      box.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:9999;background:#15151c;color:#fff;border:2px solid #ff91f1;border-radius:12px;padding:16px 18px;max-width:min(92vw,440px);font:14px/1.4 sans-serif;box-shadow:0 8px 30px #000a';
      document.body.appendChild(box);
    }
    const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const btn = 'margin:4px 4px 0 0;padding:8px 12px;border:0;border-radius:8px;cursor:pointer;font-weight:bold';
    box.innerHTML = `<b style="color:#ff91f1">Faltan assets del chart</b><div style="margin:8px 0">${miss.map(m => '• ' + esc(m)).join('<br>')}</div>` +
      `<div style="opacity:.8;margin-bottom:6px">Puedes agregar los personajes / escenario (JSON + imágenes), cargar el mod completo, u omitirlos y jugar con los de por defecto.</div>` +
      `<button data-a="assets" style="${btn};background:#ff91f1">Agregar personaje / escenario</button>` +
      `<button data-a="mod" style="${btn};background:#7fd3ff">Cargar mod (carpeta / .zip)</button>` +
      `<button data-a="skip" style="${btn};background:#444;color:#fff">Omitir y jugar</button>`;
    box.hidden = false;
    box.onclick = e => {
      const a = e.target && e.target.dataset && e.target.dataset.a; if (!a) return;
      box.hidden = true;
      if (a === 'skip') { try { closeOverlay(); } catch (err) {} return; }
      try { openOverlay('pause'); togglePanel(a === 'assets' ? 'assets' : 'chart'); } catch (err) { console.warn(err); }
    };
  },
};
window.GCDHandoff = GCDHandoff;
GCDHandoff.start();
