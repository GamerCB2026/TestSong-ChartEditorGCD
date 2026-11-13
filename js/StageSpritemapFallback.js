/* =====================================================================
   StageSpritemapFallback.js — si un prop del escenario pide un sprite
   (PNG) y no aparece, se intenta cargar esa misma ruta como CARPETA
   de spritemap de Adobe Animate (Animation.json + spritemapN.json +
   spritemapN.png), el mismo formato que ya usan los personajes.

   Reutiliza loadGraphic / atlasParsearAnimacion / atlasAgregarSpritemap
   / atlasBuscarAnimacion / atlasDibujarR. No reescribe stages.js: se
   engancha a loadStage, drawPropInner y StageRT.swapProp.
   ===================================================================== */
'use strict';

const StageSpritemapFallback = {
  /* Carga un Animate Atlas desde las rutas candidatas del prop (sin .png). */
  async loadAtlas(cands) {
    const bases = uniq((cands || []).map(c => String(c || '').replace(/\.png$/i, '')).filter(Boolean));
    if (!bases.length) return null;
    /* loadGraphic ya busca Animation.json + spritemap en libImagePaths.
       Aquí las bases son las del escenario (weekN/images/..., shared/images/...). */
    if (typeof loadGraphic === 'function' && bases.length) {
      /* prueba cada base como si fuera un assetPath de librería */
      for (const b of bases) {
        const g = await this._loadFromBase(b);
        if (g) return g;
      }
    }
    return null;
  },

  async _loadFromBase(b) {
    const an = await fetchFirst([b + '/Animation.json']);
    if (!an) return null;
    let model;
    try { model = atlasParsearAnimacion(an.data); } catch (e) { console.warn('[spritemap]', b, e); return null; }
    for (let i = 1; i <= 12; i++) {
      const sm = await fetchFirst(i === 1 ? [b + '/spritemap1.json', b + '/spritemap.json'] : [`${b}/spritemap${i}.json`]);
      if (!sm) break;
      let spm;
      try { spm = atlasLeerSpritemap(sm.data); } catch (e) { break; }
      const png = sm.path.replace(/\.json$/, '.png');
      const img = await loadImg([spm.imagen ? b + '/' + spm.imagen : png, png], { world: true });
      if (img) atlasAgregarSpritemap(model, spm, img);
    }
    if (!model.sprites.size) return null;
    return { type: 'atlas', model, where: b };
  },

  /* Arma las animaciones del JSON del prop (o la timeline completa como "idle"). */
  buildAnims(g, pJson) {
    const anims = new Map();
    const list = (pJson && Array.isArray(pJson.animations) && pJson.animations.length)
      ? pJson.animations
      : [{ name: 'idle', prefix: '', looped: true }];
    for (const a of list) {
      const r = atlasBuscarAnimacion(g.model, { prefijo: a.prefix || a.name || '', indices: a.frameIndices || [], animType: a.animType });
      const frames = r && r.frames && r.frames.length ? r.frames : null;
      if (!frames) continue;
      anims.set(a.name || 'idle', {
        name: a.name || 'idle',
        type: 'atlas',
        model: g.model,
        timeline: r.timeline,
        frames,
        fps: +a.frameRate || 24,
        loop: a.looped !== undefined ? !!a.looped : true,
        off: a.offsets || [0, 0],
      });
    }
    /* si ninguna coincidió, usa toda la timeline principal */
    if (!anims.size && g.model && g.model.principal) {
      const tl = g.model.principal;
      const n = Math.max(1, tl.frameCount || (tl.frames && tl.frames.length) || 1);
      const frames = Array.from({ length: n }, (_, i) => i);
      anims.set('idle', { name: 'idle', type: 'atlas', model: g.model, timeline: tl, frames, fps: 24, loop: true, off: [0, 0] });
    }
    return anims;
  },

  applyToProp(prop, g, pJson) {
    if (!g || g.type !== 'atlas') return false;
    const anims = this.buildAnims(g, pJson);
    if (!anims.size) return false;
    const startName = (pJson && (pJson.startingAnimation || (pJson.animations && pJson.animations[0] && pJson.animations[0].name))) || 'idle';
    const st = anims.get(startName) || anims.get('idle') || anims.values().next().value;
    prop.atlas = true;
    prop.atlasModel = g.model;
    prop.atlasTimeline = st.timeline;
    prop.atlasWhere = g.where;
    prop.anims = anims;
    prop.hasLR = anims.has('danceLeft') && anims.has('danceRight');
    prop.img = null;
    prop.path = g.where;
    propSet(prop, st, st.loop);
    return true;
  },

  /* Candidatos de imagen de un prop (mismas rutas que stages.js). */
  candidates(stage, pJson, prop) {
    const ap = String((pJson && pJson.assetPath) || prop.__ap0 || '');
    if (!ap || ap.startsWith('#')) return [];
    const pa = parseAssetPath(ap);
    const id = stage.id, dir = (stage.data && stage.data.directory) || 'shared';
    const cands = ASSET_CFG.stageImagePaths.map(t => fillT(t, { stage: id, path: pa.path, dir }));
    if (ap.includes(':')) cands.unshift(`${pa.lib}/images/${pa.path}.png`);
    return cands;
  },

  /* Tras loadStage: props sin imagen ni frames → intentar carpeta de spritemap. */
  async fixStage(st) {
    if (!st || !st.props) return st;
    const jsonProps = (st.data && st.data.props) || [];
    await Promise.all(st.props.map(async (prop, i) => {
      if (prop.img || prop.color || (prop.frames && prop.frames.length && !prop.atlas)) return;
      if (prop.atlas) return;
      const pJson = jsonProps[i] || { assetPath: prop.name, animations: [], animType: prop.animType };
      const cands = this.candidates(st, pJson, prop);
      if (!cands.length) return;
      try {
        const g = await this.loadAtlas(cands);
        if (g) this.applyToProp(prop, g, pJson);
      } catch (e) { console.warn('[spritemap] prop', prop.name, e); }
    }));
    if (typeof stageModeFor === 'function') stageModeFor(st);
    return st;
  },

  /* Dibuja un prop de atlas con el mismo renderer que los personajes. */
  draw(p, v, zoom, R) {
    const a = p.anims && p.cur ? p.anims.get(p.cur) : null;
    const model = (a && a.model) || p.atlasModel;
    const tl = (a && a.timeline) || p.atlasTimeline;
    const frames = (a && a.frames) || p.frames;
    if (!model || !tl || !frames || !frames.length) return;
    const n = frames.length;
    const i0 = typeof animFrame === 'function' ? animFrame(G.gameTime - (p.t0 || 0), p.fps || 24) : Math.floor(((G.gameTime || 0) - (p.t0 || 0)) / 1000 * (p.fps || 24));
    const i = p.loop ? ((i0 % n) + n) % n : clamp(i0, 0, n - 1);
    const fr = frames[i];
    const M = worldMatrix(v, zoom, (p.scroll && p.scroll[0]) || 1, (p.scroll && p.scroll[1]) || 1, _pM);
    mmul(M, M, mset(_pL, 1, 0, 0, 1, p.pos[0], p.pos[1]));
    const off = p.off || [0, 0];
    const sx = (p.scale[0] || 1) * (p.flipX ? -1 : 1);
    const sy = (p.scale[1] || 1) * (p.flipY ? -1 : 1);
    mmul(M, M, mset(_pL, sx, 0, 0, sy, -off[0], -off[1]));
    const smooth = !p.isPixel && !(typeof Optim !== 'undefined' && Optim.s && !Optim.s.aa);
    atlasDibujarR(R, model, tl, fr, M, p.alpha ?? 1, smooth, false);
  },

  install() {
    if (this._ok) return;
    this._ok = true;
    if (typeof loadStage === 'function') {
      const prev = loadStage;
      loadStage = async function (id) {
        const st = await prev(id);
        if (st) await StageSpritemapFallback.fixStage(st);
        return st;
      };
    }
    if (typeof drawPropInner === 'function') {
      const prevDraw = drawPropInner;
      drawPropInner = function (p, v, zoom, R) {
        if (p && p.atlas) return StageSpritemapFallback.draw(p, v, zoom, R);
        return prevDraw(p, v, zoom, R);
      };
    }
    /* al cambiar el assetPath de un prop desde un script .hxc de escenario */
    if (typeof StageRT !== 'undefined' && StageRT.swapProp) {
      const prevSwap = StageRT.swapProp.bind(StageRT);
      StageRT.swapProp = async function (st, p, pd) {
        await prevSwap(st, p, pd);
        if (p && !p.img && !p.anims && pd) {
          const cands = StageSpritemapFallback.candidates(st, pd, p);
          const g = await StageSpritemapFallback.loadAtlas(cands);
          if (g) StageSpritemapFallback.applyToProp(p, g, pd);
        }
      };
    }
  },
};

StageSpritemapFallback.install();
