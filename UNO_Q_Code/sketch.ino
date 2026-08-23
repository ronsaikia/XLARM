#include <Arduino_LED_Matrix.h>
#include "Arduino_RouterBridge.h"
#include "Wire.h"
#include "Adafruit_PWMServoDriver.h"
#include <Adafruit_NeoPixel.h>


#define LED_PIN 3
#define LED_COUNT 98

Adafruit_PWMServoDriver pwm = Adafruit_PWMServoDriver();
Arduino_LED_Matrix matrix;
Adafruit_NeoPixel strip(LED_COUNT, LED_PIN, NEO_GRB + NEO_KHZ800);


const uint8_t font[27][7] = {
  {0x0E,0x11,0x11,0x1F,0x11,0x11,0x11}, // A
  {0x1E,0x11,0x11,0x1E,0x11,0x11,0x1E}, // B
  {0x0E,0x11,0x10,0x10,0x10,0x11,0x0E}, // C
  {0x1E,0x11,0x11,0x11,0x11,0x11,0x1E}, // D
  {0x1F,0x10,0x10,0x1E,0x10,0x10,0x1F}, // E
  {0x1F,0x10,0x10,0x1E,0x10,0x10,0x10}, // F
  {0x0E,0x11,0x10,0x17,0x11,0x11,0x0E}, // G
  {0x11,0x11,0x11,0x1F,0x11,0x11,0x11}, // H
  {0x0E,0x04,0x04,0x04,0x04,0x04,0x0E}, // I
  {0x01,0x01,0x01,0x01,0x11,0x11,0x0E}, // J
  {0x11,0x12,0x14,0x18,0x14,0x12,0x11}, // K
  {0x10,0x10,0x10,0x10,0x10,0x10,0x1F}, // L
  {0x11,0x1B,0x15,0x15,0x11,0x11,0x11}, // M
  {0x11,0x19,0x15,0x13,0x11,0x11,0x11}, // N
  {0x0E,0x11,0x11,0x11,0x11,0x11,0x0E}, // O
  {0x1E,0x11,0x11,0x1E,0x10,0x10,0x10}, // P
  {0x0E,0x11,0x11,0x11,0x15,0x12,0x0D}, // Q
  {0x1E,0x11,0x11,0x1E,0x14,0x12,0x11}, // R
  {0x0F,0x10,0x10,0x0E,0x01,0x01,0x1E}, // S
  {0x1F,0x04,0x04,0x04,0x04,0x04,0x04}, // T
  {0x11,0x11,0x11,0x11,0x11,0x11,0x0E}, // U
  {0x11,0x11,0x11,0x11,0x11,0x0A,0x04}, // V
  {0x11,0x11,0x11,0x15,0x15,0x15,0x0A}, // W
  {0x11,0x11,0x0A,0x04,0x0A,0x11,0x11}, // X
  {0x11,0x11,0x0A,0x04,0x04,0x04,0x04}, // Y
  {0x1F,0x01,0x02,0x04,0x08,0x10,0x1F}, // Z
  {0x00,0x00,0x00,0x00,0x00,0x00,0x00}  // space
};

int charIndex(char c) {
  if (c >= 'A' && c <= 'Z') return c - 'A';
  if (c >= 'a' && c <= 'z') return c - 'a';
  return 26;
}

void scrollText(String text) {
  text.toUpperCase();
  int len = text.length();
  int bufWidth = len * 6 + 13;
  uint8_t *wide = new uint8_t[8 * bufWidth];
  memset(wide, 0, 8 * bufWidth);

  for (int i = 0; i < len; i++) {
    int idx = charIndex(text[i]);
    for (int row = 0; row < 7; row++) {
      uint8_t rowBits = font[idx][row];
      for (int col = 0; col < 5; col++) {
        if (rowBits & (1 << (4 - col))) {
          wide[(row + 1) * bufWidth + (i * 6 + col)] = 1;
        }
      }
    }
  }

  uint8_t frame[104];
  for (int offset = 0; offset < bufWidth - 13; offset++) {
    for (int row = 0; row < 8; row++) {
      for (int col = 0; col < 13; col++) {
        frame[row * 13 + col] = wide[row * bufWidth + offset + col];
      }
    }
    matrix.draw(frame);
    delay(80);
  }
  delete[] wide;

  memset(frame, 0, sizeof(frame));
  matrix.draw(frame);
}

