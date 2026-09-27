// Every page at every screen size: nothing runs off the side, the controls that
// matter are on screen, TeleOp can be driven with the touch sticks, Path Planner
// waypoints drag with a finger, canvases follow the sidebar, and the page
// transition (the sky stays, the content glides) behaves in both of its forms.
import { test, expect } from '@playwright/test';
import { makeYearState, seedState } from './helpers/state.js';

const PAGES = [
  { name: 'Home', url: '/', key: ['.home-content', '#hero-cta'] },
  { name: 'TeleOp', url: '/pages/teleop.html', key: ['#c', '#mode-tabs', '#ctrl-bar'] },
  { name: 'Curriculum', url: '/pages/curriculum.html', key: ['.curr-content'] },
  { name: 'Path Planner', url: '/pages/pathplanner.html', key: ['#fieldCanvas'] },
  { name: 'Strategy', url: '/pages/strategy.html', key: ['#strategyCanvas', '.topbar-btn[aria-label="Save"]', '.topbar-btn[aria-label="Present"]'] },
  { name: 'Report', url: '/pages/report.html', key: ['.report-content'] },
  { name: 'About', url: '/pages/about.html', key: ['.content'] },
  { name: '404', url: '/404.html', key: ['.nf-card'] }
];
const SIZES = [
  { name: 'phone 360', w: 360, h: 740, touch: true },
  { name: 'phone 390', w: 390, h: 844, touch: true },
  { name: 'phone landscape', w: 844, h: 390, touch: true },
  { name: 'tablet portrait', w: 768, h: 1024, touch: true },
  { name: 'tablet landscape', w: 1024, h: 768, touch: false },
  { name: 'laptop 1280', w: 1280, h: 720, touch: false }
];
// sizes where folding the TeleOp panel must visibly grow the field (portrait phones are width-bound,
// a 16:9 laptop is height-bound with the panel open already)
const GROWS = new Set(['phone landscape', 'tablet portrait', 'tablet landscape']);

// Elements whose right edge passes the viewport and that no clipping ancestor
// (a horizontal scroller, an overflow-hidden frame) keeps inside it.
function offscreen() {
  const vw = document.documentElement.clientWidth, out = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || r.right <= vw + 1) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.position === 'fixed') continue;
    let a = el.parentElement, clipped = false;
    while (a && a !== document.body) {
      const acs = getComputedStyle(a);
      if (acs.overflowX !== 'visible' && a.getBoundingClientRect().right <= vw + 1) { clipped = true; break; }
      if (acs.position === 'fixed') { clipped = true; break; }   // the sky, the collapsed sidebar
      a = a.parentElement;
    }
    if (!clipped) out.push((el.id ? '#' + el.id : el.tagName.toLowerCase() + '.' + [...el.classList].join('.')) + ' → ' + Math.round(r.right));
  }
  return { doc: document.documentElement.scrollWidth - vw, out: out.slice(0, 5) };
}

