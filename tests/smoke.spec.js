// Smoke tests: every page loads with no JS errors, no failed requests, and no
// request to another origin. Runs against tests/serve.js (see playwright.config.js).
import { test, expect } from '@playwright/test';

const PAGES = [
  { name: 'Home', path: '/' },
  { name: 'TeleOp', path: '/pages/teleop.html' },
  { name: 'Path Planner', path: '/pages/pathplanner.html' },
  { name: 'Strategy', path: '/pages/strategy.html' },
  { name: 'Curriculum', path: '/pages/curriculum.html' },
  { name: 'Report', path: '/pages/report.html' },
  { name: 'About', path: '/pages/about.html' },
];

for (const pg of PAGES) {
  test(`${pg.name} page loads without errors`, async ({ page, baseURL }) => {
    const problems = [];
    page.on('pageerror', err => problems.push('pageerror: ' + err.message));
    page.on('console', msg => { if (msg.type() === 'error') problems.push('console: ' + msg.text()); });
    page.on('response', res => { if (res.status() >= 400) problems.push('HTTP ' + res.status() + ' ' + res.url()); });
    page.on('request', req => { if (!req.url().startsWith(baseURL)) problems.push('cross-origin: ' + req.url()); });

    await page.goto(pg.path, { waitUntil: 'load' });
    await page.waitForFunction(() => window.RTStore && window.RTStore.ready);
    await page.waitForTimeout(300);

    const body = await page.locator('body').textContent();
    expect(body.length).toBeGreaterThan(0);
    expect(problems).toEqual([]);
  });
}

// Every page is on the Summit design: the sky layer is present and nothing carries the
// retired v1 `rt-legacy` marker. 404.html is a standalone page (no sidebar) that still
// shares the sky, the theme boot script and the CSP meta.
test('Every page carries the Summit atmosphere and no legacy marker', async ({ page }) => {
  for (const pg of PAGES) {
    await page.goto(pg.path, { waitUntil: 'load' });
    expect(await page.locator('#rt-atmosphere').count(), pg.name + ' has the sky layer').toBe(1);
    expect(await page.locator('#rt-atmosphere > i.atm').count(), pg.name + ' has the eleven sky layers').toBe(11);
    expect(await page.locator('body.rt-legacy').count(), pg.name + ' has no rt-legacy').toBe(0);
    expect(await page.locator('html.light').count(), pg.name + ' boots light').toBe(1);
  }
  const problems = [];
  page.on('pageerror', err => problems.push('pageerror: ' + err.message));
  page.on('console', msg => { if (msg.type() === 'error') problems.push('console: ' + msg.text()); });
  page.on('response', res => { if (res.status() >= 400) problems.push('HTTP ' + res.status() + ' ' + res.url()); });
  await page.goto('/404.html', { waitUntil: 'load' });
  expect(await page.locator('#rt-atmosphere').count()).toBe(1);
  expect(await page.locator('#rt-atmosphere > i.atm').count()).toBe(11);
  expect(await page.locator('html.light').count()).toBe(1);
  const homeCsp = await (async () => { await page.goto('/', { waitUntil: 'load' }); return page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content'); })();
  await page.goto('/404.html', { waitUntil: 'load' });
  expect(await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')).toBe(homeCsp);
  expect(problems).toEqual([]);
});

test('Sidebar navigation links exist and point at surviving pages', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });
  await page.waitForSelector('#sidebar');
  const hrefs = await page.locator('#sidebar a.nav-item').evaluateAll(as => as.map(a => a.getAttribute('href')));
  expect(hrefs.length).toBeGreaterThan(3);
  for (const h of hrefs) {
    expect(h).not.toMatch(/dashboard|manage-team/);
  }
});

test('Theme preference is respected on load (the only localStorage key)', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });
  await page.waitForSelector('#sidebar');

  // No stored preference → light glass, the designed default.
  expect(await page.locator('html.light').count()).toBe(1);

  await page.evaluate(() => localStorage.setItem('rt-theme', 'light'));
  await page.reload({ waitUntil: 'load' });
  expect(await page.locator('html.light').count()).toBe(1);

  // 'dark' is the opt-in: the class comes off.
  await page.evaluate(() => localStorage.setItem('rt-theme', 'dark'));
  await page.reload({ waitUntil: 'load' });
  expect(await page.locator('html.light').count()).toBe(0);

  // The toggle puts it back and rewrites the preference; the sky plays a sunrise and
  // every sequence class is gone once it has finished.
  await page.waitForSelector('#sidebar');
  await page.evaluate(() => window.toggleTheme());
  expect(await page.locator('html.light').count()).toBe(1);
  expect(await page.locator('html.rt-sunrise').count()).toBe(1);
  expect(await page.evaluate(() => localStorage.getItem('rt-theme'))).toBe('light');
  await page.waitForFunction(() => !/rt-(sunset|sunrise|theming)/.test(document.documentElement.className), null, { timeout: 4000 });
  await page.evaluate(() => window.toggleTheme());
  expect(await page.locator('html.rt-sunset').count()).toBe(1);
  await page.waitForFunction(() => !/rt-(sunset|sunrise|theming)/.test(document.documentElement.className), null, { timeout: 4000 });
  expect(await page.locator('html.light').count()).toBe(0);

  const keys = await page.evaluate(() => Object.keys(localStorage));
  expect(keys).toEqual(['rt-theme']);
});

// Under reduced motion the theme simply swaps: no sunset/sunrise class, the moon and
// sun do not travel, and the mist does not drift.
test('Reduced motion: the theme toggles without the sky sequence', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto('/', { waitUntil: 'load' });
  await page.waitForSelector('#sidebar');
  await page.evaluate(() => window.toggleTheme());
  expect(await page.locator('html.light').count()).toBe(0);
  expect(await page.locator('html.rt-sunset, html.rt-sunrise').count()).toBe(0);
  expect(await page.locator('.atm-mist').evaluate(el => getComputedStyle(el).animationName)).toBe('none');
  await page.waitForTimeout(700);
  const moon = await page.locator('.atm-moon').evaluate(el => ({ o: getComputedStyle(el).opacity, t: getComputedStyle(el).transform }));
  expect(moon).toEqual({ o: '1', t: 'none' });
  await context.close();
});

// Drift runs only where few blurred surfaces sit over the sky; TeleOp never animates it.
test('Mist drifts on Home and is still on TeleOp', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });
  expect(await page.locator('.atm-mist').evaluate(el => getComputedStyle(el).animationName)).toBe('atmDrift');
  await page.goto('/pages/teleop.html', { waitUntil: 'load' });
  expect(await page.locator('.atm-mist').evaluate(el => getComputedStyle(el).animationName)).toBe('none');
});

test('Curriculum page shows the phase timeline', async ({ page }) => {
  await page.goto('/pages/curriculum.html', { waitUntil: 'load' });
  await page.waitForSelector('.tl-node');
  const text = await page.locator('body').textContent();
  expect(text).toContain('Phase 0');
  expect(text).toContain('Phase 1');
  expect(text).toContain('Make It Move');
});
