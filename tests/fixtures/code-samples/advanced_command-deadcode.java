// fixture: advanced_command dead code — a real command-based autonomous whose routine is only scheduled under if (false) and whose intake command is built in a method nothing calls; expected: fails, issues name intakeFor(), score <= 60
package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.Autonomous;
import com.qualcomm.robotcore.eventloop.opmode.OpMode;
import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.util.ElapsedTime;
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

@Autonomous(name = "DeadCommandAuto")
public class DeadCommandAuto extends OpMode {
    private Follower follower;
    private DcMotor intake;

    private final PoseFactory p = PoseFactory.degrees();
    private final Pose start = p.of(9, 60, 0);
    private final Pose scorePose = p.of(36, 72, 0);
    private final Pose park = p.of(60, 96, 90);

    private Path toScore() { return line(start, scorePose).linear(start, scorePose); }
    private Path toPark() { return line(scorePose, park).linear(scorePose, park); }

    // Runs the intake for a fixed time and always stops it at the end
    private Command intakeFor(double seconds) {
        ElapsedTime timer = new ElapsedTime();
        return Command.build()
            .setStart(() -> { timer.reset(); intake.setPower(1.0); })
            .setDone(() -> timer.seconds() >= seconds)
            .setEnd(interrupted -> intake.setPower(0))
            .requiring(intake);
    }

    private Command routine() {
        return sequential(follow(follower, toScore()), follow(follower, toPark()));
    }

    @Override
    public void init() {
        intake = hardwareMap.get(DcMotor.class, "intake");
    }

    @Override
    public void start() {
        if (false) schedule(routine());
    }

    @Override
    public void loop() {
        telemetry.addData("Status", "idle");
    }
}
