#!/usr/bin/env node
// Dev-only. Estimates the par times in js/level-table.js by driving every level with an
// idealised reflex driver through the real physics in js/teleop/drive.js (the actual
// updateBot, at the slider defaults). The driver holds a full stick straight at the
// next checkpoint with no anticipation and no braking; the one thing it knows about
// the field is where the elements are (js/teleop/robot.js): when the straight line
// would run into one it heads for the corner of that element that makes the shortest
// detour, the way a driver goes around it, and resumes the straight line once it is
// clear. Checkpoints register exactly as js/teleop/levels.js registers them (0.5 ft
// radius, 0.3 s cooldown, 0.4 s at start).
//
//   node tools/estimate-pars.mjs            # prints the table
//
// par = 1.2 × that time, rounded up to 100 ms; timeLimit = 2 × par rounded up to a
// whole second, so gold (≤ 50% of the limit) means par pace. Never runs in the app.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

const gp = { axes: [0, 0, 0, 0] };
const sandbox = { console, navigator: { getGamepads: () => [gp] }, __gp: gp };
vm.createContext(sandbox);
// What field.js / input.js would declare (they bind the DOM at load). robot.js is
// loaded for real so the field elements (COLLISION_ZONES) block the reference driver
// exactly as they block a student: a path that clips the hive shows up as a slow or
// unfinished row here.
vm.runInContext(`
  const FIELD_FT = 12;
  let inp = { lx: 0, ly: 0, rx: 0 }, keys = {}, gpIdx = 0, inputBuffer = [], inputTime = 0;
`, sandbox);
for (const f of ['js/teleop/robot.js', 'js/teleop/drive.js', 'js/teleop/levels.js', 'js/level-table.js']) {
  vm.runInContext(read(f).replace(/window\.RT_LEVEL_TABLE\s*=/, 'globalThis.RT_LEVEL_TABLE ='), sandbox, { filename: f });
}
vm.runInContext(`appMode = 'levels'; drivetrain = 'mecanum'; driveMode = 'field';`, sandbox);

// Field elements as the robot centre sees them: each box grown by half the robot and
// a small margin. The driver treats the line to its target as blocked when it crosses
// one of these, and aims at the box corner with the shortest detour instead.
vm.runInContext(`
  const __half = cfg.robotSz / 24, __margin = 0.15, __hf = FIELD_FT / 2 - __half;
  const __grow = (z, by) => ({ l: z.x - z.w / 2 - by, r: z.x + z.w / 2 + by, b: z.y - z.h / 2 - by, t: z.y + z.h / 2 + by });
  const __boxes = COLLISION_ZONES.map(z => __grow(z, __half + __margin));
  // The element itself as the robot centre sees it, a hair inside the contact line:
  // a corner whose line from the robot crosses this is on the far side of the element.
  const __cores = COLLISION_ZONES.map(z => __grow(z, __half - 0.02));
  function __inside(x, y, B) { return x > B.l && x < B.r && y > B.b && y < B.t; }
  // Liang–Barsky: where (0..1 along a→b, or Infinity) the segment first enters the box.
  function __entry(ax, ay, bx, by, B) {
    let t0 = 0, t1 = 1; const dx = bx - ax, dy = by - ay;
    const clip = (p, q) => {
      if (p === 0) return q >= 0;
      const r = q / p;
      if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
      else       { if (r < t0) return false; if (r < t1) t1 = r; }
      return true;
    };
    return (clip(-dx, ax - B.l) && clip(dx, B.r - ax) && clip(-dy, ay - B.b) && clip(dy, B.t - ay)) ? t0 : Infinity;
  }
  function __aim(x, y, tx, ty) {
    let block = -1, best = Infinity;
    __boxes.forEach((B, i) => {
      const e = __inside(x, y, B) ? 0 : __entry(x, y, tx, ty, B);
      if (e < best) { best = e; block = i; }
    });
    if (block < 0) return { x: tx, y: ty };
    const B = __boxes[block], core = __cores[block];
    let corner = null, cost = Infinity;
    for (const c of [[B.l, B.b], [B.r, B.b], [B.l, B.t], [B.r, B.t]]) {
      if (Math.abs(c[0]) > __hf || Math.abs(c[1]) > __hf) continue;      // beyond the wall
      if (__entry(x, y, c[0], c[1], core) !== Infinity) continue;        // through the element
      const k = Math.hypot(c[0] - x, c[1] - y) + Math.hypot(tx - c[0], ty - c[1]);
      if (k < cost) { cost = k; corner = { x: c[0], y: c[1] }; }
    }
    return corner || { x: tx, y: ty };
  }
`, sandbox);

