// Phase 4 gate (node --test): the rubric grader agrees with the hand-labeled fixture set
// (tests/fixtures/theory-samples.json) on at least 90% of answers, and every theory
// question in the curriculum carries a rubric or is explicitly graded: false.
// rubric-2: the adversarial samples (note starts with the attack name) carry the expected
// flag, no correct answer carries a flag, and the original hand-labeled set agrees 48/48.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadClassic(files) {
  const sandbox = { window: {}, console };
  sandbox.window.window = sandbox.window;
  for (const f of files) vm.runInNewContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
  return sandbox.window;
}

const win = loadClassic(['js/curriculum/lessons.js', 'js/grader.js']);
const fixtures = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/theory-samples.json'), 'utf8')).samples;

function phaseOf(sectionId) {
  for (const pid of Object.keys(win.PHASE_LESSONS)) {
    if (win.PHASE_LESSONS[pid].some(s => s.id === sectionId)) return pid;
  }
  return null;
}

test('every written-answer check has a rubric or is graded: false', () => {
  const problems = [];
  for (const pid of Object.keys(win.PHASE_LESSONS)) {
    for (const sec of win.PHASE_LESSONS[pid]) {
      if (!sec.check || sec.check.type !== 'written_answer') continue;
      const c = sec.check;
      if (c.graded === false) continue;
      if (!c.rubric || !Array.isArray(c.rubric.concepts) || c.rubric.concepts.length < 2) problems.push(pid + '/' + sec.id + ': missing rubric');
      else {
        c.rubric.concepts.forEach(k => { if (!k.id || !Array.isArray(k.phrases) || !k.phrases.length || !k.hint) problems.push(pid + '/' + sec.id + '/' + (k.id || '?') + ': concept needs id, phrases, hint'); });
      }
    }
  }
  assert.deepEqual(problems, []);
});

test('grader agrees with the hand-labeled fixture set on ≥ 90% of answers', () => {
  let agree = 0;
  const disagreements = [];
  const graded = [];
  for (const s of fixtures) {
    const pid = phaseOf(s.sectionId);
    assert.ok(pid, 'unknown section ' + s.sectionId);
    const r = win.gradeTheoryAnswer(pid, s.sectionId, '', s.answer);
    if (r.status === 'reflection') continue;               // reflections are not graded by design
    graded.push(s);
    assert.equal(r.status, 'graded', s.sectionId + ' returned ' + r.status);
    const expected = s.label === 'correct';
    if (r.passed === expected) agree++;
    else disagreements.push(`${s.sectionId} [${s.label}] → passed=${r.passed} score=${r.score} missed=${(r.missed || []).join(',')}${r.misconceptions.length ? ' dq=' + r.misconceptions[0].slice(0, 40) : ''}`);
  }
  const rate = agree / graded.length;
  console.log(`grader agreement: ${agree}/${graded.length} = ${(rate * 100).toFixed(1)}%`);
  if (disagreements.length) console.log('disagreements:\n  ' + disagreements.join('\n  '));
  assert.ok(rate >= 0.9, 'agreement below 90%');
});

test('score bands: correct answers score high, incorrect answers score low', () => {
  const bad = [];
  for (const s of fixtures) {
    const pid = phaseOf(s.sectionId);
    const r = win.gradeTheoryAnswer(pid, s.sectionId, '', s.answer);
    if (r.status !== 'graded') continue;
    if (s.label === 'correct' && r.score < 70) bad.push(`${s.sectionId} correct scored ${r.score}`);
    if (s.label === 'incorrect' && r.score > 50) bad.push(`${s.sectionId} incorrect scored ${r.score}`);
  }
  if (bad.length) console.log('band outliers:\n  ' + bad.join('\n  '));
  assert.ok(bad.length <= Math.ceil(fixtures.length * 0.1), 'too many score-band outliers');
});

test('grader primitives: normalization and fuzzy matching', () => {
  const G = win.RTGrader;
  assert.equal(G.normalize("The Robot's  heading—drifts (a lot)!"), "the robot's heading-drifts a lot");
  assert.equal(G.levenshtein('lighting', 'lightning'), 1);
  assert.ok(G.wordMatch('lighting', 'lightning'));     // 1 edit at ≥ 5 chars is a match
  assert.ok(G.wordMatch('lights', 'light'));            // plural/singular
  assert.ok(!G.wordMatch('lighting', 'light'));         // 3 edits is not
  assert.ok(!G.wordMatch('gym', 'gum'));                // short words must be exact
  const src = 'Ambient light differs between rooms. Set up the sensor.';
  const t = G.tokens(src);
  assert.ok(G.phraseMatches('ambient lights', G.normalize(src), t));
  assert.ok(!G.phraseMatches('battery voltage', G.normalize(src), t));
  assert.ok(G.phraseMatches('up', G.normalize(src), t));                 // whole-token match
  assert.ok(!G.phraseMatches('up', G.normalize('Please update it.'), G.tokens('Please update it.')));  // not inside "update"
});

