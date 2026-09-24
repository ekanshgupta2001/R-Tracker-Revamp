// fixture: phase4-good rewritten by a different student — a LinearOpMode with while (!isStopRequested() && opModeIsActive()), the follower called drive, a K_P constant, the error named delta (read straight from the encoder), a curve with .tangent(), Range.clip on the output and this. prefixes; expected: passes, score >= 85
package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.Autonomous;
import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.hardware.DcMotorEx;
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
import static com.pedropathing.ivy.groups.Groups.sequential;
import static com.pedropathing.ivy.pedro.PedroCommands.follow;

@Autonomous(name = "Renamed Pedro")
public class BasketRun extends LinearOpMode {
    // Gains found by doubling K_P until the slide oscillated, then halving it
    private static final double K_P = 0.006, K_I = 0.0001, K_D = 0.002;
    private static final int SLIDE_TARGET = 1500;

    private Follower drive;
    private DcMotorEx slide;

    private final PoseFactory field = PoseFactory.degrees();
    private final Pose home = field.of(8, 56, 0);
    private final Pose bend = field.of(30, 90, 45);
    private final Pose basket = field.of(18, 126, 135);
    private final Pose sample = field.of(44, 112, -90);

    private Path first() { return curve(home, bend, basket).tangent(); }
    private Path second() { return line(basket, sample).linear(basket, sample); }

    @Override
    public void runOpMode() {
        Scheduler.reset();
        this.drive = Constants.create(hardwareMap);
        this.drive.setPose(home);
        this.slide = hardwareMap.get(DcMotorEx.class, "slide");
        slide.setMode(DcMotor.RunMode.STOP_AND_RESET_ENCODER);
        slide.setMode(DcMotor.RunMode.RUN_USING_ENCODER);

        waitForStart();
        schedule(sequential(follow(drive, first()), follow(drive, second())));

        ElapsedTime clock = new ElapsedTime();
        double previous = 0, accumulated = 0, lastTime = clock.seconds();
        while (!isStopRequested() && opModeIsActive()) {
            this.drive.update();
            Scheduler.execute();

            // The slide PID runs every loop so it keeps holding while the robot drives
            double now = clock.seconds(), dt = Math.max(now - lastTime, 1e-3);
            double delta = SLIDE_TARGET - slide.getCurrentPosition();
            accumulated += delta * dt;
            double rate = (delta - previous) / dt;
            previous = delta;
            lastTime = now;
            double output = K_P * delta + K_I * accumulated + K_D * rate;
            slide.setPower(Range.clip(output, -1, 1));

            telemetry.addData("Pose", drive.pose());
            telemetry.addData("Slide error", delta);
            telemetry.update();
        }
    }
}
