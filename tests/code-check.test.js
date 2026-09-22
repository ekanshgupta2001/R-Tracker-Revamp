// Phase 5 gate (node --test): every phase with a code deliverable has rules; the known-good
// sample for each phase passes the structural check and the known-bad sample fails with the
// expected rule ids named; the checker never executes code.
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
const win = loadClassic(['js/curriculum/code-rules.js', 'js/code-check.js']);
const read = f => fs.readFileSync(path.join(SAMPLES, f), 'utf8');

const EXPECT_MISSING = {
  phase1: ['servo', 'y-invert', 'telemetry', 'mechanism'],
  phase2: ['drivetrain-class', 'robot-class', 'enum', 'private-fields'],
  phase3: ['sensor-type', 'sensor-read', 'state-machine', 'decision'],
  phase4: ['pid', 'pedro', 'paths', 'waypoints'],
  phase5: ['bug-notes', 'bug-explained'],
  advanced_command: ['scheduler', 'commands', 'sequential', 'follow-path'],
  capstone: ['robot-class', 'pedro', 'waypoints', 'sensor-decision']
};
const EXPECT_FORBIDDEN = {
  phase1: ['sleep-in-loop'],
  phase2: ['hardware-in-opmode'],
  phase3: ['long-sleep'],
  phase4: ['time-based'],
  phase5: ['double-update', 'empty-catch', 'todo'],
  capstone: ['time-based']
};

test('every code deliverable has rules with ids, patterns and hints', () => {
  const phases = ['phase1', 'phase2', 'phase3', 'phase4', 'phase5', 'advanced_command', 'capstone'];
  for (const pid of phases) {
    const r = win.CODE_RULES[pid];
    assert.ok(r && r.required && r.required.length >= 5, pid + ' needs required rules');
    for (const q of r.required) {
      assert.ok(q.id && q.label && Object.prototype.toString.call(q.pattern) === '[object RegExp]' && q.hint, pid + '/' + (q.id || '?') + ' incomplete');
    }
    for (const f of r.forbidden || []) assert.ok(f.id && f.label && (f.pattern || f.test) && f.hint, pid + '/forbidden/' + (f.id || '?'));
  }
  assert.equal(win.CODE_RULES.advanced_strategy.reflection, true);
});

for (const pid of Object.keys(EXPECT_MISSING)) {
  test(`${pid}: known-good sample passes, known-bad sample fails with the right hints`, () => {
    const good = win.checkCode(pid, read(pid + '-good.java'));
    assert.equal(good.status, 'graded');
    assert.equal(good.passed, true, pid + ' good failed: score ' + good.score + ' missing ' + good.requirements_met.filter(q => !q.met).map(q => q.requirement).join(' | ') + ' issues ' + good.issues.map(i => i.description).join(' | '));
    assert.ok(good.score >= 75, pid + ' good score ' + good.score);
    assert.ok(good.summary.startsWith('Structural check only'), 'summary must carry the disclaimer');

    const bad = win.checkCode(pid, read(pid + '-bad.java'));
    assert.equal(bad.status, 'graded');
    assert.equal(bad.passed, false, pid + ' bad passed with score ' + bad.score);
    const missing = bad.requirements_met.filter(q => !q.met).map(q => q.requirement);
    const rules = win.CODE_RULES[pid].required;
    for (const id of EXPECT_MISSING[pid]) {
      const label = rules.find(r => r.id === id).label;
      assert.ok(missing.includes(label), pid + ' bad should miss "' + id + '" — missing: ' + missing.join(' | '));
    }
    for (const id of EXPECT_FORBIDDEN[pid] || []) {
      const label = (win.CODE_RULES[pid].forbidden || []).find(f => f.id === id).label;
      assert.ok(bad.issues.some(i => i.description.startsWith(label)), pid + ' bad should flag "' + id + '" — issues: ' + bad.issues.map(i => i.description).join(' | '));
    }
    // Feedback names a hint the student can act on
    assert.ok(bad.next_steps.length > 0);
    console.log(`${pid}: good=${good.score} bad=${bad.score}`);
  });
}

