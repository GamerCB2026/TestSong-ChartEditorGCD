/* =====================================================================
   hud.js — barra de vida (healthBar.png o barra negra), iconos, texto de
   puntuación, popups de calificación (sick/good/bad/shit + num0-9),
   cuenta regresiva (ready/set/go) y textos varios.
   Posiciones de PlayState.hx / PopUpStuff.hx / Countdown.hx a 1280x720.
   ===================================================================== */
'use strict';

const HudImg = { bar: null, popup: {}, countdown: [] };

async function loadHudAssets() {
  const pop = name => loadImg(ASSET_CFG.popupDirs.map(d => d + name + '.png'));
  const names = ['sick', 'good', 'bad', 'shit', 'combo', ...Array.from({ length: 10 }, (_, i) => 'num' + i)];
  const [bar, popImgs, cd] = await Promise.all([
    loadImg(ASSET_CFG.healthBar),
    Promise.all(names.map(pop)),
    Promise.all(ASSET_CFG.countdownImages.map(n => n ? loadImg(ASSET_CFG.countdownDirs.map(d => d + n + '.png')) : null)),
  ]);
  HudImg.bar = bar; names.forEach((n, i) => { HudImg.popup[n] = popImgs[i]; }); HudImg.countdown = cd;
  const pf = names.filter(n => HudImg.popup[n]), pm = names.filter(n => !HudImg.popup[n]);
  AssetLog.set('healthBar', !!bar, bar ? `barra de vida: ${bar.assetPath}` : `barra de vida: falta ${ASSET_CFG.healthBar[0]} → barra negra del mismo tamaño (601x19)`);
  AssetLog.set('popup', pf.length > 0, `calificaciones: ${pf.length}/${names.length} (${ASSET_CFG.popupDirs[0]})${pm.length ? ' · faltan: ' + pm.join(', ') : ''}${HudImg.popup.combo ? ' · combo.png no se usa en V-Slice (?combo=1 para verlo)' : ''}`);
  const cf = ['ready', 'set', 'go'].filter((n, i) => cd[i + 1]);
  AssetLog.set('countdown', cf.length > 0, `cuenta regresiva: ${cf.length}/3 imágenes${cf.length < 3 ? ' · faltan: ' + ['ready', 'set', 'go'].filter((n, i) => !cd[i + 1]).map(n => ASSET_CFG.countdownDirs[0] + n + '.png').join(', ') : ''}`);
}

/* ---------- barra de vida + iconos ---------- */
function drawHealthBar() {
  const b = LAYOUT.bar, bw = FNF.HEALTH_BAR_W, bh = FNF.HEALTH_BAR_H;
  if (HudImg.bar) ctx.drawImage(HudImg.bar, b.x, b.y, HudImg.bar.naturalWidth, HudImg.bar.naturalHeight);
  else { ctx.fillStyle = '#000'; ctx.fillRect(b.x, b.y, bw, bh); }
  const ix = b.x + 4, iy = b.y + 4, iw = bw - 8, ih = bh - 8;
  const hv = clamp(G.healthLerp, 0, FNF.HEALTH_MAX), split = iw * (1 - hv / FNF.HEALTH_MAX);   // FlxBar RIGHT_TO_LEFT
  ctx.fillStyle = COLORS.opp; ctx.fillRect(ix, iy, split, ih);
  ctx.fillStyle = COLORS.player; ctx.fillRect(ix + split, iy, iw - split, ih);
  // iconos (HealthIcon.updatePosition)
  const p1 = Scene.icons.player, p2 = Scene.icons.opponent;
  if (p2) { const s = p2.targetSize(); p2.draw(ix + split - (s.w - FNF.ICON_POSITION_OFFSET), iy - s.h / 2, s.w, s.h, G.health > FNF.ICON_WINNING); }
  if (p1) { const s = p1.targetSize(); p1.draw(ix + split - FNF.ICON_POSITION_OFFSET, iy - s.h / 2, s.w, s.h, G.health < FNF.ICON_LOSING); }
}

/* ---------- texto de puntuación (vcr.ttf; si no está, monoespaciada) ---------- */
const VCR_FONT = '"VCR", "VCR OSD Mono", "Courier New", monospace';
function drawScoreText() {
  const b = LAYOUT.bar;
  const s = isBot() ? 'Bot Play Enabled' : 'Score: ' + formatMoney(G.score);
  const x = LAYOUT.portrait ? V.w / 2 : b.x + FNF.HEALTH_BAR_W - 190, y = b.y + (LAYOUT.portrait ? 92 : 30 + 8);
  ctx.font = `16px ${VCR_FONT}`; ctx.textAlign = LAYOUT.portrait ? 'center' : 'left'; ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round'; ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.strokeText(s, x, y);
  ctx.fillStyle = '#fff'; ctx.fillText(s, x, y);
}

