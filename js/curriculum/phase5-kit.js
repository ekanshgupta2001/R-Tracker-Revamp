// ── R-Tracker v2 — Phase 5 "Debug Under Pressure" kit ───────────────────────
// A complete Phase 4-style autonomous ("BuzzAuto": Intake, Lift with a P
// controller, Robot, and a LinearOpMode state machine on Pedro Pathing 3 + Ivy)
// with five seeded bugs, one per Phase 5 lesson, plus a three-state check for
// each bug. The lesson shows `source` (Copy / Load into the deliverable
// editor); the code checker turns every bug into a 15-point criterion
// (fixed 1 / changed 0.5 / broken 0) and gates on `similarity`.
//
// HARD RULE: student code is never executed. Every check reads the structural
// model built by js/java-structure.js (tokens, blocks, calls, assignments,
// conditions) and nothing else.
//
// check(ctx, H) receives ctx = { phaseId, src, model, comments, refs, H } and
// relies only on H.ev, H.opMode, H.loopBodies and H.callsIn (with fallbacks to
// the model when H is missing). Checks never throw.
//
// Exposes: window.RT_PHASE5_KIT = { id, version, title, source, similarity(ctx), bugs[] }

(function () {
  'use strict';

  var SOURCE = [
    'package org.firstinspires.ftc.teamcode;',
    '',
    'import com.qualcomm.robotcore.eventloop.opmode.Autonomous;',
    'import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;',
    'import com.qualcomm.robotcore.hardware.DcMotor;',
    'import com.qualcomm.robotcore.hardware.DcMotorEx;',
    'import com.qualcomm.robotcore.hardware.HardwareMap;',
    'import com.qualcomm.robotcore.util.ElapsedTime;',
    'import com.qualcomm.robotcore.util.Range;',
    'import com.pedropathing.api.PoseFactory;',
    'import com.pedropathing.follower.Follower;',
    'import com.pedropathing.ivy.Scheduler;',
    'import com.pedropathing.math.Pose;',
    'import com.pedropathing.paths.Path;',
    'import org.firstinspires.ftc.teamcode.pedro.Constants;',
    '',
    'import static com.pedropathing.api.Paths.*;',
    'import static com.pedropathing.ivy.Scheduler.schedule;',
    'import static com.pedropathing.ivy.pedro.PedroCommands.follow;',
    '',
    '// Front roller: positive power pulls a game piece in, negative spits it out',
    'class Intake {',
    '    enum Mode { IDLE, RUNNING }',
    '    private final DcMotor motor;',
    '    private Mode mode = Mode.IDLE;',
    '',
    '    Intake(HardwareMap hw) {',
    '        motor = hw.get(DcMotor.class, "intake");',
    '    }',
    '',
    '    public void run(double power) {',
    '        motor.setPower(power);',
    '        mode = power == 0 ? Mode.IDLE : Mode.RUNNING;',
    '    }',
    '}',
    '',
    '// Linear slide, held at its target by a P controller on the encoder',
    'class Lift {',
    '    enum Mode { AUTO, MANUAL }',
    '    static final double LIFT_KP = 50.0;',
    '    private final DcMotorEx motor;',
    '    private Mode mode = Mode.MANUAL;',
    '    private int target = 0;',
    '',
    '    Lift(HardwareMap hw) {',
    '        motor = hw.get(DcMotorEx.class, "lift");',
    '        motor.setMode(DcMotor.RunMode.STOP_AND_RESET_ENCODER);',
    '        motor.setMode(DcMotor.RunMode.RUN_WITHOUT_ENCODER);',
    '    }',
    '',
    '    // Only the autonomous routine may move the lift to a preset height',
    '    public void goTo(int ticks) {',
    '        if (mode != Mode.AUTO) return;',
    '        target = ticks;',
    '    }',
    '',
    '    public void update() {',
    '        double error = target - motor.getCurrentPosition();',
    '        double power = LIFT_KP * error;',
    '        motor.setPower(Range.clip(power, -1, 1));',
    '    }',
    '',
    '    public int position() {',
    '        return motor.getCurrentPosition();',
    '    }',
    '}',
    '',
    '// Everything on the robot, built once from the hardware map',
    'class Robot {',
    '    final Follower follower;',
    '    final Intake intake;',
    '    final Lift lift;',
    '',
    '    Robot(HardwareMap hw) {',
    '        follower = Constants.create(hw);',
    '        intake = new Intake(hw);',
    '        lift = new Lift(hw);',
    '    }',
    '',
    '    // Keeps every subsystem running; call it every loop',
    '    public void update() {',
    '        follower.update();',
    '        lift.update();',
    '    }',
    '}',
    '',
    '@Autonomous(name = "BuzzAuto")',
    'public class BuzzAuto extends LinearOpMode {',
    '    enum State { TO_SCORE, SCORE, TO_PARK, DONE }',
    '    static final int LIFT_HIGH = 2200;',
    '',
    '    // Inches from the bottom-left corner, heading in degrees (0 = +x, counter-clockwise)',
    '    private final PoseFactory p = PoseFactory.degrees();',
    '    private final Pose startPose = p.of(9, 60, 0);',
    '    private final Pose scorePose = p.of(40, 72, 45);',
    '    private final Pose parkPose = p.of(60, 108, 90);',
    '',
    '    private Robot robot;',
    '    private State state = State.TO_SCORE;',
    '    private final ElapsedTime timer = new ElapsedTime();',
    '',
    '    private Path toScore() {',
    '        return line(startPose, scorePose).linear(startPose, scorePose);',
    '    }',
    '',
    '    private Path toPark() {',
    '        return line(scorePose, parkPose).linear(scorePose, parkPose);',
    '    }',
    '',
    '    @Override',
    '    public void runOpMode() {',
    '        Scheduler.reset();',
    '        robot = new Robot(hardwareMap);',
    '        robot.follower.setPose(startPose);',
    '        telemetry.addData("Status", "Ready");',
    '        telemetry.update();',
    '',
    '        waitForStart();',
    '        schedule(follow(robot.follower, toScore()));',
    '',
    '        while (opModeIsActive()) {',
    '            robot.follower.update();',
    '            Scheduler.execute();',
    '            robot.update();',
    '',
    '            switch (state) {',
    '                case TO_SCORE:',
    '                    // At the basket: raise the lift and start the scoring timer',
    '                    if (robot.follower.isBusy()) {',
    '                        state = State.SCORE;',
    '                        robot.lift.goTo(LIFT_HIGH);',
    '                        timer.reset();',
    '                    }',
    '                    break;',
    '                case SCORE:',
    '                    // Spit the piece out for 1.5 s, then drive to park',
    '                    if (timer.seconds() < 1.5) {',
    '                        robot.intake.run(-1.0);',
    '                    } else {',
    '                        robot.intake.run(0);',
    '                        schedule(follow(robot.follower, toPark()));',
    '                        state = State.TO_PARK;',
    '                    }',
    '                    break;',
    '                case TO_PARK:',
    '                    if (!robot.follower.isBusy()) state = State.DONE;',
    '                    break;',
    '                case DONE:',
    '                    break;',
    '            }',
    '',
    '            telemetry.addData("State", state);',
    '            telemetry.addData("Pose", robot.follower.pose());',
    '            telemetry.addData("Lift", robot.lift.position());',
    '            telemetry.addData("Busy", robot.follower.isBusy());',
    '        }',
    '    }',
    '}'
  ].join('\n') + '\n';

  // ── Small helpers over the model ────────────────────────────────────────────
  function toks(M) { return M.tokens || []; }
  function isOp(t, v) { return !!t && t.type === 'op' && t.value === v; }
  function isP(t, v) { return !!t && t.type === 'punct' && t.value === v; }
  function isIdent(t) { return !!t && t.type === 'ident'; }
  function isKw(t, v) { return !!t && t.type === 'keyword' && t.value === v; }

  function modelOf(ctx) {
    if (ctx && ctx.model) return ctx.model;
    var J = window.RTJavaStructure;
    return J ? J.parse(String((ctx && ctx.src) || '')) : null;
  }
  function helpers(ctx, H) { return H || (ctx && ctx.H) || {}; }

  function evLine(M, H, line) {
    if (H && typeof H.ev === 'function') {
      var e = H.ev(line);
      if (e) return e;
    }
    var txt = M && M.lineText ? String(M.lineText(line) || '').trim() : '';
    return { line: line, text: txt.length > 100 ? txt.slice(0, 100) : txt };
  }
  function evidence(M, H, lines) {
    var seen = {}, out = [];
    lines.forEach(function (n) {
      if (typeof n !== 'number' || !(n > 0) || seen[n]) return;
      seen[n] = true;
      out.push(evLine(M, H, n));
    });
    return out;
  }

  function opModeType(M, H) {
    var T = null;
    if (H && typeof H.opMode === 'function') {
      try { T = H.opMode(); } catch (e) { T = null; }
    }
    if (T) return T;
    var list = M.types.filter(function (t) { return /^(Linear)?OpMode$/.test(t.extends || ''); });
    return list[0] || null;
  }

  // Control-loop bodies inside the OpMode (all of them when the OpMode has none).
  function loops(M, H) {
    var all = (H && typeof H.loopBodies === 'function') ? H.loopBodies() : M.loopBodies();
    all = all || [];
    var T = opModeType(M, H);
    if (!T) return all;
    var own = all.filter(function (b) { return b.typeRef === T || (b.typeRef && T.name && b.typeRef.name === T.name); });
    return own.length ? own : all;
  }

  function callsInLoop(M, H, block) {
    var list = (H && typeof H.callsIn === 'function') ? H.callsIn(block, 2) : M.callsIn(block, 2);
    list = list || [];
    var via = list.via || [];
    return list.map(function (c, i) { return { call: c, via: via[i] || { hops: 0, through: null } }; });
  }

  // Every call reached from the OpMode's control loops (≤ 2 hops), without duplicates or dead code.
  function loopCalls(M, H) {
    var seen = {}, out = [];
    loops(M, H).forEach(function (b) {
      callsInLoop(M, H, b).forEach(function (x) {
        if (!x.call || seen[x.call.id] || x.call.dead) return;
        seen[x.call.id] = true;
        out.push(x);
      });
    });
    return out;
  }

  function baseType(text) { return text ? String(text).replace(/<.*$/, '').replace(/\[\]/g, '').trim() : null; }

  // Type name of a dotted receiver chain (robot.follower → Follower), or null.
  function chainType(M, chain, at) {
    if (!chain || !chain.length) return null;
    var ty = baseType(M.typeOfVar(chain[0], at));
    if (!ty && M.typeNamed(chain[0])) ty = chain[0];
    for (var k = 1; ty && k < chain.length; k++) {
      var T = M.typeNamed(ty);
      if (!T) return null;
      var f = null;
      for (var j = 0; j < T.fields.length; j++) if (T.fields[j].name === chain[k]) { f = T.fields[j]; break; }
      ty = f ? baseType(f.typeText || f.type) : null;
    }
    return ty;
  }

  function isFollowerCall(M, c) {
    if (c.receiverChain && c.receiverChain.length) return chainType(M, c.receiverChain, c.start) === 'Follower';
    return /follower/i.test(c.receiverText || '');
  }

  function callLabel(c) { return (c.receiverText ? c.receiverText + '.' : '') + c.name + '()'; }

  function matchParen(T, open) {
    var depth = 0;
    for (var k = open; k < T.length; k++) {
      if (isP(T[k], '(')) depth++;
      else if (isP(T[k], ')')) { depth--; if (depth === 0) return k; }
    }
    return -1;
  }

  // Is the call whose name token sits at `i` logically negated where it stands?
  // Handles `!x.isBusy()`, `!(x.isBusy())`, `x.isBusy() == false`, `x.isBusy() != true`.
  function negatedAt(T, i) {
    var s = i, neg = false;
    while (s - 2 >= 0 && isP(T[s - 1], '.') && (isIdent(T[s - 2]) || isKw(T[s - 2], 'this'))) s -= 2;
    var e = matchParen(T, i + 1);
    if (e < 0) return false;
    e++;
    for (var guard = 0; guard < 20; guard++) {
      if (isOp(T[s - 1], '!')) { neg = !neg; s--; continue; }
      if (isP(T[s - 1], '(') && isP(T[e], ')')) { s--; e++; continue; }
      break;
    }
    var after = T[e], lit = T[e + 1];
    if ((isOp(after, '==') || isOp(after, '!=')) && (isKw(lit, 'true') || isKw(lit, 'false'))) {
      if ((after.value === '==') !== (lit.value === 'true')) neg = !neg;
    }
    var before = T[s - 1], lit2 = T[s - 2];
    if ((isOp(before, '==') || isOp(before, '!=')) && (isKw(lit2, 'true') || isKw(lit2, 'false'))) {
      if ((before.value === '==') !== (lit2.value === 'true')) neg = !neg;
    }
    return neg;
  }

  function numberOf(text) {
    var s = String(text || '').replace(/\s+/g, '').replace(/_/g, '');
    while (/^\(.*\)$/.test(s)) s = s.slice(1, -1);
    if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?[dDfFlL]?$/.test(s)) return null;
    var v = parseFloat(s.replace(/[dDfFlL]$/, ''));
    return isFinite(v) ? v : null;
  }

  // Numeric value of an operand token: a literal, or a name whose initialiser is one (≤ 2 hops).
  function operandValue(M, T, k) {
    var t = T[k];
    if (!t) return null;
    if (t.type === 'number') return { value: numberOf(t.value), line: t.line, name: t.value, literal: true };
    if (!isIdent(t)) return null;
    var name = t.value, at = k;
    for (var hop = 0; hop < 2; hop++) {
      var d = M.declOf(name, at);
      if (!d || !d.init) return null;
      var txt = M.textOf(d.init), v = numberOf(txt);
      if (v != null) return { value: v, line: d.line, name: t.value, literal: false };
      if (!/^[A-Za-z_$][\w$]*$/.test(txt)) return null;
      name = txt; at = d.init.start;
    }
    return null;
  }

  function tokenValue(T, k) { return T[k] ? T[k].value : ''; }

  function mentionsEncoder(M, T, k) {
    var d = M.declOf(tokenValue(T, k), k);
    if (!d) return false;
    var items = M.exprSources({ start: k, end: k + 1 }, d.method || null, 3) || [];
    return items.some(function (it) {
      for (var j = it.start; j < it.end; j++) if (T[j] && T[j].value === 'getCurrentPosition') return true;
      return false;
    });
  }
  function errorLike(M, T, k) {
    return isIdent(T[k]) && !isP(T[k + 1], '(') && (/err/i.test(T[k].value) || mentionsEncoder(M, T, k));
  }

  // ── Bug 1: follower.update() once per loop ────────────────────────────────
  function checkDoubleUpdate(ctx, H) {
    var M = modelOf(ctx);
    if (!loops(M, H).length) return { state: 'changed', explanation: 'No control loop (while (opModeIsActive())) was found, so the follower is never updated.', evidence: [] };
    var ups = loopCalls(M, H).filter(function (x) { return x.call.name === 'update' && x.call.args.length === 0 && isFollowerCall(M, x.call); });
    var lines = [];
    var parts = ups.map(function (x) {
      var c = x.call;
      if (x.via && x.via.hops > 0 && x.via.through) {
        lines.push(x.via.through.line, c.line);
        return 'through ' + callLabel(x.via.through) + ' at line ' + x.via.through.line + ' (' + callLabel(c) + ' at line ' + c.line + ')';
      }
      lines.push(c.line);
      return 'at line ' + c.line;
    });
    if (ups.length >= 2) {
      return { state: 'broken',
        explanation: 'follower.update() runs ' + parts[0] + ' and again ' + parts.slice(1).join(' and ') +
          ' — the follower integrates the pose and corrects twice every loop.',
        evidence: evidence(M, H, lines) };
    }
    if (ups.length === 1) {
      return { state: 'fixed', explanation: 'follower.update() now runs exactly once per loop, ' + parts[0] + '.', evidence: evidence(M, H, lines) };
    }
    return { state: 'changed', explanation: 'follower.update() no longer runs in the loop at all — removing both calls stops the follower instead of fixing the double update.', evidence: [] };
  }

  // ── Bug 2: the inverted isBusy() transition ───────────────────────────────
  function checkInvertedBusy(ctx, H) {
    var M = modelOf(ctx), T = toks(M);
    var assign = null;
    M.assigns.forEach(function (a) {
      if (assign || a.op !== '=' || a.dead) return;
      if (/(^|\.)SCORE$/.test(M.textOf(a.rhs).replace(/\s+/g, ''))) assign = a;
    });
    if (!assign) return { state: 'changed', explanation: 'Nothing assigns State.SCORE any more, so the TO_SCORE → SCORE transition is gone.', evidence: [] };
    var chain = ((M.enclosing(assign) || {}).condChain || []).filter(function (c) { return !c.caseLabel && c.block && c.block.kind === 'if'; });
    var hit = null;
    chain.forEach(function (c) {
      if (hit) return;
      for (var k = c.start; k < c.end; k++) {
        if (T[k] && T[k].value === 'isBusy' && isP(T[k + 1], '(')) { hit = { cond: c, neg: negatedAt(T, k) !== !!c.negated, line: T[k].line, text: c.text }; return; }
      }
      var f = M.flowsTo(function (tok) { return !!tok && tok.value === 'isBusy'; }, { start: c.start, end: c.end, method: c.method }, { maxHops: 2 });
      if (f && f.ok && typeof f.at === 'number') {
        var core = [];
        for (var j = c.start; j < c.end; j++) if (!isP(T[j], '(') && !isP(T[j], ')')) core.push(T[j]);
        var outer = core.length === 2 && isOp(core[0], '!') && isIdent(core[1]);
        hit = { cond: c, neg: (negatedAt(T, f.at) !== outer) !== !!c.negated, line: c.line, text: c.text, via: T[f.at].line };
      }
    });
    if (!hit) {
      return { state: 'changed',
        explanation: 'The transition to SCORE at line ' + assign.line + ' no longer checks isBusy(), so it no longer waits for the path to finish.',
        evidence: evidence(M, H, [assign.line]) };
    }
    var lines = [hit.line, assign.line].concat(hit.via ? [hit.via] : []);
    if (hit.neg) {
      return { state: 'fixed',
        explanation: 'The transition to SCORE (line ' + assign.line + ') now waits until the path has finished (' + (hit.cond.negated ? 'else of ' : '') + hit.text + ' at line ' + hit.line + ').',
        evidence: evidence(M, H, lines) };
    }
    return { state: 'broken',
      explanation: 'The transition to SCORE (line ' + assign.line + ') fires while ' + hit.text + ' is true at line ' + hit.line +
        ' — the robot starts scoring while it is still driving, instead of after the path finishes.',
      evidence: evidence(M, H, lines) };
  }

  // ── Bug 3: the kP catastrophe ─────────────────────────────────────────────
  function checkKp(ctx, H) {
    var M = modelOf(ctx), T = toks(M), OM = opModeType(M, H);
    var liftTypes = [];
    M.calls.forEach(function (c) {
      if (c.name === 'getCurrentPosition' && c.type && c.type !== OM && liftTypes.indexOf(c.type) < 0) liftTypes.push(c.type);
    });
    var goToOwner = (M.methodsNamed('goTo')[0] || {}).owner || null;
    var sinks = M.calls.filter(function (c) { return c.name === 'setPower' && !c.dead && c.args.length && liftTypes.indexOf(c.type) >= 0; });
    sinks.sort(function (a, b) { return (b.type === goToOwner) - (a.type === goToOwner) || (b.live === true) - (a.live === true) || a.start - b.start; });
    if (!sinks.length) return { state: 'changed', explanation: 'No setPower() driven from the lift encoder was found — the lift controller is gone.', evidence: [] };
    var found = null;
    sinks.forEach(function (sink) {
      if (found) return;
      var items = M.exprSources({ start: sink.args[0].start, end: sink.args[0].end }, sink.method || null, 3) || [];
      items.forEach(function (it) {
        for (var k = it.start; !found && k < it.end; k++) {
          var t = T[k];
          if (!isOp(t, '*') && !isOp(t, '/')) continue;
          var L = operandValue(M, T, k - 1);
          var rk = isOp(T[k + 1], '-') ? k + 2 : k + 1;
          var R = operandValue(M, T, rk);
          if (R && rk === k + 2 && R.value != null) R = { value: -R.value, line: R.line, name: '-' + R.name, literal: R.literal };
          if (t.value === '*') {
            if (L && L.value != null && errorLike(M, T, rk)) found = { gain: L, line: t.line, sink: sink };
            else if (R && R.value != null && errorLike(M, T, k - 1)) found = { gain: R, line: t.line, sink: sink };
          } else if (R && R.value && errorLike(M, T, k - 1)) {
            found = { gain: { value: 1 / R.value, line: R.line, name: '1/' + R.name, literal: R.literal }, line: t.line, sink: sink };
          }
        }
      });
    });
    if (!found) {
      return { state: 'changed',
        explanation: 'The lift power at line ' + sinks[0].line + ' no longer comes from a gain times the error — the P controller was removed instead of tuned.',
        evidence: evidence(M, H, [sinks[0].line]) };
    }
    var g = found.gain, v = g.value;
    var lines = [g.line, found.line, found.sink.line];
    if (v > 1.0) {
      return { state: 'broken',
        explanation: (g.literal ? 'The gain ' + g.name : g.name + ' is ' + v + ' (line ' + g.line + ') and') + ' multiplies the error at line ' + found.line +
          ': an error of 20 ticks asks for power ' + Math.round(v * 20) + ', so setPower at line ' + found.sink.line + ' is pinned at ±1 and the lift slams and oscillates.',
        evidence: evidence(M, H, lines) };
    }
    if (v > 0) {
      return { state: 'fixed',
        explanation: (g.literal ? 'The gain is ' + v : g.name + ' is ' + v + ' (line ' + g.line + ')') + ' and gain × error at line ' + found.line +
          ' still drives setPower at line ' + found.sink.line + ' — small errors now give proportional power instead of full power.',
        evidence: evidence(M, H, lines) };
    }
    return { state: 'changed',
      explanation: 'The gain is ' + v + ' at line ' + g.line + ' — a zero or negative kP stops the lift (or drives it away from the target) instead of fixing the overshoot.',
      evidence: evidence(M, H, lines) };
  }

  // ── Bug 4: the silent return ──────────────────────────────────────────────
  var CONST_RE = /\b[A-Z][A-Z0-9_]*\b/g;

  function splitTop(T, s, e, op) {
    var parts = [], depth = 0, ps = s;
    for (var k = s; k < e; k++) {
      if (isP(T[k], '(')) depth++;
      else if (isP(T[k], ')')) depth--;
      else if (depth === 0 && isOp(T[k], op)) { parts.push({ start: ps, end: k }); ps = k + 1; }
    }
    parts.push({ start: ps, end: e });
    return parts;
  }

  // `mode != Mode.AUTO` / `this.mode == AUTO` / `Mode.AUTO != mode` / `!(…)` → { field, idx, eq, constant }
  function enumCompare(M, T, s, e) {
    var flip = false;
    for (var guard = 0; guard < 10; guard++) {
      if (isOp(T[s], '!') && isP(T[s + 1], '(') && matchParen(T, s + 1) === e - 1) { flip = !flip; s += 2; e--; continue; }
      if (isP(T[s], '(') && matchParen(T, s) === e - 1) { s++; e--; continue; }
      break;
    }
    var opAt = -1;
    for (var k = s; k < e; k++) if (isOp(T[k], '==') || isOp(T[k], '!=')) { if (opAt >= 0) return null; opAt = k; }
    if (opAt < 0) return null;
    function side(a, b) {
      var ids = [];
      for (var j = a; j < b; j++) {
        if (isKw(T[j], 'this')) { if (!isP(T[j + 1], '.')) return null; j++; continue; }
        if (!isIdent(T[j])) return null;
        ids.push({ name: T[j].value, idx: j });
        if (j + 1 < b && !isP(T[j + 1], '.')) return null;
        j++;
      }
      return ids.length ? ids : null;
    }
    var L = side(s, opAt), R = side(opAt + 1, e);
    if (!L || !R) return null;
    function asField(ids) {
      if (ids.length !== 1) return null;
      var d = M.declOf(ids[0].name, ids[0].idx);
      return d && d.scope === 'field' ? { decl: d, name: ids[0].name, idx: ids[0].idx } : null;
    }
    function asConst(ids) {
      var last = ids[ids.length - 1].name;
      return /^[A-Z][A-Z0-9_]*$/.test(last) ? last : null;
    }
    var f = asField(L), c = asConst(R);
    if (!f || !c) { f = asField(R); c = asConst(L); }
    if (!f || !c) return null;
    var eq = T[opAt].value === '==';
    if (flip) eq = !eq;
    return { field: f, eq: eq, constant: c, line: T[opAt].line };
  }

  // Constants the field can hold: its initialiser plus every live assignment (a setter's
  // argument is followed to its callers). `unknown` when some value cannot be read.
  function fieldValues(M, T, decl) {
    var vals = {}, unknown = false, lines = [];
    function addText(txt) { (String(txt).match(CONST_RE) || []).forEach(function (x) { vals[x] = true; }); }
    if (decl.init) { addText(M.textOf(decl.init)); lines.push(decl.line); }
    var owner = decl.field ? decl.field.owner : null;
    M.assigns.forEach(function (a) {
      if (a.op !== '=' || !a.live) return;
      var parts = String(a.target).split('.');
      if (parts[parts.length - 1] !== decl.name) return;
      if (parts.length === 1 || a.targetBase === decl.name) { if (M.declOf(decl.name, a.index) !== decl) return; }
      else if (!owner || chainType(M, parts.slice(0, -1), a.index) !== owner.name) return;
      var txt = M.textOf(a.rhs);
      if ((txt.match(CONST_RE) || []).length) { addText(txt); lines.push(a.line); return; }
      var m = a.method, pi = -1;
      if (m && /^[A-Za-z_$][\w$]*$/.test(txt)) m.params.forEach(function (p, i) { if (p.name === txt) pi = i; });
      if (pi < 0) { unknown = true; return; }
      M.calls.forEach(function (c) {
        if (!c.live || c.args.length <= pi) return;
        var r = M.resolveCall(c);
        if (!r || !r.methods || r.methods.indexOf(m) < 0) return;
        var at = c.args[pi].text;
        if ((at.match(CONST_RE) || []).length) { addText(at); lines.push(c.line); } else unknown = true;
      });
    });
    return { values: Object.keys(vals), unknown: unknown, lines: lines };
  }

  function checkSilentReturn(ctx, H) {
    var M = modelOf(ctx), T = toks(M), OM = opModeType(M, H);
    var assigns = M.assigns.filter(function (a) {
      return a.targetBase === 'target' && a.method && !a.method.isCtor && a.type !== OM && !a.dead;
    });
    assigns.sort(function (a, b) { return (b.method.name === 'goTo') - (a.method.name === 'goTo') || a.index - b.index; });
    var assign = assigns[0];
    if (!assign) {
      return { state: 'changed',
        explanation: 'No method sets the lift target any more, so goTo() cannot move the lift — the guard was removed together with the work it guarded.',
        evidence: [] };
    }
    var m = assign.method, reqs = [], guards = [];
    (m.block.statements || []).forEach(function (st) {
      if (st.start >= assign.index || !st.headerOf || st.headerOf.kind !== 'if' || !st.headerOf.cond) return;
      var body = (st.headerOf.statements || []).filter(function (x) { return x.kind !== 'label'; });
      if (body.length !== 1 || body[0].kind !== 'return') return;
      var cond = st.headerOf.cond;
      guards.push(cond.line);
      var ors = splitTop(T, cond.start, cond.end, '||');
      if (ors.length > 1) {
        ors.forEach(function (p) { var c = enumCompare(M, T, p.start, p.end); if (c) reqs.push([{ c: c, want: !c.eq }]); });
      } else {
        var ands = splitTop(T, cond.start, cond.end, '&&'), any = [];
        ands.forEach(function (p) { var c = enumCompare(M, T, p.start, p.end); if (c) any.push({ c: c, want: !c.eq }); });
        if (any.length === ands.length && any.length) reqs.push(any);
      }
    });
    ((M.enclosing(assign) || {}).condChain || []).forEach(function (cond) {
      if (cond.caseLabel || !cond.block || cond.block.methodRef !== m || cond.block.kind !== 'if') return;
      var ands = splitTop(T, cond.start, cond.end, '&&');
      if (ands.length > 1 && cond.negated) return;
      ands.forEach(function (p) {
        var c = enumCompare(M, T, p.start, p.end);
        if (c) { guards.push(cond.line); reqs.push([{ c: c, want: cond.negated ? !c.eq : c.eq }]); }
      });
    });
    var failed = null, valueLines = [];
    reqs.forEach(function (alts) {
      if (failed) return;
      var ok = alts.some(function (x) {
        var fv = fieldValues(M, T, x.c.field.decl);
        valueLines = valueLines.concat(fv.lines);
        if (fv.unknown) return true;
        return x.want ? fv.values.indexOf(x.c.constant) >= 0 : fv.values.some(function (v) { return v !== x.c.constant; });
      });
      if (!ok) failed = alts[0];
    });
    if (failed) {
      var c = failed.c, fv2 = fieldValues(M, T, c.field.decl);
      var holds = fv2.values.length ? fv2.values.join(' / ') : 'nothing';
      return { state: 'broken',
        explanation: m.name + '() at line ' + m.line + ' only reaches ' + assign.target + ' = ' + M.textOf(assign.rhs) + ' (line ' + assign.line + ') when ' +
          c.field.name + (failed.want ? ' is ' : ' is not ') + c.constant + ' (line ' + c.line + '), but ' + c.field.name + ' only ever holds ' + holds +
          ' (line ' + c.field.decl.line + ') — the call returns silently and the lift never moves.',
        evidence: evidence(M, H, [c.line, c.field.decl.line, assign.line]) };
    }
    if (guards.length) {
      return { state: 'fixed',
        explanation: 'The guard in ' + m.name + '() (line ' + guards[0] + ') can now pass: the field it checks is given a passing value' +
          (valueLines.length ? ' (line ' + valueLines[valueLines.length - 1] + ')' : '') + ', so ' + assign.target + ' is set at line ' + assign.line + '.',
        evidence: evidence(M, H, [guards[0], valueLines[valueLines.length - 1], assign.line]) };
    }
    return { state: 'fixed',
      explanation: m.name + '() no longer returns early: ' + assign.target + ' is set at line ' + assign.line + ' on every call.',
      evidence: evidence(M, H, [assign.line]) };
  }

  // ── Bug 5: telemetry without telemetry.update() ───────────────────────────
  function isTelemetry(c) { return c.receiverText === 'telemetry' || (c.receiverChain && c.receiverChain[c.receiverChain.length - 1] === 'telemetry'); }

  function checkTelemetry(ctx, H) {
    var M = modelOf(ctx);
    if (!loops(M, H).length) return { state: 'changed', explanation: 'No control loop was found, so no telemetry is shown while the robot runs.', evidence: [] };
    var calls = loopCalls(M, H).map(function (x) { return x.call; });
    var adds = calls.filter(function (c) { return isTelemetry(c) && (c.name === 'addData' || c.name === 'addLine'); });
    var ups = calls.filter(function (c) { return isTelemetry(c) && c.name === 'update'; });
    if (!adds.length) {
      return { state: 'changed', explanation: 'The loop no longer sends any telemetry — deleting the addData() lines removes the symptom and your view of the robot with it.', evidence: [] };
    }
    if (ups.length) {
      return { state: 'fixed', explanation: 'telemetry.update() now runs every loop (line ' + ups[0].line + '), so the ' + adds.length + ' addData() values reach the Driver Station.',
        evidence: evidence(M, H, [ups[0].line]) };
    }
    var OM = opModeType(M, H);
    var iterative = OM && OM.extends === 'OpMode' && loops(M, H).every(function (b) { return b.kind === 'method'; });
    if (iterative) {
      return { state: 'fixed', explanation: 'This is an iterative OpMode: the SDK sends telemetry after every loop(), so the ' + adds.length + ' addData() values reach the Driver Station.',
        evidence: evidence(M, H, [adds[0].line]) };
    }
    var outside = M.calls.filter(function (c) { return isTelemetry(c) && c.name === 'update' && !c.dead; });
    var first = adds[0].line, last = adds[adds.length - 1].line;
    return { state: 'broken',
      explanation: 'The loop adds ' + adds.length + ' telemetry value' + (adds.length === 1 ? '' : 's') + ' (lines ' + first + (last !== first ? '–' + last : '') +
        ') but never calls telemetry.update()' + (outside.length ? ' — the only one is at line ' + outside[0].line + ', outside the loop' : '') +
        ', so the Driver Station keeps showing the init screen.',
      evidence: evidence(M, H, [first, last].concat(outside.length ? [outside[0].line] : [])) };
  }

  // ── Wrapper: checks never throw and always return the three-state shape ────
  var STATES = { broken: true, fixed: true, changed: true };
  function safe(fn) {
    return function (ctx, H) {
      try {
        var M = modelOf(ctx);
        if (!M) return { state: 'broken', explanation: 'could not analyse: the Java structure parser is not loaded', evidence: [] };
        var r = fn(ctx && ctx.model ? ctx : { src: ctx && ctx.src, model: M }, helpers(ctx, H));
        if (!r || !STATES[r.state]) return { state: 'broken', explanation: 'could not analyse this bug', evidence: [] };
        return { state: r.state, explanation: String(r.explanation || ''), evidence: Array.isArray(r.evidence) ? r.evidence : [] };
      } catch (e) {
        return { state: 'broken', explanation: 'could not analyse: ' + String((e && e.message) || e), evidence: [] };
      }
    };
  }

  function similarity(ctx) {
    try {
      var J = window.RTJavaStructure;
      if (!J) return 0;
      var src = typeof ctx === 'string' ? ctx : String((ctx && ctx.src) || '');
      var v = J.coverage(SOURCE, src, 5);
      return typeof v === 'number' && isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
    } catch (e) { return 0; }
  }

  window.RT_PHASE5_KIT = {
    id: 'debug-under-pressure',
    version: 'kit-1',
    title: 'Debug Under Pressure: BuzzAuto',
    source: SOURCE,
    similarity: similarity,
    bugs: [
      { id: 'double-update', title: 'The double update', lessonId: 'bug-double-update',
        symptom: 'The robot overshoots and wobbles along both paths, as if every correction were doubled.',
        hint: 'Find every update() call the loop reaches — including inside the methods it calls — and ask which object each one updates (The Double Update).',
        check: safe(checkDoubleUpdate) },
      { id: 'inverted-busy', title: 'The inverted isBusy() check', lessonId: 'theory-bug-taxonomy',
        symptom: 'The robot starts its scoring step while it is still driving: the intake spits the piece out on the way to the basket.',
        hint: 'This is a logic bug: read the TO_SCORE transition out loud and compare it with a transition that works (The Taxonomy of Bugs).',
        check: safe(checkInvertedBusy) },
      { id: 'kp-catastrophe', title: 'The kP catastrophe', lessonId: 'bug-kp-catastrophe',
        symptom: 'The lift motor buzzes and slams between full up and full down instead of settling.',
        hint: 'Work out the power the lift controller asks for when the error is 20 ticks (The kP Catastrophe).',
        check: safe(checkKp) },
      { id: 'silent-return', title: 'The silent return', lessonId: 'bug-silent-return',
        symptom: 'The robot reaches the basket but the lift never moves — no crash, no error.',
        hint: 'Follow robot.lift.goTo() line by line and check which values the field in its first line can ever hold (The Silent Return).',
        check: safe(checkSilentReturn) },
      { id: 'no-telemetry-update', title: 'The missing telemetry.update()', lessonId: 'observability',
        symptom: 'The Driver Station shows "Status: Ready" for the whole run; state, pose and lift values never appear.',
        hint: 'Compare how telemetry is sent before START with how it is sent inside the loop (Building Observability).',
        check: safe(checkTelemetry) }
    ]
  };
})();
