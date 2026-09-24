// fixture: capstone dead code — subsystems and a Robot exist, but the routine, the poses and the alliance handling live in methods nothing calls and the loop body sits under if (false); expected: fails, issues name buildRoutine(), score <= 60
package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.Autonomous;
import com.qualcomm.robotcore.eventloop.opmode.OpMode;
import com.qualcomm.robotcore.hardware.ColorSensor;
import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.hardware.HardwareMap;
import com.qualcomm.robotcore.hardware.Servo;
import com.pedropathing.api.PoseFactory;
import com.pedropathing.follower.Follower;
import com.pedropathing.ivy.Command;
import com.pedropathing.ivy.Scheduler;
import com.pedropathing.math.Pose;
import com.pedropathing.paths.Path;
import org.firstinspires.ftc.teamcode.pedro.Constants;

import static com.pedropathing.api.Paths.*;
import static com.pedropathing.ivy.Scheduler.schedule;
import static com.pedropathing.ivy.commands.Commands.*;
import static com.pedropathing.ivy.groups.Groups.*;
import static com.pedropathing.ivy.pedro.PedroCommands.follow;

class Intake {
    private DcMotor motor;
    public Intake(HardwareMap hardwareMap) { motor = hardwareMap.get(DcMotor.class, "intake"); }
    public void run() { motor.setPower(1.0); }
    public void stop() { motor.setPower(0); }
}

class Scorer {
    private Servo servo;
    public Scorer(HardwareMap hardwareMap) { servo = hardwareMap.get(Servo.class, "scorer"); }
    public void score() { servo.setPosition(1.0); }
}

class Sensors {
    private ColorSensor color;
    public Sensors(HardwareMap hardwareMap) { color = hardwareMap.get(ColorSensor.class, "color"); }
    public boolean seesRed() { return color.red() > color.blue() + 40; }
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

@Autonomous(name = "DeadCapstone")
public class DeadCapstone extends OpMode {
    private Follower follower;
    private Robot robot;
    private PoseFactory p = PoseFactory.degrees();
    private Pose start, sample, score, park;

    private void buildPoses() {
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
            instant(() -> { if (robot.sensors.seesRed()) robot.intake.run(); }),
            race(follow(follower, toScore()), waitMs(6000)),
            instant(() -> robot.scorer.score()),
            race(follow(follower, toPark()), waitMs(6000))
        );
    }

    @Override
    public void init() {
        robot = new Robot(hardwareMap);
    }

    @Override
    public void loop() {
        if (false) {
            follower.update();
            Scheduler.execute();
        }
        telemetry.addData("Status", "idle");
    }
}
