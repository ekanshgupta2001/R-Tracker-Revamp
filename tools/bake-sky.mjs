// Bakes the Summit Atmosphere layers (tools/sky-art.mjs) into
// assets/sky/<layer>.webp, which is what every page actually loads.
//
// Why rasters: the sky is drawn through feTurbulence / feDisplacementMap
// filters, and an SVG filter chain is re-run on every repaint that touches it.
// There is no cached layer for it — will-change, contain:paint and layer
// promotion all fail to avoid the work — so anything moving over a live SVG
// sky (the theme sunset, the drifting mist) dropped the homepage to ~20–60fps
// with 42ms hitches. As rasters the same page holds 120fps. See css/global.css.
//
//   node tools/bake-sky.mjs [quality 0-1, default 0.9] [layer …]
//   node tools/bake-sky.mjs --svg <dir>     also write each layer's SVG there (to inspect)
//   node tools/bake-sky.mjs --out <dir> --scale 4 day-land   quick preview (¼ size) into <dir>
//
// The mountain layers read the real terrain in tools/dem/ (node tools/fetch-dem.mjs).
//
// Chromium does the WebP encoding (the machine has no cwebp/Pillow);
// transparent layers keep their alpha. Nothing here runs at build or request
// time: the committed .webp files are the shipped assets.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LAYERS } from './sky-art.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'assets/sky');

const args = process.argv.slice(2);
function flag(name) { const i = args.indexOf(name); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; }
const svgDir = flag('--svg');
const outDir = flag('--out');
const scale = Number(flag('--scale') || 1);
const clip = flag('--clip');                               // preview: x0,y0,x1,y1 pixels of the mountain render
const QUALITY = args.length && !isNaN(Number(args[0])) ? Number(args.shift()) : 0.9;
const only = args.length ? args : Object.keys(LAYERS);

const OUT = outDir ? path.resolve(outDir) : OUT_DIR;
fs.mkdirSync(OUT, { recursive: true });

// The DEM tiles as data URLs, for the mountain layers' render function.
function demTiles(...boxes) {
  const tiles = [];
  for (const dem of boxes) {
    if (!dem) continue;
    for (let y = dem.y0; y <= dem.y1; y++) for (let x = dem.x0; x <= dem.x1; x++) {
      const f = path.join(ROOT, 'tools/dem', `${dem.z}-${x}-${y}.png`);
      if (!fs.existsSync(f)) throw new Error(`missing ${path.relative(ROOT, f)} — run node tools/fetch-dem.mjs`);
      tiles.push({ z: dem.z, x, y, src: 'data:image/png;base64,' + fs.readFileSync(f).toString('base64') });
    }
  }
  return tiles;
}
if (svgDir) fs.mkdirSync(svgDir, { recursive: true });

const browser = await chromium.launch();
let total = 0;
for (const name of only) {
  const L0 = LAYERS[name];
  if (!L0) throw new Error('unknown layer ' + name);
  const L = Object.assign({}, L0, { w: Math.round(L0.w / scale), h: Math.round(L0.h / scale) });
  const svg = L.svg();
  if (svgDir) fs.writeFileSync(path.join(svgDir, name + '.svg'), svg);
  const page = await browser.newPage({ viewport: { width: L.w, height: L.h } });
  const t0 = Date.now();
  await page.setContent(
    '<!doctype html><meta charset="utf-8">' +
    '<style>html,body{margin:0;height:100%;background:' + (L.alpha ? 'transparent' : '#071a42') + ';overflow:hidden}' +
    'svg,canvas{position:absolute;inset:0;width:100%;height:100%;display:block}</style>' +
    (L.canvas ? '<canvas id="bake-canvas" width="' + L.w + '" height="' + L.h + '"></canvas>' : '') + svg,
    { waitUntil: 'load' }
  );
  // A canvas layer (the mountains) is drawn by its render function, injected by
  // source, under the SVG.
  if (L.canvas) {
    await page.addScriptTag({ content: 'window.__bakeRender = ' + L.canvas.fn.toString() + ';' });
    const tiles = L.canvas.dem ? demTiles(L.canvas.params.dem, L.canvas.params.demHi) : null;
    const params = Object.assign({}, L.canvas.params, clip ? { clip: clip.split(',').map(Number) } : {},
      process.env.SKY_DEBUG ? { debug: JSON.parse(process.env.SKY_DEBUG) } : {});
    await page.evaluate(({ params, tiles }) => window.__bakeRender(document.getElementById('bake-canvas'), params, tiles), { params, tiles });
  }
  await page.waitForTimeout(800);              // let the filter chains settle
  const png = await page.screenshot({ type: 'png', omitBackground: L.alpha });
  const webp = await page.evaluate(async ({ b64, q, w, h }) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    return c.toDataURL('image/webp', q);
  }, { b64: png.toString('base64'), q: QUALITY, w: L.w, h: L.h });
  await page.close();
  if (!webp.startsWith('data:image/webp')) throw new Error('browser did not encode webp');
  const bytes = Buffer.from(webp.split(',')[1], 'base64');
  fs.writeFileSync(path.join(OUT, name + '.webp'), bytes);
  total += bytes.length;
  console.log(`${name.padEnd(11)} ${L.w}x${L.h}${L.alpha ? ' alpha' : '      '} q${QUALITY} → ${path.relative(ROOT, path.join(OUT, name + '.webp'))} (${(bytes.length / 1024).toFixed(0)} KB, ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}
console.log(`total ${(total / 1024).toFixed(0)} KB`);
await browser.close();
