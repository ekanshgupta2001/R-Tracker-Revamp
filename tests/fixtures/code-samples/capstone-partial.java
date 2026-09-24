// fixture: capstone honest half attempt — subsystems, a Robot, the follower and a scheduled routine through three poses, but no sensor decision, no filtering, no fallback, no alliance handling and thin telemetry; expected: 40-74, no CRITICAL, at least 2 next steps
package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.Autonomous;
import com.qualcomm.robotcore.eventloop.opmode.OpMode;
import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.hardware.HardwareMap;
import com.qualcomm.robotcore.hardware.Servo;
import com.pedropathing.api.PoseFactory;
import com.pedropathing.follower.Follower;
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
    public void stow() { servo.setPosition(0.0); }
}

class Robot {
    public Intake intake;
    public Scorer scorer;
    public Robot(HardwareMap hardwareMap) {
        intake = new Intake(hardwareMap);
        scorer = new Scorer(hardwareMap);
    }
}

@Autonomous(name = "FirstCapstone")
public class FirstCapstone extends OpMode {
    private Follower follower;
    private Robot robot;
    private final PoseFactory p = PoseFactory.degrees();
    private final Pose start = p.of(9, 60, 0);
    private final Pose score = p.of(36, 72, 0);
    private final Pose park = p.of(60, 96, 90);

    private Path toScore() { return line(start, score).linear(start, score); }
    private Path toPark() { return line(score, park).constant(park); }

    @Override
    public void init() {
        Scheduler.reset();
        follower = Constants.create(hardwareMap);
        robot = new Robot(hardwareMap);
        follower.setPose(start);
    }

    @Override
    public void start() {
        schedule(sequential(
            follow(follower, toScore()),
            instant(() -> robot.scorer.score()),
            waitMs(1000),
            instant(() -> robot.scorer.stow()),
            follow(follower, toPark())
        ));
    }

    @Override
    public void loop() {
        follower.update();
        Scheduler.execute();
        telemetry.addData("Pose", follower.pose());
    }
}
