// Home: greeting, the TeleOp hero (next level, its route, progress), the curriculum
// stepper, the three tool cards, the day/night button, and the TeleOp #level-N link.
import { test, expect } from '@playwright/test';
import { makeYearState, seedState } from './helpers/state.js';

test.beforeEach(async ({ page }) => {
  page.on('dialog', d => d.accept());
});

test('fresh tab: greeting without a name, Level 1 hero, phase 0 current, three tools', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/', { waitUntil: 'load' });

  await expect(page.locator('#home-greeting-title')).toHaveText(/^Good (morning|afternoon|evening)\.$/);
  await expect(page.locator('#hero-level-pill')).toHaveText('Level 1 / 12');
  await expect(page.locator('#hero-level-name')).toHaveText('Straight Shot');
  await expect(page.locator('#hero-cta')).toHaveAttribute('href', 'pages/teleop.html#level-1');
  await expect(page.locator('#hero-cta-text')).toHaveText('Start Level 1');
  await expect(page.locator('#hero-progress')).toHaveText('0 / 12');
  expect(await page.locator('#hero-route').getAttribute('points')).toMatch(/^[\d.]+,[\d.]+ [\d.]+,[\d.]+$/);

  await expect(page.locator('#home-stepper .step')).toHaveCount(9);
  await expect(page.locator('#home-stepper .step-current')).toHaveCount(1);
  await expect(page.locator('#home-stepper .step').nth(0)).toHaveClass(/step-current/);
  await expect(page.locator('#home-curr-current')).toHaveText('Phase 0 • Java Readiness');

  for (const [id, href] of [['tile-pathplanner', 'pages/pathplanner.html'], ['tile-strategy', 'pages/strategy.html'], ['tile-report', 'pages/report.html']]) {
    await expect(page.locator('#' + id)).toHaveAttribute('href', href);
  }
  await expect(page.locator('#tile-report-status')).toHaveText('Drive a level to get a rating and track your progress.');
  expect(errors).toEqual([]);
});

test('seeded progress: the next level, par time, stepper and rating', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });
  const state = makeYearState();
  state.profile.displayName = 'Sam';
  await seedState(page, state);
  await page.evaluate(() => window.renderHome());

  await expect(page.locator('#home-greeting-title')).toHaveText(/^Good (morning|afternoon|evening), Sam\.$/);
  // levels 1–9 carry stars, so level 10 is next
  await expect(page.locator('#hero-level-pill')).toHaveText('Level 10 / 12');
  await expect(page.locator('#hero-level-name')).toHaveText('Speed Demon');
  await expect(page.locator('#hero-cta-text')).toHaveText('Continue Level 10');
  await expect(page.locator('#hero-cta')).toHaveAttribute('href', 'pages/teleop.html#level-10');
  await expect(page.locator('#hero-progress')).toHaveText('9 / 12');
  const par = await page.evaluate(() => (window.RT_LEVEL_TABLE.get(10).parTimeMs / 1000).toFixed(1));
  await expect(page.locator('#hero-par')).toHaveText('≈ ' + par + ' s');

  await expect(page.locator('#home-stepper .step-done')).toHaveCount(3);
  await expect(page.locator('#home-stepper .step').nth(3)).toHaveClass(/step-current/);
  await expect(page.locator('#home-curr-current')).toHaveText('Phase 3 • Make It Smart');
  await expect(page.locator('#tile-report-status')).toContainText('Rating 74 · grade C');
});

test('untrusted state values never reach the DOM as markup', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });
  await page.evaluate(() => {
    window.RTStore.update(function (s) {
      s.profile.displayName = '<img src=x onerror="window.__pwned=1">';
      s.curriculum.phases.phase0.status = '<b>verified</b>';
      s.driver.stats.grade = '<b>S</b>';
      s.driver.runs.push({ levelId: 1, completed: true, timeMs: 1800, pathAccuracy: 90, collisions: 0 });
    }, { silent: true });
    window.renderHome();
  });
  expect(await page.locator('.home-content img, .home-content b').count()).toBe(0);
  expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
  await expect(page.locator('#home-greeting-title')).toContainText('<img');       // shown as text
  await expect(page.locator('#home-stepper .step').nth(0)).toHaveClass(/step-current/);   // bad status → locked
  await expect(page.locator('#tile-report-status')).toHaveText('Drive a level to get a rating and track your progress.');
});

test('the day/night button toggles the theme and relabels itself', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });
  await page.waitForSelector('#sidebar');
  const btn = page.locator('#home-theme-btn');
  await expect(btn).toHaveAttribute('aria-label', 'Switch to night');
  await btn.click();
  expect(await page.locator('html.light').count()).toBe(0);
  await expect(btn).toHaveAttribute('aria-label', 'Switch to day');
  await expect(page.locator('#home-theme-btn .ic-sun')).toBeVisible();
  await expect(page.locator('#home-theme-btn .ic-moon')).toBeHidden();
});

