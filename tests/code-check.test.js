// Structural code checker (node --test): js/code-check.js (structural-2) with the per-phase rules in
// js/curriculum/code-rules.js (rules-3), built on the parser in js/java-structure.js. Every graded
// phase has complete rules; each phase's known-good sample passes and its known-bad sample fails
// naming the expected requirements; adversarial samples (keyword stuffing, dead code, pasted
// lessons) fail with an integrity gate; honest partial attempts land in the middle; a rewritten
// good sample still passes; the labelled set in fixtures/code-samples/labels.json agrees; and the
// checker sources never run anything.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLES = path.join(ROOT, 'tests/fixtures/code-samples');
const KIT_FILE = 'js/curriculum/phase5-kit.js';
const HAS_KIT = fs.existsSync(path.join(ROOT, KIT_FILE));

function loadClassic(files) {
  const sandbox = { window: {}, console };
  sandbox.window.window = sandbox.window;
  for (const f of files) {
    if (!fs.existsSync(path.join(ROOT, f))) continue;
    vm.runInNewContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
  }
  return sandbox.window;
}
const FILES = ['js/java-structure.js', 'js/curriculum/code-rules.js', KIT_FILE, 'js/code-check.js', 'js/curriculum/lessons.js'];
const win = loadClassic(FILES);
const read = f => fs.readFileSync(path.join(SAMPLES, f), 'utf8');
const exists = f => fs.existsSync(path.join(SAMPLES, f));
const failedGates = r => (r.gates || []).filter(g => !g.passed);
const criticalGate = r => failedGates(r).some(g => g.severity === 'CRITICAL');
const describe = r => 'score ' + r.score + ' | gates ' + failedGates(r).map(g => g.id + ':' + g.severity).join(',') +
  ' | missing ' + r.requirements_met.filter(q => !q.met).map(q => q.id + '=' + q.credit).join(',') +
  ' | issues ' + r.issues.map(i => i.severity + ' ' + i.description).join(' || ');

const NON_KIT = ['phase1', 'phase2', 'phase3', 'phase4', 'advanced_command', 'capstone'];
const GRADED = ['phase1', 'phase2', 'phase3', 'phase4', 'phase5', 'advanced_command', 'capstone'];

// Requirements the known-bad sample must miss (ids; the test compares their labels).
const EXPECT_MISSING = {
  phase1: ['servo', 'y-invert', 'telemetry', 'mechanism'],
  phase2: ['drivetrain-class', 'robot-class', 'enum', 'private-fields'],
  phase3: ['sensor-type', 'sensor-read', 'state-machine', 'decision'],
  phase4: ['pid-output', 'follower', 'paths', 'waypoints'],
  advanced_command: ['scheduler', 'command-builder', 'sequential', 'follow-path'],
  capstone: ['architecture', 'pedro', 'waypoints', 'sensor-decision']
};
// Forbidden patterns the known-bad sample must trigger.
const EXPECT_FORBIDDEN = {
  phase1: ['sleep-in-loop'],
  phase3: ['time-based'],
  phase4: ['time-based'],
  capstone: ['time-based']
};
// Criteria whose failure must surface as a WARNING issue naming them (Phase 2's OpMode-hardware rule).
const EXPECT_WARNING_CRITERIA = {
  phase2: ['no-hardware-in-opmode']
};
// The never-called method each -deadcode sample hides its work in.
const DEAD_METHOD = {
  phase1: 'setupHardware', phase2: 'buildRobot', phase3: 'runStateMachine', phase4: 'runLiftPid',
  advanced_command: 'intakeFor', capstone: 'buildRoutine'
};
const RENAMED = ['phase1', 'phase2', 'phase4'];

// The one-line stuffing attack from the plan: it scored 100 under structural-1 in every phase.
const STUFFING = 'Scheduler.execute(); Scheduler.reset(); Command.build(); follow(follower, p); intake; waitMs(1); setDone(1); x.requiring(1); sequential(1); int easier;';

