"""
Elbow-only inverse kinematics for the robotic arm.

STATUS / TRUST LEVEL (read this before touching real servos):
  - Base    : direction only (yaw). Not distance-calibrated here — you still
              need a separate pixel->degrees or pixel->cm mapping from the
              vision brick to know what base angle points at a target.
  - Shoulder: fixed at 90 (home). Link is tiny (1.85cm), not modeled.
  - Elbow   : the ONLY joint driving reach. Fit from 3 real measurements:
                  elbow=70  -> (r=25, z=37)
                  elbow=90  -> (r=0,  z=45)   [all-joints-home]
                  elbow=110 -> (r=20, z=36)
  - Wrist pitch/roll: fixed at 90 (home). Wrist-pitch calibration data was
              noisy/unreliable (see prior session) and is deliberately not
              used for reach math. Treat any (r,z) accuracy as +/- a few cm.

Because elbow's effect on r is roughly symmetric around 90 degrees (bending
either direction moves the tip forward and down by a similar amount), a
target r has two possible elbow solutions. This module always returns the
elbow<90 branch (70-90 range) since that's the side you actually have real
calibrated data for. Do NOT extrapolate past the 70-110 range without new
measurements - the fit is unvalidated outside it.

Always do an approach-height hover before final grasp: move to a higher z
first, then descend, so a few cm of model error doesn't crash the gripper.
"""

import numpy as np

# --- Calibrated data points: elbow_angle_deg -> (r_cm, z_cm) ---
ELBOW_DEG = np.array([70, 90, 110])
R_CM      = np.array([25,  0,  20])
Z_CM      = np.array([37, 45,  36])

# Quadratic fit: r(elbow) and z(elbow). With only 3 points this is an exact
# fit (2nd-degree polynomial through 3 points), not a statistical regression -
# there's no extra data to check it against, so trust it only in-range.
_r_coeffs = np.polyfit(ELBOW_DEG, R_CM, 2)
_z_coeffs = np.polyfit(ELBOW_DEG, Z_CM, 2)

TRUSTED_MIN_DEG = 70
TRUSTED_MAX_DEG = 110
SAFETY_MIN_DEG = 20
SAFETY_MAX_DEG = 160


def elbow_to_rz(elbow_deg: float):
    """Forward kinematics: elbow angle -> (r, z) in cm."""
    r = np.polyval(_r_coeffs, elbow_deg)
    z = np.polyval(_z_coeffs, elbow_deg)
    return float(r), float(z)


def solve_elbow_for_r(target_r_cm: float, branch: str = "below_90"):
    """
    Inverse kinematics: target horizontal reach (cm) -> elbow angle (deg).

    branch: "below_90" (70-90 deg, the trusted/default side) or
            "above_90" (90-110 deg) if you specifically need the other side.

    Returns None if target_r_cm is outside what's reachable in the trusted
    70-110 range (i.e. we refuse to extrapolate/guess).
    """
    if branch == "below_90":
        lo, hi = TRUSTED_MIN_DEG, 90
    elif branch == "above_90":
        lo, hi = 90, TRUSTED_MAX_DEG
    else:
        raise ValueError("branch must be 'below_90' or 'above_90'")

    # Numeric search (bisection-style) rather than closed-form inversion of
    # the quadratic - simpler to keep safe/clamped and easy to verify.
    best_angle, best_err = None, float("inf")
    for angle in np.linspace(lo, hi, 401):  # 0.1 deg resolution
        r, _ = elbow_to_rz(angle)
        err = abs(r - target_r_cm)
        if err < best_err:
            best_err, best_angle = err, angle

    # If even the closest point in range is >3cm off, the target is outside
    # what this model can honestly reach - don't guess, say so.
    if best_err > 3.0:
        return None

    return round(float(best_angle))


def plan_pick(target_r_cm: float, base_deg: float, branch: str = "below_90"):
    """
    Build the full joint command set for a pick at horizontal reach
    target_r_cm, in the direction given by base_deg (you supply this from
    your own vision->base-angle mapping - not solved here).

    Returns a dict of joint_name -> angle_deg, or None if unreachable.
    All non-solved joints are held at safe home values.
    """
    elbow_deg = solve_elbow_for_r(target_r_cm, branch=branch)
    if elbow_deg is None:
        return None

    base_deg = max(SAFETY_MIN_DEG, min(SAFETY_MAX_DEG, base_deg))

    return {
        "base": round(base_deg),
        "shoulder": 90,
        "elbow": elbow_deg,
        "wrist_pitch": 90,
        "wrist_roll": 90,
    }


if __name__ == "__main__":
    # Quick sanity check against the actual calibration points
    for deg in (70, 90, 110):
        print(f"elbow={deg} -> {elbow_to_rz(deg)}")

    print()
    for test_r in (0, 10, 20, 25, 30):
        e = solve_elbow_for_r(test_r)
        print(f"target r={test_r}cm -> elbow={e}", 
              None if e is None else elbow_to_rz(e))

    print()
    print("plan_pick(r=20, base=90):", plan_pick(20, 90))
