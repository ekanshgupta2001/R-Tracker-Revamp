// Schema 4 + import validation (node --test). A 'verified' phase in an imported file must
// carry its proof — a passing code-check review from a known grader version (phase0: a
// passing quiz record) — or it is set back to in progress with a warning, for every
// schema version. Migration 4 stamps checkedWith from the newest passing review.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSchema } from './helpers/state.js';

const S = loadSchema();

function review(graderVersion, extra = {}) {
  return { ts: 1, code: '// x', result: Object.assign({ status: 'graded', grader: 'structural', graderVersion, passed: true, score: 82, summary: '', strengths: [], issues: [], requirements_met: [], next_steps: [], structural: true }, extra) };
}

function stateWith(schemaVersion, phases) {
  const s = S.createEmptyState();
  s.schemaVersion = schemaVersion;
  Object.assign(s.curriculum.phases, phases);
  return JSON.parse(JSON.stringify(s));
}

function verifiedPhase(id, extra = {}) {
  return Object.assign(S.createEmptyPhase(id), { status: 'verified', verifiedAt: 5, verifiedBy: 'auto', bestScore: 90 }, extra);
}

test('schema version is 4 and non-phase0 phases carry checkedWith', () => {
  assert.equal(S.SCHEMA_VERSION, 4);
  assert.equal(S.createEmptyPhase('phase1').checkedWith, null);
  assert.equal('checkedWith' in S.createEmptyPhase('phase0'), false);
});

for (const v of [3, 4]) {
  test(`a hand-edited verified phase without reviews is set to in progress (schema ${v})`, () => {
    const obj = stateWith(v, { phase1: verifiedPhase('phase1') });
    const r = S.validateImport(obj);
    assert.equal(r.ok, true, r.errors.join(' '));
    const ph = obj.curriculum.phases.phase1;
    assert.equal(ph.status, 'in_progress');
    assert.equal(ph.verifiedAt, null);
    assert.equal(ph.verifiedBy, null);
    assert.ok(r.warnings.includes('phase1: marked verified without a passing code check — set to in progress.'), r.warnings.join(' | '));
  });
}

test('a failing or unknown-version review is not proof', () => {
  const obj = stateWith(4, {
    phase1: verifiedPhase('phase1', { reviews: [review('structural-1/rules-2', { passed: false, score: 50 })] }),
    phase2: verifiedPhase('phase2', { reviews: [review('pattern-1')] }),
    phase3: verifiedPhase('phase3', { reviews: [review('structural-1/rules-2', { score: 70 })] })
  });
  const r = S.validateImport(obj);
  assert.equal(r.ok, true);
  for (const pid of ['phase1', 'phase2', 'phase3']) assert.equal(obj.curriculum.phases[pid].status, 'in_progress', pid);
});

test('a verified phase with a passing structural-1/rules-2 review is kept', () => {
  const obj = stateWith(3, { phase1: verifiedPhase('phase1', { reviews: [review('structural-1/rules-2')] }) });
  const r = S.validateImport(obj);
  assert.equal(r.ok, true);
  assert.equal(obj.curriculum.phases.phase1.status, 'verified');
  assert.equal(r.warnings.length, 0, r.warnings.join(' | '));
});

test('phase0 verified needs a passing quiz record', () => {
  const bad = stateWith(4, { phase0: Object.assign(S.createEmptyPhase('phase0'), { status: 'verified', passed: true, score: 60, verifiedAt: 5, verifiedBy: 'auto' }) });
  const r = S.validateImport(bad);
  assert.equal(r.ok, true);
  assert.equal(bad.curriculum.phases.phase0.status, 'in_progress');
  assert.equal(bad.curriculum.phases.phase0.verifiedAt, null);
  assert.ok(r.warnings.some(w => w.startsWith('phase0: marked verified')), r.warnings.join(' | '));

  const notPassed = stateWith(4, { phase0: Object.assign(S.createEmptyPhase('phase0'), { status: 'verified', passed: false, score: 90 }) });
  S.validateImport(notPassed);
  assert.equal(notPassed.curriculum.phases.phase0.status, 'in_progress');

  const good = stateWith(4, { phase0: Object.assign(S.createEmptyPhase('phase0'), { status: 'verified', passed: true, score: 90 }) });
  const rg = S.validateImport(good);
  assert.equal(good.curriculum.phases.phase0.status, 'verified');
  assert.equal(rg.warnings.length, 0);
});

