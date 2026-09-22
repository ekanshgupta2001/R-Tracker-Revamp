package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.Autonomous;
import com.qualcomm.robotcore.eventloop.opmode.OpMode;
import com.qualcomm.robotcore.hardware.ColorSensor;
import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.hardware.DistanceSensor;
import com.qualcomm.robotcore.hardware.HardwareMap;
import com.qualcomm.robotcore.hardware.Servo;
import com.qualcomm.robotcore.util.ElapsedTime;
import com.pedropathing.api.PoseFactory;
import com.pedropathing.follower.Follower;
import com.pedropathing.ivy.Command;
import com.pedropathing.ivy.Scheduler;
import com.pedropathing.math.Pose;
import com.pedropathing.paths.Path;
import org.firstinspires.ftc.robotcore.external.navigation.DistanceUnit;
import org.firstinspires.ftc.teamcode.pedro.Constants;

import static com.pedropathing.api.Paths.*;
import static com.pedropathing.ivy.Scheduler.schedule;
import static com.pedropathing.ivy.commands.Commands.*;
import static com.pedropathing.ivy.groups.Groups.*;
import static com.pedropathing.ivy.pedro.PedroCommands.follow;

class Intake {
    public enum State { IDLE, RUNNING, REVERSED }
    private DcMotor motor;
    private State state = State.IDLE;
    public Intake(HardwareMap hardwareMap) { motor = hardwareMap.get(DcMotor.class, "intake"); }
    public void run() { state = State.RUNNING; motor.setPower(1.0); }
    public void stop() { state = State.IDLE; motor.setPower(0); }
    public State getState() { return state; }
}

class Scorer {
    public enum State { STOWED, SCORING }
    private Servo servo;
    private State state = State.STOWED;
    public Scorer(HardwareMap hardwareMap) { servo = hardwareMap.get(Servo.class, "scorer"); }
    public void score() { state = State.SCORING; servo.setPosition(1.0); }
    public void stow() { state = State.STOWED; servo.setPosition(0.0); }
}

class Sensors {
    private ColorSensor color;
    private DistanceSensor distance;
    public Sensors(HardwareMap hardwareMap) {
        color = hardwareMap.get(ColorSensor.class, "color");
        distance = hardwareMap.get(DistanceSensor.class, "distance");
    }
    // Average several readings — a single reading is never trusted
    public double filteredDistance() {
        double sum = 0;
        for (int i = 0; i < 5; i++) sum += distance.getDistance(DistanceUnit.CM);
        return sum / 5.0;
    }
    public boolean seesRed() {
        int red = color.red();
        if (red > color.blue() + 40) return true;
        return false;
    }
}

class Robot {
    public Intake intake;
    public Scorer scorer;
    public Sensors sensors;
    public Robot(HardwareMap hardwareMap) {
        intake = new Intake(hardwareMap);
        scorer = new Scorer(hardwareMap);
        sensors = new Sensors(hardwareMap);
    }
}

@Autonomous(name = "CapstoneAuto")
public class CapstoneAuto extends OpMode {
    private Follower follower;
    private Robot robot;
    private Command routine;
    private boolean isRed = true;                       // alliance chosen in init_loop with the gamepad
    private boolean parking = false;
    private final ElapsedTime matchTimer = new ElapsedTime();
    private PoseFactory p = PoseFactory.degrees();
    private Pose start, sample, score, park;

    // Poses are written for the red side; the blue side mirrors the factory across the field centre
    private void buildPoses() {
        if (!isRed) p = p.mirrorY(70.75);
        start = p.of(9, 60, 0);
        sample = p.of(48, 36, -45);
        score = p.of(36, 72, 0);
        park = p.of(60, 96, 90);
    }

    private Path toSample() { return line(start, sample).linear(start, sample); }
    private Path toScore() { return line(sample, score).linear(sample, score); }
    private Path toPark() { return line(score, park).constant(park); }

    // One sequential routine; race() against waitMs() is the timeout fallback for every path
    private Command buildRoutine() {
        return sequential(
            race(follow(follower, toSample()), waitMs(6000)),
            // Sensor-driven decision on a filtered reading: only intake when the sample is ours and close
            instant(() -> {
                if (robot.sensors.seesRed() && robot.sensors.filteredDistance() < 15) robot.intake.run();
            }),
            race(follow(follower, toScore()), waitMs(6000)),
            instant(() -> { robot.intake.stop(); robot.scorer.score(); }),
            waitMs(1500),
            instant(() -> robot.scorer.stow()),
            race(follow(follower, toPark()), waitMs(6000))
        );
    }

    @Override
    public void init() {
        Scheduler.reset();
        follower = Constants.create(hardwareMap);
        robot = new Robot(hardwareMap);
    }

    @Override
    public void init_loop() {
        if (gamepad1.x) isRed = false;
        if (gamepad1.b) isRed = true;
        telemetry.addData("Alliance", isRed ? "RED" : "BLUE");
    }

    @Override
    public void start() {
        buildPoses();
        follower.setPose(start);
        routine = buildRoutine();
        schedule(routine);
        matchTimer.reset();
    }

    @Override
    public void loop() {
        double loopStart = getRuntime();
        follower.update();
        Scheduler.execute();
        // Emergency park: if fewer than 3 seconds remain, abandon the routine and park
        if (matchTimer.seconds() > 27 && !parking) {
            routine.cancel();
            schedule(follow(follower, toPark()));
            parking = true;
        }
        telemetry.addData("Mode", follower.mode());
        telemetry.addData("Distance", robot.sensors.filteredDistance());
        telemetry.addData("Intake", robot.intake.getState());
        telemetry.addData("Pose", follower.pose());
        telemetry.addData("Loop ms", (getRuntime() - loopStart) * 1000);
    }
}