for (const size of SIZES) {
  test(`${size.name} (${size.w}×${size.h}): every page fits the width and shows its controls`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: size.w, height: size.h }, hasTouch: size.touch });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', d => d.accept());
    await page.goto('/', { waitUntil: 'load' });
    await seedState(page, makeYearState());
    for (const p of PAGES) {
      await page.goto(p.url, { waitUntil: 'load' });
      await page.waitForTimeout(p.name === 'Home' ? 0 : 150);
      if (p.name === 'Home') await page.waitForFunction(() => document.documentElement.getAttribute('data-intro') === 'done');
      const o = await page.evaluate(offscreen);
      expect(o.doc, `${p.name}: page scrolls sideways`).toBeLessThanOrEqual(0);
      expect(o.out, `${p.name}: runs off the right edge`).toEqual([]);
      for (const sel of p.key) {
        const box = await page.locator(sel).first().boundingBox();
        expect(box, `${p.name}: ${sel} is rendered`).not.toBeNull();
        expect(box.x, `${p.name}: ${sel} left edge`).toBeGreaterThanOrEqual(-1);
        expect(box.x + box.width, `${p.name}: ${sel} right edge`).toBeLessThanOrEqual(size.w + 1);
        expect(box.y, `${p.name}: ${sel} top`).toBeLessThan(size.h);
      }
      if (p.name === 'TeleOp') {
        // the whole field is on screen, and on touch screens so are both sticks
        const field = await page.locator('#c').boundingBox();
        expect(field.y + field.height, 'TeleOp: field bottom').toBeLessThanOrEqual(size.h + 1);
        if (size.touch) {
          for (const id of ['#stick-l', '#stick-r']) {
            const b = await page.locator(id).boundingBox();
            expect(b, id).not.toBeNull();
            expect(b.y + b.height, `${id} bottom`).toBeLessThanOrEqual(size.h + 1);
            const overlap = !(b.x >= field.x + field.width || b.x + b.width <= field.x || b.y >= field.y + field.height || b.y + b.height <= field.y);
            expect(overlap, `${id} covers the field`).toBe(false);
          }
        }
        // panel open: the control bar sits under the field, and the fold handle is
        // joined to the panel's edge (its left edge side by side, its top stacked)
        const field0 = await page.locator('#c').boundingBox();
        const sideBySide = size.w > 900 || size.w > size.h;
        const bar = await page.locator('#ctrl-bar').boundingBox();
        const handle = await page.locator('#panel-toggle').boundingBox();
        const sheet = await page.locator('#sidebar-teleop').boundingBox();
        expect(bar.y, 'TeleOp: controls sit under the field').toBeGreaterThanOrEqual(field0.y + field0.height);
        if (sideBySide) expect(Math.abs(handle.x + handle.width - sheet.x), 'TeleOp: handle joins the panel\'s left edge').toBeLessThanOrEqual(2);
        else expect(Math.abs(handle.y + handle.height - sheet.y), 'TeleOp: handle joins the sheet\'s top edge').toBeLessThanOrEqual(10);
        // the panel folds away and the field takes its room
        const before = await page.evaluate(() => cvsSize);
        await page.click('#panel-toggle');
        await page.waitForTimeout(250);
        expect(await page.locator('#sidebar-teleop').isVisible(), 'TeleOp: folded column').toBe(false);
        const folded = await page.evaluate(() => cvsSize);
        if (GROWS.has(size.name)) expect(folded, 'TeleOp: folded field grows').toBeGreaterThan(before + 15);
        else expect(folded, 'TeleOp: folded field').toBeGreaterThanOrEqual(before);
        const fo = await page.evaluate(offscreen);
        expect(fo.doc, 'TeleOp folded: page scrolls sideways').toBeLessThanOrEqual(0);
        expect(fo.out, 'TeleOp folded: runs off the right edge').toEqual([]);
        const ff = await page.locator('#c').boundingBox();
        expect(ff.y + ff.height, 'TeleOp folded: field bottom').toBeLessThanOrEqual(size.h + 1);
        expect(ff.x + ff.width, 'TeleOp folded: field right').toBeLessThanOrEqual(size.w + 1);
        if (sideBySide) {
          // folded side by side: the controls become a column on the right, joined to the handle
          const col = await page.locator('#ctrl-col').boundingBox();
          const h2 = await page.locator('#panel-toggle').boundingBox();
          expect(col.x, 'TeleOp folded: control column right of the field').toBeGreaterThanOrEqual(ff.x + ff.width);
          expect(col.height, 'TeleOp folded: controls form a column').toBeGreaterThan(col.width);
          expect(Math.abs(h2.x + h2.width - col.x), 'TeleOp folded: handle joins the control column').toBeLessThanOrEqual(2);
        } else {
          const b2 = await page.locator('#ctrl-bar').boundingBox();
          expect(b2.y, 'TeleOp folded (stacked): controls stay under the field').toBeGreaterThanOrEqual(ff.y + ff.height);
        }
        const hb = await page.locator('.hamburger').boundingBox();
        expect(hb.x + hb.width <= ff.x || hb.y + hb.height <= ff.y, 'TeleOp folded: hamburger covers the field').toBe(true);
        for (const sel of ['#panel-toggle', '#ctrl-bar', ...(size.touch ? ['#stick-l', '#stick-r'] : [])]) {
          const b = await page.locator(sel).boundingBox();
          expect(b.x + b.width, `TeleOp folded: ${sel} right edge`).toBeLessThanOrEqual(size.w + 1);
          expect(b.y + b.height, `TeleOp folded: ${sel} bottom`).toBeLessThanOrEqual(size.h + 1);
          const overlap = !(b.x >= ff.x + ff.width || b.x + b.width <= ff.x || b.y >= ff.y + ff.height || b.y + b.height <= ff.y);
          expect(overlap, `TeleOp folded: ${sel} covers the field`).toBe(false);
        }
        // picking a mode brings the panel back
        await page.click('#tab-levels');
        await expect(page.locator('#levels-sidebar')).toBeVisible();
        expect(await page.evaluate(() => cvsSize)).toBeLessThanOrEqual(folded);
      }
    }
    expect(errors).toEqual([]);
    await context.close();
  });
}

