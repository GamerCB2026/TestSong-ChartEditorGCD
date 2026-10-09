#!/usr/bin/env python3
"""Genera texturas.json (opcional) para Test Song · Chart Editor GCD v3.3.0.

Con este archivo en la raíz del sitio el juego sabe qué imágenes existen y NO pide rutas que no están
(cero errores 404 al buscar x.png / x.astc / x.ktx / x.ktx2).

Uso (desde la carpeta del sitio, la que tiene index.html):
    python herramientas/texturas_json.py            → solo imágenes (.png .astc .ktx .ktx2 .jpg .webp)
    python herramientas/texturas_json.py --completo → también .xml y .json (filtra TODAS las búsquedas)
"""
import json, os, sys

completo = '--completo' in sys.argv
ext_img = ('.png', '.astc', '.ktx', '.ktx2', '.jpg', '.jpeg', '.webp')
ext_all = ext_img + ('.xml', '.json', '.txt')
saltar = {'.git', 'js', 'css', 'herramientas', 'node_modules'}
archivos = []
for raiz, dirs, nombres in os.walk('.'):
    dirs[:] = [d for d in dirs if d not in saltar and not d.startswith('.')]
    for n in nombres:
        if n == 'texturas.json' or not n.lower().endswith(ext_all if completo else ext_img):
            continue
        archivos.append(os.path.relpath(os.path.join(raiz, n), '.').replace(os.sep, '/'))
archivos.sort()
with open('texturas.json', 'w', encoding='utf-8') as f:
    json.dump({'completo': completo, 'archivos': archivos}, f, ensure_ascii=False, indent=0)
print(f'texturas.json: {len(archivos)} archivos' + (' (completo)' if completo else ''))
