// fixture: phase2 honest half attempt — the drivetrain is split out into its own class, but the claw still lives in the OpMode, there is no Robot class and no enum; expected: 40-74, no CRITICAL, at least 2 next steps
package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;
import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.hardware.HardwareMap;
import com.qualcomm.robotcore.hardware.Servo;

// Owns both drive motors so the OpMode only says how fast to go
class Drivetrain {
    private DcMotor left;
    private DcMotor right;

    public Drivetrain(HardwareMap hardwareMap) {
        left = hardwareMap.get(DcMotor.class, "left_drive");
        right = hardwareMap.get(DcMotor.class, "right_drive");
        right.setDirection(DcMotor.Direction.REVERSE);
    }

    public void drive(double forward, double turn) {
        left.setPower(forward + turn);
        right.setPower(forward - turn);
    }

    public void stop() {
        left.setPower(0);
        right.setPower(0);
    }
}

@TeleOp(name = "HalfCleanTeleOp")
public class HalfCleanTeleOp extends LinearOpMode {
    private Servo claw;

    @Override
    public void runOpMode() {
        Drivetrain drivetrain = new Drivetrain(hardwareMap);
        claw = hardwareMap.get(Servo.class, "claw");
        waitForStart();
        while (opModeIsActive()) {
            drivetrain.drive(-gamepad1.left_stick_y, gamepad1.right_stick_x);
            if (gamepad1.a) claw.setPosition(0.0);
            if (gamepad1.b) claw.setPosition(1.0);
            telemetry.update();
        }
        drivetrain.stop();
    }
}
