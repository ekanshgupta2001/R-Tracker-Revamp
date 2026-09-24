// fixture: the fully fixed kit with robot->bot, state->phase, timer->clock renamed and the five BUG notes; expect all bug checks fixed and a pass with at most a WARNING kit-similarity gate
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
    // BUG: kP was 50, a gain so large that every error saturated the motor at full power, which made the lift oscillate; 0.01 is a safe start
    static final double LIFT_KP = 0.01;
    private final DcMotorEx motor;
    // BUG: mode started as MANUAL and nothing set it to AUTO, so the guard in goTo() made it return silently because it never passed
    private Mode mode = Mode.AUTO;
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

// Everything on the bot, built once from the hardware map
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
    // BUG: the follower was updated twice per loop, here and in the OpMode, because both called follower.update() so the localizer integrated double
    public void update() {
        lift.update();
    }
}

// Approach: I observed each symptom on telemetry, wrote one hypothesis per suspect line with the lesson it matched,
// changed one thing at a time and verified each fix before moving to the next one.
@Autonomous(name = "BuzzAuto")
public class BuzzAuto extends LinearOpMode {
    enum State { TO_SCORE, SCORE, TO_PARK, DONE }
    static final int LIFT_HIGH = 2200;

    // Inches from the bottom-left corner, heading in degrees (0 = +x, counter-clockwise)
    private final PoseFactory p = PoseFactory.degrees();
    private final Pose startPose = p.of(9, 60, 0);
    private final Pose scorePose = p.of(40, 72, 45);
    private final Pose parkPose = p.of(60, 108, 90);

    private Robot bot;
    private State phase = State.TO_SCORE;
    private final ElapsedTime clock = new ElapsedTime();

    private Path toScore() {
        return line(startPose, scorePose).linear(startPose, scorePose);
    }

    private Path toPark() {
        return line(scorePose, parkPose).linear(scorePose, parkPose);
    }

    @Override
    public void runOpMode() {
        Scheduler.reset();
        bot = new Robot(hardwareMap);
        bot.follower.setPose(startPose);
        telemetry.addData("Status", "Ready");
        telemetry.update();

        waitForStart();
        schedule(follow(bot.follower, toScore()));

        while (opModeIsActive()) {
            bot.follower.update();
            Scheduler.execute();
            bot.update();

            switch (phase) {
                case TO_SCORE:
                    // At the basket: raise the lift and start the scoring clock
                    // BUG: the isBusy() check was inverted, so the transition fired while the path was still running; negated it because busy means still driving
                    if (!bot.follower.isBusy()) {
                        phase = State.SCORE;
                        bot.lift.goTo(LIFT_HIGH);
                        clock.reset();
                    }
                    break;
                case SCORE:
                    // Spit the piece out for 1.5 s, then drive to park
                    if (clock.seconds() < 1.5) {
                        bot.intake.run(-1.0);
                    } else {
                        bot.intake.run(0);
                        schedule(follow(bot.follower, toPark()));
                        phase = State.TO_PARK;
                    }
                    break;
                case TO_PARK:
                    if (!bot.follower.isBusy()) phase = State.DONE;
                    break;
                case DONE:
                    break;
            }

            telemetry.addData("State", phase);
            telemetry.addData("Pose", bot.follower.pose());
            telemetry.addData("Lift", bot.lift.position());
            telemetry.addData("Busy", bot.follower.isBusy());
            // BUG: telemetry values never reached the screen because telemetry.update() was missing from the loop, so the display stayed frozen
            telemetry.update();
        }
    }
}
