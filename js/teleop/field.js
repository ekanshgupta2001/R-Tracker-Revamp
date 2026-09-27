// ── R-Tracker TeleOp — Field ──────────────────────────────────────────────

const FIELD_FT = 12;
const TILES = 6;

const fieldImg = new Image();
fieldImg.src = '../../assets/biobuzz.webp';

const cvs = document.getElementById('c');
const ctx = cvs.getContext('2d');

// The field fills #field-container. #app is a grid (css/teleop.css). Side by
// side, the field's cell is a 1fr row and column between the tabs, the control
// bar, the sticks and the panel (or the control column when the panel is
// folded), so the cell is the space. Stacked (phones and tablets in portrait,
// --stacked: 1) the field row gets the height the other rows leave, keeping
// SHEET_MIN px for the panel sheet unless the panel is folded — read from the
// resolved grid tracks, so the CSS can change the rows' heights without this
// drifting.
//
// cvsSize is the field's size in CSS pixels; every draw call works in it. The
// backing store is cvsSize × devicePixelRatio (≤ 2) so the field stays sharp on
// phones and retina screens, and the context carries the matching transform.
const SHEET_MIN = 170;
const FIELD_ROW = 1, SHEET_ROW = 5;           // grid rows in the stacked layout (teleop.css)
let cvsSize = 300;
function resize() {
  const fc = document.getElementById('field-container');
  const app = document.getElementById('app');
  let avW = window.innerWidth - 480, avH = window.innerHeight - 24;
  if (fc && app) {
    const acs = getComputedStyle(app);
    if (acs.getPropertyValue('--stacked').trim() === '1') {
      const rows = acs.gridTemplateRows.split(' ').map(parseFloat);
      const gap = parseFloat(acs.rowGap) || 0;
      const sheet = app.classList.contains('panel-collapsed') ? 0 : SHEET_MIN;
      let used = sheet;
      rows.forEach((h, k) => { if (k !== FIELD_ROW && k !== SHEET_ROW) used += h || 0; });
      const inner = app.clientHeight - parseFloat(acs.paddingTop) - parseFloat(acs.paddingBottom);
      avH = inner - used - gap * (rows.length - 1) - 2;
      avW = fc.clientWidth - 2;
    } else {
      avW = fc.clientWidth - 2;               // #field-wrap border
      avH = fc.clientHeight - 2;
    }
  }
  cvsSize = Math.max(160, Math.floor(Math.min(avW, avH)));
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cvs.width = cvs.height = Math.round(cvsSize * dpr);
  cvs.style.width = cvs.style.height = cvsSize + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function drawField() {
  ctx.drawImage(fieldImg, 0, 0, cvsSize, cvsSize);
}

function lighten(hex, amt) {
  const r = Math.min(255, parseInt(hex.slice(1, 3), 16) + amt);
  const g = Math.min(255, parseInt(hex.slice(3, 5), 16) + amt);
  const b = Math.min(255, parseInt(hex.slice(5, 7), 16) + amt);
  return `rgb(${r},${g},${b})`;
}

function fieldToCvs(fx, fy) {
  const s = cvsSize / FIELD_FT;
  return { x: (fx + FIELD_FT / 2) * s, y: (-fy + FIELD_FT / 2) * s };
}
