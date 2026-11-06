import { Group, MathUtils, Matrix4, Quaternion, Vector3 } from 'three';
import { FLEET } from '../../story/fleet';
import { PaperPlane } from './PaperPlane';

// climb-out window: clear pre-dawn sky — later chapters sit inside the
// cloud deck where the formation would drown in fog
const SHOW_FROM = 0.185;
/** the three are rows 3-5 of the campaign (Dev, Eli, Finn): each dives off to its own delivery */
const ROWS = [2, 3, 4] as const;
/** how long the dive from the wing down to the delivery takes, in story-t */
const DIVE = 0.013;
const UP = new Vector3(0, 1, 0);

/** a wing mate as BatchFleet reads it: its FLEET row index, its dive window, where it is and whether it is drawn */
export interface WingMate { row: number; from: number; land: number; at: Vector3; shown: boolean }

interface Mate {
  plane: PaperPlane;
  side: number;
  up: number;
  back: number;
  bob: number;
  leaveDir: Vector3;
  leaveBank: number;
  /** its row (index into FLEET), when it leaves the wing and when it lands */
  row: number;
  from: number;
  land: number;
  /** where it dives to (world), once BatchFleet has picked a spot in view; null: it banks away */
  target: Vector3 | null;
  /** where it is this frame (for the HUD's chip) */
  at: Vector3;
  /** what BatchFleet reads (one object per mate, updated in place) */
  view: WingMate;
}

/**
 * Other paper planes on the same airway: three darts slide in beside the hero plane after takeoff
 * and hold loose formation, then, one at a time, each dives off to its own delivery: rows 3, 4 and 5
 * of the sample campaign (src/story/fleet.ts). BatchFleet picks where each lands (a spot in the town
 * the camera has in view at that moment) and raises the light column there; this flies the dive.
 * Entirely t-driven: replays on every scroll.
 */
export class WingPlanes {
  readonly group = new Group();
  private mates: Mate[] = [];
  private offset = new Vector3();
  private dir = new Vector3();
  private quat = new Quaternion();
  private bank = new Quaternion();
  private m4 = new Matrix4();
  private zAxis = new Vector3(0, 0, 1);
  private origin = new Vector3();

  constructor() {
    const SLOTS = [
      { side: 2.1, up: 0.4, back: 1.6, bob: 0, leaveDir: new Vector3(0.5, 0.55, 0.8), leaveBank: -1.1 },
      { side: -2.5, up: -0.3, back: 2.4, bob: 2.1, leaveDir: new Vector3(-0.7, 0.3, -0.5), leaveBank: 1.2 },
      { side: 3.4, up: 0.9, back: 3.4, bob: 4.4, leaveDir: new Vector3(1.0, -0.15, 0.4), leaveBank: -0.8 },
    ];
    SLOTS.forEach((slot, i) => {
      const plane = new PaperPlane();
      plane.setFold(1);
      plane.group.scale.setScalar(0.8);
      this.group.add(plane.group);
      const row = ROWS[i]!;
      const land = FLEET[row]!.land;
      const at = new Vector3();
      this.mates.push({ plane, ...slot, row, from: land - DIVE, land, target: null, at, view: { row, from: land - DIVE, land, at, shown: false } });
    });
  }

  /** where mate `i` dives to (world space) */
  setTarget(i: number, at: Vector3): void {
    const m = this.mates[i];
    if (m) m.target = at.clone();
  }

  /** mate `i`: its row, its dive window, where it is now and whether it is drawn */
  mate(i: number): WingMate | null {
    const m = this.mates[i];
    if (!m) return null;
    m.view.shown = m.plane.group.visible && this.group.visible;
    return m.view;
  }

  get count(): number {
    return this.mates.length;
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
    const last = this.mates[this.mates.length - 1]!.land;
    this.group.visible = t > SHOW_FROM && t < last;
    if (!this.group.visible) return;

    for (let i = 0; i < this.mates.length; i++) {
      const m = this.mates[i]!;
      // join from behind/below and hold formation (the dive is below)
      const join = MathUtils.smoothstep(t, SHOW_FROM + i * 0.008, SHOW_FROM + i * 0.008 + 0.03);
      const bobY = Math.sin(time * 1.1 + m.bob) * 0.16;
      this.offset
        .copy(planePos)
        .addScaledVector(side, m.side * (0.5 + 0.5 * join))
        .addScaledVector(tangent, -m.back - (1 - join) * 9);
      this.offset.y += m.up + bobY - (1 - join) * 3;

      const x = MathUtils.clamp((t - m.from) / (m.land - m.from), 0, 1);
      const on = t < m.land;
      m.plane.group.visible = on;
      if (!on) continue;
      this.quat.copy(planeQuat);
      let bankAngle = (1 - join) * (m.side > 0 ? 0.6 : -0.6);
      if (x > 0 && m.target) {
        // the dive: off the wing, bank outward, then down onto the spot, accelerating
        const e = x * x * (3 - 2 * x);
        const pull = x * x;
        this.dir.copy(m.target).sub(this.offset);
        const span = this.dir.length();
        this.offset.addScaledVector(this.dir, pull).addScaledVector(side, Math.sign(m.side) * span * 0.12 * Math.sin(Math.PI * x));
        this.offset.y += span * 0.05 * Math.sin(Math.PI * x);
        // nose along the way it is going: the hero's heading at first, the spot's by the end
        this.dir.normalize().lerp(tangent, 1 - e).normalize();
        this.m4.lookAt(this.dir, this.origin, UP);
        this.quat.setFromRotationMatrix(this.m4);
        bankAngle += -Math.sign(m.side) * 0.9 * Math.sin(Math.PI * Math.min(x * 1.4, 1));
      } else if (x > 0) {
        // no spot picked yet: bank away for good, as before
        this.offset.addScaledVector(m.leaveDir, x * 14);
        this.offset.y += x * m.leaveDir.y * 6;
        bankAngle += x * m.leaveBank;
      }
      m.plane.group.position.copy(this.offset);
      m.at.copy(this.offset);
      this.bank.setFromAxisAngle(this.zAxis, bankAngle);
      this.quat.multiply(this.bank);
      m.plane.group.quaternion.copy(this.quat);

      m.plane.flex(time + m.bob, 1);
      m.plane.group.scale.setScalar(Math.max(0.8 * fadeIn * (m.target ? 1 : 1 - x), 1e-4));
    }
  }

  dispose(): void {
    for (const m of this.mates) m.plane.dispose();
  }
}
