package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.Autonomous;
import com.qualcomm.robotcore.eventloop.opmode.OpMode;
import com.qualcomm.robotcore.hardware.DcMotorEx;
import com.pedropathing.api.PoseFactory;
import com.pedropathing.follower.Follower;
import com.pedropathing.ivy.Command;
import com.pedropathing.ivy.Scheduler;
import com.pedropathing.math.Pose;
import com.pedropathing.paths.Path;
import org.firstinspires.ftc.teamcode.pedro.Constants;

import static com.pedropathing.api.Paths.*;
import static com.pedropathing.ivy.Scheduler.schedule;
import static com.pedropathing.ivy.groups.Groups.sequential;
import static com.pedropathing.ivy.pedro.PedroCommands.follow;

// A small PID for the lift; constants tuned on 2026-02-14 with a 12.8 V battery
class LiftController {
    private final double kP = 0.008, kI = 0.0002, kD = 0.0015, kF = 0.12;
    private double integral = 0, lastError = 0;

    public double update(double target, double current, double dt) {
        double error = target - current;
        integral += error * dt;
        double derivative = (error - lastError) / dt;
        lastError = error;
        // kF holds the arm against gravity so PID only handles the correction
        return kP * error + kI * integral + kD * derivative + kF;
    }
}

@Autonomous(name = "PathAuto")
public class PathAuto extends OpMode {
    private Follower follower;
    private DcMotorEx lift;
    private final LiftController liftPid = new LiftController();
    private double lastTime;

    // Poses: inches from the bottom-left corner, heading in degrees (0 = +x, counter-clockwise)
    private final PoseFactory p = PoseFactory.degrees();
    private final Pose start = p.of(9, 60, 0);
    private final Pose scorePose = p.of(36, 72, 0);
    private final Pose pickupControl = p.of(48, 40, 0);   // pulls the curve, never visited
    private final Pose pickup = p.of(60, 24, -90);
    private final Pose park = p.of(60, 96, 90);

    private Path toScore() {
        return line(start, scorePose).linear(start, scorePose);
    }

    private Path toPickup() {
        return curve(scorePose, pickupControl, pickup).linear(scorePose, pickup);
    }

    private Path toPark() {
        return line(pickup, park).constant(park);
    }

    private Command routine() {
        return sequential(
            follow(follower, toScore()),
            follow(follower, toPickup()),
            follow(follower, toPark())
        );
    }

    @Override
    public void init() {
        Scheduler.reset();
        follower = Constants.create(hardwareMap);
        follower.setPose(start);
        lift = hardwareMap.get(DcMotorEx.class, "lift");
        lift.setMode(DcMotorEx.RunMode.STOP_AND_RESET_ENCODER);
        lift.setMode(DcMotorEx.RunMode.RUN_USING_ENCODER);
    }

    @Override
    public void start() {
        schedule(routine());
        lastTime = getRuntime();
    }

    @Override
    public void loop() {
        double now = getRuntime();
        follower.update();
        Scheduler.execute();
        // Encoder ticks -> PID power each loop; target changes per path segment
        double power = liftPid.update(1200, lift.getCurrentPosition(), now - lastTime);
        lift.setPower(power);
        lastTime = now;
        telemetry.addData("x", follower.pose().x());
        telemetry.addData("y", follower.pose().y());
        telemetry.addData("heading", Math.toDegrees(follower.pose().heading()));
        telemetry.addData("lift", lift.getCurrentPosition());
        telemetry.addData("mode", follower.mode());
    }
}
