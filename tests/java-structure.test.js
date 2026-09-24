// Java structure parser (js/java-structure.js), node --test: tokenizer literals, block kinds for every
// construct the checker relies on, statements, call chains, reachability, flowsTo, dead code, exact
// line numbers, loop/init bodies, garbage tolerance, fixture counts, performance and shingle coverage.
// The parser only reads text; nothing here runs student code.
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
  sandbox.window.__RT_JSTRUCT_DEBUG = true;        // query helpers rethrow instead of returning a fallback
  for (const f of files) vm.runInNewContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
  return sandbox.window;
}
const win = loadClassic(['js/java-structure.js']);
const J = win.RTJavaStructure;
const read = f => fs.readFileSync(path.join(SAMPLES, f), 'utf8');
const plain = x => (x === undefined ? x : JSON.parse(JSON.stringify(x)));   // sandbox arrays have another realm's prototype
const deq = (a, b, msg) => assert.deepEqual(plain(a), plain(b), msg);
const tokensOf = src => J.tokenize(src).tokens.filter(t => t.type !== 'eof');
const kindsOnLine = (m, line) => m.blocks.filter(b => b.line === line && b.kind !== 'root').sort((a, b) => a.open - b.open).map(b => b.kind);
const call = (m, name, line) => m.calls.find(c => c.name === name && (line == null || c.line === line));

test('exports and version', () => {
  assert.equal(J.VERSION, 'jstruct-1');
  for (const k of ['tokenize', 'parse', 'shingles', 'coverage']) assert.equal(typeof J[k], 'function', k);
});

test('tokenizer: literal forms', () => {
  const src = "char a = '{'; char b = '}'; char q = '\"'; char n = '\\n'; char c = 'A'; char s = '\\'';\n" +
    'String str = "a\\"b{\\t}"; int k = 1_000; int h = 0x1F; int bb = 0b101; double e = 1e-3; double f = .5;\n' +
    'long L = 12L; float F = 1.5f; double D = 2d; boolean t = true; Object o = null;';
  const toks = tokensOf(src);
  deq(toks.filter(t => t.type === 'char').map(t => t.value), ['{', '}', '"', '\n', 'A', "'"]);
  deq(toks.filter(t => t.type === 'string').map(t => t.value), ['a"b{\t}']);
  deq(toks.filter(t => t.type === 'number').map(t => t.value), ['1_000', '0x1F', '0b101', '1e-3', '.5', '12L', '1.5f', '2d']);
  deq(toks.filter(t => t.type === 'keyword' && /^(true|null)$/.test(t.value)).map(t => t.value), ['true', 'null']);
  const str = toks.find(t => t.type === 'string');
  assert.equal(str.raw, '"a\\"b{\\t}"');
  assert.equal(str.line, 2);
  assert.equal(toks[0].col, 1);
  assert.equal(toks.find(t => t.value === 'L').line, 3);
  assert.equal(J.tokenize(src).diagnostics.length, 0);
});

test('tokenizer: char literals with braces and quotes keep braces balanced', () => {
  const m = J.parse("class A {\n  void f() {\n    char o = '{'; char q = '\"'; String s = \"}{\";\n    if (o == '}') g();\n  }\n}\n");
  assert.equal(m.ok, true);
  deq(plain(m.diagnostics), []);
  deq(m.blocks.map(b => b.kind), ['root', 'type', 'method', 'if']);
  assert.equal(m.blocks[2].endLine, 5);
  assert.equal(call(m, 'g').line, 4);
});

test('tokenizer: text block', () => {
  const src = 'String t = """\n    hi {\n      there\n    """;\nint after = 1;';
  const toks = tokensOf(src);
  const tb = toks.find(t => t.type === 'string');
  assert.equal(tb.textBlock, true);
  assert.equal(tb.value, 'hi {\n  there\n');
  assert.equal(tb.line, 1);
  assert.equal(toks.find(t => t.value === ';').line, 4);
  assert.equal(toks.find(t => t.value === 'after').line, 5);
  assert.equal(J.parse('class A { String t = """\n  {\n  """; }').ok, true);
});

