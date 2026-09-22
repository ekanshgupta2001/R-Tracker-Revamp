// Lesson content (node --test): the Phase 4/5 code lessons, the advanced modules and the
// capstone brief teach the Pedro Pathing 3 API (PoseFactory, Paths.line/curve, chained
// interpolations, Constants.create) and Ivy commands (Command.build, Scheduler, follow) —
// none of the Pedro 2 or FTCLib names the curriculum used to teach.
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
const win = loadClassic(['js/curriculum/lessons.js']);

const LEGACY = /pathBuilder|setLinearHeadingInterpolation|setConstantHeadingInterpolation|BezierLine|PathChain|followPath|setStartingPose|getPose\(|getHeading\(|SubsystemBase|CommandBase|SequentialCommandGroup|ParallelCommandGroup|withTimeout|isFinished\(|addRequirements|breakFollowing|FTCLib's/;

// Every string a student can read in a lesson section.
function sectionText(sec) {
  const out = [sec.title, sec.learn, sec.mentorTip, sec.code && sec.code.snippet];
  if (sec.check) {
    out.push(sec.check.question);
    (sec.check.options || []).forEach(o => out.push(o.text, o.explanation));
  }
  return out.filter(Boolean).join('\n');
}
function moduleText(mod) {
  const out = [mod.title, mod.intro, mod.scenario];
  (mod.sections || []).forEach(s => out.push(s.title, s.content, s.code));
  if (mod.deliverable) out.push(mod.deliverable.description, ...mod.deliverable.requirements);
  (mod.requirements || []).forEach(r => out.push(r.category, ...r.items));
  (mod.deliverables || []).forEach(d => out.push(d));
  (mod.rubric || []).forEach(r => out.push(r.description));
  return out.filter(Boolean).join('\n');
}

test('no lesson still teaches the Pedro 2 or FTCLib API', () => {
  const problems = [];
  for (const pid of ['phase4', 'phase5']) {
    for (const sec of win.PHASE_LESSONS[pid]) {
      const m = LEGACY.exec(sectionText(sec));
      if (m) problems.push(pid + '/' + sec.id + ': ' + m[0]);
    }
  }
  for (const mid of Object.keys(win.ADVANCED_CONTENT)) {
    const m = LEGACY.exec(moduleText(win.ADVANCED_CONTENT[mid]));
    if (m) problems.push(mid + ': ' + m[0]);
  }
  assert.deepEqual(problems, []);
});

test('Phase 4 teaches Pedro 3 path creation and Ivy following', () => {
  const byId = Object.fromEntries(win.PHASE_LESSONS.phase4.map(s => [s.id, s]));
  const paths = byId['pedro-pathing'].code.snippet;
  for (const needle of ['PoseFactory.degrees()', 'p.of(', 'line(', 'curve(', '.linear(', 'Path ']) {
    assert.ok(paths.includes(needle), 'pedro-pathing snippet needs ' + needle);
  }
  const following = byId['follower-rules'].code.snippet;
  for (const needle of ['Scheduler.reset()', 'Constants.create(hardwareMap)', 'follower.setPose(', 'schedule(follow(follower,', 'follower.update()', 'Scheduler.execute()', 'follower.pose().x()']) {
    assert.ok(following.includes(needle), 'follower-rules snippet needs ' + needle);
  }
  assert.ok(byId['tuning-process'].learn.includes('AutoTune') && byId['tuning-process'].code.snippet.includes('public static Follower create(HardwareMap h)'));
});

test('Advanced 1 teaches Ivy: builder, scheduler, compositions, Pedro commands', () => {
  const text = moduleText(win.ADVANCED_CONTENT.advanced_command);
  for (const needle of ['Command.build()', 'setStart(', 'setExecute(', 'setDone(', 'setEnd(', '.requiring(', 'Scheduler.reset()', 'Scheduler.execute()', 'schedule(', 'sequential(', 'parallel(', 'race(', 'waitMs(', 'instant(', 'follow(follower,', 'hold(follower', 'com.pedropathing.ivy:pedro']) {
    assert.ok(text.includes(needle), 'advanced_command needs ' + needle);
  }
  const strategy = moduleText(win.ADVANCED_CONTENT.advanced_strategy);
  assert.ok(strategy.includes('race(follow(follower,') && strategy.includes('routine.cancel()'), 'the fail-safe patterns use Ivy');
  const capstone = moduleText(win.ADVANCED_CONTENT.capstone);
  assert.ok(/Pedro Pathing 3/.test(capstone) && /Scheduler\.execute\(\)/.test(capstone) && /sequential\(\)/.test(capstone));
});
