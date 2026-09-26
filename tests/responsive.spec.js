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
