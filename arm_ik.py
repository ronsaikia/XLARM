import sys
import json
import math
import numpy as np

SAFE_MIN, SAFE_MAX = 20, 160


def pixel_to_cm(px, py):
    workspace_width_cm = 30.0
    workspace_depth_cm = 20.0
    
    
    x_cm = ((px / 640.0) - 0.5) * workspace_width_cm
    y_cm = max(5.0, (1.0 - (py / 480.0)) * workspace_depth_cm) # Min 5cm clearance
    return x_cm, y_cm


_ELBOW_ANGLES = np.array([70, 90, 110])
_ELBOW_R = np.array([25, 0, 20])   
_R_COEFFS = np.polyfit(_ELBOW_ANGLES, _ELBOW_R, 2)  

def solve_kinematics(x_cm, y_cm, z_state):
    # 1. Base Angle (Yaw)
    base_yaw = math.degrees(math.atan2(y_cm, x_cm))
    base_deg = max(SAFE_MIN, min(SAFE_MAX, 90 + base_yaw))
    
    
    target_r = math.hypot(x_cm, y_cm)
    a, b, c = _R_COEFFS
    coeffs = [a, b, c - target_r]
    roots = np.roots(coeffs)
    
    valid_roots = [r.real for r in roots if abs(r.imag) < 1e-6 and SAFE_MIN <= r.real <= SAFE_MAX]
    elbow_deg = min(valid_roots, key=lambda e: abs(e - 90)) if valid_roots else 90

    
    if z_state == "HOVER":
        shoulder_deg, wrist_pitch = 110, 45 # High clearance, point down
    elif z_state == "DESCEND":
        shoulder_deg, wrist_pitch = 70, 90  # Lower down, flat to grab
    else: # HOME
        shoulder_deg, wrist_pitch = 90, 90

    return round(base_deg), round(shoulder_deg), round(elbow_deg), round(wrist_pitch)


def generate_pick_sequence(px, py):
    x_cm, y_cm = pixel_to_cm(px, py)
    base, shoulder, elbow, wpitch = solve_kinematics(x_cm, y_cm, "HOVER")
    _, shoulder_drop, _, wpitch_drop = solve_kinematics(x_cm, y_cm, "DESCEND")

    
    drop_base = 150 
    
    
    sequence = [
        {"step": "HOME",       "pose": [90, 90, 90, 90, 90, 90], "delay": 1000},
        {"step": "HOVER",      "pose": [base, shoulder, elbow, wpitch, 90, 90], "delay": 1500},
        {"step": "DESCEND",    "pose": [base, shoulder_drop, elbow, wpitch_drop, 90, 90], "delay": 1000},
        {"step": "GRAB",       "pose": [base, shoulder_drop, elbow, wpitch_drop, 90, 180], "delay": 800},
        {"step": "LIFT",       "pose": [base, shoulder, elbow, wpitch, 90, 180], "delay": 1000},
        {"step": "MOVE_DROP",  "pose": [drop_base, shoulder, elbow, wpitch, 90, 180], "delay": 1500},
        {"step": "DESC_DROP",  "pose": [drop_base, shoulder_drop, elbow, wpitch_drop, 90, 180], "delay": 1000},
        {"step": "RELEASE",    "pose": [drop_base, shoulder_drop, elbow, wpitch_drop, 90, 90], "delay": 800},
        {"step": "HOME",       "pose": [90, 90, 90, 90, 90, 90], "delay": 1500}
    ]
    
    return json.dumps({"status": "success", "sequence": sequence})

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(json.dumps({"status": "error", "message": "Missing pixel X/Y arguments"}))
        sys.exit(1)
        
    try:
        px, py = float(sys.argv[1]), float(sys.argv[2])
        print(generate_pick_sequence(px, py))
    except Exception as e:
        print(json.dumps({"status": "error", "message": str(e)}))
