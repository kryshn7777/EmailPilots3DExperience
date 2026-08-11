import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  Points,
  PointsMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';
import { PaperPlane } from './PaperPlane';
import { mulberry32 } from '../util';

/**
 * CH9: the on-device copilot — a smaller dart that slides onto the wing in
 * the radio-silent starfield. Instruments glow from within; no tether to
 * the ground, ever.
 */
export class Copilot {
  readonly group = new Group();
  private drone = new PaperPlane();
  private navLightMaterial: MeshStandardMaterial;
  private offset = new Vector3();
  private disposables: { dispose(): void }[] = [];

  constructor(anchor: Vector3) {
    this.drone.setFold(1);
    this.drone.group.scale.setScalar(0.45);
    this.group.add(this.drone.group);
    this.disposables.push(this.drone);

    this.navLightMaterial = new MeshStandardMaterial({
      color: '#062a33',
      emissive: '#9be8ff',
      emissiveIntensity: 2.5,
    });
    const navLight = new Mesh(new SphereGeometry(0.05, 8, 8), this.navLightMaterial);
    navLight.position.set(0, 0.06, -0.28);
    this.drone.group.add(navLight);
    this.disposables.push(navLight.geometry, this.navLightMaterial);

    // the starfield around the climb — the quiet, offline sky
    const rand = mulberry32(9);
    const positions: number[] = [];
    for (let i = 0; i < 700; i++) {
      positions.push(
        anchor.x - 60 + rand() * 120,
        anchor.y - 20 + rand() * 55,
        anchor.z - 60 + rand() * 120,
      );
    }
    const starGeometry = new BufferGeometry();
    starGeometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    const starMaterial = new PointsMaterial({
      color: '#cfe9ff',
      size: 0.14,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.9,
    });
    const stars = new Points(starGeometry, starMaterial);
    this.group.add(stars);
    this.disposables.push(starGeometry, starMaterial);
  }

  update(
    planePos: Vector3,
    planeQuat: Quaternion,
    side: Vector3,
    t: number,
    time: number,
  ): void {
    if (!this.group.visible) return;
    // slides in from below-right early in the chapter, then holds formation
    const enter = Math.min(Math.max((t - 0.79) / 0.03, 0), 1);
    const eased = enter * enter * (3 - 2 * enter);
    this.offset
      .copy(side)
      .multiplyScalar(-1.7)
      .add(new Vector3(0, 0.3 - (1 - eased) * 2.5, 0));
    this.drone.group.position.copy(planePos).add(this.offset);
    this.drone.group.position.y += Math.sin(time * 1.1 + 2) * 0.1;
    this.drone.group.quaternion.copy(planeQuat);
    this.navLightMaterial.emissiveIntensity = 1.5 + (Math.sin(time * 4) > 0.6 ? 2.5 : 0);
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
