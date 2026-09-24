// fixture: phase3 honest half attempt — drives until the distance sensor sees the wall, then stops, but one reading at a time, no state machine, no timer and no subsystem classes; expected: 40-74, no CRITICAL, at least 2 next steps
package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.Autonomous;
import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.hardware.DistanceSensor;
import org.firstinspires.ftc.robotcore.external.navigation.DistanceUnit;

@Autonomous(name = "DriveToWall")
public class DriveToWall extends LinearOpMode {
    @Override
    public void runOpMode() {
        DcMotor left = hardwareMap.get(DcMotor.class, "left_drive");
        DcMotor right = hardwareMap.get(DcMotor.class, "right_drive");
        DistanceSensor distance = hardwareMap.get(DistanceSensor.class, "distance");
        waitForStart();

        while (opModeIsActive()) {
            double cm = distance.getDistance(DistanceUnit.CM);
            // Creep forward until the wall is close enough to score from
            if (cm > 15) {
                left.setPower(0.3);
                right.setPower(0.3);
            } else {
                left.setPower(0);
                right.setPower(0);
            }
            telemetry.addData("Distance", cm);
            telemetry.update();
        }
    }
}
