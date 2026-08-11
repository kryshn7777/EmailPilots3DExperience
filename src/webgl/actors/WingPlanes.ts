import { Group, MathUtils, Quaternion, Vector3 } from 'three';
import { PaperPlane } from './PaperPlane';

// climb-out window: clear pre-dawn sky — later chapters sit inside the
// cloud deck where the formation would drown in fog
const SHOW_FROM = 0.185;
const SHOW_TO = 0.305;

interface Mate {
  plane: PaperPlane;
  side: number;
  up: number;
  back: number;
  bob: number;
  leaveDir: Vector3;
  leaveBank: number;
}

/**
 * Other paper planes on the same airway: three darts slide in beside the
 * hero plane after takeoff, hold loose formation for a stretch, then bank
 * away on their own deliveries. Entirely t-driven — replays on every scroll.
 */
export class WingPlanes {
  readonly group = new Group();
  private mates: Mate[] = [];
  private offset = new Vector3();
  private quat = new Quaternion();
  private bank = new Quaternion();
  private zAxis = new Vector3(0, 0, 1);

  constructor() {
    const SLOTS: Omit<Mate, 'plane'>[] = [
      { side: 2.1, up: 0.4, back: 1.6, bob: 0, leaveDir: new Vector3(0.5, 0.55, 0.8), leaveBank: -1.1 },
      { side: -2.5, up: -0.3, back: 2.4, bob: 2.1, leaveDir: new Vector3(-0.7, 0.3, -0.5), leaveBank: 1.2 },
      { side: 3.4, up: 0.9, back: 3.4, bob: 4.4, leaveDir: new Vector3(1.0, -0.15, 0.4), leaveBank: -0.8 },
    ];
    for (const slot of SLOTS) {
      const plane = new PaperPlane();
      plane.setFold(1);
      plane.group.scale.setScalar(0.8);
      this.group.add(plane.group);
      this.mates.push({ plane, ...slot });
    }
  }

  update(
    planePos: Vector3,
    side: Vector3,
    tangent: Vector3,
    planeQuat: Quaternion,
    t: number,
    time: number,
  ): void {
    const fadeIn = MathUtils.smoothstep(t, SHOW_FROM, SHOW_FROM + 0.025);
    this.group.visible = t > SHOW_FROM && t < SHOW_TO;
    if (!this.group.visible) return;

    for (let i = 0; i < this.mates.length; i++) {
      const m = this.mates[i]!;
      // join from behind/below, hold formation, then bank away for good
      const join = MathUtils.smoothstep(t, SHOW_FROM + i * 0.008, SHOW_FROM + i * 0.008 + 0.03);
      const leave = MathUtils.smoothstep(t, 0.262 + i * 0.006, 0.296 + i * 0.006);
      const bobY = Math.sin(time * 1.1 + m.bob) * 0.16;

      this.offset
        .copy(planePos)
        .addScaledVector(side, m.side * (0.5 + 0.5 * join))
        .addScaledVector(tangent, -m.back - (1 - join) * 9)
        .addScaledVector(m.leaveDir, leave * 14);
      this.offset.y += m.up + bobY - (1 - join) * 3 + leave * m.leaveDir.y * 6;
      m.plane.group.position.copy(this.offset);

      // fly the hero's attitude, banking off it on entry and exit
      this.quat.copy(planeQuat);
      const bankAngle = (1 - join) * (m.side > 0 ? 0.6 : -0.6) + leave * m.leaveBank;
      this.bank.setFromAxisAngle(this.zAxis, bankAngle);
      this.quat.multiply(this.bank);
      m.plane.group.quaternion.copy(this.quat);

      m.plane.flex(time + m.bob, 1);
      m.plane.group.scale.setScalar(0.8 * fadeIn * (1 - leave));
    }
  }

  dispose(): void {
    for (const m of this.mates) m.plane.dispose();
  }
}
