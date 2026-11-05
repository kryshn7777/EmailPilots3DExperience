import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  MathUtils,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NoColorSpace,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Quaternion,
  RepeatWrapping,
  RingGeometry,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  TextureLoader,
  Vector3,
  Vector4,
  type Texture,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { glowTexture } from '../bake/CanvasTextures';
import { asset } from '../asset';
import { mulberry32 } from '../util';
import type { Quality } from '../quality';
import { dequantized, KitCity } from './KitCity';
import { litByLamps } from './CityLife';
import type { Stand, Walk } from './Pedestrians';

/** a metre in the night city (its people and cars are drawn 1.35 times the town's 0.33 a metre) */
const K = 0.33 * 1.35;
/** the chairs' seat and the tables' top (blender/make_cafe_props.py: SEAT, TOP), in city units */
export const CAFE_SEAT = 0.46 * K;
const TOP = 0.74 * K;
/**
 * The terrace's own mail: a dart of the batch peels off the flight at `from` and lands on a street-side
 * table at `land` (story-t), where the camera, just down in the canyon, has the terrace ahead on its left.
 * BatchFleet flies it and counts it; the terrace answers the landing (the ping, the envelope, the wave).
 */
export const CAFE_DELIVERY = { from: 0.695, land: 0.714 } as const;

type Rect = { x0: number; x1: number; z0: number; z1: number };
interface Item { k: string; x: number; z: number; yaw: number; y?: number }

/**
 * The night city's restaurant terrace, Trattoria Luna, on the plaza CityStreet leaves it (the north
 * side of the canyon, where the flight comes down into the street): two rows of marble bistro tables
 * laid for two with bentwood chairs, market parasols over them (striped, green and one in the brand's
 * teal), a planter fence along the pavement with a gap where the chalk menu stands, festoon lights
 * strung from posts to the wall, a striped awning and a lit sign over the door, candles on the tables.
 * The props are Blender models (public/models/cafe, one atlas) merged into ONE mesh: the near models
 * on HIGH, the lean ones on phones. The diners and the waiter are the crowd's own people (Pedestrians,
 * seated pose); this only says where they sit and walk.
 *
 * It also answers its delivery: once the dart has landed on its table, a ring pings out over the
 * table, an envelope glows above it, the candle flares and the diners there look up and wave (a
 * uniform of the crowd's shader). All of it a function of story-t, so it scrubs both ways.
 */
export class CafeTerrace {
  readonly group = new Group();
  readonly stands: Stand[] = [];
  readonly walks: Walk[] = [];
  readonly occupied: { x: number; z: number; r: number }[] = [];
  /** the street-side tables with someone at them: where a delivery may land (group frame, top centre) */
  readonly tables: { x: number; y: number; z: number; seats: number }[] = [];
  private items: Item[] = [];
  private target = -1;
  private propTris = 0;
  private high: boolean;
  private warm = { value: [] as Vector4[] };
  private candles: Points | null = null;
  private flare: Points;
  private flareMaterial: PointsMaterial;
  private ring: Mesh;
  private ringMaterial: MeshBasicMaterial;
  private envelope: Sprite;
  private envelopeMaterial: SpriteMaterial;
  private disposables: { dispose(): void }[] = [];

