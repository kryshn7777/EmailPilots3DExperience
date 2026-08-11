import {
  AdditiveBlending,
  BufferGeometry,
  Float32BufferAttribute,
  Points,
  PointsMaterial,
  Vector3,
} from 'three';
import { glowTexture } from '../bake/CanvasTextures';

const COUNT = 48;
const LIFE = 1.3;

/**
 * One-shot paper-scrap burst — fired the moment the fold completes. Reused
 * later for the landing confetti.
 */
export class PaperBurst {
  readonly points: Points;
  private geometry = new BufferGeometry();
  private material: PointsMaterial;
  private velocities: Float32Array;
  private origin = new Vector3();
  private startedAt = -Infinity;

  constructor(rand: () => number) {
    const positions = new Float32Array(COUNT * 3);
    this.velocities = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) {
      const theta = rand() * Math.PI * 2;
      const up = 0.6 + rand() * 1.6;
      const r = 0.6 + rand() * 1.4;
      this.velocities[i * 3] = Math.cos(theta) * r;
      this.velocities[i * 3 + 1] = up;
      this.velocities[i * 3 + 2] = Math.sin(theta) * r;
    }
    this.geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    this.material = new PointsMaterial({
      map: glowTexture(),
      color: '#f7f3ec',
      size: 0.07,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.points = new Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.visible = false;
  }

  trigger(origin: Vector3, time: number): void {
    this.origin.copy(origin);
    this.startedAt = time;
    this.points.visible = true;
  }

  update(time: number): void {
    const age = time - this.startedAt;
    if (age < 0 || age > LIFE) {
      this.points.visible = false;
      return;
    }
    const attr = this.geometry.attributes.position!;
    const arr = attr.array as Float32Array;
    for (let i = 0; i < COUNT; i++) {
      arr[i * 3] = this.origin.x + this.velocities[i * 3]! * age;
      arr[i * 3 + 1] = this.origin.y + this.velocities[i * 3 + 1]! * age - 1.4 * age * age;
      arr[i * 3 + 2] = this.origin.z + this.velocities[i * 3 + 2]! * age;
    }
    attr.needsUpdate = true;
    this.material.opacity = 0.9 * (1 - age / LIFE);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
