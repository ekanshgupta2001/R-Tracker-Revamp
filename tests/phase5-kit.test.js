// Phase 5 "Debug Under Pressure" kit (node --test): the seeded BuzzAuto program, its five
// three-state bug checks (broken / changed / fixed) and the similarity score. Part 1 runs the
// kit against the structure parser alone; Part 2 runs the full phase5 check once the
// structural-2 checker has landed. The checks only read the parsed structure of the code.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLES = path.join(ROOT, 'tests/fixtures/code-samples');

function loadClassic(files) {
  const sandbox = { window: {}, console };
  sandbox.window.window = sandbox.window;
  for (const f of files) vm.runInNewContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
  return sandbox.window;
}
const read = f => fs.readFileSync(path.join(SAMPLES, f), 'utf8');

const OLD_PEDRO = /pathBuilder|setLinearHeadingInterpolation|setConstantHeadingInterpolation|BezierLine|PathChain|followPath|setStartingPose|getPose\(|getHeading\(/;
const OLD_COMMANDS = /SequentialCommandGroup|ParallelCommandGroup|CommandBase|SubsystemBase|CommandScheduler/;
const BUG_IDS = ['double-update', 'inverted-busy', 'kp-catastrophe', 'silent-return', 'no-telemetry-update'];

// ── Part 1: the kit on the parser alone ──────────────────────────────────────
const win = loadClassic(['js/java-structure.js', 'js/curriculum/phase5-kit.js']);
const J = win.RTJavaStructure;
const KIT = win.RT_PHASE5_KIT;

// The four frozen helpers the kit may use, implemented directly over the model.
function stubH(model) {
  return {
    ev(x) {
      const line = typeof x === 'number' ? x : x && x.line;
      return { line, text: String(model.lineText(line) || '').trim().slice(0, 100) };
    },
    opMode() {
      return model.types.find(t => /^(Linear)?OpMode$/.test(t.extends || '') &&
        t.methods.some(m => m.name === 'runOpMode' || m.name === 'loop')) || null;
    },
    loopBodies() { return model.loopBodies(); },
    callsIn(block, hops) { return model.callsIn(block, hops); }
  };
}
function makeCtx(src) {
  const model = J.parse(src);
  const H = stubH(model);
  return { phaseId: 'phase5', src, model, comments: model.comments, refs: { snippets: [], kit: KIT }, H };
}
function states(src) {
  const ctx = makeCtx(src);
  const out = {};
  for (const b of KIT.bugs) out[b.id] = b.check(ctx, ctx.H);
  return out;
}
function edit(src, from, to) {
  assert.ok(src.includes(from), 'edit anchor missing: ' + from);
  return src.split(from).join(to);
}

test('kit shape and export', () => {
  assert.equal(KIT.id, 'debug-under-pressure');
  assert.equal(KIT.version, 'kit-1');
  assert.equal(typeof KIT.title, 'string');
  assert.equal(typeof KIT.source, 'string');
  assert.equal(typeof KIT.similarity, 'function');
  assert.deepEqual([...KIT.bugs.map(b => b.id)], BUG_IDS);
  const lessons = { 'double-update': 'bug-double-update', 'inverted-busy': 'theory-bug-taxonomy', 'kp-catastrophe': 'bug-kp-catastrophe',
    'silent-return': 'bug-silent-return', 'no-telemetry-update': 'observability' };
  for (const b of KIT.bugs) {
    for (const k of ['id', 'title', 'lessonId', 'symptom', 'hint']) assert.ok(typeof b[k] === 'string' && b[k].length > 3, b.id + '.' + k);
    assert.equal(typeof b.check, 'function', b.id + '.check');
    assert.equal(b.lessonId, lessons[b.id]);
  }
});

test('kit source is a clean Pedro 3 / Ivy program', () => {
  const src = KIT.source;
  assert.doesNotMatch(src, OLD_PEDRO);
  assert.doesNotMatch(src, OLD_COMMANDS);
  assert.doesNotMatch(src, /\bBUG\b|\bFIX(ED)?\b/i, 'no bug markers in the kit');
  const m = J.parse(src);
  assert.equal(m.ok, true);
  assert.equal(m.diagnostics.length, 0);
  assert.equal(m.statements.filter(s => s.kind === 'junk').length, 0);
  assert.ok(m.typeNamed('BuzzAuto') && m.typeNamed('Lift') && m.typeNamed('Robot') && m.typeNamed('Intake'));
  const lines = src.split('\n').length;
  assert.ok(lines > 100 && lines < 180, 'kit length ' + lines);
});

test('phase5-bad.java is the kit verbatim after its fixture header', () => {
  const bad = read('phase5-bad.java');
  assert.match(bad, /^\/\/ fixture: /);
  assert.equal(bad.slice(bad.indexOf('\n') + 1), KIT.source);
});

test('every phase5 fixture opens with a fixture header', () => {
  for (const f of fs.readdirSync(SAMPLES).filter(n => /^phase5-/.test(n))) assert.match(read(f), /^\/\/ fixture: \S/, f);
});

test('kit source: all five bugs broken, explanations name lines', () => {
  const r = states(read('phase5-bad.java'));
  for (const id of BUG_IDS) {
    assert.equal(r[id].state, 'broken', id + ': ' + r[id].explanation);
    assert.match(r[id].explanation, /line \d+/, id);
    assert.ok(r[id].evidence.length >= 1, id + ' evidence');
    for (const e of r[id].evidence) assert.ok(Number.isInteger(e.line) && typeof e.text === 'string' && e.text.length > 0, id);
  }
  assert.match(r['double-update'].explanation, /robot\.update\(\)/);
});

test('single-fix fixtures: the fixed/broken matrix is exactly diagonal', () => {
  const rows = [];
  for (let n = 1; n <= 5; n++) {
    const r = states(read(`phase5-fix-${n}.java`));
    rows.push([`fix-${n}`, ...BUG_IDS.map(id => r[id].state)]);
    BUG_IDS.forEach((id, i) => assert.equal(r[id].state, i === n - 1 ? 'fixed' : 'broken', `fix-${n} ${id}: ${r[id].explanation}`));
  }
  console.log('\n' + ['file', ...BUG_IDS].map(s => s.padEnd(20)).join('') + '\n' +
    rows.map(r => r.map(s => s.padEnd(20)).join('')).join('\n'));
});

test('phase5-good.java and phase5-renamed.java: all five fixed', () => {
  for (const f of ['phase5-good.java', 'phase5-renamed.java']) {
    const r = states(read(f));
    for (const id of BUG_IDS) assert.equal(r[id].state, 'fixed', `${f} ${id}: ${r[id].explanation}`);
  }
});

test('similarity: good ~1, renamed high, a different program low', () => {
  const sim = f => KIT.similarity(makeCtx(read(f)));
  const s = { bad: sim('phase5-bad.java'), good: sim('phase5-good.java'), renamed: sim('phase5-renamed.java'), other: sim('phase5-other.java') };
  console.log('similarity', JSON.stringify(Object.fromEntries(Object.entries(s).map(([k, v]) => [k, +v.toFixed(3)]))));
  assert.equal(s.bad, 1);
  assert.ok(s.good >= 0.9, 'good ' + s.good);
  assert.ok(s.renamed >= 0.5, 'renamed ' + s.renamed);
  assert.ok(s.other < 0.3, 'other ' + s.other);
  assert.equal(KIT.similarity(makeCtx('')), 0);
});

test('deleting code instead of fixing it scores "changed"', () => {
  const src = KIT.source;
  const cases = {
    'double-update': edit(edit(src, '            robot.follower.update();\n', ''), '        follower.update();\n        lift.update();', '        lift.update();'),
    'inverted-busy': edit(src, 'if (robot.follower.isBusy()) {', 'if (timer.seconds() > 3) {'),
    'kp-catastrophe': edit(src, 'double power = LIFT_KP * error;', 'double power = error;'),
    'silent-return': edit(src, '        target = ticks;\n', ''),
    'no-telemetry-update': src.split('\n').filter(l => !/^ {12}telemetry\.addData/.test(l)).join('\n')
  };
  for (const [id, variant] of Object.entries(cases)) {
    const r = states(variant);
    assert.equal(r[id].state, 'changed', `${id}: ${r[id].explanation}`);
    assert.ok(r[id].explanation.length > 20, id);
    for (const other of BUG_IDS.filter(x => x !== id)) assert.equal(r[other].state, 'broken', `${id} variant leaves ${other} broken`);
  }
});

test('alternative honest fixes are recognised', () => {
  const src = KIT.source;
  const fixed = (id, variant) => { const r = states(variant); assert.equal(r[id].state, 'fixed', `${id}: ${r[id].explanation}`); };
  fixed('double-update', edit(src, '            robot.follower.update();\n', ''));
  fixed('inverted-busy', edit(src, 'if (robot.follower.isBusy()) {', 'if (robot.follower.isBusy() == false) {'));
  fixed('inverted-busy', edit(src, 'if (robot.follower.isBusy()) {', 'if (!(robot.follower.isBusy())) {'));
  fixed('kp-catastrophe', edit(src, 'LIFT_KP = 50.0;', 'LIFT_KP = 0.02d;'));
  fixed('kp-catastrophe', edit(src, 'double power = LIFT_KP * error;', 'double power = error / 200.0;'));
  fixed('silent-return', edit(src, '        if (mode != Mode.AUTO) return;\n', ''));
  fixed('silent-return', edit(edit(src, '    public int position() {', '    public void setMode(Mode m) {\n        mode = m;\n    }\n\n    public int position() {'),
    '        robot.follower.setPose(startPose);\n', '        robot.follower.setPose(startPose);\n        robot.lift.setMode(Lift.Mode.AUTO);\n'));
  fixed('no-telemetry-update', edit(edit(src, '            telemetry.addData("Busy", robot.follower.isBusy());\n',
    '            telemetry.addData("Busy", robot.follower.isBusy());\n            showTelemetry();\n'),
    '    @Override\n    public void runOpMode() {', '    private void showTelemetry() {\n        telemetry.update();\n    }\n\n    @Override\n    public void runOpMode() {'));
});

test('non-fixes stay broken', () => {
  const src = KIT.source;
  const broken = (id, variant) => { const r = states(variant); assert.equal(r[id].state, 'broken', `${id}: ${r[id].explanation}`); };
  broken('kp-catastrophe', edit(src, 'motor.setPower(Range.clip(power, -1, 1));', 'motor.setPower(Range.clip(power, -0.5, 0.5));'));
  broken('silent-return', edit(src, 'if (mode != Mode.AUTO) return;', 'if (mode == Mode.MANUAL) return;'));
  broken('silent-return', edit(src, '    public int position() {', '    public void setMode(Mode m) {\n        mode = m;\n    }\n\n    public int position() {'));
  broken('no-telemetry-update', edit(src, '            telemetry.addData("Busy", robot.follower.isBusy());\n        }\n',
    '            telemetry.addData("Busy", robot.follower.isBusy());\n        }\n        telemetry.update();\n'));
  broken('double-update', edit(src, '            robot.follower.update();\n', '            if (true) robot.follower.update();\n'));
});

test('checks never throw on garbage', () => {
  const inputs = ['', 'the robot drives forward and scores', 'def f():\n  return 1', '{'.repeat(500), 'class A { void f() { if ( } }',
    KIT.source.slice(0, 1500), KIT.source.replace(/;/g, '')];
  for (const src of inputs) {
    const ctx = makeCtx(src);
    for (const b of KIT.bugs) {
      const r = b.check(ctx, ctx.H);
      assert.ok(['broken', 'changed', 'fixed'].includes(r.state), b.id);
      assert.equal(typeof r.explanation, 'string');
      assert.ok(Array.isArray(r.evidence));
    }
    assert.ok(KIT.similarity(ctx) >= 0 && KIT.similarity(ctx) <= 1);
    for (const b of KIT.bugs) assert.doesNotThrow(() => b.check({ src }, undefined));
  }
  for (const b of KIT.bugs) assert.doesNotThrow(() => b.check(null, null));
});

test('the kit never executes code', () => {
  const text = fs.readFileSync(path.join(ROOT, 'js/curriculum/phase5-kit.js'), 'utf8');
  const banned = new RegExp(['\\beval\\s*\\(', 'new\\s+Function', 'new\\s+Worker', 'import' + 'Scripts', '<iframe'].join('|'));
  assert.doesNotMatch(text, banned);
});

// ── Part 2: the full phase5 check (structural-2 checker) ─────────────────────
const full = (() => {
  try {
    const w = loadClassic(['js/java-structure.js', 'js/curriculum/code-rules.js', 'js/curriculum/phase5-kit.js', 'js/code-check.js',
      'js/curriculum/lessons.js']);
    return w.RTCodeCheck && w.RTCodeCheck.VERSION === 'structural-2' ? w : null;
  } catch (e) { return null; }
})();
const itest = (name, fn) => test(name, t => (full ? fn(t) : t.skip('structural-2 not landed yet')));
const bugReq = (res, id) => (res.requirements_met || []).find(r => r.id === id || r.id === 'bug-' + id);
const creditOf = r => (r.credit != null ? r.credit : (r.met ? 1 : 0));

itest('integration: the kit source fails with every bug at 0', () => {
  const res = full.RTCodeCheck.checkCode('phase5', read('phase5-bad.java'));
  assert.equal(res.passed, false);
  for (const id of BUG_IDS) {
    const r = bugReq(res, id);
    assert.ok(r, 'requirement for ' + id);
    assert.equal(creditOf(r), 0, id);
    assert.match(r.explanation || '', /line \d+/, id);
  }
});

itest('integration: each single fix credits exactly its bug', () => {
  for (let n = 1; n <= 5; n++) {
    const res = full.RTCodeCheck.checkCode('phase5', read(`phase5-fix-${n}.java`));
    BUG_IDS.forEach((id, i) => assert.equal(creditOf(bugReq(res, id)), i === n - 1 ? 1 : 0, `fix-${n} ${id}`));
  }
});

itest('integration: good passes, other hits the CRITICAL similarity gate, renamed passes', () => {
  const good = full.RTCodeCheck.checkCode('phase5', read('phase5-good.java'));
  assert.equal(good.passed, true, good.summary);
  assert.ok(good.score >= 90, 'good score ' + good.score);

  const other = full.RTCodeCheck.checkCode('phase5', read('phase5-other.java'));
  const gate = (other.gates || []).find(g => g.id === 'kit-similarity');
  assert.ok(gate, 'kit-similarity gate present');
  assert.equal(gate.passed, false);
  assert.equal(gate.severity, 'CRITICAL');
  assert.equal(other.passed, false);

  const ren = full.RTCodeCheck.checkCode('phase5', read('phase5-renamed.java'));
  assert.equal(ren.passed, true, ren.summary);
  for (const g of ren.gates || []) if (!g.passed) assert.equal(g.severity, 'WARNING', g.id);
});

itest('integration: getPhaseRequirements lists the five bug titles', () => {
  const labels = (full.getPhaseRequirements || full.RTCodeCheck.getPhaseRequirements)('phase5').map(r => r.label).join('\n');
  for (const b of KIT.bugs) assert.ok(labels.includes(b.title), b.title);
});