test('TeleOp on a phone: the left stick drives the robot and recentres on release', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.goto('/pages/teleop.html', { waitUntil: 'load' });
  await page.waitForFunction(() => typeof cvsSize === 'number' && typeof touchInp === 'object');
  await expect(page.locator('html')).toHaveClass(/rt-touch/);
  // the field is drawn at the device pixel ratio
  const [css, px] = await page.evaluate(() => [cvsSize, cvs.width]);
  expect(px).toBe(css * 2);

  const y0 = await page.evaluate(() => bot.y);
  const s = await page.locator('#stick-l').boundingBox();
  await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2);
  await page.mouse.down();
  await page.mouse.move(s.x + s.width / 2, s.y + 2, { steps: 4 });
  await page.waitForTimeout(600);
  const held = await page.evaluate(() => ({ ...touchInp }));
  expect(held.left).toBe(true);
  expect(held.ly).toBeLessThan(-0.9);
  await page.mouse.up();
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => bot.y)).toBeGreaterThan(y0 + 1);   // drove forward (+y is up the field)
  expect(await page.evaluate(() => ({ ...touchInp }))).toEqual({ lx: 0, ly: 0, rx: 0, left: false, right: false });
  await context.close();
});

test('TeleOp: P folds and unfolds the side column', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/pages/teleop.html', { waitUntil: 'load' });
  await page.waitForFunction(() => typeof togglePanel === 'function' && typeof cvsSize === 'number');
  const toggle = page.locator('#panel-toggle');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('KeyP');
  await expect(page.locator('#sidebar-teleop')).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toHaveAttribute('aria-label', 'Show panel (P)');
  await page.keyboard.press('KeyP');
  await expect(page.locator('#sidebar-teleop')).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
});

// Grey text (secondary / muted / faint, also every placeholder) stays readable:
// at least 4.5:1 on the glass over the brightest sky each theme can show.
test('grey text tokens keep 4.5:1 on glass in both themes', async ({ page }) => {
  await page.goto('/pages/about.html', { waitUntil: 'load' });
  const ratios = await page.evaluate(() => {
    const rgba = v => { const d = document.createElement('i'); d.style.color = v; document.body.appendChild(d); const m = getComputedStyle(d).color.match(/[\d.]+/g).map(Number); d.remove(); return [m[0], m[1], m[2], m.length > 3 ? m[3] : 1]; };
    const over = (f, b) => [0, 1, 2].map(i => f[i] * f[3] + b[i] * (1 - f[3]));
    const lum = c => { const [r, g, b] = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const out = {}, root = document.documentElement;
    for (const theme of ['light', 'dark']) {
      root.classList.toggle('light', theme === 'light');
      const sky = rgba(theme === 'light' ? 'var(--sky-horizon)' : 'var(--sky-mid)');
      const glass = over(rgba('var(--glass)'), sky);
      const grounds = theme === 'light' ? [glass, over(rgba('var(--glass-inset)'), glass)] : [glass];
      for (const t of ['--text-secondary', '--text-muted', '--text-faint']) {
        const fg = rgba('var(' + t + ')');
        out[theme + ' ' + t] = Math.min(...grounds.map(g => ratio(fg, g)));
      }
    }
    return out;
  });
  for (const [k, v] of Object.entries(ratios)) expect(v, k).toBeGreaterThanOrEqual(4.5);
});

test('Path Planner: a pointer drag moves a waypoint', async ({ page }) => {
  await page.goto('/pages/pathplanner.html', { waitUntil: 'load' });
  await page.waitForFunction(() => typeof addWaypoint === 'function' && typeof cvsSz === 'number');
  await page.evaluate(() => { addWaypoint(72, 72); });
  const box = await page.locator('#fieldCanvas').boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + box.width / 8, cy, { steps: 5 });
  await page.mouse.up();
  const wp = await page.evaluate(() => waypoints[0]);
  expect(wp.x).toBeGreaterThan(85);
  expect(Math.abs(wp.y - 72)).toBeLessThan(2);
  expect(await page.evaluate(() => waypoints.length)).toBe(1);   // a drag is not a click
});