  constructor(rect: Rect, quality: Quality, private origin: Vector3) {
    this.high = quality.tier === 'high';
    const own = <T extends { dispose(): void }>(x: T): T => { this.disposables.push(x); return x; };
    const rand = mulberry32(5150);
    // which way the street is: the terrace's "near" edge is the pavement's, its far edge the building's face
    const side = rect.z0 + rect.z1 > 0 ? 1 : -1;
    const near = Math.min(Math.abs(rect.z0), Math.abs(rect.z1));
    const far = Math.max(Math.abs(rect.z0), Math.abs(rect.z1));
    const Z = (d: number): number => side * d;
    // toward the street, as a yaw for a prop that faces +z
    const faceStreet = side < 0 ? 0 : Math.PI;
    const x0 = rect.x0 + 0.3;
    const x1 = rect.x1 - 0.3;
    const len = x1 - x0;
    const planterZ = near + 0.1;
    const waiterZ = near + 0.31;
    const row1 = near + 0.62;
    const row2 = Math.min(near + 1.38, far - 0.36);
    // a deep plaza takes a third row along the wall
    const row3 = far - near >= 2.45 ? Math.min(near + 2.12, far - 0.34) : null;
    const parasolZ = (row1 + row2) / 2;
    const add = (k: string, x: number, z: number, yaw = 0): void => { this.items.push({ k, x, z, yaw }); };

    // ---- the fence line: planters along the pavement, a gap for the way in with the menu board in it
    const gapX = x0 + len * 0.42;
    const PL = 1.2 * K;
    for (const [a, b] of [[x0, gapX - 0.45], [gapX + 0.45, x1]] as const) {
      const n = Math.max(1, Math.floor((b - a) / (PL + 0.06)));
      for (let i = 0; i < n; i++) {
        const x = a + (b - a) * ((i + 0.5) / n);
        add('planter', x, Z(planterZ), 0);
        this.occupied.push({ x, z: Z(planterZ), r: 0.28 });
      }
    }
    add('menu', gapX + 0.25, Z(near + 0.12), faceStreet + 0.35 * side);
    this.occupied.push({ x: gapX + 0.25, z: Z(near + 0.12), r: 0.16 });

    // ---- tables: two rows, the back row staggered; chairs either side along the street, people in most
    const pitch = 1.15;
    const n1 = Math.max(2, Math.floor(len / pitch));
    const rows: { z: number; xs: number[]; street: boolean }[] = [
      { z: row1, xs: Array.from({ length: n1 }, (_, i) => x0 + (i + 0.5) * (len / n1)), street: true },
      { z: row2, xs: Array.from({ length: n1 - 1 }, (_, i) => x0 + (i + 1) * (len / n1)).filter((_, i) => this.high || i % 2 === 0), street: false },
    ];
    if (row3 !== null) {
      rows.push({ z: row3, xs: Array.from({ length: n1 }, (_, i) => x0 + (i + 0.5) * (len / n1)).filter((_, i) => this.high || i % 2 === 1), street: false });
    }
    let group = 900;
    const seatOff = 0.55 * K;
    for (const row of rows) {
      for (const tx of row.xs) {
        const x = tx + (rand() - 0.5) * 0.12;
        const z = Z(row.z + (rand() - 0.5) * 0.06);
        add(rand() < 0.5 ? 'table-a' : 'table-b', x, z, Math.PI / 2 + (rand() - 0.5) * 0.4);
        this.occupied.push({ x, z, r: 0.42 });
        group++;
        let seated = 0;
        for (const sgn of [-1, 1]) {
          // the person faces the table: yaw 0 faces +x; the chair (front +z) turns a quarter more
          const theta = (sgn < 0 ? 0 : Math.PI) + (rand() - 0.5) * 0.3;
          const dx = Math.cos(theta);
          const dz = -Math.sin(theta);
          const cx = x - dx * seatOff;
          const cz = z - dz * seatOff;
          add('chair', cx, cz, theta + Math.PI / 2);
          const p = row.street ? 0.92 : this.high ? 0.78 : 0.6;
          if (rand() < p) {
            seated++;
            // the hip is a hand's width behind the middle of the seat
            this.stands.push({ x: cx - dx * 0.06 * K, z: cz - dz * 0.06 * K, yaw: theta, mood: 'eat', group });
          }
        }
        this.warm.value.push(new Vector4(x, TOP + 0.05, z, 0.5));
        if (row.street && seated) this.tables.push({ x, y: TOP, z, seats: seated });
      }
    }

    // ---- parasols between the rows, festoon posts at the ends and either side of the way in
    const PARASOLS = ['parasol-stripe', 'parasol-green', 'parasol-brand', 'parasol-stripe', 'parasol-green'];
    const nP = Math.max(2, Math.round(len / 2.1));
    const bands = row3 !== null ? [parasolZ, (row2 + row3) / 2] : [parasolZ];
    let kP = 0;
    bands.forEach((bz, b) => {
      for (let i = 0; i < nP - b; i++) {
        const x = x0 + (i + 0.5 + 0.5 * b) * (len / nP) + (rand() - 0.5) * 0.15;
        add(PARASOLS[kP++ % PARASOLS.length]!, x, Z(bz), rand() * Math.PI);
        this.occupied.push({ x, z: Z(bz), r: 0.16 });
      }
    });
    const posts = [x0 + 0.05, gapX - 0.42, gapX + 0.42, x1 - 0.05];
    for (const x of posts) {
      add('post', x, Z(planterZ - 0.02), 0);
      this.occupied.push({ x, z: Z(planterZ), r: 0.08 });
    }
    // nothing else stands on the terrace: CityLife's clutter keeps out of all of it
    for (let x = rect.x0 + 0.3; x < rect.x1; x += 0.6) {
      for (let d = near + 0.3; d < far; d += 0.6) this.occupied.push({ x, z: Z(d), r: 0.32 });
    }

    // ---- the waiter, up and down between the planters and the front row
    this.walks.push({
      points: [[x0 + 0.4, Z(waiterZ)], [x1 - 0.4, Z(waiterZ)]], width: 0.14, count: 1, ends: 'turn', pause: [1.5, 4.5], late: true,
    });

    // ---- the lights: festoons from the posts to the wall and along the front, candles on the tables
    const POST_TOP = 2.62 * K;
    const WALL_Y = 1.32;
    const bulbs: number[] = [];
    const wire: number[] = [];
    const string = (a: Vector3, b: Vector3, sag: number): void => {
      const n = Math.max(4, Math.round(a.distanceTo(b) / 0.22));
      let px = a.x;
      let py = a.y;
      let pz = a.z;
      for (let i = 1; i <= n; i++) {
        const u = i / n;
        const x = MathUtils.lerp(a.x, b.x, u);
        const y = MathUtils.lerp(a.y, b.y, u) - sag * 4 * u * (1 - u);
        const z = MathUtils.lerp(a.z, b.z, u);
        wire.push(px, py, pz, x, y, z);
        if (i < n) bulbs.push(x, y - 0.025, z);
        px = x; py = y; pz = z;
      }
    };
    const top = (x: number): Vector3 => new Vector3(x, POST_TOP, Z(planterZ - 0.02));
    const wallAt = (x: number): Vector3 => new Vector3(x, WALL_Y, Z(far - 0.03));
    for (let i = 0; i < posts.length - 1; i++) {
      if (i === 1) continue; // the way in: the string runs over it from the wall instead
      string(top(posts[i]!), top(posts[i + 1]!), 0.12);
    }
    for (const x of posts) string(top(x), wallAt(x + (x < gapX ? 0.6 : -0.6)), 0.16);
    // zigzags over the tables, wall to wall points between the posts
    for (let i = 0; i < posts.length - 1; i++) {
      const xa = posts[i]!;
      const xb = posts[i + 1]!;
      string(wallAt(xa + 0.6), top((xa + xb) / 2).setY(POST_TOP - 0.05), 0.12);
      string(top((xa + xb) / 2).setY(POST_TOP - 0.05), wallAt(xb - 0.6), 0.12);
    }
    const glow = own(glowTexture());
    const bulbGeometry = own(new BufferGeometry());
    bulbGeometry.setAttribute('position', new Float32BufferAttribute(bulbs, 3));
    const bulbPoints = new Points(bulbGeometry, own(new PointsMaterial({
      map: glow, size: 0.15, color: '#ffc879', transparent: true, depthWrite: false, blending: AdditiveBlending, sizeAttenuation: true,
    })));
    bulbPoints.frustumCulled = false;
    this.group.add(bulbPoints);
    const wireGeometry = own(new BufferGeometry());
    wireGeometry.setAttribute('position', new Float32BufferAttribute(wire, 3));
    const wires = new LineSegments(wireGeometry, own(new LineBasicMaterial({ color: '#141210' })));
    wires.frustumCulled = false;
    this.group.add(wires);
    // the bulbs light what is under them a little: a few of them as warm fake lights in the props' shader
    for (let i = 0; i < bulbs.length; i += 3 * 9) this.warm.value.push(new Vector4(bulbs[i]!, bulbs[i + 1]!, bulbs[i + 2]!, 0.35));
    const candleGeometry = own(new BufferGeometry());
    candleGeometry.setAttribute('position', new Float32BufferAttribute(
      this.items.filter((it) => it.k.startsWith('table')).flatMap((t) => [t.x, TOP + 0.05, t.z]), 3));
    this.candles = new Points(candleGeometry, own(new PointsMaterial({
      map: glow, size: 0.22, color: '#ffae5c', transparent: true, depthWrite: false, blending: AdditiveBlending, sizeAttenuation: true,
    })));
    this.candles.frustumCulled = false;
    this.group.add(this.candles);
    // a warm pool on the paving under the whole terrace
    const pool = new Mesh(own(new PlaneGeometry(len + 1.2, far - near + 0.8)), own(new MeshBasicMaterial({
      map: glow, color: '#ffa24d', transparent: true, opacity: 0.22, blending: AdditiveBlending, depthWrite: false, toneMapped: false,
    })));
    pool.rotation.x = -Math.PI / 2;
    pool.position.set((x0 + x1) / 2, 0.022, Z((near + far) / 2));
    this.group.add(pool);

    // ---- the front: a striped awning over the door and windows, and the lit sign above it
    const awningTex = own(stripeTexture());
    const awningMaterial = own(new MeshStandardMaterial({ map: awningTex, roughness: 0.85, side: DoubleSide }));
    const aw = Math.min(len * 0.62, 5.2);
    const awning = new Mesh(own(new PlaneGeometry(aw, 0.62)), awningMaterial);
    awningTex.repeat.set(aw / 0.5, 1);
    // hung from the wall at 1.42, sloping out and down to 1.16, 0.58 out from it
    awning.position.set(gapX + 0.3, 1.29, Z(far - 0.27));
    awning.rotation.set(side < 0 ? -Math.PI / 2 + 0.43 : Math.PI / 2 - 0.43, 0, 0);
    if (side > 0) awning.rotation.y = Math.PI;
    this.group.add(awning);
    const valance = new Mesh(own(new PlaneGeometry(aw, 0.12)), awningMaterial);
    valance.position.set(gapX + 0.3, 1.1, Z(far - 0.55));
    valance.rotation.y = faceStreet;
    this.group.add(valance);
    const signTex = own(signTexture());
    const sign = new Mesh(own(new PlaneGeometry(2.2, 0.385)), own(new MeshBasicMaterial({ map: signTex, transparent: true, toneMapped: false })));
    sign.position.set(gapX + 0.3, 1.82, Z(far - 0.03));
    sign.rotation.y = faceStreet;
    this.group.add(sign);
    this.warm.value.push(new Vector4(gapX + 0.3, 1.7, Z(far - 0.3), 0.6));

    // ---- the delivery's answer: a ping ring, a glowing envelope, the candle's flare
    this.ringMaterial = own(new MeshBasicMaterial({
      color: '#6ff2d8', transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, toneMapped: false,
    }));
    this.ring = new Mesh(own(new RingGeometry(0.16, 0.2, 40)), this.ringMaterial);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.visible = false;
    this.group.add(this.ring);
    this.envelopeMaterial = own(new SpriteMaterial({ map: own(envelopeTexture()), transparent: true, depthWrite: false, toneMapped: false, opacity: 0 }));
    this.envelope = new Sprite(this.envelopeMaterial);
    this.envelope.scale.set(0.44, 0.44, 1);
    this.envelope.visible = false;
    this.group.add(this.envelope);
    const flareGeometry = own(new BufferGeometry());
    flareGeometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0], 3));
    this.flareMaterial = own(new PointsMaterial({
      map: glow, size: 0.5, color: '#ffc070', transparent: true, opacity: 0, depthWrite: false, blending: AdditiveBlending, sizeAttenuation: true,
    }));
    this.flare = new Points(flareGeometry, this.flareMaterial);
    this.flare.frustumCulled = false;
    this.flare.visible = false;
    this.group.add(this.flare);
    // a default table until the batch fleet picks one in view: the street-side table nearest the middle
    if (this.tables.length) this.setTarget(Math.floor(this.tables.length * 0.6));

    void this.load().catch((e: unknown) => console.warn('CafeTerrace: no props', e));
  }

  /** the table the delivery lands on (an index into `tables`) */
  setTarget(i: number): void {
    if (!this.tables[i]) return;
    this.target = i;
    const t = this.tables[i]!;
    this.ring.position.set(t.x, t.y + 0.012, t.z);
    this.envelope.position.set(t.x, t.y + 0.42, t.z);
    this.flare.position.set(t.x, t.y + 0.05, t.z);
  }

  /** the delivery's table top in world space (where the dart comes to rest), or null */
  targetWorld(out: Vector3): Vector3 | null {
    const t = this.tables[this.target];
    return t ? out.set(t.x, t.y, t.z).add(this.origin) : null;
  }

  /** where a delivery could land, in world space, as indices into `tables` */
  candidates(): { index: number; at: Vector3 }[] {
    return this.tables.map((t, index) => ({ index, at: new Vector3(t.x, t.y, t.z).add(this.origin) }));
  }

  private async load(): Promise<void> {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.loadAsync(asset('/models/cafe/cafe.glb'));
    const src = new Map<string, BufferGeometry>();
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh) return;
      const name = m.name.replace(/\.\d+$/, '');
      const lean = name.endsWith('-lean');
      if (lean === this.high) return;
      const g = dequantized(m.geometry).applyMatrix4(m.matrixWorld);
      for (const a of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(a)) g.deleteAttribute(a);
      src.set(name.replace(/-lean$/, ''), g);
    });
    const m4 = new Matrix4();
    const q = new Quaternion();
    const p = new Vector3();
    const sc = new Vector3(K, K, K);
    const Y = new Vector3(0, 1, 0);
    const parts: BufferGeometry[] = [];
    for (const it of this.items) {
      const g = src.get(it.k);
      if (!g) continue;
      parts.push(g.clone().applyMatrix4(m4.compose(p.set(it.x, it.y ?? 0, it.z), q.setFromAxisAngle(Y, it.yaw), sc)));
    }
    for (const g of src.values()) g.dispose();
    if (!parts.length) return;
    const merged = mergeGeometries(parts, false);
    parts.forEach((g) => g.dispose());
    if (!merged) return;
    merged.computeBoundingSphere();
    this.propTris = (merged.index ? merged.index.count : merged.attributes.position!.count) / 3;
    this.disposables.push(merged);

    const tex = (file: string, srgb: boolean): Texture => {
      const t = new TextureLoader().load(asset(`/models/cafe/${file}`));
      t.flipY = false;
      t.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
      t.anisotropy = 4;
      this.disposables.push(t);
      return t;
    };
    const material = new MeshStandardMaterial({
      map: tex(this.high ? 'atlas-color.webp' : 'atlas-color-low.webp', true),
      roughnessMap: tex('atlas-orm.webp', false),
      roughness: 1,
      metalness: 0.05,
      side: DoubleSide,
      ...(this.high ? { normalMap: tex('atlas-normal.webp', false) } : {}),
    });
    litByLamps(material, this.origin, this.high ? 3 : 6, this.warm);
    KitCity.adopt(material, 0.5);
    this.disposables.push(material);
    const mesh = new Mesh(merged, material);
    mesh.castShadow = false;
    mesh.receiveShadow = this.high;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.group.add(mesh);
  }

  /** for the probe: the props' triangles (one draw) and how many props */
  get stats(): { tris: number; items: number } {
    return { tris: this.propTris, items: this.items.length };
  }

  /**
   * The delivery's answer, at story-t `t` (`time` in seconds, for the bob and the candles' flicker).
   * Returns how much the diners at the table wave (0..1), for the crowd's shader.
   */
  update(t: number, time: number): number {
    const { land } = CAFE_DELIVERY;
    const on = this.target >= 0 && t >= land && t < land + 0.05;
    this.ring.visible = on;
    this.envelope.visible = on;
    this.flare.visible = on;
    if (this.candles) (this.candles.material as PointsMaterial).size = 0.2 + 0.02 * Math.sin(time * 7.3);
    if (!on) return 0;
    const u = t - land;
    // two pings out across the table and beyond it
    const ping = (u / 0.011) % 1;
    const nPing = Math.floor(u / 0.011);
    const r = 1 + ping * 3;
    this.ring.scale.set(r, r, 1);
    this.ringMaterial.opacity = nPing < 3 ? 0.9 * (1 - ping) : 0;
    // the envelope rises off the table, glows, bobs, and goes
    const up = MathUtils.smoothstep(u, 0, 0.006);
    const out = 1 - MathUtils.smoothstep(u, 0.034, 0.048);
    const tt = this.tables[this.target]!;
    this.envelope.position.y = tt.y + 0.16 + 0.26 * up + 0.025 * Math.sin(time * 2.4);
    this.envelopeMaterial.opacity = up * out;
    // the candle flares as it lands, then settles
    this.flareMaterial.opacity = Math.max(0, 1 - u / 0.02) * 0.9 + 0.15 * out;
    this.flareMaterial.size = 0.3 + 0.5 * Math.max(0, 1 - u / 0.015);
    return MathUtils.smoothstep(u, 0.001, 0.005) * (1 - MathUtils.smoothstep(u, 0.03, 0.042));
  }

  /** the delivery table, in the crowd's frame (the city group's) */
  get waveAt(): { x: number; z: number } | null {
    const t = this.tables[this.target];
    return t ? { x: t.x, z: t.z } : null;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}

