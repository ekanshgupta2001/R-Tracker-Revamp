// Path planner code generation (node --test): js/pathplanner/codegen.js emits Pedro
// Pathing 3 (Paths.line / curve / path with PoseFactory.degrees()) and none of the
// 2.x API (BezierLine, PathChain, pathBuilder, setLinearHeadingInterpolation).
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
const OLD_API = /BezierLine|BezierCurve|PathChain|pathBuilder|setLinearHeadingInterpolation|Math\.toRadians|Follower/;

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
    '// Wait 500ms at point2 (Intake)',
    'public Path path1() {',
    'return line(point1, point2).linear(point1, point2);',
    'return curve(point2, p.of(45.00, 60.00, 0), point3).linear(point2, point3);',
    'public Path fullPath() {',
    'return path(path1(), path2());',
    'schedule(follow(follower, fullPath()));',
  ]) assert.ok(code.includes(line), 'missing: ' + line + '\n' + code);
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