test('tokenizer: annotations, operators, comments', () => {
  const ann = tokensOf('@TeleOp(name = "x")\n@org.junit.Test class A {}');
  deq(ann.slice(0, 6).map(t => [t.type, t.value]), [['annotation', '@TeleOp'], ['punct', '('], ['ident', 'name'], ['op', '='], ['string', 'x'], ['punct', ')']]);
  assert.equal(ann[0].name, 'TeleOp');
  assert.equal(ann[6].value, '@org.junit.Test');
  assert.equal(ann[6].name, 'Test');
  const m = J.parse('@TeleOp(name = "x")\npublic class A extends LinearOpMode { public void runOpMode() {} }');
  assert.equal(m.assigns.length, 0, 'annotation arguments are not assignments');
  deq(plain(m.types[0].annotations), ['TeleOp']);
  assert.equal(m.types[0].annotationDetails[0].args.text, 'name = "x"');

  const ops = s => tokensOf(s).filter(t => t.type === 'op').map(t => t.value);
  deq(ops('x -> y'), ['->']);
  deq(ops('x - > y'), ['-', '>']);
  deq(ops('i-->0'), ['--', '>']);
  deq(ops('a >>>= 2; b >>= 1; c <<= 3; d >>> 1'), ['>>>=', '>>=', '<<=', '>>>']);
  deq(ops('Foo::bar; f(int... xs)'), ['::', '...']);
  deq(ops('a == b != c <= d >= e && f || g'), ['==', '!=', '<=', '>=', '&&', '||']);

  const lex = J.tokenize('// hello there\n/* block\n * two */\n\n/** doc */\nint x; // trailing\nint y;');
  deq(plain(lex.comments.map(c => [c.kind, c.text, c.line, c.endLine, c.nextCodeLine])), [
    ['line', 'hello there', 1, 1, 6], ['block', 'block\ntwo', 2, 3, 6], ['doc', 'doc', 5, 5, 6], ['line', 'trailing', 6, 6, 7]]);
  assert.equal(lex.comments[3].trailing, true);
});

test('tokenizer: broken input yields diagnostics, never throws', () => {
  const r = J.tokenize('String s = "abc;\nint x = 1;');
  deq(plain(r.diagnostics.map(d => [d.kind, d.line])), [['unterminated-string', 1]]);
  assert.equal(r.tokens.find(t => t.value === 'int').line, 2);
  deq(plain(J.tokenize('/* never closed\nx').diagnostics.map(d => d.kind)), ['unterminated-comment']);
  deq(plain(J.tokenize('int x = 1 # 2;').diagnostics.map(d => d.kind)), ['unknown-char']);
  const p = J.parse('class A { void f() { String s = "open; } }');
  assert.equal(p.ok, false);
  assert.ok(p.diagnostics.some(d => d.kind === 'unterminated-string'));
  assert.equal(J.parse('class A { void f() { }').ok, false);
  deq(plain(J.parse('class A { void f() { }').diagnostics.map(d => [d.kind, d.line])), [['unbalanced-brace', 1]]);
  deq(plain(J.parse('class A { }\n}').diagnostics.map(d => [d.kind, d.line])), [['unbalanced-brace', 2]]);
});

const CONSTRUCTS = [
  /*  1 */ '@TeleOp(name = "x")',
  /*  2 */ 'public class A extends LinearOpMode implements Runnable {',
  /*  3 */ '  interface Shape { double area(); }',
  /*  4 */ '  enum Mode { IDLE, RUN(2) { int f() { return 1; } }, STOP; Mode() {} Mode(int x) {} }',
  /*  5 */ '  record Point(int x, int y) { Point { if (x < 0) throw new IllegalArgumentException(); } }',
  /*  6 */ '  static { init0(); }',
  /*  7 */ '  { inst0(); }',
  /*  8 */ '  int[] arr = {1, 2, 3};',
  /*  9 */ '  public A() { super(); }',
  /* 10 */ '  public void runOpMode() {',
  /* 11 */ '    if (a) { x(); } else if (b) { y(); } else { z(); }',
  /* 12 */ '    while (opModeIsActive()) { loopy(); }',
  /* 13 */ '    do { once(); } while (!isStopRequested());',
  /* 14 */ '    for (int i = 0; i < 3; i++) { f(i); }',
  /* 15 */ '    for (DcMotor m : motors) { m.setPower(0); }',
  /* 16 */ '    switch (mode) { case IDLE -> idle(); case RUN -> { run1(); } default -> other(); }',
  /* 17 */ '    switch (k) { case 1: case 2: two(); break; default: dflt(); }',
  /* 18 */ '    try { risky(); } catch (IOException | RuntimeException e) { log(e); } finally { fin(); }',
  /* 19 */ '    list.forEach(v -> { use(v); });',
  /* 20 */ '    button.onPress(new Runnable() { public void run() { inner(); } });',
  /* 21 */ '    int[][] grid = new int[][] { {1}, {2} };',
  /* 22 */ '    synchronized (this) { sync(); }',
  /* 23 */ '    outer: for (;;) { break outer; }',
  /* 24 */ '    if (c) single(); else other2();',
  /* 25 */ '  }',
  /* 26 */ '}'
].join('\n');