test('quizAnswers accept booleans and option indices 0–3; anything else is dropped with a warning', () => {
  const obj = stateWith(4, { phase0: Object.assign(S.createEmptyPhase('phase0'), { status: 'in_progress', quizAnswers: { q0: true, q1: false, q2: 3, q3: 0, q4: 7, q5: 'b', q6: 1.5 } }) });
  const r = S.validateImport(obj);
  assert.equal(r.ok, true);
  assert.deepEqual(obj.curriculum.phases.phase0.quizAnswers, { q0: true, q1: false, q2: 3, q3: 0 });
  assert.equal(r.warnings.filter(w => /quiz answer/.test(w)).length, 3, r.warnings.join(' | '));
});

test('a review whose result is not an object (or has a bad status/score) is dropped with a warning', () => {
  const obj = stateWith(4, { phase1: Object.assign(S.createEmptyPhase('phase1'), { status: 'in_progress', reviews: [
    { ts: 1, code: 'x', result: 'passed' },
    { ts: 2, code: 'x', result: { status: 'excellent', score: 80 } },
    { ts: 3, code: 'x', result: { status: 'graded', score: 400 } },
    'not a review',
    review('structural-1/rules-2', { passed: false, score: 40 }),
    { ts: 4, code: 'x', result: { status: 'reflection', score: null } }
  ] }) });
  const r = S.validateImport(obj);
  assert.equal(r.ok, true);
  assert.equal(obj.curriculum.phases.phase1.reviews.length, 2);
  assert.ok(r.warnings.some(w => /phase1: 4 invalid code-check review/.test(w)), r.warnings.join(' | '));
});

test('checkedWith must be a string or null', () => {
  const obj = stateWith(4, { phase1: Object.assign(S.createEmptyPhase('phase1'), { status: 'in_progress', checkedWith: 42 }) });
  const r = S.validateImport(obj);
  assert.equal(r.ok, true);
  assert.equal(obj.curriculum.phases.phase1.checkedWith, null);
  assert.ok(r.warnings.some(w => /checkedWith/.test(w)));
});

test('migration 4 stamps checkedWith from the newest passing review', () => {
  const obj = stateWith(3, {
    phase1: verifiedPhase('phase1', { reviews: [review('structural-1/rules-1'), review('structural-1/rules-2'), review('structural-2/rules-3', { passed: false, score: 30 })] }),
    phase2: Object.assign(S.createEmptyPhase('phase2'), { status: 'in_progress', reviews: [review('structural-1/rules-2', { passed: false, score: 30 })] }),
    phase3: Object.assign(S.createEmptyPhase('phase3'), { status: 'in_progress', reviews: 'garbage' }),
    phase4: 'not an object'
  });
  delete obj.curriculum.phases.phase1.checkedWith;
  const out = S.migrate(obj);
  assert.equal(out.schemaVersion, 4);
  assert.equal(out.curriculum.phases.phase1.checkedWith, 'structural-1/rules-2');
  assert.equal(out.curriculum.phases.phase2.checkedWith, null);
  assert.equal(out.curriculum.phases.phase3.checkedWith, null);
  assert.equal(out.curriculum.phases.phase4, 'not an object');
  assert.equal('checkedWith' in out.curriculum.phases.phase0, false);
});

test('isPassingReview matches the documented rule', () => {
  assert.equal(S.isPassingReview(review('structural-2/rules-3')), true);
  assert.equal(S.isPassingReview(review('structural-2/rules-3', { score: 74 })), false);
  assert.equal(S.isPassingReview(review('structural-2/rules-3', { status: 'reflection' })), false);
  assert.equal(S.isPassingReview(review('structural-2')), false);
  assert.equal(S.isPassingReview(review(null)), false);
  assert.equal(S.isPassingReview(null), false);
  assert.equal(S.isPassingReview({ result: 'x' }), false);
});
