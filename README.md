# Test Song · Chart Editor GCD

Pantalla de juego estilo FNF en **un solo `index.html`** (CSS + JS dentro). Usa los assets reales
del juego (estructura V-Slice) si están en el repo; si falta algo, usa los dibujos improvisados.

> Ábrelo con **GitHub Pages** (o un servidor local: `python -m http.server`).
> Con doble clic (`file://`) el navegador bloquea la carga de los JSON/atlas y verás los dibujos improvisados.

## Estructura del repo

```
index.html
README.md
data/
  characters/bf.json        <- personaje Boyfriend (V-Slice, multianimateatlas)
  characters/dad.json       <- Daddy Dearest (animateatlas)
  characters/gf.json        <- Girlfriend (animateatlas, danceLeft/danceRight)
  stages/mainStage.json     <- escenario por defecto (props, posiciones, zoom de cámara)
shared/images/
  characters/bf/            Animation.json, spritemap1.json, spritemap1.png
  characters/dad/           Animation.json, spritemap1.json, spritemap1.png
  characters/gf/            Animation.json, spritemap1.json, spritemap1.png
  characters/bf-death/ , characters/bfFakeOut/   (opcionales: muerte, aún no se usan)
  characters/BOYFRIEND.xml + BOYFRIEND.png       (Sparrow, opcional)
  mainStage/                stageback.png, stagefront.png, stagecurtains.png
  NoteAssets/               purple0000.png, blue0000.png, green0000.png, red0000.png,
                            "<color> hold piece0000.png", "<color> hold end0000.png"
  icons/                    icon-bf.png, icon-dad.png (150x150 por frame; 300x150 = normal|perdiendo)
```

Carriles: purple = izquierda, blue = abajo, green = arriba, red = derecha.

## Qué se carga y de dónde

* **Personajes**: `data/characters/<id>.json` → `assetPath` (`shared:characters/bf` = `shared/images/characters/bf`).
  Se detecta solo: carpeta con `Animation.json` + `spritemapN.json/png` = Animate Atlas; `<nombre>.xml` + `.png` = Sparrow.
  Usa `offsets`, `flipX`, `scale`, `singTime`, `frameIndices`, `-hold` y `...miss`.
* **Escenario**: `data/stages/<id>.json`; imágenes en `shared/images/<id>/<assetPath>.png` (también busca en `shared/images/`).
  Parallax (`scroll`), `zIndex`, `scale`, `alpha`, `cameraZoom` y posiciones/cámara de bf, dad y gf.
* **Notas**: `shared/images/NoteAssets/`. La **nota normal (receptor)** todavía no existe: se dibuja un receptor gris
  provisional. Cuando la tengas, guárdala como `purple static0000.png`, `blue static0000.png`, ... (o `arrowLEFT0000.png`...)
  y opcionalmente `<color> press0000.png` / `<color> confirm0000.png`. Los nombres se cambian en `ASSET_CFG` dentro de index.html.
* **Iconos**: `shared/images/icons/icon-<id>.png` (si no está, cara improvisada).
* Si los JSON de `data/` no están, se usan copias incluidas dentro de index.html.
* Un `.fnfc` / metadata con `playData.characters` y `playData.stage` cambia personajes y escenario (si existen).

En el menú de pausa → **🖼 Assets cargados** se ve qué se encontró y qué falta.

URL opcionales: `?zoom=0.8` (alejar cámara), `?bf=`, `?dad=`, `?gf=`, `?stage=`, `?modo=keyboard|mobile|botplay|demo`.
