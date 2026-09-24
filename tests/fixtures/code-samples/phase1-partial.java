// fixture: phase1 honest half attempt — tank driving with both sticks and an inverted Y, but no servo, no mechanism button and no telemetry yet; expected: 40-74, no CRITICAL, at least 2 next steps
package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;
import com.qualcomm.robotcore.hardware.DcMotor;

@TeleOp(name = "TankDrive")
public class TankDrive extends LinearOpMode {
    @Override
    public void runOpMode() {
        DcMotor left = hardwareMap.get(DcMotor.class, "left_drive");
        DcMotor right = hardwareMap.get(DcMotor.class, "right_drive");
        right.setDirection(DcMotor.Direction.REVERSE);

        waitForStart();

        while (opModeIsActive()) {
            // Tank drive: each stick drives one side, flipped so pushing up means forward
            left.setPower(-gamepad1.left_stick_y);
            right.setPower(-gamepad1.right_stick_y);
        }
    }
}