test('block kinds for every construct', () => {
  const m = J.parse(CONSTRUCTS);
  assert.equal(m.ok, true, JSON.stringify(m.diagnostics));
  const expect = {
    2: ['type'], 3: ['type'], 4: ['type', 'anon', 'method', 'ctor', 'ctor'], 5: ['type', 'ctor', 'if'], 6: ['init'], 7: ['init'],
    8: ['array'], 9: ['ctor'], 10: ['method'], 11: ['if', 'if', 'else'], 12: ['while'], 13: ['do'], 14: ['for'], 15: ['foreach'],
    16: ['switch', 'plain'], 17: ['switch'], 18: ['try', 'catch', 'finally'], 19: ['lambda'], 20: ['anon', 'method'],
    21: ['array', 'array', 'array'], 22: ['synchronized'], 23: ['for'], 24: ['if', 'else']
  };
  for (const [line, kinds] of Object.entries(expect)) deq(plain(kindsOnLine(m, +line)), kinds, 'line ' + line);
  deq(plain(m.types.map(t => [t.name, t.kind])), [['A', 'class'], ['Shape', 'interface'], ['Mode', 'enum'], ['Point', 'record']]);
  const A = m.typeNamed('A');
  assert.equal(A.extends, 'LinearOpMode');
  deq(plain(A.implements), ['Runnable']);
  deq(plain(m.typeNamed('Mode').enumConstants), ['IDLE', 'RUN', 'STOP']);
  deq(plain(m.fieldsOf('Point').map(f => f.name)), ['x', 'y']);
  assert.ok(m.methodsOf('Shape').some(x => x.name === 'area' && x.abstract), 'interface method signature');
  // if / else-if / else chain
  const [if1, if2, els] = m.blocks.filter(b => b.line === 11).sort((a, b) => a.open - b.open);
  assert.equal(if2.elseOf, if1);
  assert.equal(els.elseOf, if2);
  assert.equal(if1.cond.text, 'a');
  // do/while gets its tail condition; braceless bodies are blocks too
  const doB = m.blocks.find(b => b.kind === 'do');
  assert.equal(doB.cond.text, '!isStopRequested()');
  assert.equal(doB.loop, true);
  const b24 = m.blocks.filter(b => b.line === 24);
  assert.ok(b24.every(b => b.braceless));
  assert.equal(call(m, 'single').condChain[0].text, 'c');
  assert.equal(call(m, 'other2').condChain[0].negated, true);
  // case arrows are not lambdas; labels are statements
  assert.equal(m.blocks.filter(b => b.kind === 'lambda').length, 1);
  deq(plain(call(m, 'idle').condChain.map(c => c.text)), ['case IDLE', 'mode']);
  deq(plain(call(m, 'run1').condChain.map(c => c.text)), ['case RUN', 'mode']);
  deq(plain(call(m, 'two').condChain[0].labels), ['1', '2']);
  const label = m.statements.find(s => s.kind === 'label' && s.line === 23);
  assert.equal(m.textOf(label), 'outer :');
  // the anonymous class and lambda are children of the statement that passes them
  const anon = m.blocks.find(b => b.kind === 'anon' && b.line === 20);
  assert.equal(anon.argOf, call(m, 'onPress'));
  assert.equal(anon.parent.kind, 'method');
  assert.equal(call(m, 'super').ctorCall, true);
  assert.equal(m.blocks.find(b => b.kind === 'for' && b.line === 23).cond.constantTrue, true);
});