void logMsg(const String &text) {
  Bridge.notify("bridge_print", text);
}


bool is_dancing = false;
bool dance_up = false;
bool is_talking = false;
bool talk_up = false;
unsigned long last_twitch = 0;
unsigned long last_heartbeat = 0;
bool is_limp = true;
unsigned long lastManualWristTime = 0;   

const uint16_t ARM_PULSE_MIN = 537;
const uint16_t ARM_PULSE_MAX = 2441;
const uint16_t ARM_PULSE_HOME = 1489;

uint16_t angleToPulse(int angleDeg) {
  return map(angleDeg, 0, 180, ARM_PULSE_MIN, ARM_PULSE_MAX);
}

void wakeArm() {
  if (is_limp) {
    for (int i = 2; i <= 6; i++) {
      pwm.writeMicroseconds(i, ARM_PULSE_HOME);
    }
    delay(400);
    is_limp = false;
  }
}

void writeRelaxToHardware() {
  for (int i = 2; i <= 6; i++) {
    pwm.writeMicroseconds(i, 0);
  }
  is_limp = true;
}

void relaxArm() {
  if (!is_limp) {
    writeRelaxToHardware();
  }
}

void relaxArmForce() {
  writeRelaxToHardware();
}

void execute_command(String payload) {
  logMsg(" MCU Executing: " + payload);

  int colon1 = payload.indexOf(':');
  int colon2 = payload.indexOf(':', colon1 + 1);
  int colon3 = payload.indexOf(':', colon2 + 1);

  String subsystem = payload.substring(0, colon1);
  String action = payload.substring(colon1 + 1, colon2);
  String target = payload.substring(colon2 + 1, colon3);
  String value = payload.substring(colon3 + 1);


  if (subsystem == "automation") {
    if (action == "display" || action == "scroll" || action == "broadcast") {
      logMsg("Scrolling text: " + value);
      scrollText(value);
    }
    else if (action == "turn_on") {
      strip.fill(strip.Color(255, 255, 255));
      strip.show();
      logMsg(" LED Ring turned ON");
    }
    else if (action == "turn_off") {
      strip.clear();
      strip.show();
      logMsg(" LED Ring turned OFF");
    }
    else if (action == "set_color") {
      int comma1 = value.indexOf(',');
      int comma2 = value.indexOf(',', comma1 + 1);

      if (comma1 > 0 && comma2 > 0) {
        uint8_t r = value.substring(0, comma1).toInt();
        uint8_t g = value.substring(comma1 + 1, comma2).toInt();
        uint8_t b = value.substring(comma2 + 1).toInt();

        strip.fill(strip.Color(r, g, b));
        strip.show();
        logMsg(" LED Ring color set to R:" + String(r) + " G:" + String(g) + " B:" + String(b));
      } else {
        logMsg(" Invalid RGB format received: " + value);
      }
    }
  }


  else if (action == "set_pose") {
      wakeArm();
      int commas[5];
      commas[0] = value.indexOf(',');
      for(int i = 1; i < 5; i++) {
        commas[i] = value.indexOf(',', commas[i-1] + 1);
      }

      if (commas[4] > 0) {
        int base = value.substring(0, commas[0]).toInt();
        int shoulder = value.substring(commas[0] + 1, commas[1]).toInt();
        int elbow = value.substring(commas[1] + 1, commas[2]).toInt();
        int wpitch = value.substring(commas[2] + 1, commas[3]).toInt();
        int wroll = value.substring(commas[3] + 1, commas[4]).toInt();
        int gripper = value.substring(commas[4] + 1).toInt();

        pwm.writeMicroseconds(6, angleToPulse(constrain(base, 20, 160)));
        pwm.writeMicroseconds(5, angleToPulse(constrain(shoulder, 20, 160)));
        pwm.writeMicroseconds(4, angleToPulse(constrain(elbow, 20, 160)));
        pwm.writeMicroseconds(3, angleToPulse(constrain(wpitch, 20, 160)));
        pwm.writeMicroseconds(2, angleToPulse(constrain(wroll, 20, 160)));

        pwm.writeMicroseconds(1, angleToPulse(constrain(gripper, 0, 180)));

        logMsg("Executed Full Pose IK Sequence Frame");
      }
    }


  else if (subsystem == "music") {
    if (action == "play") {
      wakeArm();
      dance_up = false;
      last_twitch = millis();
      is_dancing = true;
    } else if (action == "stop") {
      is_dancing = false;
      relaxArm();
    }
  }


  else if (subsystem == "arm") {

    if (action == "animate") {
      if (target == "speak_start") {
        wakeArm();
        talk_up = false;
        last_twitch = millis();
        is_talking = true;
      } else if (target == "speak_stop") {
        is_talking = false;
        relaxArm();
      }
    }

    else if (action == "set_joint") {
      wakeArm();
      int jointPin = -1;
      int minA = 20, maxA = 160;
      if (target == "base") jointPin = 6;
      else if (target == "shoulder") jointPin = 5;
      else if (target == "elbow") jointPin = 4;
      else if (target == "wrist_pitch") jointPin = 3;
      else if (target == "wrist_roll") jointPin = 2;
      else if (target == "gripper") { jointPin = 1; minA = 0; maxA = 180; }

      
      if (target == "wrist_roll" || target == "wrist_pitch") {
        lastManualWristTime = millis();
      }

      if (jointPin != -1) {
        int angleDeg = value.toInt();
        angleDeg = constrain(angleDeg, minA, maxA);
        uint16_t pulse = angleToPulse(angleDeg);
        pwm.writeMicroseconds(jointPin, pulse);
        logMsg("Set joint " + target + " (pin " + String(jointPin) + ") to " + String(angleDeg) + " degrees");
      } else {
        logMsg("Unknown joint name for set_joint: " + target);
      }
    }
  }
}

