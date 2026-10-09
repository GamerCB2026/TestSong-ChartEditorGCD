/* =====================================================================
   movil.js — celular: SOLO horizontal ("Gira tu dispositivo" en vertical,
   con la partida en pausa), botón de pantalla completa (+ bloqueo de
   orientación) y controles táctiles:
     · Off      → 4 zonas grandes (toda la pantalla, como antes)
     · Flechas  → como V-Slice móvil (FunkinHitbox "Arrows"): zonas invisibles
                  que siguen a los receptores del jugador (ancho de la nota ×1.35)
     · Hitbox   → como V-Slice (FunkinHitbox "FourLanes"): 4 carriles invisibles
                  que se iluminan con un degradado al tocar
   ===================================================================== */
'use strict';

const Movil = {
  portrait: false,
  isTouch() { return (window.matchMedia && matchMedia('(pointer: coarse)').matches) || navigator.maxTouchPoints > 0 || 'ontouchstart' in window; },
  isIOS() { return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); },
  isFs() { return !!(document.fullscreenElement || document.webkitFullscreenElement); },
  check() {
    const touch = this.isTouch();
    document.body.classList.toggle('movil', touch);
    const p = touch && innerHeight > innerWidth;
    if (p !== this.portrait) {
      this.portrait = p;
      document.body.classList.toggle('vertical', p);
      $('rotar').hidden = !p;
      if (p) {
        // en vertical no se juega: se pausa (al girar, "Reanudar" en el menú de pausa)
        releaseAllTouches();
        if (G.chart && !Loader.active && !G.overlayKind) openOverlay('pause');
      }
    }
    this.syncFs();
  },
  syncFs() {
    const b = $('fsBtn'); if (!b) return;
    b.hidden = !(document.body.classList.contains('movil') && !this.portrait && !this.isFs());
  },
  async fullscreen() {
    const el = document.documentElement;
    const req = el.requestFullscreen ? o => el.requestFullscreen(o) : el.webkitRequestFullscreen ? () => el.webkitRequestFullscreen() : null;
    if (!req || this.isIOS() && !el.requestFullscreen) {
      toast('En iPhone/iPad Safari no deja poner pantalla completa: toca Compartir → "Añadir a pantalla de inicio" y abre el juego desde ese icono (se ve sin barras).', 7000);
      return false;
    }
    try { await req({ navigationUI: 'hide' }); }
    catch (e) { toast('El navegador no permitió la pantalla completa: ' + (e.message || e), 4000); return false; }
    try { if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape'); } catch (e) { /* algunos navegadores no dejan bloquear la orientación */ }
    setTimeout(() => { resize(); }, 250);
    return true;
  },
};
['fullscreenchange', 'webkitfullscreenchange'].forEach(ev => document.addEventListener(ev, () => { Movil.syncFs(); setTimeout(resize, 120); }));
window.addEventListener('orientationchange', () => setTimeout(resize, 200));
$('fsBtn').addEventListener('click', e => { e.stopPropagation(); Movil.fullscreen(); });
$('rotarFs').addEventListener('click', e => { e.stopPropagation(); Movil.fullscreen(); });