test('statements and declarations', () => {
  const m = J.parse([
    'class R extends LinearOpMode {',
    '  DcMotor left, right;',
    '  public void runOpMode() {',
    '    double a = 1, b;',
    '    for (DcMotor m : motors) { m.setPower(0); }',
    '    intake;',
    '    switch (s) { case A -> go(); default -> stop(); }',
    '    var r = new Robot(hardwareMap);',
    '    try (Res res = open()) { } catch (A | B e) { }',
    '    list.sort((p1, p2) -> p1 - p2);',
    '  }',
    '}'].join('\n'));
  assert.equal(m.ok, true);
  deq(plain(m.fields.map(f => [f.name, f.typeText, f.owner.name])), [['left', 'DcMotor', 'R'], ['right', 'DcMotor', 'R']]);
  const d = n => m.decls.find(x => x.name === n);
  assert.equal(d('a').scope, 'local');
  assert.equal(m.textOf(d('a').init), '1');
  assert.equal(d('b').init, null);
  assert.equal(d('b').typeText, 'double');
  assert.equal(d('m').scope, 'foreach');
  assert.equal(d('m').typeText, 'DcMotor');
  assert.equal(m.textOf(d('m').init), 'motors');
  assert.equal(d('r').inferredType, 'Robot');
  assert.equal(m.typeOfVar('r', call(m, 'open')), 'Robot');
  assert.equal(m.typeOfVar('r', call(m, 'go')), null, 'not visible before its declaration');
  assert.equal(d('res').scope, 'local');
  assert.equal(d('e').scope, 'catch');
  assert.equal(d('e').typeText, 'A | B');
  deq(plain(m.decls.filter(x => x.scope === 'lambda').map(x => x.name)), ['p1', 'p2']);
  const kinds = line => m.statements.filter(s => s.line === line && s.block.kind !== 'root' && s.block.kind !== 'lambda').map(s => s.kind);
  deq(plain(kinds(4)), ['decl']);
  deq(plain(kinds(6)), ['junk']);
  deq(plain(kinds(7)), ['block', 'label', 'call', 'label', 'call']);
  assert.equal(m.isDeclared('right'), true);
  assert.equal(m.isDeclared('a', call(m, 'go')), true);
  assert.equal(m.isDeclared('m', call(m, 'go')), false, 'foreach var is out of scope after its loop');
  deq(plain(m.varsOfType(/DcMotor/).map(x => x.name)), ['m', 'left', 'right']);
});

test('calls: receiver chains, argument text, chain roots and lambda nesting', () => {
  const m = J.parse([
    'class T {',
    '  void f() {',
    '    robot.drivetrain.drive(-gamepad1.left_stick_y, x);',
    '    motor = hardwareMap.get(DcMotor.class, "left_drive");',
    '    Path p = line(a, b).linear(a, b);',
    '    this.claw.setPosition(1);',
    '    Command c = Command.build().setStart(() -> { a(); b(); }).setDone(() -> t.seconds() >= s);',
    '  }',
    '}'].join('\n'));
  const drive = call(m, 'drive');
  deq(plain(drive.receiverChain), ['robot', 'drivetrain']);
  assert.equal(drive.receiverText, 'robot.drivetrain');
  assert.equal(drive.chainRoot, 'robot');
  deq(plain(drive.args.map(a => a.text)), ['- gamepad1 . left_stick_y', 'x']);
  assert.equal(drive.isStatementHead, true);
  assert.equal(drive.line, 3);
  deq(plain(call(m, 'get').args.map(a => a.text)), ['DcMotor . class', '"left_drive"']);
  assert.equal(call(m, 'get').isStatementHead, false);
  const linear = call(m, 'linear');
  deq(plain(linear.receiverChain), []);
  assert.equal(linear.receiverIsCall, true);
  assert.equal(linear.chainRoot, 'line');
  assert.equal(linear.receiverCall, call(m, 'line'));
  assert.equal(call(m, 'line').chainRoot, 'line');
  deq(plain(call(m, 'setPosition').receiverChain), ['claw']);
  for (const n of ['setStart', 'setDone']) assert.equal(call(m, n).chainRoot, 'Command.build', n);
  assert.equal(call(m, 'build').chainRoot, 'Command');
  assert.equal(call(m, 'setDone').chainStart, call(m, 'build').chainStart);
  const lam = call(m, 'a').block;
  assert.equal(lam.kind, 'lambda');
  assert.equal(call(m, 'b').block, lam);
  assert.equal(lam.argOf, call(m, 'setStart'));
  assert.equal(lam.argIndex, 0);
  const arg = call(m, 'setStart').args[0];
  assert.ok(arg.start <= lam.header.start && lam.close < arg.end, 'lambda sits inside the setStart argument');
  const done = call(m, 'seconds').block;
  assert.equal(done.kind, 'lambda');
  assert.equal(done.argOf, call(m, 'setDone'));
});

