/* =====================================================================
   notes.js — notas, receptores (strums), colas de sustain y splashes.
   Assets (en orden de preferencia):
     · shared/images/NoteAssets/<color>0000.png, "<color> hold piece0000.png", "<color> hold end0000.png"
     · receptores: shared/images/noteStrumline.xml/png (V-Slice: staticLeft0/pressLeft0/confirmLeft0)
                   o NOTE_assets.xml (legacy: arrowLEFT / left press / left confirm)
                   o NoteAssets/"<color> static0000.png" / "<color> press0000.png" / "<color> confirm0000.png"
                   (si no hay: receptor gris generado a partir de la nota)
     · splashes:   shared/images/noteSplashes.xml/png ("note impact 1 purple0"...) — si no: destello improvisado
   Posiciones como Strumline.hx (STRUMLINE_SIZE 104, NOTE_SPACING 112, escala 0.7).
   ===================================================================== */
'use strict';

const NOTE_W = 157 * FNF.NOTE_SCALE;      // ancho de la nota/receptor del juego a escala 0.7 (≈110 px)

function frameFromImg(img) {
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  return { img, x: 0, y: 0, w, h, fw: w, fh: h, dw: w, dh: h, offX: 0, offY: 0, rot: false };
}

async function loadNoteSkin() {
  const skin = { head: [], piece: [], end: [], strum: [], press: [], confirm: [], splash: [], placeholder: [false, false, false, false], src: {} };
  const Dirs = ['Left', 'Down', 'Up', 'Right'];
  const [sheetV, sheetL, sheetS, holdImg] = await Promise.all([
    loadSparrowSheet(ASSET_CFG.strumSheets), loadSparrowSheet(ASSET_CFG.legacyNoteSheets), loadSparrowSheet(ASSET_CFG.splashSheets), loadImg(ASSET_CFG.holdSheets)]);
  await Promise.all([0, 1, 2, 3].map(async i => {
    const v = { color: ASSET_CFG.noteColors[i], dir: LANE_NAMES[i], DIR: LANE_DIRS[i], Dir: Dirs[i] };
    const f = list => (Array.isArray(list) ? list : [list]).map(t => ASSET_CFG.noteDir + fillT(t, v));
    const fromSheet = (sh, prefix) => { if (!sh) return null; const fr = sparrowFrames(sh.atlas, prefix, null, sh.img); return fr.length ? fr : null; };
    // las PNG sueltas (NoteAssets/) solo se buscan si las hojas no traen lo necesario (menos peticiones 404)
    const sheetHead = fromSheet(sheetL, v.color + '0') || fromSheet(sheetL, v.color + ' instance');
    const sheetHold = holdImg || fromSheet(sheetL, v.color + ' hold piece');
    const sheetStrum = fromSheet(sheetV, 'static' + v.Dir + '0');
    const none = Promise.resolve(null);
    const [head, piece, end, st, pr, cf] = await Promise.all([
      sheetHead ? none : loadImg(f(ASSET_CFG.noteHead)), sheetHold ? none : loadImg(f(ASSET_CFG.holdPiece)), sheetHold ? none : loadImg(f(ASSET_CFG.holdEnd)),
      sheetStrum ? none : loadImg(f(ASSET_CFG.strumStatic)), sheetStrum ? none : loadImg(f(ASSET_CFG.strumPress)), sheetStrum ? none : loadImg(f(ASSET_CFG.strumConfirm))]);
    // nota (cabeza)
    skin.head[i] = head ? [frameFromImg(head)] : sheetHead;
    if (holdImg) {   // V-Slice NOTE_hold_assets.png: columnas (pieza, final) por carril; la pieza se estira, el final abajo
      const cw = holdImg.naturalWidth / 8, ch = holdImg.naturalHeight;
      const col = c => ({ img: holdImg, x: Math.round(c * cw) + 1, y: 0, w: Math.floor(cw) - 2, h: ch, fw: Math.floor(cw) - 2, fh: ch, dw: Math.floor(cw) - 2, dh: ch, offX: 0, offY: 0, rot: false });
      skin.piece[i] = Object.assign(col(i * 2), { y: 1, h: ch - 12, fh: ch - 12, dh: ch - 12 }); skin.end[i] = Object.assign(col(i * 2 + 1), { h: Math.round(ch * 0.8), fh: Math.round(ch * 0.8), dh: Math.round(ch * 0.8) });
          }
    if (!holdImg) {
      skin.piece[i] = piece ? frameFromImg(piece) : (fromSheet(sheetL, v.color + ' hold piece') || [])[0] || null;
      skin.end[i] = end ? frameFromImg(end) : (fromSheet(sheetL, v.color + ' hold end') || fromSheet(sheetL, v.dir === 'left' ? 'pruple end hold' : '\0') || [])[0] || null;
    }
    // receptores
    skin.strum[i] = fromSheet(sheetV, 'static' + v.Dir + '0') || (st && [frameFromImg(st)]) || fromSheet(sheetL, 'arrow' + v.DIR) || fromSheet(sheetL, 'arrow static instance ' + [1, 2, 4, 3][i] + '0');
    skin.press[i] = fromSheet(sheetV, 'press' + v.Dir + '0') || (pr && [frameFromImg(pr)]) || fromSheet(sheetL, v.dir + ' press');
    skin.confirm[i] = fromSheet(sheetV, 'confirm' + v.Dir + '0') || (cf && [frameFromImg(cf)]) || fromSheet(sheetL, v.dir + ' confirm');
    if (skin.head[i]) {
      const h0 = skin.head[i][0], hImg = h0.img === head ? head : null;
      const base = hImg || (() => { const c = document.createElement('canvas'); c.width = h0.fw; c.height = h0.fh; drawSparrowFrame(c.getContext('2d'), h0, 0, 0); return c; })();
      if (!skin.strum[i]) { skin.strum[i] = [frameFromImg(tintCanvas(base, [18, 22, 30], [135, 163, 173]))]; skin.placeholder[i] = true; }
      if (!skin.press[i]) { const c = hexRgb(LANE_DARK[i]); skin.press[i] = [frameFromImg(tintCanvas(base, [10, 6, 18], c.map(x => Math.min(255, x * 1.6 + 30))))]; }
    }
    // splashes (2 variantes por color)
    const col = v.color;
    skin.splash[i] = [fromSheet(sheetS, 'note impact 1 ' + col), fromSheet(sheetS, 'note impact 2 ' + col), fromSheet(sheetS, 'note impact 1  ' + col)].filter(Boolean);
  }));
  skin.ok = skin.head.some(Boolean);
  skin.src = { strumSheet: sheetV && sheetV.where, legacySheet: sheetL && sheetL.where, splashSheet: sheetS && sheetS.where,
    headFrom: skin.head.some(h => h && h[0] && sheetL && h[0].img === sheetL.img) ? sheetL.where + '.xml' : (skin.head.some(Boolean) ? ASSET_CFG.noteDir : null),
    holdFrom: holdImg ? holdImg.assetPath + ' (V-Slice)' : (sheetL && skin.piece.some(Boolean) ? sheetL.where + '.xml' : null) };
  skin.hasSplash = skin.splash.some(s => s.length);
  return skin;
}

