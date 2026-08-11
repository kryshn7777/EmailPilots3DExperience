import { CatmullRomCurve3, Group, MathUtils, Vector3 } from 'three';
import { PaperPlane } from './PaperPlane';
import { mulberry32 } from '../util';
import type { FlightPath } from '../rig/FlightPath';

interface Cameo {
  plane: PaperPlane;
  curve: CatmullRomCurve3;
  from: number;
  to: number;
  bank: number;
  wobble: number;
  scale: number;
}

/**
 * Airway traffic: other people's mail. Each cameo flies its OWN spline —
 * entering from a random side, cutting somewhere near the corridor, and
 * leaving in its own direction — visible only for a brief t-window, so
 * every scroll-through replays the same fleeting encounters.
 */
export class Traffic {
  readonly group = new Group();
  private cameos: Cameo[] = [];
  private pos = new Vector3();
  private ahead = new Vector3();

  constructor(path: FlightPath) {
    const rand = mulberry32(260809);
    // window centers avoid the room, the landing, and the copilot's silence
    const CENTERS = [0.148, 0.205, 0.268, 0.335, 0.455, 0.53, 0.7, 0.79];
    for (const center of CENTERS) {
      const width = 0.028 + rand() * 0.014;
      const anchor = path.storyPoint(center + width / 2);
      const side = rand() < 0.5 ? 1 : -1;
      const overtake = rand() < 0.25;

      let points: Vector3[];
      if (overtake) {
        // same heading, faster — slides past along the corridor
        const lane = side * (2.5 + rand() * 2);
        points = [
          new Vector3(anchor.x - 22, anchor.y - 1 + rand() * 2, anchor.z + lane),
          new Vector3(anchor.x - 6, anchor.y + rand() * 1.5, anchor.z + lane * 0.7),
          new Vector3(anchor.x + 10, anchor.y + 0.5 + rand(), anchor.z + lane * 1.2),
          new Vector3(anchor.x + 26, anchor.y + 1 + rand() * 3, anchor.z + lane * 2.2),
        ];
      } else {
        // crossing traffic: in from one side, out the other, own altitude arc
        const inZ = side * (16 + rand() * 8);
        const outZ = -side * (12 + rand() * 10);
        const rise = (rand() - 0.4) * 7;
        points = [
          new Vector3(anchor.x + 14 + rand() * 8, anchor.y + 2 + rand() * 4, anchor.z + inZ),
          new Vector3(anchor.x + 5, anchor.y + 1 + rand() * 2, anchor.z + inZ * 0.35),
          new Vector3(anchor.x - 3, anchor.y + rand() * 1.5 - 0.5, anchor.z + outZ * 0.3),
          new Vector3(anchor.x - 12 - rand() * 8, anchor.y + rise, anchor.z + outZ),
        ];
      }

      const plane = new PaperPlane();
      plane.setFold(1);
      const scale = 0.55 + rand() * 0.35;
      plane.group.scale.setScalar(scale);
      plane.group.visible = false;
      this.group.add(plane.group);
      this.cameos.push({
        plane,
        curve: new CatmullRomCurve3(points),
        from: center,
        to: center + width,
        bank: (rand() - 0.5) * 0.9,
        wobble: rand() * 6.28,
        scale,
      });
    }
  }

  update(t: number, time: number): void {
    let any = false;
    for (const c of this.cameos) {
      const u = (t - c.from) / (c.to - c.from);
      const active = u > 0 && u < 1;
      c.plane.group.visible = active;
      if (!active) continue;
      any = true;

      const eased = u * u * (3 - 2 * u);
      c.curve.getPointAt(eased, this.pos);
      this.pos.y += Math.sin(time * 1.3 + c.wobble) * 0.12;
      c.plane.group.position.copy(this.pos);
      c.curve.getPointAt(Math.min(eased + 0.03, 1), this.ahead);
      this.ahead.y += Math.sin(time * 1.3 + c.wobble) * 0.12;
      c.plane.group.lookAt(this.ahead);
      c.plane.group.rotateZ(c.bank + Math.sin(time * 0.9 + c.wobble) * 0.12);
      c.plane.flex(time + c.wobble, 1);
      // brief: swell in, hold, shrink out
      c.plane.group.scale.setScalar(c.scale * MathUtils.clamp(Math.sin(u * Math.PI) * 2.2, 0, 1));
    }
    this.group.visible = any;
  }

  dispose(): void {
    for (const c of this.cameos) c.plane.dispose();
  }
}
