import time
import requests
from arduino.app_utils import App, Bridge
from arduino.app_bricks.video_objectdetection import VideoObjectDetection
PI_IP = "192.168.29.98"
vision_brick = VideoObjectDetection(confidence=0.2, debounce_sec=0.0)
current_vision_scene = {}
def update_vision_memory(detections: dict):
    global current_vision_scene
    current_vision_scene = detections
vision_brick.on_detect_all(update_vision_memory)

def on_bridge_print(payload):
    print(f"[MCU] {payload}")
Bridge.provide("bridge_print", on_bridge_print)
def loop():
    try:
        response = requests.get(f"http://{PI_IP}:5000/api/poll", timeout=2)
        data = response.json()
        if data.get("has_command"):
            cmd = data["command"]
            subsystem = cmd.get("subsystem", "")
            action = cmd.get("action", "")
            target = cmd.get("target", "")
            value = cmd.get("value", "")
            
            if subsystem == "vision" and action == "scan":
                
                print(f"[CALIBRATION] Full detection data: {current_vision_scene}")
                try:
                    requests.post(f"http://{PI_IP}:5000/api/feedback", json={
                        "status": "success", "detections": current_vision_scene
                    }, timeout=2)
                except: pass
            
            command_string = f"{subsystem}:{action}:{target}:{value}"
            print(f"[PY->MCU] sending: {command_string}")   
            Bridge.notify("execute_command", command_string)
    except Exception as e:
        print(f"[PY loop error] {e}")  
    Bridge.notify("heartbeat", "")
    time.sleep(0.1)
if __name__ == "__main__":
    App.run(user_loop=loop)
