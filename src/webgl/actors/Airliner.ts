import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  LatheGeometry,
  Mesh,
  MeshStandardMaterial,
  Points,
  PointsMaterial,
  RepeatWrapping,
  Shape,
  SRGBColorSpace,
  Vector2,
} from 'three';
import { glowTexture } from '../bake/CanvasTextures';

/**
 * A single-aisle airliner, nose toward +x, up +y, starboard +z, about 7.4 units long (the
 * runway is 9 wide). The origin is the fuselage axis; the tyres touch ground at y = -wheelDrop.
 */
export const AIRLINER = { length: 7.4, wheelDrop: 0.72, mainGearX: -0.55, noseGearX: 2.55, wheelR: 0.12 };

/**
 * Livery for the lathe: u runs around the hull (0 and 1 are the starboard side, 0.25 the top,
 * 0.5 port, 0.75 the belly) and v from the nose to the tail. White hull, a navy and sky
 * cheatline, a row of cabin windows, cockpit glass, a grey belly.
 */
function liveryTexture(): CanvasTexture {
  const W = 256;
  const H = 1024;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#f4f5f4';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#b4bac6';
  ctx.fillRect(W * 0.64, 0, W * 0.22, H);
  const side = (u: number): void => {
    const cx = W * u;
    ctx.fillStyle = '#1b3c8c';
    ctx.fillRect(cx - W * 0.072, H * 0.03, W * 0.03, H * 0.92);
    ctx.fillStyle = '#4aa3e8';
    ctx.fillRect(cx - W * 0.036, H * 0.03, W * 0.008, H * 0.92);
    ctx.fillStyle = '#12161f';
    for (let i = 0; i < 30; i++) {
      // canvas y grows toward the tail's v = 0 end, so count down from the cockpit
      const y = H * (1 - (0.2 + i * 0.0215));
      ctx.fillRect(cx + W * 0.002, y, W * 0.022, H * 0.011);
    }
    ctx.fillRect(cx + W * 0.002, H * (1 - 0.135), W * 0.05, H * 0.012);
  };
  for (const u of [0, 0.5, 1]) side(u);
  // the tail cone picks up the navy
  ctx.fillStyle = '#1b3c8c';
  ctx.fillRect(0, 0, W, H * 0.04);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** A flat plate from a 2D outline (x, y), `depth` thick along +z. */
function plate(points: [number, number][], depth: number): ExtrudeGeometry {
  const shape = new Shape();
  shape.moveTo(points[0]![0], points[0]![1]);
  for (let i = 1; i < points.length; i++) shape.lineTo(points[i]![0], points[i]![1]);
  shape.closePath();
  return new ExtrudeGeometry(shape, { depth, bevelEnabled: false });
}

/**
 * The airliner: lathe fuselage, swept wings with winglets and dihedral, engines, fin and
 * tailplane, three gear legs. `wheels` spin, `gear` retracts, `body` pitches.
 */
export class Airliner {
  readonly group = new Group();
  readonly body = new Group();
  readonly gear = new Group();
  readonly wheels: Mesh[] = [];
  private strobe: PointsMaterial;
  private beacon: PointsMaterial;
  private disposables: { dispose(): void }[] = [];

  constructor() {
    const own = <T extends { dispose(): void }>(x: T): T => { this.disposables.push(x); return x; };
    const livery = own(liveryTexture());
    const white = own(new MeshStandardMaterial({ map: livery, roughness: 0.34, metalness: 0.12 }));
    const grey = own(new MeshStandardMaterial({ color: '#c4c9d1', roughness: 0.62, metalness: 0.08, side: DoubleSide }));
    const blue = own(new MeshStandardMaterial({ color: '#2457c9', roughness: 0.38, metalness: 0.2, side: DoubleSide }));
    const dark = own(new MeshStandardMaterial({ color: '#1a1d24', roughness: 0.6, metalness: 0.3 }));
    const rubber = own(new MeshStandardMaterial({ color: '#15161a', roughness: 0.85 }));
    const steel = own(new MeshStandardMaterial({ color: '#9aa1ad', roughness: 0.3, metalness: 0.85 }));
    const put = (g: BufferGeometry, m: MeshStandardMaterial, parent: Group = this.body): Mesh => {
      const mesh = new Mesh(own(g), m);
      parent.add(mesh);
      return mesh;
    };

    // fuselage: the lathe runs along +y from the nose; turned +90 degrees about z that becomes
    // -x, so the nose sits at x = +3.7 and the tail at -3.7 (u = 0 lands on the starboard side)
    const profile = ([
      [0.0, 0], [0.1, 0.06], [0.22, 0.22], [0.34, 0.5], [0.42, 0.95], [0.455, 1.6], [0.46, 2.6], [0.46, 4.4],
      [0.44, 5.3], [0.38, 6.0], [0.28, 6.7], [0.14, 7.2], [0.06, 7.4],
    ] as const).map(([r, y]) => new Vector2(r, y));
    const fuselage = put(new LatheGeometry(profile, 30), white);
    fuselage.rotation.z = Math.PI / 2;
    fuselage.position.x = AIRLINER.length / 2;

    // wings: swept and tapered, a little dihedral, a winglet at each tip
    const wing: [number, number][] = [[0.55, 0.36], [-0.95, 0.36], [-1.6, 3.55], [-1.2, 3.55]];
    for (const side of [1, -1]) {
      const root = new Group();
      root.rotation.x = -side * 0.05; // tips rise
      this.body.add(root);
      // shape y becomes span: +z (starboard) by turning +90 about x, -z by -90
      const slab = put(plate(wing, 0.075), grey, root);
      slab.rotation.x = side * (Math.PI / 2);
      slab.position.y = side === 1 ? -0.125 : -0.2;
      const winglet = put(plate([[0, 0], [-0.4, 0], [-0.55, 0.45], [-0.3, 0.45]], 0.04), blue, root);
      winglet.position.set(-1.2, -0.2, side === 1 ? 3.53 : -3.57);
      // engines under the wings, on short pylons
      const ez = side * 1.35;
      const nacelle = put(new CylinderGeometry(0.22, 0.2, 0.95, 20).rotateZ(Math.PI / 2), grey);
      nacelle.position.set(0.25, -0.52, ez);
      const intake = put(new CylinderGeometry(0.17, 0.17, 0.05, 20).rotateZ(Math.PI / 2), dark);
      intake.position.set(0.74, -0.52, ez);
      const nozzle = put(new CylinderGeometry(0.15, 0.12, 0.08, 20).rotateZ(Math.PI / 2), steel);
      nozzle.position.set(-0.25, -0.52, ez);
      const pylon = put(new BoxGeometry(0.5, 0.22, 0.05), grey);
      pylon.position.set(0.05, -0.32, ez);
    }

    // vertical fin, and the tailplane with the same turn as the wings
    const fin = put(plate([[-2.7, 0.38], [-3.7, 0.38], [-3.78, 2.15], [-3.4, 2.15]], 0.07), blue);
    fin.position.z = -0.035;
    const tailplane: [number, number][] = [[-3.0, 0.14], [-3.75, 0.14], [-4.1, 1.55], [-3.8, 1.55]];
    for (const side of [1, -1]) {
      const t = put(plate(tailplane, 0.05), grey);
      t.rotation.x = side * (Math.PI / 2);
      t.position.y = 0.12;
    }

    // landing gear: a nose leg and two main bogies, each leg with a pair of tyres
    const leg = (x: number, z: number): void => {
      const strut = put(new CylinderGeometry(0.03, 0.03, 0.5, 8), steel, this.gear);
      strut.position.set(x, -0.45, z);
      for (const dz of [-0.065, 0.065]) {
        const wheel = put(
          new CylinderGeometry(AIRLINER.wheelR, AIRLINER.wheelR, 0.09, 16).rotateX(Math.PI / 2), rubber, this.gear,
        );
        wheel.position.set(x, -AIRLINER.wheelDrop + AIRLINER.wheelR, z + dz);
        this.wheels.push(wheel);
      }
    };
    leg(AIRLINER.noseGearX, 0);
    leg(AIRLINER.mainGearX, 0.85);
    leg(AIRLINER.mainGearX, -0.85);
    this.body.add(this.gear);

    // lights: red port and green starboard at the wingtips, a white strobe on the tail and
    // wingtips, a red beacon on the spine, a bright lamp in the nose
    const glow = own(glowTexture());
    const dots = (positions: number[], color: string, size: number): PointsMaterial => {
      const g = own(new BufferGeometry());
      g.setAttribute('position', new Float32BufferAttribute(positions, 3));
      const m = own(new PointsMaterial({
        map: glow, color, size, transparent: true, depthWrite: false, blending: AdditiveBlending, sizeAttenuation: true,
      }));
      const p = new Points(g, m);
      p.frustumCulled = false;
      this.body.add(p);
      return m;
    };
    dots([-1.2, -0.1, -3.57], '#ff3b30', 0.45);
    dots([-1.2, -0.1, 3.53], '#3bff7a', 0.45);
    this.strobe = dots([-3.95, 0.2, 0, -1.6, -0.1, 3.53, -1.6, -0.1, -3.57], '#ffffff', 0.75);
    this.beacon = dots([0.2, 0.5, 0], '#ff3b30', 0.5);
    dots([3.6, -0.15, 0], '#fff4d8', 0.9);

    this.group.add(this.body);
    this.group.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh) m.castShadow = true;
    });
  }

  /** Strobes and the beacon flash; call every frame. */
  blink(time: number): void {
    const flash = (time * 1.1) % 1;
    this.strobe.opacity = flash < 0.06 || (flash > 0.14 && flash < 0.2) ? 1 : 0;
    this.beacon.opacity = Math.sin(time * 5) > 0.2 ? 0.9 : 0.12;
  }

  /** Spin the tyres for `distance` travelled, retract the legs when `up` is 1. */
  rollAndGear(distance: number, up: number): void {
    for (const w of this.wheels) w.rotation.z = -distance / AIRLINER.wheelR;
    this.gear.visible = up < 0.98;
    this.gear.scale.y = Math.max(0.01, 1 - up);
    this.gear.position.y = up * 0.35;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
