// Phase 0 quiz hardening: questions and options are shuffled per attempt, nothing is
// revealed until a pass, a failed attempt locks the retry for RT_QUIZ_RETRY_WAIT_MS, and
// reloading a finished attempt only redraws it (no extra attempt, no new log rows).
import { test, expect } from '@playwright/test';
import { readState, answerQuizCorrectly } from './helpers/state.js';

// Long enough to observe the disabled state reliably, short enough to wait out.
const WAIT_MS = 1500;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(ms => { window.RT_QUIZ_RETRY_WAIT_MS = ms; }, WAIT_MS);
  page.on('dialog', d => d.accept());
});

async function openQuiz(page) {
  await page.goto('/pages/curriculum.html', { waitUntil: 'load' });
  await page.waitForSelector('.quiz-question[data-q]');
}

const questionOrder = page => page.locator('.quiz-question[data-q]').evaluateAll(els => els.map(e => e.getAttribute('data-q')));

// Choose the first option as displayed for every question, in display order.
async function answerAllFirstDisplayed(page) {
  const qs = await questionOrder(page);
  for (const q of qs) {
    await page.locator(`.quiz-opt[data-q="${q}"]`).first().click();
  }
  await page.waitForSelector('#quiz-results.show', { timeout: 5000 });
  return qs;
}

test('a failed attempt reveals nothing and locks the retry; a retry reshuffles; a pass verifies', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await openQuiz(page);

  // Answering reveals nothing per question
  const firstQ = (await questionOrder(page))[0];
  await page.locator(`.quiz-opt[data-q="${firstQ}"]`).first().click();
  expect(await page.locator('.quiz-opt.quiz-correct, .quiz-opt.quiz-wrong').count()).toBe(0);
  expect(await page.locator('.quiz-explanation.show').count()).toBe(0);
  await expect(page.locator(`.quiz-opt[data-q="${firstQ}"].quiz-selected`)).toHaveCount(1);
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.quiz-question[data-q]');

  const order1 = await answerAllFirstDisplayed(page);
  const s1 = await readState(page);
  expect(s1.curriculum.phases.phase0.score).toBeLessThan(80);
  expect(s1.curriculum.phases.phase0.status).not.toBe('verified');
  expect(s1.curriculum.phases.phase0.attempts).toBe(1);
  expect(Object.values(s1.curriculum.phases.phase0.quizAnswers).every(v => Number.isInteger(v))).toBe(true);

  // Nothing revealed on a fail: no correct answers, no explanations; topics are named
  await expect(page.locator('#quiz-results')).toContainText('Missed:');
  expect(await page.locator('.quiz-opt.quiz-correct').count()).toBe(0);
  expect(await page.locator('.quiz-explanation.show').count()).toBe(0);

  // Retry is locked, then unlocks
  const retry = page.locator('#quiz-retry-btn');
  await expect(retry).toBeDisabled();
  await expect(page.locator('.quiz-retry-wait')).toContainText('retry in');
  await expect(retry).toBeEnabled({ timeout: WAIT_MS + 3000 });

  await retry.click();
  await page.waitForSelector('.quiz-question[data-q]');
  const order2 = await questionOrder(page);
  expect(order2.slice().sort()).toEqual(order1.slice().sort());
  expect(order2).not.toEqual(order1);
  expect(await page.evaluate(() => JSON.stringify(window.rtQuizOrder(1)) !== JSON.stringify(window.rtQuizOrder(2)))).toBe(true);

  await answerQuizCorrectly(page);
  await expect(page.locator('#quiz-results')).toContainText('Congratulations');
  expect(await page.locator('.quiz-opt.quiz-correct').count()).toBe(10);
  expect(await page.locator('.quiz-explanation.show').count()).toBe(10);
  const s2 = await readState(page);
  expect(s2.curriculum.phases.phase0.status).toBe('verified');
  expect(s2.curriculum.phases.phase0.passed).toBe(true);
  expect(s2.curriculum.phases.phase0.attempts).toBe(2);
  expect(errors).toEqual([]);
});

test('the key is rebalanced: all-first and all-second answers both fail', async ({ page }) => {
  await openQuiz(page);
  const key = await page.evaluate(() => window.QUIZ.map(q => q.correct));
  expect(key.filter(c => c === 0).length).toBeLessThan(8);
  expect(key.filter(c => c === 1).length).toBeLessThan(8);
  expect(await page.evaluate(() => window.QUIZ.every(q => typeof q.topic === 'string' && q.topic.length > 0))).toBe(true);
});

test('reloading after a failed attempt redraws it without counting or logging again', async ({ page }) => {
  await openQuiz(page);
  await answerAllFirstDisplayed(page);
  const before = await readState(page);
  const attemptsBefore = before.curriculum.phases.phase0.attempts;
  const rowsBefore = before.curriculum.attempts.length;
  expect(rowsBefore).toBe(10);

  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#quiz-results.show');
  await expect(page.locator('#quiz-results')).toContainText('Missed:');
  expect(await page.locator('.quiz-opt.quiz-selected').count()).toBe(10);
  expect(await page.locator('.quiz-opt.quiz-correct').count()).toBe(0);
  await page.waitForTimeout(300);
  const after = await readState(page);
  expect(after.curriculum.phases.phase0.attempts).toBe(attemptsBefore);
  expect(after.curriculum.attempts.length).toBe(rowsBefore);
  expect(after.curriculum.phases.phase0.lastAttempt).toBe(before.curriculum.phases.phase0.lastAttempt);
});

test('legacy boolean quiz answers restore to the right options', async ({ page }) => {
  await openQuiz(page);
  await page.evaluate(() => {
    RTStore.update(s => { s.curriculum.phases.phase0.status = 'in_progress'; s.curriculum.phases.phase0.quizAnswers = { q0: true, q1: false }; });
    window.loadCurriculumData();
  });
  const key = await page.evaluate(() => [window.QUIZ[0].correct, window.QUIZ[1].correct]);
  await expect(page.locator(`.quiz-opt[data-q="0"][data-opt="${key[0]}"]`)).toHaveClass(/quiz-selected/);
  const firstWrong = key[1] === 0 ? 1 : 0;
  await expect(page.locator(`.quiz-opt[data-q="1"][data-opt="${firstWrong}"]`)).toHaveClass(/quiz-selected/);
  expect(await page.locator('.quiz-opt.quiz-correct').count()).toBe(0);
});