/* ---------- Geometría (unidades del HUD) ---------- */
function laneX(side, i) { const s = LAYOUT[side]; if (s.lanes) return s.lanes[i]; const x0 = (s.splitX != null && i >= 2) ? s.splitX : s.x; return x0 + (FNF.INITIAL_OFFSET + i * FNF.NOTE_SPACING * s.spacing) * s.k + NOTE_W * s.k / 2; }
function strumCY(side) { const s = LAYOUT[side]; return s.y + NOTE_W * s.k / 2; }
function pxPerMs(side) { return FNF.PIXELS_PER_MS * ((G.speedSide && G.speedSide[side]) || G.speed) * LAYOUT[side].k; }   // evento ScrollSpeed (por strumline)
function noteY(side, t) { const s = LAYOUT[side], d = (t - G.songPos) * pxPerMs(side); return strumCY(side) + (s.down ? -d : d); }

function drawFrameCentered(frames, t, cx, cy, sc, alpha = 1, loop = false, glow = null) {
  if (!frames || !frames.length) return;
  const n = frames.length, i = Math.floor(t / 1000 * 24), fr = frames[loop ? i % n : Math.min(i, n - 1)];
  ctx.save(); ctx.globalAlpha *= alpha;
  if (glow) { ctx.shadowColor = glow; ctx.shadowBlur = 30 * sc; }
  drawSparrowFrame(ctx, fr, cx - fr.fw * sc / 2, cy - fr.fh * sc / 2, sc);
  ctx.restore();
}

