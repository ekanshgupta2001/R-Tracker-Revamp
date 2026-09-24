// fixture: phase2 dead code — real subsystem classes, but the OpMode builds the Robot in a helper nothing calls and drives it under if (false); expected: fails, issues name buildRobot(), score <= 60
package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;
import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.hardware.HardwareMap;
import com.qualcomm.robotcore.hardware.Servo;

class Drivetrain {
    private DcMotor left;
    private DcMotor right;

    public Drivetrain(HardwareMap hardwareMap) {
        left = hardwareMap.get(DcMotor.class, "left_drive");
        right = hardwareMap.get(DcMotor.class, "right_drive");
    }

    public void drive(double forward, double turn) {
        left.setPower(forward + turn);
        right.setPower(forward - turn);
    }
}

class Claw {
    public enum ClawState { OPEN, CLOSED }
    private Servo servo;
    private ClawState state = ClawState.OPEN;

    public Claw(HardwareMap hardwareMap) { servo = hardwareMap.get(Servo.class, "claw"); }
    public void open() { state = ClawState.OPEN; servo.setPosition(0.0); }
    public void close() { state = ClawState.CLOSED; servo.setPosition(1.0); }
}

class Robot {
    public Drivetrain drivetrain;
    public Claw claw;

    public Robot(HardwareMap hardwareMap) {
        drivetrain = new Drivetrain(hardwareMap);
        claw = new Claw(hardwareMap);
    }
}

@TeleOp(name = "DeadTeleOp")
public class DeadTeleOp extends LinearOpMode {
    private Robot robot;

    @Override
    public void runOpMode() {
        waitForStart();
        while (opModeIsActive()) {
            if (false) {
                robot.drivetrain.drive(-gamepad1.left_stick_y, gamepad1.right_stick_x);
                if (gamepad1.a) robot.claw.open();
                if (gamepad1.b) robot.claw.close();
            }
            telemetry.update();
        }
    }

    private void buildRobot() {
        robot = new Robot(hardwareMap);
    }
}
