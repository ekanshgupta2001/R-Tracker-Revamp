// ── R-Tracker v2 — Structural code checker ───────────────────────────────────
// Checks a student's Java submission against the per-phase rules in
// js/curriculum/code-rules.js. It is a STRUCTURAL check: the submission is
// parsed by js/java-structure.js into classes, methods, blocks, calls and a
// small name-based dataflow, and each rule asks questions of that model
// ("is this setPower() inside the control loop, and does its argument come from
// a joystick?"). Nothing is compiled, run or uploaded, and the UI says so.
//
// HARD RULE: student code is never run. This file only reads the parser's model
// of the text; it has no way to execute anything.
//
// Pipeline: input guards → parse → gates (integrity: parses, OpMode present,
// lesson copy, …) → criteria (weighted, partial credit, evidence lines) →
// forbidden patterns (penalties) → late gates that need to know what earned
// credit (declared identifiers) → extra issues (unreachable code) → score.
//
// Return shape (graded):
//   { status: 'graded', grader: 'structural', graderVersion: 'structural-2/rules-N', parserVersion,
//     passed, score (0-100), summary, strengths[label], issues[{ id, severity, description, line, fix }],
//     requirements_met[{ id, requirement, met, credit, explanation, evidence[{line,text}], hint }],
//     next_steps[hint], gates[{ id, label, passed, severity, explanation, evidence }], structural: true }
//   'reflection' / 'ungraded' shapes carry null scores; rejected input gives { error: true, message }.
//
// Exposes: window.checkCode(phaseId, code, opts), window.getPhaseRequirements(phaseId), window.RTCodeCheck