test('versions and exports', () => {
  assert.equal(win.RTCodeCheck.VERSION, 'structural-2');
  assert.equal(win.CODE_RULES_VERSION, 'rules-3');
  assert.equal(win.RTCodeCheck.graderVersion(), 'structural-2/rules-3');
  assert.equal(typeof win.checkCode, 'function');
  assert.equal(typeof win.getPhaseRequirements, 'function');
  assert.equal(win.RTCodeCheck.PHASE_REQUIREMENTS, undefined, 'PHASE_REQUIREMENTS is gone');
  for (const n of ['ev', 'opMode', 'isLinear', 'loopBodies', 'initBodies', 'hardwareVars', 'motors', 'servos', 'sensors', 'gamepadTokens',
    'callsIn', 'count', 'distinct', 'sensorDerived', 'enumUsed', 'poses', 'pathMethods', 'qualityComments', 'textRule', 'stripCommentsAndStrings']) {
    assert.equal(typeof win.RTCodeCheck.H[n], 'function', 'RTCodeCheck.H.' + n);
  }
});

test('every graded phase has complete rules whose weights sum to 100', () => {
  for (const pid of GRADED) {
    const r = win.CODE_RULES[pid];
    assert.ok(r && Array.isArray(r.required), pid + ' has rules');
    const criteria = r.kit ? win.getPhaseRequirements(pid) : r.required;
    if (r.kit && !HAS_KIT) continue;
    assert.ok(criteria.length >= 5, pid + ' needs at least 5 criteria');
    for (const q of r.required) {
      assert.ok(q.id && q.label && typeof q.weight === 'number' && q.hint && typeof q.credit === 'function', pid + '/' + (q.id || '?') + ' incomplete');
    }
    const sum = criteria.reduce((n, q) => n + q.weight, 0);
    assert.equal(sum, 100, pid + ' weights sum to ' + sum);
    for (const g of r.gates || []) assert.ok(g.id && g.label && g.severity && g.hint && typeof g.test === 'function', pid + '/gate/' + (g.id || '?'));
    for (const f of r.forbidden || []) assert.ok(f.id && f.label && f.severity && f.hint && typeof f.test === 'function', pid + '/forbidden/' + (f.id || '?'));
    const gateIds = (r.gates || []).map(g => g.id);
    assert.ok(gateIds.includes('parses') && gateIds.includes('opmode-present'), pid + ' runs the parses and opmode-present gates');
    if (!r.kit) assert.ok(gateIds.includes('declared-identifiers') && gateIds.includes('lesson-copy'), pid + ' runs the common gates');
    else assert.ok(gateIds.includes('kit-similarity') && !gateIds.includes('lesson-copy'), 'phase5 uses kit-similarity instead of lesson-copy');
  }
  assert.equal(win.CODE_RULES.advanced_strategy.reflection, true);
});

test('getPhaseRequirements returns { id, label, weight, hint } from the rules', () => {
  const list = win.getPhaseRequirements('phase1');
  assert.equal(list.length, win.CODE_RULES.phase1.required.length);
  for (const q of list) assert.ok(typeof q.id === 'string' && typeof q.label === 'string' && typeof q.weight === 'number' && typeof q.hint === 'string');
  assert.deepEqual(JSON.parse(JSON.stringify(win.getPhaseRequirements('advanced_strategy'))), []);
  assert.deepEqual(JSON.parse(JSON.stringify(win.getPhaseRequirements('phase0'))), []);
  if (HAS_KIT) {
    const p5 = win.getPhaseRequirements('phase5');
    const bugs = win.RT_PHASE5_KIT.bugs;
    assert.equal(p5.length, bugs.length + win.CODE_RULES.phase5.required.length);
    bugs.forEach((b, i) => { assert.equal(p5[i].label, 'Bug fixed: ' + b.title); assert.equal(p5[i].weight, 15); });
  }
});