void handle_heartbeat(String payload) {
  last_heartbeat = millis();
}

void setup() {
  matrix.begin();
  matrix.setGrayscaleBits(1);


  strip.begin();
  strip.show();
  strip.setBrightness(100);

  pwm.begin();
  pwm.setOscillatorFrequency(27000000);
  pwm.setPWMFreq(50);

  delay(200);
  relaxArmForce();

  Bridge.begin();
  Bridge.provide_safe("execute_command", execute_command);
  Bridge.provide_safe("heartbeat", handle_heartbeat);

  Serial1.begin(115200);   

  delay(1000);
  logMsg("UNO Q C++ Brain is online. System idle and limp.");
}

void loop() {


  static String serial1Buffer = "";
  while (Serial1.available()) {
    char c = Serial1.read();
    if (c == '\n') {
      if (serial1Buffer.length() > 0) {
        execute_command(serial1Buffer);
        serial1Buffer = "";
      }
    } else if (c != '\r') {
      serial1Buffer += c;
    }
  }


  if (millis() - last_heartbeat > 5000) {
    if (is_dancing || is_talking || !is_limp) {
      is_dancing = false;
      is_talking = false;
      relaxArm();
    }
  }


  if (is_dancing || is_talking) {
    if (millis() - last_twitch > 400) {
     
      if (millis() - lastManualWristTime > 800) {
        int angle;

        if (is_dancing) {
          angle = dance_up ? 100 : 80;
          dance_up = !dance_up;
        } else {
          angle = talk_up ? 95 : 85;
          talk_up = !talk_up;
        }

        uint16_t pulse = angleToPulse(angle);
        pwm.writeMicroseconds(2, pulse);
        pwm.writeMicroseconds(3, pulse);
      }
      last_twitch = millis();
    }
  }
}
