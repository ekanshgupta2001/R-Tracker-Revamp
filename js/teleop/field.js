// ── R-Tracker TeleOp — Field ──────────────────────────────────────────────

const FIELD_FT = 12;
const TILES = 6;

const fieldImg = new Image();
fieldImg.src = '../../assets/biobuzz.webp';

const cvs = document.getElementById('c');
const ctx = cvs.getContext('2d');

// The field fills #field-container minus the chrome stacked above and below it
// (mode tabs, control bar, touch sticks, mini stats) — measured, so the CSS can
// change their height without this constant drifting. Wide screens lay the page
// out in a row and #field-container's height comes from the flex layout; phones
// stack it (css/teleop.css ≤ 900 px), and there the field shares #app's height
// with the panel sheet below it, which keeps at least SHEET_MIN px.
//
// cvsSize is the field's size in CSS pixels; every draw call works in it. The
// backing store is cvsSize × devicePixelRatio (≤ 2) so the field stays sharp on
// phones and retina screens, and the context carries the matching transform.
const SHEET_MIN = 170;
let cvsSize = 300;
function resize() {
  const fc = document.getElementById('field-container');
  const wrap = document.getElementById('field-wrap');
  const app = document.getElementById('app');
  let avW = window.innerWidth - 320, avH = window.innerHeight - 170;
  if (fc && wrap && app) {
    const gap = parseFloat(getComputedStyle(fc).rowGap) || 10;
    let chrome = 0, n = 0;
    for (const el of fc.children) {
      if (el === wrap || !el.offsetHeight || getComputedStyle(el).position === 'absolute') continue;
      chrome += el.offsetHeight; n++;
    }
    avW = fc.clientWidth - 2;                 // #field-wrap border
    const pad = document.getElementById('touch-pad');
    if (pad && pad.offsetWidth && getComputedStyle(pad).position === 'absolute') {
      let side = 0;                           // floating sticks: keep them beside the field
      for (const st of pad.children) side = Math.max(side, st.offsetWidth);
      avW -= 2 * (side + 8);
    }
    const acs = getComputedStyle(app);
    if (acs.flexDirection === 'column') {
      const inner = app.clientHeight - parseFloat(acs.paddingTop) - parseFloat(acs.paddingBottom) - (parseFloat(acs.rowGap) || 0);
      avH = inner - SHEET_MIN - chrome - gap * n - 2;
    } else {
      avH = fc.clientHeight - chrome - gap * n - 2;
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