test('result contract', () => {
  const r = win.checkCode('phase1', read('phase1-good.java'));
  for (const k of ['status', 'grader', 'graderVersion', 'parserVersion', 'passed', 'score', 'summary', 'strengths', 'issues', 'requirements_met', 'next_steps', 'gates', 'structural']) {
    assert.ok(k in r, 'result has ' + k);
  }
  assert.equal(r.status, 'graded');
  assert.equal(r.grader, 'structural');
  assert.equal(r.graderVersion, 'structural-2/rules-3');
  assert.equal(r.parserVersion, 'jstruct-1');
  assert.equal(r.structural, true);
  assert.ok(r.summary.startsWith('Structural check only'), 'summary must carry the disclaimer');
  assert.match(r.summary, /Met \d+ of \d+ requirements \(\d+ partly\) — score \d+\/100\./);
  assert.ok(r.strengths.length <= 6 && r.next_steps.length <= 4);
  for (const q of r.requirements_met) {
    assert.ok(q.id && q.requirement && typeof q.met === 'boolean' && typeof q.credit === 'number' && typeof q.explanation === 'string' && Array.isArray(q.evidence) && q.hint);
    for (const e of q.evidence) assert.ok(typeof e.line === 'number' && typeof e.text === 'string' && e.text.length <= 100);
  }
  for (const g of r.gates) assert.ok(g.id && g.label && typeof g.passed === 'boolean' && g.severity && Array.isArray(g.evidence));
  // A met requirement carries its line: phase1-good drives the motors at lines 32–33.
  const drive = r.requirements_met.find(q => q.id === 'drive-flow');
  assert.ok(drive.met && drive.evidence.some(e => e.line === 32 && /leftDrive\.setPower/.test(e.text)), JSON.stringify(drive));
  // Issues are ordered CRITICAL → WARNING → SUGGESTION.
  const order = { CRITICAL: 0, WARNING: 1, SUGGESTION: 2 };
  const bad = win.checkCode('phase1', read('phase1-stuffed.java'));
  const sev = bad.issues.map(i => order[i.severity]);
  assert.deepEqual(sev, sev.slice().sort((a, b) => a - b), 'issues sorted by severity');
});

const SCORE_LINES = [];
for (const pid of NON_KIT) {
  test(`${pid}: known-good passes, known-bad fails naming the right requirements`, () => {
    const good = win.checkCode(pid, read(pid + '-good.java'));
    assert.equal(good.status, 'graded');
    assert.equal(good.passed, true, pid + ' good failed: ' + describe(good));
    assert.ok(good.score >= 85, pid + ' good ' + describe(good));
    assert.ok(!criticalGate(good), pid + ' good fails a gate: ' + describe(good));

    const bad = win.checkCode(pid, read(pid + '-bad.java'));
    assert.equal(bad.status, 'graded');
    assert.equal(bad.passed, false, pid + ' bad passed: ' + describe(bad));
    assert.ok(bad.score < 45, pid + ' bad ' + describe(bad));
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
    for (const id of EXPECT_WARNING_CRITERIA[pid] || []) {
      const label = rules.find(r => r.id === id).label;
      assert.ok(bad.issues.some(i => i.severity === 'WARNING' && i.description.includes(label)), pid + ' bad should warn "' + label + '"');
    }
    assert.ok(bad.next_steps.length > 0, 'feedback names a hint the student can act on');

    const scores = { good: good.score, bad: bad.score };
    for (const kind of ['stuffed', 'deadcode', 'partial', 'renamed']) {
      if (exists(pid + '-' + kind + '.java')) scores[kind] = win.checkCode(pid, read(pid + '-' + kind + '.java')).score;
    }
    const line = `${pid}: ` + Object.entries(scores).map(([k, v]) => k + '=' + v).join(' ');
    SCORE_LINES.push(line);
    console.log(line);
  });

  test(`${pid}: keyword stuffing fails a CRITICAL gate and scores under 40`, () => {
    const r = win.checkCode(pid, read(pid + '-stuffed.java'));
    assert.equal(r.passed, false, describe(r));
    assert.ok(criticalGate(r), pid + ' stuffed should fail a CRITICAL gate: ' + describe(r));
    assert.ok(r.score < 40, pid + ' stuffed ' + describe(r));
  });

  test(`${pid}: required code that never runs earns no pass and is named`, () => {
    const r = win.checkCode(pid, read(pid + '-deadcode.java'));
    assert.equal(r.passed, false, describe(r));
    assert.ok(r.score <= 60, pid + ' deadcode ' + describe(r));
    const un = r.issues.find(i => i.id === 'unreachable-code');
    assert.ok(un && un.description.includes(DEAD_METHOD[pid] + '()'), pid + ' deadcode should name ' + DEAD_METHOD[pid] + '() — ' + describe(r));
  });

  test(`${pid}: an honest half attempt lands in the middle with next steps`, () => {
    const r = win.checkCode(pid, read(pid + '-partial.java'));
    assert.equal(r.passed, false, describe(r));
    assert.ok(r.score >= 40 && r.score <= 74, pid + ' partial ' + describe(r));
    assert.ok(!criticalGate(r) && !r.issues.some(i => i.severity === 'CRITICAL'), pid + ' partial has a CRITICAL: ' + describe(r));
    assert.ok(r.next_steps.length >= 2, pid + ' partial next steps: ' + r.next_steps.length);
  });

  if (RENAMED.includes(pid)) {
    test(`${pid}: the good sample rewritten with other names and idioms still passes`, () => {
      const r = win.checkCode(pid, read(pid + '-renamed.java'));
      assert.equal(r.passed, true, pid + ' renamed ' + describe(r));
      assert.ok(r.score >= 85, pid + ' renamed ' + describe(r));
    });
  }
}

