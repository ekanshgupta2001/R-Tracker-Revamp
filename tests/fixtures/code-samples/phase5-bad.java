package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.Autonomous;
import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.hardware.DcMotor;
import com.pedropathing.follower.Follower;
import org.firstinspires.ftc.teamcode.pedro.Constants;

@Autonomous(name = "StillBroken")
public class StillBroken extends LinearOpMode {
    Follower follower;
    DcMotor intake;

    @Override
    public void runOpMode() {
        follower = Constants.create(hardwareMap);
        intake = hardwareMap.get(DcMotor.class, "intake");
        waitForStart();
        while (opModeIsActive()) {
            follower.update();
            try {
                follower.update();
                intake.setPower(1);
            } catch (Exception e) {
            }
            // TODO fix later
        }
    }
}