test('no horizontal scroll on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/', { waitUntil: 'load' });
  const overflow = await page.evaluate(() => {
    const w = document.querySelector('.main-wrap');
    return { doc: document.documentElement.scrollWidth - window.innerWidth, main: w.scrollWidth - w.clientWidth };
  });
  expect(overflow.doc).toBeLessThanOrEqual(0);
  expect(overflow.main).toBeLessThanOrEqual(0);
});

// Home scales with the window (one fluid unit, css/home.css): on laptop and desktop
// sizes everything down to the tool cards is on screen with no scrolling.
test('the whole page fits the window on laptop and desktop sizes', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });
  await seedState(page, makeYearState());
  for (const [w, h] of [[1280, 720], [1366, 768], [1440, 900], [1920, 1080], [2560, 1440]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => document.documentElement.getAttribute('data-intro') === 'done');
    const fit = await page.evaluate(() => {
      const wrap = document.querySelector('.main-wrap');
      const last = document.querySelector('.tool-row').getBoundingClientRect();
      return { scroll: wrap.scrollHeight - wrap.clientHeight, bottom: last.bottom, vh: window.innerHeight };
    });
    expect(fit.scroll, `${w}x${h} scrolls`).toBeLessThanOrEqual(0);
    expect(fit.bottom, `${w}x${h} tool cards cut off`).toBeLessThanOrEqual(fit.vh);
  }
});

test('a fresh tab fits at 1440×900 with the welcome card beside the greeting', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/', { waitUntil: 'load' });
  await expect(page.locator('#rt-first-run')).toBeVisible();
  await page.waitForFunction(() => document.documentElement.getAttribute('data-intro') === 'done');
  const bottom = await page.evaluate(() => document.querySelector('.tool-row').getBoundingClientRect().bottom);
  expect(bottom).toBeLessThanOrEqual(900);
  // the welcome card sits beside the greeting, level with it
  const r = await page.evaluate(() => {
    const h = document.getElementById('home-greeting-title').getBoundingClientRect();
    const c = document.getElementById('rt-first-run').getBoundingClientRect();
    return { hTop: h.top, hBottom: h.bottom, hRight: h.right, cTop: c.top, cLeft: c.left };
  });
  expect(r.cLeft).toBeGreaterThan(r.hRight);
  expect(r.cTop).toBeLessThan(r.hBottom);
});

test('teleop.html#level-1 opens level 1 in levels mode and clears the hash', async ({ page }) => {
  await page.goto('/pages/teleop.html#level-1', { waitUntil: 'load' });
  await page.waitForFunction(() => typeof lvl !== 'undefined' && lvl.id === 1);
  expect(await page.evaluate(() => appMode)).toBe('levels');
  expect(await page.evaluate(() => window.location.hash)).toBe('');
  // it waits on the ready card (goal + controls) instead of starting the clock
  await expect(page.locator('#ready-card')).toBeVisible();
  expect(await page.evaluate(() => lvl.phase)).toBe('ready');
  // a locked level is ignored (load another page first: a hash-only change is not a reload)
  await page.goto('/', { waitUntil: 'load' });
  await page.goto('/pages/teleop.html#level-9', { waitUntil: 'load' });
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => appMode)).toBe('freedrive');
});

// Motion (js/home-motion.js, GSAP vendored in vendor/gsap/): the entrance ends on the
// natural layout, the pointer drives the sky parallax, and reduced motion gets none of it.
test('the entrance settles on the natural layout and the pointer drives the parallax', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });
  await page.waitForFunction(() => document.documentElement.getAttribute('data-intro') === 'done', null, { timeout: 5000 });
  const settled = await page.evaluate(() => ['#home-hero-teleop', '#home-curriculum', '.tool-card', '.home-greeting p'].map(sel => {
    const cs = getComputedStyle(document.querySelector(sel));
    return { sel, opacity: cs.opacity, transform: cs.transform };
  }));
  for (const s of settled) {
    expect(s.opacity, s.sel).toBe('1');
    expect(['none', 'matrix(1, 0, 0, 1, 0, 0)'], s.sel).toContain(s.transform);
  }
  // the headline was split for the reveal and restored afterwards
  expect(await page.locator('#home-greeting-title div, #home-greeting-title span').count()).toBe(0);
  await page.mouse.move(20, 20);
  await page.waitForFunction(() => parseFloat(getComputedStyle(document.getElementById('rt-atmosphere')).getPropertyValue('--px')) < -0.3);
  await expect(page.locator('#rt-atmosphere')).toHaveClass(/rt-parallax/);
});

test('reduced motion: no entrance, no parallax, nothing hidden', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto('/', { waitUntil: 'load' });
  expect(await page.locator('html.rt-intro').count()).toBe(0);
  await page.waitForFunction(() => document.documentElement.getAttribute('data-intro') === 'done');
  await page.waitForTimeout(300);
  expect(await page.locator('#rt-atmosphere.rt-parallax').count()).toBe(0);
  expect(await page.locator('#home-hero-teleop').evaluate(el => getComputedStyle(el).opacity)).toBe('1');
  expect(await page.locator('#home-hero-teleop').getAttribute('style')).toBeNull();
  await context.close();
});
