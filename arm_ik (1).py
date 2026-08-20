import numpy as np
import math


_ELBOW_ANGLES = np.array([70, 90, 110])
_ELBOW_R = np.array([25, 0, 20])   
_ELBOW_Z = np.array([37, 45, 36])  

_R_COEFFS = np.polyfit(_ELBOW_ANGLES, _ELBOW_R, 2)  
_Z_COEFFS = np.polyfit(_ELBOW_ANGLES, _ELBOW_Z, 2)  


ELBOW_MIN, ELBOW_MAX = 20, 160
BASE_MIN, BASE_MAX = 20, 160


SHOULDER_HOME = 90
WRIST_PITCH_HOME = 90
WRIST_ROLL_HOME = 90


def elbow_forward(elbow_deg):
    r = float(np.polyval(_R_COEFFS, elbow_deg))
    z = float(np.polyval(_Z_COEFFS, elbow_deg))
    return r, z


def solve_elbow_for_reach(target_r):
    a, b, c = _R_COEFFS
    
    coeffs = [a, b, c - target_r]
    roots = np.roots(coeffs)

    valid_roots = []
    for root in roots:
        if abs(root.imag) < 1e-6:  
            e = root.real
            if ELBOW_MIN <= e <= ELBOW_MAX:
                valid_roots.append(e)

    if not valid_roots:
        return None

    
    return min(valid_roots, key=lambda e: abs(e - 90))


def plan_move(target_x_cm, target_y_cm):
    target_r = math.hypot(target_x_cm, target_y_cm)
    base_yaw = math.degrees(math.atan2(target_y_cm, target_x_cm))

    raw_base_deg = 90 + base_yaw
    base_deg = max(BASE_MIN, min(BASE_MAX, raw_base_deg))
    base_clamped = base_deg != raw_base_deg

    elbow_deg = solve_elbow_for_reach(target_r)
    if elbow_deg is None:
        return {
            "reachable": False,
            "warning": f"Target reach {target_r:.1f}cm has no valid elbow "
                       f"solution within {ELBOW_MIN}-{ELBOW_MAX} degrees. "
                       f"Calibrated reach range is roughly {min(_ELBOW_R):.0f}"
                       f"-{max(_ELBOW_R):.0f}cm."
        }

    predicted_r, predicted_z = elbow_forward(elbow_deg)
    extrapolating = elbow_deg < 70 or elbow_deg > 110

    warnings = []
    if extrapolating:
        warnings.append("Elbow angle is outside the calibrated 70-110 range - "
                         "this is an extrapolation, verify carefully before trusting it.")
    if base_clamped:
        warnings.append(f"Requested base angle {raw_base_deg:.1f} deg was clamped to "
                         f"{base_deg:.1f} deg (outside {BASE_MIN}-{BASE_MAX} safety range) - "
                         f"the arm will point in a DIFFERENT direction than the true target.")

    return {
        "reachable": True,
        "base": round(base_deg, 1),
        "shoulder": SHOULDER_HOME,
        "elbow": round(elbow_deg, 1),
        "wrist_pitch": WRIST_PITCH_HOME,
        "wrist_roll": WRIST_ROLL_HOME,
        "predicted_r": round(predicted_r, 1),
        "predicted_z": round(predicted_z, 1),
        "warning": "; ".join(warnings) if warnings else None
    }


if __name__ == "__main__":
    test_points = [(10, 15), (20, 10), (5, 20), (15, 0)]
    for x, y in test_points:
        result = plan_move(x, y)
        print(f"\nTarget ({x},{y})cm:")
        for k, v in result.items():
            print(f"  {k}: {v}")