// The curriculum targets Pedro Pathing 3 + Ivy. Old-API code is flagged with a hint that names
// the change, and the known-good samples themselves must not drift back to the old API.
const OLD_PEDRO = /pathBuilder|setLinearHeadingInterpolation|setConstantHeadingInterpolation|setStartingPose|followPath\s*\(|BezierLine|PathChain|new\s+Point\s*\(|getPose\s*\(|new\s+Follower\s*\(/;
const OLD_COMMANDS = /SubsystemBase|CommandBase|SequentialCommandGroup|ParallelCommandGroup|CommandScheduler|isFinished\s*\(|addRequirements|withTimeout/;

test('legacy Pedro 2 and FTCLib APIs are flagged with a migration hint', () => {
  const pedro2 = 'public class A extends OpMode { Follower follower; PathChain p; void init() { follower.setStartingPose(start); p = follower.pathBuilder().addPath(new BezierLine(new Point(a), new Point(b))).setLinearHeadingInterpolation(0, 1).build(); } void loop() { follower.update(); } }';
  for (const pid of ['phase4', 'capstone']) {
    const r = win.checkCode(pid, pedro2);
    const label = win.CODE_RULES[pid].forbidden.find(f => f.id === 'legacy-api').label;
    assert.ok(r.issues.some(i => i.description.startsWith(label) && /Pedro 3/.test(i.fix)), pid + ' should flag the Pedro 2 API — issues: ' + r.issues.map(i => i.description).join(' | '));
  }
  const ftclib = 'class Drive extends SubsystemBase {} class Go extends CommandBase { public boolean isFinished() { return true; } } class Auto extends SequentialCommandGroup {}';
  const r = win.checkCode('advanced_command', ftclib);
  const label = win.CODE_RULES.advanced_command.forbidden.find(f => f.id === 'legacy-commands').label;
  assert.ok(r.issues.some(i => i.description.startsWith(label) && /Ivy/.test(i.fix)), 'FTCLib API should be flagged — issues: ' + r.issues.map(i => i.description).join(' | '));
});

test('the known-good samples use the Pedro 3 and Ivy API', () => {
  for (const pid of ['phase4', 'phase5', 'advanced_command', 'capstone']) {
    const src = read(pid + '-good.java');
    assert.doesNotMatch(src, OLD_PEDRO, pid + '-good.java still uses the Pedro 2 API');
    assert.doesNotMatch(src, OLD_COMMANDS, pid + '-good.java still uses the FTCLib API');
    assert.ok(src.includes('Constants.create('), pid + '-good.java should create the follower with Constants.create()');
  }
  for (const pid of ['phase4', 'advanced_command', 'capstone']) {
    const src = read(pid + '-good.java');
    assert.ok(/\bfollow\(follower,/.test(src) && src.includes('Scheduler.execute()'), pid + '-good.java should follow paths with Ivy');
  }
});

test('reflection deliverable and unknown phase are never scored', () => {
  const r = win.checkCode('advanced_strategy', 'anything');
  assert.equal(r.status, 'reflection');
  assert.equal(r.passed, null);
  const u = win.checkCode('phase0', 'anything');
  assert.equal(u.status, 'ungraded');
});

test('input guards and comment/string stripping', () => {
  const tooLong = win.checkCode('phase1', 'x'.repeat(50001));
  assert.equal(tooLong.error, true);
  const stripped = win.RTCodeCheck.stripCommentsAndStrings('a = "hardwareMap.get(x)"; // hardwareMap.get(y)\n/* hardwareMap.get(z) */ b();');
  assert.ok(!/hardwareMap/.test(stripped), 'strings and comments must be blanked');
  assert.equal(stripped.split('\n').length, 2, 'newlines preserved');
  // Unbalanced braces are a CRITICAL failure regardless of score
  const broken = win.checkCode('phase1', read('phase1-good.java').replace(/\}\s*$/, ''));
  assert.equal(broken.passed, false);
  assert.ok(broken.issues.some(i => i.severity === 'CRITICAL'));
});

test('the checker source never executes code', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js/code-check.js'), 'utf8') + fs.readFileSync(path.join(ROOT, 'js/curriculum/code-rules.js'), 'utf8');
  assert.ok(!/\beval\s*\(|new\s+Function|new\s+Worker|importScripts|fetch\s*\(|XMLHttpRequest/.test(src));
});
