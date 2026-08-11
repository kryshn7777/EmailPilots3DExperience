import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  Line,
  LineBasicMaterial,
  Vector3,
} from 'three';
import type { FlightPath } from '../rig/FlightPath';

const POINTS = 40;
const SHOW_TO = 0.16;

/**
 * The launch thread: scrolling draws the flight spline OUT of the laptop
 * screen — the line runs from the path's origin (on the display) to the
 * current t, and the paper plane rides its tip. Fades away once airborne.
 */
export class LaunchString {
  readonly line: Line;
  private positions = new Float32Array(POINTS * 3);
  private geometry = new BufferGeometry();
  private material = new LineBasicMaterial({
    color: '#cfe8ff',
    transparent: true,
    opacity: 0.9,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  private sample = new Vector3();

  constructor() {
    this.geometry.setAttribute(
      'position',
      new BufferAttribute(this.positions, 3).setUsage(DynamicDrawUsage),
    );
    this.line = new Line(this.geometry, this.material);
    this.line.frustumCulled = false;
    this.line.visible = false;
  }

  update(t: number, path: FlightPath): void {
    this.line.visible = t > 0.001 && t < SHOW_TO;
    if (!this.line.visible) return;
    const end = Math.min(t, SHOW_TO);
    for (let i = 0; i < POINTS; i++) {
      path.pointAt((end * i) / (POINTS - 1), this.sample);
      this.positions[i * 3] = this.sample.x;
      this.positions[i * 3 + 1] = this.sample.y;
      this.positions[i * 3 + 2] = this.sample.z;
    }
    this.geometry.attributes.position!.needsUpdate = true;
    // fade out as the plane climbs away
    this.material.opacity = 0.9 * (1 - Math.max(0, (t - 0.1) / (SHOW_TO - 0.1)));
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