/* v3.5.0: receptor en reposo teñido (Toque en celular, como V-Slice móvil): se tiñe UNA vez y se guarda */
const _tintCache = new WeakMap();
function drawTinted(frames, cx, cy, sc, tint) {
  if (!frames || !frames.length) return;
  const fr = frames[0]; let c = _tintCache.get(fr);
  if (!c || c.tint !== tint) {
    c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(fr.fw)); c.height = Math.max(1, Math.ceil(fr.fh)); c.tint = tint;
    const g = c.getContext('2d'); drawSparrowFrame(g, fr, 0, 0, 1);
    g.globalCompositeOperation = 'source-atop'; g.globalAlpha = 0.55; g.fillStyle = tint; g.fillRect(0, 0, c.width, c.height);
    _tintCache.set(fr, c);
  }
  ctx.drawImage(c, cx - fr.fw * sc / 2, cy - fr.fh * sc / 2, fr.fw * sc, fr.fh * sc);
}
/* --- Flecha vectorial (si no hay NoteAssets) --- */
const ARROW = [[-0.46, 0], [-0.02, -0.42], [-0.02, -0.16], [0.42, -0.16], [0.42, 0.16], [-0.02, 0.16], [-0.02, 0.42]];
const ROT = [0, -Math.PI / 2, Math.PI / 2, Math.PI];
function drawArrow(x, y, size, lane, fill, edge = '#fff', glow = 0, alpha = 1) {
  ctx.save(); ctx.globalAlpha = alpha; ctx.translate(x, y); ctx.rotate(ROT[lane]); ctx.scale(size, size);
  ctx.beginPath(); ARROW.forEach(([px, py], i) => i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)); ctx.closePath();
  ctx.lineJoin = 'round';
  if (glow) { ctx.shadowColor = LANE_COLORS[lane]; ctx.shadowBlur = size * 0.5 * glow; }
  ctx.lineWidth = 0.2; ctx.strokeStyle = '#000'; ctx.stroke(); ctx.shadowBlur = 0;
  ctx.fillStyle = fill; ctx.fill();
  ctx.lineWidth = 0.055; ctx.strokeStyle = edge; ctx.stroke();
  ctx.restore();
}

/* --- cola de sustain: de yA (cabeza/receptor) a yB (final) --- */
function drawSustain(side, lane, x, yA, yB, alpha) {
  const sk = Scene.notes, k = LAYOUT[side].k, sc = FNF.NOTE_SCALE * k, down = LAYOUT[side].down;
  const piece = sk && sk.piece[lane], end = sk && sk.end[lane];
  const len = Math.abs(yB - yA); if (len <= 1) return;
  ctx.save(); ctx.globalAlpha *= alpha;
  if (piece || end) {
    const ref = piece || end, pw = ref.fw * sc, eh = Math.min(end ? end.fh * sc : 0, len);
    ctx.translate(x, yA); if (down) ctx.scale(1, -1);     // en downscroll la cola va hacia arriba
    if (piece) drawSparrowFrame(ctx, piece, -pw / 2, 0, pw / piece.fw, (len - eh + 1) / piece.fh);
    if (end) drawSparrowFrame(ctx, end, -pw / 2, len - eh, pw / end.fw, eh / end.fh);
  } else {
    const w = NOTE_W * k * 0.3, top = Math.min(yA, yB);
    ctx.fillStyle = LANE_COLORS[lane]; ctx.globalAlpha *= 0.8;
    rr(x - w / 2, top, w, len, w / 2); ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.stroke();
  }
  ctx.restore();
}

