// The Summit Atmosphere sky: SVG (and, for the mountains, a canvas render
// function) for every layer that tools/bake-sky.mjs rasterises into
// assets/sky/*.webp. Nothing here runs in
// the app: the page only ever loads the baked .webp files (see the
// "Atmosphere" block in css/global.css for why the sky must stay a raster).
//
// Art board 1440x900, drawn with preserveAspectRatio="xMidYMid slice" so the
// CSS `center / cover` placement of the baked layers lines up with the CSS sun
// and moon, which are positioned in the same board coordinates.
//
// Layers, bottom to top in #rt-atmosphere:
//   day-sky, night-sky        opaque sky (gradient, haze, high cloud, grain)
//   stars-a, stars-b          512-unit transparent tiles, repeated
//   day-land, night-land      the alpine range + its cloud sea (renderRange over real terrain, canvas), transparent above
//   mist                      the wisps that drift (wider than the board)

export const BOARD = { w: 1440, h: 900 };

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const svgOpen = (w, h) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid slice">`;

// ── Shared filters (the cloud language of the original summit sky) ──────────
const FILTERS = `
  <filter id="bank-back" x="-20%" y="-60%" width="140%" height="220%"><feTurbulence type="fractalNoise" baseFrequency=".004 .009" numOctaves="4" seed="11" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="70" xChannelSelector="R" yChannelSelector="G"/><feGaussianBlur stdDeviation="9"/></filter>
  <filter id="bank-mid" x="-20%" y="-60%" width="140%" height="220%"><feTurbulence type="fractalNoise" baseFrequency=".005 .011" numOctaves="4" seed="4" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="95" xChannelSelector="R" yChannelSelector="G"/><feGaussianBlur stdDeviation="4"/></filter>
  <filter id="bank-front" x="-20%" y="-60%" width="140%" height="220%"><feTurbulence type="fractalNoise" baseFrequency=".006 .013" numOctaves="5" seed="21" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="115" xChannelSelector="R" yChannelSelector="G"/><feGaussianBlur stdDeviation="2.5"/></filter>
  <filter id="billow" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".0035 .007" numOctaves="5" seed="8" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 7 -2.6" result="a"/><feGaussianBlur in="a" stdDeviation="3" result="b"/><feComposite in="b" in2="SourceGraphic" operator="in"/></filter>
  <filter id="shade" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".003 .008" numOctaves="4" seed="17" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 .56  0 0 0 0 .64  0 0 0 0 .76  0 0 0 6 -2.4" result="a"/><feGaussianBlur in="a" stdDeviation="6" result="b"/><feComposite in="b" in2="SourceGraphic" operator="in"/></filter>
  <filter id="mist" x="-30%" y="-200%" width="160%" height="500%"><feTurbulence type="fractalNoise" baseFrequency=".004 .02" numOctaves="3" seed="5" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="60" xChannelSelector="R" yChannelSelector="G"/><feGaussianBlur stdDeviation="16"/></filter>
  <filter id="highhaze" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".0011 .0045" numOctaves="4" seed="13" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 5 -2.1" result="a"/><feGaussianBlur in="a" stdDeviation="8" result="b"/><feComposite in="b" in2="SourceGraphic" operator="in"/></filter>
  <filter id="distant" x="-20%" y="-100%" width="140%" height="300%"><feTurbulence type="fractalNoise" baseFrequency=".006 .02" numOctaves="4" seed="27" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="60" xChannelSelector="R" yChannelSelector="G"/><feGaussianBlur stdDeviation="3"/></filter>
  <filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.2"/></filter>
  <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter>`;

const GRAIN = `<rect width="1440" height="900" filter="url(#grain)" opacity=".055" style="mix-blend-mode:overlay"/>`;