test('reachability on capstone-good.java', () => {
  const src = read('capstone-good.java');
  const m = J.parse(src);
  assert.equal(m.methodsNamed('seesRed')[0].reachable, true);
  assert.equal(m.methodsNamed('filteredDistance')[0].reachable, true);
  deq(plain(m.entryMethods().map(x => x.name)), ['init', 'init_loop', 'start', 'loop']);
  assert.ok(m.methods.every(x => x.reachable), 'every method of the good sample is reachable');
  const withUnused = src.replace(/\}\s*$/, '    private void unused() { follower.update(); }\n}\n');
  const u = J.parse(withUnused);
  assert.equal(u.ok, true);
  const unused = u.methodsNamed('unused')[0];
  assert.equal(unused.reachable, false);
  const inside = u.calls.find(c => c.method === unused);
  assert.equal(inside.name, 'update');
  assert.equal(inside.reachable, false);
  assert.equal(inside.live, false);
  assert.equal(u.callsNamed('update', { receiver: 'follower', live: true }).length, 1);
});

test('flowsTo: sensor reading reaches the decision (phase3-good.java)', () => {
  const m = J.parse(read('phase3-good.java'));
  const cond = m.conds.find(c => c.text === 'cm < 20');
  assert.ok(cond.hasComparison);
  const r = m.flowsTo(t => t.value === 'getDistance', { start: cond.start, end: cond.end });
  assert.equal(r.ok, true);
  assert.equal(r.hops, 2);
  deq(plain(r.via.map(v => [v.name, v.kind, v.line])), [['cm', 'decl', 32], ['sum', 'assign', 31]]);
  assert.equal(m.flowsTo(t => t.value === 'getDistance', { start: cond.start, end: cond.end }, { maxHops: 1 }).ok, false);
  const timerCond = m.conds.find(c => c.text === 'timer.seconds() > 2.0');
  assert.equal(m.flowsTo(t => t.value === 'getDistance', timerCond).ok, false);
});

test('flowsTo: PID output reaches setPower through a return (phase4-good.java)', () => {
  const m = J.parse(read('phase4-good.java'));
  const sp = m.callsNamed('setPower', { receiver: 'lift' })[0];
  const r = m.flowsTo(t => t.value === 'kP', sp.args[0]);
  assert.equal(r.ok, true);
  assert.equal(r.hops, 2);
  deq(plain(r.via.map(v => [v.name, v.kind, v.line])), [['power', 'decl', 91], ['update', 'return', 30]]);
  assert.equal(m.flowsTo(t => t.value === 'kP', sp.args[0], { crossMethod: false }).ok, false);
  const srcs = m.exprSources(sp.args[0], sp.method, 3).map(x => m.textOf(x));
  assert.ok(srcs.includes('target - current'), 'the callee locals are followed after the return hop');
  assert.equal(m.typeOfVar('liftPid', sp), 'LiftController');
  assert.equal(m.resolveCall(call(m, 'update', 91)).how, 'type');
  assert.equal(m.resolveCall(call(m, 'update', 88)).how, 'external');
});

