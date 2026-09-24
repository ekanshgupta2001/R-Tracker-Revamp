// Phase 4 gate (Playwright): answer a theory question → rubric feedback → section completes →
// mastery updates → report reflects it. Also: a weak answer fails honestly and a reflection
// question is stored without a score.
// rubric-2 / MC hardening: a wrong multiple-choice answer locks the question and re-shuffles
// it, pasted hints fail with an integrity flag, and resubmitting a passed answer is logged
// ungraded. The lock and the theory cooldown are shortened through the test overrides.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unlockPhase, readState } from './helpers/state.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const samples = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/theory-samples.json'), 'utf8')).samples;
const pick = (sectionId, label) => samples.find(s => s.sectionId === sectionId && s.label === label).answer;

test.beforeEach(async ({ page }) => {
  page.on('dialog', d => d.accept());
  await page.addInitScript(() => { window.RT_MC_LOCK_MS = 300; window.RT_THEORY_COOLDOWN_MS = 0; });
});

test('a good theory answer is graded, completes the section, and feeds mastery + report', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/pages/curriculum.html', { waitUntil: 'load' });
  await page.waitForSelector('.tl-node');
  await unlockPhase(page, 'phase3');
  await page.click('.tl-node[data-phase="phase3"]');
  await page.click('.curr-action-btn.btn-start');

  const sid = 'theory-sensor-physics';
  await page.fill('#les-written-' + sid, pick(sid, 'correct'));
  await page.click('#les-wsubmit-' + sid);
  const fb = page.locator('#les-wfeedback-' + sid);
  await expect(fb).toContainText('Understanding Confirmed');
  await expect(fb).toContainText(/\d+\/100/);

  await page.waitForFunction(sid => window.RTStore.get().curriculum.phases.phase3.lessonProgress.includes(sid), sid, { timeout: 5000 });
  const s = await readState(page);
  const ta = s.curriculum.phases.phase3.theoryAnswers[sid];
  expect(ta.status).toBe('graded');
  expect(ta.passed).toBe(true);
  expect(ta.score).toBeGreaterThanOrEqual(70);
  const att = s.curriculum.attempts.filter(a => a.kind === 'theory' && a.sectionId === sid);
  expect(att.length).toBe(1);
  expect(att[0].graded).toBe(true);
  expect(att[0].correct).toBe(true);

  // The next section unlocked (sequential lessons)
  await expect(page.locator('#les-sec-theory-hsv-physics')).not.toHaveClass(/locked/);

  // Report shows the module mastery
  await page.goto('/pages/report.html', { waitUntil: 'load' });
  await page.waitForFunction(() => window.RTReport && !document.querySelector('#curriculum-content .skeleton'));
  const after = await readState(page);
  expect(after.bkt.mastery.phase3.modules[sid]).toBeGreaterThan(0.5);
  await expect(page.locator('#curriculum-content')).toContainText('What Sensors Actually Measure');
  expect(errors).toEqual([]);
});

test('a weak theory answer fails with named missing concepts and does not complete the section', async ({ page }) => {
  await page.goto('/pages/curriculum.html', { waitUntil: 'load' });
  await page.waitForSelector('.tl-node');
  await unlockPhase(page, 'phase3');
  await page.click('.tl-node[data-phase="phase3"]');
  await page.click('.curr-action-btn.btn-start');

  const sid = 'theory-sensor-physics';
  // rubric-2 needs 30 words before the answer can be submitted; the fixture's weak answer is shorter.
  await page.fill('#les-written-' + sid, pick(sid, 'incorrect') + ' That is all there is to it, the room and the lights have nothing to do with the number the sensor reports.');
  await page.click('#les-wsubmit-' + sid);
  const fb = page.locator('#les-wfeedback-' + sid);
  await expect(fb).toContainText('Keep Thinking');
  await expect(fb).not.toContainText('Understanding Confirmed');
  const s = await readState(page);
  expect(s.curriculum.phases.phase3.theoryAnswers[sid].passed).toBe(false);
  expect(s.curriculum.phases.phase3.lessonProgress).not.toContain(sid);
  const att = s.curriculum.attempts.filter(a => a.kind === 'theory' && a.sectionId === sid)[0];
  expect(att.graded).toBe(true);
  expect(att.correct).toBe(false);

  // Revise & resubmit with a good answer passes
  await page.click('#les-wfeedback-' + sid + ' .les-written-revise');
  await page.fill('#les-written-' + sid, pick(sid, 'correct'));
  await page.click('#les-wsubmit-' + sid);
  await expect(fb).toContainText('Understanding Confirmed');
});

