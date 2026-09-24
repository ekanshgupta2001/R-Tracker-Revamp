// fixture: advanced_command honest half attempt — the Scheduler and follow() are set up and both paths run in one scheduled sequential(), but the intake step and the written reflection are missing; expected: 40-74, no CRITICAL, at least 2 next steps
package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.Autonomous;
import com.qualcomm.robotcore.eventloop.opmode.OpMode;
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

@Autonomous(name = "FirstCommands")
public class FirstCommands extends OpMode {
    private Follower follower;

    private final PoseFactory p = PoseFactory.degrees();
    private final Pose start = p.of(9, 60, 0);
    private final Pose scorePose = p.of(36, 72, 0);
    private final Pose park = p.of(60, 96, 90);

    private Path toScore() { return line(start, scorePose).linear(start, scorePose); }
    private Path toPark() { return line(scorePose, park).linear(scorePose, park); }

    @Override
    public void init() {
        Scheduler.reset();
        follower = Constants.create(hardwareMap);
        follower.setPose(start);
    }

    @Override
    public void start() {
        schedule(sequential(follow(follower, toScore()), follow(follower, toPark())));
    }

    @Override
    public void loop() {
        follower.update();
        Scheduler.execute();
        telemetry.addData("Pose", follower.pose());
    }
}
