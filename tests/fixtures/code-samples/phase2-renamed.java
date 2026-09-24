// fixture: phase2-good rewritten by a different student — Chassis/Gripper/Bot names, a HardwareMap parameter called hw, this. prefixes, the Bot built in a helper called from runOpMode, a switch on the enum and while (!isStopRequested()); expected: passes, score >= 85
package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;
import com.qualcomm.robotcore.hardware.DcMotorEx;
import com.qualcomm.robotcore.hardware.HardwareMap;
import com.qualcomm.robotcore.hardware.Servo;

// The chassis hides its motors; callers only choose speed and turn
class Chassis {
    private final DcMotorEx port;
    private final DcMotorEx starboard;

    Chassis(HardwareMap hw) {
        this.port = hw.get(DcMotorEx.class, "port");
        this.starboard = hw.get(DcMotorEx.class, "starboard");
    }

    public void arcade(double speed, double spin) {
        this.port.setPower(speed + spin);
        this.starboard.setPower(speed - spin);
    }

    public void halt() {
        port.setPower(0);
        starboard.setPower(0);
    }
}

// Remembers whether it is holding something so the driver can toggle it
class Gripper {
    enum Grip { OPEN, SHUT }

    private final Servo jaw;
    private Grip grip = Grip.OPEN;

    Gripper(HardwareMap hw) { jaw = hw.get(Servo.class, "jaw"); }

    public void toggle() {
        switch (grip) {
            case OPEN: grip = Grip.SHUT; jaw.setPosition(0.9); break;
            case SHUT: grip = Grip.OPEN; jaw.setPosition(0.1); break;
        }
    }

    public Grip current() { return grip; }
}

class Bot {
    final Chassis chassis;
    final Gripper gripper;

    Bot(HardwareMap hw) {
        chassis = new Chassis(hw);
        gripper = new Gripper(hw);
    }
}

@TeleOp(name = "Renamed Structure")
public class StructuredDriver extends LinearOpMode {
    private Bot bot;

    private void setup() {
        bot = new Bot(hardwareMap);
    }

    @Override
    public void runOpMode() {
        setup();
        waitForStart();
        boolean wasPressed = false;
        while (!isStopRequested()) {
            this.bot.chassis.arcade(gamepad1.left_stick_y * -1, gamepad1.right_stick_x);
            if (gamepad1.x && !wasPressed) bot.gripper.toggle();
            wasPressed = gamepad1.x;
            telemetry.addData("Grip", bot.gripper.current());
            telemetry.update();
        }
        bot.chassis.halt();
    }
}