test('a reflection question is saved for the mentor without a score and completes the section', async ({ page }) => {
  await page.goto('/pages/curriculum.html', { waitUntil: 'load' });
  await page.waitForSelector('.tl-node');
  const reflection = await page.evaluate(() => {
    for (const pid of Object.keys(window.PHASE_LESSONS)) {
      const sec = window.PHASE_LESSONS[pid].find(s => s.check && s.check.type === 'written_answer' && s.check.graded === false);
      if (sec) return { pid, sid: sec.id, idx: window.PHASE_LESSONS[pid].indexOf(sec) };
    }
    return null;
  });
  expect(reflection, 'expected at least one graded:false reflection question').not.toBeNull();
  await unlockPhase(page, reflection.pid);
  // Complete everything before the reflection so it is the active section
  await page.evaluate(({ pid, idx }) => {
    window.RTStore.update(s => {
      const ph = s.curriculum.phases[pid] || (s.curriculum.phases[pid] = window.RTSchema.createEmptyPhase(pid));
      ph.status = 'in_progress';
      ph.lessonProgress = window.PHASE_LESSONS[pid].slice(0, idx).map(x => x.id);
    });
    window.loadCurriculumData();
  }, reflection);
  await page.click('.tl-node[data-phase="' + reflection.pid + '"]');
  await page.fill('#les-written-' + reflection.sid, 'One hypothesis is the wiring, tested by swapping the port. Another is the configuration name, tested by reading the Driver Hub config. A third is the gamepad not being paired, tested by pressing Start+A. Each is a different layer of the robot.');
  await page.click('#les-wsubmit-' + reflection.sid);
  await expect(page.locator('#les-wfeedback-' + reflection.sid)).toContainText(/mentor/i);
  await page.waitForFunction(({ pid, sid }) => window.RTStore.get().curriculum.phases[pid].lessonProgress.includes(sid), reflection, { timeout: 5000 });
  const s = await readState(page);
  const ta = s.curriculum.phases[reflection.pid].theoryAnswers[reflection.sid];
  expect(ta.status).toBe('reflection');
  expect(ta.score).toBeNull();
  const att = s.curriculum.attempts.filter(a => a.sectionId === reflection.sid)[0];
  expect(att.graded).toBe(false);
});

test('a wrong multiple-choice answer locks the question, then re-shuffles it', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/pages/curriculum.html', { waitUntil: 'load' });
  await page.waitForSelector('.tl-node');
  await unlockPhase(page, 'phase1');
  await page.click('.tl-node[data-phase="phase1"]');
  await page.click('.curr-action-btn.btn-start');

  const { sid, correct } = await page.evaluate(() => {
    const sec = window.PHASE_LESSONS.phase1[0];
    return { sid: sec.id, correct: sec.check.options.findIndex(o => o.correct) };
  });
  const order = () => page.locator('#les-opts-' + sid + ' .les-opt').evaluateAll(els => els.map(e => Number(e.getAttribute('data-opt'))));
  const mcAttempts = async () => (await readState(page)).curriculum.attempts.filter(a => a.kind === 'mc' && a.sectionId === sid);

  const before = await order();
  expect(before.slice().sort()).toEqual([0, 1, 2, 3]);
  const pos = await page.locator('#les-opts-' + sid + ' .les-opt').evaluateAll(els => els.map(e => Number(e.getAttribute('data-pos'))));
  expect(pos).toEqual([0, 1, 2, 3]);
  const wrong = before.find(i => i !== correct);
  await page.click('#les-opts-' + sid + ' .les-opt[data-opt="' + wrong + '"]');
  const check = page.locator('#les-check-' + sid);
  await expect(check).toHaveClass(/les-check-locked/);
  await expect(page.locator('#les-check-' + sid + ' .les-lock-note')).toContainText('try again');
  expect((await mcAttempts()).length).toBe(1);

  // A click during the lock is ignored (dispatched directly: the options take no pointer events)
  await page.locator('#les-opts-' + sid + ' .les-opt[data-opt="' + correct + '"]').dispatchEvent('click');
  expect((await mcAttempts()).length).toBe(1);
  await expect(page.locator('#les-opts-' + sid + ' .les-correct')).toHaveCount(0);

  // After the lock the options come back in a new order and the note is gone
  await expect(check).not.toHaveClass(/les-check-locked/, { timeout: 5000 });
  await expect(page.locator('#les-check-' + sid + ' .les-lock-note')).toHaveCount(0);
  const after = await order();
  expect(after).not.toEqual(before);
  expect(after).toEqual(await page.evaluate(({ sid }) => window.RTLessons.mcOrder('phase1', sid, 4, 1), { sid }));

  await page.click('#les-opts-' + sid + ' .les-opt[data-opt="' + correct + '"]');
  await page.waitForFunction(sid => window.RTStore.get().curriculum.phases.phase1.lessonProgress.includes(sid), sid, { timeout: 5000 });
  const att = await mcAttempts();
  expect(att.map(a => a.correct)).toEqual([false, true]);
  expect(errors).toEqual([]);
});