test('dead code: constant-false conditions and code after return', () => {
  const m = J.parse([
    'class D extends LinearOpMode {',
    '  public void runOpMode() {',
    '    if (false) { deadA(); }',
    '    if (0 == 1) deadB();',
    '    if (false && ready) deadC();',
    '    if (1 != 1) { deadD(); } else { alive1(); }',
    '    if (x == 1) { alive2(); }',
    '    if (ok) return;',
    '    alive3();',
    '    return;',
    '    deadE();',
    '  }',
    '}'].join('\n'));
  const dead = m.calls.filter(c => c.dead).map(c => c.name).sort();
  deq(plain(dead), ['deadA', 'deadB', 'deadC', 'deadD', 'deadE']);
  for (const n of ['alive1', 'alive2', 'alive3']) { assert.equal(call(m, n).dead, false, n); assert.equal(call(m, n).live, true, n); }
  assert.equal(m.conds.find(c => c.text === 'false').constantFalse, true);
  assert.equal(m.conds.find(c => c.text === 'x == 1').constantFalse, false);
});

test('call lines match grep -n on phase1-good.java', () => {
  const src = read('phase1-good.java');
  const m = J.parse(src);
  for (const name of ['setPower', 'addData']) {
    const expected = [];
    src.split('\n').forEach((l, i) => { const k = l.split(name + '(').length - 1; for (let j = 0; j < k; j++) expected.push(i + 1); });
    assert.ok(expected.length >= 2);
    deq(plain(m.callsNamed(name).map(c => c.line)), expected, name);
  }
  for (const t of m.tokens) if (t.type !== 'eof') assert.equal(src.split('\n')[t.line - 1].slice(t.col - 1, t.col - 1 + t.raw.length), t.raw);
  assert.equal(m.lineText(32), '            leftDrive.setPower(drive + turn);');
  assert.equal(m.lineCount, src.split('\n').length);
});

test('loopBodies() and initBodies(): LinearOpMode vs iterative OpMode', () => {
  const p1 = J.parse(read('phase1-good.java'));
  const lb1 = p1.loopBodies();
  deq(plain(lb1.map(b => [b.kind, b.line])), [['while', 28]]);
  const ib1 = p1.initBodies();
  deq(plain(ib1.map(r => [r.kind, r.method.name, r.statements.length])), [['runOpMode', 'runOpMode', 4]]);
  deq(plain(p1.callsNamed('get').map(c => p1.inInit(c))), [true, true, true]);
  assert.equal(p1.inInit(call(p1, 'waitForStart')), false);
  deq(plain(p1.callsNamed('setPower').map(c => c.inLoop)), [true, true]);
  assert.equal(p1.callsNamed('setPosition', { within: lb1 }).length, 2);
  deq(plain(p1.callsNamed('setPosition').map(c => c.condChain.map(x => (x.negated ? '!' : '') + x.text))),
    [['gamepad1.a', 'opModeIsActive()'], ['gamepad1.b', '!gamepad1.a', 'opModeIsActive()']]);

  const p4 = J.parse(read('phase4-good.java'));
  const lb4 = p4.loopBodies();
  deq(plain(lb4.map(b => [b.kind, b.line, b.methodRef.name])), [['method', 86, 'loop']]);
  deq(plain(p4.initBodies().map(r => r.kind)), ['init', 'start']);
  assert.equal(p4.inInit(p4.callsNamed('create')[0]), true);
  assert.equal(p4.callsNamed('execute', { inLoop: true }).length, 1);
  const within = p4.callsIn(lb4[0], 2);
  assert.equal(within.filter(c => c.name === 'update').length, 2);   // follower.update and liftPid.update (whose body has no calls)
  assert.equal(within.via.length, within.length);
  const after = J.parse(read('phase2-good.java'));
  const loop = after.loopBodies()[0];
  deq(plain(after.after(loop).map(s => after.textOf(s))), ['robot.drivetrain.stop();']);
});