const ATTACK = /^(hint-paste|label-paste|question-copy|learn-paste|keyword-dump|negated|phrase-dump):/;
const attackOf = s => { const m = ATTACK.exec(s.note || ''); return m ? m[1] : null; };

test('grader version is rubric-2 and every result carries flags[]', () => {
  assert.equal(win.RTGrader.VERSION, 'rubric-2');
  for (const s of fixtures) {
    const r = win.gradeTheoryAnswer(phaseOf(s.sectionId), s.sectionId, '', s.answer);
    assert.ok(Array.isArray(r.flags), s.sectionId + ' result has no flags array');
  }
});

test('adversarial samples carry the expected flag and fail', () => {
  const adv = fixtures.filter(attackOf);
  assert.equal(adv.length, 35);
  const problems = [];
  for (const s of adv) {
    const a = attackOf(s);
    const r = win.gradeTheoryAnswer(phaseOf(s.sectionId), s.sectionId, '', s.answer);
    let ok;
    if (a === 'keyword-dump' || a === 'phrase-dump') ok = r.flags.includes('keyword-dump') || r.flags.includes('copied');
    else if (a === 'negated') ok = r.flags.some(f => f.startsWith('negated:')) || r.passed === false;
    else ok = r.flags.includes('copied');
    if (!ok || r.passed !== false) problems.push(`${a} ${s.sectionId} → passed=${r.passed} flags=${JSON.stringify(r.flags)}`);
  }
  assert.deepEqual(problems, []);
});

test('no correct fixture carries a flag', () => {
  const flagged = [];
  for (const s of fixtures.filter(x => x.label === 'correct')) {
    const r = win.gradeTheoryAnswer(phaseOf(s.sectionId), s.sectionId, '', s.answer);
    if (r.flags.length) flagged.push(s.sectionId + ' ' + JSON.stringify(r.flags));
  }
  assert.deepEqual(flagged, []);
});

test('the original hand-labeled samples agree 48/48', () => {
  let agree = 0, n = 0;
  const off = [];
  for (const s of fixtures.filter(x => !attackOf(x))) {
    const r = win.gradeTheoryAnswer(phaseOf(s.sectionId), s.sectionId, '', s.answer);
    if (r.status !== 'graded') continue;
    n++;
    if (r.passed === (s.label === 'correct')) agree++;
    else off.push(`${s.sectionId} [${s.label}] passed=${r.passed} flags=${JSON.stringify(r.flags)}`);
  }
  assert.equal(n, 48);
  assert.deepEqual(off, []);
  assert.equal(agree, 48);
});

test('too-short, copy and keyword-dump rules', () => {
  const G = win.RTGrader;
  const rubric = win.PHASE_LESSONS.phase3.find(s => s.id === 'theory-sensor-physics').check.rubric;
  const short = G.gradeWithRubric('Lighting and distance change it so a fixed threshold fails.', rubric);
  assert.equal(short.passed, false);
  assert.equal(short.score, 0);
  assert.deepEqual([...short.flags], ['too-short']);
  assert.match(short.feedback, /at least 30 words/);
  // meta.minWords wins over the default
  const long = 'The ambient lighting in the gym differs from the workshop and the sensor sits at a different distance and angle from the element, so the raw number depends on conditions and one fixed threshold fails in some rooms while it works in others.';
  assert.equal(G.gradeWithRubric(long, rubric).passed, true);
  assert.deepEqual([...G.gradeWithRubric(long, rubric, { minWords: 60 }).flags], ['too-short']);
  // gradeWithRubric works without meta; hints alone are a copy
  const hints = rubric.concepts.map(c => c.hint).join(' ');
  const pasted = G.gradeWithRubric(hints, rubric);
  assert.ok(pasted.flags.includes('copied'));
  assert.equal(pasted.passed, false);
  assert.ok(pasted.score <= 30);
  assert.match(pasted.feedback, /own words/);
});

