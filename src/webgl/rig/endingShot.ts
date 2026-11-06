import { Vector3 } from 'three';

/**
 * The ending's own camera (owned by the communications-tower ending, docs/ending.md). CameraRig applies it
 * last, blended by `weight`; while the weight is 0 the rig's chapter camera is untouched.
 */
export interface EndingPose {
  weight: number;
  camPos: Vector3;
  look: Vector3;
  fov: number;
  roll: number;
  /** letterbox amount, 0..1 */
  bars?: number;
}

export function endingPose(_t: number, _aspect: number, out: EndingPose): EndingPose {
  out.weight = 0;
  return out;
}
