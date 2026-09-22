// ── R-Tracker TeleOp — Robot Drawing ─────────────────────────────────────

// BIOBUZZ (2026-27) field elements the robot can hit. Feet from the field centre,
// +y north; x/y is the centre, w/h the footprint, `height` inches for the 3D view.
// Dimensions from the Competition Manual §9 (nominal, ±1 in); the flowers sit on
// the perimeter wall at tile seams 2 and 4, read off the field image. Tape zones
// (loading zones, gardens) are not obstacles. Solid in Free Drive and in Levels;
// hitting one at speed counts as a collision (js/teleop/metrics.js).
const COLLISION_ZONES = [
  { name: 'HIVE frame',     x: 0,     y: 0,     w: 3.25, h: 4.12, height: 44 },  // 38.95 × 49.46 in base; the cells overhang above robot height (pivots 43.95 in up)
  { name: 'FLOWER (north)', x: -2,    y: 5.75,  w: 0.83, h: 0.5,  height: 22 },  // 10 in along the wall × 6 in out; top ring 21.5 in up
  { name: 'FLOWER (east)',  x: 5.75,  y: 2,     w: 0.5,  h: 0.83, height: 22 },
  { name: 'FLOWER (south)', x: 2,     y: -5.75, w: 0.83, h: 0.5,  height: 22 },
  { name: 'FLOWER (west)',  x: -5.75, y: -2,    w: 0.5,  h: 0.83, height: 22 },
];

let debugCollisions = false;

function drawDebugCollisions() {
  if (!debugCollisions) return;
  const s = cvs.width / FIELD_FT;
  for (const z of COLLISION_ZONES) {
    const cx = (z.x + FIELD_FT / 2) * s;
    const cy = (-z.y + FIELD_FT / 2) * s;
    const w = z.w * s;
    const h = z.h * s;
    ctx.fillStyle = 'rgba(255, 60, 60, 0.25)';
    ctx.fillRect(cx - w / 2, cy - h / 2, w, h);
    ctx.strokeStyle = 'rgba(255, 60, 60, 0.7)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(cx - w / 2, cy - h / 2, w, h);
  }
}

function drawRobot() {
  const pos = fieldToCvs(bot.x, bot.y);
  const s = cvs.width / FIELD_FT;
  const r = (cfg.robotSz / 24) * s;

  ctx.save();
  ctx.translate(pos.x, pos.y);
  ctx.rotate(bot.hdg * Math.PI / 180);

  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(-r + 3, -r + 3, r * 2, r * 2);

  ctx.fillStyle = '#b0b8c8';
  ctx.fillRect(-r, -r, r * 2, r * 2);

  ctx.fillStyle = '#4a9eff';
  ctx.fillRect(-r, -r, r * 2, r * 0.28);

  ctx.fillStyle = '#1a1a2e';
  ctx.font = `bold ${r * 0.6}px Courier New`;
  ctx.textAlign = 'center';
  ctx.fillText('FTC', 0, r * 0.35);

  const wW = r * 0.25, wH = r * 0.55;
  const wx = r * 0.82, wy = r * 0.55;
  const wColor = '#222';
  const wHighlight = drivetrain === 'mecanum' ? '#6a6a8a' : '#4a4a6a';

  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sy]) => {
    ctx.save();
    ctx.translate(sx * wx, sy * wy);
    if (drivetrain === 'mecanum') ctx.rotate(Math.PI / 4 * sx);
    ctx.fillStyle = wColor;
    ctx.fillRect(-wW / 2, -wH / 2, wW, wH);
    ctx.fillStyle = wHighlight;
    ctx.fillRect(-wW / 2 + 1, -wH / 2 + 2, wW - 2, 3);
    ctx.restore();
  });

  ctx.strokeStyle = '#778899';
  ctx.lineWidth = 1.2;
  ctx.strokeRect(-r, -r, r * 2, r * 2);

  ctx.beginPath();
  ctx.moveTo(0, -r + r * 0.28);
  ctx.lineTo(-r * 0.18, -r + r * 0.50);
  ctx.lineTo(r * 0.18, -r + r * 0.50);
  ctx.closePath();
  ctx.fillStyle = '#fff';
  ctx.fill();

  ctx.restore();
}