test('negation is opt-in per concept and respects phrases that contain a negator', () => {
  const G = win.RTGrader;
  const rubric = {
    threshold: 1,
    concepts: [
      { id: 'a', label: 'battery', negatable: true, hint: 'h', phrases: ['battery'] },
      { id: 'b', label: 'friction', hint: 'h', phrases: ['friction'] }
    ]
  };
  const pad = ' We tested the robot on the field several times this week and wrote down every result in the notebook so that the whole team could compare runs later.';
  const neg = G.gradeWithRubric('It is not the battery and not friction that matters here.' + pad, rubric);
  assert.ok(neg.flags.includes('negated:a'));
  assert.ok(!neg.flags.includes('negated:b'));        // not negatable → still a hit
  assert.deepEqual([...neg.hits], ['b']);
  assert.match(neg.feedback, /opposite of/);
  const pos = G.gradeWithRubric('The battery drains and friction varies between runs.' + pad, rubric);
  assert.deepEqual([...pos.flags], []);
  assert.equal(pos.passed, true);
  // a negator inside another matched phrase does not negate the next phrase
  const r2 = { threshold: 1, concepts: [
    { id: 'x', label: 'x', hint: 'h', phrases: ['does not change'] },
    { id: 'y', label: 'y', negatable: true, hint: 'h', phrases: ['ratio'] }
  ] };
  const ok2 = G.gradeWithRubric('The hue does not change ratio much when the room light gets dimmer.' + pad, r2);
  assert.deepEqual([...ok2.flags], []);
  assert.equal(ok2.passed, true);
});

test('text primitives: coverage, stopwordRatio, sentenceCount', () => {
  const G = win.RTGrader;
  const t = G.tokens('the quick brown fox jumps over the lazy dog');
  assert.equal(G.coverage(t, t, 4), 1);
  assert.equal(G.coverage(t, G.tokens('completely different words here and there'), 4), 0);
  assert.equal(G.coverage(G.tokens('one two'), t, 4), 0);                  // shorter than n
  assert.equal(G.coverage(G.tokens('a b c d e'), G.tokens('x a b c d y'), 4), 0.5);
  assert.equal(G.stopwordRatio(''), 0);
  assert.equal(G.stopwordRatio('the robot is fast'), 0.5);
  assert.equal(G.stopwordRatio('ambient lighting distance squared'), 0);
  assert.equal(G.sentenceCount('no break here'), 0);
  assert.equal(G.sentenceCount('One. Two! Three? x.y'), 3);
  assert.equal(G.sentenceCount('first line\nsecond line\n\nthird'), 2);
  assert.equal(G.sentenceCount('a: b; c.'), 3);
  assert.ok(G.STOPWORDS.length >= 100 && G.STOPWORDS.includes('the'));
  assert.ok(G.NEGATORS.includes('not') && G.NEGATORS.includes("doesn't"));
  assert.equal(G.stripHtml('<strong>A</strong> &amp; &lt;b&gt; &quot;q&quot; &#39;s').replace(/\s+/g, ' ').trim(), 'A & <b> "q" \'s');
});

test('the rubric\'s own phrase lists pasted back fail for every graded rubric', () => {
  const G = win.RTGrader;
  const passed = [];
  let n = 0;
  for (const pid of Object.keys(win.PHASE_LESSONS)) {
    for (const sec of win.PHASE_LESSONS[pid]) {
      if (!sec.check || !sec.check.rubric) continue;
      n++;
      const r = sec.check.rubric;
      const once = r.concepts.map(c => c.phrases.join(' ')).join(' ');
      for (const [kind, text] of [['concepts x2', once + ' ' + once],
                                   ['concepts + disqualifiers', once + ' ' + (r.disqualifiers || []).map(d => d.phrases.join(' ')).join(' ') + ' ' + once]]) {
        const res = win.gradeTheoryAnswer(pid, sec.id, '', text);
        if (res.passed !== false || !(res.flags.includes('keyword-dump') || res.flags.includes('copied'))) {
          passed.push(`${sec.id} (${kind}) passed=${res.passed} score=${res.score} flags=${JSON.stringify(res.flags)}`);
        }
      }
      assert.ok(G.rubricDensity(once + ' ' + once, r) >= G.DENSITY_DUMP, sec.id + ' phrase dump density below threshold');
    }
  }
  assert.equal(n, 12);
  assert.deepEqual(passed, []);
});

test('rubric density: correct answers stay well below the dump threshold', () => {
  const G = win.RTGrader;
  let max = 0;
  for (const s of fixtures.filter(x => x.label === 'correct')) {
    const sec = win.PHASE_LESSONS[phaseOf(s.sectionId)].find(x => x.id === s.sectionId);
    if (!sec.check.rubric) continue;
    max = Math.max(max, G.rubricDensity(s.answer, sec.check.rubric));
  }
  console.log(`max rubric density of correct fixtures: ${max.toFixed(2)} (threshold ${G.DENSITY_DUMP})`);
  assert.ok(max <= G.DENSITY_DUMP - 0.2, 'correct answers too close to the density threshold');
  assert.equal(G.rubricDensity('', { concepts: [] }), 0);
});
