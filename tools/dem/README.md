# tools/dem — terrain for the sky's mountain range

Local cache of elevation tiles that `tools/bake-sky.mjs` renders the mountain layers from
(`renderRange` in `tools/sky-art.mjs`). **Dev-only:** the app never loads anything from here;
pages load only the baked `assets/sky/*.webp`. The PNG tiles are git-ignored (≈ 29 MB) —
`node tools/fetch-dem.mjs` downloads them again (it is the only R-Tracker code that uses the
network, and only on a developer's machine).

- **Source:** Terrain Tiles on AWS Open Data — https://registry.opendata.aws/terrain-tiles/
  (`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`, Mapzen
  "terrarium" encoding: elevation in metres = R·256 + G + B/256 − 32768).
- **Area:** zoom 12, x 2133–2143, y 1444–1452 (≈ 26 m per sample), plus zoom 13, x 4271–4283,
  y 2889–2899 (≈ 13 m) over the massif and the near foothills — the Bernese Alps north
  wall and the Lake Thun basin; the camera sits above the inversion near the Niederhorn and
  looks south-east at the Eiger, Mönch and Jungfrau (`DEM` / `VIEW` in `tools/sky-art.mjs`).
- **Attribution** (required by the data sources, shown on the About page): Terrain Tiles
  (Mapzen, AWS Open Data) including SRTM (NASA/USGS), EU-DEM (produced using Copernicus data and
  information funded by the European Union) and GMTED2010 (USGS).