const simulate = vm.runInContext(`(function (def) {
  const p0 = def.path[0];
  bot.x = p0.x; bot.y = p0.y; bot.hdg = 0;
  bot.vx = bot.vy = bot.actualVx = bot.actualVy = bot.actualOmega = bot.vFwd = bot.vStr = 0;
  inputBuffer.length = 0; inputTime = 0;
  const dt = 1 / 60;
  let t = 0, nextCp = 1, cool = 0.4, maxSpeed = 0, detourFrames = 0;
  while (t < 60) {
    const target = def.path[nextCp];
    const aim = __aim(bot.x, bot.y, target.x, target.y);
    if (aim.x !== target.x || aim.y !== target.y) detourFrames++;
    const dx = aim.x - bot.x, dy = aim.y - bot.y, d = Math.hypot(dx, dy) || 1;
    // full stick at the target; field-centric, +y up on the field, the Y axis is inverted
    __gp.axes[0] = dx / d; __gp.axes[1] = -dy / d; __gp.axes[2] = 0;
    updateBot(dt);
    t += dt;
    maxSpeed = Math.max(maxSpeed, Math.hypot(bot.actualVx, bot.actualVy));
    cool = Math.max(0, cool - dt);
    if (cool <= 0 && Math.hypot(bot.x - target.x, bot.y - target.y) < LVL_CP_RADIUS) {
      nextCp++; cool = 0.3;
      if (nextCp >= def.path.length) break;
    }
  }
  const { total } = pathSegLengths(def.path);
  return { id: def.id, name: def.name, tier: def.tier, pathLengthFt: Math.round(total * 10) / 10, corners: def.path.length - 2, expertMs: Math.round(t * 1000), maxSpeed: Math.round(maxSpeed * 100) / 100, detourMs: Math.round(detourFrames * dt * 1000), done: nextCp >= def.path.length };
})`, sandbox);

const cfg = vm.runInContext('cfg', sandbox);
console.log('physics:', JSON.stringify(cfg));
const rows = vm.runInContext('LEVELS', sandbox).map(def => {
  const r = simulate(def);
  r.parTimeMs = Math.ceil(r.expertMs * 1.2 / 100) * 100;
  r.timeLimit = Math.ceil(2 * r.parTimeMs / 1000);
  return r;
});
console.log('id  name                    tier          len(ft) corners expert(s) detour(s) par(s) limit(s) done');
for (const r of rows) {
  console.log(String(r.id).padStart(2), ' ', r.name.padEnd(22), r.tier.padEnd(13), String(r.pathLengthFt).padStart(6), String(r.corners).padStart(7), (r.expertMs / 1000).toFixed(2).padStart(9), (r.detourMs / 1000).toFixed(2).padStart(9), (r.parTimeMs / 1000).toFixed(1).padStart(6), String(r.timeLimit).padStart(8), r.done ? '  ok' : '  NOT FINISHED');
}
console.log('\nJSON:');
console.log(JSON.stringify(rows.map(r => ({ id: r.id, pathLengthFt: r.pathLengthFt, corners: r.corners, expertMs: r.expertMs, parTimeMs: r.parTimeMs, timeLimit: r.timeLimit }))));
