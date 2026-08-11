import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  Line,
  LineBasicMaterial,
  Vector3,
} from 'three';
import { CONTRAIL_FROM } from '../../story/chapters';
import type { FlightPath } from '../rig/FlightPath';

const POINTS = 48;
const STEP = 0.0018; // story-t between samples

/**
 * The contrail: ONE clean white string trailing the plane, sampled directly
 * off the flight path behind the current t. A pure function of scroll — no
 * history buffer, so scroll jumps, reverse scrub, and route swaps can never
 * leave slashes or scribbles behind. Head anchors to the plane itself; the
 * tail fades to black under additive blending (= fades out).
 */
export class Trail {
  readonly line: Line;
  private positions = new Float32Array(POINTS * 3);
  private geometry = new BufferGeometry();
  private material = new LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  private sample = new Vector3();

  constructor() {
    this.geometry.setAttribute(
      'position',
      new BufferAttribute(this.positions, 3).setUsage(DynamicDrawUsage),
    );
    // static fade, brightest at the plane, gone at the tail
    const colors = new Float32Array(POINTS * 3);
    for (let i = 0; i < POINTS; i++) {
      const fade = (1 - i / (POINTS - 1)) * 0.85;
      colors[i * 3] = fade;
      colors[i * 3 + 1] = fade;
      colors[i * 3 + 2] = fade;
    }
    this.geometry.setAttribute('color', new BufferAttribute(colors, 3));
    this.line = new Line(this.geometry, this.material);
    this.line.frustumCulled = false;
    this.line.visible = false;
  }

  update(t: number, path: FlightPath, head: Vector3): void {
    this.positions[0] = head.x;
    this.positions[1] = head.y;
    this.positions[2] = head.z;
    for (let i = 1; i < POINTS; i++) {
      // never sample earlier than the takeoff window — the string must not
      // reach back into the room
      const tt = Math.max(t - i * STEP, CONTRAIL_FROM);
      path.pointAt(tt, this.sample);
      this.positions[i * 3] = this.sample.x;
      this.positions[i * 3 + 1] = this.sample.y;
      this.positions[i * 3 + 2] = this.sample.z;
    }
    this.geometry.attributes.position!.needsUpdate = true;
  }

  set visible(v: boolean) {
    this.line.visible = v;
  }

  /** Kept for route swaps; the trail is stateless, nothing to clear. */
  reset(): void {}

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
