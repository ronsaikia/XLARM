# XLARM: Multimodal AI Lab Assistant
> **Arduino Physical AI Challenge India 2026 Submission** | **Team Yukti**

XLARM is an intelligent, voice-activated robotic lab assistant that bridges the gap between Large Language Models and real-time physical actuation. Crafted with a focus on clean, responsive interaction, it seamlessly combines conversational AI, computer vision, and a 6-DOF robotic arm to execute hardware tasks with zero-latency synchronization.

## Core Capabilities
* **Conversational Hardware Control:** Powered by Groq (Whisper/GPT-OSS), XLARM translates natural voice commands into strict JSON actions to control lights, motors, and relays.
* **Real-Time Audio Sync:** The system actively monitors local audio buffers to synchronize physical servos to music beats and trigger gentle nodding animations during AI speech.
* **On-Device Computer Vision:** Utilizes the Arduino UNO Q's dual-architecture to run Object Detection natively on the edge via a USB Web Camera.
* **Dynamic Visual Feedback:** Features an integrated 8-LED WS2812 NeoPixel ring and onboard LED matrix for real-time status and dynamic RGB color mapping.

## System Architecture
The codebase leverages a decoupled, dual-board approach:
* **The Brain (Raspberry Pi):** An asynchronous Node.js server (`index.js`) handles audio recording, Groq API LLM routing, Edge TTS, and local music streaming.
* **The Bridge (UNO Q Python):** A Python receiver (`main.py`) actively polls the Pi for JSON payloads over the network and handles the Arduino App Lab Vision Bricks.
* **The Brawn (UNO Q C++):** Hard real-time C++ firmware (`sketch.ino`) parses the strings via RouterBridge to safely drive the Adafruit PCA9685 PWM controller and NeoPixels.

## Hardware & Stack
* **Processing:** Arduino UNO Q (ABX00087), Raspberry Pi 3B
* **Actuation:** 6-DOF Robotic Arm, Adafruit 16-Channel PWM Servo Driver
* **Sensors:** Zebronics USB Web Camera, USB Microphone, WS2812 LED Ring
* **Developers:** Engineered by Team Yukti at Assam Engineering College (AEC).