/* ---------- popups (PopUpStuff) ---------- */
const Popups = [];
function displayRating(id) {
  const j = CONFIG.judgments.find(j => j.id === id) || CONFIG.judgments[1];
  const img = HudImg.popup[id], sc = FNF.RATING_SCALE;
  const w = img ? img.naturalWidth * sc : 200, h = img ? img.naturalHeight * sc : 60;
  const c = LAYOUT.popup;
  Popups.push({ img, txt: img ? null : j.text, color: j.color, x: c.rx - w / 2, y: c.ry - h / 2, w, h,
    vx: -randInt(0, 10), vy: -randInt(140, 175), ay: 550, t: 0, delay: G.chart.crochet, sc });
}
function displayCombo(combo) {
  const digits = []; let t = combo;
  while (t !== 0) { digits.push(t % 10); t = Math.floor(t / 10); }
  while (digits.length < 3) digits.push(0);
  const c = LAYOUT.popup;
  digits.forEach((d, i) => {
    const img = HudImg.popup['num' + d], sc = FNF.COMBO_NUM_SCALE;
    Popups.push({ img, txt: img ? null : String(d), color: '#fff', x: c.nx - 36 * (i + 1) - 65, y: c.ny, w: img ? img.naturalWidth * sc : 40, h: img ? img.naturalHeight * sc : 54,
      vx: rand(-5, 5), vy: -randInt(130, 150), ay: randInt(250, 300), t: 0, delay: G.chart.crochet * 2, sc });
  });
  if (CONFIG.showComboSprite && HudImg.popup.combo) {
    const img = HudImg.popup.combo, sc = 0.55;
    Popups.push({ img, x: c.nx - 10, y: c.ny + 10, w: img.naturalWidth * sc, h: img.naturalHeight * sc, vx: rand(-5, 5), vy: -randInt(100, 120), ay: 600, t: 0, delay: G.chart.crochet, sc });
  }
}
function updatePopups(dt) {
  const s = dt / 1000;
  for (let i = Popups.length - 1; i >= 0; i--) {
    const p = Popups[i]; p.t += dt;
    p.vy += p.ay * s; p.x += p.vx * s; p.y += p.vy * s;
    if (p.t > p.delay + 200) Popups.splice(i, 1);
  }
}
function drawPopups() {
  for (const p of Popups) {
    const a = p.t < p.delay ? 1 : clamp(1 - (p.t - p.delay) / 200, 0, 1);
    ctx.save(); ctx.globalAlpha = a;
    if (p.img) ctx.drawImage(p.img, p.x, p.y, p.w, p.h);
    else text(p.txt, p.x + p.w / 2, p.y + p.h / 2, p.h * 0.8, p.color);
    ctx.restore();
  }
}

/* ---------- cuenta regresiva (Countdown.hx: 5 beats antes; THREE sin imagen) ---------- */
function drawCountdown() {
  if (G.songPos >= 0) return;
  const b = Math.floor(G.songPos / G.chart.crochet), step = b + 4;   // 0=THREE 1=TWO 2=ONE 3=GO
  if (step < 0 || step > 3) return;
  const f = (G.songPos / G.chart.crochet) - b, alpha = 1 - cubeInOut(f);
  const anyImg = HudImg.countdown.some(Boolean), img = HudImg.countdown[step];
  ctx.save(); ctx.globalAlpha = alpha;
  if (img) ctx.drawImage(img, (V.w - img.naturalWidth) / 2, (V.h - img.naturalHeight) / 2);
  else if (!anyImg) text(['3', '2', '1', '¡YA!'][step], V.w / 2, V.h / 2, 110, step === 3 ? '#ffe27a' : '#fff');
  ctx.restore();
}

function drawHUD() {
  drawHealthBar();
  drawScoreText();
  drawPopups();
  drawCountdown();
  if (Scene.loading) text('Cargando assets…', 14, V.h - 20, 14, 'rgba(255,255,255,' + (0.5 + 0.4 * Math.sin(G.gameTime / 200)) + ')', 'left', '700');
}

/* zonas táctiles (pantalla completa, 4 columnas) */
function drawTouchZones() {
  if (G.mode !== 'mobile') return;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = LANE_COLORS[i]; ctx.globalAlpha = G.strums.player.pressed[i] ? 0.22 : 0.05; ctx.fillRect(i * W / 4, 0, W / 4, H);
    ctx.globalAlpha = 0.45; ctx.fillRect(i * W / 4, H - 5, W / 4, 5); ctx.globalAlpha = 1;
  }
}