test('pasting the lesson snippets back fails the lesson-copy gate', () => {
  const byPhase = {};
  for (const pid of ['phase1', 'phase2', 'phase3', 'phase4']) {
    byPhase[pid] = (win.PHASE_LESSONS[pid] || []).filter(s => s.code && !s.code.kit && typeof s.code.snippet === 'string').map(s => s.code.snippet);
  }
  byPhase.advanced_command = win.ADVANCED_CONTENT.advanced_command.sections.filter(s => typeof s.code === 'string').map(s => s.code);
  // (the capstone module has no reference code, so its lesson-copy gate has nothing to compare with)
  for (const [pid, snippets] of Object.entries(byPhase)) {
    assert.ok(snippets.length > 0, pid + ' has lesson snippets');
    const r = win.checkCode(pid, snippets.join('\n'));
    const g = r.gates.find(x => x.id === 'lesson-copy');
    assert.ok(g && !g.passed && g.severity === 'CRITICAL', pid + ' lesson paste: ' + describe(r));
    assert.equal(r.passed, false);
  }
  // The same code with explicit references behaves the same, and without references the gate is skipped.
  const snippets = byPhase.phase1;
  const withRefs = win.checkCode('phase1', snippets.join('\n'), { references: snippets });
  assert.equal(withRefs.gates.find(x => x.id === 'lesson-copy').passed, false);
  const noRefs = win.checkCode('phase1', read('phase1-good.java'), { references: [] });
  assert.equal(noRefs.gates.find(x => x.id === 'lesson-copy').passed, true);
});

test('the one-line stuffing attack fails a CRITICAL gate and scores under 40 in every graded phase', () => {
  for (const pid of GRADED) {
    if (win.CODE_RULES[pid].kit && !HAS_KIT) continue;
    const r = win.checkCode(pid, STUFFING);
    assert.equal(r.status, 'graded', pid);
    assert.equal(r.passed, false, pid + ' ' + describe(r));
    assert.ok(criticalGate(r), pid + ' ' + describe(r));
    assert.ok(r.score < 40, pid + ' ' + describe(r));
  }
});

test('labels.json: the labelled fixture set agrees with the checker (>= 90%)', () => {
  const labels = JSON.parse(read('labels.json'));
  const files = fs.readdirSync(SAMPLES).filter(f => f.endsWith('.java') && !f.startsWith('phase5-'));
  assert.deepEqual(labels.map(l => l.file).sort(), files.sort(), 'labels.json covers every non-phase5 fixture');
  let agree = 0;
  const misses = [];
  for (const l of labels) {
    const r = win.checkCode(l.phase, read(l.file));
    const ok = (r.passed === (l.expect === 'pass')) && r.score >= l.band[0] && r.score <= l.band[1];
    if (ok) agree++; else misses.push(l.file + ' ' + r.score + (r.passed ? ' pass' : ' fail'));
  }
  const rate = agree / labels.length;
  console.log(`labels: ${agree}/${labels.length} agree` + (misses.length ? ' — ' + misses.join(', ') : ''));
  assert.ok(rate >= 0.9, 'agreement ' + rate + ': ' + misses.join(', '));
});