/** the awning's canvas: cream and wine-red stripes, a little weathered */
function stripeTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 32;
  const g = c.getContext('2d')!;
  g.fillStyle = '#e9dfc8';
  g.fillRect(0, 0, 64, 32);
  g.fillStyle = '#8f2430';
  g.fillRect(0, 0, 32, 32);
  const shade = g.createLinearGradient(0, 0, 0, 32);
  shade.addColorStop(0, 'rgba(0,0,0,0.18)');
  shade.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = shade;
  g.fillRect(0, 0, 64, 32);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = RepeatWrapping;
  return t;
}

/** the sign over the door: TRATTORIA LUNA in warm lit letters on a dark board, a crescent moon */
function signTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 640;
  c.height = 112;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(22,16,12,0.92)';
  g.beginPath();
  g.roundRect(4, 4, 632, 104, 14);
  g.fill();
  g.strokeStyle = '#c9a25a';
  g.lineWidth = 3;
  g.stroke();
  g.shadowColor = '#ffb45a';
  g.shadowBlur = 18;
  g.fillStyle = '#ffe2a8';
  g.font = '600 50px Georgia, "Times New Roman", serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('TRATTORIA LUNA', 350, 58);
  // the moon
  g.beginPath();
  g.arc(52, 56, 24, 0, Math.PI * 2);
  g.fill();
  g.shadowBlur = 0;
  g.fillStyle = 'rgba(22,16,12,1)';
  g.beginPath();
  g.arc(63, 49, 22, 0, Math.PI * 2);
  g.fill();
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** the delivery's envelope: a white envelope in a teal glow, the batch HUD's colour */
function envelopeTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const halo = g.createRadialGradient(64, 64, 8, 64, 64, 64);
  halo.addColorStop(0, 'rgba(111,242,216,0.75)');
  halo.addColorStop(0.55, 'rgba(111,242,216,0.22)');
  halo.addColorStop(1, 'rgba(111,242,216,0)');
  g.fillStyle = halo;
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#ffffff';
  g.strokeStyle = '#127a72';
  g.lineWidth = 4;
  g.lineJoin = 'round';
  g.beginPath();
  g.roundRect(30, 40, 68, 48, 6);
  g.fill();
  g.stroke();
  g.beginPath();
  g.moveTo(32, 43);
  g.lineTo(64, 68);
  g.lineTo(96, 43);
  g.stroke();
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}