/* ---------- zonas de toque ---------- */
const HUD_TO_SCREEN = (x, y) => [V.ox + x * V.s, V.oy + y * V.s];
/* carriles de "Flechas": rectángulos (px de pantalla) que siguen a los receptores del jugador */
function arrowHints() {
  const s = LAYOUT.player, k = s.k, pitch = FNF.NOTE_SPACING * s.spacing * k, nh = NOTE_W * k;
  const w = Math.max(pitch, nh * 1.35);
  const top = strumCY('player') - nh / 2 - 220, h = nh * 8;   // FunkinHitbox.follow: y - 220, alto ×8
  return [0, 1, 2, 3].map(i => {
    const [x0, y0] = HUD_TO_SCREEN(laneX('player', i) - w / 2, top);
    return { x: x0, y: y0, w: w * V.s, h: h * V.s };
  });
}
function touchLane(cx, cy) {
  if (Opts.vslice === 'arrows') {
    const hs = arrowHints();
    for (let i = 0; i < 4; i++) { const r = hs[i]; if (cx >= r.x && cx < r.x + r.w && cy >= r.y && cy < r.y + r.h) return i; }
    return -1;
  }
  return clamp(Math.floor(cx / (W / 4)), 0, 3);
}
const pointers = new Map();
const laneHeld = lane => [...pointers.values()].includes(lane);
function releaseAllTouches() { for (const l of new Set(pointers.values())) if (l >= 0) release(l); pointers.clear(); }
cv.addEventListener('pointerdown', e => {
  if (Loader.active || Movil.portrait || ModUI.open) return;
  if (G.mode !== 'mobile') { if (e.pointerType === 'touch' && (G.mode === 'demo' || G.mode === 'keyboard')) { setMode('mobile'); toast('Modo Táctil activado 📱'); } else return; }
  const lane = touchLane(e.clientX, e.clientY);
  pointers.set(e.pointerId, lane); e.preventDefault();
  try { cv.setPointerCapture(e.pointerId); } catch (err) {}
  if (lane >= 0) press(lane);
});
cv.addEventListener('pointermove', e => {
  if (!pointers.has(e.pointerId) || G.mode !== 'mobile') return;
  const old = pointers.get(e.pointerId), lane = touchLane(e.clientX, e.clientY);
  if (lane === old) return;
  pointers.set(e.pointerId, lane);      // deslizar el dedo a otro carril (como el hitbox de V-Slice)
  if (old >= 0 && !laneHeld(old)) release(old);
  if (lane >= 0) press(lane);
});
const endPointer = e => {
  if (!pointers.has(e.pointerId)) return;
  const lane = pointers.get(e.pointerId); pointers.delete(e.pointerId);
  if (lane >= 0 && !laneHeld(lane)) release(lane);
};
cv.addEventListener('pointerup', endPointer); cv.addEventListener('pointercancel', endPointer); cv.addEventListener('lostpointercapture', endPointer);

/* dibujo de las zonas (después del HUD, en px de pantalla) */
function drawTouchZones() {
  if (G.mode !== 'mobile') return;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const pressed = G.strums.player.pressed;
  if (Opts.vslice === 'arrows') return;     // invisibles: el receptor hace de botón (como el juego)
  if (Opts.vslice === 'hitbox') {
    // FourLanes: carril invisible (alpha 0.00001); al tocar, degradado radial del color del carril (alpha 0.3)
    // y en reposo dos tiras con degradado arriba/abajo (3.5% del alto) a 0.3
    const lw = W / 4, eh = Math.max(6, H * 0.035);
    for (let i = 0; i < 4; i++) {
      const x = i * lw, col = LANE_COLORS[i];
      if (pressed[i]) {
        ctx.save(); ctx.globalAlpha = 0.3;
        ctx.translate(x + lw / 2, H / 2); ctx.scale(lw / 2, H / 2);
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1.42);
        g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(60 / 255, 'rgba(0,0,0,0)'); g.addColorStop(1, col);
        ctx.fillStyle = g; ctx.fillRect(-1, -1, 2, 2); ctx.restore();
      } else {
        ctx.globalAlpha = 0.3;
        let g = ctx.createLinearGradient(0, 0, 0, eh); g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.fillRect(x, 0, lw, eh);
        g = ctx.createLinearGradient(0, H - eh, 0, H); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, col);
        ctx.fillStyle = g; ctx.fillRect(x, H - eh, lw, eh);
        ctx.globalAlpha = 1;
      }
    }
    ctx.globalAlpha = 1;
    return;
  }
  // Off: las 4 zonas grandes de siempre
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = LANE_COLORS[i]; ctx.globalAlpha = pressed[i] ? 0.22 : 0.05; ctx.fillRect(i * W / 4, 0, W / 4, H);
    ctx.globalAlpha = 0.45; ctx.fillRect(i * W / 4, H - 5, W / 4, 5); ctx.globalAlpha = 1;
  }
}
