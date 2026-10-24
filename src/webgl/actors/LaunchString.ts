import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  Line,
  LineBasicMaterial,
  MathUtils,
  Vector3,
} from 'three';
import type { FlightPath } from '../rig/FlightPath';
import { HERO_RELEASE, STAGE, heroParam } from '../rig/launch';

const POINTS = 30;
/** how long the glowing tail is, along the flight line, in story-t */
const TAIL = 0.026;
const SHOW_TO = 0.16;

/**
 * The hero's launch thread: a thin glowing tail behind the third plane, out of the laptop
 * screen and across the room (the scouts have the same contrail in BatchSend). It starts
 * where the envelope does, brightest at the plane and fading to nothing down the line, and
 * dies away once the dart is airborne over the town (the contrail takes over there).
 */
export class LaunchString {
  readonly line: Line;
  private positions = new Float32Array(POINTS * 3);
  private geometry = new BufferGeometry();
  private material = new LineBasicMaterial({
    vertexColors: true,
    color: '#cfe8ff',
    transparent: true,
    opacity: 0.9,
    blending: AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
  private sample = new Vector3();

  constructor() {
    const colours = new Float32Array(POINTS * 3);
    // additive, so black is clear: white at the plane, nothing at the far end
    for (let i = 0; i < POINTS; i++) colours.fill(Math.pow(1 - i / (POINTS - 1), 1.6), i * 3, i * 3 + 3);
    this.geometry.setAttribute('position', new BufferAttribute(this.positions, 3).setUsage(DynamicDrawUsage));
    this.geometry.setAttribute('color', new BufferAttribute(colours, 3));
    this.line = new Line(this.geometry, this.material);
    this.line.frustumCulled = false;
    this.line.visible = false;
  }

  update(t: number, path: FlightPath): void {
    this.line.visible = t > HERO_RELEASE + STAGE.openFrom && t < SHOW_TO;
    if (!this.line.visible) return;
    const end = heroParam(t);
    for (let i = 0; i < POINTS; i++) {
      path.pointAt(Math.max(end - (TAIL * i) / (POINTS - 1), 0), this.sample);
      this.positions[i * 3] = this.sample.x;
      this.positions[i * 3 + 1] = this.sample.y;
      this.positions[i * 3 + 2] = this.sample.z;
    }
    this.geometry.attributes.position!.needsUpdate = true;
    // in with the letter's opening, out as the plane climbs away
    const lit = MathUtils.smoothstep(t, HERO_RELEASE + STAGE.openFrom, HERO_RELEASE + STAGE.openTo + 0.004);
    this.material.opacity = 0.8 * lit * (1 - MathUtils.smoothstep(t, 0.1, SHOW_TO));
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
