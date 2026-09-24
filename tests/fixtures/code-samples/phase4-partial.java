// fixture: phase4 honest half attempt — the Pedro 3 part is done (follower, poses, paths, a scheduled sequential), but the lift PID is not written yet and nothing uses encoders; expected: 40-74, no CRITICAL, at least 2 next steps
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

@Autonomous(name = "PathsOnly")
public class PathsOnly extends OpMode {
    private Follower follower;

    // Inches from the bottom-left corner of the field, heading in degrees
    private final PoseFactory p = PoseFactory.degrees();
    private final Pose start = p.of(9, 60, 0);
    private final Pose basket = p.of(20, 124, 135);
    private final Pose spike = p.of(40, 110, 0);

    private Path toBasket() { return line(start, basket).linear(start, basket); }
    private Path toSpike() { return line(basket, spike).linear(basket, spike); }

    @Override
    public void init() {
        Scheduler.reset();
        follower = Constants.create(hardwareMap);
        follower.setPose(start);
    }

    @Override
    public void start() {
        schedule(sequential(follow(follower, toBasket()), follow(follower, toSpike())));
    }

    @Override
    public void loop() {
        follower.update();
        Scheduler.execute();
        telemetry.addData("Pose", follower.pose());
    }
}
