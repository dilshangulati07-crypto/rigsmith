# 3D assets and credits

## Part models

Every part in the 3D view is currently a **procedural model**, built in code from the part's
real dimensions in `data/parts/*.json` (1 unit = 1 cm): `js/scene/case.js` and `js/scene/models/*.js`.

No third-party part models are used yet. A search on 2026-11-18 for free models with a direct
download and a CC0 or CC-BY licence (Poly Pizza, Poly Haven, Kenney, GitHub, Grab3D) found only
low-poly, flat-shaded assets (for example a green RAM stick and a stylised reference-style
graphics card on Poly Pizza) that would look less real than the procedural models. Realistic
models on TurboSquid, CGTrader and Free3D need an account and use their own royalty-free
licences, not CC0 / CC-BY, so they were not used.

## Adding a model later

Drop a `.glb` into `models/` and register it in `models/index.json`:

- `"models": ["<partId>"]` uses `models/<partId>.glb` for that exact part (same axes and origin as
  the procedural model, 1 unit = 1 cm).
- `"categories": { "<category>": { "file": "x.glb", "fit": "box" } }` uses one model as the base
  look for every part of a category: it is scaled into the procedural model's bounding box, so it
  always matches the part's real dimensions.

Add a row below for every file: name, author, licence, source link.

| File | Asset | Author | Licence | Source |
| --- | --- | --- | --- | --- |
| — | — | — | — | — |

## Other assets

| Asset | Author | Licence | Source | Used in |
| --- | --- | --- | --- | --- |
| Studio Small 08 (HDRI, 1k and 2k) | Sergej Majboroda, Poly Haven | CC0 | https://polyhaven.com/a/studio_small_08 | `vendor/hdri/`, studio lighting |
| three.js r170 | three.js authors | MIT | https://threejs.org | `vendor/three/` |
| Inter (font) | Rasmus Andersson | SIL OFL 1.1 | https://fonts.google.com/specimen/Inter | all pages (Google Fonts) |
| IBM Plex Mono (font) | IBM | SIL OFL 1.1 | https://fonts.google.com/specimen/IBM+Plex+Mono | numbers and specs (Google Fonts) |