/* --- splashes --- */
const Splashes = [];
function spawnSplash(side, lane) {
  if (!Optim.s.splashes) return;   // Optimización → Splashes desactivados
  const sk = Scene.notes, list = sk && sk.splash[lane];
  Splashes.push({ side, lane, t0: G.gameTime, frames: list && list.length ? list[randInt(0, list.length - 1)] : null, fps: 24 + randInt(-2, 2) });
  if (Splashes.length > 12) Splashes.shift();
}
function drawSplashes() {
  for (let i = Splashes.length - 1; i >= 0; i--) {
    const s = Splashes[i], t = G.gameTime - s.t0, k = LAYOUT[s.side].k, x = laneX(s.side, s.lane), y = strumCY(s.side);
    if (s.frames) {
      const n = s.frames.length, fi = Math.floor(t / 1000 * s.fps);
      if (fi >= n) { Splashes.splice(i, 1); continue; }
      const fr = s.frames[fi], sc = k;   // noteSplashes del juego ya vienen a su tamaño (escala 1)
      ctx.save(); ctx.globalAlpha = FNF.SPLASH_ALPHA;
      drawSparrowFrame(ctx, fr, x - fr.fw * sc / 2, y - fr.fh * sc / 2, sc); ctx.restore();
    } else {
      // improvisado: destello del color del carril
      if (t > 320) { Splashes.splice(i, 1); continue; }
      const p = t / 320, r = NOTE_W * k * (0.45 + 0.55 * p);
      ctx.save(); ctx.globalAlpha = FNF.SPLASH_ALPHA * (1 - p); ctx.strokeStyle = LANE_COLORS[s.lane]; ctx.lineCap = 'round';
      ctx.lineWidth = 9 * k * (1 - p) + 2;
      for (let a = 0; a < 8; a++) { const ang = a * Math.PI / 4 + 0.3; ctx.beginPath(); ctx.moveTo(x + Math.cos(ang) * r * 0.55, y + Math.sin(ang) * r * 0.55); ctx.lineTo(x + Math.cos(ang) * r, y + Math.sin(ang) * r); ctx.stroke(); }
      ctx.restore();
    }
  }
}

/* --- receptores + notas --- */
function strumAnim(side, i) {
  const st = G.strums[side], age = G.gameTime - st.confirmAt[i];
  if (side === 'player' && !isBot()) {
    if (st.pressed[i]) return (st.confirmHeld[i] || age < 150) ? ['confirm', age] : ['press', G.gameTime - st.pressAt[i]];
    return age < 150 ? ['confirm', age] : ['static', 0];
  }
  return (age < 150 || st.hold[i]) ? ['confirm', age] : ['static', 0];
}

