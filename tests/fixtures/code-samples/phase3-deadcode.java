// fixture: phase3 dead code — the sensor setup and the whole state machine live in methods nothing calls; runOpMode only waits and parks on a timer; expected: fails, issues name runStateMachine(), score <= 60
package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.Autonomous;
import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.hardware.ColorSensor;
import com.qualcomm.robotcore.hardware.DistanceSensor;
import com.qualcomm.robotcore.util.ElapsedTime;
import org.firstinspires.ftc.robotcore.external.navigation.DistanceUnit;

@Autonomous(name = "DeadSensorAuto")
public class DeadSensorAuto extends LinearOpMode {
    enum State { DRIVE_TO_LINE, CHECK_COLOR, SCORE, DONE }

    private State state = State.DRIVE_TO_LINE;
    private ColorSensor colorSensor;
    private DistanceSensor distance;
    private final ElapsedTime timer = new ElapsedTime();

    @Override
    public void runOpMode() {
        waitForStart();
        while (opModeIsActive()) {
            telemetry.addData("Status", "waiting");
            telemetry.update();
        }
    }

    private void setupSensors() {
        colorSensor = hardwareMap.get(ColorSensor.class, "color");
        distance = hardwareMap.get(DistanceSensor.class, "distance");
    }

    // Average five readings so one noisy spike cannot trigger a transition
    private void runStateMachine(Robot robot) {
        while (opModeIsActive() && state != State.DONE) {
            double sum = 0;
            for (int i = 0; i < 5; i++) sum += distance.getDistance(DistanceUnit.CM);
            double cm = sum / 5.0;
            switch (state) {
                case DRIVE_TO_LINE:
                    robot.drivetrain.drive(0.4, 0);
                    if (cm < 20) { state = State.CHECK_COLOR; timer.reset(); }
                    break;
                case CHECK_COLOR:
                    robot.drivetrain.stop();
                    if (colorSensor.red() > colorSensor.blue() + 40) state = State.SCORE;
                    else if (timer.seconds() > 2.0) state = State.DONE;
                    break;
                case SCORE:
                    robot.intake.run(1.0);
                    if (timer.seconds() > 3.5) { robot.intake.run(0); state = State.DONE; }
                    break;
            }
            telemetry.addData("Distance cm", cm);
            telemetry.update();
        }
        robot.drivetrain.stop();
    }
}