test('garbage and damaged input never throws', () => {
  const inputs = ['', 'The quick brown fox jumps over the lazy dog; it was {not} amused!',
    'def f(x):\n    return x * 2\n\nprint(f(3))  # python\n', '{'.repeat(3000), '}'.repeat(3000),
    '"""\nunterminated', "'", '->->->', 'for (;;', 'x.', '.5.5.5', '@', 'if (a) if (b) x(); else y(); else z();'];
  const files = fs.readdirSync(SAMPLES).filter(f => f.endsWith('.java')).sort();
  for (const f of files) {
    const src = read(f);
    for (let off = 0; off < 20; off++) {
      let s = '';
      for (let i = 0; i < src.length; i++) if ((i + off) % 50 !== 0) s += src[i];
      inputs.push(s);
    }
  }
  for (const s of inputs) {
    let m;
    assert.doesNotThrow(() => { m = J.parse(s); });
    assert.ok(Array.isArray(m.blocks) && Array.isArray(m.calls) && typeof m.ok === 'boolean');
    assert.ok(!m.diagnostics.some(d => d.kind === 'internal'), 'internal error on ' + JSON.stringify(s.slice(0, 60)) + ': ' + JSON.stringify(m.diagnostics.filter(d => d.kind === 'internal')));
    assert.doesNotThrow(() => {
      m.loopBodies(); m.initBodies(); m.entryMethods(); m.typesExtending(/OpMode/);
      for (const c of m.calls.slice(0, 40)) { m.flowsTo(t => t.value === 'kP', c); m.enclosing(c); m.callsIn(c.block, 2); m.declOf(c.rootIdent, c); }
      for (const b of m.blocks.slice(0, 40)) m.after(b);
    });
  }
  assert.equal(J.parse('{'.repeat(3000)).ok, false);
  assert.equal(J.parse('').ok, true);
  assert.equal(J.parse('').types.length, 0);
  assert.equal(J.parse(null).ok, true);
});

test('every fixture parses; counts for the good samples', () => {
  const files = fs.readdirSync(SAMPLES).filter(f => f.endsWith('.java'));
  assert.ok(files.length >= 12);
  for (const f of files) {
    const m = J.parse(read(f));
    assert.equal(m.ok, true, f + ' ' + JSON.stringify(m.diagnostics));
  }
  const COUNTS = {                     // types (incl. nested enums), methods (incl. ctors), calls
    'phase1-good.java': [1, 1, 15],
    'phase2-good.java': [5, 9, 19],
    'phase3-good.java': [2, 1, 24],
    'phase4-good.java': [2, 8, 48],
    'advanced_command-good.java': [2, 9, 34],
    'capstone-good.java': [7, 20, 72]
  };
  for (const [f, [types, methods, calls]] of Object.entries(COUNTS)) {
    const m = J.parse(read(f));
    deq([m.types.length, m.methods.length, m.calls.length], [types, methods, calls], f);
    assert.equal(m.statements.filter(s => s.kind === 'junk').length, 0, f);
    assert.ok(m.typesExtending(/^(Linear)?OpMode$/).length === 1, f);
  }
});

test('performance: 50 KB parses in under 200 ms', () => {
  const big = read('phase4-good.java').repeat(14);
  assert.ok(big.length >= 50000);
  const t0 = performance.now();
  const m = J.parse(big);
  const ms = performance.now() - t0;
  assert.equal(m.calls.length, 48 * 14);
  assert.ok(ms < 200, 'parse took ' + ms.toFixed(1) + ' ms');
});

test('shingles and coverage', () => {
  const x = read('phase4-good.java');
  assert.equal(J.coverage(x, x, 5), 1);
  assert.equal(J.coverage('', x, 5), 0);
  assert.equal(J.coverage('a b c', 'a b c', 5), 1, 'short subjects still cover themselves');
  deq(plain(J.shingles('int  x = 1; // note\n/* c */ y', 3)), ['int x =', 'x = 1', '= 1 ;', '1 ; y']);
  deq(plain(J.shingles('String s = "a b";', 5)), ['String s = a b ;']);
  assert.equal(J.coverage('int x = 1; // comment', 'int   x=1;', 3), 1, 'comments and whitespace are ignored');
  assert.equal(J.coverage(x, [read('phase1-good.java'), x], 5), 1, 'reference may be an array of sources');
  const other = J.coverage(read('phase1-good.java'), x, 5);
  assert.ok(other > 0 && other < 0.5, 'different programs share little: ' + other);
});
