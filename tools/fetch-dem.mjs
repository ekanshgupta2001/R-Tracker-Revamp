// Downloads the real elevation data the sky's mountain range is rendered from
// (tools/sky-art.mjs renderRange, baked by tools/bake-sky.mjs) into tools/dem/.
//
// DEV-ONLY. This is the one piece of R-Tracker code that uses the network, and it
// runs only on a developer's machine: the app never loads these tiles (they sit
// outside assets/, no page references them) — pages only ever load the baked
// assets/sky/*.webp. tools/dem/*.png is git-ignored (≈ 30 MB); re-run this to
// restore it before a re-bake.
//
// Source: Terrain Tiles on AWS Open Data (Mapzen "terrarium" encoding),
// https://registry.opendata.aws/terrain-tiles/ — elevation in metres per pixel is
// R·256 + G + B/256 − 32768. Attribution (see tools/dem/README.md): the tiles
// combine SRTM, EU-DEM (Copernicus) and GMTED2010 among others.
//
//   node tools/fetch-dem.mjs            (skips tiles already on disk)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEM, DEM_HI } from './sky-art.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'tools/dem');
const URL = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;

fs.mkdirSync(DIR, { recursive: true });
let got = 0, kept = 0, bytes = 0;
for (const box of [DEM, DEM_HI]) {
  for (let y = box.y0; y <= box.y1; y++) {
    for (let x = box.x0; x <= box.x1; x++) {
      const file = path.join(DIR, `${box.z}-${x}-${y}.png`);
      if (fs.existsSync(file)) { kept++; continue; }
      const res = await fetch(URL(box.z, x, y));
      if (!res.ok) throw new Error(`tile ${box.z}/${x}/${y}: HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(file, buf);
      got++; bytes += buf.length;
    }
  }
}
console.log(`tools/dem: ${got} downloaded (${(bytes / 1048576).toFixed(1)} MB), ${kept} already present — z${DEM.z} ${DEM.x0}–${DEM.x1}/${DEM.y0}–${DEM.y1}, z${DEM_HI.z} ${DEM_HI.x0}–${DEM_HI.x1}/${DEM_HI.y0}–${DEM_HI.y1}`);