test('pasting the rubric hints fails with an own-words flag', async ({ page }) => {
  await page.goto('/pages/curriculum.html', { waitUntil: 'load' });
  await page.waitForSelector('.tl-node');
  await unlockPhase(page, 'phase3');
  await page.click('.tl-node[data-phase="phase3"]');
  await page.click('.curr-action-btn.btn-start');

  const sid = 'theory-sensor-physics';
  const hints = samples.find(s => s.sectionId === sid && /^hint-paste:/.test(s.note)).answer;
  await page.fill('#les-written-' + sid, hints);
  await expect(page.locator('#les-wcount-' + sid)).toContainText('words minimum');
  await page.click('#les-wsubmit-' + sid);
  const fb = page.locator('#les-wfeedback-' + sid);
  await expect(fb).toContainText('Keep Thinking');
  await expect(fb.locator('.theory-flag')).toContainText('Own words needed');
  const s = await readState(page);
  expect(s.curriculum.phases.phase3.theoryAnswers[sid].passed).toBe(false);
  expect(s.curriculum.phases.phase3.lessonProgress).not.toContain(sid);
});

test('resubmitting a passed theory answer is logged ungraded', async ({ page }) => {
  await page.goto('/pages/curriculum.html', { waitUntil: 'load' });
  await page.waitForSelector('.tl-node');
  await unlockPhase(page, 'phase3');
  await page.click('.tl-node[data-phase="phase3"]');
  await page.click('.curr-action-btn.btn-start');

  const sid = 'theory-sensor-physics';
  await page.fill('#les-written-' + sid, pick(sid, 'correct'));
  await page.click('#les-wsubmit-' + sid);
  await expect(page.locator('#les-wfeedback-' + sid)).toContainText('Understanding Confirmed');
  await page.waitForFunction(sid => window.RTStore.get().curriculum.phases.phase3.lessonProgress.includes(sid), sid, { timeout: 5000 });

  // Re-render: the completed section restores its answer with a "Resubmit answer" link
  await page.evaluate(() => window.loadCurriculumData());
  await page.click('.tl-node[data-phase="phase3"]');
  await page.click('#les-sec-' + sid + ' .les-sec-header');
  await page.click('#les-wfeedback-' + sid + ' .les-written-resubmit-link');
  await page.fill('#les-written-' + sid, samples.filter(s => s.sectionId === sid && s.label === 'correct')[1].answer);
  await page.click('#les-wsubmit-' + sid);
  await page.waitForFunction(sid => window.RTStore.get().curriculum.attempts.filter(a => a.kind === 'theory' && a.sectionId === sid).length === 2, sid, { timeout: 5000 });

  const s = await readState(page);
  const att = s.curriculum.attempts.filter(a => a.kind === 'theory' && a.sectionId === sid);
  expect(att[0].graded).toBe(true);
  expect(att[0].correct).toBe(true);
  expect(att[1].graded).toBe(false);
  expect(att[1].correct).toBeNull();
  expect(att[1].score).toBeNull();
  const ta = s.curriculum.phases.phase3.theoryAnswers[sid];
  expect(ta.passed).toBe(true);
  expect(ta.attempts).toBe(2);
  expect(ta.history.length).toBe(2);
});