function drawStrumsAndNotes() {
  const sk = Scene.notes, hasImg = sk && sk.ok;
  for (const side of ['opponent', 'player']) {
    const ss = StrumState[side] || { alpha: 1, visible: true, x: 0, y: 0, lane: [] };   // alpha/visible/x/y que tocan los scripts .hxc
    if (!ss.visible) continue;
    const k = LAYOUT[side].k, sc = FNF.NOTE_SCALE * k, y = strumCY(side), base = (LAYOUT[side].strumAlpha ?? LAYOUT[side].alpha ?? 1) * ss.alpha;
    ctx.save(); ctx.translate(ss.x, ss.y);
    for (let i = 0; i < 4; i++) {
      const ln = ss.lane[i] || { alpha: 1, visible: true }; if (!ln.visible) continue;
      ctx.globalAlpha = clamp(base * ln.alpha, 0, 1);
      const x = laneX(side, i), [anim, t] = strumAnim(side, i);
      if (hasImg && sk.head[i]) {
        if (anim === 'confirm') {
          if (sk.confirm[i]) drawFrameCentered(sk.confirm[i], t, x, y, sc);
          else drawFrameCentered(sk.head[i], 0, x, y, sc * (1 + 0.08 * Math.max(0, 1 - t / 140)), 1, false, LANE_COLORS[i]);
        } else if (anim === 'press') drawFrameCentered(sk.press[i], t, x, y, sc * (sk.placeholder[i] ? 0.92 : 1));
        else if (LAYOUT[side].tintIdle) drawTinted(sk.strum[i], x, y, sc, LAYOUT[side].tintIdle);   // Toque (celular): receptor morado/gris semitransparente
        else drawFrameCentered(sk.strum[i], 0, x, y, sc, 1);
        continue;
      }
      const sz = NOTE_W * k * 0.95;
      if (anim === 'confirm') drawArrow(x, y, sz * (1 + 0.08 * Math.max(0, 1 - t / 140)), i, LANE_COLORS[i], '#fff', 1.2);
      else if (anim === 'press') drawArrow(x, y, sz * 0.92, i, LANE_DARK[i], '#ddd');
      else drawArrow(x, y, sz, i, '#87a3ad', '#c7d6e0', 0, 0.9);
    }
    ctx.restore();
  }
  // notas (y colas de sustain). Rival en "mini modo" (controles V-Slice: Flechas): solo receptores.
  for (const side of ['opponent', 'player']) {
    const ss = StrumState[side] || { alpha: 1, visible: true, x: 0, y: 0 };
    if (!ss.visible || LAYOUT[side].hideNotes) continue;
    ctx.save(); ctx.translate(ss.x, ss.y);
    ctx.globalAlpha = clamp((LAYOUT[side].alpha ?? 1) * ss.alpha, 0, 1);
    drawNotesOf(side);
    ctx.restore();
  }
  drawSplashes();
}
function drawNotesOf(only) {
  const sk = Scene.notes, hasImg = sk && sk.ok;
  for (const n of G.chart.notes) {
    if (n.side !== only || n.skipped) continue;
    if (n.time - G.songPos > 4000) break;
    const side = n.side, k = LAYOUT[side].k, y = noteY(side, n.time), x = laneX(side, n.lane), down = LAYOUT[side].down;
    const off = (yy) => down ? yy < -NOTE_W || yy > V.h + NOTE_W * 4 : yy > V.h + NOTE_W || yy < -NOTE_W * 4;
    if (n.sustain > 0 && !n.dropped && !(n.hit && !n.holding)) {
      const yEnd = noteY(side, n.time + n.sustain), yStart = n.hit ? strumCY(side) : y;
      if (!(off(yStart) && off(yEnd))) drawSustain(side, n.lane, x, yStart, yEnd, n.missed ? 0.3 : 1);
    }
    if (n.hit || n.passed) continue;
    if (y < -NOTE_W * 2 || y > V.h + NOTE_W * 2) continue;
    const a = n.missed ? 0.35 : 1;
    // note kind con estilo propio (noteStyleId del .hxc + data/notestyles/<id>.json)
    const st = n.kind ? NoteStyles.headFor(n.kind) : null;
    if (st && st.head && st.head[n.lane]) drawFrameCentered(st.head[n.lane], 0, x, y, FNF.NOTE_SCALE * k * (st.scale || 1), a);
    else if (hasImg && sk.head[n.lane]) drawFrameCentered(sk.head[n.lane], 0, x, y, FNF.NOTE_SCALE * k, a);
    else drawArrow(x, y, NOTE_W * k * 0.95, n.lane, LANE_COLORS[n.lane], '#fff', 0, a);
    // note kind "hurt" sin estilo cargado: marca roja para distinguirla
    if (!st && n.kind && NoteKinds.isHurt(n.kind)) {
      ctx.save(); ctx.globalAlpha *= a; ctx.strokeStyle = '#ff2a2a'; ctx.lineWidth = 7 * k; const r = NOTE_W * k * 0.28;
      ctx.beginPath(); ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r); ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r); ctx.stroke(); ctx.restore();
    }
  }
}
