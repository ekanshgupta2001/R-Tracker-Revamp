// ── R-Tracker v2 — structural code rules per curriculum phase ────────────────
// Consumed by js/code-check.js, which parses the submission with
// js/java-structure.js and hands every rule a context:
//   ctx = { phaseId, src, model, comments, refs: { snippets, kit }, H, credited, results, kitStates }
// Rules only ask questions of that parsed model (where a call sits, what flows
// into an argument, which methods are reachable). Nothing here, or anywhere,
// runs student code.
//
// Rule shapes (plan §2.2):
//   criterion = { id, label, weight, hint, credit(ctx) → number | { credit, explanation, evidence } }
//   gate      = { id, label, severity, penalty?, hint, test(ctx) → null | { explanation, evidence }, after? }
//   forbidden = { id, label, severity, penalty, hint, test(ctx) → null | { evidence } }
//   CODE_RULES[pid] = { gates, required, forbidden, issues, passThreshold } | { kit: true, … } | { reflection: true, note }
// Weights in `required` sum to 100 per phase. Evidence may be nodes, lines or { line, text }.
//
// Exposes: window.CODE_RULES, window.CODE_RULES_VERSION

(function () {
  'use strict';

  // ── Shared vocabulary ─────────────────────────────────────────────────────
  var MOTOR_TYPE = /^(DcMotor|DcMotorEx|DcMotorSimple|DcMotorImplEx)$/;
  var GAIN_NAME = /^(k_?p|kprop|p|p_?gain|proportional)$/i;
  var GAIN_LOOSE = /(^|_)k_?p(_|$)|[a-z]Kp$|^kP[A-Z_]|KP$/;
  var ENCODER_READS = /^(getCurrentPosition|getVelocity|pose|x|y|heading|getHeading|getPose|getPosition)$/;
  var ENCODER_TOKENS = /^(RUN_USING_ENCODER|STOP_AND_RESET_ENCODER|RUN_TO_POSITION)$/;
  var DONE_LABEL = /DONE|STOP|END|FINISH|PARK|IDLE|COMPLETE/i;
  var ALLIANCE_NAME = /red|blue|alliance/i;
  // Pedro Pathing 2 / FTCLib shapes the curriculum migrated away from.
  var LEGACY_PEDRO = /pathBuilder\s*\(|setLinearHeadingInterpolation|setConstantHeadingInterpolation|setTangentHeadingInterpolation|setStartingPose\s*\(|followPath\s*\(|new\s+BezierLine|new\s+Point\s*\(/;
  var LEGACY_COMMANDS = /SequentialCommandGroup|ParallelCommandGroup|extends\s+CommandBase\b|extends\s+SubsystemBase\b|CommandScheduler/;

  // Names a submission may use without declaring them (FTC SDK, Pedro, Ivy, java.lang).
  var FTC_PROVIDED = ['hardwareMap', 'telemetry', 'gamepad1', 'gamepad2', 'Math', 'Range', 'Scheduler', 'Constants', 'PoseFactory',
    'Command', 'Commands', 'Groups', 'PedroCommands', 'Paths', 'DcMotor', 'DcMotorEx', 'DcMotorSimple', 'Servo', 'CRServo',
    'DistanceUnit', 'AngleUnit', 'Double', 'Integer', 'String', 'System', 'Thread', 'ElapsedTime'];
  // Methods an OpMode inherits, and the Pedro/Ivy static helpers (their imports are not checked,
  // just as ordinary imports are not).
  var INHERITED = ['waitForStart', 'opModeIsActive', 'opModeInInit', 'isStarted', 'isStopRequested', 'sleep', 'idle', 'getRuntime',
    'resetRuntime', 'requestOpModeStop', 'terminateOpModeNow', 'updateTelemetry', 'super', 'this'];
  var DSL = ['line', 'curve', 'through', 'path', 'follow', 'schedule', 'sequential', 'parallel', 'race', 'deadline', 'instant', 'waitMs',
    'waitUntil', 'infinite', 'conditional', 'lazy'];

  function set(list) { var o = Object.create(null); list.forEach(function (x) { o[x] = true; }); return o; }
  var FTC_SET = set(FTC_PROVIDED), INHERITED_SET = set(INHERITED), DSL_SET = set(DSL);

  // ── Small helpers shared by the rules ─────────────────────────────────────
  function R(credit, explanation, evidence) { return { credit: credit, explanation: explanation, evidence: evidence || [] }; }
  function norm(s) { return String(s == null ? '' : s).replace(/\s+/g, ''); }
  function baseType(t) { return t ? String(t).replace(/<.*$/, '').replace(/\[\]/g, '').replace(/^.*\./, '').trim() : null; }
  function tok(ctx, i) { return ctx.model.tokens[i]; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function methodLabel(m) { return m.isCtor ? 'new ' + m.name + '()' : (m.owner && m.owner.name ? m.owner.name + '.' : '') + m.name + '()'; }
  function typeLive(T) { return !!T && T.methods.some(function (m) { return m.reachable && m.block; }); }
  function isIdent(t) { return !!t && t.type === 'ident'; }
  function memo(ctx, key, fn) { ctx._memo = ctx._memo || {}; if (!(key in ctx._memo)) ctx._memo[key] = fn(); return ctx._memo[key]; }

  // Calls in code that runs every loop iteration (loop bodies + methods called from them, ≤ 2 hops).
  function loopCalls(ctx, hops) {
    return memo(ctx, 'loopCalls' + (hops == null ? 2 : hops), function () {
      var H = ctx.H;
      return ctx.model.calls.filter(function (c) { return c.live && H.inLoopRegion(c, hops); });
    });
  }
  function inInit(ctx, node) { return ctx.H.inInit(node); }
  function isReceiverless(c) { return c.receiverText === ''; }
  function staticCall(c, cls, name) { return c.name === name && (isReceiverless(c) || (c.receiverChain.length === 1 && c.receiverChain[0] === cls)); }
  function argIsZero(c) { return c.args.length === 1 && /^0(\.0*)?[dDfF]?$/.test(norm(c.args[0].text)); }
  function isStopCall(c) { return (c.name === 'setPower' && argIsZero(c)) || (c.name === 'run' && argIsZero(c)) || (c.name === 'stop' && c.args.length === 0); }

  // Tokens in a range that are gamepad reads of a given kind.
  function padIn(ctx, range, kinds) {
    return ctx.H.gamepadTokens(range).filter(function (g) { return !kinds || kinds.indexOf(g.kind) >= 0; });
  }
  // Does the value in a token range come from a gamepad read of one of `kinds` (≤ hops assignments)?
  function flowsFromPad(ctx, range, method, kinds, hops) {
    var M = ctx.model, H = ctx.H;
    var direct = padIn(ctx, range, kinds);
    if (direct.length) return { ok: true, pad: direct[0] };
    var r = M.flowsTo(function (t) {
      return H.gamepadTokens({ start: t.i, end: t.i + 1 }).some(function (g) { return kinds.indexOf(g.kind) >= 0; });
    }, { start: range.start, end: range.end, method: method }, { maxHops: hops == null ? 3 : hops });
    return r && r.ok ? { ok: true, via: r.via } : { ok: false };
  }
  // setPower args that trace back to a method parameter whose call sites pass a joystick value.
  function flowsFromStickViaParam(ctx, call) {
    var M = ctx.model, H = ctx.H, m = call.method;
    if (!m || !m.params.length) return false;
    var a = call.args[0];
    var r = M.flowsTo(function (t) {
      if (!isIdent(t)) return false;
      var d = M.declOf(t.value, t.i);
      return !!d && d.scope === 'param' && d.method === m;
    }, { start: a.start, end: a.end, method: m }, { maxHops: 3 });
    if (!r || !r.ok) return false;
    return M.calls.some(function (c) {
      if (c.name !== m.name || !c.live || c === call) return false;
      return c.args.some(function (x) { return flowsFromPad(ctx, x, c.method, ['stick', 'stick_y'], 3).ok; });
    });
  }

  // Binary minus at depth 0 of a token range (not a unary sign).
  function depth0Minus(ctx, range) {
    var d = 0, out = [];
    for (var i = range.start; i < range.end; i++) {
      var t = tok(ctx, i);
      if (t.type === 'punct' && (t.value === '(' || t.value === '[')) d++;
      else if (t.type === 'punct' && (t.value === ')' || t.value === ']')) d--;
      else if (d === 0 && t.type === 'op' && t.value === '-' && i > range.start) {
        var p = tok(ctx, i - 1);
        if (p && (p.type === 'ident' || p.type === 'number' || p.value === ')' || p.value === ']')) out.push(i);
      }
    }
    return out;
  }

  // ── Structure helpers: subsystems, Robot class, OpMode ────────────────────
  function hwFields(ctx) {
    return memo(ctx, 'hwFields', function () {
      return ctx.model.fields.filter(function (f) { return ctx.H.isHardwareType(f.typeText || f.type); });
    });
  }
  function isOpModeType(ctx, T) { return ctx.H.opModes().indexOf(T) >= 0; }
  function fieldUses(ctx, T, f) {
    return ctx.model.calls.filter(function (c) {
      return c.type === T && c.receiverChain.length && c.receiverChain[0] === f.name && ctx.model.declOf(f.name, c.start) === f.decl;
    });
  }
  // A type whose ctor (or a method taking HardwareMap) constructs ≥ 1 user types from the HardwareMap.
  function robotInfo(ctx) {
    return memo(ctx, 'robot', function () {
      var M = ctx.model, best = null;
      M.types.forEach(function (T) {
        if (isOpModeType(ctx, T) || T.kind !== 'class') return;
        var built = [], liveBuilt = [], nodes = [];
        T.methods.forEach(function (m) {
          if (!m.block) return;
          var hwParams = m.params.filter(function (p) { return baseType(p.type) === 'HardwareMap'; }).map(function (p) { return p.name; });
          if (!m.isCtor && !hwParams.length) return;
          M.news.forEach(function (w) {
            if (w.start < m.block.open || w.start > m.block.close || !M.typeNamed(w.typeName) || w.typeName === T.name) return;
            var usesMap = w.args.some(function (a) { var id = norm(a.text); return hwParams.indexOf(id) >= 0 || id === 'hardwareMap'; });
            if (!usesMap) return;
            if (built.indexOf(w.typeName) < 0) built.push(w.typeName);
            if (w.live && liveBuilt.indexOf(w.typeName) < 0) liveBuilt.push(w.typeName);
            nodes.push(w);
          });
          // drive.init(hw): a field of a user type initialised from the HardwareMap parameter
          M.calls.forEach(function (c) {
            if (c.start < m.block.open || c.start > m.block.close || c.receiverChain.length !== 1) return;
            if (!c.args.some(function (a) { var id = norm(a.text); return hwParams.indexOf(id) >= 0 || id === 'hardwareMap'; })) return;
            var t = ctx.H.varType(c.receiverChain[0], c.start);
            if (!t || !M.typeNamed(t) || t === T.name) return;
            if (built.indexOf(t) < 0) built.push(t);
            if (c.live && liveBuilt.indexOf(t) < 0) liveBuilt.push(t);
            nodes.push(c);
          });
        });
        if (!built.length) return;
        var score = built.length * 2 + (/Robot|Bot|Hardware/i.test(T.name) ? 1 : 0);
        if (!best || score > best.score) best = { type: T, built: built, liveBuilt: liveBuilt, nodes: nodes, score: score };
      });
      return best;
    });
  }
  // Subsystem classes: non-OpMode, non-Robot classes with ≥ 1 hardware field.
  function subsystems(ctx) {
    return memo(ctx, 'subs', function () {
      var rob = robotInfo(ctx), M = ctx.model;
      return M.types.filter(function (T) {
        if (T.kind !== 'class' || isOpModeType(ctx, T) || (rob && rob.type === T)) return false;
        return T.fields.some(function (f) { return ctx.H.isHardwareType(f.typeText || f.type); });
      }).map(function (T) {
        var fields = T.fields.filter(function (f) { return ctx.H.isHardwareType(f.typeText || f.type); });
        var motors = fields.filter(function (f) { return MOTOR_TYPE.test(baseType(f.typeText) || ''); });
        return { type: T, fields: fields, motors: motors };
      });
    });
  }
  function nonPrivate(m) { return m.modifiers.indexOf('private') < 0; }
  function drivetrainInfo(ctx) {
    return memo(ctx, 'drive', function () {
      var best = null;
      subsystems(ctx).forEach(function (s) {
        if (s.motors.length < 2) return;
        var method = null, methodLive = null;
        s.type.methods.forEach(function (m) {
          if (m.isCtor || !m.block || !nonPrivate(m)) return;
          var powered = s.motors.filter(function (f) {
            return fieldUses(ctx, s.type, f).some(function (c) { return c.name === 'setPower' && c.start > m.block.open && c.start < m.block.close; });
          });
          if (powered.length >= 2) { if (!method) method = m; if (m.reachable && !methodLive) methodLive = m; }
        });
        var score = (method ? 2 : 0) + (methodLive ? 2 : 0) + (/Drive|Drivetrain|Chassis|Mecanum|Tank/i.test(s.type.name) ? 1 : 0);
        if (!best || score > best.score) best = { sub: s, type: s.type, method: method, methodLive: methodLive, score: score };
      });
      return best;
    });
  }
  function mechanismSubs(ctx) {
    var dt = drivetrainInfo(ctx);
    return subsystems(ctx).filter(function (s) { return !dt || s.type !== dt.type; });
  }
  // Calls in the OpMode that touch hardware directly.
  function opModeHardware(ctx) {
    var T = ctx.H.opMode(), M = ctx.model, H = ctx.H;
    if (!T || !T.block) return [];
    var out = [];
    M.calls.forEach(function (c) {
      if (c.start < T.block.open || c.start > T.block.close) return;
      if (c.name === 'get' && c.receiverChain.length && (c.receiverChain[0] === 'hardwareMap' || H.varType(c.receiverChain[0], c.start) === 'HardwareMap')) { out.push(c); return; }
      if (c.name === 'setPower' || c.name === 'setPosition') {
        var rt = H.receiverType(c);
        if (!rt || !H.isUserType(rt)) out.push(c);
      }
    });
    T.fields.forEach(function (f) { if (H.isHardwareType(f.typeText || f.type)) out.push(f); });
    return out;
  }

  // ── Autonomous helpers: poses, paths, follower, scheduling ────────────────
  function distinctPoses(ctx, liveOnly) {
    var list = ctx.H.poses().filter(function (p) { return !liveOnly || p.live; });
    var seen = Object.create(null), uniq = [], dups = [];
    list.forEach(function (p) {
      var k = p.x + ',' + p.y;
      if (seen[k]) dups.push({ p: p, first: seen[k] }); else { seen[k] = p; uniq.push(p); }
    });
    return { all: list, uniq: uniq, dups: dups };
  }
  function pathPoints(ctx) {
    var list = ctx.H.pathMethods(), sum = 0, ev = [], notes = [];
    list.forEach(function (pm) {
      var label = pm.method ? pm.name + '()' : pm.name;
      if (!pm.builder) { notes.push(label + ' has no line()/curve()'); return; }
      if (!pm.reachable) { notes.push(label + ' is never used'); return; }
      var full = pm.interp && pm.poseRefs.length >= 2;
      sum += full ? 1 : 0.5;
      ev.push(pm.builderCall);
      if (!pm.interp) notes.push(label + ' has no heading interpolation (.linear/.constant/.tangent)');
      else if (pm.poseRefs.length < 2) notes.push(label + ' does not connect two declared poses');
    });
    return { sum: sum, evidence: ev, notes: notes, count: list.length };
  }
  // per Path method: 1 builder + interpolation + ≥ 2 declared poses, 0.5 without; min(1, Σ/need)
  function pathsCredit(ctx, need) {
    var p = pathPoints(ctx);
    if (!p.count) return R(0, 'No method returns a Path built with line() or curve().');
    var c = Math.min(1, p.sum / need);
    return R(c, c >= 0.999 ? 'Found ' + plural(p.evidence.length, 'path') + ' built from declared poses with a heading interpolation.'
      : 'Path credit ' + Math.round(p.sum * 10) / 10 + ' of ' + need + (p.notes.length ? ': ' + p.notes.slice(0, 3).join('; ') + '.' : '.'), p.evidence);
  }
  function followerInfo(ctx) {
    return memo(ctx, 'follower', function () {
      var M = ctx.model, H = ctx.H, out = { vars: [], createNodes: [], createInInit: null, setPoseInInit: null, setPoseAny: null };
      M.calls.forEach(function (c) {
        if (c.name !== 'create' || !(c.receiverChain.length === 1 && c.receiverChain[0] === 'Constants')) return;
        var target = H.targetOf(c);
        if (!target) return;
        out.vars.push(target.split('.').pop());
        out.createNodes.push(c);
        if (c.live && inInit(ctx, c) && !out.createInInit) out.createInInit = c;
      });
      M.decls.forEach(function (d) { if (baseType(d.typeText) === 'Follower' && out.vars.indexOf(d.name) < 0) out.vars.push(d.name); });
      M.calls.forEach(function (c) {
        if (c.name !== 'setPose' || !c.live || c.args.length !== 1) return;
        var a = c.args[0], id = norm(a.text);
        var poseArg = (/^[A-Za-z_$][\w$]*$/.test(id) && H.isPoseName(id, a.start)) || /\.of\(/.test(id) || /^newPose\(/.test(id);
        if (!poseArg) return;
        if (!out.setPoseAny) out.setPoseAny = c;
        if (inInit(ctx, c) && !out.setPoseInInit) out.setPoseInInit = c;
      });
      return out;
    });
  }
  function isFollowerCall(ctx, c) {
    var rt = ctx.H.receiverType(c);
    if (rt) return rt === 'Follower';
    var last = c.receiverChain[c.receiverChain.length - 1];
    return !!last && (followerInfo(ctx).vars.indexOf(last) >= 0 || /follower/i.test(last));
  }
  // Follower updates per loop iteration (the loop body plus methods it calls, ≤ 2 hops).
  function followerUpdates(ctx, lb) {
    return ctx.H.callsIn(lb, 2).filter(function (c) { return c.name === 'update' && c.args.length === 0 && c.live && isFollowerCall(ctx, c); });
  }
  function schedulerCalls(ctx, lb, name) {
    return ctx.H.callsIn(lb, 2).filter(function (c) { return c.live && staticCall(c, 'Scheduler', name); });
  }
  function isScheduled(ctx, call) {
    var M = ctx.model;
    return M.calls.some(function (s) {
      if (!s.live || !staticCall(s, 'Scheduler', 'schedule') || !s.args.length) return false;
      return s.args.some(function (a) {
        if (call.start >= a.start && call.start < a.end) return true;
        var r = M.flowsTo(function (t) { return t.i >= call.start && t.i < call.end; }, { start: a.start, end: a.end, method: s.method }, { maxHops: 3 });
        return !!(r && r.ok);
      });
    });
  }
  function followCalls(ctx) {
    return memo(ctx, 'follows', function () {
      var M = ctx.model, H = ctx.H;
      var pathNames = H.pathMethods().map(function (p) { return p.name; });
      return M.calls.filter(function (c) { return c.name === 'follow' && c.args.length >= 2 && (isReceiverless(c) || c.receiverText === 'PedroCommands'); })
        .map(function (c) {
          var a1 = norm(c.args[1].text), pathOk = false;
          var m = /^([A-Za-z_$][\w$]*)\(\)$/.exec(a1);
          if (m && pathNames.indexOf(m[1]) >= 0) pathOk = true;
          else if (/^[A-Za-z_$][\w$]*$/.test(a1) && (pathNames.indexOf(a1) >= 0 || /^(Path|PathChain)$/.test(H.varType(a1, c.args[1].start) || ''))) pathOk = true;
          else if (/^(line|curve|path)\(/.test(a1)) pathOk = true;
          var a0 = norm(c.args[0].text).split('.').pop();
          var followerOk = followerInfo(ctx).vars.indexOf(a0) >= 0 || /follower/i.test(a0);
          return { call: c, pathOk: pathOk, followerOk: followerOk, live: c.live };
        });
    });
  }
  // Calls named `name` inside a call's arguments, following user methods they call (1 hop).
  function nestedCalls(ctx, call, pred) {
    var M = ctx.model, out = [];
    call.args.forEach(function (a) {
      ctx.H.callsWithin({ start: a.start, end: a.end }, 1).forEach(function (c) { if (pred(c) && out.indexOf(c) < 0) out.push(c); });
      // Command variables passed in: follow their assignments back
      if (/^[A-Za-z_$][\w$]*$/.test(norm(a.text))) {
        M.calls.forEach(function (c) {
          if (!pred(c) || out.indexOf(c) >= 0) return;
          var r = M.flowsTo(function (t) { return t.i >= c.start && t.i < c.end; }, { start: a.start, end: a.end, method: call.method }, { maxHops: 3 });
          if (r && r.ok) out.push(c);
        });
      }
    });
    return out;
  }

  // ── Sensor helpers ─────────────────────────────────────────────────────────
  function sensorDecisions(ctx) {
    return memo(ctx, 'decisions', function () {
      var M = ctx.model, H = ctx.H, out = [];
      M.conds.forEach(function (c) {
        if (!c.live || c.caseLabel || c.negated || !c.hasComparison || c.block.kind === 'for') return;
        if (!H.sensorDerived(c, c.method)) return;
        var b = c.block;
        var body = { start: b.open, end: b.close + 1 };
        var acts = M.assigns.filter(function (a) { return a.live && a.index > b.open && a.index <= b.close; });
        var calls = M.calls.filter(function (x) {
          return x.live && x.start > b.open && x.start <= b.close && !/^(addData|addLine|update|seconds|milliseconds)$/.test(x.name) && !H.isSensorRead(x);
        });
        var rets = M.statements.filter(function (st) { return st.kind === 'return' && st.start > b.open && st.start <= b.close; });
        out.push({ cond: c, action: acts[0] || calls[0] || rets[0] || null, body: body });
      });
      return out;
    });
  }
  // 0.5 a live comparison fed by a sensor reading + 0.5 its branch assigns state or calls hardware/a subsystem
  function decisionCredit(ctx) {
    var list = sensorDecisions(ctx);
    if (!list.length) {
      var anyCmp = ctx.model.conds.filter(function (c) { return c.live && c.hasComparison && !c.caseLabel && c.block.kind !== 'for'; });
      return R(0, anyCmp.length ? 'Your comparisons (e.g. line ' + anyCmp[0].line + ') do not use a sensor reading.' : 'No if/while compares a sensor reading with a threshold.');
    }
    var withAct = list.filter(function (d) { return d.action; });
    if (withAct.length) return R(1, 'Line ' + withAct[0].cond.line + ' compares a sensor reading and acts on it.', [withAct[0].cond, withAct[0].action]);
    return R(0.5, 'Line ' + list[0].cond.line + ' compares a sensor reading, but nothing happens inside that branch.', [list[0].cond]);
  }
  // averaging (+= reading in a loop, then /), a consecutive-readings counter reset in else, or smoothing
  function filteringCredit(ctx) {
    var M = ctx.model, H = ctx.H;
    // (a) accumulate a sensor reading in a loop, then divide the accumulator
    var acc = M.assigns.filter(function (a) {
      if (!a.live || a.op !== '+=' || !H.sensorDerived(a.rhs, a.method)) return false;
      for (var b = a.block; b && b.kind !== 'method'; b = b.parent) if (b.iterates) return true;
      return false;
    });
    for (var k = 0; k < acc.length; k++) {
      var a = acc[k], name = a.targetBase, m = a.method;
      var end = m && m.block ? m.block.close : M.tokens.length - 1;
      for (var i = a.index + 1; i < end; i++) {
        var t = tok(ctx, i);
        if (t.type === 'ident' && t.value === name && ((tok(ctx, i + 1) && tok(ctx, i + 1).value === '/') || (tok(ctx, i - 1) && tok(ctx, i - 1).value === '/'))) {
          return R(1, 'Line ' + a.line + ' adds up readings and line ' + t.line + ' averages them.', [a, t.line]);
        }
      }
    }
    // (b) a counter of consecutive readings, reset in the else branch
    var counted = null;
    M.conds.forEach(function (c) {
      if (counted || !c.live || c.negated || c.block.kind !== 'if' || !H.sensorDerived(c, c.method)) return;
      var b = c.block;
      var inc = M.assigns.filter(function (x) { return x.live && x.index > b.open && x.index <= b.close && (x.op === '++' || (x.op === '+=' && /^1$/.test(norm(M.textOf(x.rhs))))); });
      if (!inc.length) return;
      var elseBlk = M.blocks.filter(function (x) { return x.elseOf === b; })[0];
      if (!elseBlk) return;
      var reset = M.assigns.filter(function (x) { return x.index > elseBlk.open && x.index <= elseBlk.close && x.op === '=' && x.targetBase === inc[0].targetBase && /^0$/.test(norm(M.textOf(x.rhs))); });
      if (reset.length) counted = R(1, 'Line ' + inc[0].line + ' counts consecutive readings and line ' + reset[0].line + ' resets the count.', [inc[0], reset[0]]);
    });
    if (counted) return counted;
    // (c) exponential smoothing: v = a * reading + (1 - a) * v
    var ema = M.assigns.filter(function (a) {
      if (!a.live || a.op !== '=' || !H.sensorDerived(a.rhs, a.method)) return false;
      for (var i = a.rhs.start; i < a.rhs.end; i++) if (tok(ctx, i).value === a.targetBase && tok(ctx, i).type === 'ident') return /\*/.test(M.textOf(a.rhs));
      return false;
    });
    if (ema.length) return R(1, 'Line ' + ema[0].line + ' smooths the reading with its previous value.', [ema[0]]);
    return R(0, 'Every decision uses a single reading — average several or require a few in a row.');
  }

  // ── Telemetry helpers ─────────────────────────────────────────────────────
  function loopTelemetry(ctx) {
    return loopCalls(ctx).filter(function (c) { return c.name === 'addData' && c.args.length >= 1 && (c.receiverChain[0] === 'telemetry' || /telemetry/i.test(c.receiverText)); });
  }
  function captions(ctx, list) {
    return ctx.H.distinct(list, function (c) { var t = ctx.model.tokens[c.args[0].start]; return t && t.type === 'string' ? t.value.trim().toLowerCase() : norm(c.args[0].text); });
  }
  function telemetryUpdated(ctx) {
    return ctx.H.loopBodies().some(function (lb) { return ctx.H.callsIn(lb, 2).some(function (c) { return c.live && c.name === 'update' && c.receiverChain[0] === 'telemetry'; }); });
  }

  // ── Comment helpers ───────────────────────────────────────────────────────
  function commentCredit(ctx, need) {
    var q = ctx.H.qualityComments();
    var c = Math.min(1, q.length / need);
    return R(c, q.length >= need ? plural(q.length, 'comment') + ' explain the code.'
      : 'Found ' + plural(q.length, 'comment') + (q.length === 1 ? ' that explains' : ' that explain') + ' why (needs ' + need + '). A comment counts when it has a few real words and does not just repeat the next line.',
      q.slice(0, 3).map(function (x) { return x.line; }));
  }

  // ════════════════════════════════════════════════════════════════════════
  // Common gates
  // ════════════════════════════════════════════════════════════════════════
  var GATE_PARSES = {
    id: 'parses', label: 'Reads as a complete Java file', severity: 'CRITICAL',
    hint: 'Paste the whole Java file: the class declaration, its methods and every closing brace. Kotlin and Blocks cannot be checked.',
    // ≥ 1 class, no unbalanced/unterminated diagnostics, < 2 junk statements, ≤ 1 line with > 6 statements
    test: function (ctx) {
      var M = ctx.model, probs = [], ev = [];
      if (!M.types.length) probs.push('no class declaration was found');
      M.diagnostics.forEach(function (d) {
        if (/unbalanced-brace|unterminated|internal/.test(d.kind)) { probs.push(d.message); ev.push(d.line); }
      });
      var junk = M.statements.filter(function (s) { return s.kind === 'junk'; });
      if (junk.length >= 2) { probs.push(plural(junk.length, 'line') + ' of bare names that do nothing'); junk.slice(0, 2).forEach(function (s) { ev.push(s.line); }); }
      var perLine = Object.create(null), crowded = [];
      M.statements.forEach(function (s) { if (s.kind !== 'label') perLine[s.line] = (perLine[s.line] || 0) + 1; });
      Object.keys(perLine).forEach(function (l) { if (perLine[l] > 6) crowded.push(+l); });
      if (crowded.length > 1) { probs.push(plural(crowded.length, 'line') + ' packed with more than six statements'); ev.push(crowded[0]); }
      if (!probs.length) return null;
      return { explanation: 'This does not read as a complete Java file: ' + probs.slice(0, 3).join('; ') + '.', evidence: ev };
    }
  };
  var GATE_OPMODE = {
    id: 'opmode-present', label: 'Contains an OpMode', severity: 'CRITICAL',
    hint: 'Your file needs a class that extends LinearOpMode (with runOpMode()) or OpMode (with loop()).',
    // an OpMode type with runOpMode or loop
    test: function (ctx) {
      var T = ctx.H.opMode();
      if (!T) return { explanation: 'No class extends LinearOpMode or OpMode, so there is no program for the robot to run.' };
      var ok = T.methods.some(function (m) { return (m.name === 'runOpMode' || m.name === 'loop') && m.block; });
      if (!ok) return { explanation: T.name + ' has no runOpMode() or loop() method.', evidence: [T.line] };
      return null;
    }
  };
  function rootProblem(ctx, c) {
    var M = ctx.model;
    if (c.ctorCall || c.chainRoot == null || c.receiverIsNew) return null;
    if (c.receiverText === '' || c.receiverText === 'this') {
      var n = c.name;
      if (M.methodsNamed(n).length || INHERITED_SET[n] || DSL_SET[n] || FTC_SET[n]) return null;
      if (M.staticImports.some(function (s) { return s.name === n || s.wildcard; })) return null;
      return n;
    }
    var root = c.rootIdent;
    if (!root || root === 'this' || root === 'super' || FTC_SET[root] || INHERITED_SET[root]) return null;
    if (M.declOf(root, c.start) || M.typeNamed(root)) return null;
    if (M.imports.some(function (im) { return im.name === root; }) || M.staticImports.some(function (s) { return s.name === root; })) return null;
    if (!/^[a-z_$]/.test(root) && /^[A-Z]/.test(root) && M.imports.some(function (im) { return im.wildcard; })) return null;
    return root;
  }
  var GATE_DECLARED = {
    id: 'declared-identifiers', label: 'Uses only names it declares', severity: 'CRITICAL', after: true,
    hint: 'Declare every variable you call methods on (a field, a local, or a parameter) — Java will not compile otherwise.',
    // chain roots of credited calls must be declared, a user type, an import, or FTC-provided; ≥ 2 → CRITICAL, 1 → WARNING
    test: function (ctx) {
      var bad = Object.create(null), order = [], offending = [];
      ctx.credited.forEach(function (c) {
        var r = rootProblem(ctx, c);
        if (!r) return;
        offending.push(c);
        if (!bad[r]) { bad[r] = c; order.push(r); }
      });
      if (!order.length) return null;
      var ev = order.map(function (r) { return bad[r]; });
      var names = order.slice(0, 4).map(function (r) { return "'" + r + "'"; }).join(', ');
      // ≥ 2 undeclared names: the code would not compile, and the requirements they earned get no credit
      if (order.length >= 2) return { explanation: names + ' are used but never declared, so this would not compile.', evidence: ev, voidCalls: offending, voidWhy: 'the declared-names check' };
      return { severity: 'WARNING', penalty: 5, explanation: names + ' is used but never declared.', evidence: ev };
    }
  };
  var GATE_LESSON_COPY = {
    id: 'lesson-copy', label: 'Written for this deliverable, not pasted from the lessons', severity: 'CRITICAL', penalty: 10,
    hint: 'Write the deliverable yourself. Reuse ideas from the lesson examples, but build your own program around them.',
    // 5-token coverage of the submission by the lesson snippets: ≥ 0.85 CRITICAL, ≥ 0.60 WARNING (only when ≥ 60 tokens)
    test: function (ctx) {
      var snippets = ctx.refs.snippets || [];
      if (!snippets.length || !window.RTJavaStructure) return null;
      if (ctx.model.tokens.length - 1 < 60) return null;
      var c = window.RTJavaStructure.coverage(ctx.src, snippets, 5);
      var pct = Math.round(c * 100);
      if (c >= 0.85) return { explanation: pct + '% of your code matches the lesson examples word for word.' };
      if (c >= 0.60) return { severity: 'WARNING', penalty: 10, explanation: pct + '% of your code matches the lesson examples word for word — make more of it your own.' };
      return null;
    }
  };
  var COMMON_GATES = [GATE_PARSES, GATE_OPMODE, GATE_DECLARED, GATE_LESSON_COPY];

  // ── Common informational issues ───────────────────────────────────────────
  var KEY_CALL = /^(setPower|setPosition|get|addData|update|execute|reset|follow|sequential|parallel|race|schedule|line|curve|setPose|create|getDistance|red|green|blue|isPressed|getCurrentPosition|setTargetPosition|setMode|build|setDone|setEnd|requiring|waitMs|instant|of|drive|run|stop|open|close)$/;
  // never-called methods that hold code the rules look for
  function unreachableIssue(ctx) {
    var M = ctx.model, T = ctx.H.opMode(), list = [];
    M.methods.forEach(function (m) {
      if (m.reachable || !m.block || m.anonymous || m.abstract) return;
      var hit = M.callsIn(m, 0).some(function (c) { return KEY_CALL.test(c.name); }) ||
        M.news.some(function (w) { return w.start > m.block.open && w.start < m.block.close && !!M.typeNamed(w.typeName); });
      if (hit) list.push(m);
    });
    if (!list.length) return [];
    list.sort(function (a, b) { return (a.owner === T ? 0 : 1) - (b.owner === T ? 0 : 1) || a.line - b.line; });   // the OpMode's own methods first
    var names = list.map(methodLabel), ev = list.map(function (m) { return m.line; });
    return [{ id: 'unreachable-code', severity: 'WARNING', penalty: 0,
      description: 'Never called: ' + names.slice(0, 6).join(', ') + (names.length > 6 ? ' and ' + (names.length - 6) + ' more' : '') +
        ' — nothing in your OpMode calls ' + (names.length === 1 ? 'this method' : 'these methods') + ', so the code inside earns no credit.',
      evidence: ev, fix: 'Call the method from runOpMode()/loop() (or from a method they call), or delete it.' }];
  }
  // code under if (false) / while (false)
  function deadBranchIssue(ctx) {
    var M = ctx.model, out = [];
    M.conds.forEach(function (c) {
      if (!c.constantFalse || c.negated || c.caseLabel || !c.reachable) return;
      var b = c.block;
      var has = M.calls.some(function (x) { return x.start > b.open && x.start <= b.close; });
      if (!has) return;
      out.push({ id: 'dead-branch', severity: 'SUGGESTION', penalty: 0,
        description: 'Code under "' + b.kind + ' (' + c.text + ')" at line ' + c.line + ' can never run, so it earns no credit.',
        evidence: [c.line], fix: 'Remove the always-false condition or the code under it.' });
    });
    return out.slice(0, 2);
  }
  var COMMON_ISSUES = [unreachableIssue, deadBranchIssue];

  // ════════════════════════════════════════════════════════════════════════
  // Common forbidden patterns
  // ════════════════════════════════════════════════════════════════════════
  var F_SYSTEM_EXIT = {
    id: 'system-exit', label: 'No System.exit()', severity: 'CRITICAL', penalty: 25,
    hint: 'Never call System.exit() in an OpMode — it kills the Robot Controller app.',
    test: function (ctx) {
      var c = ctx.model.calls.filter(function (x) { return x.name === 'exit' && x.receiverChain.join('.') === 'System'; });
      return c.length ? { evidence: c } : null;
    }
  };
  var F_WHILE_TRUE = {
    id: 'while-true', label: 'No while(true)', severity: 'WARNING', penalty: 10,
    hint: 'Use while (opModeIsActive()) so the loop stops when the driver presses Stop.',
    test: function (ctx) {
      var b = ctx.model.blocks.filter(function (x) {
        return (x.kind === 'while' || x.kind === 'do' || x.kind === 'for') && x.cond && (x.cond.constantTrue || (x.kind === 'for' && x.cond.end <= x.cond.start));
      });
      return b.length ? { evidence: b.map(function (x) { return x.cond.line || x.line; }) } : null;
    }
  };
  var F_SLEEP_IN_LOOP = {
    id: 'sleep-in-loop', label: 'No sleep() inside the TeleOp loop', severity: 'WARNING', penalty: 10,
    hint: 'sleep() inside the TeleOp loop freezes every control — avoid it in TeleOp.',
    test: function (ctx) {
      var c = ctx.model.calls.filter(function (x) { return x.name === 'sleep' && (isReceiverless(x) || x.receiverChain.join('.') === 'Thread') && x.inLoop && x.live; });
      return c.length ? { evidence: c } : null;
    }
  };
  // setPower(...) whose next statement in the same block is sleep(n), n ≥ 100
  function timeBased(penalty, hint) {
    return {
      id: 'time-based', label: 'No time-based driving', severity: 'WARNING', penalty: penalty, hint: hint,
      test: function (ctx) {
        var M = ctx.model, hits = [];
        M.calls.forEach(function (c) {
          if (c.name !== 'setPower' || !c.isStatementHead || !c.statement || !c.live) return;
          var list = c.statement.block.statements, k = list.indexOf(c.statement), nx = list[k + 1];
          if (!nx || nx.kind !== 'call') return;
          var s = M.calls.filter(function (x) { return x.isStatementHead && x.statement === nx && x.name === 'sleep'; })[0];
          if (!s || !s.args.length) return;
          var v = ctx.H.numericArg(s.args[0]);
          if (v !== null && v >= 100) hits.push(c);
        });
        return hits.length ? { evidence: hits } : null;
      }
    };
  }
  var F_LEGACY_PEDRO = {
    id: 'legacy-pedro', label: 'Pedro 2 API', severity: 'WARNING', penalty: 10,
    hint: 'This is the Pedro 2 API. Pedro 3 builds paths with line()/curve() + .linear() and follows them with follow(follower, path).',
    test: function (ctx) { var r = ctx.H.textRule(LEGACY_PEDRO); return r.count ? { evidence: r.lines.slice(0, 3) } : null; }
  };
  var F_LEGACY_COMMANDS = {
    id: 'legacy-commands', label: 'FTCLib command API', severity: 'WARNING', penalty: 10,
    hint: 'That is the FTCLib API; this module uses Ivy: Command.build(), sequential(), Scheduler.',
    test: function (ctx) { var r = ctx.H.textRule(LEGACY_COMMANDS); return r.count ? { evidence: r.lines.slice(0, 3) } : null; }
  };
  var F_EMPTY_CATCH = {
    id: 'empty-catch', label: 'No empty catch blocks', severity: 'WARNING', penalty: 10,
    hint: 'An empty catch hides errors — at least log them to telemetry.',
    test: function (ctx) {
      var b = ctx.model.blocks.filter(function (x) { return x.kind === 'catch' && x.statements.length === 0; });
      return b.length ? { evidence: b.map(function (x) { return x.line; }) } : null;
    }
  };
  var F_TODO = {
    id: 'todo', label: 'No leftover TODOs', severity: 'SUGGESTION', penalty: 3,
    hint: 'Resolve or remove TODO markers before submitting.',
    test: function (ctx) {
      var c = (ctx.model.comments || []).filter(function (x) { return /\bTODO\b/.test(x.text || ''); });
      return c.length ? { evidence: c.map(function (x) { return x.line; }) } : null;
    }
  };
  var F_DOUBLE_UPDATE = {
    id: 'double-update', label: 'follower.update() called once per loop', severity: 'WARNING', penalty: 10,
    hint: 'Call follower.update() exactly once per loop iteration — a second call advances the path twice as fast.',
    test: function (ctx) {
      var found = null;
      ctx.H.loopBodies().forEach(function (lb) {
        if (found) return;
        var ups = followerUpdates(ctx, lb);
        if (ups.length >= 2) found = ups;
      });
      return found ? { explanation: 'follower.update() runs ' + found.length + ' times per loop (lines ' + found.map(function (c) { return c.line; }).join(' and ') + ').', evidence: found } : null;
    }
  };

  // ════════════════════════════════════════════════════════════════════════
  // Phase 1 — TeleOp
  // ════════════════════════════════════════════════════════════════════════
  // an OpMode type with an entry method
  function p1OpMode(ctx) {
    var T = ctx.H.opMode();
    if (!T) return R(0, 'No class extends LinearOpMode or OpMode.');
    var entry = T.methods.filter(function (m) { return (m.name === 'runOpMode' || m.name === 'loop') && m.block; })[0];
    return entry ? R(1, T.name + ' extends ' + T.extends + ' and has ' + entry.name + '().', [T.line]) : R(0.5, T.name + ' has no runOpMode() or loop().', [T.line]);
  }
  // ≥ 1 control loop; a LinearOpMode loop without waitForStart() before it → ×0.5
  function p1Loop(ctx) {
    var H = ctx.H, lbs = H.loopBodies();
    if (!lbs.length) return R(0, 'No while (opModeIsActive()) loop (or OpMode loop()) was found in code that runs.');
    var lb = lbs[0];
    if (H.isLinear() && lb.kind !== 'method') {
      var head = lb.header ? lb.header.start : lb.open;
      var wfs = ctx.model.calls.filter(function (c) { return c.name === 'waitForStart' && c.live && c.start < head && c.method === lb.methodRef; });
      if (!wfs.length) return R(0.5, 'The loop at line ' + lb.line + ' starts without waitForStart() before it, so it would run during INIT.', [lb.line]);
    }
    return R(1, 'Control loop at line ' + lb.line + '.', [lb.line]);
  }
  // min(1, usedMotors/2): hardwareMap motors with distinct device names and ≥ 1 live use
  function p1Motors(ctx) {
    var all = ctx.H.motors().filter(function (v) { return v.live; });
    var used = ctx.H.distinct(all.filter(function (v) { return v.uses.length; }), function (v) { return v.deviceName != null ? 'd:' + v.deviceName : 'n:' + v.name + v.get.line; });
    var unused = all.filter(function (v) { return !v.uses.length; });
    var c = Math.min(1, used.length / 2);
    var ex = c >= 0.999 ? plural(used.length, 'motor') + ' from hardwareMap, each used.'
      : 'Found ' + plural(used.length, 'used motor') + ' from hardwareMap (needs 2)' + (unused.length ? '; ' + unused.map(function (v) { return v.name; }).join(', ') + ' is initialised but never used' : '') + '.';
    return R(c, ex, used.map(function (v) { return v.get; }).concat(unused.map(function (v) { return v.get; })));
  }
  // a servo var with a live setPosition/setPower
  function p1Servo(ctx) {
    var sv = ctx.H.servos().filter(function (v) { return v.live; });
    var moved = sv.filter(function (v) { return v.uses.some(function (u) { return u.name === 'setPosition' || u.name === 'setPower'; }); });
    if (moved.length) return R(1, 'Servo ' + moved[0].name + ' is initialised and moved.', [moved[0].get, moved[0].uses.filter(function (u) { return /^set(Position|Power)$/.test(u.name); })[0]]);
    if (sv.length) return R(0, 'Servo ' + sv[0].name + ' is initialised but never moved with setPosition().', [sv[0].get]);
    return R(0, 'No Servo or CRServo is taken from hardwareMap.');
  }
  // a stick token in a loop body or a method called (≤ 2 hops) from it
  function p1Joystick(ctx) {
    var H = ctx.H, found = null;
    H.loopRegions(2).forEach(function (r) {
      if (found) return;
      var g = padIn(ctx, r, ['stick', 'stick_y']).filter(function (x) { return H.liveToken(x.i); });
      if (g.length) found = g[0];
    });
    if (found) return R(1, 'Reads ' + found.pad + '.' + found.name + ' in the control loop.', [found.line, H.callAround(found.i)]);
    var any = padIn(ctx, null, ['stick', 'stick_y'])[0];
    return any ? R(0, 'The joystick read at line ' + any.line + ' is not inside the control loop, so it happens once instead of every cycle.', [any.line])
      : R(0, 'No gamepad joystick (left_stick_y, right_stick_x, …) is read.');
  }
  function invertedAt(ctx, g) {
    var M = ctx.model;
    // token before the gamepad root (skip `this .` and opening parens)
    var p = g.i - 1;
    if (tok(ctx, p) && tok(ctx, p).value === '.' && tok(ctx, p - 1) && tok(ctx, p - 1).value === 'this') p -= 2;
    while (tok(ctx, p) && tok(ctx, p).value === '(') p--;
    var before = tok(ctx, p);
    if (before && before.type === 'op' && before.value === '-') return true;
    // `-1 * y`
    if (before && before.value === '*' && tok(ctx, p - 1) && tok(ctx, p - 1).type === 'number' && tok(ctx, p - 2) && tok(ctx, p - 2).value === '-') return true;
    // `y * -1`
    var a = g.field + 1;
    while (tok(ctx, a) && tok(ctx, a).value === ')') a++;
    if (tok(ctx, a) && tok(ctx, a).value === '*' && tok(ctx, a + 1) && tok(ctx, a + 1).value === '-' && tok(ctx, a + 2) && tok(ctx, a + 2).type === 'number') return true;
    if (tok(ctx, a) && tok(ctx, a).value === '*' && tok(ctx, a + 1) && tok(ctx, a + 1).type === 'number' && /^-/.test(tok(ctx, a + 1).value)) return true;
    return false;
  }
  // `-` before *_stick_y, `*_stick_y * -1`, or `-v` / `v * -1` where v flows 1 hop from a stick_y
  function p1YInvert(ctx) {
    var M = ctx.model, H = ctx.H;
    var ys = padIn(ctx, null, ['stick_y']).filter(function (g) { return H.liveToken(g.i); });
    if (!ys.length) return R(0, 'No *_stick_y read was found to invert.');
    for (var k = 0; k < ys.length; k++) if (invertedAt(ctx, ys[k])) return R(1, 'Line ' + ys[k].line + ' inverts the stick Y axis.', [ys[k].line, H.callAround(ys[k].i)]);
    // -v or v * -1 where v holds a stick_y value
    for (var i = 0; i < M.tokens.length - 1; i++) {
      var t = tok(ctx, i);
      if (!isIdent(t) || (tok(ctx, i + 1) && /^[.(]$/.test(tok(ctx, i + 1).value)) || (tok(ctx, i - 1) && tok(ctx, i - 1).value === '.')) continue;
      var pre = tok(ctx, i - 1), post = tok(ctx, i + 1);
      var neg = (pre && pre.type === 'op' && pre.value === '-' && !(tok(ctx, i - 2) && (isIdent(tok(ctx, i - 2)) || tok(ctx, i - 2).type === 'number' || tok(ctx, i - 2).value === ')'))) ||
        (post && post.value === '*' && tok(ctx, i + 2) && tok(ctx, i + 2).value === '-' && tok(ctx, i + 3) && tok(ctx, i + 3).type === 'number');
      if (!neg || !H.liveToken(i)) continue;
      var d = M.declOf(t.value, i);
      if (!d) continue;
      var r = M.flowsTo(function (x) { return H.gamepadTokens({ start: x.i, end: x.i + 1 }).some(function (g) { return g.kind === 'stick_y'; }); },
        { start: i, end: i + 1, method: (M.blockAt(i) || {}).methodRef }, { maxHops: 1 });
      if (r && r.ok) return R(1, 'Line ' + t.line + ' negates ' + t.value + ', which holds the stick Y value.', [t.line, H.callAround(i)]);
    }
    return R(0, 'The stick Y value at line ' + ys[0].line + ' is used as-is; pushing forward reads negative, so the robot drives backward.', [ys[0].line]);
  }
  function driveMotorCalls(ctx) {
    return memo(ctx, 'driveCalls', function () {
      return loopCalls(ctx).filter(function (c) {
        if (c.name !== 'setPower' || !c.args.length) return false;
        return flowsFromPad(ctx, c.args[0], c.method, ['stick', 'stick_y'], 3).ok || flowsFromStickViaParam(ctx, c);
      });
    });
  }
  // live loop setPower whose argument flows from a stick; distinct receivers n → min(1, n/2)
  function p1DriveFlow(ctx) {
    var calls = driveMotorCalls(ctx);
    var recv = ctx.H.distinct(calls, function (c) { return c.receiverText; });
    var c = Math.min(1, recv.length / 2);
    if (!recv.length) {
      var sp = loopCalls(ctx).filter(function (x) { return x.name === 'setPower'; });
      return R(0, sp.length ? 'setPower() at line ' + sp[0].line + ' does not get its value from a joystick.' : 'No setPower() in the control loop.', sp.slice(0, 1));
    }
    return R(c, c >= 0.999 ? plural(recv.length, 'motor') + ' get their power from the joysticks.' : 'Only ' + recv[0].receiverText + ' gets its power from a joystick (needs 2 drive motors).', recv);
  }
  // 1: setPosition/setPower (not a drive motor) under a button/trigger condition or fed by a trigger; 0.5: button cond with no hardware call
  function p1Mechanism(ctx) {
    var M = ctx.model, H = ctx.H;
    var driveRecv = driveMotorCalls(ctx).map(function (c) { return c.receiverText; });
    var mech = loopCalls(ctx).filter(function (c) { return (c.name === 'setPosition' || c.name === 'setPower') && driveRecv.indexOf(c.receiverText) < 0; });
    function condHasButton(cond) {
      if (cond.caseLabel) return false;
      if (padIn(ctx, cond, ['button', 'trigger']).length) return true;
      var r = M.flowsTo(function (x) { return H.gamepadTokens({ start: x.i, end: x.i + 1 }).some(function (g) { return g.kind === 'button' || g.kind === 'trigger'; }); },
        { start: cond.start, end: cond.end, method: cond.method }, { maxHops: 1 });
      return !!(r && r.ok);
    }
    for (var k = 0; k < mech.length; k++) {
      var c = mech[k];
      var cond = c.condChain.filter(function (x) { return !x.negated && condHasButton(x); })[0];
      if (cond) return R(1, c.receiverText + '.' + c.name + '() at line ' + c.line + ' runs when a button is pressed.', [cond, c]);
      if (c.args.length && flowsFromPad(ctx, c.args[0], c.method, ['trigger', 'button'], 1).ok) return R(1, c.receiverText + '.' + c.name + '() at line ' + c.line + ' is driven by a trigger/button.', [c]);
    }
    // a button condition in the loop that calls a helper which moves hardware
    var conds = M.conds.filter(function (x) { return x.live && !x.negated && H.inLoopRegion(x.start) && condHasButton(x); });
    for (var j = 0; j < conds.length; j++) {
      var b = conds[j].block;
      var moved = H.callsWithin({ start: b.open, end: b.close + 1 }, 2).filter(function (x) { return (x.name === 'setPosition' || x.name === 'setPower') && driveRecv.indexOf(x.receiverText) < 0; });
      if (moved.length) return R(1, 'The button at line ' + conds[j].line + ' moves ' + moved[0].receiverText + ' (line ' + moved[0].line + ').', [conds[j], moved[0]]);
    }
    if (conds.length) return R(0.5, 'The button check at line ' + conds[0].line + ' does not move a servo or mechanism motor.', [conds[0]]);
    return R(0, 'No button or trigger controls a mechanism in the loop.');
  }
  // distinct live loop addData captions: min(1, n/2); LinearOpMode without telemetry.update() → ×0.5
  function p1Telemetry(ctx) {
    var list = captions(ctx, loopTelemetry(ctx));
    var c = Math.min(1, list.length / 2);
    var ex = plural(list.length, 'telemetry value') + ' shown in the loop';
    if (c > 0 && ctx.H.isLinear() && !telemetryUpdated(ctx)) { c *= 0.5; ex += ', but telemetry.update() is never called so the Driver Hub never shows them'; }
    else if (list.length < 2) ex += ' (needs 2)';
    return R(c, ex + '.', list);
  }
  // min(1, explaining comments / 3)
  function p1Comments(ctx) { return commentCredit(ctx, 3); }

  // ════════════════════════════════════════════════════════════════════════
  // Phase 2 — Structure
  // ════════════════════════════════════════════════════════════════════════
  // 0.5 a class with ≥ 2 motor fields + 0.5 a public method (that runs) setPowers ≥ 2 of them
  function p2Drivetrain(ctx) {
    var d = drivetrainInfo(ctx);
    if (!d) return R(0, 'No class (other than the OpMode) owns two or more drive motors.');
    var c = 0.5, ex = d.type.name + ' owns ' + plural(d.sub.motors.length, 'motor field');
    if (d.methodLive) { c = 1; ex += ' and ' + d.methodLive.name + '() sets their power.'; }
    else if (d.method) { c = 0.75; ex += '; ' + d.method.name + '() sets their power but is never called.'; }
    else ex += ', but no public method sets power on them.';
    return R(c, ex, [d.type.line, d.methodLive || d.method]);
  }
  // 1: a public method that runs uses the mechanism's hardware field; 0.5: fields only
  function p2Mechanism(ctx) {
    var subs = mechanismSubs(ctx), best = null;
    subs.forEach(function (s) {
      s.type.methods.forEach(function (m) {
        if (best || m.isCtor || !m.block || !nonPrivate(m) || !m.reachable) return;
        var uses = s.fields.some(function (f) { return fieldUses(ctx, s.type, f).some(function (c) { return c.start > m.block.open && c.start < m.block.close; }); });
        if (uses) best = { s: s, m: m };
      });
    });
    if (best) return R(1, best.s.type.name + '.' + best.m.name + '() controls its hardware.', [best.s.type.line, best.m]);
    if (subs.length) return R(0.5, subs[0].type.name + ' has hardware fields but no public method that runs uses them.', [subs[0].type.line]);
    return R(0, 'No mechanism class (Intake, Claw, Lift, …) owns hardware.');
  }
  // private hardware fields ÷ all hardware fields (OpMode fields and OpMode hardware locals count as non-private)
  function p2PrivateFields(ctx) {
    var H = ctx.H, fields = hwFields(ctx), T = H.opMode();
    var priv = fields.filter(function (f) { return f.modifiers.indexOf('private') >= 0 && !(T && f.owner === T); });
    var opLocals = H.hardwareVars().filter(function (v) { return T && v.decl && v.decl.scope === 'local' && v.get.type === T; });
    var total = fields.length + opLocals.length;
    if (!total) return R(0, 'No hardware fields were found.');
    var open = fields.filter(function (f) { return priv.indexOf(f) < 0; });
    var c = priv.length / total;
    return R(c, c >= 0.999 ? 'All ' + plural(total, 'hardware field') + ' are private.' : priv.length + ' of ' + total + ' hardware fields are private' + (open.length ? '; ' + open.slice(0, 3).map(function (f) { return f.name; }).join(', ') + ' ' + (open.length === 1 ? 'is' : 'are') + ' not' : '') + '.',
      open.slice(0, 3).map(function (f) { return f.line; }).concat(priv.slice(0, 2).map(function (f) { return f.line; })));
  }
  // min(1, constructedSubsystems/2) in a Robot class that is itself created
  function p2Robot(ctx) {
    var r = robotInfo(ctx);
    if (!r) return R(0, 'No class constructs the subsystems from the HardwareMap.');
    var n = r.liveBuilt.length;
    if (!n) return R(0.25, r.type.name + ' builds ' + r.built.join(', ') + ' but is never created.', r.nodes);
    var c = Math.min(1, n / 2);
    return R(c, r.type.name + ' creates ' + r.liveBuilt.join(', ') + (c < 0.999 ? ' (needs 2 subsystems)' : '') + '.', r.nodes);
  }
  // min(1, n/2): subsystem constructors (or init methods) whose HardwareMap parameter is the .get() receiver
  function p2HwParam(ctx) {
    var M = ctx.model, list = [];
    M.methods.forEach(function (m) {
      if (!m.block || !m.reachable || !m.owner || isOpModeType(ctx, m.owner)) return;
      var ps = m.params.filter(function (p) { return baseType(p.type) === 'HardwareMap'; }).map(function (p) { return p.name; });
      if (!ps.length) return;
      var g = M.calls.filter(function (c) { return c.name === 'get' && c.start > m.block.open && c.start < m.block.close && ps.indexOf(c.receiverChain[0]) >= 0; });
      if (g.length) list.push(g[0]);
    });
    var c = Math.min(1, list.length / 2);
    return R(c, plural(list.length, 'subsystem') + (list.length === 1 ? ' takes' : ' take') + ' the HardwareMap (constructor or init method) and ' + (list.length === 1 ? 'gets its' : 'get their') + ' devices from it' + (c < 0.999 ? ' (needs 2)' : '') + '.', list);
  }
  // 0.5 an enum type + 0.5 it is assigned, compared or switched on in code that runs
  function p2Enum(ctx) {
    var enums = ctx.model.types.filter(function (T) { return T.kind === 'enum'; });
    if (!enums.length) return R(0, 'No enum is declared.');
    for (var k = 0; k < enums.length; k++) {
      var u = ctx.H.enumUsed(enums[k].name);
      if (u.assigned || u.compared || u.switched) return R(1, 'enum ' + enums[k].name + ' is declared and used (line ' + ctx.H.ev(u.nodes[0]).line + ').', [enums[k].line, u.nodes[0]]);
    }
    return R(0.5, 'enum ' + enums[0].name + ' is declared but never assigned, compared or switched on.', [enums[0].line]);
  }
  // 0.5 new Robot(hardwareMap) in an init body + 0.5 ≥ 2 live loop calls through that variable
  function p2OpMode(ctx) {
    var M = ctx.model, H = ctx.H, T = H.opMode();
    if (!T) return R(0, 'No OpMode.');
    var rob = robotInfo(ctx);
    function mapArg(a) { return /hardwareMap/.test(a.text) || H.varType(norm(a.text), a.start) === 'HardwareMap'; }
    var news = M.news.filter(function (w) {
      if (!w.live || w.start < T.block.open || w.start > T.block.close || !M.typeNamed(w.typeName) || w.typeName === T.name) return false;
      if (rob && w.typeName !== rob.type.name) return false;
      return w.args.some(mapArg);
    });
    // Hardware robot = new Hardware(); … robot.init(hardwareMap);
    M.calls.forEach(function (x) {
      if (!x.live || x.start < T.block.open || x.start > T.block.close || x.receiverChain.length !== 1 || !x.args.some(mapArg)) return;
      var t = H.varType(x.receiverChain[0], x.start);
      if (t && M.typeNamed(t) && t !== T.name && (!rob || t === rob.type.name)) news.push({ nodeType: 'call', typeName: t, start: x.start, end: x.end, line: x.line, call: x, target: x.receiverChain[0] });
    });
    if (!news.length) return R(0, 'The OpMode never creates ' + (rob ? rob.type.name : 'a Robot') + '(hardwareMap).');
    var w = news.filter(function (x) { return inInit(ctx, x.start); })[0] || null;
    var c = w ? 0.5 : 0.25, node = w || news[0];
    var name = node.target || H.targetOf(node);
    if (node.call) node = node.call;
    var calls = name ? loopCalls(ctx).filter(function (x) { return x.rootIdent === name.split('.').pop(); }) : [];
    if (calls.length >= 2) c += 0.5; else if (calls.length === 1) c += 0.25;
    var ex = 'The OpMode creates ' + (w || news[0]).typeName + (w ? ' during init' : ' outside init') + ' and calls it ' + plural(calls.length, 'time') + ' in the loop' + (calls.length < 2 ? ' (needs 2)' : '') + '.';
    return R(c, ex, [node].concat(calls.slice(0, 2)));
  }
  // 1 if the OpMode makes no hardwareMap.get/setPower/setPosition calls and has no hardware fields
  function noHardwareInOpMode(ctx) {
    var T = ctx.H.opMode();
    if (!T) return R(0, 'No OpMode.');
    var hits = opModeHardware(ctx);
    if (!hits.length) return R(1, T.name + ' only talks to your classes.', [T.line]);
    return R(0, T.name + ' touches hardware directly at line ' + ctx.H.ev(hits[0]).line + ' — move that into a subsystem.', hits);
  }
  // min(1, n/3): non-private, non-constructor methods on subsystem classes
  function p2PublicMethods(ctx) {
    var list = [], idle = [];
    subsystems(ctx).forEach(function (s) {
      if (!typeLive(s.type)) { idle.push(s.type.name); return; }
      s.type.methods.forEach(function (m) { if (!m.isCtor && m.block && nonPrivate(m)) list.push(m); });
    });
    var c = Math.min(1, list.length / 3);
    return R(c, plural(list.length, 'public subsystem method') + (c < 0.999 ? ' (needs 3)' : '') + (idle.length ? '; ' + idle.join(', ') + (idle.length === 1 ? ' is' : ' are') + ' never created' : '') + '.', list.slice(0, 3));
  }
  // min(1, explaining comments / 2)
  function p2Comments(ctx) { return commentCredit(ctx, 2); }

  // ════════════════════════════════════════════════════════════════════════
  // Phase 3 — Sensor autonomous
  // ════════════════════════════════════════════════════════════════════════
  // 0.5 @Autonomous + 0.5 waitForStart() (or start()/loop())
  function p3Autonomous(ctx) {
    var T = ctx.H.opMode();
    if (!T) return R(0, 'No OpMode.');
    var c = 0, parts = [];
    if (T.annotations.indexOf('Autonomous') >= 0) c += 0.5; else parts.push('no @Autonomous annotation');
    var wfs = ctx.model.calls.filter(function (x) { return x.name === 'waitForStart' && x.live; })[0];
    var iter = T.methods.some(function (m) { return m.name === 'start' || m.name === 'loop'; });
    if (wfs || iter) c += 0.5; else parts.push('no waitForStart()');
    return R(c, c >= 0.999 ? T.name + ' is an @Autonomous that waits for START.' : T.name + ': ' + parts.join(', ') + '.', [T.line, wfs]);
  }
  // a sensor from hardwareMap that is used (0.5 when it is only initialised)
  function p3SensorType(ctx) {
    var s = ctx.H.sensors().filter(function (v) { return v.live; });
    var used = s.filter(function (v) { return v.uses.length; });
    if (used.length) return R(1, used[0].typeText + ' ' + used[0].name + ' comes from hardwareMap and is used.', [used[0].get]);
    if (s.length) return R(0.5, s[0].typeText + ' ' + s[0].name + ' is initialised but never read.', [s[0].get]);
    return R(0, 'No color, distance, touch sensor or IMU is taken from hardwareMap.');
  }
  // a live sensor read in a loop (control or iterating) or a method called from it
  function p3SensorRead(ctx) {
    var M = ctx.model, H = ctx.H;
    var reads = M.calls.filter(function (c) { return c.live && H.isSensorRead(c); });
    if (!reads.length) return R(0, 'No sensor value is read (red(), getDistance(), isPressed(), …).');
    function inIterating(c) {
      for (var b = c.block; b && b.kind !== 'method' && b.kind !== 'type'; b = b.parent) if (b.iterates && b.kind !== 'for') return true;
      // a read in a while/do header
      return M.blocks.some(function (b) { return (b.kind === 'while' || b.kind === 'do') && b.cond && c.start >= b.cond.start && c.start < b.cond.end && !b.dead; });
    }
    var good = reads.filter(function (c) { return H.inLoopRegion(c) || inIterating(c); });
    if (!good.length) {
      // reads inside methods called from an iterating loop
      good = reads.filter(function (c) {
        return M.calls.some(function (k) { return k.live && inIterating(k) && M.resolveCall(k).methods.indexOf(c.method) >= 0; });
      });
    }
    if (good.length) return R(1, good[0].receiverText + '.' + good[0].name + '() is read every loop (line ' + good[0].line + ').', [good[0]]);
    return R(0.5, 'The sensor is read once at line ' + reads[0].line + ', outside any loop, so the robot never sees it change.', [reads[0]]);
  }
  // 0.3 switch on an enum var in a loop + 0.3 ≥ 3 cases + 0.4 the switched var is assigned in ≥ 2 cases
  function p3StateMachine(ctx) {
    var M = ctx.model, H = ctx.H, best = null;
    M.blocks.forEach(function (b) {
      if (b.kind !== 'switch' || !b.cond || b.dead || !(b.methodRef && b.methodRef.reachable)) return;
      var name = norm(b.cond.text).replace(/^this\./, '');
      var t = /^[A-Za-z_$][\w$]*$/.test(name) ? H.varType(name, b.cond.start) : null;
      var isEnum = !!(t && M.typeNamed(t) && M.typeNamed(t).kind === 'enum');
      var inLoop = H.inLoopRegion(b.open);
      var labels = M.cases.filter(function (c) { return c.block === b && !c.isDefault; });
      var nCases = labels.reduce(function (n, c) { return n + Math.max(1, c.labels.length); }, 0);
      var caseStmts = b.statements.filter(function (s) { return s.isCase; });
      var withAssign = caseStmts.filter(function (cs, k) {
        var end = caseStmts[k + 1] ? caseStmts[k + 1].start : b.close;
        return M.assigns.some(function (a) { return a.index > cs.start && a.index < end && a.targetBase === name && a.op === '='; });
      });
      var c = (isEnum && inLoop ? 0.3 : (inLoop || isEnum) ? 0.15 : 0) + (nCases >= 3 ? 0.3 : nCases * 0.1) + (withAssign.length >= 2 ? 0.4 : withAssign.length * 0.2);
      if (!best || c > best.c) best = { c: c, b: b, isEnum: isEnum, inLoop: inLoop, n: nCases, a: withAssign.length };
    });
    if (!best) return R(0, 'No switch statement drives the routine.');
    var notes = [];
    if (!best.isEnum) notes.push('it switches on a value that is not an enum');
    if (!best.inLoop) notes.push('it is not inside the control loop');
    if (best.n < 3) notes.push('it has ' + plural(best.n, 'case') + ' (needs 3)');
    if (best.a < 2) notes.push('only ' + plural(best.a, 'case') + ' move to the next state');
    return R(best.c, best.c >= 0.999 ? 'switch at line ' + best.b.line + ' runs ' + best.n + ' enum states and changes state in ' + best.a + ' of them.'
      : 'switch at line ' + best.b.line + ': ' + notes.join('; ') + '.', [best.b.line]);
  }
  // 1 an ElapsedTime read (.seconds()/.milliseconds()) inside a live condition; 0.5 declared/reset only
  function p3Timing(ctx) {
    var M = ctx.model, H = ctx.H;
    var timers = M.decls.filter(function (d) { return baseType(d.inferredType || d.typeText) === 'ElapsedTime'; });
    var inCond = M.calls.filter(function (c) {
      if (!c.live) return false;
      var timer = /^(seconds|milliseconds|time|nanoseconds)$/.test(c.name) && H.receiverType(c) === 'ElapsedTime';
      if (!timer && !(c.name === 'getRuntime' && isReceiverless(c))) return false;
      return M.conds.some(function (k) { return k.live && !k.negated && c.start >= k.start && c.start < k.end && k.hasComparison; });
    });
    if (inCond.length) return R(1, 'Line ' + inCond[0].line + ' moves on after a measured time.', [inCond[0]]);
    if (timers.length) return R(0.5, 'ElapsedTime ' + timers[0].name + ' is declared but never compared in a condition.', [timers[0].line]);
    return R(0, 'No ElapsedTime timer decides when a step is over.');
  }
  // 0.5 new Robot/<X>(hardwareMap) + 0.5 ≥ 2 live calls through it
  function p3Subsystems(ctx) {
    var M = ctx.model, H = ctx.H;
    var news = M.news.filter(function (w) {
      return w.live && !/^(ElapsedTime|Pose)$/.test(w.typeName) && w.args.some(function (a) { return /^hardwareMap$/.test(norm(a.text)) || H.varType(norm(a.text), a.start) === 'HardwareMap'; });
    });
    if (!news.length) return R(0, 'No Robot or subsystem class is created with hardwareMap.');
    var best = null;
    news.forEach(function (w) {
      var name = H.targetOf(w);
      var calls = name ? M.calls.filter(function (c) { return c.live && c.rootIdent === name.split('.').pop() && c.receiverText !== ''; }) : [];
      if (!best || calls.length > best.calls.length) best = { w: w, calls: calls };
    });
    var c = 0.5 + (best.calls.length >= 2 ? 0.5 : best.calls.length * 0.25);
    return R(c, 'Creates ' + best.w.typeName + ' and calls it ' + plural(best.calls.length, 'time') + (best.calls.length < 2 ? ' (needs 2)' : '') + '.', [best.w].concat(best.calls.slice(0, 2)));
  }
  // setPower(0)/stop() after the loop, in a DONE-like case, or in stop()
  function p3Stop(ctx) {
    var M = ctx.model, H = ctx.H, found = null;
    H.loopBodies().forEach(function (lb) {
      if (found || lb.kind === 'method') return;
      M.after(lb).forEach(function (st) {
        if (found) return;
        var c = H.callsWithin({ start: st.start, end: st.end }, 1).filter(isStopCall)[0];
        if (c) found = c;
      });
    });
    if (!found) {
      M.cases.forEach(function (cs) {
        if (found || !cs.live || !cs.labels.some(function (l) { return DONE_LABEL.test(l); })) return;
        var sw = cs.block, stmts = sw.statements, k = -1;
        stmts.forEach(function (s, i) { if (s.caseCond === cs && s.isCase) k = i; });
        var end = sw.close;
        for (var i = k + 1; i < stmts.length; i++) if (stmts[i].isCase) { end = stmts[i].start; break; }
        var c = k >= 0 ? H.callsWithin({ start: stmts[k].end, end: end }, 1).filter(isStopCall)[0] : null;
        if (c) found = c;
      });
    }
    if (!found) {
      var stopM = M.methods.filter(function (m) { return m.name === 'stop' && m.owner === H.opMode() && m.block; })[0];
      if (stopM) found = H.callsIn(stopM, 1).filter(isStopCall)[0] || null;
    }
    if (!found) {
      // stop inside the loop under a condition that ends the routine (e.g. state = DONE nearby)
      var inLoop = loopCalls(ctx).filter(function (c) { return isStopCall(c) && c.condChain.length > 1; });
      if (inLoop.length) return R(0.5, 'Motors stop inside the loop at line ' + inLoop[0].line + ', but not when the routine ends.', [inLoop[0]]);
      return R(0, 'Nothing sets the motors to 0 when the routine finishes.');
    }
    return R(1, 'Motors stop when the routine ends (line ' + found.line + ').', [found]);
  }
  // an addData whose value is sensor-derived, and telemetry.update() in the loop (LinearOpMode)
  function p3Telemetry(ctx) {
    var H = ctx.H, list = loopTelemetry(ctx);
    if (!list.length) return R(0, 'No telemetry in the loop.');
    var sensed = list.filter(function (c) { return c.args.slice(1).some(function (a) { return H.sensorDerived(a, c.method); }); });
    if (!sensed.length) return R(0.3, 'Telemetry does not show a sensor value.', [list[0]]);
    if (H.isLinear() && !telemetryUpdated(ctx)) return R(0.5, 'Sensor telemetry at line ' + sensed[0].line + ', but telemetry.update() is never called in the loop.', [sensed[0]]);
    return R(1, 'Line ' + sensed[0].line + ' shows a sensor value.', [sensed[0]]);
  }

  // ════════════════════════════════════════════════════════════════════════
  // Phase 4 — PID + Pedro Pathing 3
  // ════════════════════════════════════════════════════════════════════════
  // Error variables: rhs is a depth-0 `A - B` with an encoder/pose side (≤ 2 hops) or a name like /err/.
  function errorVars(ctx) {
    return memo(ctx, 'errVars', function () {
      var M = ctx.model, out = [];
      function consider(name, range, node, method) {
        var mins = depth0Minus(ctx, range);
        if (!mins.length) return;
        var ok = /err/i.test(name);
        if (!ok) {
          var r = M.flowsTo(function (t, c) { return !!c && ENCODER_READS.test(c.name); }, { start: range.start, end: range.end, method: method }, { maxHops: 2 });
          ok = !!(r && r.ok);
        }
        if (ok && !out.some(function (e) { return e.name === name && e.node === node; })) out.push({ name: name, node: node, range: range });
      }
      M.decls.forEach(function (d) { if (d.init && (!d.method || d.method.reachable) && ctx.H.liveToken(d.index)) consider(d.name, d.init, d, d.method); });
      M.assigns.forEach(function (a) { if (a.op === '=' && a.live) consider(a.targetBase.split('.').pop(), a.rhs, a, a.method); });
      return out;
    });
  }
  // a variable holds target − current (encoder/pose-derived or named like error)
  function p4PidError(ctx) {
    var e = errorVars(ctx);
    return e.length ? R(1, e[0].name + ' = target − current at line ' + ctx.H.ev(e[0].node).line + '.', [e[0].node])
      : R(0, 'No variable holds error = target − current (from an encoder or the pose).');
  }
  function isGain(name) { return GAIN_NAME.test(name) || GAIN_LOOSE.test(name); }
  // gain × error products: [{ start, end, line }]
  function gainProducts(ctx) {
    return memo(ctx, 'products', function () {
      var M = ctx.model, errs = errorVars(ctx).map(function (e) { return e.name; }), out = [];
      for (var i = 1; i < M.tokens.length - 2; i++) {
        var t = tok(ctx, i);
        if (t.value !== '*' || t.type !== 'op' || !ctx.H.liveToken(i)) continue;
        var l = tok(ctx, i - 1), r = tok(ctx, i + 1);
        var lGain = isIdent(l) && isGain(l.value), rGain = isIdent(r) && isGain(r.value);
        var lErr = isIdent(l) && errs.indexOf(l.value) >= 0, rErr = isIdent(r) && errs.indexOf(r.value) >= 0;
        if ((lGain && rErr) || (rGain && lErr)) { out.push({ start: i - 1, end: i + 2, line: t.line }); continue; }
        // kP * (target - current)
        if (lGain && r.value === '(') {
          var close = -1, d = 0;
          for (var k = i + 1; k < M.tokens.length; k++) { var x = tok(ctx, k); if (x.value === '(') d++; else if (x.value === ')') { d--; if (!d) { close = k; break; } } }
          if (close > 0 && depth0Minus(ctx, { start: i + 2, end: close }).length) out.push({ start: i - 1, end: close + 1, line: t.line });
        }
      }
      return out;
    });
  }
  // 0.5 gain × error + 0.5 that product flows into a setPower argument (≤ 3 hops, through a return)
  function p4PidOutput(ctx) {
    var M = ctx.model, prods = gainProducts(ctx);
    if (!prods.length) return R(0, 'No kP × error term was found (name the gain kP and multiply it by your error variable).');
    var sp = M.calls.filter(function (c) { return c.name === 'setPower' && c.live && c.args.length; });
    for (var k = 0; k < sp.length; k++) {
      var c = sp[k];
      var r = M.flowsTo(function (t) { return prods.some(function (p) { return t.i >= p.start && t.i < p.end; }); },
        { start: c.args[0].start, end: c.args[0].end, method: c.method }, { maxHops: 3 });
      if (r && r.ok) return R(1, 'kP × error (line ' + tok(ctx, r.at).line + ') reaches ' + c.receiverText + '.setPower() at line ' + c.line + '.', [tok(ctx, r.at).line, c]);
    }
    return R(0.5, 'kP × error at line ' + prods[0].line + ' never reaches a setPower() call, so the controller does not drive a motor.', [prods[0].line]);
  }
  // 0.5 integral += error… + 0.5 (error - lastError) with lastError = error
  function p4PidID(ctx) {
    var M = ctx.model, errs = errorVars(ctx).map(function (e) { return e.name; });
    if (!errs.length) return R(0, 'No error variable, so no integral or derivative term.');
    var c = 0, ev = [], notes = [];
    var integ = M.assigns.filter(function (a) {
      if (a.op !== '+=' || !a.live) return false;
      for (var i = a.rhs.start; i < a.rhs.end; i++) if (errs.indexOf(tok(ctx, i).value) >= 0) return true;
      return false;
    })[0];
    if (integ) { c += 0.5; ev.push(integ); } else notes.push('no integral (sum += error * dt)');
    var prevAssign = M.assigns.filter(function (a) { return a.op === '=' && a.live && errs.indexOf(norm(M.textOf(a.rhs))) >= 0 && errs.indexOf(a.targetBase) < 0; });
    var prevNames = prevAssign.map(function (a) { return a.targetBase; });
    var diff = null;
    for (var i = 1; i < M.tokens.length - 1 && !diff; i++) {
      var t = tok(ctx, i);
      if (t.value === '-' && t.type === 'op' && ctx.H.liveToken(i) && errs.indexOf(tok(ctx, i - 1).value) >= 0 && isIdent(tok(ctx, i + 1)) && tok(ctx, i + 1).value !== tok(ctx, i - 1).value) {
        diff = { line: t.line, prev: tok(ctx, i + 1).value };
      }
    }
    if (diff && prevNames.indexOf(diff.prev) >= 0) { c += 0.5; ev.push(diff.line); }
    else if (diff) { c += 0.25; ev.push(diff.line); notes.push(diff.prev + ' is never set to the error, so the derivative has nothing to compare with'); }
    else notes.push('no derivative (error − lastError)');
    return R(c, c >= 0.999 ? 'Integral and derivative terms are both computed.' : notes.join('; ') + '.', ev);
  }
  // live encoder read, encoder run mode or setTargetPosition
  function p4Encoders(ctx) {
    var M = ctx.model, H = ctx.H;
    var c = M.calls.filter(function (x) { return x.live && (x.name === 'getCurrentPosition' || x.name === 'setTargetPosition'); })[0];
    if (c) return R(1, c.name + '() at line ' + c.line + '.', [c]);
    for (var i = 0; i < M.tokens.length - 1; i++) {
      var t = tok(ctx, i);
      if (t.type === 'ident' && ENCODER_TOKENS.test(t.value) && H.liveToken(i)) return R(1, t.value + ' at line ' + t.line + '.', [t.line]);
    }
    return R(0, 'No encoder is read (getCurrentPosition()) or used (RUN_USING_ENCODER / setTargetPosition).');
  }
  // 0.5 Follower from Constants.create(…) in an init body + 0.5 setPose(<declared pose>) in an init body
  function followerCredit(ctx) {
    var f = followerInfo(ctx), c = 0, notes = [], ev = [];
    if (f.createInInit) { c += 0.5; ev.push(f.createInInit); }
    else if (f.createNodes.length) { c += 0.25; ev.push(f.createNodes[0]); notes.push('Constants.create() at line ' + f.createNodes[0].line + ' is not in init (hardwareMap is not ready in a field initialiser)'); }
    else notes.push('the Follower is never created with Constants.create(hardwareMap)');
    if (f.setPoseInInit) { c += 0.5; ev.push(f.setPoseInInit); }
    else if (f.setPoseAny) { c += 0.25; ev.push(f.setPoseAny); notes.push('setPose() at line ' + f.setPoseAny.line + ' runs after START'); }
    else notes.push('the starting pose is never set with follower.setPose(start)');
    return R(c, c >= 0.999 ? 'Follower created with Constants.create() and given its start pose during init.' : notes.join('; ') + '.', ev);
  }
  // min(1, distinct (x, y) poses / need); repeated points earn nothing and raise a WARNING
  function waypointsCredit(ctx, need) {
    var d = distinctPoses(ctx, true);
    var c = Math.min(1, d.uniq.length / need);
    var res = R(c, plural(d.uniq.length, 'distinct pose') + (c < 0.999 ? ' (needs ' + need + ')' : '') + (d.dups.length ? '; ' + plural(d.dups.length, 'pose') + ' repeat an earlier (x, y)' : '') + '.',
      d.uniq.slice(0, 4).map(function (p) { return p.call; }));
    if (d.dups.length) {
      res.issues = [{ id: 'duplicate-poses', severity: 'WARNING', description: 'Duplicate poses: ' + d.dups.slice(0, 3).map(function (x) { return (x.p.name || 'pose') + ' at line ' + x.p.line + ' repeats (' + x.p.x + ', ' + x.p.y + ') from line ' + x.first.line; }).join('; ') + ' — a repeated point does not count as a waypoint.',
        line: 'line ' + d.dups[0].p.line + ': ' + ctx.H.ev(d.dups[0].p.line).text, fix: 'Give every waypoint its own (x, y).' }];
    }
    return res;
  }
  // 1 follow(<follower>, <path>) that is scheduled; 0.5 follow of an undeclared path or never scheduled
  function p4Follow(ctx) {
    var list = followCalls(ctx).filter(function (f) { return f.live; });
    if (!list.length) return R(0, 'No path is followed with follow(follower, path).');
    var good = list.filter(function (f) { return f.pathOk && f.followerOk && isScheduled(ctx, f.call); });
    if (good.length) return R(1, 'follow(…) at line ' + good[0].call.line + ' is scheduled.', [good[0].call]);
    var f = list[0];
    return R(0.5, !f.pathOk ? 'follow() at line ' + f.call.line + ' is not given one of your path methods.' : !f.followerOk ? 'follow() at line ' + f.call.line + ' is not given the follower.' : 'follow() at line ' + f.call.line + ' is never scheduled, so the path never runs.', [f.call]);
  }
  function bestLoop(ctx, scoreFn) {
    var best = null;
    ctx.H.loopBodies().forEach(function (lb) { var s = scoreFn(lb); if (!best || s.credit > best.credit) best = s; });
    return best;
  }
  // 0.5 exactly one follower.update() per iteration + 0.3 exactly one Scheduler.execute() + 0.2 Scheduler.reset() in init
  function loopOnceCredit(ctx) {
    var H = ctx.H, M = ctx.model;
    var reset = M.calls.filter(function (c) { return c.live && staticCall(c, 'Scheduler', 'reset') && inInit(ctx, c); })[0];
    var best = bestLoop(ctx, function (lb) {
      var ups = followerUpdates(ctx, lb), ex = schedulerCalls(ctx, lb, 'execute');
      var c = (ups.length === 1 ? 0.5 : 0) + (ex.length === 1 ? 0.3 : 0) + (reset ? 0.2 : 0);
      return { credit: c, ups: ups, ex: ex, lb: lb };
    });
    if (!best) return R(reset ? 0.2 : 0, 'No control loop.', reset ? [reset] : []);
    var notes = [];
    if (best.ups.length !== 1) notes.push('follower.update() runs ' + best.ups.length + ' times per loop' + (best.ups.length ? ' (lines ' + best.ups.map(function (c) { return c.line; }).join(', ') + ')' : ''));
    if (best.ex.length !== 1) notes.push('Scheduler.execute() runs ' + best.ex.length + ' times per loop');
    if (!reset) notes.push('Scheduler.reset() is not called during init');
    return R(best.credit, notes.length ? notes.join('; ') + '.' : 'follower.update() and Scheduler.execute() run once per loop; Scheduler.reset() runs in init.',
      best.ups.concat(best.ex).concat(reset ? [reset] : []));
  }
  // ≥ 2 distinct loop captions (0.5) and one value reads the pose, an encoder or the error (0.5)
  function p4Telemetry(ctx) {
    var list = loopTelemetry(ctx), caps = captions(ctx, list), errs = errorVars(ctx).map(function (e) { return e.name; });
    var c = caps.length >= 2 ? 0.5 : caps.length * 0.25;
    var tuned = list.filter(function (x) {
      return x.args.slice(1).some(function (a) { return /pose\(\)|getCurrentPosition|getPose/.test(norm(a.text)) || errs.indexOf(norm(a.text)) >= 0; });
    })[0];
    if (tuned) c += 0.5;
    return R(c, c >= 0.999 ? 'Telemetry shows the pose/encoder values you tune with.' : plural(caps.length, 'telemetry value') + (tuned ? '' : '; none shows the pose, an encoder or the error') + '.', tuned ? [tuned] : list.slice(0, 1));
  }

  // ════════════════════════════════════════════════════════════════════════
  // Advanced 1 — Command-based (Ivy)
  // ════════════════════════════════════════════════════════════════════════
  // 0.5 Scheduler.reset() in init + 0.5 Scheduler.execute() exactly once per loop
  function acScheduler(ctx) {
    var M = ctx.model;
    var reset = M.calls.filter(function (c) { return c.live && staticCall(c, 'Scheduler', 'reset') && inInit(ctx, c); })[0];
    var best = bestLoop(ctx, function (lb) { var ex = schedulerCalls(ctx, lb, 'execute'); return { credit: ex.length === 1 ? 0.5 : 0, ex: ex }; });
    var c = (reset ? 0.5 : 0) + (best ? best.credit : 0), notes = [];
    if (!reset) notes.push('Scheduler.reset() is not called during init');
    if (!best || best.ex.length !== 1) notes.push('Scheduler.execute() runs ' + (best ? best.ex.length : 0) + ' times per loop (needs exactly 1)');
    return R(c, notes.length ? notes.join('; ') + '.' : 'Scheduler.reset() in init and Scheduler.execute() once per loop.', (reset ? [reset] : []).concat(best ? best.ex : []));
  }
  // exactly one follower.update() per loop
  function acFollowerUpdate(ctx) {
    var best = bestLoop(ctx, function (lb) { var u = followerUpdates(ctx, lb); return { credit: u.length === 1 ? 1 : 0, u: u }; });
    if (!best) return R(0, 'No control loop.');
    return R(best.credit, best.credit ? 'follower.update() once per loop.' : 'follower.update() runs ' + best.u.length + ' times per loop (needs exactly 1).', best.u);
  }
  // Command.build() chains: [{ start, setDone, setEnd, requiring, all[] }]
  function builtCommands(ctx) {
    return memo(ctx, 'cmds', function () {
      var M = ctx.model, byChain = {};
      M.calls.forEach(function (c) {
        if (c.chainRoot !== 'Command.build' || !c.live) return;
        var k = c.chainStart;
        var e = byChain[k] || (byChain[k] = { chainStart: k, calls: [], setDone: null, setEnd: null, requiring: null, method: c.method });
        e.calls.push(c);
        if (c.name === 'setDone' && !e.setDone) e.setDone = c;
        if (c.name === 'setEnd' && !e.setEnd) e.setEnd = c;
        if (c.name === 'requiring' && !e.requiring) e.requiring = c;
      });
      return Object.keys(byChain).map(function (k) { return byChain[k]; });
    });
  }
  // 0.5 Command.build()…setDone(…) (or implements Command with done()) +0.25 setEnd stops the mechanism +0.25 .requiring(…)
  function acCommandBuilder(ctx) {
    var M = ctx.model, H = ctx.H;
    var cmds = builtCommands(ctx).filter(function (e) { return e.setDone; });
    if (cmds.length) {
      var best = null;
      cmds.forEach(function (e) {
        var c = 0.5;
        var stops = e.setEnd ? H.callsWithin({ start: e.setEnd.args.length ? e.setEnd.args[0].start : e.setEnd.start, end: e.setEnd.end }, 1).filter(isStopCall) : [];
        if (stops.length) c += 0.25;
        if (e.requiring) c += 0.25;
        if (!best || c > best.c) best = { c: c, e: e, stops: stops };
      });
      var notes = [];
      if (!best.stops.length) notes.push(best.e.setEnd ? 'setEnd() does not stop the mechanism' : 'no setEnd() stops the mechanism when the command ends');
      if (!best.e.requiring) notes.push('no .requiring(…) claims the subsystem');
      return R(best.c, best.c >= 0.999 ? 'Command.build() at line ' + best.e.calls[0].line + ' says when it is done, stops in setEnd() and requires its subsystem.' : 'Command.build() at line ' + best.e.calls[0].line + ': ' + notes.join('; ') + '.',
        [best.e.setDone, best.e.setEnd, best.e.requiring]);
    }
    var impl = M.types.filter(function (T) { return T.implements.some(function (x) { return /^Command\b/.test(x); }); })[0];
    if (impl) {
      var done = impl.methods.filter(function (m) { return m.name === 'done'; })[0];
      var end = impl.methods.filter(function (m) { return m.name === 'end'; })[0];
      var req = impl.methods.filter(function (m) { return m.name === 'requirements'; })[0];
      var c2 = (done ? 0.5 : 0.25) + (end && H.callsIn(end, 1).some(isStopCall) ? 0.25 : 0) + (req ? 0.25 : 0);
      return R(c2, impl.name + ' implements Command' + (done ? ' with done()' : ' but has no done()') + '.', [impl.line, done]);
    }
    var any = M.calls.filter(function (c) { return c.chainRoot === 'Command.build'; })[0];
    return R(0, any ? 'Command.build() at line ' + any.line + ' never says when it is done (setDone), or never runs.' : 'No command is built with Command.build() (or a class that implements Command).', any ? [any] : []);
  }
  // 1 setDone reads an ElapsedTime (.seconds/.milliseconds) or the chain uses waitMs/until; 0.7 waitMs beside instant(intake…) in a sequential
  function acRunIntake(ctx) {
    var M = ctx.model, H = ctx.H;
    var cmds = builtCommands(ctx);
    for (var k = 0; k < cmds.length; k++) {
      var e = cmds[k];
      if (e.setDone) {
        var t = H.callsWithin({ start: e.setDone.args.length ? e.setDone.args[0].start : e.setDone.start, end: e.setDone.end }, 0)
          .filter(function (c) { return /^(seconds|milliseconds|time)$/.test(c.name) && H.receiverType(c) === 'ElapsedTime'; })[0];
        if (t) return R(1, 'The command at line ' + e.calls[0].line + ' ends after a measured time (line ' + t.line + ').', [e.setDone, t]);
      }
      var w = e.calls.filter(function (c) { return c.name === 'until' || c.name === 'waitMs'; })[0];
      if (w) return R(1, 'The command at line ' + e.calls[0].line + ' has a duration (' + w.name + ').', [w]);
    }
    var seqs = M.calls.filter(function (c) { return c.live && c.name === 'sequential'; });
    for (var j = 0; j < seqs.length; j++) {
      var s = seqs[j];
      var wait = s.args.filter(function (a) { return /^waitMs\(/.test(norm(a.text)); })[0];
      var intake = s.args.filter(function (a) { return /^instant\(/.test(norm(a.text)) && /intake/i.test(a.text); })[0];
      if (wait && intake) return R(0.7, 'sequential() at line ' + s.line + ' runs the intake and waits, but the wait is not part of an intake command.', [s]);
    }
    return R(0, 'No intake command runs for a set time (Command.build() with setDone(() -> timer.seconds() >= seconds)).');
  }
  // min(1, n/2): live follow(<follower>, <path>) calls
  function acFollowPath(ctx) {
    var list = followCalls(ctx).filter(function (f) { return f.live && f.pathOk && f.followerOk; });
    var c = Math.min(1, list.length / 2);
    var any = followCalls(ctx).filter(function (f) { return f.live; });
    return R(c, c >= 0.999 ? plural(list.length, 'path') + ' followed with follow(follower, path).' : plural(list.length, 'path') + ' followed with follow(follower, path) (needs 2)' + (any.length > list.length ? '; ' + (any.length - list.length) + ' follow() call(s) do not pass the follower and a path method' : '') + '.',
      list.map(function (f) { return f.call; }));
  }
  function isCommandCall(ctx, c) {
    if (c.name === 'follow' || /^(sequential|parallel|race|deadline|waitMs|schedule)$/.test(c.name)) return false;
    if (c.name === 'instant' && c.args.some(function (a) { return /intake/i.test(a.text); })) return true;
    var r = ctx.model.resolveCall(c);
    return r.how !== 'external' && r.methods.some(function (m) { return /Command/.test(m.returnType || '') && !/^(Path|PathChain)$/.test(m.returnType || ''); }) && !/routine/i.test(c.name);
  }
  // 0.5 sequential(…) contains follow( + 0.3 contains the intake command + 0.2 it is scheduled
  function acSequential(ctx) {
    var M = ctx.model;
    var seqs = M.calls.filter(function (c) { return c.live && c.name === 'sequential'; });
    if (!seqs.length) return R(0, 'No sequential(…) composition.');
    var best = null;
    seqs.forEach(function (s) {
      var follows = nestedCalls(ctx, s, function (c) { return c.name === 'follow'; });
      var cmd = nestedCalls(ctx, s, function (c) { return isCommandCall(ctx, c); });
      var sched = isScheduled(ctx, s);
      var c = (follows.length ? 0.5 : 0) + (cmd.length ? 0.3 : 0) + (sched ? 0.2 : 0);
      if (!best || c > best.c) best = { c: c, s: s, follows: follows, cmd: cmd, sched: sched };
    });
    var notes = [];
    if (!best.follows.length) notes.push('it follows no path');
    if (!best.cmd.length) notes.push('it does not run the intake command');
    if (!best.sched) notes.push('it is never scheduled');
    return R(best.c, notes.length ? 'sequential() at line ' + best.s.line + ': ' + notes.join('; ') + '.' : 'sequential() at line ' + best.s.line + ' follows paths, runs the intake and is scheduled.', [best.s]);
  }
  // no switch on an enum in the loop and no *State enum used by the OpMode
  function acNoStateMachine(ctx) {
    var M = ctx.model, H = ctx.H, T = H.opMode();
    if (!T) return R(0, 'No OpMode.');
    var sw = M.blocks.filter(function (b) {
      if (b.kind !== 'switch' || !b.cond || !H.inLoopRegion(b.open)) return false;
      var t = H.varType(norm(b.cond.text).replace(/^this\./, ''), b.cond.start);
      return !!(t && M.typeNamed(t) && M.typeNamed(t).kind === 'enum');
    })[0];
    if (sw) return R(0, 'The loop still switches on a state enum (line ' + sw.line + ').', [sw.line]);
    var st = M.types.filter(function (E) {
      if (E.kind !== 'enum' || !/State|Step|Phase/.test(E.name)) return false;
      if (E.outer === T) return true;
      return M.decls.some(function (d) { return baseType(d.typeText) === E.name && d.block && d.block.typeRef === T; });
    })[0];
    if (st) return R(0, 'The OpMode still uses the ' + st.name + ' enum.', [st.line]);
    return R(1, 'The OpMode has no state enum or switch.');
  }
  // a comment ≥ 15 words matching ≥ 2 comparison terms
  function acComparison(ctx) {
    var terms = [/easier/i, /readab/i, /modif/i, /maintain/i, /compar/i, /reorder/i, /state machine/i, /command/i];
    var best = null;
    ctx.H.commentGroups().forEach(function (g) {
      var w = ctx.H.words(g.text).length;
      var hits = terms.filter(function (re) { return re.test(g.text); }).length;
      if (w >= 15 && hits >= 2 && !best) best = g;
    });
    return best ? R(1, 'The note at line ' + best.line + ' compares both versions.', [best.line])
      : R(0, 'No comment of 15+ words compares the command-based version with the state machine (readability, how easy it is to change).');
  }

  // ════════════════════════════════════════════════════════════════════════
  // Capstone
  // ════════════════════════════════════════════════════════════════════════
  // 0.6 · min(1, subsystems/3) + 0.4 a Robot class that builds them (and is created)
  function capArchitecture(ctx) {
    var subs = subsystems(ctx), rob = robotInfo(ctx);
    var c = 0.6 * Math.min(1, subs.length / 3);
    if (rob && rob.liveBuilt.length >= 2) c += 0.4; else if (rob) c += 0.2;
    return R(c, plural(subs.length, 'subsystem class', 'subsystem classes') + (subs.length < 3 ? ' (needs 3)' : '') + '; ' +
      (rob ? rob.type.name + ' builds ' + rob.built.join(', ') + (rob.liveBuilt.length ? '' : ' but is never created') : 'no Robot class builds them') + '.',
      subs.slice(0, 3).map(function (s) { return s.type.line; }).concat(rob ? [rob.type.line] : []));
  }
  // an enum declared (0.5) and used inside a subsystem class (0.5)
  function capEnum(ctx) {
    var M = ctx.model, H = ctx.H, T = H.opMode();
    var enums = M.types.filter(function (E) { return E.kind === 'enum'; });
    if (!enums.length) return R(0, 'No enum is declared.');
    for (var k = 0; k < enums.length; k++) {
      var u = H.enumUsed(enums[k].name);
      var inSub = u.nodes.filter(function (n) { var b = n.block || M.blockAt(n.start || n.index); return b && b.typeRef && b.typeRef !== T; })[0];
      if (inSub) return R(1, 'enum ' + enums[k].name + ' tracks state inside ' + (inSub.block ? inSub.block.typeRef.name : 'a subsystem') + '.', [enums[k].line, inSub]);
    }
    var any = enums.map(function (E) { return H.enumUsed(E.name); }).filter(function (u) { return u.assigned || u.compared || u.switched; })[0];
    return R(any ? 0.75 : 0.5, any ? 'enum ' + any.type.name + ' is used, but only in the OpMode.' : 'enum ' + enums[0].name + ' is declared but never used.', [enums[0].line]);
  }
  // 0.7 sequential(…) with ≥ 2 follow( + 0.3 scheduled
  function capRoutine(ctx) {
    var seqs = ctx.model.calls.filter(function (c) { return c.live && c.name === 'sequential'; });
    if (!seqs.length) return R(0, 'No sequential(…) routine.');
    var best = null;
    seqs.forEach(function (s) {
      var f = nestedCalls(ctx, s, function (c) { return c.name === 'follow'; });
      var sched = isScheduled(ctx, s);
      var c = (f.length >= 2 ? 0.7 : f.length * 0.35) + (sched ? 0.3 : 0);
      if (!best || c > best.c) best = { c: c, s: s, n: f.length, sched: sched };
    });
    return R(best.c, 'sequential() at line ' + best.s.line + ' follows ' + plural(best.n, 'path') + (best.n < 2 ? ' (needs 2)' : '') + (best.sched ? ' and is scheduled.' : ' but is never scheduled.'), [best.s]);
  }
  // race(follow(…), waitMs(…)), or a timer check in the loop that cancels and schedules follow(…)
  function capFallback(ctx) {
    var M = ctx.model, H = ctx.H;
    var race = M.calls.filter(function (c) {
      if (!c.live || c.name !== 'race') return false;
      var inner = H.callsWithin({ start: c.start + 1, end: c.end }, 0);
      return inner.some(function (x) { return x.name === 'follow'; }) && inner.some(function (x) { return x.name === 'waitMs'; });
    })[0];
    if (race) return R(1, 'race(follow(…), waitMs(…)) at line ' + race.line + ' gives up on a stuck path.', [race]);
    var cond = M.conds.filter(function (k) {
      if (!k.live || k.negated || !k.hasComparison || !H.inLoopRegion(k.start)) return false;
      return M.calls.some(function (c) { return c.start >= k.start && c.start < k.end && /^(seconds|milliseconds|getRuntime|time)$/.test(c.name); });
    })[0];
    var cancel = M.calls.filter(function (c) { return c.live && c.name === 'cancel'; })[0];
    var park = M.calls.filter(function (c) { return c.live && staticCall(c, 'Scheduler', 'schedule') && c.args.some(function (a) { return /follow\(/.test(norm(a.text)); }); })[0];
    if (cond && cancel && park) return R(1, 'Line ' + cond.line + ' cancels the routine and parks when time runs out.', [cond, cancel, park]);
    if (cond) return R(0.5, 'Line ' + cond.line + ' checks the time, but does not cancel the routine and schedule a park path.', [cond]);
    return R(0, 'No timeout: wrap a follow() in race(…, waitMs(…)) or cancel and park when the match timer runs low.');
  }
  // 0.5 mirrored poses (mirrorX/mirrorY or poses under an alliance if) + 0.5 alliance chosen in init_loop from the gamepad
  function capAlliance(ctx) {
    var M = ctx.model, H = ctx.H, c = 0, ev = [], notes = [];
    var mirror = M.calls.filter(function (x) { return x.live && /^mirror(X|Y)?$/.test(x.name); })[0];
    var condPose = H.poses().filter(function (p) { return p.call.condChain && p.call.condChain.some(function (k) { return ALLIANCE_NAME.test(k.text); }); })[0];
    if (mirror || condPose) { c += 0.5; ev.push(mirror || condPose.call); } else notes.push('poses are not mirrored for the other alliance');
    var sel = M.assigns.filter(function (a) {
      if (!a.live || !ALLIANCE_NAME.test(a.targetBase)) return false;
      var m = a.method;
      var inSelect = m && (m.name === 'init_loop' || (m.name === 'runOpMode' && inInit(ctx, a)));
      if (!inSelect) return false;
      if (H.gamepadTokens(a.rhs).length) return true;
      var e = M.enclosing(a.index);
      return (e && e.condChain || []).some(function (k) { return H.gamepadTokens(k).length; });
    })[0];
    if (sel) { c += 0.5; ev.push(sel); } else notes.push('the alliance is not chosen with the gamepad during init');
    return R(c, c >= 0.999 ? 'Alliance picked in init with the gamepad; poses mirror for the other side.' : notes.join('; ') + '.', ev);
  }
  // min(1, distinct loop captions / 4)
  function capTelemetry(ctx) {
    var caps = captions(ctx, loopTelemetry(ctx));
    var c = Math.min(1, caps.length / 4);
    return R(c, plural(caps.length, 'telemetry value') + ' in the loop' + (c < 0.999 ? ' (needs 4: state, sensors, powers, loop time)' : '') + '.', caps.slice(0, 4));
  }

  // ════════════════════════════════════════════════════════════════════════
  // Phase 5 — Debug Under Pressure: notes criteria (the five bug criteria come from the kit)
  // ════════════════════════════════════════════════════════════════════════
  var STOP = set(['this', 'that', 'with', 'from', 'when', 'your', 'have', 'into', 'then', 'than', 'they', 'were', 'will', 'what', 'which', 'because',
    'there', 'their', 'about', 'after', 'before', 'every', 'only', 'once', 'each', 'does', 'doesn', 'never', 'still', 'should', 'would']);
  function vocab(text) {
    var o = Object.create(null);
    (String(text || '').toLowerCase().match(/[a-z]{4,}/g) || []).forEach(function (w) { if (!STOP[w]) o[w] = true; });
    return o;
  }
  function bugNotes(ctx) {
    return memo(ctx, 'bugNotes', function () {
      var H = ctx.H;
      var groups = H.commentGroups().filter(function (g) { return /\b(BUG|FIX|FIXED)\b/i.test(g.text); });
      return H.qualityComments({ groups: groups, minWords: 6, minReal: 4, distinct: true, noRestate: false });
    });
  }
  // min(1, Σ/4): a note counts 1 when it talks about a bug that is fixed, 0.5 otherwise
  function p5BugNotes(ctx) {
    var notes = bugNotes(ctx), kit = ctx.refs.kit, sum = 0, matched = 0;
    var fixed = (kit && kit.bugs || []).filter(function (b) { return ctx.kitStates[b.id] === 'fixed'; });
    var vocabs = fixed.map(function (b) { return vocab([b.title, b.symptom, b.hint, b.id.replace(/-/g, ' ')].join(' ')); });
    notes.forEach(function (n) {
      var w = vocab(n.text);
      var hit = vocabs.some(function (v) { return Object.keys(w).filter(function (x) { return v[x]; }).length >= 2; });
      if (hit) { sum += 1; matched++; } else sum += 0.5;
    });
    var c = Math.min(1, sum / 4);
    return R(c, notes.length ? plural(notes.length, 'bug note') + ' (' + matched + ' about a bug you fixed)' + (c < 0.999 ? '; write one // BUG: note per fix saying what was wrong' : '') + '.'
      : 'No // BUG: or // FIX: notes of six or more words.', notes.slice(0, 4).map(function (n) { return n.line; }));
  }
  // min(1, n/3): bug notes that say why (because / since / caused / led to …)
  function p5BugWhy(ctx) {
    var why = /\b(because|since|caused|causing|so the|so that|meant|which made|leads? to|result)/i;
    var n = bugNotes(ctx).filter(function (x) { return why.test(x.text); });
    var c = Math.min(1, n.length / 3);
    return R(c, plural(n.length, 'bug note') + ' explain why' + (c < 0.999 ? ' (needs 3)' : '') + '.', n.slice(0, 3).map(function (x) { return x.line; }));
  }
  // any comment describing the method: observe, hypothesise, isolate, verify…
  function p5Systematic(ctx) {
    var re = /observ|hypothes|isolat|verif|reproduc|telemetry showed|watched|tested|confirmed/i;
    var g = ctx.H.commentGroups().filter(function (x) { return re.test(x.text); })[0];
    return g ? R(1, 'Line ' + g.line + ' describes how you found a bug.', [g.line]) : R(0, 'No note says how you narrowed a bug down (what you observed, tested or confirmed).');
  }
  // Kit similarity gate: is the submission the Debug Under Pressure program?
  var GATE_KIT = {
    id: 'kit-similarity', label: 'This is the Debug Under Pressure program', severity: 'CRITICAL', penalty: 10,
    hint: 'Load the program from the "Debug Under Pressure" lesson into the editor and fix the bugs in place.',
    test: function (ctx) {
      var kit = ctx.refs.kit;
      if (!kit || typeof kit.similarity !== 'function') return null;
      var s = +kit.similarity(ctx) || 0;
      var pct = Math.round(s * 100);
      if (s < 0.50) return { explanation: 'This is not the Debug Under Pressure program — load it from the lesson and fix it in place (' + pct + '% of it is here).', voidKit: true, voidWhy: 'the Debug Under Pressure program check' };
      if (s < 0.70) return { severity: 'WARNING', penalty: 10, explanation: 'Only ' + pct + '% of the original program is still here — you changed more than the bugs.' };
      return null;
    }
  };

  // ════════════════════════════════════════════════════════════════════════
  // Rule tables
  // ════════════════════════════════════════════════════════════════════════
  var P4_FOLLOWER_HINT = 'Create the Follower with Constants.create(hardwareMap) in init and set its start pose there with follower.setPose(start).';
  var RULES = {
    phase1: {
      passThreshold: 75,
      gates: COMMON_GATES,
      issues: COMMON_ISSUES,
      required: [
        { id: 'opmode', label: 'Extends LinearOpMode or OpMode', weight: 5, credit: p1OpMode, hint: 'Your class must extend LinearOpMode (or OpMode).' },
        { id: 'loop', label: 'Runs a control loop while the OpMode is active', weight: 5, credit: p1Loop, hint: 'Call waitForStart(), then wrap your driving code in while (opModeIsActive()) { … }.' },
        { id: 'motors', label: 'Initializes at least 2 motors via hardwareMap', weight: 15, credit: p1Motors, hint: 'Get at least two DcMotors from hardwareMap, e.g. hardwareMap.get(DcMotor.class, "left_drive"), and use both.' },
        { id: 'servo', label: 'Initializes at least 1 servo via hardwareMap', weight: 10, credit: p1Servo, hint: 'Get a Servo (or CRServo) from hardwareMap for your mechanism and move it with setPosition().' },
        { id: 'joystick', label: 'Reads a gamepad joystick', weight: 15, credit: p1Joystick, hint: 'Read gamepad1.left_stick_y / left_stick_x / right_stick_x inside the loop.' },
        { id: 'y-invert', label: 'Inverts the joystick Y axis', weight: 10, credit: p1YInvert, hint: 'Pushing the stick forward gives a negative Y — use -gamepad1.left_stick_y.' },
        { id: 'drive-flow', label: 'Joystick values drive the motors', weight: 15, credit: p1DriveFlow, hint: 'Send the joystick values to both drive motors with setPower() inside the loop.' },
        { id: 'mechanism', label: 'Controls a mechanism with a button or trigger', weight: 10, credit: p1Mechanism, hint: 'Use a button or trigger (gamepad1.a, right_trigger, …) to move a servo or a mechanism motor.' },
        { id: 'telemetry', label: 'Shows at least 2 telemetry values', weight: 10, credit: p1Telemetry, hint: 'Add at least two telemetry.addData(...) lines and call telemetry.update() each loop.' },
        { id: 'comments', label: 'Has comments that explain why', weight: 5, credit: p1Comments, hint: 'Add a few comments that explain why the code does what it does, not just what.' }
      ],
      forbidden: [F_SYSTEM_EXIT, F_WHILE_TRUE, F_SLEEP_IN_LOOP]
    },

    phase2: {
      passThreshold: 75,
      gates: COMMON_GATES,
      issues: COMMON_ISSUES,
      required: [
        { id: 'drivetrain-class', label: 'A drivetrain subsystem class', weight: 15, credit: p2Drivetrain, hint: 'Create a Drivetrain class that owns the drive motors and has a public drive(...) method that sets their power.' },
        { id: 'mechanism-class', label: 'At least one mechanism subsystem class', weight: 10, credit: p2Mechanism, hint: 'Create a class for one mechanism (Intake, Claw, Lift, …) with public methods that move it.' },
        { id: 'private-fields', label: 'Hardware fields are private', weight: 10, credit: p2PrivateFields, hint: 'Declare motor and servo fields as private inside the subsystem.' },
        { id: 'robot-class', label: 'A Robot class that creates the subsystems', weight: 15, credit: p2Robot, hint: 'A Robot class should construct every subsystem in one place: drivetrain = new Drivetrain(hardwareMap); …' },
        { id: 'hardwaremap-param', label: 'Subsystems receive the HardwareMap', weight: 5, credit: p2HwParam, hint: 'Pass hardwareMap into each subsystem constructor and get the devices from it there.' },
        { id: 'enum', label: 'Uses an enum for state', weight: 10, credit: p2Enum, hint: 'Replace magic numbers/strings with an enum, e.g. enum ClawState { OPEN, CLOSED }, and assign or check it.' },
        { id: 'opmode', label: 'A TeleOp OpMode uses the Robot class', weight: 15, credit: p2OpMode, hint: 'The OpMode should create a Robot(hardwareMap) during init and call its subsystems in the loop.' },
        { id: 'no-hardware-in-opmode', label: 'No direct hardware calls in the OpMode', weight: 10, credit: noHardwareInOpMode, hint: 'The main OpMode should only talk to the Robot/subsystem classes — no hardwareMap.get() or setPower() in it.' },
        { id: 'public-methods', label: 'Subsystems expose public methods', weight: 5, credit: p2PublicMethods, hint: 'Give each subsystem public methods like drive(), stop(), open(), close().' },
        { id: 'comments', label: 'Has explanatory comments', weight: 5, credit: p2Comments, hint: 'Comment the purpose of each class.' }
      ],
      forbidden: [F_SYSTEM_EXIT, F_WHILE_TRUE]
    },

    phase3: {
      passThreshold: 75,
      gates: COMMON_GATES,
      issues: COMMON_ISSUES,
      required: [
        { id: 'autonomous', label: 'Autonomous LinearOpMode with waitForStart()', weight: 5, credit: p3Autonomous, hint: 'Annotate with @Autonomous and call waitForStart().' },
        { id: 'sensor-type', label: 'Declares a sensor (color, distance, touch or IMU)', weight: 10, credit: p3SensorType, hint: 'Get a ColorSensor, DistanceSensor, TouchSensor or IMU from hardwareMap.' },
        { id: 'sensor-read', label: 'Reads the sensor', weight: 10, credit: p3SensorRead, hint: 'Read a value every loop, e.g. colorSensor.red() or distance.getDistance(DistanceUnit.CM).' },
        { id: 'decision', label: 'Makes a decision from a sensor threshold', weight: 20, credit: decisionCredit, hint: 'Compare the reading to a threshold in an if/else and do something different in each branch.' },
        { id: 'state-machine', label: 'Sequential actions via an enum / switch state machine', weight: 20, credit: p3StateMachine, hint: 'Structure the autonomous as states: an enum, a switch on it inside the loop, and each case setting the next state.' },
        { id: 'timing', label: 'Timing or state-based transitions', weight: 10, credit: p3Timing, hint: 'Use an ElapsedTime timer and compare timer.seconds() to move between steps.' },
        { id: 'subsystems', label: 'Uses subsystem classes from Phase 2', weight: 10, credit: p3Subsystems, hint: 'Reuse your Robot / subsystem classes instead of raw motor calls.' },
        { id: 'filtering', label: 'Filters sensor readings', weight: 5, credit: filteringCredit, hint: 'Do not act on one reading — average a few or require several in a row.' },
        { id: 'stop', label: 'Stops motors when finished', weight: 5, credit: p3Stop, hint: 'Set every motor to 0 (or call stop()) when the routine is done.' },
        { id: 'telemetry', label: 'Telemetry shows sensor values', weight: 5, credit: p3Telemetry, hint: 'Show the sensor value on telemetry (and call telemetry.update()) so you can tune thresholds.' }
      ],
      forbidden: [F_SYSTEM_EXIT, F_WHILE_TRUE, timeBased(10, 'setPower(...); sleep(...) is open-loop driving — use sensors or encoders to decide when to stop.')]
    },

    phase4: {
      passThreshold: 75,
      gates: COMMON_GATES,
      issues: COMMON_ISSUES,
      required: [
        { id: 'pid-error', label: 'PID error = target − current', weight: 10, credit: p4PidError, hint: 'Compute error = target − current from an encoder (getCurrentPosition()) or the pose.' },
        { id: 'pid-output', label: 'kP × error drives a motor', weight: 15, credit: p4PidOutput, hint: 'Multiply the error by kP (plus the I and D terms) and send the result to setPower().' },
        { id: 'pid-i-d', label: 'Integral and derivative terms', weight: 10, credit: p4PidID, hint: 'Add integral += error * dt and derivative = (error − lastError) / dt, then set lastError = error.' },
        { id: 'encoders', label: 'Encoder-based movement', weight: 5, credit: p4Encoders, hint: 'Use encoders (getCurrentPosition / RUN_USING_ENCODER) instead of time.' },
        { id: 'follower', label: 'Pedro Pathing follower', weight: 10, credit: followerCredit, hint: P4_FOLLOWER_HINT },
        { id: 'waypoints', label: 'At least 3 distinct poses', weight: 10, credit: function (ctx) { return waypointsCredit(ctx, 3); }, hint: 'Define at least three different poses with a PoseFactory, e.g. p.of(24, 24, 0).' },
        { id: 'paths', label: 'Paths built with line()/curve() and a heading interpolation', weight: 15, credit: function (ctx) { return pathsCredit(ctx, 2); }, hint: 'Write one method per path: return line(start, end).linear(start, end); (or curve(...)).' },
        { id: 'follow', label: 'Paths followed with follow(follower, path)', weight: 10, credit: p4Follow, hint: 'Follow your paths with follow(follower, toScore()) inside schedule(sequential(...)).' },
        { id: 'loop-once', label: 'update() and Scheduler.execute() once per loop, Scheduler.reset() in init', weight: 10, credit: loopOnceCredit, hint: 'Call Scheduler.reset() in init, and follower.update() and Scheduler.execute() exactly once each loop.' },
        { id: 'telemetry', label: 'Telemetry for tuning', weight: 3, credit: p4Telemetry, hint: 'Show position/heading/error on telemetry while tuning.' },
        { id: 'comments', label: 'Has explanatory comments', weight: 2, credit: function (ctx) { return commentCredit(ctx, 2); }, hint: 'Note your tuned constants and why.' }
      ],
      forbidden: [F_SYSTEM_EXIT, F_WHILE_TRUE, timeBased(15, 'setPower(...); sleep(...) is open-loop — Phase 4 is about closed-loop movement.'), F_DOUBLE_UPDATE, F_LEGACY_PEDRO]
    },

    phase5: {
      kit: true,
      passThreshold: 75,
      gates: [GATE_PARSES, GATE_OPMODE, GATE_KIT],
      issues: COMMON_ISSUES,
      required: [
        { id: 'bug-notes', label: 'A note for each bug you fixed (// BUG: …)', weight: 12, credit: p5BugNotes, hint: 'Mark each fix with a comment starting // BUG: that says what was wrong and what you changed.' },
        { id: 'bug-why', label: 'Bug notes explain why', weight: 8, credit: p5BugWhy, hint: 'Say why each bug happened, e.g. "// BUG: the lift overshot because kP was 50, so the output was always clipped".' },
        { id: 'systematic', label: 'Notes describe the systematic approach', weight: 5, credit: p5Systematic, hint: 'Describe how you narrowed each bug down (observe → hypothesize → test → fix → verify).' }
      ],
      forbidden: [F_EMPTY_CATCH, F_TODO, F_WHILE_TRUE, F_DOUBLE_UPDATE]
    },

    advanced_command: {
      passThreshold: 75,
      gates: COMMON_GATES,
      issues: COMMON_ISSUES,
      required: [
        { id: 'scheduler', label: 'Scheduler.reset() in init and Scheduler.execute() in the loop', weight: 15, credit: acScheduler, hint: 'Call Scheduler.reset() at the top of init and Scheduler.execute() exactly once per loop.' },
        { id: 'follower-update', label: 'follower.update() once per loop', weight: 5, credit: acFollowerUpdate, hint: 'Call follower.update() exactly once every loop.' },
        { id: 'command-builder', label: 'Commands built with Command.build() (or implements Command)', weight: 20, credit: acCommandBuilder, hint: 'Write commands with Command.build().setStart(...).setDone(...).setEnd(...).requiring(...) (or a class that implements Command).' },
        { id: 'run-intake', label: 'A runIntake command with a duration', weight: 15, credit: acRunIntake, hint: 'runIntake should run the intake for a given number of seconds (setDone(() -> timer.seconds() >= seconds)) and stop it in setEnd().' },
        { id: 'follow-path', label: 'Paths followed with follow(follower, path)', weight: 15, credit: acFollowPath, hint: 'Use follow(follower, path) from PedroCommands instead of a hand-written FollowPath command.' },
        { id: 'sequential', label: 'A sequential() composition replaces the state machine', weight: 15, credit: acSequential, hint: 'Compose follow(...) and runIntake(...) in one sequential(...) call and schedule it in start().' },
        { id: 'no-state-machine', label: 'No enum/switch sequencing in the OpMode', weight: 5, credit: acNoStateMachine, hint: 'Remove the state enum and switch — the sequential() composition is the sequence now.' },
        { id: 'paths', label: 'Path methods with poses', weight: 5, credit: function (ctx) { return pathsCredit(ctx, 2); }, hint: 'Write one method per path that returns line(a, b).linear(a, b) between declared poses.' },
        { id: 'comparison', label: 'A note comparing both versions', weight: 5, credit: acComparison, hint: 'Add a comment comparing the command-based and original versions: which is easier to read and modify?' }
      ],
      forbidden: [F_SYSTEM_EXIT, F_WHILE_TRUE, F_LEGACY_COMMANDS]
    },

    advanced_strategy: {
      reflection: true,
      note: 'The strategy deliverable is a written analysis (expected value, tiers, match log, strategy document) — it is kept for your mentor rather than pattern-checked.'
    },

    capstone: {
      passThreshold: 75,
      gates: COMMON_GATES,
      issues: COMMON_ISSUES,
      required: [
        { id: 'architecture', label: 'Subsystem classes + Robot class', weight: 15, credit: capArchitecture, hint: 'Wrap every mechanism in its own subsystem class and build them all in a Robot class.' },
        { id: 'no-hardware-in-opmode', label: 'Zero direct hardware calls in the OpMode', weight: 5, credit: noHardwareInOpMode, hint: 'Keep hardwareMap.get(), setPower() and setPosition() inside the subsystems.' },
        { id: 'enum', label: 'Enum-based state', weight: 5, credit: capEnum, hint: 'Use enums for subsystem states and set them inside the subsystem methods.' },
        { id: 'sensor-decision', label: 'A sensor-driven decision', weight: 10, credit: decisionCredit, hint: 'Read a sensor and branch on it (colour sorting, distance stop, …).' },
        { id: 'filtering', label: 'Sensor filtering', weight: 5, credit: filteringCredit, hint: 'No single-reading decisions — average or require consecutive readings.' },
        { id: 'pedro', label: 'Follower from Constants.create + setPose', weight: 10, credit: followerCredit, hint: 'Drive with Pedro Pathing\'s Follower: Constants.create(hardwareMap) in init and follower.setPose(start) before the routine starts.' },
        { id: 'waypoints', label: 'At least 4 distinct poses', weight: 10, credit: function (ctx) { return waypointsCredit(ctx, 4); }, hint: 'Define at least four different poses with a PoseFactory (p.of(x, y, heading)).' },
        { id: 'paths', label: 'Path methods with interpolation', weight: 10, credit: function (ctx) { return pathsCredit(ctx, 3); }, hint: 'Write one method per path that returns line(a, b).linear(a, b) (or .constant/.tangent).' },
        { id: 'routine', label: 'One sequential() routine, scheduled', weight: 10, credit: capRoutine, hint: 'Build the whole autonomous as one sequential(follow(...), ..., follow(...)) and schedule it in start().' },
        { id: 'loop-once', label: 'update() and execute() once per loop', weight: 5, credit: loopOnceCredit, hint: 'Call follower.update() and Scheduler.execute() exactly once each loop, Scheduler.reset() in init.' },
        { id: 'fallback', label: 'Timer-based fallback / emergency park', weight: 5, credit: capFallback, hint: 'Add race(follow(...), waitMs(...)) so a stuck path gives up, and park when the match timer runs low.' },
        { id: 'alliance', label: 'Alliance mirroring / selection', weight: 5, credit: capAlliance, hint: 'Pick the alliance in init_loop with the gamepad and mirror the poses (p.mirrorY(…)) for the other side.' },
        { id: 'telemetry', label: 'Telemetry: state, sensors, powers, loop time', weight: 5, credit: capTelemetry, hint: 'Show current state, sensor values, motor powers and loop time.' }
      ],
      forbidden: [F_SYSTEM_EXIT, F_WHILE_TRUE, timeBased(10, 'No time-based driving in a competition autonomous.'), F_DOUBLE_UPDATE, F_LEGACY_PEDRO]
    }
  };

  window.CODE_RULES = RULES;
  window.CODE_RULES_VERSION = 'rules-3';
  window.CODE_RULES_COMMON = { gates: COMMON_GATES, issues: COMMON_ISSUES, FTC_PROVIDED: FTC_PROVIDED.slice() };
})();