(function () {
  'use strict';

  var VERSION = 'structural-2';
  var MAX_CODE_LENGTH = 50000;
  var DISCLAIMER = 'Structural check only — this reads your code\'s structure (classes, methods, loops, calls and where values flow); it does not compile, run, or verify that it works.';
  var MAX_EVIDENCE = 5;

  // ── Hardware and sensor vocabulary shared by the helpers ──────────────────
  var MOTOR_TYPE = /^(DcMotor|DcMotorEx|DcMotorSimple|DcMotorImplEx)$/;
  var SERVO_TYPE = /^(Servo|CRServo|ServoImplEx|CRServoImplEx)$/;
  var SENSOR_TYPE = /^(ColorSensor|NormalizedColorSensor|RevColorSensorV3|ColorRangeSensor|DistanceSensor|Rev2mDistanceSensor|TouchSensor|RevTouchSensor|IMU|BNO055IMU|DigitalChannel|AnalogInput|OpticalDistanceSensor|UltrasonicSensor)$/;
  var HW_TYPE = new RegExp(MOTOR_TYPE.source.slice(0, -1) + '|' + SERVO_TYPE.source.slice(1, -1) + '|' + SENSOR_TYPE.source.slice(1));
  // hardwareMap.<field>.get("name") → device type
  var HW_MAP_FIELDS = { dcMotor: 'DcMotor', servo: 'Servo', crservo: 'CRServo', colorSensor: 'ColorSensor',
    distanceSensor: 'DistanceSensor', touchSensor: 'TouchSensor', analogInput: 'AnalogInput', digitalChannel: 'DigitalChannel' };
  // Reads that only a sensor answers, and reads that count only when the receiver is a sensor.
  var STRONG_READS = /^(red|green|blue|alpha|argb|getDistance|isPressed|getNormalizedColors|getAngularOrientation|getRobotYawPitchRollAngles|getLightDetected|getRawLightDetected)$/;
  var WEAK_READS = /^(getState|getVoltage|getValue|getHue|getYaw)$/;
  var STICK = /^(left|right)_stick_[xy]$/;
  var TRIGGER = /^(left|right)_trigger$/;
  var BUTTON = /^(a|b|x|y|cross|circle|square|triangle|left_bumper|right_bumper|dpad_up|dpad_down|dpad_left|dpad_right|start|back|guide|options|share|ps|touchpad|left_stick_button|right_stick_button)$/;
  var BUTTON_METHOD = /^(a|b|x|y|cross|circle|square|triangle|leftBumper|rightBumper|dpadUp|dpadDown|dpadLeft|dpadRight|start|back|options|share)(WasPressed|WasReleased)$/;
  var PATH_BUILDERS = /^(line|curve|through|path)$/;
  // Explanations are sentences: they contain at least one of these.
  var FUNCTION_WORDS = Object.create(null);
  ('a an the to of in on at by for from with without into so because since if when while then than but or and not no ' +
   'is are was were be been it its this that these those we our you your they them it\'s can will would should must ' +
   'do does did has have had only just every each all any more less too why how what which who until after before ' +
   'once instead otherwise also still never always').split(' ').forEach(function (w) { FUNCTION_WORDS[w] = true; });
  var HEADING_INTERP = /^(linear|constant|tangent|facingPoint)$/;

  // ── Text preparation ──────────────────────────────────────────────────────
  // Replace comments and string/char literals with spaces so patterns only see code.
  // Newlines are preserved so line numbers stay meaningful.
  function stripCommentsAndStrings(src) {
    var out = '';
    var i = 0, n = src.length;
    while (i < n) {
      var c = src[i], d = src[i + 1];
      if (c === '/' && d === '/') {                       // line comment
        while (i < n && src[i] !== '\n') { out += ' '; i++; }
      } else if (c === '/' && d === '*') {                // block comment
        out += '  '; i += 2;
        while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { out += src[i] === '\n' ? '\n' : ' '; i++; }
        if (i < n) { out += '  '; i += 2; }
      } else if (c === '"' || c === "'") {                // string / char literal
        var q = c; out += ' '; i++;
        while (i < n && src[i] !== q) { if (src[i] === '\\') { out += ' '; i++; } out += src[i] === '\n' ? '\n' : ' '; i++; }
        if (i < n) { out += ' '; i++; }
      } else {
        out += c; i++;
      }
    }
    return out;
  }

  function norm(s) { return String(s == null ? '' : s).replace(/\s+/g, ''); }
  function baseType(t) { return t ? String(t).replace(/<.*$/, '').replace(/\[\]/g, '').replace(/^.*\./, '').trim() : null; }

  // ── Helpers (H): questions the rules ask of the parsed model ──────────────
  // Every helper is bound to one model and memoises its answer, so rules can call
  // them freely. Names are frozen (plan §2.2); later additions are marked.
  function makeH(model, src) {
    var M = model;
    var memo = Object.create(null);
    function once(key, fn) { if (!(key in memo)) memo[key] = fn(); return memo[key]; }
    var toks = M.tokens;
    var H = { model: M };

    function lineOf(x) {
      if (x == null) return 0;
      if (typeof x === 'number') return x;
      if (typeof x.line === 'number') return x.line;
      if (typeof x.start === 'number' && toks[x.start]) return toks[x.start].line;
      return 0;
    }
    // Evidence item for a node, a token index range or a line number: { line, text }.
    H.ev = function (x) {
      if (x && typeof x === 'object' && typeof x.line === 'number' && typeof x.text === 'string' && !x.nodeType) return { line: x.line, text: x.text };
      var line = lineOf(x);
      var text = line ? String(M.lineText(line) || '').trim() : '';
      if (text.length > 100) text = text.slice(0, 99) + '…';
      return { line: line, text: text };
    };

    // Type of a declared name at a node ('var' resolved to the constructed type).
    H.varType = function (name, at) {                     // (addition)
      var d = M.declOf(name, at);
      if (!d) return null;
      return baseType(d.inferredType || d.typeText || d.type);
    };
    // Type of the object a call is made on (follows fields through user types), or null.
    H.receiverType = function (c) {                       // (addition)
      if (!c || !c.receiverChain || !c.receiverChain.length) return null;
      var chain = c.receiverChain;
      var t = H.varType(chain[0], c.start);
      if (!t) return M.typeNamed(chain[0]) ? chain[0] : null;
      for (var k = 1; k < chain.length; k++) {
        var T = M.typeNamed(t);
        if (!T) return null;
        var f = null;
        for (var j = 0; j < T.fields.length; j++) if (T.fields[j].name === chain[k]) { f = T.fields[j]; break; }
        if (!f) return null;
        t = baseType(f.typeText || f.type);
      }
      return t;
    };
    // The innermost call whose arguments contain token i, or null. (addition)
    H.callAround = function (i) {
      var best = null;
      M.calls.forEach(function (c) {
        if (c.start < i && i < c.end && c.args.some(function (a) { return i >= a.start && i < a.end; }) && (!best || c.end - c.start < best.end - best.start)) best = c;
      });
      return best;
    };
    H.isUserType = function (name) { return !!(name && M.typeNamed(name)); };   // (addition)

    // The OpMode the student is submitting: prefers one with an entry method and without @Disabled.
    H.opMode = function () {
      return once('opMode', function () {
        var list = M.typesExtending(/^(LinearOpMode|OpMode)$/);
        if (!list.length) return null;
        function hasEntry(T) { return T.methods.some(function (m) { return (m.name === 'runOpMode' || m.name === 'loop') && m.block; }); }
        function score(T) { return (hasEntry(T) ? 2 : 0) + (T.annotations.indexOf('Disabled') < 0 ? 1 : 0); }
        return list.slice().sort(function (a, b) { return score(b) - score(a); })[0];
      });
    };
    H.opModes = function () { return M.typesExtending(/^(LinearOpMode|OpMode)$/); };   // (addition)
    H.isLinear = function () {
      var T = H.opMode();
      return !!T && M.typesExtending(/^LinearOpMode$/).indexOf(T) >= 0;
    };

    function blockLive(b) { return !!b && !b.dead && !!b.typeRef && (b.methodRef ? !!b.methodRef.reachable : true); }
    // Control-loop bodies (while opModeIsActive / OpMode loop()) in code that can run.
    H.loopBodies = function () { return once('loops', function () { return M.loopBodies().filter(blockLive); }); };
    // Init regions (runOpMode before waitForStart, init, init_loop, start, constructors) in code that can run.
    H.initBodies = function () {
      return once('inits', function () { return M.initBodies().filter(function (r) { return r.method && r.method.reachable; }); });
    };
    // Init regions plus the bodies of user methods they call (≤ 2 hops), e.g. a setup() helper. (addition)
    H.initRegions = function () {
      return once('initRegions', function () {
        var out = [], seen = new Set();
        H.initBodies().forEach(function (r) {
          out.push({ start: r.start, end: r.end, method: r.method, hops: 0 });
          H.callsWithin({ start: r.start, end: r.end }, 2).forEach(function (c) {
            var res = M.resolveCall(c);
            if (res.how === 'external') return;
            res.methods.forEach(function (m) {
              if (m.block && m !== r.method && !seen.has(m) && m.reachable) { seen.add(m); out.push({ start: m.block.open, end: m.block.close + 1, method: m, hops: 1 }); }
            });
          });
        });
        return out;
      });
    };
    H.inInit = function (node) {                          // (addition)
      var i = typeof node === 'number' ? node : (node && (node.nodeType === 'assign' || node.nodeType === 'decl') ? node.index : node && node.start);
      return H.initRegions().some(function (r) { return i >= r.start && i < r.end; });
    };

    H.callsIn = function (x, hops) { return M.callsIn(x, hops || 0); };
    H.count = function (list, pred) { var n = 0; (list || []).forEach(function (x, i) { if (!pred || pred(x, i)) n++; }); return n; };
    H.distinct = function (list, keyFn) {
      var seen = Object.create(null), out = [];
      (list || []).forEach(function (x) { var k = String(keyFn ? keyFn(x) : x); if (!(k in seen)) { seen[k] = true; out.push(x); } });
      return out;
    };

    // Code regions a control loop runs each iteration: loop bodies (with their headers) plus the
    // bodies of user methods called from them within `hops` calls. (addition)
    H.loopRegions = function (hops) {
      hops = hops == null ? 2 : hops;
      return once('regions' + hops, function () {
        var out = [], seen = new Set();
        H.loopBodies().forEach(function (b) {
          var start = b.header && b.kind !== 'method' ? Math.min(b.header.start, b.open) : b.open;
          out.push({ start: start, end: b.close + 1, block: b, method: b.methodRef, hops: 0 });
          var calls = M.callsIn(b, hops);
          (calls.via || []).forEach(function (v) {
            if (v && v.method && v.method.block && !seen.has(v.method)) {
              seen.add(v.method);
              out.push({ start: v.method.block.open, end: v.method.block.close + 1, block: v.method.block, method: v.method, hops: v.hops });
            }
          });
          // Methods called from the loop that contain no calls themselves are not in `via`: add them too.
          calls.forEach(function (c) {
            var r = M.resolveCall(c);
            if (r.how === 'external') return;
            r.methods.forEach(function (m) {
              if (m.block && !seen.has(m) && m.block !== b) { seen.add(m); out.push({ start: m.block.open, end: m.block.close + 1, block: m.block, method: m, hops: 1 }); }
            });
          });
        });
        return out;
      });
    };
    H.inLoopRegion = function (node, hops) {              // (addition)
      var i = typeof node === 'number' ? node : (node && (node.nodeType === 'assign' || node.nodeType === 'decl') ? node.index : node && node.start);
      return H.loopRegions(hops).some(function (r) { return i >= r.start && i < r.end; });
    };
    // Calls whose name token sits in a token range, plus calls reached from them within `hops`. (addition)
    H.callsWithin = function (range, hops) {
      if (!range) return [];
      var out = [], seen = new Set(), visited = new Set();
      var frontier = M.calls.filter(function (c) { return c.start >= range.start && c.start < range.end; });
      frontier.forEach(function (c) { seen.add(c); out.push(c); });
      for (var h = 1; h <= (hops || 0) && frontier.length; h++) {
        var next = [];
        frontier.forEach(function (c) {
          var r = M.resolveCall(c);
          if (r.how === 'external') return;
          r.methods.forEach(function (m) {
            if (!m.block || visited.has(m)) return;
            visited.add(m);
            M.calls.forEach(function (d) {
              if (d.start > m.block.open && d.start < m.block.close && !seen.has(d)) { seen.add(d); out.push(d); next.push(d); }
            });
          });
        });
        frontier = next;
      }
      return out;
    };

    // Is token i in code that can run (reachable, not under if (false) or after a return)? (addition)
    H.liveToken = function (i) {
      var st = M.statementAt(i);
      if (st && st.dead) return false;
      var b = M.blockAt(i);
      if (b && b.dead) return false;
      var e = M.enclosing(i);
      return !!(e && e.reachable && e.type && !(e.method && !e.method.reachable));
    };

    // Variables assigned from hardwareMap: hardwareMap.get(T.class, "name") or hardwareMap.<kind>.get("name").
    H.hardwareVars = function () {
      return once('hw', function () {
        var out = [];
        M.calls.forEach(function (c) {
          if (c.name !== 'get' || !c.receiverChain.length) return;
          var root = c.receiverChain[0];
          var isMap = root === 'hardwareMap' || H.varType(root, c.start) === 'HardwareMap';
          if (!isMap || c.receiverChain.length > 2) return;
          var typeText = null, deviceName = null;
          if (c.receiverChain.length === 2) typeText = HW_MAP_FIELDS[c.receiverChain[1]] || null;
          c.args.forEach(function (a) {
            var t = toks[a.start];
            if (a.end - a.start === 1 && t && t.type === 'string' && deviceName == null) deviceName = t.value;
            var m = /^([A-Za-z_$][\w$]*)\s*\.\s*class$/.exec(a.text.trim());
            if (m && !typeText) typeText = m[1];
          });
          // Where does the device go? The innermost assignment or declaration holding the call.
          var target = null, decl = null, node = null, best = Infinity;
          M.assigns.forEach(function (a) {
            if (a.rhs.start <= c.chainStart && c.end <= a.rhs.end && a.rhs.end - a.rhs.start < best) { best = a.rhs.end - a.rhs.start; target = a.targetBase; node = a; }
          });
          M.decls.forEach(function (d) {
            if (d.init && d.init.start <= c.chainStart && c.end <= d.init.end && d.init.end - d.init.start < best) { best = d.init.end - d.init.start; target = d.name; node = d; }
          });
          if (!target) return;
          var name = target.split('.').pop();
          decl = node.nodeType === 'decl' ? node : M.declOf(name, node.index);
          if (!typeText && decl) typeText = baseType(decl.typeText);
          if (!typeText) {                                   // (DcMotor) hardwareMap.get("x")
            var p = c.chainStart - 1;
            if (toks[p] && toks[p].value === ')' && toks[p - 1] && toks[p - 2] && toks[p - 2].value === '(') typeText = toks[p - 1].value;
          }
          // Loop variables that iterate over this name (for (DcMotor m : motors)) share its uses.
          var aliases = M.decls.filter(function (d) {
            if (d.scope !== 'foreach' || !d.init) return false;
            for (var k = d.init.start; k < d.init.end; k++) if (toks[k].value === name) return true;
            return false;
          });
          var uses = M.calls.filter(function (u) {
            if (u === c || !u.live || u.receiverText === '' || !u.receiverChain.length) return false;
            if (u.chainStart >= c.chainStart && u.start < c.end) return false;
            var r = u.receiverChain[0];
            if (r === name) return !decl || M.declOf(name, u.start) === decl || (u.receiverChain.length === 1 && target.indexOf('.') < 0 && !M.declOf(name, u.start));
            return aliases.some(function (al) { return al.name === r && M.declOf(r, u.start) === al; });
          });
          out.push({ name: name, target: target, decl: decl, typeText: typeText, deviceName: deviceName, get: c, node: node, uses: uses,
            owner: c.type || null, live: c.live });
        });
        return out;
      });
    };
    H.motors = function () { return H.hardwareVars().filter(function (v) { return MOTOR_TYPE.test(v.typeText || ''); }); };
    H.servos = function () { return H.hardwareVars().filter(function (v) { return SERVO_TYPE.test(v.typeText || ''); }); };
    H.sensors = function () { return H.hardwareVars().filter(function (v) { return SENSOR_TYPE.test(v.typeText || ''); }); };
    H.isHardwareType = function (t) { return HW_TYPE.test(baseType(t) || ''); };   // (addition)

    // Gamepad reads in a range (default: the whole file): gamepad1/gamepad2 and Gamepad aliases.
    // → [{ i, pad, field, kind: 'stick'|'stick_y'|'trigger'|'button', line }]
    H.gamepadTokens = function (range) {
      var s = 0, e = toks.length - 1;
      if (range) {
        if (range.nodeType === 'block') { s = range.header && range.kind !== 'method' ? Math.min(range.header.start, range.open) : range.open; e = range.close + 1; }
        else if (range.nodeType === 'method' && range.block) { s = range.block.open; e = range.block.close + 1; }
        else if (typeof range.start === 'number') { s = range.start; e = range.end; }
      }
      var out = [];
      for (var i = s; i < e && i < toks.length - 1; i++) {
        var t = toks[i];
        if (t.type !== 'ident') continue;
        var prev = toks[i - 1];
        if (prev && prev.value === '.' && !(toks[i - 2] && toks[i - 2].value === 'this')) continue;
        if (!(toks[i + 1] && toks[i + 1].value === '.' && toks[i + 2] && toks[i + 2].type === 'ident')) continue;
        var pad = null;
        if (t.value === 'gamepad1' || t.value === 'gamepad2') pad = t.value;
        else {
          var d = M.declOf(t.value, i);
          if (d && (baseType(d.typeText) === 'Gamepad' || (d.init && /^(this\.)?gamepad[12]$/.test(norm(M.textOf(d.init)))))) pad = t.value;
        }
        if (!pad) continue;
        var f = toks[i + 2].value, kind = null;
        var isCall = toks[i + 3] && toks[i + 3].value === '(';
        if (!isCall && STICK.test(f)) kind = /_y$/.test(f) ? 'stick_y' : 'stick';
        else if (!isCall && TRIGGER.test(f)) kind = 'trigger';
        else if ((!isCall && BUTTON.test(f)) || (isCall && BUTTON_METHOD.test(f))) kind = 'button';
        if (!kind) continue;
        out.push({ i: i, field: i + 2, pad: pad, name: f, kind: kind, line: t.line, stick: kind === 'stick' || kind === 'stick_y' });
      }
      return out;
    };

    function isSensorReadCall(c) {
      if (!c) return false;
      if (STRONG_READS.test(c.name)) return true;
      if (WEAK_READS.test(c.name)) { var t = H.receiverType(c); return !!t && SENSOR_TYPE.test(t); }
      return false;
    }
    H.isSensorRead = isSensorReadCall;                    // (addition)
    var readCache = new Map();
    function methodReadsSensor(m) {
      if (!m || !m.block) return false;
      if (readCache.has(m)) return readCache.get(m);
      readCache.set(m, false);
      var r = M.callsIn(m, 1).some(isSensorReadCall);
      readCache.set(m, r);
      return r;
    }
    function callReadsSensor(c) {
      if (isSensorReadCall(c)) return true;
      var r = M.resolveCall(c);
      if (r.how === 'external') return false;
      return r.methods.some(methodReadsSensor);
    }
    // Does a token range get its value from a sensor read (directly, through ≤ 3 assignments, or
    // from a user method that reads a sensor)?
    H.sensorDerived = function (range, method) {
      if (!range) return false;
      for (var i = range.start; i < range.end; i++) { var c = M.callAt(i); if (c && callReadsSensor(c)) return true; }
      var sink = { start: range.start, end: range.end };
      if (method !== undefined) sink.method = method;
      else if (range.method !== undefined) sink.method = range.method;
      var r = M.flowsTo(function (t, c) { return !!c && callReadsSensor(c); }, sink, { maxHops: 3 });
      return !!(r && r.ok);
    };

    // How an enum is used: { declared, assigned, compared, switched, type, vars, nodes }.
    H.enumUsed = function (name) {
      var T = M.typeNamed(name);
      var res = { declared: !!(T && T.kind === 'enum'), assigned: false, compared: false, switched: false, type: T, vars: [], nodes: [] };
      if (!res.declared) return res;
      var constRe = new RegExp('\\b' + name + '\\s*\\.\\s*[A-Za-z_$]');
      res.vars = M.decls.filter(function (d) { return d.scope !== 'enum' && baseType(d.inferredType || d.typeText) === name; });
      function isEnumVar(id, at) { var d = M.declOf(id, at); return !!d && res.vars.indexOf(d) >= 0; }
      M.assigns.forEach(function (a) {
        if (!a.live) return;
        if (constRe.test(M.textOf(a.rhs)) || isEnumVar(a.targetBase.split('.').pop(), a.index)) { res.assigned = true; res.nodes.push(a); }
      });
      M.conds.forEach(function (c) {
        if (!c.live || c.caseLabel) return;
        if (!/==|!=/.test(c.text)) return;
        var hit = constRe.test(c.text);
        for (var k = c.start; !hit && k < c.end; k++) if (toks[k].type === 'ident' && isEnumVar(toks[k].value, k)) hit = true;
        if (hit) { res.compared = true; res.nodes.push(c); }
      });
      M.blocks.forEach(function (b) {
        if (b.kind !== 'switch' || !b.cond || b.dead) return;
        var id = norm(b.cond.text).replace(/^this\./, '');
        var byVar = /^[A-Za-z_$][\w$]*$/.test(id) && isEnumVar(id, b.cond.start);
        var labels = M.cases.filter(function (cs) { return cs.block === b && !cs.isDefault; });
        var byLabels = labels.length > 0 && labels.every(function (cs) { return cs.labels.every(function (l) { return T.enumConstants.indexOf(l.replace(/^.*\./, '')) >= 0; }); });
        if (byVar || byLabels) { res.switched = true; res.nodes.push(b.cond); }
      });
      return res;
    };

    // Numeric value of an argument: a literal (unary minus allowed) or a name whose declaration is one.
    function numericArg(a) {
      var t = norm(a.text);
      if (/^-?(\d+\.?\d*|\.\d+)([dDfF])?$/.test(t)) return parseFloat(t);
      if (/^-?[A-Za-z_$][\w$]*$/.test(t)) {
        var neg = t.charAt(0) === '-', id = neg ? t.slice(1) : t;
        var d = M.declOf(id, a.start);
        if (d && d.init) {
          var v = norm(M.textOf(d.init));
          if (/^-?(\d+\.?\d*|\.\d+)([dDfF])?$/.test(v)) return (neg ? -1 : 1) * parseFloat(v);
        }
      }
      return null;
    }
    H.numericArg = numericArg;                            // (addition)
    function targetOf(node) {
      var best = null, size = Infinity;
      M.assigns.forEach(function (a) {
        if (a.rhs.start <= node.start && node.end <= a.rhs.end && a.rhs.end - a.rhs.start < size) { size = a.rhs.end - a.rhs.start; best = a.targetBase; }
      });
      M.decls.forEach(function (d) {
        if (d.init && d.init.start <= node.start && node.end <= d.init.end && d.init.end - d.init.start < size) { size = d.init.end - d.init.start; best = d.name; }
      });
      return best;
    }
    H.targetOf = targetOf;                                // (addition)

    // PoseFactory variables (typed PoseFactory or built from PoseFactory.degrees()/radians()).
    function isPoseFactoryVar(name, at) {
      var d = M.declOf(name, at);
      if (!d) return false;
      if (baseType(d.typeText) === 'PoseFactory') return true;
      return !!(d.init && /PoseFactory\s*\.\s*(degrees|radians)\s*\(/.test(M.textOf(d.init)));
    }
    // Poses: p.of(x, y, h) on a PoseFactory and new Pose(x, y[, h]) with numeric arguments.
    H.poses = function () {
      return once('poses', function () {
        var out = [];
        M.calls.forEach(function (c) {
          if (c.name !== 'of' || c.args.length !== 3) return;
          var ok = (c.receiverChain.length === 1 && isPoseFactoryVar(c.receiverChain[0], c.start)) || /^PoseFactory\.(degrees|radians)$/.test(c.chainRoot || '');
          if (!ok) return;
          var v = c.args.map(numericArg);
          if (v.some(function (x) { return x === null; })) return;
          out.push({ name: targetOf(c), x: v[0], y: v[1], h: v[2], call: c, line: c.line, live: c.live, start: c.start, end: c.end });
        });
        M.news.forEach(function (w) {
          if (w.typeName !== 'Pose' || (w.args.length !== 3 && w.args.length !== 2)) return;
          var v = w.args.map(numericArg);
          if (v.some(function (x) { return x === null; })) return;
          out.push({ name: targetOf(w), x: v[0], y: v[1], h: v.length > 2 ? v[2] : 0, call: w, line: w.line, live: w.live, start: w.start, end: w.end });
        });
        return out;
      });
    };
    // Is an identifier at token i a declared pose (typed Pose, or holding one of H.poses())?
    H.isPoseName = function (name, at) {                  // (addition)
      var d = M.declOf(name, at);
      if (d && baseType(d.typeText) === 'Pose') return true;
      return H.poses().some(function (p) { return p.name === name; });
    };

    // Path methods (return Path/PathChain) and Path-typed variables built with line()/curve():
    // → [{ method, name, builder, interp, poseRefs[], reachable, node }]
    H.pathMethods = function () {
      return once('paths', function () {
        var out = [];
        function describe(range, name, method, node, reachable) {
          var calls = M.calls.filter(function (c) { return c.start >= range.start && c.start < range.end; });
          var builders = calls.filter(function (c) { return PATH_BUILDERS.test(c.name) && (c.receiverText === '' || c.receiverText === 'Paths'); });
          if (!builders.length) { out.push({ method: method, name: name, builder: null, interp: null, poseRefs: [], reachable: reachable, node: node }); return; }
          var b = builders[0];
          var interpCall = calls.filter(function (c) { return HEADING_INTERP.test(c.name) && c.chainStart === b.chainStart && c.start > b.start; })[0] || null;
          var refs = [];
          builders.forEach(function (bc) {
            bc.args.forEach(function (a) {
              var id = norm(a.text);
              if (/^[A-Za-z_$][\w$]*$/.test(id) && refs.indexOf(id) < 0 && H.isPoseName(id, a.start)) refs.push(id);
            });
          });
          out.push({ method: method, name: name, builder: b.name, builderCall: b, interp: interpCall ? interpCall.name : null, interpCall: interpCall,
            poseRefs: refs, reachable: reachable, node: node });
        }
        M.methods.forEach(function (m) {
          if (!m.block || !/^(Path|PathChain)$/.test(baseType(m.returnType) || '')) return;
          describe({ start: m.block.open, end: m.block.close }, m.name, m, m, !!m.reachable);
        });
        M.decls.forEach(function (d) {
          if (!/^(Path|PathChain)$/.test(baseType(d.typeText) || '')) return;
          var ranges = [];
          if (d.init) ranges.push({ r: d.init, live: true, node: d });
          M.assigns.forEach(function (a) { if (a.targetBase === d.name && M.declOf(d.name, a.index) === d) ranges.push({ r: a.rhs, live: a.live, node: a }); });
          ranges.forEach(function (x) { describe(x.r, d.name, null, x.node, x.live); });
        });
        return out;
      });
    };

    // Comments that explain: ≥ minWords words, ≥ minReal real words, not a duplicate, not restating the code.
    // Consecutive whole-line // comments are read as one comment.
    var identSet = null;
    function idents() {
      if (identSet) return identSet;
      identSet = Object.create(null);
      toks.forEach(function (t) { if (t.type === 'ident') identSet[t.value] = true; });
      return identSet;
    }
    function isRealWord(w) {
      if (!/^[A-Za-z]{3,}$/.test(w) || !/[aeiouy]/i.test(w)) return false;
      if (/[a-z][A-Z]/.test(w)) return false;              // camelCase is an identifier
      if (/[bcdfghjklmnpqrstvwxz]{4,}/i.test(w) || w.length > 20) return false;   // keyboard mash, not a word
      return !idents()[w];
    }
    H.isRealWord = isRealWord;                            // (addition)
    H.commentGroups = function () {                       // (addition)
      return once('cgroups', function () {
        var out = [];
        var list = (M.comments || []).slice().sort(function (a, b) { return a.line - b.line; });
        list.forEach(function (c) {
          var own = /^\s*(\/\/|\/\*)/.test(M.lineText(c.line) || '');
          var last = out[out.length - 1];
          if (last && c.kind === 'line' && last.kind === 'line' && own && last.own && c.line === last.endLine + 1) {
            last.text += ' ' + c.text; last.endLine = c.line; last.nextCodeLine = c.nextCodeLine; last.parts.push(c);
            return;
          }
          out.push({ text: c.text || '', line: c.line, endLine: c.endLine || c.line, kind: c.kind, own: own, nextCodeLine: c.nextCodeLine, parts: [c] });
        });
        return out;
      });
    };
    H.words = function (text) { return String(text || '').match(/[A-Za-z][A-Za-z'_$0-9]*/g) || []; };   // (addition)
    H.qualityComments = function (opts) {
      opts = opts || {};
      var minWords = opts.minWords == null ? 3 : opts.minWords;
      var minReal = opts.minReal == null ? 2 : opts.minReal;
      var distinct = opts.distinct !== false, noRestate = opts.noRestate !== false;
      var groups = opts.groups || H.commentGroups();
      var seen = Object.create(null), out = [];
      groups.forEach(function (g) {
        var words = H.words(g.text);
        if (words.length < minWords) return;
        var real = words.filter(isRealWord);
        var uniqueReal = H.distinct(real, function (w) { return w.toLowerCase(); });
        if (uniqueReal.length < minReal) return;
        if (!words.some(function (w) { return FUNCTION_WORDS[w.toLowerCase()]; })) return;   // prose, not a word list
        var key = words.join(' ').toLowerCase();
        if (distinct && seen[key]) return;
        seen[key] = true;
        if (noRestate && g.nextCodeLine) {
          var codeWords = Object.create(null);
          toks.forEach(function (t) {
            if (t.line !== g.nextCodeLine || t.type !== 'ident') return;
            codeWords[t.value.toLowerCase()] = true;
            t.value.split(/(?=[A-Z])|_/).forEach(function (p) { if (p) codeWords[p.toLowerCase()] = true; });
          });
          var hits = words.filter(function (w) { return codeWords[w.toLowerCase()]; }).length;
          if (hits / words.length >= 0.5) return;
        }
        out.push({ text: g.text, line: g.line, words: words, real: real, group: g });
      });
      return out;
    };

    // Regex count over the source (comments and strings blanked unless raw).
    H.textRule = function (regex, opts) {
      opts = opts || {};
      var text = opts.raw ? src : once('stripped', function () { return stripCommentsAndStrings(src); });
      var flags = regex.flags.indexOf('g') < 0 ? regex.flags + 'g' : regex.flags;
      var re = new RegExp(regex.source, flags), m, lines = [], count = 0;
      while ((m = re.exec(text)) && count < 10000) {
        count++;
        lines.push(text.slice(0, m.index).split('\n').length);
        if (m[0] === '') re.lastIndex++;
      }
      return { count: count, met: count >= (opts.min || 1), lines: lines };
    };
    H.stripCommentsAndStrings = stripCommentsAndStrings;
    return H;
  }

  // ── Reachability refinement ───────────────────────────────────────────────
  // The parser marks a method reachable when any call names it, even a call under
  // if (false). Here a method (not an entry point, override or constructor) whose
  // every call site is dead, or sits in a method that is itself unreachable, is
  // marked unreachable too, and the calls, assignments, `new`s and conditions in
  // it stop counting as live. Fixpoint, bounded by the number of methods.
  var ENTRY = /^(runOpMode|init|init_loop|start|loop|stop)$/;
  function refineReachability(M) {
    var callers = new Map();
    M.calls.forEach(function (c) {
      var r = M.resolveCall(c);
      r.methods.forEach(function (m) { if (!callers.has(m)) callers.set(m, []); callers.get(m).push(c); });
    });
    var refNames = Object.create(null);
    (M.methodRefs || []).forEach(function (r) { refNames[r.name] = true; });
    // A @Disabled OpMode never shows on the Driver Station: when an enabled OpMode with an entry
    // method exists, the disabled ones (and whatever only they call) do not run.
    var opModes = M.typesExtending(/^(LinearOpMode|OpMode)$/);
    function hasEntry(T) { return T.methods.some(function (m) { return (m.name === 'runOpMode' || m.name === 'loop') && m.block; }); }
    var disabled = opModes.filter(function (T) { return T.annotations.indexOf('Disabled') >= 0; });
    var dropTypes = opModes.some(function (T) { return disabled.indexOf(T) < 0 && hasEntry(T); }) ? disabled : [];
    function inDropType(i) {
      for (var b = M.blockAt(i), T = b && b.typeRef; T; T = T.outer) if (dropTypes.indexOf(T) >= 0) return true;
      return false;
    }
    var changed = true, guard = 0, dropped = [];
    M.methods.forEach(function (m) { if (m.block && m.reachable && inDropType(m.block.open)) { m.reachable = false; dropped.push(m); } });
    function inDead(c) { return c.dead || !c.reachable || (c.method && !c.method.reachable) || inDropType(c.start); }
    while (changed && guard++ <= M.methods.length) {
      changed = false;
      M.methods.forEach(function (m) {
        if (!m.reachable || m.isCtor || m.anonymous || !m.block || refNames[m.name]) return;
        if (m.annotations.indexOf('Override') >= 0) return;
        if (ENTRY.test(m.name) && M.typesExtending(/^(LinearOpMode|OpMode)$/).indexOf(m.owner) >= 0) return;
        var list = callers.get(m) || [];
        if (!list.length) return;                               // reachable for another reason (no OpMode: every method is an entry)
        if (list.every(inDead)) { m.reachable = false; dropped.push(m); changed = true; }
      });
    }
    // Statements outside every class cannot run in Java, whatever the parser assumed for a file with no OpMode.
    function outside(i) { var b = M.blockAt(i); return !b || !b.typeRef; }
    function inDropped(i) {
      return outside(i) || inDropType(i) || dropped.some(function (m) { return i > m.block.open && i < m.block.close; });
    }
    M.calls.forEach(function (c) { if (inDropped(c.start)) { c.reachable = false; c.live = false; } });
    M.assigns.forEach(function (a) { if (inDropped(a.index)) { a.reachable = false; a.live = false; } });
    M.news.forEach(function (w) { if (inDropped(w.start)) { w.reachable = false; w.live = false; } });
    M.conds.forEach(function (k) { if (inDropped(k.start)) { k.reachable = false; k.live = false; } });
    (M.cases || []).forEach(function (k) { if (inDropped(k.start)) { k.reachable = false; k.live = false; } });
  }

  // ── Engine ────────────────────────────────────────────────────────────────
  function clamp01(x) { x = +x; return isNaN(x) ? 0 : Math.max(0, Math.min(1, x)); }

  // Evidence can be given as nodes, line numbers or { line, text }; credited calls are collected.
  function normEvidence(list, H, credited) {
    var out = [], seen = Object.create(null);
    (Array.isArray(list) ? list : list ? [list] : []).forEach(function (x) {
      if (x == null) return;
      if (credited && x.nodeType === 'call') {
        credited.push(x);
        H.model.calls.forEach(function (c) { if (c !== x && c.start > x.start && c.start < x.end) credited.push(c); });   // calls in its arguments
      } else if (credited && (x.nodeType === 'cond' || x.nodeType === 'assign' || x.nodeType === 'new') && typeof x.start === 'number') {
        H.model.calls.forEach(function (c) { if (c.start >= x.start && c.start < x.end) credited.push(c); });
      }
      var e = H.ev(x);
      if (!e.line) return;
      var k = e.line + ':' + e.text;
      if (seen[k]) return;
      seen[k] = true;
      if (out.length < MAX_EVIDENCE) out.push(e);
    });
    return out;
  }
  function evLine(ev) { return ev && ev[0] ? 'line ' + ev[0].line + ': ' + ev[0].text : ''; }

  function runCriterion(r, ctx) {
    var res;
    try { res = r.credit(ctx); }
    catch (e) {
      if (window.__RT_CODECHECK_DEBUG) throw e;
      res = { credit: 0, explanation: 'This requirement could not be checked on your code.' };
    }
    if (typeof res === 'number' || typeof res === 'boolean') res = { credit: +res };
    res = res || { credit: 0 };
    var credit = clamp01(res.credit);
    var calls = [];
    var evidence = normEvidence(res.evidence, ctx.H, credit > 0 ? calls : null);
    calls.forEach(function (c) { ctx.credited.push(c); });
    var explanation = res.explanation || (credit >= 0.999 ? 'Found.' : credit > 0 ? 'Partly found.' : 'Not found.');
    return { credit: credit, explanation: explanation, evidence: evidence, issues: res.issues || [], calls: calls };
  }

  function runTest(fn, ctx) {
    try { return fn(ctx); }
    catch (e) {
      if (window.__RT_CODECHECK_DEBUG) throw e;
      return null;
    }
  }

  function defaultReferences(phaseId) {
    var out = [];
    try {
      var lessons = window.PHASE_LESSONS && window.PHASE_LESSONS[phaseId];
      if (Array.isArray(lessons)) lessons.forEach(function (sec) {
        var c = sec && sec.code;
        if (c && !c.kit && typeof c.snippet === 'string' && c.snippet) out.push(c.snippet);
      });
      var adv = window.ADVANCED_CONTENT && window.ADVANCED_CONTENT[phaseId];
      if (adv && Array.isArray(adv.sections)) adv.sections.forEach(function (sec) {
        if (sec && typeof sec.code === 'string' && sec.code) out.push(sec.code);
      });
    } catch (e) { /* references are optional */ }
    return out;
  }

  function kitLoaded(kit) { return !!(kit && Array.isArray(kit.bugs) && typeof kit.similarity === 'function'); }

  // Phase 5: one criterion per seeded bug in the kit program, then the notes criteria.
  function kitCriteria(kit, rules) {
    var list = kit.bugs.map(function (bug) {
      return {
        id: 'bug-' + bug.id, label: 'Bug fixed: ' + bug.title, weight: 15, hint: bug.hint, bug: bug,
        credit: function (ctx) {
          var r = bug.check(ctx, ctx.H) || {};
          ctx.kitStates[bug.id] = r.state || 'broken';
          return { credit: r.state === 'fixed' ? 1 : r.state === 'changed' ? 0.5 : 0, explanation: r.explanation, evidence: r.evidence || [] };
        }
      };
    });
    return list.concat(rules.required || []);
  }

  function graderVersion() { return VERSION + '/' + (window.CODE_RULES_VERSION || 'rules-?'); }
  function parserVersion() { return window.RTJavaStructure ? window.RTJavaStructure.VERSION : null; }

  function shortcut(status, summary) {
    return { status: status, grader: null, graderVersion: null, passed: null, score: null, summary: summary,
      strengths: [], issues: [], requirements_met: [], next_steps: [], structural: true };
  }

  var lastH = null;

  function checkCode(phaseId, code, opts) {
    if (typeof code !== 'string') code = '';
    if (code.length > MAX_CODE_LENGTH) {
      return { error: true, message: 'Code submission is too long. Please keep it under ' + MAX_CODE_LENGTH.toLocaleString() + ' characters.' };
    }
    opts = opts || {};
    var rules = window.CODE_RULES && window.CODE_RULES[phaseId];
    if (rules && rules.reflection) {
      return shortcut('reflection', rules.note || 'This deliverable is kept for your mentor to review; there is no automatic check.');
    }
    if (!rules) {
      return shortcut('ungraded', 'There is no structural check for this phase yet. Your submission is saved in your progress file so a mentor can review it.');
    }
    if (!window.RTJavaStructure) {
      return shortcut('ungraded', 'The code checker did not load, so this submission was saved without a check. Reload the page and try again.');
    }
    var kit = opts.kit || window.RT_PHASE5_KIT;
    if (rules.kit && !kitLoaded(kit)) {
      return shortcut('ungraded', 'The Phase 5 program is not loaded, so there is nothing to compare your fixes against. Your submission is saved in your progress file so a mentor can review it.');
    }
    var snippets = Array.isArray(opts.references) ? opts.references.filter(function (s) { return typeof s === 'string' && s; }) : defaultReferences(phaseId);

    var model = window.RTJavaStructure.parse(code);
    try { refineReachability(model); } catch (e) { if (window.__RT_CODECHECK_DEBUG) throw e; }
    var H = makeH(model, code);
    lastH = H;
    var ctx = { phaseId: phaseId, src: code, model: model, comments: model.comments, refs: { snippets: snippets, kit: rules.kit ? kit : (kit || null) },
      H: H, rules: rules, credited: [], kitStates: {}, results: {} };

    var issues = [], gates = [], penalty = 0, critical = false, voids = [];

    function runGate(g) {
      var r = runTest(g.test, ctx);
      var severity = (r && r.severity) || g.severity || 'WARNING';
      var ev = r ? normEvidence(r.evidence, H, null) : [];
      gates.push({ id: g.id, label: g.label, passed: !r, severity: severity, explanation: r ? (r.explanation || '') : '', evidence: ev });
      if (!r) return;
      // A failed gate can withdraw credit: criteria that relied on the named calls, or every kit bug.
      if (Array.isArray(r.voidCalls) && r.voidCalls.length) voids.push({ calls: r.voidCalls, why: r.voidWhy || g.label });
      if (r.voidKit) voids.push({ kit: true, why: r.voidWhy || g.label });
      if (severity === 'CRITICAL') critical = true;
      var p = r.penalty != null ? r.penalty : (g.penalty || 0);
      if (severity !== 'CRITICAL') penalty += p;
      issues.push({ id: g.id, severity: severity, description: g.label + (r.explanation ? ' — ' + r.explanation : ''), line: evLine(ev), fix: r.hint || g.hint || '' });
    }

    // 1. Gates that only need the model
    var allGates = rules.gates || [];
    allGates.forEach(function (g) { if (!g.after) runGate(g); });

    // 2. Criteria
    var criteria = rules.kit ? kitCriteria(kit, rules) : (rules.required || []);
    var reqs = [];
    criteria.forEach(function (r) {
      var res = runCriterion(r, ctx);
      ctx.results[r.id] = res;
      reqs.push({ id: r.id, requirement: r.label, credit: res.credit, explanation: res.explanation,
        evidence: res.evidence, hint: r.hint, weight: r.weight, calls: res.calls, bug: !!r.bug });
      res.issues.forEach(function (x) { issues.push(x); });
    });

    // 3. Forbidden patterns
    (rules.forbidden || []).forEach(function (f) {
      var r = runTest(f.test, ctx);
      if (!r) return;
      var sev = f.severity || 'WARNING';
      if (sev === 'CRITICAL') critical = true;
      penalty += f.penalty || 0;
      var ev = normEvidence(r.evidence, H, null);
      issues.push({ id: f.id, severity: sev, description: f.label + ' — ' + (r.explanation || f.hint), line: evLine(ev), fix: f.hint });
    });

    // 4. Gates that need to know what earned credit
    allGates.forEach(function (g) { if (g.after) runGate(g); });

    // 5. Informational issues (unreachable code, code under if (false))
    (rules.issues || []).forEach(function (fn) {
      var list = runTest(fn, ctx) || [];
      list.forEach(function (x) {
        var ev = normEvidence(x.evidence, H, null);
        penalty += x.penalty || 0;
        issues.push({ id: x.id, severity: x.severity || 'WARNING', description: x.description, line: evLine(ev), fix: x.fix || '' });
      });
    });

    // Withdrawn credit (see runGate), then the total
    var total = 0;
    reqs.forEach(function (q) {
      if (q.credit > 0) {
        var hit = voids.filter(function (v) { return v.kit ? q.bug : q.calls.some(function (c) { return v.calls.indexOf(c) >= 0; }); })[0];
        if (hit) { q.credit = 0; q.explanation = 'No credit: ' + hit.why + ' failed. (' + q.explanation + ')'; }
      }
      q.credit = Math.round(q.credit * 100) / 100;
      q.met = q.credit >= 0.999;
      total += q.weight * q.credit;
    });

    // Unmet criteria become issues after the gates and forbidden patterns
    reqs.forEach(function (q) {
      if (q.met) return;
      var partly = q.credit > 0;
      issues.push({ id: q.id, severity: partly ? 'SUGGESTION' : 'WARNING',
        description: partly ? 'Partly: ' + q.requirement + ' (' + Math.round(q.credit * 100) + '%)' : 'Missing: ' + q.requirement,
        line: evLine(q.evidence), fix: q.hint });
    });

    var score = Math.max(0, Math.min(100, Math.round(total) - penalty));
    var threshold = typeof rules.passThreshold === 'number' ? rules.passThreshold : 75;
    var passed = !critical && score >= threshold;
    var metCount = reqs.filter(function (q) { return q.met; }).length;
    var partCount = reqs.filter(function (q) { return !q.met && q.credit > 0; }).length;

    var summary = DISCLAIMER + ' Met ' + metCount + ' of ' + reqs.length + ' requirements (' + partCount + ' partly) — score ' + score + '/100.' +
      (critical ? ' A structure check failed, so this cannot auto-verify until it is fixed.' : '');

    var order = { CRITICAL: 0, WARNING: 1, SUGGESTION: 2 };
    issues.forEach(function (x, i) { x._i = i; });
    issues.sort(function (a, b) {
      var oa = order[a.severity] !== undefined ? order[a.severity] : 1, ob = order[b.severity] !== undefined ? order[b.severity] : 1;
      return oa - ob || a._i - b._i;
    });
    issues.forEach(function (x) { delete x._i; });

    var steps = reqs.filter(function (q) { return !q.met && q.hint; })
      .sort(function (a, b) { return a.credit - b.credit || b.weight - a.weight; })
      .map(function (q) { return q.hint; });
    var nextSteps = [];
    steps.forEach(function (h) { if (nextSteps.indexOf(h) < 0 && nextSteps.length < 4) nextSteps.push(h); });

    return {
      status: 'graded',
      grader: 'structural',
      graderVersion: graderVersion(),
      parserVersion: parserVersion(),
      passed: passed,
      score: score,
      summary: summary,
      strengths: reqs.filter(function (q) { return q.met; }).map(function (q) { return q.requirement; }).slice(0, 6),
      issues: issues,
      requirements_met: reqs.map(function (q) {
        return { id: q.id, requirement: q.requirement, met: q.met, credit: q.credit, explanation: q.explanation, evidence: q.evidence, hint: q.hint };
      }),
      next_steps: nextSteps,
      gates: gates,
      structural: true
    };
  }

  function getPhaseRequirements(phaseId) {
    var rules = window.CODE_RULES && window.CODE_RULES[phaseId];
    if (!rules || rules.reflection) return [];
    var list = rules.required || [];
    if (rules.kit) {
      var kit = window.RT_PHASE5_KIT;
      var bugs = kitLoaded(kit) ? kit.bugs.map(function (b) { return { id: 'bug-' + b.id, label: 'Bug fixed: ' + b.title, weight: 15, hint: b.hint }; }) : [];
      list = bugs.concat(list);
    }
    return list.map(function (r) { return { id: r.id, label: r.label, weight: r.weight, hint: r.hint }; });
  }

  // RTCodeCheck.H: the helpers bound to the most recently checked submission, plus
  // H.forModel(modelOrSource) to bind a fresh set (tests, the Phase 5 kit).
  var HELPER_NAMES = ['ev', 'opMode', 'opModes', 'isLinear', 'loopBodies', 'initBodies', 'initRegions', 'inInit', 'hardwareVars', 'motors', 'servos', 'sensors',
    'isHardwareType', 'gamepadTokens', 'callsIn', 'callsWithin', 'count', 'distinct', 'sensorDerived', 'isSensorRead', 'enumUsed', 'poses',
    'isPoseName', 'pathMethods', 'qualityComments', 'commentGroups', 'words', 'isRealWord', 'textRule', 'varType', 'receiverType',
    'isUserType', 'callAround', 'loopRegions', 'inLoopRegion', 'liveToken', 'numericArg', 'targetOf'];
  var Hpublic = {
    forModel: function (x) {
      var model = typeof x === 'string' ? window.RTJavaStructure.parse(x) : x;
      lastH = makeH(model, typeof x === 'string' ? x : (model && model.src) || '');
      return lastH;
    },
    stripCommentsAndStrings: stripCommentsAndStrings,
    NAMES: HELPER_NAMES
  };
  HELPER_NAMES.forEach(function (n) {
    Hpublic[n] = function () {
      if (!lastH) throw new Error('RTCodeCheck.H: call checkCode() or H.forModel() first');
      return lastH[n].apply(null, arguments);
    };
  });

  window.getPhaseRequirements = getPhaseRequirements;
  window.checkCode = checkCode;
  window.RTCodeCheck = {
    VERSION: VERSION,
    graderVersion: graderVersion,
    DISCLAIMER: DISCLAIMER,
    H: Hpublic,
    makeHelpers: makeH,
    stripCommentsAndStrings: stripCommentsAndStrings,
    checkCode: checkCode,
    getPhaseRequirements: getPhaseRequirements
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = window.RTCodeCheck;
})();
