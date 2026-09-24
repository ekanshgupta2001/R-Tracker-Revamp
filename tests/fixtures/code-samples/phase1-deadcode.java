// fixture: phase1 dead code — every required call exists, but the hardware setup sits in a method nothing calls and the driving code only runs under if (false); expected: fails, issues name setupHardware(), score <= 60
package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;
import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.hardware.Servo;

@TeleOp(name = "DeadCodeTeleOp")
public class DeadCodeTeleOp extends LinearOpMode {
    private DcMotor leftDrive;
    private DcMotor rightDrive;
    private Servo claw;

    @Override
    public void runOpMode() {
        waitForStart();
        while (opModeIsActive()) {
            if (false) {
                driveRobot();
            }
            telemetry.addData("Status", "running");
            telemetry.update();
        }
    }

    // Names must match the robot configuration on the Driver Hub exactly
    private void setupHardware() {
        leftDrive = hardwareMap.get(DcMotor.class, "left_drive");
        rightDrive = hardwareMap.get(DcMotor.class, "right_drive");
        claw = hardwareMap.get(Servo.class, "claw");
    }

    // Pushing the stick forward reads negative, so invert Y to get forward = positive
    private void driveRobot() {
        double drive = -gamepad1.left_stick_y;
        double turn = gamepad1.right_stick_x;
        leftDrive.setPower(drive + turn);
        rightDrive.setPower(drive - turn);
        if (gamepad1.a) claw.setPosition(0.0);
        if (gamepad1.b) claw.setPosition(1.0);
        telemetry.addData("Drive", drive);
    }
}
