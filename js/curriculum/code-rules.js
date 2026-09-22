// ── R-Tracker v2 — structural code rules per curriculum phase ────────────────
// Consumed by js/code-check.js. Pure data: regexes and hint text. Nothing here
// (or anywhere) executes student code — these are string patterns only.
//
// Rule shape:
//   required: [{ id, label, pattern, min = 1, weight, hint, also?, raw? }]
//     pattern — RegExp searched in the code with comments/strings stripped (raw: true → original text)
//     min     — minimum number of matches
//     also    — second RegExp that must also match for the rule to count
//   forbidden: [{ id, label, pattern | test(stripped, raw), severity, penalty, hint, raw? }]
//     severity CRITICAL fails the check outright; WARNING/SUGGESTION only cost points
//   passThreshold — score needed to auto-verify (default 75)
//   reflection: true — no automatic check; the submission is kept for a mentor
//
// Exposes: window.CODE_RULES

(function () {
  'use strict';

  var SENSOR_TYPES = /(ColorSensor|NormalizedColorSensor|RevColorSensorV3|DistanceSensor|TouchSensor|IMU|BNO055IMU|Rev2mDistanceSensor)\b/;
  var SENSOR_READS = /\.(red|green|blue|alpha|argb|getDistance|isPressed|getNormalizedColors|getAngularOrientation|getRobotYawPitchRollAngles|getVoltage|getState)\s*\(/;
  var SUBSYSTEM_NAME = '(Drive|Drivetrain|Chassis|Mecanum|Intake|Lift|Arm|Claw|Shooter|Slide|Wrist|Gripper|Launcher|Elevator|Turret|Outtake)';
  var MEANINGFUL_COMMENT = /\/\/[^\n]{12,}|\/\*[\s\S]{12,}?\*\//;
  var DOUBLE_UPDATE = /follower\.update\s*\(\s*\)[\s\S]{0,300}?follower\.update\s*\(\s*\)/;
  // Pedro Pathing 3 replaced the 2.x path API; Ivy replaced FTCLib-style commands. Both old
  // shapes are flagged so a student migrating old code gets told what changed.
  var LEGACY_PEDRO = /pathBuilder\s*\(|setLinearHeadingInterpolation|setConstantHeadingInterpolation|setTangentHeadingInterpolation|setStartingPose\s*\(|followPath\s*\(|new\s+BezierLine|new\s+Point\s*\(/;
  var LEGACY_COMMANDS = /SequentialCommandGroup|ParallelCommandGroup|extends\s+CommandBase\b|extends\s+SubsystemBase\b|CommandScheduler/;
  var HEADING_INTERP = /\.(linear|constant|tangent|facingPoint)\s*\(/;
  var POSES = /\.of\s*\(\s*-?[\d.]|new\s+Pose\s*\(/;
  var PEDRO_FOLLOWER = /\bFollower\b|Constants\.create\s*\(|\bfollow\s*\(\s*[\w.]*[fF]ollower\b/;

  // Braces must balance in the stripped code — the cheapest "does it even compile" signal.
  function bracesBalanced(stripped) {
    var depth = 0;
    for (var i = 0; i < stripped.length; i++) {
      var ch = stripped[i];
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth < 0) return false; }
    }
    return depth === 0;
  }

  // Body of the first class that extends (Linear)OpMode, or '' if none.
  function opModeBody(stripped) {
    var m = /class\s+\w+\s+extends\s+(LinearOpMode|OpMode)\b/.exec(stripped);
    if (!m) return '';
    var start = stripped.indexOf('{', m.index);
    if (start === -1) return '';
    var depth = 0;
    for (var i = start; i < stripped.length; i++) {
      if (stripped[i] === '{') depth++;
      else if (stripped[i] === '}') { depth--; if (depth === 0) return stripped.slice(start, i + 1); }
    }
    return stripped.slice(start);
  }

  var COMMON_FORBIDDEN = [
    { id: 'braces', label: 'Braces balance', test: function (s) { return !bracesBalanced(s); }, severity: 'CRITICAL', penalty: 25,
      hint: 'Your braces do not balance — this would not compile. Check every { has a matching }.' },
    { id: 'system-exit', label: 'No System.exit()', pattern: /System\.exit\s*\(/, severity: 'CRITICAL', penalty: 25,
      hint: 'Never call System.exit() in an OpMode — it kills the Robot Controller app.' },
    { id: 'while-true', label: 'No while(true)', pattern: /while\s*\(\s*true\s*\)/, severity: 'WARNING', penalty: 10,
      hint: 'Use while (opModeIsActive()) so the loop stops when the driver presses Stop.' }
  ];

  var RULES = {
    phase1: {
      passThreshold: 75,
      required: [
        { id: 'opmode', label: 'Extends LinearOpMode or OpMode', pattern: /extends\s+(LinearOpMode|OpMode)\b/, weight: 5, hint: 'Your class must extend LinearOpMode (or OpMode).' },
        { id: 'motors', label: 'Initializes at least 2 motors via hardwareMap', pattern: /hardwareMap\.(get\s*\(\s*DcMotor(Ex)?\.class|dcMotor\.get)/, min: 2, weight: 15, hint: 'Get at least two DcMotors from hardwareMap, e.g. hardwareMap.get(DcMotor.class, "left_drive").' },
        { id: 'servo', label: 'Initializes at least 1 servo via hardwareMap', pattern: /hardwareMap\.(get\s*\(\s*(Servo|CRServo)\.class|servo\.get|crservo\.get)/, weight: 10, hint: 'Get a Servo (or CRServo) from hardwareMap for your mechanism.' },
        { id: 'wait-for-start', label: 'Waits for START before the loop', pattern: /waitForStart\s*\(\s*\)|void\s+loop\s*\(/, weight: 5, hint: 'Call waitForStart() after initialization (LinearOpMode) or use the OpMode loop() structure.' },
        { id: 'loop', label: 'Runs a control loop while the OpMode is active', pattern: /opModeIsActive\s*\(\s*\)|void\s+loop\s*\(/, weight: 5, hint: 'Wrap your driving code in while (opModeIsActive()) { … }.' },
        { id: 'joystick', label: 'Reads a gamepad joystick', pattern: /gamepad[12]\.(left|right)_stick_[xy]\b/, weight: 15, hint: 'Read gamepad1.left_stick_y / left_stick_x / right_stick_x for driving.' },
        { id: 'y-invert', label: 'Inverts the joystick Y axis', pattern: /-\s*gamepad[12]\.(left|right)_stick_y\b|gamepad[12]\.(left|right)_stick_y\s*\*\s*-\s*1/, weight: 10, hint: 'Pushing the stick forward gives a negative Y — use -gamepad1.left_stick_y.' },
        { id: 'set-power', label: 'Sets motor power', pattern: /\.setPower\s*\(/, min: 2, weight: 10, hint: 'Send the joystick values to the motors with setPower().' },
        { id: 'mechanism', label: 'Controls a mechanism with a button or trigger', pattern: /gamepad[12]\.(a|b|x|y|left_bumper|right_bumper|left_trigger|right_trigger|dpad_up|dpad_down|dpad_left|dpad_right)\b/, weight: 15, also: /\.set(Power|Position)\s*\(/, hint: 'Use a button or trigger (gamepad1.a, right_trigger, …) to move a servo or a mechanism motor.' },
        { id: 'telemetry', label: 'Shows at least 2 telemetry values', pattern: /telemetry\.addData\s*\(/, min: 2, weight: 10, also: /telemetry\.update\s*\(\s*\)/, hint: 'Add at least two telemetry.addData(...) lines and call telemetry.update() each loop.' },
        { id: 'comments', label: 'Has comments that explain why', pattern: MEANINGFUL_COMMENT, min: 3, weight: 5, raw: true, hint: 'Add a few comments that explain why the code does what it does, not just what.' }
      ],
      forbidden: COMMON_FORBIDDEN.concat([
        { id: 'sleep-in-loop', label: 'No sleep() inside the TeleOp loop', pattern: /opModeIsActive\s*\(\s*\)\s*\)\s*\{[\s\S]{0,600}?\bsleep\s*\(/, severity: 'WARNING', penalty: 10, hint: 'sleep() inside the TeleOp loop freezes every control — avoid it in TeleOp.' }
      ])
    },

    phase2: {
      passThreshold: 75,
      required: [
        { id: 'classes', label: 'At least 3 classes (Robot + subsystems)', pattern: /\bclass\s+\w+/, min: 3, weight: 10, hint: 'Split the code into a Robot class and one class per subsystem.' },
        { id: 'drivetrain-class', label: 'A drivetrain subsystem class', pattern: new RegExp('class\\s+\\w*(Drive|Drivetrain|Chassis|Mecanum)\\w*\\b', 'i'), weight: 15, hint: 'Create a Drivetrain class that owns the drive motors.' },
        { id: 'mechanism-class', label: 'At least one mechanism subsystem class', pattern: new RegExp('class\\s+\\w*(Intake|Lift|Arm|Claw|Shooter|Slide|Wrist|Gripper|Launcher|Elevator|Turret|Outtake)\\w*\\b', 'i'), weight: 10, hint: 'Create a class for one mechanism (Intake, Lift, Claw, …).' },
        { id: 'robot-class', label: 'A Robot class that creates the subsystems', pattern: /class\s+Robot\b/, weight: 15, also: new RegExp('new\\s+\\w*' + SUBSYSTEM_NAME + '\\w*\\s*\\(', 'i'), hint: 'A Robot class should construct every subsystem in one place.' },
        { id: 'private-fields', label: 'Hardware fields are private', pattern: /private\s+(final\s+)?(DcMotor|DcMotorEx|Servo|CRServo)\b/, weight: 15, hint: 'Declare motor and servo fields as private inside the subsystem.' },
        { id: 'public-methods', label: 'Subsystems expose public methods', pattern: /public\s+(void|double|boolean|int|float|String|\w+)\s+\w+\s*\(/, min: 3, weight: 10, hint: 'Give each subsystem public methods like drive(), stop(), open(), close().' },
        { id: 'enum', label: 'Uses an enum for state', pattern: /\benum\s+\w+/, weight: 10, hint: 'Replace magic numbers/strings with an enum, e.g. enum ClawState { OPEN, CLOSED }.' },
        { id: 'hardwaremap-param', label: 'Subsystems receive the HardwareMap', pattern: /\(\s*HardwareMap\s+\w+/, weight: 5, hint: 'Pass hardwareMap into each subsystem constructor.' },
        { id: 'opmode', label: 'A TeleOp OpMode uses the Robot class', pattern: /extends\s+(LinearOpMode|OpMode)\b/, weight: 5, also: /new\s+Robot\s*\(/, hint: 'The OpMode should create a Robot and call its methods.' },
        { id: 'comments', label: 'Has explanatory comments', pattern: MEANINGFUL_COMMENT, min: 2, weight: 5, raw: true, hint: 'Comment the purpose of each class.' }
      ],
      forbidden: COMMON_FORBIDDEN.concat([
        { id: 'hardware-in-opmode', label: 'No direct hardware calls in the OpMode', test: function (s) { var b = opModeBody(s); return /hardwareMap\.get\s*\(|\.setPower\s*\(|\.setPosition\s*\(/.test(b); }, severity: 'WARNING', penalty: 20, hint: 'The main OpMode should only talk to the Robot/subsystem classes — no hardwareMap.get() or setPower() in it.' }
      ])
    },

    phase3: {
      passThreshold: 75,
      required: [
        { id: 'autonomous', label: 'Autonomous LinearOpMode with waitForStart()', pattern: /@Autonomous/, weight: 5, also: /waitForStart\s*\(\s*\)/, hint: 'Annotate with @Autonomous and call waitForStart().' },
        { id: 'sensor-type', label: 'Declares a sensor (color, distance, touch or IMU)', pattern: SENSOR_TYPES, weight: 15, hint: 'Get a ColorSensor, DistanceSensor, TouchSensor or IMU from hardwareMap.' },
        { id: 'sensor-read', label: 'Reads the sensor', pattern: SENSOR_READS, weight: 15, hint: 'Read a value, e.g. colorSensor.red() or distance.getDistance(DistanceUnit.CM).' },
        { id: 'decision', label: 'Makes a decision from a sensor threshold', pattern: /if\s*\([^)]*(<=|>=|<|>)[^)]*\)/, weight: 15, hint: 'Compare the reading to a threshold in an if/else to choose what to do.' },
        { id: 'state-machine', label: 'Sequential actions via an enum / switch state machine', pattern: /\benum\s+\w+|switch\s*\(|case\s+\w+\s*:/, weight: 15, hint: 'Structure the autonomous as states (enum + switch) rather than one long block.' },
        { id: 'timing', label: 'Timing or state-based transitions', pattern: /ElapsedTime|\.seconds\s*\(\s*\)|\.milliseconds\s*\(\s*\)|isBusy\s*\(\s*\)|state\s*=\s*\w+/, weight: 10, hint: 'Use an ElapsedTime timer or a state variable to move between steps.' },
        { id: 'subsystems', label: 'Uses subsystem classes from Phase 2', pattern: new RegExp('new\\s+\\w*' + SUBSYSTEM_NAME + '\\w*\\s*\\(|new\\s+Robot\\s*\\(', 'i'), weight: 10, hint: 'Reuse your Robot / subsystem classes instead of raw motor calls.' },
        { id: 'filtering', label: 'Filters sensor readings', pattern: /average|filter|samples|readings|consecutive|smooth/i, weight: 5, hint: 'Do not act on one reading — average a few or require several in a row.' },
        { id: 'stop', label: 'Stops motors when finished', pattern: /\.setPower\s*\(\s*0(\.0)?\s*\)|\.stop\s*\(\s*\)/, weight: 5, hint: 'Set every motor to 0 (or call stop()) at the end.' },
        { id: 'telemetry', label: 'Telemetry shows sensor values', pattern: /telemetry\.addData\s*\(/, weight: 5, hint: 'Show the sensor value on telemetry so you can tune thresholds.' }
      ],
      forbidden: COMMON_FORBIDDEN.concat([
        { id: 'long-sleep', label: 'No long time-based sleeps for driving', pattern: /\.setPower\s*\([^)]*\)\s*;\s*sleep\s*\(\s*\d{3,}\s*\)/, severity: 'WARNING', penalty: 10, hint: 'setPower(...); sleep(...) is open-loop driving — use sensors or encoders to decide when to stop.' }
      ])
    },

    phase4: {
      passThreshold: 75,
      required: [
        { id: 'encoders', label: 'Encoder-based movement', pattern: /getCurrentPosition\s*\(|RUN_TO_POSITION|RUN_USING_ENCODER|setTargetPosition|STOP_AND_RESET_ENCODER|Encoder\b/, weight: 15, hint: 'Use encoders (getCurrentPosition / RUN_TO_POSITION) or odometry instead of time.' },
        { id: 'pid', label: 'PID / PIDF control', pattern: /\bk[PIDF]\b|PIDController|PIDFCoefficients|PIDCoefficients|PIDFController/, weight: 20, also: /error/, hint: 'Implement a PID (kP, kI, kD, optionally kF) that acts on error = target − current.' },
        { id: 'pedro', label: 'Pedro Pathing follower', pattern: PEDRO_FOLLOWER, weight: 15, hint: 'Create the Follower with Constants.create(hardwareMap) and follow paths with follow(follower, path).' },
        { id: 'paths', label: 'Paths built with line() / curve()', pattern: /\b(line|curve|through)\s*\(\s*\w/, weight: 10, hint: 'Build each path with line(start, end) or curve(start, control…, end) from Paths.' },
        { id: 'waypoints', label: 'At least 3 poses (p.of / new Pose)', pattern: POSES, min: 3, weight: 10, hint: 'Define at least three poses with a PoseFactory, e.g. p.of(24, 24, 0).' },
        { id: 'interpolation', label: 'Heading interpolation chained on the path', pattern: HEADING_INTERP, weight: 5, hint: 'Chain .linear(start, end), .constant(pose) or .tangent() onto each path.' },
        { id: 'pose-nav', label: 'Pose-based navigation (x, y, heading)', pattern: /PoseFactory|\.pose\s*\(|setPose\s*\(|new\s+Pose\s*\(|heading/i, weight: 5, hint: 'Navigate with poses (x, y, heading), not motor timings.' },
        { id: 'follower-update', label: 'follower.update() in the loop', pattern: /follower\.update\s*\(\s*\)/, weight: 5, hint: 'Call follower.update() once every loop iteration.' },
        { id: 'scheduler', label: 'Scheduler.execute() in the loop', pattern: /Scheduler\.execute\s*\(/, weight: 5, hint: 'Call Scheduler.execute() once per loop so the follow command advances.' },
        { id: 'telemetry', label: 'Telemetry for tuning', pattern: /telemetry\.addData\s*\(/, min: 2, weight: 5, hint: 'Show position/heading/error on telemetry while tuning.' },
        { id: 'comments', label: 'Has explanatory comments', pattern: MEANINGFUL_COMMENT, min: 2, weight: 5, raw: true, hint: 'Note your tuned constants and why.' }
      ],
      forbidden: COMMON_FORBIDDEN.concat([
        { id: 'time-based', label: 'No time-based driving', pattern: /\.setPower\s*\([^)]*\)\s*;\s*sleep\s*\(\s*\d{3,}\s*\)/, severity: 'WARNING', penalty: 15, hint: 'setPower(...); sleep(...) is open-loop — Phase 4 is about closed-loop movement.' },
        { id: 'double-update', label: 'follower.update() called once per loop', pattern: DOUBLE_UPDATE, severity: 'WARNING', penalty: 10, hint: 'Call follower.update() exactly once per loop iteration.' },
        { id: 'legacy-api', label: 'Pedro 2 API', pattern: LEGACY_PEDRO, severity: 'WARNING', penalty: 10, hint: 'This is the Pedro 2 API. Pedro 3 builds paths with line()/curve() + .linear() and follows them with follow(follower, path).' }
      ])
    },

    phase5: {
      passThreshold: 75,
      required: [
        { id: 'bug-notes', label: 'At least 3 documented bug fixes (// BUG … / // FIX …)', pattern: /\/\/\s*(BUG|FIX|FIXED)\b[^\n]{6,}|\/\*\s*(BUG|FIX|FIXED)\b[\s\S]{6,}?\*\//i, min: 3, weight: 30, raw: true, hint: 'Mark each fix with a comment starting // BUG: (or // FIX:) that says what was wrong.' },
        { id: 'bug-explained', label: 'Bug notes explain why (because / was / caused …)', pattern: /\/\/\s*(BUG|FIX|FIXED)\b[^\n]*\b(because|was|caused|wrong|instead|should|never|always|missing)\b/i, min: 2, weight: 15, raw: true, hint: 'Say why each bug happened, e.g. "// BUG: heading drifted because update() ran twice".' },
        { id: 'telemetry', label: 'Telemetry used for debugging', pattern: /telemetry\.addData\s*\(/, min: 2, weight: 15, also: /telemetry\.update\s*\(\s*\)/, hint: 'Add telemetry for the values you used to isolate each bug.' },
        { id: 'loop', label: 'A proper OpMode loop', pattern: /opModeIsActive\s*\(\s*\)|void\s+loop\s*\(/, weight: 10, hint: 'The fixed code still needs a while (opModeIsActive()) loop (or loop()).' },
        { id: 'structure', label: 'Keeps the subsystem structure', pattern: /\bclass\s+\w+/, min: 2, weight: 10, hint: 'Keep the subsystem classes intact while fixing bugs.' },
        { id: 'systematic', label: 'Notes describe the systematic approach', pattern: /(hypothes|observ|isolat|verif|reproduc|telemetry showed|test)/i, weight: 10, raw: true, hint: 'Describe how you narrowed each bug down (observe → hypothesize → test → fix → verify).' },
        { id: 'comments', label: 'Explanatory comments', pattern: MEANINGFUL_COMMENT, min: 3, weight: 10, raw: true, hint: 'Comments should explain the reasoning, not restate the code.' }
      ],
      forbidden: COMMON_FORBIDDEN.concat([
        { id: 'double-update', label: 'Bug pattern: double update()', pattern: DOUBLE_UPDATE, severity: 'WARNING', penalty: 15, hint: 'follower.update() is still called twice in one loop — the "double update" bug is not fixed.' },
        { id: 'empty-catch', label: 'No empty catch blocks', pattern: /catch\s*\([^)]*\)\s*\{\s*\}/, severity: 'WARNING', penalty: 10, hint: 'An empty catch hides errors — at least log them to telemetry.' },
        { id: 'todo', label: 'No leftover TODOs', pattern: /\bTODO\b/, severity: 'SUGGESTION', penalty: 3, raw: true, hint: 'Resolve or remove TODO markers before submitting.' }
      ])
    },

    advanced_command: {
      passThreshold: 75,
      required: [
        { id: 'scheduler', label: 'Scheduler.reset() in init and Scheduler.execute() in the loop', pattern: /Scheduler\.execute\s*\(/, weight: 20, also: /Scheduler\.reset\s*\(/, hint: 'Call Scheduler.reset() at the top of the OpMode and Scheduler.execute() once per loop.' },
        { id: 'commands', label: 'Commands built with Command.build() or implements Command', pattern: /Command\.build\s*\(|implements\s+Command\b/, weight: 15, hint: 'Write commands with Command.build().setStart(...).setExecute(...).setDone(...).setEnd(...) (or a class that implements Command).' },
        { id: 'follow-path', label: 'Paths followed with follow(follower, path)', pattern: /\bfollow\s*\(\s*[\w.]*[fF]ollower\b/, weight: 15, hint: 'Use follow(follower, path) from PedroCommands instead of a hand-written FollowPath command.' },
        { id: 'run-intake', label: 'A runIntake command with a duration', pattern: /[iI]ntake/, weight: 10, also: /waitMs\s*\(|ElapsedTime|seconds\s*\(|milliseconds\s*\(|duration|\.until\s*\(/i, hint: 'runIntake should run the intake for a given number of seconds and stop it in setEnd().' },
        { id: 'done', label: 'Commands say when they are done (setDone / done())', pattern: /setDone\s*\(|boolean\s+done\s*\(/, weight: 10, hint: 'Each command needs setDone(() -> …) (or done()) that returns true when it has finished.' },
        { id: 'requiring', label: 'Commands declare requirements with .requiring()', pattern: /\.requiring\s*\(|requirements\s*\(\s*\)/, weight: 10, hint: 'Add .requiring(intake) (or the motor) so two commands never fight over one mechanism.' },
        { id: 'sequential', label: 'A sequential() composition replaces the state machine', pattern: /\bsequential\s*\(|\.then\s*\(/, weight: 10, hint: 'Compose follow(...) and runIntake(...) in one sequential(...) call.' },
        { id: 'comparison', label: 'A note comparing both versions', pattern: /(easier|readab|modif|compar|maintain)/i, weight: 10, raw: true, hint: 'Add a comment comparing the command-based and original versions: which is easier to read and modify?' }
      ],
      forbidden: COMMON_FORBIDDEN.concat([
        { id: 'legacy-commands', label: 'FTCLib command API', pattern: LEGACY_COMMANDS, severity: 'WARNING', penalty: 10, hint: 'That is the FTCLib API; this module uses Ivy: Command.build(), sequential(), Scheduler.' }
      ])
    },

    advanced_strategy: {
      reflection: true,
      note: 'The strategy deliverable is a written analysis (expected value, tiers, match log, strategy document) — it is kept for your mentor rather than pattern-checked.'
    },

    capstone: {
      passThreshold: 75,
      required: [
        { id: 'classes', label: 'At least 4 classes (Robot + subsystems + OpMode)', pattern: /\bclass\s+\w+/, min: 4, weight: 10, hint: 'Wrap every mechanism in its own subsystem class plus a Robot class.' },
        { id: 'private-fields', label: 'Private hardware fields', pattern: /private\s+(final\s+)?(DcMotor|DcMotorEx|Servo|CRServo)\b/, min: 2, weight: 10, hint: 'Keep motors and servos private inside subsystems.' },
        { id: 'robot-class', label: 'A Robot class', pattern: /class\s+Robot\b/, weight: 5, hint: 'A Robot class should initialize all subsystems.' },
        { id: 'enum', label: 'Enum-based state machines', pattern: /\benum\s+\w+/, weight: 5, hint: 'Use enums for subsystem and autonomous states.' },
        { id: 'sensor-decision', label: 'A sensor-driven decision', pattern: SENSOR_TYPES, weight: 10, also: /if\s*\([^)]*(<=|>=|<|>)[^)]*\)/, hint: 'Read a sensor and branch on it (colour sorting, distance stop, …).' },
        { id: 'filtering', label: 'Sensor filtering', pattern: /average|filter|samples|readings|consecutive/i, weight: 5, hint: 'No single-reading decisions — average or require consecutive readings.' },
        { id: 'pedro', label: 'Pedro Pathing follower', pattern: PEDRO_FOLLOWER, weight: 5, hint: 'Drive with Pedro Pathing\'s Follower: Constants.create(hardwareMap) and follow(follower, path).' },
        { id: 'waypoints', label: 'At least 4 distinct poses', pattern: POSES, min: 4, weight: 10, hint: 'Define at least four poses with a PoseFactory (p.of(x, y, heading)).' },
        { id: 'heading-interp', label: 'Heading interpolation on paths', pattern: HEADING_INTERP, weight: 5, hint: 'Chain .linear(a, b), .constant(pose) or .tangent() onto every path.' },
        { id: 'path-methods', label: 'Each path returned by its own method', pattern: /\bPath\s+\w+\s*\([^)]*\)\s*\{/, weight: 5, hint: 'Write one method per path that returns a Path, e.g. private Path toScore() { return line(a, b).linear(a, b); }' },
        { id: 'follower-update', label: 'follower.update() once per loop', pattern: /follower\.update\s*\(\s*\)/, weight: 5, hint: 'Call follower.update() every loop.' },
        { id: 'scheduler', label: 'Scheduler.execute() once per loop', pattern: /Scheduler\.execute\s*\(/, weight: 5, hint: 'Call Scheduler.execute() every loop so the routine advances.' },
        { id: 'telemetry', label: 'Telemetry: state, sensors, powers, loop time', pattern: /telemetry\.addData\s*\(/, min: 4, weight: 5, hint: 'Show current state, sensor values, motor powers and loop time.' },
        { id: 'fallback', label: 'Timer-based fallback / emergency park', pattern: /ElapsedTime|timeout|fallback|park/i, weight: 10, hint: 'Add a timer fallback if a path takes too long and an emergency park near the end.' },
        { id: 'alliance', label: 'Alliance mirroring / selection', pattern: /alliance|mirror|isRed|isBlue/i, weight: 5, hint: 'Support both alliances from one codebase (selection in init, mirrored poses).' }
      ],
      forbidden: COMMON_FORBIDDEN.concat([
        { id: 'double-update', label: 'follower.update() once per loop', pattern: DOUBLE_UPDATE, severity: 'WARNING', penalty: 10, hint: 'follower.update() must run exactly once per loop.' },
        { id: 'time-based', label: 'No time-based driving', pattern: /\.setPower\s*\([^)]*\)\s*;\s*sleep\s*\(\s*\d{3,}\s*\)/, severity: 'WARNING', penalty: 10, hint: 'No time-based driving in a competition autonomous.' },
        { id: 'legacy-api', label: 'Pedro 2 API', pattern: LEGACY_PEDRO, severity: 'WARNING', penalty: 10, hint: 'This is the Pedro 2 API. Pedro 3 builds paths with line()/curve() + .linear() and follows them with follow(follower, path).' }
      ])
    }
  };

  window.CODE_RULES = RULES;
  window.CODE_RULES_VERSION = 'rules-2';
})();