// ── The sky: single-scattering atmosphere, rendered per pixel ───────────────
// Rayleigh + Mie scattering along each view ray from the camera (Nishita-style,
// a few samples), lit by the sun (day) or moon (night) placed where the CSS sun
// and moon sit on screen, so the glow is around them. Soft cirrus on a high
// plane is lit by the same light. Opaque layer; same camera as renderRange so
// the horizon lines up. Self-contained: bake-sky.mjs injects its source.
function renderSky(canvas, P) {
  var W = canvas.width, H = canvas.height;
  var ctx = canvas.getContext('2d'), img = ctx.createImageData(W, H), D = img.data;
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function smooth(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  // camera (same basis as renderRange)
  var hd = P.cam.heading * Math.PI / 180, pt = P.cam.pitch * Math.PI / 180;
  var fX = Math.sin(hd) * Math.cos(pt), fY = Math.cos(hd) * Math.cos(pt), fZ = Math.sin(pt);
  var rX = Math.cos(hd), rY = -Math.sin(hd), rZ = 0;
  var uX = rY * fZ - rZ * fY, uY = rZ * fX - rX * fZ, uZ = rX * fY - rY * fX;
  var FOC = (W / 2) / Math.tan(P.cam.hfov * Math.PI / 360);
  function dir(sx, sy, o) {
    var cx = (sx - W / 2) / FOC, cy = (H / 2 - sy) / FOC;
    var dx = fX + rX * cx + uX * cy, dy = fY + rY * cx + uY * cy, dz = fZ + rZ * cx + uZ * cy, n = Math.hypot(dx, dy, dz);
    o[0] = dx / n; o[1] = dy / n; o[2] = dz / n;
  }
  // the light source sits where the CSS sun/moon is drawn (board coordinates)
  var S = [0, 0, 0]; dir(P.lightBoard[0] * W / 1440, P.lightBoard[1] * H / 900, S);
  // An analytic sky: zenith-to-horizon falloff by elevation, a Mie-like glow
  // around the light (a wide halo, a tighter aureole and the hot core), and a
  // warm horizon band on the light's side. Colours are linear.
  var col = [0, 0, 0], v = [0, 0, 0], Z = P.zenith, Hz = P.horizon, WM = P.warm, GL = P.glow;
  function scatter(d) {
    var e = Math.asin(clamp(d[2], -1, 1));
    var mu = d[0] * S[0] + d[1] * S[1] + d[2] * S[2], m = Math.max(0, mu);
    var k = Math.pow(clamp(e / 0.19, 0, 1), 0.55);          // the frame only reaches ~12° up
    var sideHz = Math.exp(-Math.max(0, e) * 10) * (0.35 + 0.65 * Math.pow((mu + 1) / 2, 2));
    var glow = 0.05 * Math.pow(m, 40) + 0.45 * Math.pow(m, 300) + 2.2 * Math.pow(m, 3000);
    for (var c = 0; c < 3; c++) {
      var base = Hz[c] + (Z[c] - Hz[c]) * k;
      if (e < 0) base = Hz[c] * (1 - 0.35 * smooth(0, -0.15, e));
      col[c] = base + WM[c] * sideHz + GL[c] * glow;
    }
  }
  // cirrus on a high plane, lit by the light (streaky: stretched noise)
  var seed = 97;
  function hsh(i, j) { var n = Math.imul(i, 374761393) + Math.imul(j, 668265263) + seed; n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; }
  function vn(x, y) { var xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), w = yf * yf * (3 - 2 * yf);
    var a = hsh(xi, yi), b = hsh(xi + 1, yi), c = hsh(xi, yi + 1), d = hsh(xi + 1, yi + 1); return (a + (b - a) * u) + ((c + (d - c) * u) - (a + (b - a) * u)) * w; }
  function fb(x, y, o) { var s = 0, a = 0.5, f = 1, n = 0; for (var i = 0; i < o; i++) { s += a * vn(x * f, y * f); n += a; a *= 0.5; f *= 2.03; } return s / n; }
  function tone(x) { x *= P.exposure; var a = x * (2.51 * x + 0.03), b = x * (2.43 * x + 0.59) + 0.14; return Math.pow(clamp(a / b, 0, 1), 1 / 2.2); }
  var gs = 777;
  function grn() { gs = (Math.imul(gs, 1103515245) + 12345) | 0; return ((gs >>> 8) & 0xffff) / 65535 - 0.5; }
  for (var py = 0; py < H; py++) for (var px = 0; px < W; px++) {
    dir(px + 0.5, py + 0.5, v);
    scatter(v);
    var r = col[0], gg = col[1], b = col[2];
    // cirrus, above the horizon only
    if (v[2] > 0.02 && P.cirrus > 0) {
      var tp = (P.cirrusAlt - P.cam.alt) / v[2], cx = v[0] * tp, cy = v[1] * tp;
      var ang = 0.6, ax = cx * Math.cos(ang) - cy * Math.sin(ang), ay = cx * Math.sin(ang) + cy * Math.cos(ang);
      var c1 = fb(ax / 22000, ay / 2600, 4) * 0.8 + fb(ax / 5000, ay / 900, 2) * 0.2, cov = smooth(0.58, 0.85, c1) * smooth(0.02, 0.14, v[2]) * smooth(90000, 40000, tp);
      if (cov > 0) {
        var mu = v[0] * S[0] + v[1] * S[1] + v[2] * S[2];
        var lit = P.cirrusLight * (0.35 + 0.65 * Math.pow(Math.max(0, mu), 6) * 2.5);
        var cr = P.cirrusColor;
        r += (cr[0] * lit - r) * cov * P.cirrus; gg += (cr[1] * lit - gg) * cov * P.cirrus; b += (cr[2] * lit - b) * cov * P.cirrus;
      }
    }
    // night: airglow near the horizon
    if (P.airglow) { var ag = Math.exp(-Math.max(0, v[2]) * 12) * P.airglow; r += ag * 0.55; gg += ag * 0.62; b += ag * 1.0; }
    var gr = grn() * 0.004, o = (py * W + px) * 4;
    D[o] = clamp((tone(r) + gr) * 255, 0, 255); D[o + 1] = clamp((tone(gg) + gr) * 255, 0, 255); D[o + 2] = clamp((tone(b) + gr) * 255, 0, 255); D[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

// ── Stars: a repeating 512-unit tile ───────────────────────────────────────
function stars(seed, count, bright) {
  const r = mulberry32(seed);
  let s = '';
  for (let i = 0; i < count; i++) {
    const x = (r() * 512).toFixed(1), y = (r() * 512).toFixed(1);
    const k = r();
    const rad = k > 0.96 ? 1.25 : k > 0.8 ? 0.85 : 0.5;
    const op = (bright ? 0.55 : 0.35) + r() * 0.45;
    const tint = r() > 0.8 ? '#ffe9c7' : r() > 0.7 ? '#c9d8ff' : '#ffffff';
    if (rad > 1) s += `<circle cx="${x}" cy="${y}" r="4.5" fill="${tint}" opacity=".07" filter="url(#soft)"/>`;
    s += `<circle cx="${x}" cy="${y}" r="${rad}" fill="${tint}" opacity="${op.toFixed(2)}"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><filter id="soft" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="1.6"/></filter></defs>${s}</svg>`;
}

// ── The alpine range: real terrain, ray-marched ────────────────────────────
// The mountains are the Bernese Alps north wall (Eiger, Mönch, Jungfrau and
// neighbours) seen from above the Lake Thun cloud sea: real elevation data
// (tools/fetch-dem.mjs → tools/dem/, Terrain Tiles on AWS Open Data), rendered
// per pixel in the bake page (never in the app):
//   - a pinhole camera over the height field, with Earth curvature + refraction;
//   - rays marched to the terrain or to a cloud-sea surface (the inversion the
//     peaks rise out of), refined by bisection; skyline pixels supersampled 2×2;
//   - bicubic DEM normals plus faint sub-DEM rock relief on steep ground;
//   - sun (day) / moon (night) light with soft cast shadows, sky ambient with
//     horizon ambient occlusion;
//   - snow by altitude, slope and aspect; rock with strata; forest and meadow
//     below the tree line;
//   - aerial perspective by distance, filmic tone mapping, sRGB out.
// Self-contained on purpose: bake-sky.mjs injects its source into the page and
// passes the DEM tiles as data URLs.
async function renderRange(canvas, P, tiles) {
  var W = canvas.width, H = canvas.height;
  var ctx = canvas.getContext('2d');
  var img = ctx.createImageData(W, H), D = img.data;

  // ── the DEM (metres): a zoom-12 mosaic everywhere plus a zoom-13 one (≈ 13 m)
  //    over the massif and the near foothills, which blends in at its edges ──
  var tc = document.createElement('canvas'); tc.width = tc.height = 256;
  var tctx = tc.getContext('2d', { willReadFrequently: true });
  var lat = P.cam.lat * Math.PI / 180;
  async function mosaic(desc) {
    var M = { d: desc, W: (desc.x1 - desc.x0 + 1) * 256, H: (desc.y1 - desc.y0 + 1) * 256 };
    M.h = new Float32Array(M.W * M.H);
    for (var k = 0; k < tiles.length; k++) {
      var tl = tiles[k];
      if (tl.z !== desc.z) continue;
      var im = new Image(); im.src = tl.src; await im.decode();
      tctx.clearRect(0, 0, 256, 256); tctx.drawImage(im, 0, 0);
      var px = tctx.getImageData(0, 0, 256, 256).data;
      var ox = (tl.x - desc.x0) * 256, oy = (tl.y - desc.y0) * 256;
      for (var j = 0; j < 256; j++) for (var i = 0; i < 256; i++) {
        var q = (j * 256 + i) * 4;
        M.h[(oy + j) * M.W + ox + i] = px[q] * 256 + px[q + 1] + px[q + 2] / 256 - 32768;
      }
    }
    // Web-Mercator pixel of the camera; metres per mosaic pixel at its latitude
    var SC = 256 * Math.pow(2, desc.z);
    M.cx = (P.cam.lon + 180) / 360 * SC - desc.x0 * 256;
    M.cy = (1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2 * SC - desc.y0 * 256;
    M.mpp = 156543.03392 * Math.cos(lat) / Math.pow(2, desc.z);
    return M;
  }
  var LO = await mosaic(P.dem), HI = P.demHi ? await mosaic(P.demHi) : null;
  var MPP = HI ? HI.mpp : LO.mpp;
  var REFF = 6371000 / 0.87;                                    // Earth radius with standard refraction

  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function smooth(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function mix(a, b, t) { return a + (b - a) * t; }

  // Hydraulic erosion on the fine mosaic (seeded droplets, Beyer-style): water
  // runs downhill picking up and dropping sediment, which carves the real
  // drainage's gullies and couloirs sharper and leaves debris fans below them.
  if (HI && P.erosion) (function erode(M, E) {
    var W = M.W, H = M.H, h = M.h, s = E.seed >>> 0;
    function rr() { s = (s + 0x6D2B79F5) | 0; var t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
    function grad(x, y, out) {
      var ix = x | 0, iy = y | 0, ax = x - ix, ay = y - iy, o = iy * W + ix;
      var a = h[o], b = h[o + 1], c = h[o + W], d = h[o + W + 1];
      out[0] = (b - a) * (1 - ay) + (d - c) * ay; out[1] = (c - a) * (1 - ax) + (d - b) * ax;
      out[2] = a * (1 - ax) * (1 - ay) + b * ax * (1 - ay) + c * (1 - ax) * ay + d * ax * ay;
    }
    var g = [0, 0, 0], g2 = [0, 0, 0];
    M.flow = new Float32Array(W * H);                     // drainage: water carried through each cell
    var x0 = E.box ? E.box[0] * W : 2, x1 = E.box ? E.box[2] * W : W - 3, y0 = E.box ? E.box[1] * H : 2, y1 = E.box ? E.box[3] * H : H - 3;
    for (var n = 0; n < E.droplets; n++) {
      var x = x0 + rr() * (x1 - x0), y = y0 + rr() * (y1 - y0), dx = 0, dy = 0, sp = 1, water = 1, sed = 0;
      for (var st = 0; st < E.steps; st++) {
        var ix = x | 0, iy = y | 0;
        if (ix < 2 || iy < 2 || ix >= W - 3 || iy >= H - 3) break;
        grad(x, y, g);
        dx = dx * E.inertia - g[0] * (1 - E.inertia); dy = dy * E.inertia - g[1] * (1 - E.inertia);
        var len = Math.hypot(dx, dy); if (len < 1e-6) break; dx /= len; dy /= len;
        var nx = x + dx, ny = y + dy;
        if (nx < 2 || ny < 2 || nx >= W - 3 || ny >= H - 3) break;
        grad(nx, ny, g2);
        var dh = g2[2] - g[2];
        var cap = Math.max(-dh * sp * water * E.capacity, E.minSlope);
        var fx = x - ix, fy = y - iy, o = iy * W + ix;
        M.flow[o] += water;
        if (sed > cap || dh > 0) {
          var dep = dh > 0 ? Math.min(dh, sed) : (sed - cap) * E.deposit;
          sed -= dep;
          h[o] += dep * (1 - fx) * (1 - fy); h[o + 1] += dep * fx * (1 - fy); h[o + W] += dep * (1 - fx) * fy; h[o + W + 1] += dep * fx * fy;
        } else {
          var er = Math.min((cap - sed) * E.erode, -dh);
          // spread the erosion over a 3×3 brush so channels stay smooth
          for (var by = -1; by <= 1; by++) for (var bx = -1; bx <= 1; bx++) {
            var w = (bx === 0 && by === 0) ? 0.36 : (bx === 0 || by === 0) ? 0.1 : 0.06;
            h[o + by * W + bx] -= er * w;
          }
          sed += er;
        }
        sp = Math.sqrt(Math.max(0, sp * sp + dh * -E.gravity));
        water *= 1 - E.evaporate;
        x = nx; y = ny;
      }
    }
  })(HI, P.erosion);
  var maxH = 0, k;
  for (k = 0; k < LO.h.length; k++) if (LO.h[k] > maxH) maxH = LO.h[k];
  if (HI) for (k = 0; k < HI.h.length; k++) if (HI.h[k] > maxH) maxH = HI.h[k];

  function bil(M, fx, fy) {
    var ix = fx | 0, iy = fy | 0, ax = fx - ix, ay = fy - iy, o = iy * M.W + ix, h = M.h;
    var a = h[o], b = h[o + 1], c = h[o + M.W], d = h[o + M.W + 1];
    return (a + (b - a) * ax) + ((c + (d - c) * ax) - (a + (b - a) * ax)) * ay;
  }
  function cr(p0, p1, p2, p3, t) { return p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0))); }
  function bic(M, fx, fy) {
    var ix = fx | 0, iy = fy | 0, ax = fx - ix, ay = fy - iy, h = M.h, r = [0, 0, 0, 0];
    for (var m = -1; m <= 2; m++) { var o = (iy + m) * M.W + ix; r[m + 1] = cr(h[o - 1], h[o], h[o + 1], h[o + 2], ax); }
    return cr(r[0], r[1], r[2], r[3], ay);
  }
  // weight of the fine mosaic at a point: 1 inside, easing to 0 over its last 96 samples
  var HB = 96;
  function hiW(fx, fy) {
    if (!HI) return 0;
    var e = Math.min(fx - 2, fy - 2, HI.W - 3 - fx, HI.H - 3 - fy);
    return e <= 0 ? 0 : e >= HB ? 1 : smooth(0, HB, e);
  }
  function sample(x, y, cubic) {
    var v = -500, w = 0;
    if (HI) {
      var hx = HI.cx + x / HI.mpp, hy = HI.cy - y / HI.mpp;
      w = hiW(hx, hy);
      if (w >= 1) return cubic ? bic(HI, hx, hy) : bil(HI, hx, hy);
      if (w > 0) v = cubic ? bic(HI, hx, hy) : bil(HI, hx, hy);
    }
    var lx = LO.cx + x / LO.mpp, ly = LO.cy - y / LO.mpp, lv;
    if (lx < 2 || ly < 2 || lx >= LO.W - 3 || ly >= LO.H - 3) lv = -500;
    else lv = cubic ? bic(LO, lx, ly) : bil(LO, lx, ly);
    return w > 0 ? mix(lv, v, w) : lv;
  }
  // bilinear height at local east/north metres (for marching)
  function hBil(x, y) { return sample(x, y, false); }
  // Catmull-Rom bicubic height (for normals: no bilinear facets)
  function hBic(x, y) { return sample(x, y, true); }

  // seeded value noise for rock relief, snowline wobble, strata, clouds
  var seed = P.seed >>> 0;
  function rnd() { seed = (seed + 0x6D2B79F5) | 0; var t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
  var perm = new Uint8Array(512), pp = [];
  for (k = 0; k < 256; k++) pp[k] = k;
  for (k = 255; k > 0; k--) { var s = Math.floor(rnd() * (k + 1)), tmp = pp[k]; pp[k] = pp[s]; pp[s] = tmp; }
  for (k = 0; k < 512; k++) perm[k] = pp[k & 255];
  var GX = [1, -1, 1, -1, 1, -1, 0, 0], GY = [1, 1, -1, -1, 0, 0, 1, -1];
  function noise(x, y) {
    var xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi; xi &= 255; yi &= 255;
    var a = perm[xi] + yi, b = perm[xi + 1] + yi;
    var g00 = perm[a] & 7, g01 = perm[a + 1] & 7, g10 = perm[b] & 7, g11 = perm[b + 1] & 7;
    var n00 = GX[g00] * xf + GY[g00] * yf, n10 = GX[g10] * (xf - 1) + GY[g10] * yf;
    var n01 = GX[g01] * xf + GY[g01] * (yf - 1), n11 = GX[g11] * (xf - 1) + GY[g11] * (yf - 1);
    var u = xf * xf * xf * (xf * (xf * 6 - 15) + 10), v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    var x1 = n00 + u * (n10 - n00), x2 = n01 + u * (n11 - n01); return x1 + v * (x2 - x1);
  }
  function fbm(x, y, o) { var sm = 0, a = 0.5, f = 1, n = 0; for (var i = 0; i < o; i++) { sm += a * noise(x * f + i * 7.1, y * f - i * 3.3); n += a; a *= 0.5; f *= 2.03; } return sm / n; }

  function curv(x, y) { return (x * x + y * y) / (2 * REFF); }

  // ── the drainage map: how much water the erosion droplets carried through
  //    each cell. Glaciers, snow couloirs and scree follow it, so detail sits
  //    where water, snow and ice really collect. ──
  var FLOWN = null;
  if (HI && HI.flow) {
    var fl = HI.flow, FW = HI.W, FH = HI.H, tmpf = new Float32Array(fl.length);
    for (var pass = 0; pass < 3; pass++) {               // soften: 3 passes of a 3×3 box
      for (var j2 = 1; j2 < FH - 1; j2++) for (var i2 = 1; i2 < FW - 1; i2++) {
        var o2 = j2 * FW + i2;
        tmpf[o2] = (fl[o2] * 4 + fl[o2 - 1] + fl[o2 + 1] + fl[o2 - FW] + fl[o2 + FW]) / 8;
      }
      fl.set(tmpf);
    }
    var sorted = Array.prototype.slice.call(fl.filter(function (v, i) { return (i & 63) === 0 && v > 0; })).sort(function (a, b) { return a - b; });
    var p98 = sorted.length ? sorted[Math.floor(sorted.length * 0.98)] : 1;
    FLOWN = new Float32Array(fl.length);
    var lp = Math.log(1 + p98);
    for (k = 0; k < fl.length; k++) FLOWN[k] = clamp(Math.log(1 + fl[k]) / lp, 0, 1);
  }
  function flowAt(x, y) {
    if (!FLOWN) return 0;
    var fx = HI.cx + x / HI.mpp, fy = HI.cy - y / HI.mpp;
    if (fx < 1 || fy < 1 || fx >= HI.W - 2 || fy >= HI.H - 2) return 0;
    var ix = fx | 0, iy = fy | 0, ax = fx - ix, ay = fy - iy, o = iy * HI.W + ix;
    var a = FLOWN[o], b = FLOWN[o + 1], c = FLOWN[o + HI.W], d = FLOWN[o + HI.W + 1];
    return (a + (b - a) * ax) + ((c + (d - c) * ax) - (a + (b - a) * ax)) * ay;
  }

  // camera basis
  var hd = P.cam.heading * Math.PI / 180, pt = P.cam.pitch * Math.PI / 180;
  var fX = Math.sin(hd) * Math.cos(pt), fY = Math.cos(hd) * Math.cos(pt), fZ = Math.sin(pt);
  var rX = Math.cos(hd), rY = -Math.sin(hd), rZ = 0;
  var uX = rY * fZ - rZ * fY, uY = rZ * fX - rX * fZ, uZ = rX * fY - rY * fX;
  var FOC = (W / 2) / Math.tan(P.cam.hfov * Math.PI / 360);
  var CZ = P.cam.alt;

  // light (azimuth/elevation in world degrees)
  var la = P.light.az * Math.PI / 180, le = P.light.el * Math.PI / 180;
  var LX = Math.sin(la) * Math.cos(le), LY = Math.cos(la) * Math.cos(le), LZ = Math.sin(le);
  var C = P.colors;

  // ── terrain ray march (from any origin, so reflections can reuse it) ──
  var hit = { t: 0, x: 0, y: 0, z: 0 };
  function marchFrom(ox, oy, oz, dx, dy, dz, t0, maxT) {
    var t = t0, tPrev = t0;
    while (t < maxT) {
      var x = ox + dx * t, y = oy + dy * t, z = oz + dz * t;
      if (dz > 0 && z > maxH + 50) return false;
      var g = z - (hBil(x, y) - curv(x, y));
      if (g < 0) {
        var lo = tPrev, hi = t;
        for (var b = 0; b < 10; b++) {
          var mid = (lo + hi) / 2, mx = ox + dx * mid, my = oy + dy * mid, mz = oz + dz * mid;
          if (mz - (hBil(mx, my) - curv(mx, my)) < 0) hi = mid; else lo = mid;
        }
        hit.t = hi; hit.x = ox + dx * hi; hit.y = oy + dy * hi; hit.z = oz + dz * hi;
        return true;
      }
      tPrev = t;
      t += Math.max(g * 0.4, t * 0.0007, 2);
    }
    return false;
  }

  // soft terrain shadow toward the light: a fixed geometric step schedule, the
  // same for every pixel, so penumbrae are smooth instead of dithered
  function shadow(x, y, z) {
    var res = 1;
    for (var t = 30; t < 18000; t *= 1.18) {
      var sx = x + LX * t, sy = y + LY * t, sz = z + LZ * t;
      if (sz > maxH + 50) break;
      var g = sz - hBil(sx, sy);
      res = Math.min(res, 7 * g / t);
      if (res <= 0) return 0;
    }
    return smooth(0, 1, res);
  }

  // ── 3D value noise for the clouds ──
  function h3(i, j, k2) { var n = Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(k2, 2147483647 & 1274126177); n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; }
  function vnoise3(x, y, z) {
    var xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = x - xi, yf = y - yi, zf = z - zi;
    var u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
    var a = h3(xi, yi, zi), b = h3(xi + 1, yi, zi), c = h3(xi, yi + 1, zi), d = h3(xi + 1, yi + 1, zi);
    var e = h3(xi, yi, zi + 1), f = h3(xi + 1, yi, zi + 1), g = h3(xi, yi + 1, zi + 1), hh = h3(xi + 1, yi + 1, zi + 1);
    var l0 = (a + (b - a) * u) + ((c + (d - c) * u) - (a + (b - a) * u)) * v;
    var l1 = (e + (f - e) * u) + ((g + (hh - g) * u) - (e + (f - e) * u)) * v;
    return l0 + (l1 - l0) * w;
  }
  function fbm3(x, y, z, o) { var sm = 0, a = 0.5, f = 1, n = 0; for (var i = 0; i < o; i++) { sm += a * vnoise3(x * f + i * 13.7, y * f - i * 7.3, z * f + i * 3.1); n += a; a *= 0.5; f *= 2.02; } return sm / n; }

  // ── the clouds ──
  // Three families, each where clouds really form:
  //   valley fog banks pooling over the lake and valley floors (700–1500 m);
  //   orographic cumulus on the massif's flanks (2100–3500 m), drifting in front
  //   of the lower faces;
  //   a few distant towers beyond the range.
  // A 2D coverage grid (200 m cells) says where each column can hold cloud, so
  // most of every ray skips empty air.
  var CLD = P.clouds || null, CG = 200, CGN = 0, COV = null, CGX0 = 0, CGY0 = 0;
  function cover2(x, y) {                                   // 0..1 potential, per family packed
    var g = hBil(x, y), r = Math.hypot(x, y);
    var valley = smooth(1400, 750, g) * smooth(0.4, 0.6, 0.5 + 0.5 * fbm(x / 5200 + 3.1, y / 5200 - 1.7, 3));
    var oro = smooth(1400, 2400, g) * smooth(0.5, 0.7, 0.5 + 0.5 * fbm(x / 3000 - 5.3, y / 3000 + 2.2, 3)) * smooth(8000, 14000, r);
    // mid-distance cumulus drifting over the lake and the prealps, anywhere past 5 km
    var mid = smooth(5000, 9000, r) * smooth(38000, 30000, r) * smooth(0.6, 0.76, 0.5 + 0.5 * fbm(x / 2600 + 1.3, y / 2600 + 7.7, 3));
    var far = smooth(36000, 44000, r) * smooth(0.62, 0.78, 0.5 + 0.5 * fbm(x / 7000 + 9.9, y / 7000 - 4.4, 3));
    // a broken altocumulus deck high above the peaks
    var alto = smooth(8000, 16000, r) * smooth(0.44, 0.6, 0.5 + 0.5 * fbm(x / 9000 - 2.2, y / 9000 + 5.5, 3));
    return [valley, oro, far, mid, alto];
  }
  if (CLD) {
    // grid over the view's footprint (±70 km around the camera is ample)
    CGN = 700; CGX0 = -70000; CGY0 = -70000;
    COV = [0, 1, 2, 3, 4].map(function () { return new Float32Array(CGN * CGN); });
    for (var gj = 0; gj < CGN; gj++) for (var gi = 0; gi < CGN; gi++) {
      var wx = CGX0 + (gi + 0.5) * CG, wy = CGY0 + (gj + 0.5) * CG;
      // only the forward half-plane matters
      if (wx * fX + wy * fY < -2000) continue;
      var cv = cover2(wx, wy);
      for (var fi = 0; fi < 5; fi++) COV[fi][gj * CGN + gi] = cv[fi];
    }
  }
  var CV = [0, 0, 0, 0, 0];
  // bilinear: a per-cell lookup would cut the clouds into square columns
  function covAt(x, y) {
    var fx = (x - CGX0) / CG - 0.5, fy = (y - CGY0) / CG - 0.5;
    if (fx < 0 || fy < 0 || fx >= CGN - 1 || fy >= CGN - 1) { CV[0] = CV[1] = CV[2] = CV[3] = CV[4] = 0; return 0; }
    var gi = fx | 0, gj = fy | 0, ax = fx - gi, ay = fy - gj, o = gj * CGN + gi;
    for (var f = 0; f < 5; f++) {
      var A = COV[f], a = A[o], b = A[o + 1], c = A[o + CGN], d = A[o + CGN + 1];
      CV[f] = (a + (b - a) * ax) + ((c + (d - c) * ax) - (a + (b - a) * ax)) * ay;
    }
    return CV[0] + CV[1] + CV[2] + CV[3] + CV[4];
  }
  // density at world point (x, y, altitude a); cheap=true for the light march
  function density(x, y, a, cheap) {
    if (covAt(x, y) <= 0.001) return 0;
    var d = 0, n;
    if (CV[0] > 0 && a > 650 && a < 1700) {
      var prof = smooth(650, 900, a) * smooth(1700, 1250, a);
      var ground = hBil(x, y), above = a - ground;
      var pool = smooth(700, 60, above);                    // hugs the ground, pools in the valleys
      n = fbm3(x / 1400, y / 1400, a / 500, cheap ? 2 : 4);
      d += CV[0] * prof * pool * smooth(0.38, 0.62, n) * 1.2;
    }
    if (CV[1] > 0 && a > 2000 && a < 3700) {
      var prof2 = smooth(2000, 2350, a) * smooth(3700, 3000, a);
      n = fbm3(x / 900, y / 900, a / 700, cheap ? 2 : 4);
      d += CV[1] * prof2 * smooth(0.42, 0.66, n) * 1.6;
    }
    if (CV[2] > 0 && a > 1500 && a < 5200) {
      var prof3 = smooth(1500, 2000, a) * smooth(5200, 3800, a);
      n = fbm3(x / 2200, y / 2200, a / 1400, cheap ? 2 : 3);
      d += CV[2] * prof3 * smooth(0.45, 0.65, n) * 1.4;
    }
    if (CV[3] > 0 && a > 1800 && a < 2900) {                 // mid-distance cumulus: flat bases, billowy tops
      var prof4 = smooth(1800, 1950, a) * smooth(2900, 2300, a);
      n = fbm3(x / 1100, y / 1100, a / 600, cheap ? 2 : 4);
      d += CV[3] * prof4 * smooth(0.44, 0.64, n + 0.12 * smooth(2600, 2000, a)) * 1.5;
    }
    if (CV[4] > 0 && a > 4300 && a < 5100) {                 // altocumulus: thin, broken, patterned
      var prof5 = smooth(4300, 4550, a) * smooth(5100, 4800, a);
      // cellular: a regular pattern of small puffs, as altocumulus fields look
      n = fbm3(x / 1800, y / 1800, a / 400, cheap ? 2 : 3) * 0.6 + fbm3(x / 420, y / 420, a / 300, cheap ? 1 : 2) * 0.4;
      d += CV[4] * prof5 * smooth(0.5, 0.64, n) * 0.7;
    }
    if (d > 0 && !cheap) {                                    // eroded, wispy edges
      var e = fbm3(x / 180, y / 180, a / 180, 2);
      d = Math.max(0, d - (1 - clamp(d, 0, 1)) * 0.55 * e);
    }
    return d;
  }
  // light reaching a cloud sample: a short march toward the light
  function cloudLight(x, y, a) {
    var od = 0;
    for (var s = 1; s <= 4; s++) {
      var st = 120 * s * s;
      od += density(x + LX * st, y + LY * st, a + LZ * st, true) * 120 * (2 * s - 1);
    }
    return Math.exp(-od * P.clouds.sigma);
  }
  // terrain shadowed by clouds: the coverage above the point toward the light
  function cloudShadow(x, y, h) {
    if (!CLD) return 1;
    var sum = 0;
    for (var s = 0; s < 3; s++) {
      var alt = [2400, 2900, 3400][s];
      if (alt < h) continue;
      var d = (alt - h) / Math.max(0.15, LZ);
      sum += density(x + LX * d, y + LY * d, alt, true);
    }
    return Math.exp(-sum * 1.6);
  }
  // integrate the clouds along a view ray up to tEnd; writes in-scattered light
  // (CI) and the transmittance (CT_)
  var CI = [0, 0, 0], CT_ = 1;
  var JIT = 1;
  function cloudsAlong(dx, dy, dz, tEnd) {
    CI[0] = CI[1] = CI[2] = 0; CT_ = 1;
    if (!CLD) return;
    // a per-pixel random start offset turns step banding into invisible fine noise
    JIT = (Math.imul(JIT, 1664525) + 1013904223) | 0;
    var jit = ((JIT >>> 8) & 0xffff) / 65536;
    var t = 80 * (0.5 + jit), maxT = Math.min(tEnd, 70000);
    var cosT = dx * LX + dy * LY + dz * LZ, g1 = 0.6, g2 = -0.2;
    var hg = 0.7 * (1 - g1 * g1) / Math.pow(1 + g1 * g1 - 2 * g1 * cosT, 1.5) + 0.3 * (1 - g2 * g2) / Math.pow(1 + g2 * g2 - 2 * g2 * cosT, 1.5);
    while (t < maxT && CT_ > 0.02) {
      var ds = clamp(t * 0.014, 20, 320) * (0.75 + 0.5 * jit);
      var x = dx * t, y = dy * t, z = CZ + dz * t, a = z + curv(x, y);
      if (a > 5300 && dz > 0) break;
      if (covAt(x, y) <= 0.001) { t += Math.max(ds, 150); continue; }
      var d = density(x, y, a, false);
      if (d > 0.002) {
        var sig = d * P.clouds.sigma;
        var tr = Math.exp(-sig * ds);
        var li = cloudLight(x, y, a);
        var powder = 1 - Math.exp(-d * 2.5);
        var sun = li * hg * (0.4 + 0.6 * powder);
        var amb = 0.55 + 0.45 * smooth(700, 3800, a);          // tops see more sky
        var fr = C.sun[0] * sun + C.sky[0] * amb * 1.6, fg = C.sun[1] * sun + C.sky[1] * amb * 1.6, fb = C.sun[2] * sun + C.sky[2] * amb * 1.6;
        // aerial perspective on the cloud sample too
        var ap = Math.exp(-t / P.haze.dist);
        fr = fr * ap + C.haze[0] * (1 - ap); fg = fg * ap + C.haze[1] * (1 - ap); fb = fb * ap + C.haze[2] * (1 - ap);
        var wgt = CT_ * (1 - tr);
        CI[0] += fr * C.cloud[0] * wgt; CI[1] += fg * C.cloud[1] * wgt; CI[2] += fb * C.cloud[2] * wgt;
        CT_ *= tr;
      }
      t += ds;
    }
  }

  // ── surface detail ──
  function ridged(x, y, o) { var sm = 0, a = 0.5, f = 1, n = 0; for (var i = 0; i < o; i++) { var r = 1 - Math.abs(noise(x * f + i * 5.3, y * f - i * 2.9)); sm += a * r * r; n += a; a *= 0.5; f *= 2.1; } return sm / n; }
  var N = [0, 0, 1], NB = [0, 0, 1], LAPL = 0, GDIR = [0, 1];
  function terrainNormal(x, y, t) {
    // never finer than ~1.6 DEM cells: closer than that the data's own cell
    // structure shows through as flutes and bands
    var e = Math.max(MPP * 1.6, t / FOC * 1.5);
    var hc = hBic(x, y), hxp = hBic(x + e, y), hxm = hBic(x - e, y), hyp = hBic(x, y + e), hym = hBic(x, y - e);
    var gx = (hxp - hxm) / (2 * e), gy = (hyp - hym) / (2 * e);
    var nb = Math.hypot(gx, gy, 1), m = Math.hypot(gx, gy);
    NB[0] = -gx / nb; NB[1] = -gy / nb; NB[2] = 1 / nb;
    // curvature at a broader scale (convex ridges < 0 < concave hollows)
    var E = Math.max(MPP * 3, t / FOC * 4);
    LAPL = (hBil(x + E, y) + hBil(x - E, y) + hBil(x, y + E) + hBil(x, y - E) - 4 * hBil(x, y)) / (E * E) * 60;
    GDIR[0] = m > 1e-4 ? gx / m : 0; GDIR[1] = m > 1e-4 ? gy / m : 1;
    // a whisper of sub-DEM rock texture on steep ground, faded by pixel size
    var foot = t / FOC, steep = smooth(0.5, 1.1, m);
    if (steep > 0 && foot < 8) {
      var s1 = 1 / 34, d = Math.max(2, foot * 2), f = smooth(8, 4, foot) * steep * 2.2;
      var r0 = ridged(x * s1, y * s1, 2);
      gx += f * (ridged((x + d) * s1, y * s1, 2) - r0) / d * 34 * 0.05;
      gy += f * (ridged(x * s1, (y + d) * s1, 2) - r0) / d * 34 * 0.05;
    }
    var n = Math.hypot(gx, gy, 1); N[0] = -gx / n; N[1] = -gy / n; N[2] = 1 / n;
  }

  // horizon ambient occlusion: how much of the sky the terrain around sees
  function ao(x, y, z) {
    var occ = 0;
    for (var a = 0; a < 6; a++) {
      var ang = a * Math.PI / 3 + 0.3, cx = Math.cos(ang), cy = Math.sin(ang), m = 0;
      for (var r = 90; r <= 900; r *= 2.4) m = Math.max(m, (hBil(x + cx * r, y + cy * r) - z) / r);
      occ += clamp(m, 0, 1.2);
    }
    return clamp(1 - occ / 6 * 0.75, 0.25, 1);
  }

  // Materials. Everything is placed by what makes it form: altitude, slope,
  // aspect, curvature and the drainage map.
  var ALB = [0, 0, 0];
  function surface(x, y, h, t, nz) {
    var foot = t / FOC, slope = NB[2], flow = flowAt(x, y);
    var steep = smooth(0.8, 0.55, slope);                     // 0 gentle … 1 cliff
    // rock: dark on the cliffs, strata bands, lighter on broken ground
    var strata = 0.5 + 0.5 * fbm(h / 45 + x / 3000, y / 3000, 2);
    var ledge = Math.pow(0.5 + 0.5 * Math.sin(6.2832 * (h + 45 * fbm(x / 500, y / 500, 3)) / (36 + 14 * fbm(x / 2000, y / 2000, 2))), 10) * steep * smooth(9, 5, foot) * smooth(0.2, 0.6, 0.5 + 0.5 * fbm(x / 700, y / 700, 2));
    var rk = (0.74 + 0.36 * strata) * (1 - 0.3 * ledge) * (1 - 0.22 * steep);
    var r = C.rock[0] * rk, g = C.rock[1] * rk, b = C.rock[2] * rk;
    // scree and talus fans: concave, moderate slopes at the foot of cliffs
    var scree = smooth(0.2, 0.9, LAPL) * smooth(0.62, 0.74, slope) * smooth(0.9, 0.8, slope) * smooth(1700, 1950, h) * smooth(3100, 2800, h);
    if (scree > 0) { var sv = 0.9 + 0.2 * fbm(x / 25, y / 25, 2); r = mix(r, C.scree[0] * sv, scree); g = mix(g, C.scree[1] * sv, scree); b = mix(b, C.scree[2] * sv, scree); }
    // vegetation: forest belt on the lower slopes, meadows on gentler ground above it
    var treeLine = P.snow.tree + 120 * fbm(x / 900, y / 900, 2);
    var forest = smooth(treeLine + 80, treeLine - 120, h) * smooth(0.42, 0.58, slope + 0.08 * fbm(x / 300, y / 300, 2)) * smooth(620, 700, h);
    var meadow = smooth(0.84, 0.95, slope) * smooth(2350, 2100, h) * smooth(700, 780, h) * (1 - forest * 0.7);
    if (forest > 0 || meadow > 0) {
      var canopy = 0.75 + 0.5 * fbm(x / 14, y / 14, 2) * smooth(6, 3, foot) + 0.2 * fbm(x / 160, y / 160, 2);
      r = mix(r, C.forest[0] * canopy, forest); g = mix(g, C.forest[1] * canopy, forest); b = mix(b, C.forest[2] * canopy, forest);
      var mv = 0.85 + 0.3 * fbm(x / 220, y / 220, 2);
      r = mix(r, C.meadow[0] * mv, meadow); g = mix(g, C.meadow[1] * mv, meadow); b = mix(b, C.meadow[2] * mv, meadow);
    }
    // snow: a wobbly snowline, lower on north faces; held on the slope at the
    // scale of a snowfield; fills the couloirs (high flow); scoured off convex ridges
    var line = P.snow.line + 220 * fbm(x / 1800, y / 1800, 3) - 280 * Math.max(0, NB[1]);
    var holds = smooth(0.6, 0.78, slope + 0.1 * fbm(x / 400, y / 400, 2) + 0.12 * smooth(3400, 3950, h));
    var couloir = smooth(0.35, 0.75, flow) * smooth(0.45, 0.62, slope) * smooth(line - 250, line + 50, h);
    var scour = smooth(-0.3, -1.2, LAPL) * steep * 0.6;
    var snow = clamp(Math.max(smooth(line - 70, line + 140, h) * holds, couloir) - scour, 0, 1);
    // glaciers: high, gentle, fed (flow) — smooth ice with crevasse bands across the flow
    var glacier = smooth(2350, 2600, h) * smooth(0.84, 0.92, slope) * smooth(0.15, 0.4, flow + smooth(3100, 3500, h));
    var sr = C.snow[0], sg = C.snow[1], sb = C.snow[2];
    var wind = 1 + 0.05 * fbm(x / 90, y / 30, 3) * smooth(12, 6, foot);
    sr *= wind; sg *= wind; sb *= wind;
    if (glacier > 0) {
      var along = x * GDIR[0] + y * GDIR[1];
      var crev = Math.pow(0.5 + 0.5 * Math.sin(along / 11 + 3 * fbm(x / 120, y / 120, 2)), 14) * smooth(0.95, 0.87, slope) * smooth(8, 4, foot);
      sr = mix(sr, C.ice[0], glacier * 0.5) * (1 - 0.45 * crev * glacier);
      sg = mix(sg, C.ice[1], glacier * 0.5) * (1 - 0.4 * crev * glacier);
      sb = mix(sb, C.ice[2], glacier * 0.5) * (1 - 0.3 * crev * glacier);
      snow = Math.max(snow, glacier);
    }
    ALB[0] = mix(r, sr, snow); ALB[1] = mix(g, sg, snow); ALB[2] = mix(b, sb, snow);
    return snow;
  }

  // height fog: dense over the valley floors, thinning with altitude
  function hfog(a0, dz, t) {
    var Hs = P.fog.scale, rho0 = P.fog.density, base = P.fog.base;
    var k = dz * t / Hs;
    var col = Math.abs(k) < 1e-4 ? t : Hs / dz * (1 - Math.exp(-k));
    return 1 - Math.exp(-rho0 * Math.exp(-(a0 - base) / Hs) * col);
  }

  function tone(v) { v *= C.exposure; var a = v * (2.51 * v + 0.03), b = v * (2.43 * v + 0.59) + 0.14; v = clamp(a / b, 0, 1); return Math.pow(v, 1 / 2.2); }

  // shade the terrain hit (linear colour, before fog/tone) into LIN
  var LIN = [0, 0, 0];
  function shadeTerrain(x, y, z, t, dx, dy, dz, depth) {
    var h = z + curv(x, y);
    terrainNormal(x, y, t);
    var nx = N[0], ny = N[1], nz = N[2];
    // water: the lakes are flat and at lake level
    if (h < P.lake.level && NB[2] > 0.9995) {
      var rip = smooth(9000, 2500, t);
      var wx = rip * 0.06 * (fbm(x / 35, y / 12, 2)), wy = rip * 0.06 * fbm(x / 12 + 7, y / 35, 2);
      var wn = Math.hypot(wx, wy, 1), wnx = wx / wn, wny = wy / wn, wnz = 1 / wn;
      var cosI = Math.max(0.02, -(dx * wnx + dy * wny + dz * wnz));
      var fres = 0.02 + 0.98 * Math.pow(1 - cosI, 5);
      var rdx = dx + 2 * cosI * wnx, rdy = dy + 2 * cosI * wny, rdz = dz + 2 * cosI * wnz;
      var rr = C.skyRefl[0], rg = C.skyRefl[1], rb = C.skyRefl[2];
      if (depth === 0 && marchFrom(x, y, z + 1, rdx, rdy, rdz, 5, 40000)) {
        var tt = hit.t, hx = hit.x, hy = hit.y, hz = hit.z;
        shadeTerrain(hx, hy, hz, t + tt, rdx, rdy, rdz, 1);
        var trr = Math.exp(-tt / P.haze.dist) * (1 - hfog(hz + curv(hx, hy), -rdz, tt));
        rr = LIN[0] * trr + C.haze[0] * (1 - trr); rg = LIN[1] * trr + C.haze[1] * (1 - trr); rb = LIN[2] * trr + C.haze[2] * (1 - trr);
      }
      var spec = Math.pow(Math.max(0, rdx * LX + rdy * LY + rdz * LZ), 200) * 3;
      LIN[0] = mix(C.water[0], rr, fres) + C.sun[0] * spec; LIN[1] = mix(C.water[1], rg, fres) + C.sun[1] * spec; LIN[2] = mix(C.water[2], rb, fres) + C.sun[2] * spec;
      return;
    }
    var snow = surface(x, y, h, t, nz);
    // snow buries the fine texture: light it with a normal blended toward the DEM's
    var sbl = snow * 0.75;
    nx = mix(nx, NB[0], sbl); ny = mix(ny, NB[1], sbl); nz = mix(nz, NB[2], sbl);
    var nl = Math.hypot(nx, ny, nz); nx /= nl; ny /= nl; nz /= nl;
    var dif = Math.max(0, nx * LX + ny * LY + nz * LZ);
    var sh = dif > 0 ? shadow(x, y, h + 2) * (depth === 0 ? cloudShadow(x, y, h) : 1) : 0;
    var occ = depth === 0 ? ao(x, y, h) : 0.8;
    var skyAmb = (0.55 + 0.45 * nz) * occ;
    LIN[0] = ALB[0] * (C.sun[0] * dif * sh + C.sky[0] * skyAmb);
    LIN[1] = ALB[1] * (C.sun[1] * dif * sh + C.sky[1] * skyAmb);
    LIN[2] = ALB[2] * (C.sun[2] * dif * sh + C.sky[2] * skyAmb);
  }

  // one primary ray: terrain colour (linear, fogged) + hit distance, or a miss
  var PR = { hit: false, t: 0, r: 0, g: 0, b: 0 };
  function primary(dx, dy, dz) {
    PR.hit = marchFrom(0, 0, CZ, dx, dy, dz, 60, P.maxDist);
    if (!PR.hit) return;
    var x = hit.x, y = hit.y, z = hit.z, t = hit.t;
    PR.t = t;
    shadeTerrain(x, y, z, t, dx, dy, dz, 0);
    var R = LIN[0], G = LIN[1], B = LIN[2];
    // aerial perspective by distance, then valley haze by altitude
    var tr = Math.exp(-t / P.haze.dist);
    R = R * tr + C.haze[0] * (1 - tr); G = G * tr + C.haze[1] * (1 - tr); B = B * tr + C.haze[2] * (1 - tr);
    var fg = hfog(CZ, dz, t);
    PR.r = mix(R, C.fog[0], fg); PR.g = mix(G, C.fog[1], fg); PR.b = mix(B, C.fog[2], fg);
  }
  function dirOf(sx, sy, out) {
    var cx = (sx - W / 2) / FOC, cy = (H / 2 - sy) / FOC;
    var dx = fX + rX * cx + uX * cy, dy = fY + rY * cx + uY * cy, dz = fZ + rZ * cx + uZ * cy;
    var n = Math.hypot(dx, dy, dz); out[0] = dx / n; out[1] = dy / n; out[2] = dz / n;
  }

  // ── render: terrain SS×SS per pixel, clouds once per pixel over it ──
  var CL = P.clip || [0, 0, W, H];                          // preview: render only this pixel box
  var SS = P.supersample || 1, py, pxx, o, DIR = [0, 0, 0];
  var LINBUF = new Float32Array(W * H * 4);                  // linear RGB + alpha, for the film pass
  for (py = CL[1]; py < CL[3]; py++) {
    for (pxx = CL[0]; pxx < CL[2]; pxx++) {
      var aR = 0, aG = 0, aB = 0, aA = 0, tSum = 0;
      for (var sj = 0; sj < SS; sj++) for (var si = 0; si < SS; si++) {
        dirOf(pxx + (si + 0.5) / SS, py + (sj + 0.5) / SS, DIR);
        primary(DIR[0], DIR[1], DIR[2]);
        if (PR.hit) { aR += PR.r; aG += PR.g; aB += PR.b; aA++; tSum += PR.t; }
      }
      var cov = aA / (SS * SS);
      if (aA) { aR /= aA; aG /= aA; aB /= aA; }
      // two jittered cloud samples per pixel, averaged (smooth edges without speckle)
      var ci0 = 0, ci1 = 0, ci2 = 0, ctA = 0, tEnd = aA ? tSum / aA : 1e9;
      for (var cs = 0; cs < 2; cs++) {
        dirOf(pxx + 0.25 + cs * 0.5, py + 0.25 + cs * 0.5, DIR);
        cloudsAlong(DIR[0], DIR[1], DIR[2], tEnd);
        ci0 += CI[0]; ci1 += CI[1]; ci2 += CI[2]; ctA += CT_;
      }
      CI[0] = ci0 / 2; CI[1] = ci1 / 2; CI[2] = ci2 / 2; CT_ = ctA / 2;
      // clouds over whatever is behind them: terrain where it covers, sky elsewhere
      var outA = cov + (1 - cov) * (1 - CT_);
      if (outA <= 0.002) continue;
      o = (py * W + pxx) * 4;
      var R = CI[0] + CT_ * aR * cov, G = CI[1] + CT_ * aG * cov, B = CI[2] + CT_ * aB * cov;
      LINBUF[o] = R / outA; LINBUF[o + 1] = G / outA; LINBUF[o + 2] = B / outA; LINBUF[o + 3] = outA;
    }
  }

  // ── film finish: bloom on the brightest snow, filmic tone, a little grain ──
  var BL = new Float32Array(W * H * 3);
  for (k = 0; k < W * H; k++) {
    var lum = (LINBUF[k * 4] + LINBUF[k * 4 + 1] + LINBUF[k * 4 + 2]) / 3 * C.exposure;
    var over = Math.max(0, lum - P.film.bloomAt) * LINBUF[k * 4 + 3];
    BL[k * 3] = over * LINBUF[k * 4]; BL[k * 3 + 1] = over * LINBUF[k * 4 + 1]; BL[k * 3 + 2] = over * LINBUF[k * 4 + 2];
  }
  function boxBlur(a, rad) {                                 // separable, 3 channels
    var tmp = new Float32Array(a.length), x, y, c, s, i;
    for (y = 0; y < H; y++) for (c = 0; c < 3; c++) { s = 0; for (x = -rad; x <= rad; x++) s += a[(y * W + clamp(x, 0, W - 1)) * 3 + c]; for (x = 0; x < W; x++) { tmp[(y * W + x) * 3 + c] = s / (2 * rad + 1); s += a[(y * W + Math.min(W - 1, x + rad + 1)) * 3 + c] - a[(y * W + Math.max(0, x - rad)) * 3 + c]; } }
    for (x = 0; x < W; x++) for (c = 0; c < 3; c++) { s = 0; for (y = -rad; y <= rad; y++) s += tmp[(clamp(y, 0, H - 1) * W + x) * 3 + c]; for (y = 0; y < H; y++) { a[(y * W + x) * 3 + c] = s / (2 * rad + 1); s += tmp[(Math.min(H - 1, y + rad + 1) * W + x) * 3 + c] - tmp[(Math.max(0, y - rad) * W + x) * 3 + c]; } }
  }
  var brad = Math.max(2, Math.round(W / 480));
  boxBlur(BL, brad); boxBlur(BL, brad * 2);
  var gs = 12345;
  function grn() { gs = (Math.imul(gs, 1103515245) + 12345) | 0; return ((gs >>> 8) & 0xffff) / 65535 - 0.5; }
  for (k = 0; k < W * H; k++) {
    var a4 = LINBUF[k * 4 + 3];
    var gr = grn() * P.film.grain;
    if (a4 <= 0.002) continue;
    o = k * 4;
    D[o] = clamp((tone(LINBUF[o] + BL[k * 3] * P.film.bloom) + gr) * 255, 0, 255);
    D[o + 1] = clamp((tone(LINBUF[o + 1] + BL[k * 3 + 1] * P.film.bloom) + gr) * 255, 0, 255);
    D[o + 2] = clamp((tone(LINBUF[o + 2] + BL[k * 3 + 2] * P.film.bloom) + gr) * 255, 0, 255);
    D[o + 3] = a4 * 255;
  }
  ctx.putImageData(img, 0, 0);
}

// The area and the camera. Tiles: zoom 12, ≈ 26 m per sample here.
export const DEM = { z: 12, x0: 2133, x1: 2143, y0: 1444, y1: 1452 };
// the massif and the near foothills at zoom 13 (≈ 13 m): real relief the zoom-12
// tiles average away (measured: 1.5× the per-sample curvature of upsampled z12)
export const DEM_HI = { z: 13, x0: 4271, x1: 4283, y0: 2889, y1: 2899 };
const VIEW = {
  dem: DEM, demHi: DEM_HI, seed: 2026, maxDist: 95000,
  // droplet erosion over the fine mosaic (seeded, so every bake carves the same gullies)
  // gentle carving; its drainage record (flow) places glaciers, couloirs and scree
  erosion: { seed: 7, droplets: 220000, steps: 40, inertia: 0.1, capacity: 4, minSlope: 0.01, deposit: 0.3, erode: 0.035, gravity: 9.8, evaporate: 0.03 },
  supersample: 2,
  // above the Niederhorn, looking south-east across Lake Thun at the Eiger, Mönch
  // and Jungfrau
  cam: { lat: 46.712, lon: 7.768, alt: 2150, heading: 132, pitch: -0.5, hfov: 44 },
  clouds: { sigma: 0.0045 },                          // extinction per metre at density 1
  lake: { level: 566 },                                 // Lake Thun 558 m, Lake Brienz 564 m
  fog: { base: 560, scale: 700, density: 0.00006 },     // valley haze: dense on the lakes, thin by 2500 m
  film: { bloomAt: 0.85, bloom: 0.35, grain: 0.006 },
  snow: { line: 2550, tree: 1850 }
};
const RANGE = {
  day: Object.assign({}, VIEW, {
    light: { az: 248, el: 19 },                          // low late-afternoon sun from the west-south-west: faces split into light and shadow
    haze: { dist: 150000 },
    colors: {
      exposure: 0.95,
      sun: [2.7, 2.1, 1.5], sky: [0.16, 0.21, 0.34],
      rock: [0.15, 0.147, 0.145], snow: [0.93, 0.94, 0.96], ice: [0.72, 0.84, 0.95], scree: [0.26, 0.255, 0.25],
      forest: [0.035, 0.05, 0.035], meadow: [0.15, 0.18, 0.09],
      water: [0.01, 0.025, 0.035], skyRefl: [0.42, 0.55, 0.78],
      cloud: [0.95, 0.96, 0.98], haze: [0.52, 0.62, 0.78], fog: [0.62, 0.7, 0.8]
    }
  }),
  night: Object.assign({}, VIEW, {
    light: { az: 245, el: 30 },                          // the moon, same side
    haze: { dist: 120000 },
    colors: {
      exposure: 0.62,
      sun: [0.34, 0.42, 0.68], sky: [0.04, 0.055, 0.11],
      rock: [0.2, 0.19, 0.18], snow: [0.93, 0.94, 0.96], ice: [0.72, 0.84, 0.95], scree: [0.3, 0.29, 0.28],
      forest: [0.035, 0.05, 0.035], meadow: [0.15, 0.18, 0.09],
      water: [0.005, 0.01, 0.02], skyRefl: [0.03, 0.045, 0.1],
      cloud: [0.8, 0.84, 0.95], haze: [0.06, 0.08, 0.16], fog: [0.07, 0.09, 0.17]
    }
  })
};

// the rendered sky: the same camera; the light where the CSS sun and moon are drawn
const SKY = {
  day: { cam: VIEW.cam, lightBoard: [1375, 115], exposure: 1.0,
         zenith: [0.02, 0.13, 0.42], horizon: [0.3, 0.47, 0.7], warm: [0.22, 0.13, 0.05], glow: [1.0, 0.82, 0.55],
         cirrus: 0.18, cirrusAlt: 9000, cirrusLight: 1.1, cirrusColor: [1.0, 0.93, 0.84] },
  night: { cam: VIEW.cam, lightBoard: [1375, 115], exposure: 1.0,
           zenith: [0.0025, 0.005, 0.018], horizon: [0.014, 0.022, 0.05], warm: [0.004, 0.005, 0.012], glow: [0.09, 0.11, 0.17],
           cirrus: 0.25, cirrusAlt: 9000, cirrusLight: 0.06, cirrusColor: [0.6, 0.7, 1.0], airglow: 0.004 }
};

// ── Mist: the wisps that drift over the cloud sea (board 1600x300) ─────────
function mist() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 300" preserveAspectRatio="none"><defs>${FILTERS}</defs>
  <g filter="url(#mist)" fill="#ffffff">
    <ellipse cx="260" cy="150" rx="330" ry="15" opacity=".42"/>
    <ellipse cx="760" cy="185" rx="420" ry="13" opacity=".34"/>
    <ellipse cx="620" cy="110" rx="240" ry="8" opacity=".26"/>
    <ellipse cx="1180" cy="140" rx="380" ry="16" opacity=".38"/>
    <ellipse cx="1480" cy="200" rx="260" ry="10" opacity=".28"/>
  </g></svg>`;
}

// name → { w, h (baked pixels), alpha, svg, canvas?: { fn, params } drawn under the svg }
export const LAYERS = {
  'day-sky':    { w: 2880, h: 1800, alpha: false, svg: () => '', canvas: { fn: renderSky, params: SKY.day } },
  'night-sky':  { w: 2880, h: 1800, alpha: false, svg: () => '', canvas: { fn: renderSky, params: SKY.night } },
  'stars-a':    { w: 1024, h: 1024, alpha: true,  svg: () => stars(7, 150, true) },
  'stars-b':    { w: 1024, h: 1024, alpha: true,  svg: () => stars(19, 110, false) },
  'day-land':   { w: 2880, h: 1800, alpha: true,  svg: () => '', canvas: { fn: renderRange, params: RANGE.day, dem: true } },
  'night-land': { w: 2880, h: 1800, alpha: true,  svg: () => '', canvas: { fn: renderRange, params: RANGE.night, dem: true } },
  'mist':       { w: 3200, h: 600,  alpha: true,  svg: mist }
};
