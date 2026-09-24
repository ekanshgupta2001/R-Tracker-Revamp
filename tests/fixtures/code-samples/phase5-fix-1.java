// fixture: kit source with bug 1 fixed (follower.update() removed from Robot.update()); expect double-update fixed, other four broken
package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.Autonomous;
import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.hardware.DcMotorEx;
import com.qualcomm.robotcore.hardware.HardwareMap;
import com.qualcomm.robotcore.util.ElapsedTime;
import com.qualcomm.robotcore.util.Range;
import com.pedropathing.api.PoseFactory;
import com.pedropathing.follower.Follower;
import com.pedropathing.ivy.Scheduler;
import com.pedropathing.math.Pose;
import com.pedropathing.paths.Path;
import org.firstinspires.ftc.teamcode.pedro.Constants;

import static com.pedropathing.api.Paths.*;
import static com.pedropathing.ivy.Scheduler.schedule;
import static com.pedropathing.ivy.pedro.PedroCommands.follow;

// Front roller: positive power pulls a game piece in, negative spits it out
class Intake {
    enum Mode { IDLE, RUNNING }
    private final DcMotor motor;
    private Mode mode = Mode.IDLE;

    Intake(HardwareMap hw) {
        motor = hw.get(DcMotor.class, "intake");
    }

    public void run(double power) {
        motor.setPower(power);
        mode = power == 0 ? Mode.IDLE : Mode.RUNNING;
    }
}

// Linear slide, held at its target by a P controller on the encoder
class Lift {
    enum Mode { AUTO, MANUAL }
    static final double LIFT_KP = 50.0;
    private final DcMotorEx motor;
    private Mode mode = Mode.MANUAL;
    private int target = 0;

    Lift(HardwareMap hw) {
        motor = hw.get(DcMotorEx.class, "lift");
        motor.setMode(DcMotor.RunMode.STOP_AND_RESET_ENCODER);
        motor.setMode(DcMotor.RunMode.RUN_WITHOUT_ENCODER);
    }

    // Only the autonomous routine may move the lift to a preset height
    public void goTo(int ticks) {
        if (mode != Mode.AUTO) return;
        target = ticks;
    }

    public void update() {
        double error = target - motor.getCurrentPosition();
        double power = LIFT_KP * error;
        motor.setPower(Range.clip(power, -1, 1));
    }

    public int position() {
        return motor.getCurrentPosition();
    }
}

// Everything on the robot, built once from the hardware map
class Robot {
    final Follower follower;
    final Intake intake;
    final Lift lift;

    Robot(HardwareMap hw) {
        follower = Constants.create(hw);
        intake = new Intake(hw);
        lift = new Lift(hw);
    }

    // Keeps every subsystem running; call it every loop
    public void update() {
        lift.update();
    }
}

@Autonomous(name = "BuzzAuto")
public class BuzzAuto extends LinearOpMode {
    enum State { TO_SCORE, SCORE, TO_PARK, DONE }
    static final int LIFT_HIGH = 2200;

    // Inches from the bottom-left corner, heading in degrees (0 = +x, counter-clockwise)
    private final PoseFactory p = PoseFactory.degrees();
    private final Pose startPose = p.of(9, 60, 0);
    private final Pose scorePose = p.of(40, 72, 45);
    private final Pose parkPose = p.of(60, 108, 90);

    private Robot robot;
    private State state = State.TO_SCORE;
    private final ElapsedTime timer = new ElapsedTime();

    private Path toScore() {
        return line(startPose, scorePose).linear(startPose, scorePose);
    }

    private Path toPark() {
        return line(scorePose, parkPose).linear(scorePose, parkPose);
    }

    @Override
    public void runOpMode() {
        Scheduler.reset();
        robot = new Robot(hardwareMap);
        robot.follower.setPose(startPose);
        telemetry.addData("Status", "Ready");
        telemetry.update();

        waitForStart();
        schedule(follow(robot.follower, toScore()));

        while (opModeIsActive()) {
            robot.follower.update();
            Scheduler.execute();
            robot.update();

            switch (state) {
                case TO_SCORE:
                    // At the basket: raise the lift and start the scoring timer
                    if (robot.follower.isBusy()) {
                        state = State.SCORE;
                        robot.lift.goTo(LIFT_HIGH);
                        timer.reset();
                    }
                    break;
                case SCORE:
                    // Spit the piece out for 1.5 s, then drive to park
                    if (timer.seconds() < 1.5) {
                        robot.intake.run(-1.0);
                    } else {
                        robot.intake.run(0);
                        schedule(follow(robot.follower, toPark()));
                        state = State.TO_PARK;
                    }
                    break;
                case TO_PARK:
                    if (!robot.follower.isBusy()) state = State.DONE;
                    break;
                case DONE:
                    break;
            }

            telemetry.addData("State", state);
            telemetry.addData("Pose", robot.follower.pose());
            telemetry.addData("Lift", robot.lift.position());
            telemetry.addData("Busy", robot.follower.isBusy());
        }
    }
}