test('a fixture file opens with its // fixture: note', () => {
  for (const f of fs.readdirSync(SAMPLES)) {
    if (!/-(stuffed|deadcode|partial|renamed)\.java$/.test(f)) continue;
    assert.match(read(f), /^\/\/ fixture: /, f);
  }
});

// The curriculum targets Pedro Pathing 3 + Ivy. Old-API code is flagged with a hint that names
// the change, and the known-good samples themselves must not drift back to the old API.
const OLD_PEDRO = /pathBuilder|setLinearHeadingInterpolation|setConstantHeadingInterpolation|setStartingPose|followPath\s*\(|BezierLine|PathChain|new\s+Point\s*\(|getPose\s*\(|new\s+Follower\s*\(/;
const OLD_COMMANDS = /SubsystemBase|CommandBase|SequentialCommandGroup|ParallelCommandGroup|CommandScheduler|isFinished\s*\(|addRequirements|withTimeout/;

test('legacy Pedro 2 and FTCLib APIs are flagged with a migration hint', () => {
  const pedro2 = 'public class A extends OpMode { Follower follower; PathChain p; void init() { follower.setStartingPose(start); p = follower.pathBuilder().addPath(new BezierLine(new Point(a), new Point(b))).setLinearHeadingInterpolation(0, 1).build(); } void loop() { follower.update(); } }';
  for (const pid of ['phase4', 'capstone']) {
    const r = win.checkCode(pid, pedro2);
    const label = win.CODE_RULES[pid].forbidden.find(f => f.id === 'legacy-pedro').label;
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

test('Phase 5: bug criteria come from the kit, and without the kit the phase is not scored', { skip: !HAS_KIT && 'phase5-kit.js not present' }, () => {
  const good = win.checkCode('phase5', read('phase5-good.java'));
  assert.equal(good.status, 'graded');
  const ids = good.requirements_met.map(q => q.id);
  for (const b of win.RT_PHASE5_KIT.bugs) assert.ok(ids.includes('bug-' + b.id), 'criterion for bug ' + b.id);
  assert.ok(good.gates.some(g => g.id === 'kit-similarity'));
  const other = win.checkCode('phase5', read('phase4-good.java'));
  const g = other.gates.find(x => x.id === 'kit-similarity');
  assert.ok(g && !g.passed && g.severity === 'CRITICAL', describe(other));
  assert.ok(other.requirements_met.filter(q => q.id.startsWith('bug-')).every(q => q.credit === 0), 'a different program earns no bug credit');
  const bare = loadClassic(FILES.filter(f => f !== KIT_FILE));
  const u = bare.checkCode('phase5', read('phase5-good.java'));
  assert.equal(u.status, 'ungraded');
  assert.match(u.summary, /Phase 5 program is not loaded/);
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
  assert.ok(broken.gates.some(g => g.id === 'parses' && !g.passed));
  // Garbage never throws
  for (const s of ['', '}}}{{{', 'def main():\n  print(1)', '\u0000￿', 'class { void ( { ; }']) {
    for (const pid of GRADED) assert.doesNotThrow(() => win.checkCode(pid, s), pid + ' ' + JSON.stringify(s));
  }
});

test('code under if (false) or in a method nothing calls earns no credit', () => {
  const src = read('phase1-good.java');
  const hidden = src.replace('while (opModeIsActive()) {', 'while (opModeIsActive()) {\n            if (false) {').replace('telemetry.update();\n        }', 'telemetry.update();\n        }\n        }');
  const r = win.checkCode('phase1', hidden);
  assert.equal(r.passed, false, describe(r));
  assert.ok(r.issues.some(i => i.id === 'dead-branch'), 'suggests removing the dead branch');
});

test('the checker source never executes code', () => {
  const files = ['js/java-structure.js', 'js/curriculum/code-rules.js', 'js/code-check.js'];
  if (HAS_KIT) files.push(KIT_FILE);
  for (const f of files) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.ok(!/\beval\s*\(|new\s+Function|new\s+Worker|importScripts|fetch\s*\(|XMLHttpRequest/.test(src), f + ' must not execute or fetch anything');
  }
});
