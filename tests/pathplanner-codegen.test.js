// Path planner code generation (node --test): js/pathplanner/codegen.js emits Pedro
// Pathing 3 (Paths.line / curve / path with PoseFactory.degrees()) and none of the
// 2.x API (BezierLine, PathChain, pathBuilder, setLinearHeadingInterpolation), plus an Ivy
// routine(follower) in which every waypoint's wait and action actually run.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// codegen.js is a classic script: updateCode() reads the planner globals that canvas.js
// declares (waypoints, segments, pathSettings) and writes #codeBlock. Stub all of them.
function generate(waypoints, segments) {
  const block = { textContent: '' };
  const sb = { console, waypoints, segments, pathSettings: {}, document: { getElementById: id => (id === 'codeBlock' ? block : null) } };
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/pathplanner/codegen.js'), 'utf8'), sb, { filename: 'js/pathplanner/codegen.js' });
  vm.runInContext('updateCode()', sb);
  return block.textContent;
}

const wp = (x, y, heading, extra) => Object.assign({ x, y, heading, waitMs: 0, action: 'None' }, extra);
// routine() takes the team's Follower as a parameter; the class never builds one.
const OLD_API = /BezierLine|BezierCurve|PathChain|pathBuilder|setLinearHeadingInterpolation|Math\.toRadians|new Follower\b/;

test('a line and a one-control-point curve become Pedro 3 line()/curve() with a linear heading', () => {
  const code = generate(
    [wp(24, 12, 90), wp(48, 72, 135, { waitMs: 500, action: 'Intake' }), wp(21, 75, 180)],
    [{ cps: [] }, { cps: [{ x: 45, y: 60 }] }]
  );
  for (const line of [
    'import static com.pedropathing.api.Paths.*;',
    'import com.pedropathing.api.PoseFactory;',
    'import com.pedropathing.math.Pose;',
    'import com.pedropathing.paths.Path;',
    'private final PoseFactory p = PoseFactory.degrees();',
    'public final Pose point1 = p.of(24.00, 12.00, 90.0);',
    'public final Pose point2 = p.of(48.00, 72.00, 135.0);',
    'import static com.pedropathing.ivy.commands.Commands.*;',
    'import static com.pedropathing.ivy.groups.Groups.*;',
    'import static com.pedropathing.ivy.pedro.PedroCommands.*;',
    'import com.pedropathing.follower.Follower;',
    'import com.pedropathing.ivy.Command;',
    'public Path path1() {',
    'return line(point1, point2).linear(point1, point2);',
    'return curve(point2, p.of(45.00, 60.00, 0), point3).linear(point2, point3);',
    'public Path fullPath() {',
    'return path(path1(), path2());',
    'schedule(follow(follower, fullPath()));',
    'schedule(new AutoPath().routine(follower));',
    'public Command routine(Follower follower) {',
  ]) assert.ok(code.includes(line), 'missing: ' + line + '\n' + code);
  // The wait and the action at point2 run between the two segments, action first.
  const routine = code.slice(code.indexOf('public Command routine'));
  const order = ['follow(follower, path1())', 'instant(() -> { /* TODO (point2): start your intake */ })', 'waitMs(500)', 'follow(follower, path2())'];
  let at = -1;
  for (const step of order) {
    const k = routine.indexOf(step);
    assert.ok(k > at, 'routine() out of order at ' + step + '\n' + routine);
    at = k;
  }
  assert.doesNotMatch(code, OLD_API);
  // Java runs field initialisers in order: the factory must be declared before any p.of(...)
  assert.ok(code.indexOf('PoseFactory.degrees()') < code.indexOf('p.of('), code);
  // Braces balance: it has to paste into a project as-is
  assert.equal((code.match(/\{/g) || []).length, (code.match(/\}/g) || []).length);
});

test('two control points, a single segment (no fullPath) and the empty case', () => {
  const two = generate([wp(0, 0, 0), wp(60, 20, -90)], [{ cps: [{ x: 30, y: 20 }, { x: 50, y: 20 }] }]);
  assert.ok(two.includes('return curve(point1, p.of(30.00, 20.00, 0), p.of(50.00, 20.00, 0), point2).linear(point1, point2);'), two);
  assert.ok(two.includes('p.of(60.00, 20.00, -90.0)'), two);
  assert.ok(!two.includes('fullPath'), 'one segment needs no fullPath():\n' + two);
  assert.ok(two.includes('schedule(follow(follower, path1()));'), two);
  assert.doesNotMatch(two, OLD_API);
  assert.equal(generate([wp(0, 0, 0)], []), '// Add at least 2 waypoints to generate code');
});

test('actions without a wait still run, a start-point action runs before the first path, "Wait"/"None" add nothing', () => {
  const code = generate(
    [wp(10, 10, 0, { action: 'Outtake' }), wp(40, 10, 0, { action: 'Custom' }), wp(70, 10, 0, { waitMs: 250, action: 'Wait' })],
    [{ cps: [] }, { cps: [] }]
  );
  const routine = code.slice(code.indexOf('public Command routine'));
  const steps = routine.split('\n').map(l => l.trim()).filter(l => /^(instant|waitMs|follow)\(/.test(l)).map(l => l.replace(/,$/, ''));
  assert.deepEqual(steps, [
    'instant(() -> { /* TODO (point1): run your outtake */ })',
    'follow(follower, path1())',
    'instant(() -> { /* TODO (point2): your action */ })',
    'follow(follower, path2())',
    'waitMs(250)',
  ]);
  assert.equal((code.match(/\{/g) || []).length, (code.match(/\}/g) || []).length);
});
