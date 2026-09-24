// fixture: phase1-good rewritten by a different student — other names, this. prefixes, a motor array, a Gamepad alias, y * -1, while (!isStopRequested()) and a helper method for the claw; expected: passes, score >= 85
package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;
import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.hardware.Gamepad;
import com.qualcomm.robotcore.hardware.Servo;

@TeleOp(name = "Renamed TeleOp")
public class ArcadeDriver extends LinearOpMode {
    // index 0 is the port side, index 1 the starboard side
    private final DcMotor[] wheels = new DcMotor[2];
    private Servo grabber;

    @Override
    public void runOpMode() {
        // Configuration names come from the robot's hardware map on the hub
        this.wheels[0] = hardwareMap.get(DcMotor.class, "port");
        this.wheels[1] = hardwareMap.get(DcMotor.class, "starboard");
        this.grabber = hardwareMap.get(Servo.class, "grabber");
        wheels[1].setDirection(DcMotor.Direction.REVERSE);

        Gamepad driver = gamepad1;
        waitForStart();

        while (!isStopRequested()) {
            // The stick reports up as negative, so flip it before mixing in the turn
            double throttle = driver.left_stick_y * -1;
            double steer = driver.right_stick_x;
            this.wheels[0].setPower(throttle + steer);
            this.wheels[1].setPower(throttle - steer);

            if (driver.right_bumper) {
                openGrabber();
            } else if (driver.left_bumper) {
                closeGrabber();
            }

            telemetry.addData("Throttle", throttle);
            telemetry.addData("Steer", steer);
            telemetry.update();
        }
    }

    private void openGrabber() { grabber.setPosition(0.2); }

    private void closeGrabber() { grabber.setPosition(0.9); }
}