test('opening the sidebar re-lays out the canvases (rt-layoutchange)', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/', { waitUntil: 'load' });
  await seedState(page, makeYearState());
  await page.goto('/pages/report.html', { waitUntil: 'load' });
  await page.waitForSelector('#sidebar');
  const fired = page.evaluate(() => new Promise(r => window.addEventListener('rt-layoutchange', () => r(true), { once: true })));
  await page.click('.hamburger');
  expect(await fired).toBe(true);
  await page.waitForTimeout(400);   // the report re-renders 200 ms after the event
  const fit = await page.evaluate(() => [...document.querySelectorAll('.rpt-chart-wrap canvas')].map(c => {
    const card = c.closest('.rpt-card').getBoundingClientRect(), r = c.getBoundingClientRect();
    return r.right <= card.right + 1;
  }));
  expect(fit.length).toBeGreaterThan(0);
  expect(fit.every(Boolean)).toBe(true);
});

test('the sidebar follows a tablet rotating from landscape to portrait', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/pages/about.html', { waitUntil: 'load' });
  await page.waitForSelector('#sidebar');
  await page.click('.hamburger');
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.waitForTimeout(500);
  await expect(page.locator('#sidebar')).toHaveClass(/open/);
  await expect(page.locator('#sidebarBackdrop')).toHaveClass(/visible/);
  const box = await page.locator('#sidebar').boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(-1);   // on screen, not stranded off the edge
});

// ── Page transition ─────────────────────────────────────────────────────────
test('page transition: no overlay, the sky is on both sides, rt-nav is set for the hop and cleared on arrival', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });
  await page.waitForFunction(() => document.documentElement.getAttribute('data-intro') === 'done');
  expect(await page.locator('#rt-overlay').count()).toBe(0);
  const wrapName = await page.evaluate(() => getComputedStyle(document.querySelector('.main-wrap')).viewTransitionName);
  expect(wrapName).toBe('rt-page');
  await page.click('#tile-report');
  await page.waitForURL('**/pages/report.html');
  await page.waitForSelector('#sidebar');
  expect(await page.locator('#rt-atmosphere').count()).toBe(1);
  expect(await page.locator('#rt-overlay').count()).toBe(0);
  expect(await page.evaluate(() => sessionStorage.getItem('rt-nav'))).toBeNull();
});

test('page transition fallback (no View Transitions): the content leaves, then arrives', async ({ page }) => {
  await page.addInitScript(() => { delete window.CSSViewTransitionRule; });
  await page.goto('/pages/about.html', { waitUntil: 'load' });
  await page.waitForSelector('#sidebar');
  const link = page.locator('.topbar-left a');
  await link.click();
  await expect(page.locator('html')).toHaveClass(/rt-leaving/);
  expect(await page.evaluate(() => sessionStorage.getItem('rt-nav'))).toBe('1');   // no beforeunload prompt for it
  await page.waitForURL(u => u.pathname === '/' || u.pathname.endsWith('/index.html'));
  await expect(page.locator('html')).not.toHaveClass(/rt-leaving/);
  await expect(page.locator('html')).not.toHaveClass(/rt-arriving/, { timeout: 2000 });
});

test('page transition under reduced motion: links navigate at once', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.addInitScript(() => { delete window.CSSViewTransitionRule; });
  await page.goto('/pages/about.html', { waitUntil: 'load' });
  await page.waitForSelector('#sidebar');
  await page.locator('.topbar-left a').click();
  await page.waitForURL(u => u.pathname === '/' || u.pathname.endsWith('/index.html'));
  expect(await page.locator('html.rt-leaving, html.rt-arriving').count()).toBe(0);
  await context.close();
});
