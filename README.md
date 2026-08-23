# XLARM: Autonomous Voice-Guided Physical AI Assistant

![Build Status](https://img.shields.io/badge/build-passing-brightgreen)
![Vision Accuracy](https://img.shields.io/badge/YOLO--Pro_mAP@50-98%25-blue)
![Architecture](https://img.shields.io/badge/Architecture-Decentralized_Edge--to--Cloud-orange)
![License](https://img.shields.io/badge/License-MIT-purple)

XLARM is a decentralized, multi-modal robotic lab assistant capable of interpreting conversational voice commands and executing complex pick-and-place maneuvers using real-time computer vision.

## The Problem: The Computational Bottleneck

Building a smart robotic assistant that runs AI computer vision, conversational voice processing, and real-time servo control on a single microcontroller causes severe processing lag and hardware stuttering. Monolithic DIY architectures struggle to balance the asynchronous demands of cloud LLM streaming with the deterministic timing required for multi-axis servo PWM control.

## The Solution: Three-Board Decentralized Architecture

XLARM solves this bottleneck by physically dividing the computational labor across a localized Wi-Fi network, ensuring zero blocking between cognitive reasoning and physical actuation:

1. **The Cognitive Layer (Raspberry Pi 3):** Manages two-way audio interaction. It streams voice data to Groq's whisper-large-v3-turbo for instant transcription and utilizes gpt-oss-120b for intent extraction and JSON tool-call generation.
2. **The Interface Layer (ESP32):** Independently drives a responsive UI dashboard, ensuring graphics rendering never steals core compute cycles from the robot's logic.
3. **The Physical Edge Layer (Arduino UNO Q):** Executes a local, quantized int8 YOLO-Pro object detection model and calculates real-time Inverse Kinematics to drive a 6-axis robotic arm safely and smoothly.

---

## Codebase Structure

This repository contains the software modules required to run the XLARM system:

* index.js: The Node.js application running on the Raspberry Pi. This spins up a local REST API server, orchestrates the Groq LLM API calls, and queues physical commands.
* UNO_Q_Code/main.py: Python script handling the edge-vision pipeline and bounding box generation on the Arduino UNO Q.
* UNO_Q_Code/sketch.ino: The C++ firmware for the Arduino UNO Q that handles local Wi-Fi polling, parses REST API payloads, and executes PWM servo signals.
* arm_ik.py: The analytical Inverse Kinematics engine. It applies a 2D affine transformation matrix to convert bounding-box pixels into real-world Cartesian coordinates (cm) for soft-limited approach trajectories.
* package.json & package-lock.json: Node.js dependencies and environment configuration for the Pi's server.

## Key Features

* Ultra-Low Latency Conversational AI: Achieves 1.5 to 2.5-second end-to-end response times by offloading heavy reasoning to Groq's cloud infrastructure.
* High-Fidelity Edge Vision: The onboard YOLO-Pro model achieved a 98% mAP@50 test accuracy across 6 custom workspace classes (including dynamic human hand tracking).
* Asynchronous REST API: Devices communicate via standard HTTP POST/GET requests over a local router bridge, completely decoupling the vision/servo loop from network/API latency.
* Closed-Loop Kinematics: The system continuously POSTs physical execution telemetry and vision scans back to the conversational agent, giving the LLM spatial awareness of the physical desk environment.

## Setup & Installation

### 1. Raspberry Pi (Cognitive Server)

    # Clone the repository
    git clone https://github.com/ronsaikia/xlarm.git
    cd xlarm

    # Install Node dependencies
    npm install

    # Start the REST API and Voice Agent
    node index.js

### 2. Arduino UNO Q (Edge Execution)
1. Deploy the compiled YOLO-Pro int8 model from Edge Impulse to your UNO Q.
2. Open UNO_Q_Code/sketch.ino in the Arduino IDE.
3. Update the Wi-Fi SSID and Password to match your local router.
4. Flash the code to the UNO Q.

## System Limitations & Edge Cases

* Illumination Sensitivity: The quantized vision model's confidence degrades under harsh specular glare on plastic objects.
* Physical Occlusion: Real-time tracking requires the target object to remain at least 40% visible; severe occlusion by the user's hand will temporarily drop the bounding box.
* Cloud Dependency: High-level intent extraction requires an active internet connection to reach the Groq API. 

## Authors
MD Mehtab Hussain and Chiranjib Saikia (Team XL_ARM DUTABRO)
Submitted for the Arduino Physical AI Challenge India 2026
