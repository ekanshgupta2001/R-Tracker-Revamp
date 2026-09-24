// fixture: phase4 dead code — poses, paths and a PID all exist, but the routine is never scheduled, the PID lives in a method nothing calls and follower.update() sits under if (false); expected: fails, issues name runLiftPid(), score <= 60
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

@Autonomous(name = "DeadPathAuto")
public class DeadPathAuto extends OpMode {
    private Follower follower;
    private DcMotorEx lift;
    private final double kP = 0.008, kI = 0.0002, kD = 0.0015;
    private double integral = 0, lastError = 0;

    private final PoseFactory p = PoseFactory.degrees();
    private final Pose start = p.of(9, 60, 0);
    private final Pose scorePose = p.of(36, 72, 0);
    private final Pose park = p.of(60, 96, 90);

    private Path toScore() { return line(start, scorePose).linear(start, scorePose); }
    private Path toPark() { return line(scorePose, park).constant(park); }

    private Command routine() {
        return sequential(follow(follower, toScore()), follow(follower, toPark()));
    }

    // Holds the lift at 1200 ticks; tuned with a full battery
    private void runLiftPid(double dt) {
        double error = 1200 - lift.getCurrentPosition();
        integral += error * dt;
        double derivative = (error - lastError) / dt;
        lastError = error;
        lift.setPower(kP * error + kI * integral + kD * derivative);
    }

    private void scheduleRoutine() {
        schedule(routine());
    }

    @Override
    public void init() {
        lift = hardwareMap.get(DcMotorEx.class, "lift");
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
