package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.Autonomous;
import com.qualcomm.robotcore.eventloop.opmode.OpMode;
import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.hardware.HardwareMap;
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

// The intake is a plain class; its commands come from Command.build() and require the intake itself
class Intake {
    private final DcMotor motor;
    public Intake(HardwareMap hardwareMap) { motor = hardwareMap.get(DcMotor.class, "intake"); }
    public void run(double power) { motor.setPower(power); }

    // Runs the intake for a fixed number of seconds; setEnd() stops it however the command ends
    public Command runFor(double seconds) {
        ElapsedTime timer = new ElapsedTime();
        return Command.build()
            .setStart(() -> { timer.reset(); run(1.0); })
            .setDone(() -> timer.seconds() >= seconds)
            .setEnd(endCondition -> run(0))
            .requiring(this);
    }
}

@Autonomous(name = "CommandAuto")
public class CommandAuto extends OpMode {
    private Follower follower;
    private Intake intake;

    private final PoseFactory p = PoseFactory.degrees();
    private final Pose start = p.of(9, 60, 0);
    private final Pose scorePose = p.of(36, 72, 0);
    private final Pose park = p.of(60, 96, 90);

    private Path toScore() { return line(start, scorePose).linear(start, scorePose); }
    private Path toPark() { return line(scorePose, park).linear(scorePose, park); }

    // The whole autonomous is one sequential composition: no state enum, no switch
    private Command routine() {
        return sequential(
            follow(follower, toScore()),
            intake.runFor(2.0),
            follow(follower, toPark())
        );
    }

    @Override
    public void init() {
        Scheduler.reset();
        follower = Constants.create(hardwareMap);
        follower.setPose(start);
        intake = new Intake(hardwareMap);
    }

    @Override
    public void start() { schedule(routine()); }

    @Override
    public void loop() {
        follower.update();
        Scheduler.execute();
        telemetry.addData("Pose", follower.pose());
    }
}

// Comparison: the command-based version is easier to read because each step is a named command,
// and easier to modify — reordering the autonomous is one line in sequential(). The original
// state machine needed a new enum value and switch case for every step.
