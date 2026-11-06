import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  CubicBezierCurve3,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  MathUtils,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Quaternion,
  RingGeometry,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { ROOFTOP_BASE_Y } from '../bake/cityGen.mjs';
import { glowTexture, paperSheetTexture } from '../bake/CanvasTextures';
import { rigParamsAt } from '../../story/chapters';
import {
  BOMBER, CHIP_DONE, CHIP_FLYING, CHIP_LANDED, CHIP_ROLE, CHIP_SLOT, FLEET, REPLY, SKIPPED, cardAt, newCardState,
  type FleetKind, type FleetRow,
} from '../../story/fleet';
import type { BatchHudState, ChipMode, FleetChip, FleetStamp } from '../interact/BatchHud';
import { REFLECTED_LAYER } from '../materials/PlanarReflection';
import type { Quality } from '../quality';
import type { FlightPath } from '../rig/FlightPath';
import { mulberry32 } from '../util';
import { SHIP_DECK_SPOTS, type Beacon } from './Beacon';
import { CITY_SHOWN, type City } from './City';
import { CAFE_DELIVERY } from './CafeTerrace';
import { dartGeometry } from './PaperPlane';
import type { TownSites } from './Rooftops';
import type { WingMate, WingPlanes } from './WingPlanes';

/** the V rises out of the cloud sea one plane at a time between these story-t (a queue, not a swarm) */
export const FLEET_JOIN = [0.262, 0.302] as const;
/** each plane of the V starts rising this long after the one before it, and takes RISE to close up */
const JOIN_STEP = 0.005;
const RISE = 0.01;
/** a delivery leaves the flight this long before it lands (V, freighter, phones) */
const GLIDE = 0.012;
/** a landing must project inside this fraction of the half-screen to count as in view (as BatchSend) */
const IN_VIEW = 0.8;
const GROUND = ROOFTOP_BASE_Y;
/** where the Engine holds the camera for the lighthouse delivery (Engine: rig.shot), and how strongly at story-t */
const SHOT_POS = new Vector3(147.6, 24.2, 0.9);
function shotWeight(t: number): number {
  return MathUtils.smoothstep(t, 0.512, 0.526) * (1 - MathUtils.smoothstep(t, 0.566, 0.58));
}
/** the beam's lock-on to the hero (direction §3, CH 06b) */
function lockWeight(t: number): number {
  return MathUtils.smoothstep(t, 0.518, 0.53) * (1 - MathUtils.smoothstep(t, 0.562, 0.574));
}
/** short contrails (HIGH only): points, and the story-t between them */
const TRAIL_POINTS = 14;
const TRAIL_STEP = 0.0012;
const UP = new Vector3(0, 1, 0);
const ZERO = new Matrix4().makeScale(0, 0, 0);
const GHOST_TINT = new Color('#aebcff');
const GOLD = new Color('#ffc64a');
const RED = new Color('#ff3b47');
const TEAL = new Color('#6ff2d8');
const WHITE = new Color('#ffffff');

const row = (n: number): FleetRow => FLEET[n - 1]!;
const ROWS_OF = (...kinds: FleetKind[]): FleetRow[] => FLEET.filter((r) => kinds.includes(r.kind));
/** the V: rows 6-12 (Gail..Maya), in the order they join AND leave (first in, first out) */
const V_ROWS = FLEET.slice(5, 12);
/** each V row's place in the V: the first two to leave fly the wingtips, the last the apex */
const V_SLOT = [6, 5, 4, 3, 2, 1, 0];

type DartKind = 'v' | 'ship' | 'cafe' | 'phone' | 'ghost' | 'reply' | 'skip';
interface Dart {
  kind: DartKind;
  row: FleetRow | null;
  /** V: its slot (0 apex .. 6) and when it starts rising */
  vSlot: number;
  join: number;
  from: number;
  land: number;
  sign: number;
  planned: boolean;
  /** the glide: world points (town, phone, cafe), or offsets from the deck at the landing (ship) */
  curve: CubicBezierCurve3 | null;
  rest: Vector3;
  spot: readonly [number, number, number] | null;
  scale: [number, number];
  phase: number;
}

/** a light column over a delivery: one InstancedMesh, one instance per row */
interface Column {
  row: FleetRow;
  planned: boolean;
  base: Vector3;
  h: number;
  r: number;
  gain: number;
  off: [number, number];
  /** the freighter's ride the ship (base from the deck at `land`) */
  ship: readonly [number, number, number] | null;
  /** where the HUD pins its landed chip */
  chip: Vector3;
}

/** how each kind's column is sized, how bright it is (additive) and when it goes */
const COLUMN: Partial<Record<FleetKind, { h: number; r: number; gain: number; off: (land: number) => [number, number] }>> = {
  lawn: { h: 10, r: 0.5, gain: 1.2, off: () => [0.338, 0.35] },
  wing: { h: 12, r: 0.55, gain: 1.1, off: () => [0.338, 0.35] },
  peel: { h: 12, r: 0.55, gain: 1.1, off: () => [0.338, 0.35] },
  ship: { h: 26, r: 1.3, gain: 0.8, off: () => [0.572, 0.585] },
  cafe: { h: 2.4, r: 0.16, gain: 0.6, off: (land) => [land + 0.022, land + 0.036] },
  phone: { h: 4, r: 0.18, gain: 0.7, off: (land) => [land + 0.02, land + 0.034] },
};
/** the far columns: the sea horizon's even beat, the skyline ahead, and the window wave when City cannot show it */
const SEA_COLUMN = { h: 34, r: 0.75, gain: 0.8, off: [0.508, 0.52] as [number, number] };
const SKY_COLUMN = { h: 26, r: 0.9, gain: 0.95, off: [0.684, 0.698] as [number, number] };
const WAVE_COLUMN = { h: 12, r: 0.35, gain: 1.0, off: [0.858, 0.872] as [number, number] };
/** where on screen (NDC x) each of the sea's four columns rises: either side of the lighthouse, never on it */
const SEA_NDC = [-0.7, 0.58, -0.5, 0.78];

/** the BCC bomber's stencil, on the dart's flat-sheet layout (u across the span, v along it, the nose at the top) */
function bomberTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 1024;
  const g = c.getContext('2d')!;
  g.fillStyle = '#8d8f8e';
  g.fillRect(0, 0, 1024, 1024);
  const rand = mulberry32(551);
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = `rgba(${rand() < 0.5 ? '40,40,40' : '230,230,226'},${0.04 + rand() * 0.06})`;
    g.fillRect(rand() * 1024, rand() * 1024, 2 + rand() * 6, 1 + rand() * 3);
  }
  // creases and grime along the spine
  g.strokeStyle = 'rgba(30,30,30,0.35)';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(512, 0);
  g.lineTo(512, 1024);
  g.stroke();
  const stencil = (text: string, x: number, y: number, size: number, color = '#1b1c1e'): void => {
    g.save();
    g.translate(x, y);
    g.rotate(-Math.PI / 2);
    g.font = `700 ${size}px Oswald, Impact, 'Arial Narrow', sans-serif`;
    g.fillStyle = color;
    g.textBaseline = 'middle';
    g.fillText(text, 0, 0);
    g.restore();
  };
  // along the length, from the tail toward the nose, on each wing near the spine
  stencil(BOMBER.toLine.toUpperCase(), 600, 1000, 56);
  stencil('BCC: AMY@ACME.COM, BEN@ACME.COM', 690, 1000, 44);
  stencil('DEV@ACME.COM, ELI@ACME.COM …', 770, 1000, 44);
  stencil('+231 MORE', 860, 1000, 70, '#7a1016');
  stencil('DEAR ALL,', 420, 1000, 64);
  stencil('BCC: +235', 340, 1000, 64, '#7a1016');
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/**
 * The fleet: the sample campaign's 42 deliveries (src/story/fleet.ts), told in the scene. Everything
 * the HUD counts is something seen landing, and everything seen landing is counted:
 *
 *  - the town (0.26-0.35): the V rises out of the cloud sea strictly one plane at a time, each with
 *    its timetable chip (`Gail · 09:29`); the three WingPlanes dive off to their deliveries (#3-#5);
 *    then the V peels off one by one into the town below (#6-#12), a light column rising from each
 *    house. Hugo's (#7) follow-ups trail where his plane was as two ghost darts until a gold "Re:" dart
 *    rises from his lawn and they unfold and flutter down: follow-ups stop on a reply.
 *  - the storm (0.39-0.44): the BCC bomber, a grey mega-dart with the whole list on its wings, is
 *    struck at the red gate and bursts into scraps (550); ours flies through.
 *  - the sea (0.46-0.51): four columns on the horizon at an even beat (#13-#16), the daily cap.
 *  - the lighthouse (0.52-0.57): the beam locks onto the hero, three auth rings stamp out of the
 *    lamp (SPF, DKIM, DMARC), then the freighter's two (#17, #18).
 *  - the no-fly zone (0.59-0.62): a red 43rd dart slides in, is stamped DO-NOT-SEND, unfolds and drops.
 *  - the city: the skyline's two columns (#19, #20), the terrace (#23), the phones (#24, #27), and
 *    City's envelopes, darts and window wave (planned here with the camera's view, flown by City).
 *
 * Draws: one InstancedMesh for every dart (folded or unfolding, ghostly or gold, through a per-instance
 * attribute), one for the light columns (42), one for the rings, and while on screen the bomber,
 * its burst and its bolt; on HIGH one LineSegments of short contrails. Targets are chosen once per
 * visit (a random seed, or `?batchseed=N`) from what the chase camera actually sees as each one lands;
 * after that everything is a pure function of story-t, so it scrubs both ways.
 */
export class BatchFleet {
  readonly group = new Group();
  private low: boolean;
  private darts: InstancedMesh;
  private dartGeometry: BufferGeometry;
  private paper: CanvasTexture = paperSheetTexture();
  private dartMaterial: MeshStandardMaterial;
  private look: InstancedBufferAttribute;
  private beams: InstancedMesh;
  private beamGeometry = new CylinderGeometry(1, 1, 1, 16, 1, true);
  private beamFade: CanvasTexture;
  private beamMaterial: MeshBasicMaterial;
  private rings: InstancedMesh;
  private ringGeometry = new RingGeometry(0.9, 1, 64);
  private ringMaterial: MeshBasicMaterial;
  private bomber: Mesh;
  private bomberGeometry: BufferGeometry;
  private bomberMaterial: MeshStandardMaterial;
  private bomberTex: CanvasTexture;
  private burst: Points;
  private burstMaterial: PointsMaterial;
  private burstDirs: Float32Array;
  private burstFlecks = glowTexture();
  private bolt: Mesh;
  private boltMaterial: MeshBasicMaterial;
  private trails: LineSegments | null = null;
  private trailPositions: Float32Array | null = null;
  private trailColors: Float32Array | null = null;
  private list: Dart[] = [];
  private columns: Column[];
  private seed: number;
  private townPlanned = false;
  private shipPlanned = false;
  private phonePlanned = false;
  private cafePlanned = false;
  private seaPlanned = false;
  private skyPlanned = false;
  private cityPlanned = false;
  private tLamp = 0.543;
  private hugo: Dart;
  private ghosts: Dart[];
  private reply: Dart;
  private skip: Dart;
  /** the landing times the visuals chose (the scouts, the phones), for the tally: index n - 1 */
  private landings = new Float64Array(FLEET.length).fill(NaN);
  // the HUD's state, reused every frame
  private card = newCardState();
  private chipPool: FleetChip[] = [];
  private chipCount = 0;
  private stamps: FleetStamp[] = [
    { anchor: new Vector3(), shown: false, kind: 'bcc' },
    { anchor: new Vector3(), shown: false, kind: 'dns' },
  ];
  private hud: BatchHudState = { card: this.card, chips: this.chipPool, stamps: this.stamps };
  // scratch
  private p0 = new Vector3();
  private p1 = new Vector3();
  private p2 = new Vector3();
  private tan = new Vector3();
  private side = new Vector3();
  private deck = new Vector3();
  private slotV = new Vector3();
  private m4 = new Matrix4();
  private q = new Quaternion();
  private qRoll = new Quaternion();
  private scl = new Vector3();
  private c = new Color();
  private aim = new Vector3();
  private rt = new Vector3();
  /** the in-view point projectedColumn last aimed at (the chip goes there) */
  private inView = new Vector3();
  private ringAt = new Vector3();
  private camRight = new Vector3();
  /** the dart flying each row (index n - 1), or null */
  private dartOf: (Dart | null)[] = FLEET.map(() => null);
  private strikeAt = new Vector3();
  private viewCamera = new PerspectiveCamera(50, 1, 0.1, 600);
  private aspect = 16 / 9;

  constructor(
    private path: FlightPath, quality: Quality, private beacon: Beacon, private city: City,
    private wings: WingPlanes | null = null,
  ) {
    this.low = quality.tier === 'low';
    const param = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('batchseed') : null;
    this.seed = param !== null && Number.isFinite(Number(param)) ? Number(param) >>> 0 : (Math.random() * 2 ** 32) >>> 0;
    const phase = mulberry32(77);

    const dart = (kind: DartKind, r: FleetRow | null, extra: Partial<Dart> = {}): Dart => {
      const d: Dart = {
        kind, row: r, vSlot: -1, join: 0, from: r ? r.land - GLIDE : 0, land: r ? r.land : 0, sign: 1, planned: false,
        curve: null, rest: new Vector3(), spot: null, scale: [0.8, 1.5], phase: phase() * Math.PI * 2, ...extra,
      };
      this.list.push(d);
      if (r) this.dartOf[r.n - 1] = d;
      return d;
    };
    V_ROWS.forEach((r, k) => dart('v', r, {
      vSlot: V_SLOT[k]!, join: FLEET_JOIN[0] + k * JOIN_STEP, sign: V_SLOT[k]! % 2 === 1 ? 1 : -1,
      scale: r.kind === 'lawn' ? [0.8, 1.5] : [0.8, 1.1],
    }));
    ROWS_OF('ship').forEach((r, i) => dart('ship', r, { from: r.land - 0.023, sign: i % 2 === 0 ? 1 : -1, scale: [1, 2.4] }));
    ROWS_OF('cafe').forEach((r) => dart('cafe', r, { from: CAFE_DELIVERY.from, land: CAFE_DELIVERY.land, scale: [0.7, 0.24] }));
    ROWS_OF('phone').forEach((r, i) => dart('phone', r, { from: r.land - 0.022, sign: i % 2 === 0 ? 1 : -1, scale: [0.6, 0.4] }));
    this.hugo = this.list.find((d) => d.row?.n === REPLY.n)!;
    this.ghosts = [dart('ghost', null), dart('ghost', null)];
    this.reply = dart('reply', null, { from: REPLY.rise - 0.0045, land: REPLY.cancel });
    this.skip = dart('skip', null, { from: SKIPPED.t - 0.012, land: SKIPPED.t });

    // the dart, folded, with its flat sheet as a second shape (from the flat layout its UVs come from), so
    // an instance can unfold; aLook per instance: (unfold, opacity, glow)
    this.dartGeometry = dartGeometry();
    const uv = this.dartGeometry.attributes.uv!;
    const flat = new Float32Array(uv.count * 3);
    for (let i = 0; i < uv.count; i++) {
      flat[i * 3] = (uv.getX(i) - 0.5) * 1.64;
      flat[i * 3 + 2] = (uv.getY(i) - 0.5) * 1.6;
    }
    this.dartGeometry.setAttribute('aFlat', new BufferAttribute(flat, 3));
    this.look = new InstancedBufferAttribute(new Float32Array(this.list.length * 3), 3).setUsage(DynamicDrawUsage);
    this.dartGeometry.setAttribute('aLook', this.look);
    this.dartMaterial = new MeshStandardMaterial({
      map: this.paper, color: '#d6d1c7', roughness: 0.85, side: DoubleSide, emissive: '#8f97a8', emissiveIntensity: 0.14,
    });
    this.dartMaterial.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 aFlat;\nattribute vec3 aLook;\nvarying vec2 vLook;\nvarying vec3 vGlow;')
        .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nobjectNormal = normalize(mix(objectNormal, vec3(0.0, 1.0, 0.0), aLook.x));')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          transformed = mix(position, aFlat, aLook.x);
          vLook = aLook.yz;
          #ifdef USE_INSTANCING_COLOR
            vGlow = instanceColor * aLook.z;
          #else
            vGlow = vec3(aLook.z);
          #endif`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vLook;\nvarying vec3 vGlow;')
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
          // a ghost is drawn as a screen-door (opaque pass, no sorting): the follow-ups that may yet stand down
          if (vLook.x < 0.999) {
            float n = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
            if (n > vLook.x) discard;
          }`)
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vGlow;');
    };
    this.dartMaterial.customProgramCacheKey = () => 'fleet-dart';
    this.darts = new InstancedMesh(this.dartGeometry, this.dartMaterial, this.list.length);
    this.darts.instanceMatrix.setUsage(DynamicDrawUsage);
    for (let i = 0; i < this.list.length; i++) {
      this.darts.setMatrixAt(i, ZERO);
      this.darts.setColorAt(i, WHITE);
      this.look.setXYZ(i, 0, 1, 0);
    }
    this.darts.instanceColor!.setUsage(DynamicDrawUsage);
    this.darts.frustumCulled = false;
    this.group.add(this.darts);

    // the light column over a landing: fades out upward (as BatchSend's), one instance per row
    const gc = document.createElement('canvas');
    gc.width = 4;
    gc.height = 64;
    const gx = gc.getContext('2d')!;
    const grad = gx.createLinearGradient(0, 64, 0, 0);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.55, '#707070');
    grad.addColorStop(1, '#000000');
    gx.fillStyle = grad;
    gx.fillRect(0, 0, 4, 64);
    this.beamFade = new CanvasTexture(gc);
    // additive, so the order of its faces does not matter: one pass, not three's two for a transparent DoubleSide
    this.beamMaterial = new MeshBasicMaterial({
      color: '#ffffff', alphaMap: this.beamFade, transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide, fog: false,
      forceSinglePass: true,
    });
    this.beams = new InstancedMesh(this.beamGeometry, this.beamMaterial, FLEET.length);
    this.beams.instanceMatrix.setUsage(DynamicDrawUsage);
    this.beams.frustumCulled = false;
    for (let i = 0; i < FLEET.length; i++) {
      this.beams.setMatrixAt(i, ZERO);
      this.beams.setColorAt(i, this.c.setRGB(0, 0, 0));
    }
    // the sea mirrors the horizon's columns (HIGH: the lighthouse's planar reflection draws this layer)
    if (!this.low) this.beams.layers.enable(REFLECTED_LAYER);
    this.group.add(this.beams);
    this.columns = FLEET.map((r) => ({
      row: r, planned: false, base: new Vector3(), h: 0, r: 0, gain: 0, off: [0, 0], ship: null, chip: new Vector3(),
    }));

    // the rings: three auth rings out of the lamp (SPF, DKIM, DMARC) and the do-not-send pulse
    this.ringMaterial = new MeshBasicMaterial({
      color: '#ffffff', transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide, fog: false, toneMapped: false,
      forceSinglePass: true,
    });
    this.rings = new InstancedMesh(this.ringGeometry, this.ringMaterial, 4);
    this.rings.instanceMatrix.setUsage(DynamicDrawUsage);
    this.rings.frustumCulled = false;
    for (let i = 0; i < 4; i++) {
      this.rings.setMatrixAt(i, ZERO);
      this.rings.setColorAt(i, this.c.setRGB(0, 0, 0));
    }
    this.rings.visible = false;
    this.group.add(this.rings);

    // the BCC bomber: the dart x6 in dull grey paper, the whole list stencilled on its wings
    this.bomberGeometry = dartGeometry();
    this.bomberTex = bomberTexture();
    this.bomberMaterial = new MeshStandardMaterial({
      map: this.bomberTex, color: '#b8b8b4', roughness: 0.95, side: DoubleSide, emissive: '#ffffff', emissiveMap: this.bomberTex, emissiveIntensity: 0.12,
    });
    this.bomber = new Mesh(this.bomberGeometry, this.bomberMaterial);
    this.bomber.visible = false;
    this.bomber.frustumCulled = false;
    this.group.add(this.bomber);
    // its burst: ~100 paper scraps tumbling into the black sea (pure in t)
    const n = this.low ? 70 : 110;
    const brand = mulberry32(5502);
    this.burstDirs = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const th = brand() * Math.PI * 2;
      const up = brand() * 1.4 - 0.5;
      const rr = Math.sqrt(Math.max(1 - up * up * 0.5, 0));
      this.burstDirs.set([Math.cos(th) * rr, up, Math.sin(th) * rr, 0.4 + brand() * 0.9], i * 4);
    }
    const bg = new BufferGeometry();
    bg.setAttribute('position', new BufferAttribute(new Float32Array(n * 3), 3).setUsage(DynamicDrawUsage));
    bg.setAttribute('color', new BufferAttribute(new Float32Array(n * 3), 3).setUsage(DynamicDrawUsage));
    this.burstMaterial = new PointsMaterial({
      map: this.burstFlecks, size: 0.24, vertexColors: true, transparent: true, depthWrite: false, blending: AdditiveBlending, color: '#f2efe6',
    });
    this.burst = new Points(bg, this.burstMaterial);
    this.burst.frustumCulled = false;
    this.burst.visible = false;
    this.group.add(this.burst);
    // the bolt that strikes it: a jagged ribbon in two crossed planes (seen from anywhere), 26 tall
    const lr = mulberry32(415);
    const pts: number[] = [];
    let x = 0;
    let z = 0;
    const segs = 12;
    for (let i = 0; i <= segs; i++) {
      const y = 26 * (1 - i / segs);
      pts.push(x, y, z);
      x += (lr() - 0.5) * 2.6;
      z += (lr() - 0.5) * 2.6;
      if (i === segs - 1) { x *= 0.2; z *= 0.2; }
    }
    const pos: number[] = [];
    const w = 0.32;
    for (let i = 0; i < segs; i++) {
      const [ax, ay, az] = [pts[i * 3]!, pts[i * 3 + 1]!, pts[i * 3 + 2]!];
      const [bx, by, bz] = [pts[i * 3 + 3]!, pts[i * 3 + 4]!, pts[i * 3 + 5]!];
      for (const [ox, oz] of [[w, 0], [0, w]] as const) {
        pos.push(ax - ox, ay, az - oz, ax + ox, ay, az + oz, bx + ox, by, bz + oz);
        pos.push(ax - ox, ay, az - oz, bx + ox, by, bz + oz, bx - ox, by, bz - oz);
      }
    }
    const boltGeometry = new BufferGeometry();
    boltGeometry.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    this.boltMaterial = new MeshBasicMaterial({
      color: '#efe8ff', transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide, fog: false, toneMapped: false,
      forceSinglePass: true,
    });
    this.bolt = new Mesh(boltGeometry, this.boltMaterial);
    this.bolt.visible = false;
    this.bolt.frustumCulled = false;
    this.group.add(this.bolt);

    if (!this.low) {
      const verts = this.list.length * (TRAIL_POINTS - 1) * 2;
      this.trailPositions = new Float32Array(verts * 3);
      this.trailColors = new Float32Array(verts * 3);
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(this.trailPositions, 3).setUsage(DynamicDrawUsage));
      g.setAttribute('color', new BufferAttribute(this.trailColors, 3).setUsage(DynamicDrawUsage));
      this.trails = new LineSegments(g, new LineBasicMaterial({
        vertexColors: true, color: '#cfe8ff', transparent: true, blending: AdditiveBlending, depthWrite: false, fog: false,
      }));
      this.trails.frustumCulled = false;
      this.group.add(this.trails);
    }

    for (let i = 0; i < 18; i++) this.chipPool.push({ anchor: new Vector3(), shown: false, mode: 'flying', label: '' });

    // the moment the dart is in the lantern (closest to the lamp): the rings stamp out of it from here
    const lamp = this.beacon.lantern;
    let best = Infinity;
    for (let t = 0.5; t <= 0.6; t += 0.0005) {
      const d = this.path.pointAt(t, this.p0).distanceToSquared(lamp);
      if (d < best) {
        best = d;
        this.tLamp = t;
      }
    }
    this.group.visible = false;
  }

  // ---- the formation -------------------------------------------------------------------------------

  /** A place in the V, in the hero's frame (forward, side, up): the apex ahead, the wingtips level with the hero. */
  private slot(i: number, aspect: number, out: Vector3): Vector3 {
    const k = Math.ceil(i / 2) / 3;
    const sign = i % 2 === 1 ? 1 : -1;
    // a phone held upright sees a thin slice sideways: the V closes up narrower there
    const wide = MathUtils.clamp(0.5 + 0.38 * (aspect - 0.56), 0.5, 1);
    return out.set(6.5 - 6 * k, i === 0 ? 0 : sign * k * 4.2 * wide, 0.5 - 0.7 * k);
  }

  /** A point in the hero's frame at story-t `t` (forward along the line, side to its right, up). */
  private heroFrame(t: number, f: number, s: number, u: number, out: Vector3): Vector3 {
    this.path.pointAt(t, out);
    this.path.tangentAt(t, this.tan);
    this.side.crossVectors(this.tan, UP).normalize();
    return out.addScaledVector(this.tan, f).addScaledVector(this.side, s).addScaledVector(UP, u);
  }

  /** Where V dart `d` is at story-t `t` while in formation (rising out of the cloud sea, then in the V); its scale. */
  private formation(d: Dart, t: number, aspect: number, out: Vector3): number {
    if (t < d.join) return 0;
    const e = MathUtils.smoothstep(t, d.join, d.join + RISE);
    const v = this.slot(d.vSlot, aspect, this.slotV);
    // they come up out of the cloud deck under the V, not from behind the lens; a little life in the V
    const f = MathUtils.lerp(v.x - 3 - 1.5 * Math.sin(d.phase), v.x, e);
    const s = v.y * MathUtils.lerp(1.5, 1, e) + 0.1 * Math.sin(t * 610 + d.phase * 2);
    const u = MathUtils.lerp(v.z - 10, v.z, e) + 0.14 * Math.sin(t * 900 + d.phase);
    this.heroFrame(t, f, s, u, out);
    return 0.8 * Math.min(e * 4, 1);
  }

  /** Where Hugo's ghost follow-up `k` rides: his empty place in the V, the second a length behind. */
  private ghostSlot(k: number, t: number, aspect: number, out: Vector3): Vector3 {
    const v = this.slot(this.hugo.vSlot, aspect, this.slotV);
    return this.heroFrame(t, v.x - 0.6 - k * 1.9, v.y * 0.72 - this.hugo.sign * k * 0.55, v.z + 0.2 - k * 0.25 + 0.1 * Math.sin(t * 700 + k), out);
  }

  /** the BCC bomber's place in the hero's frame at story-t `t` (it lumbers out of the storm ahead and is overtaken) */
  private bomberPos(t: number, aspect: number, out: Vector3): Vector3 {
    // a phone held upright has a narrow frame: there it flies nearly dead ahead, on a desktop off to the right
    const wide = MathUtils.clamp((aspect - 0.5) / 1.3, 0, 1);
    const x = MathUtils.clamp((t - BOMBER.from) / (BOMBER.strike - BOMBER.from), 0, 1);
    const e = 1 - Math.pow(1 - x, 2);
    return this.heroFrame(
      t, MathUtils.lerp(46, 13, e), MathUtils.lerp(12, MathUtils.lerp(2.6, 7, wide), e),
      MathUtils.lerp(3, -1.7, e) + 0.3 * Math.sin(t * 380), out,
    );
  }

  /**
   * Where instance `d` is at story-t `t`, and its scale (0: not drawn); `look` gets (unfold, opacity, glow).
   */
  private pose(d: Dart, t: number, aspect: number, out: Vector3, look?: Vector3): number {
    look?.set(0, 1, 0);
    switch (d.kind) {
      case 'v': {
        if (!d.planned || !d.curve || t < d.from) return t < 0.36 ? this.formation(d, t, aspect, out) : 0;
        return this.glide(d, t, out);
      }
      case 'ghost': {
        const k = this.ghosts.indexOf(d);
        const on = this.hugo.from + 0.002;
        if (t < on || t > REPLY.cancel + 0.018) return 0;
        const fade = MathUtils.smoothstep(t, on, on + 0.005);
        if (t < REPLY.cancel) {
          this.ghostSlot(k, t, aspect, out);
          look?.set(0, 0.62 * fade, 0.7);
          return 0.8 * fade;
        }
        // the reply has passed: it unfolds into a flat sheet and flutters down into the cloud sea
        const tau = (t - REPLY.cancel) / 0.018;
        this.ghostSlot(k, REPLY.cancel, aspect, out);
        this.path.tangentAt(REPLY.cancel, this.tan);
        out.addScaledVector(this.tan, -tau * (2 + k)).addScaledVector(UP, -9 * tau * tau - 1.5 * tau);
        out.x += 0.7 * Math.sin(tau * 11 + k * 2);
        look?.set(MathUtils.smoothstep(tau, 0, 0.25), 0.62 * (1 - MathUtils.smoothstep(tau, 0.55, 1)), 0.7);
        return 0.8;
      }
      case 'reply': {
        if (!this.hugo.planned || t < d.from || t > d.land + 0.009) return 0;
        const x = MathUtils.clamp((t - d.from) / (d.land - d.from), 0, 1);
        if (!d.curve) return 0;
        if (t <= d.land) d.curve.getPoint(x * x * (3 - 2 * x) * 0.6 + x * 0.4, out);
        else {
          // past the ghosts it climbs away up and outward, away from the lens, and is gone
          d.curve.getPoint(1, out);
          this.path.tangentAt(d.land, this.rt);
          this.side.crossVectors(this.rt, UP).normalize();
          const k = (t - d.land) * 900;
          out.addScaledVector(UP, k).addScaledVector(this.side, this.hugo.sign * k * 0.6).addScaledVector(this.rt, k * 0.3);
        }
        look?.set(0, 1, 1.4);
        return 0.5 * (1 - MathUtils.smoothstep(t, d.land + 0.002, d.land + 0.006));
      }
      case 'skip': {
        if (t < d.from || t > SKIPPED.t + 0.02) return 0;
        if (t < SKIPPED.t + 0.002) {
          // slides in from the left of the frame to join the hero
          const x = MathUtils.smoothstep(t, d.from, SKIPPED.t - 0.001);
          const wide = MathUtils.clamp(0.5 + 0.38 * (aspect - 0.56), 0.5, 1);
          this.heroFrame(t, MathUtils.lerp(-1, 1.6, x), MathUtils.lerp(-9, -2.4, x) * wide, MathUtils.lerp(1.5, 0.4, x), out);
          look?.set(0, 1, 0.9);
          return 0.8;
        }
        // refused: unfolds into a sheet and drops away, left behind in the dark
        const tau = (t - SKIPPED.t - 0.002) / 0.018;
        const wide = MathUtils.clamp(0.5 + 0.38 * (aspect - 0.56), 0.5, 1);
        this.heroFrame(SKIPPED.t + 0.002, 1.6, -2.4 * wide, 0.4, out);
        out.addScaledVector(UP, -10 * tau * tau - 1.2 * tau);
        out.z += 0.6 * Math.sin(tau * 9);
        look?.set(MathUtils.smoothstep(tau, 0, 0.22), 1 - MathUtils.smoothstep(tau, 0.6, 1), 0.9 * (1 - tau));
        return 0.8;
      }
      default:
        return this.glide(d, t, out);
    }
  }

  /** A delivery's glide down onto its spot (town, freighter, plaza, terrace), then resting there for a while. */
  private glide(d: Dart, t: number, out: Vector3): number {
    if (!d.planned || !d.curve || t < d.from) return 0;
    const x = MathUtils.clamp((t - d.from) / (d.land - d.from), 0, 1);
    const u = 1 - Math.pow(1 - x, 1.5);
    d.curve.getPoint(u, out);
    if (d.kind === 'ship') out.add(this.beacon.shipDeckAt(Math.min(t, d.land), d.spot!, this.deck));
    let s = MathUtils.lerp(d.scale[0], d.scale[1], MathUtils.smoothstep(x, 0, 0.9));
    if (d.kind === 'v') s *= 1 - MathUtils.smoothstep(t, 0.338, 0.348);
    if (d.kind === 'ship') s *= 1 - MathUtils.smoothstep(t, 0.575, 0.585);
    // a phone takes its dart in: it shrinks into the screen over the last of the glide
    if (d.kind === 'phone') s *= 1 - MathUtils.smoothstep(x, 0.84, 1);
    return s;
  }

  // ---- choosing where they land ---------------------------------------------------------------------

  /** The chase camera at story-t `t` with no gusts and no damping (and the lighthouse's held shot): enough to ask what is in frame. */
  private modelCamera(t: number, aspect = this.aspect): PerspectiveCamera {
    const rig = rigParamsAt(t);
    const cam = this.viewCamera;
    this.path.pointAt(t, this.p1);
    this.path.tangentAt(t, this.tan);
    this.side.crossVectors(this.tan, UP).normalize();
    this.path.pointAt(Math.max(t - rig.camLag, 0), this.p0);
    this.p0.addScaledVector(UP, rig.offsetUp).addScaledVector(this.side, rig.offsetSide).addScaledVector(this.tan, -rig.offsetBack);
    const dist = this.p0.distanceTo(this.p1);
    if (dist < 1.2) this.p0.sub(this.p1).multiplyScalar(1.2 / Math.max(dist, 1e-4)).add(this.p1);
    const w = shotWeight(t);
    cam.position.copy(this.p0).lerp(SHOT_POS, w);
    this.path.pointAt(Math.min(t + rig.lookAhead, 1), this.p1);
    this.p1.y += rig.lookUp ?? 0;
    this.p1.lerp(this.beacon.lantern, w);
    cam.fov = rig.fov;
    cam.aspect = aspect;
    cam.updateProjectionMatrix();
    cam.lookAt(this.p1);
    cam.updateMatrixWorld();
    return cam;
  }

  /** How far from the middle of the screen `at` is at story-t `t`: 0 centre, 1 the edge, Infinity behind. */
  private offCentre(t: number, at: Vector3, aspect: number): number {
    const cam = this.modelCamera(t, aspect);
    this.p2.copy(at).project(cam);
    if (this.p2.z > 1) return Infinity;
    return Math.max(Math.abs(this.p2.x), Math.abs(this.p2.y));
  }

  /** In view as it touches down and a moment before (that is what the eye follows in). */
  private view(t: number, at: Vector3, aspect: number): number {
    return Math.max(this.offCentre(t, at, aspect), this.offCentre(t - 0.006, at, aspect));
  }

  /**
   * The lighthouse stands between the held shot and the sea: a spot whose screen x falls inside the
   * tower's silhouette (about 5 units either side of its axis) is hidden. Returns 0 when clear, else
   * more than IN_VIEW, larger the deeper behind it the spot is.
   */
  private behindTower(t: number, at: Vector3, aspect: number): number {
    const cam = this.modelCamera(t, aspect);
    const lamp = this.beacon.lantern;
    if (cam.position.distanceTo(at) < cam.position.distanceTo(lamp)) return 0;
    const sx = this.p2.copy(at).project(cam).x;
    const lx = this.p0.copy(lamp).project(cam).x;
    this.p1.setFromMatrixColumn(cam.matrixWorld, 0).multiplyScalar(5).add(lamp);
    const half = Math.abs(this.p1.project(cam).x - lx);
    const dx = Math.abs(sx - lx);
    return dx < half ? 1 + (half - dx) : 0;
  }

  /** A random pick from what is in view and clear of the middle (the title), or failing that the few nearest the middle. */
  private pick<T extends { view: number }>(options: T[], rand: () => number): T | undefined {
    let pool = options.filter((o) => o.view < IN_VIEW && o.view > 0.18);
    if (!pool.length) pool = options.filter((o) => o.view < IN_VIEW);
    if (!pool.length) pool = [...options].sort((a, b) => a.view - b.view).slice(0, 3);
    return pool[Math.floor(rand() * pool.length)];
  }

  /** a column of `spec` standing at `base` for row `r` */
  private setColumn(r: FleetRow, base: Vector3, spec: { h: number; r: number; gain: number }, off: [number, number]): void {
    const c = this.columns[r.n - 1]!;
    c.base.copy(base);
    c.h = spec.h;
    c.r = spec.r;
    c.gain = spec.gain;
    c.off = off;
    c.planned = true;
    c.chip.copy(base).y += Math.min(spec.h * 0.45, 6);
  }

  /**
   * A spot in view at story-t `t`: the point at screen (nx, ny) and `dist` along that ray, dropped to
   * `groundY`; the column there is tall enough to reach that point (so it is seen whatever is below).
   */
  private projectedColumn(t: number, nx: number, ny: number, dist: number, groundY: number, aspect: number, out: Vector3): number {
    const cam = this.modelCamera(t, aspect);
    this.p2.set(nx, ny, 0.5).unproject(cam).sub(cam.position).normalize();
    out.copy(cam.position).addScaledVector(this.p2, dist);
    this.inView.copy(out);
    const reach = out.y - groundY;
    out.y = groundY;
    return Math.max(reach + 6, 8);
  }

  /** The town's ten: the three wing mates and the V's seven, each onto a house the camera looks down on as it lands. */
  private planTown(sites: TownSites, aspect: number): void {
    this.townPlanned = true;
    const rand = mulberry32(this.seed ^ 0x51a7);
    const used: Vector3[] = [];
    const town = ROWS_OF('wing', 'peel', 'lawn').filter((r) => r.n > 2);
    for (const r of town) {
      const options: { rest: Vector3; view: number }[] = [];
      for (const h of sites.houses) {
        if (h.x < 70 || h.x > 190 || Math.abs(h.z) > 80) continue;
        const front = Math.cos(h.yaw) > 0 ? 1 : -1;
        const rest = new Vector3(h.x + (rand() - 0.5) * 1.6, GROUND + 0.27, h.z + front * (h.d / 2 + 1.3));
        if (used.some((u) => u.distanceTo(rest) < 9)) continue;
        const blocked = sites.trees.some((tr) => Math.abs(tr.x - rest.x) < 5 && Math.abs(tr.z - rest.z) < 5 &&
          Math.hypot(tr.x - rest.x, tr.z - rest.z) < Math.max(tr.w, tr.d) * 0.42 + 0.6);
        if (blocked) continue;
        options.push({ rest, view: this.view(r.land, rest, aspect) });
      }
      const choice = this.pick(options, rand);
      if (!choice) continue;
      used.push(choice.rest);
      const spec = COLUMN[r.kind]!;
      this.setColumn(r, this.p0.copy(choice.rest).setY(GROUND), spec, spec.off(r.land));
      if (r.kind === 'wing') {
        this.wings?.setTarget(r.n - 3, choice.rest);
        continue;
      }
      const d = this.dartOf[r.n - 1];
      if (!d) continue;
      const start = new Vector3();
      this.formation(d, d.from, aspect, start);
      this.path.tangentAt(d.from, this.tan);
      this.side.crossVectors(this.tan, UP).normalize();
      const span = start.distanceTo(choice.rest);
      const back = this.p0.subVectors(start, choice.rest).setY(0).normalize();
      d.curve = new CubicBezierCurve3(
        start,
        start.clone().addScaledVector(this.tan, span * 0.3).addScaledVector(this.side, d.sign * span * 0.12),
        choice.rest.clone().addScaledVector(back, span * 0.28).addScaledVector(UP, span * 0.1),
        choice.rest.clone(),
      );
      d.rest.copy(choice.rest);
      d.planned = true;
    }
    // the reply: a gold "Re:" dart off Hugo's lawn, up to his ghosts, arriving from ahead (the other way)
    if (this.hugo.planned) {
      const end = this.ghostSlot(0, REPLY.cancel, aspect, new Vector3());
      const startR = this.hugo.rest.clone().addScaledVector(UP, 0.4);
      const span = end.distanceTo(startR);
      this.path.tangentAt(REPLY.cancel, this.tan);
      this.reply.curve = new CubicBezierCurve3(
        startR,
        startR.clone().addScaledVector(UP, span * 0.55),
        end.clone().addScaledVector(this.tan, span * 0.35).addScaledVector(UP, span * 0.08),
        end,
      );
      this.reply.planned = true;
    }
  }

  /** Two of the freighter's spots, as the held lighthouse shot sees it. */
  private planShip(aspect: number): void {
    this.shipPlanned = true;
    const rand = mulberry32(this.seed ^ 0x5419);
    const free = [...SHIP_DECK_SPOTS];
    for (const d of this.list) {
      if (d.kind !== 'ship') continue;
      const options = free.map((spot) => {
        const at = this.beacon.shipDeckAt(d.land, spot, new Vector3());
        const view = this.view(d.land, at, aspect);
        return { spot, view: Math.max(view, this.behindTower(d.land, at, aspect)) };
      });
      const choice = this.pick(options, rand);
      if (!choice) continue;
      free.splice(free.indexOf(choice.spot), 1);
      d.spot = choice.spot;
      // from beside the hero at the lantern, out and down across the water onto the deck: the glide is
      // kept relative to the spot at the landing, and rides the ship as it steams (see glide)
      const start = this.path.pointAt(d.from, new Vector3());
      this.path.tangentAt(d.from, this.tan);
      this.side.crossVectors(this.tan, UP).normalize();
      start.addScaledVector(this.side, d.sign * 2.5).addScaledVector(UP, 1.2);
      const deckFrom = this.beacon.shipDeckAt(d.from, choice.spot, new Vector3());
      const r0 = start.clone().sub(deckFrom);
      const flat = r0.clone().setY(0);
      const span = r0.length();
      d.curve = new CubicBezierCurve3(
        r0,
        r0.clone().addScaledVector(this.tan, span * 0.15).addScaledVector(UP, span * 0.06),
        flat.multiplyScalar(0.25).setY(span * 0.05),
        new Vector3(),
      );
      d.planned = true;
      const col = this.columns[d.row!.n - 1]!;
      const spec = COLUMN.ship!;
      this.setColumn(d.row!, this.beacon.shipDeckAt(d.land, choice.spot, this.p0), spec, spec.off(d.land));
      col.ship = choice.spot;
      col.chip.y = this.beacon.shipDeckAt(d.land, choice.spot, this.p0).y + 15;
    }
  }

  /** The sea's four, on the horizon at an even beat: each where the camera sees open water as it lands. */
  private planSea(aspect: number): void {
    this.seaPlanned = true;
    const sea = this.beacon.group.position.y + 0.15;
    ROWS_OF('column').filter((r) => r.land > 0.45 && r.land < 0.52).forEach((r, k) => {
      const h = this.projectedColumn(r.land, SEA_NDC[k % SEA_NDC.length]!, -0.08, 95, sea, aspect, this.p0);
      this.setColumn(r, this.p0, { ...SEA_COLUMN, h: Math.max(h, SEA_COLUMN.h) }, SEA_COLUMN.off);
      this.columns[r.n - 1]!.chip.copy(this.inView);
    });
  }

  /** The skyline's two, on roofs ahead as the city comes up out of the weather. */
  private planSkyline(aspect: number): void {
    const roofs = this.city.roofs;
    if (!roofs.length) return;
    this.skyPlanned = true;
    const rand = mulberry32(this.seed ^ 0x5c1e);
    const used: Vector3[] = [];
    ROWS_OF('column').filter((r) => r.land > 0.6 && r.land < 0.7).forEach((r) => {
      const camPos = this.modelCamera(r.land, aspect).position.clone();
      const options = roofs
        .filter((p) => !used.some((u) => u.distanceTo(p) < 10) && p.distanceTo(camPos) > 25)
        .map((p) => ({ at: p, view: this.view(r.land, p, aspect) }));
      const choice = this.pick(options, rand);
      if (!choice) return;
      used.push(choice.at);
      this.setColumn(r, choice.at, SKY_COLUMN, SKY_COLUMN.off);
    });
  }

  /** Two people standing in the city with a phone in their hand, in frame as the dart comes down. */
  private planPhones(aspect: number, holders: { x: number; y: number; z: number; yaw: number }[]): void {
    this.phonePlanned = true;
    const rand = mulberry32(this.seed ^ 0x9407);
    const origin = this.city.group.position;
    const anyStand = this.city.crowd?.phoneHolders(true) ?? [];
    const used: Vector3[] = [];
    for (const d of this.list) {
      if (d.kind !== 'phone') continue;
      const win = d.row!.window!;
      // the canyon camera sees few of the plazas: try the scheduled landing and a few moments either
      // side of it (inside the row's window of the campaign), and take the first with someone in view
      // (the flight leaves the street for the climb at about 0.73: a later phone tries the early end of its window first)
      const order = d.row!.land > 0.735 ? [-0.008, -0.004, 0, 0.002] : [0, -0.004, 0.003, -0.008, 0.002];
      const times = order.map((k) => d.row!.land + k).filter((l) => l >= win[0] && l <= win[1]);
      let choice: { at: Vector3; yaw: number; view: number } | undefined;
      for (const land of times) {
        const optionsFor = (list: typeof holders): { at: Vector3; yaw: number; view: number }[] => list
          .map((h) => ({ at: new Vector3(h.x, h.y, h.z).add(origin), yaw: h.yaw, view: 0 }))
          .filter((o) => !used.some((u) => u.distanceTo(o.at) < 0.3))
          .map((o) => ({ ...o, view: this.view(land, o.at, aspect) }));
        // a phone in view and near enough to read the person; if no one with a phone is, the nearest
        // few people standing in view (a dart landing 50 units down the canyon is a speck)
        const cam = this.modelCamera(land, aspect).position.clone();
        let options = optionsFor(holders).filter((o) => o.view < IN_VIEW && o.at.distanceTo(cam) < 25);
        if (!options.length) {
          options = optionsFor(anyStand).filter((o) => o.view < IN_VIEW)
            .sort((a, b) => a.at.distanceTo(cam) - b.at.distanceTo(cam)).slice(0, 3);
        }
        if (!options.length) continue;
        choice = this.pick(options, rand);
        d.land = land;
        d.from = land - 0.022;
        break;
      }
      // nobody in view at any of them: the phone holder nearest the middle of the screen
      if (!choice) choice = this.pick(holders.map((h) => {
        const at = new Vector3(h.x, h.y, h.z).add(origin);
        return { at, yaw: h.yaw, view: this.view(d.land, at, aspect) };
      }).filter((o) => !used.some((u) => u.distanceTo(o.at) < 0.3)), rand);
      if (!choice) continue;
      used.push(choice.at);
      this.landings[d.row!.n - 1] = d.land;
      const start = this.path.pointAt(d.from, new Vector3());
      this.path.tangentAt(d.from, this.tan);
      this.side.crossVectors(this.tan, UP).normalize();
      start.addScaledVector(this.tan, 2).addScaledVector(this.side, d.sign * 1.5).addScaledVector(UP, 2.2);
      const facing = new Vector3(Math.cos(choice.yaw), 0, -Math.sin(choice.yaw));
      d.curve = new CubicBezierCurve3(
        start,
        start.clone().addScaledVector(this.tan, 4).addScaledVector(UP, -0.4),
        choice.at.clone().addScaledVector(facing, 1.3).addScaledVector(UP, 0.7),
        choice.at.clone(),
      );
      d.rest.copy(choice.at);
      d.planned = true;
      const spec = COLUMN.phone!;
      this.setColumn(d.row!, this.p0.copy(choice.at).setY(choice.at.y - 0.6), spec, spec.off(d.land));
      this.columns[d.row!.n - 1]!.chip.copy(choice.at).y += 1.0;
    }
  }

  /**
   * The terrace's table: of its street-side tables with people at them, one the chase camera has in
   * view as the dart touches down (on this screen's shape). The dart comes off the flight's left,
   * swings out over the pavement and settles onto the table along the street.
   */
  private planCafe(aspect: number): void {
    const terrace = this.city.terrace!;
    const options = terrace.candidates().map((c) => ({ ...c, view: this.view(CAFE_DELIVERY.land, c.at, aspect) }));
    if (!options.length) return;
    this.cafePlanned = true;
    // in view, clear of the middle of the frame (the chapter's title stands there) but not at its edge
    const inView = options.filter((o) => o.view < IN_VIEW * 0.9).sort((a, b) => Math.abs(a.view - 0.55) - Math.abs(b.view - 0.55));
    const choice = inView[0] ?? [...options].sort((a, b) => a.view - b.view)[0]!;
    terrace.setTarget(choice.index);
    for (const d of this.list) {
      if (d.kind !== 'cafe') continue;
      const rest = choice.at.clone();
      rest.y += 0.012;
      const start = this.path.pointAt(d.from, new Vector3());
      this.path.tangentAt(d.from, this.tan);
      this.side.crossVectors(this.tan, UP).normalize();
      // the flight's left is -side (side = tangent x up points right)
      start.addScaledVector(this.tan, 1.5).addScaledVector(this.side, -1.2).addScaledVector(UP, 1.6);
      d.curve = new CubicBezierCurve3(
        start,
        start.clone().addScaledVector(this.tan, 4).addScaledVector(UP, 0.6),
        rest.clone().add(new Vector3(-1.4, 0.55, 0.15)),
        rest,
      );
      d.rest.copy(rest);
      d.planned = true;
      const spec = COLUMN.cafe!;
      this.setColumn(d.row!, rest, spec, spec.off(d.land));
      this.columns[d.row!.n - 1]!.chip.copy(rest).y += 0.95;
    }
  }

  /** City's envelopes, darts and window wave: City picks windows the model camera sees; what it cannot show gets a far column. */
  private planCity(aspect: number): void {
    this.cityPlanned = true;
    const rand = mulberry32(this.seed ^ 0xc17e);
    const rows = ROWS_OF('envelope', 'window', 'wave');
    const left = this.city.planFleet(rows, (t) => this.modelCamera(t, aspect), rand);
    const groundY = this.city.group.position.y;
    const roofs = this.city.roofs;
    const used: Vector3[] = [];
    left.forEach((n, k) => {
      const r = row(n);
      const off: [number, number] = r.land < CITY_SHOWN[1] ? [r.land + 0.03, r.land + 0.045] : WAVE_COLUMN.off;
      // a slim column off a roof the camera sees below the climb (a skyline lit up one delivery at a time)...
      const camPos = this.modelCamera(r.land, aspect).position.clone();
      const options = roofs
        .filter((p) => !used.some((u) => u.distanceTo(p) < 6) && p.distanceTo(camPos) > 30)
        .map((p) => ({ at: p, view: this.view(r.land, p, aspect) }));
      const choice = this.pick(options, rand);
      if (choice && choice.view < 0.95) {
        used.push(choice.at);
        this.setColumn(r, choice.at, WAVE_COLUMN, off);
        return;
      }
      // ...or, with no roof in frame, through a point the camera sees, from the ground under it
      const nx = [-0.55, 0.5, -0.25, 0.65, -0.7, 0.3, -0.45, 0.6][k % 8]!;
      const h = this.projectedColumn(r.land, nx, -0.35, 45, groundY, aspect, this.p0);
      this.setColumn(r, this.p0, { ...WAVE_COLUMN, h: Math.max(h, WAVE_COLUMN.h) }, off);
      this.columns[n - 1]!.chip.copy(this.inView);
    });
  }

  // ---- each frame -----------------------------------------------------------------------------------

  /** Which deliveries are planned, and where (for tests: identical for the same `?batchseed`). */
  targets(): { n: number; kind: FleetKind; land: number; at: number[] | null }[] {
    return this.columns.map((c) => ({ n: c.row.n, kind: c.row.kind, land: c.row.land, at: c.planned ? c.base.toArray() : null }));
  }

  update(t: number, sites: TownSites | null, aspect: number): void {
    this.aspect = aspect;
    if (sites && !this.townPlanned) this.planTown(sites, aspect);
    if (!this.shipPlanned) this.planShip(aspect);
    if (!this.seaPlanned) this.planSea(aspect);
    if (!this.phonePlanned) {
      const holders = this.city.crowd?.phoneHolders() ?? [];
      if (holders.length) this.planPhones(aspect, holders);
    }
    if (!this.cafePlanned && this.city.terrace) this.planCafe(aspect);
    if (!this.skyPlanned) this.planSkyline(aspect);
    if (!this.cityPlanned && this.city.windowsReady) this.planCity(aspect);

    // the beam locks onto the hero on its way into the lantern (held on where it went in)
    const lw = lockWeight(t);
    if (lw > 0) {
      this.path.pointAt(Math.min(t, this.tLamp - 0.004), this.aim);
      this.beacon.lockOn(lw, this.aim);
    } else this.beacon.lockOn(0, this.aim);

    this.group.visible = t > 0.18 && t < 0.9;
    if (!this.group.visible) return;
    // pale paper in the sunset; lit a little from within at night, so it reads against the dark
    this.dartMaterial.emissiveIntensity = t < 0.4 ? 0.14 : 0.55;

    let anyDart = false;
    for (let i = 0; i < this.list.length; i++) {
      const s = this.attitude(i, t, aspect);
      if (s <= 1e-4) this.darts.setMatrixAt(i, ZERO);
      else {
        anyDart = true;
        this.darts.setMatrixAt(i, this.m4.compose(this.p0, this.q, this.scl.setScalar(s)));
      }
      if (this.trails) this.trail(i, t, aspect, s);
    }
    this.darts.visible = anyDart;
    this.darts.instanceMatrix.needsUpdate = true;
    this.look.needsUpdate = true;
    this.darts.instanceColor!.needsUpdate = true;
    if (this.trails) {
      this.trails.visible = anyDart;
      this.trails.geometry.attributes.position!.needsUpdate = true;
      this.trails.geometry.attributes.color!.needsUpdate = true;
    }
    this.updateBeams(t);
    this.updateRings(t);
    this.updateBomber(t, aspect);
  }

  private lookV = new Vector3();
  /** Puts instance `i`'s place in p0 and heading in q, its look and tint; returns its scale. */
  private attitude(i: number, t: number, aspect: number): number {
    const d = this.list[i]!;
    const s = this.pose(d, t, aspect, this.p0, this.lookV);
    this.look.setXYZ(i, this.lookV.x, this.lookV.y, this.lookV.z);
    this.darts.setColorAt(i, d.kind === 'ghost' ? GHOST_TINT : d.kind === 'reply' ? GOLD : d.kind === 'skip' ? RED : WHITE);
    if (s <= 1e-4) return 0;
    // heading from where it is about to be (frozen once landed, levelled onto the ground)
    const landed = d.planned && d.kind !== 'ghost' && d.kind !== 'reply' && d.kind !== 'skip' && t >= d.land - 0.002;
    const tt = landed ? d.land - 0.002 : t;
    this.pose(d, tt, aspect, this.p1);
    this.pose(d, tt + 0.0012, aspect, this.p2);
    this.tan.subVectors(this.p2, this.p1);
    if (landed) this.tan.y *= 0.15;
    // a sheet falling: it drifts, so it faces along the flight, not down its fall
    if ((d.kind === 'ghost' && t > REPLY.cancel) || (d.kind === 'skip' && t > SKIPPED.t)) this.path.tangentAt(t, this.tan).setY(0);
    if (this.tan.lengthSq() < 1e-10) this.path.tangentAt(t, this.tan);
    this.tan.normalize();
    this.m4.lookAt(this.p1.copy(this.p0).add(this.tan), this.p0, UP);
    this.q.setFromRotationMatrix(this.m4);
    // bank: a gentle sway in formation, into the turn when it peels off; a falling sheet flutters
    let roll = landed ? 0 : 0.08 * Math.sin(t * 520 + d.phase);
    if (d.planned && t > d.from && !landed && d.land > d.from) {
      roll -= d.sign * 0.5 * Math.sin(Math.PI * MathUtils.clamp((t - d.from) / (d.land - d.from), 0, 1));
    }
    if (d.kind === 'ghost' && t > REPLY.cancel) roll = 1.1 * Math.sin((t - REPLY.cancel) * 520 + d.phase);
    if (d.kind === 'skip' && t > SKIPPED.t) roll = 1.3 * Math.sin((t - SKIPPED.t) * 480);
    this.qRoll.setFromAxisAngle(this.tan, roll);
    this.q.premultiply(this.qRoll);
    return s;
  }

  /** Instance `i`'s contrail: sampled back along where it has been, faded down its length (tinted for the reply and the skip). */
  private trail(i: number, t: number, aspect: number, scale: number): void {
    const pos = this.trailPositions!;
    const col = this.trailColors!;
    const d = this.list[i]!;
    let o = i * (TRAIL_POINTS - 1) * 6;
    const none = d.kind === 'ghost' || scale <= 1e-4;
    const base = d.planned && d.kind !== 'reply' ? Math.min(t, d.land) : t;
    const fade = d.planned && d.kind !== 'reply' ? 1 - MathUtils.smoothstep(t, d.land, d.land + 0.008) : 1;
    let prevS = none ? 0 : this.pose(d, base, aspect, this.p1);
    // a plane off stage leaves its trail collapsed at the origin (black, so it draws nothing)
    if (prevS <= 1e-4) {
      pos.fill(0, o, o + (TRAIL_POINTS - 1) * 6);
      col.fill(0, o, o + (TRAIL_POINTS - 1) * 6);
      return;
    }
    const tint = d.kind === 'reply' ? GOLD : d.kind === 'skip' ? RED : WHITE;
    this.p2.copy(this.p1);
    for (let k = 1; k < TRAIL_POINTS; k++) {
      const s = prevS > 1e-4 ? this.pose(d, base - k * TRAIL_STEP, aspect, this.p1) : 0;
      if (s <= 1e-4) this.p1.copy(this.p2);
      const live = prevS > 1e-4 && s > 1e-4;
      const a = live ? 0.55 * fade * Math.min(prevS / 0.6, 1) * Math.pow(1 - (k - 1) / (TRAIL_POINTS - 1), 2) : 0;
      const b = live ? 0.55 * fade * Math.min(prevS / 0.6, 1) * Math.pow(1 - k / (TRAIL_POINTS - 1), 2) : 0;
      pos[o] = this.p2.x; pos[o + 1] = this.p2.y; pos[o + 2] = this.p2.z;
      col[o] = a * tint.r; col[o + 1] = a * tint.g; col[o + 2] = a * tint.b;
      pos[o + 3] = this.p1.x; pos[o + 4] = this.p1.y; pos[o + 5] = this.p1.z;
      col[o + 3] = b * tint.r; col[o + 4] = b * tint.g; col[o + 5] = b * tint.b;
      o += 6;
      this.p2.copy(this.p1);
      prevS = s;
    }
  }

  /** The columns of light that come up over each landing (a flash as it lands, then a steady glow). */
  private updateBeams(t: number): void {
    let any = false;
    for (let i = 0; i < this.columns.length; i++) {
      const c = this.columns[i]!;
      const land = c.row.land;
      const up = c.planned ? MathUtils.smoothstep(t, land - 0.005, land + 0.001) * (1 - MathUtils.smoothstep(t, c.off[0], c.off[1])) : 0;
      if (up < 0.01) {
        this.beams.setMatrixAt(i, ZERO);
        continue;
      }
      const at = c.ship ? this.beacon.shipDeckAt(land, c.ship, this.p1).setY(this.p1.y - 2) : this.p1.copy(c.base);
      const h = c.h * up;
      const flash = 1 + 1.6 * Math.exp(-Math.max(t - land, 0) / 0.004);
      const r = c.r * (1 + 0.6 * (flash - 1) / 1.6);
      this.m4.makeScale(r, h, r).setPosition(at.x, at.y + h / 2, at.z);
      this.beams.setMatrixAt(i, this.m4);
      this.beams.setColorAt(i, this.c.copy(TEAL).multiplyScalar(c.gain * up * flash));
      any = true;
    }
    this.beams.visible = any;
    this.beams.instanceMatrix.needsUpdate = true;
    if (this.beams.instanceColor) this.beams.instanceColor.needsUpdate = true;
  }

  /** The three auth rings stamping out of the lamp, and the red pulse round the refused dart. */
  private updateRings(t: number): void {
    let any = false;
    const lamp = this.beacon.lantern;
    for (let k = 0; k < 3; k++) {
      const t0 = this.tLamp + 0.0015 + k * 0.0045;
      const x = (t - t0) / 0.012;
      if (x < 0 || x > 1) {
        this.rings.setMatrixAt(k, ZERO);
        continue;
      }
      any = true;
      const r = 0.9 + 6.5 * (1 - Math.pow(1 - x, 2.2));
      this.m4.lookAt(SHOT_POS, lamp, UP);
      this.q.setFromRotationMatrix(this.m4);
      this.rings.setMatrixAt(k, this.m4.compose(lamp, this.q, this.scl.setScalar(r)));
      this.rings.setColorAt(k, this.c.copy(TEAL).multiplyScalar(2.2 * Math.pow(1 - x, 1.4)));
    }
    // the do-not-send pulse: round the red dart as the stamp clamps on
    const x = (t - SKIPPED.t) / 0.007;
    if (x >= 0 && x <= 1) {
      any = true;
      const cam = this.modelCamera(t);
      this.pose(this.skip, Math.min(t, SKIPPED.t + 0.002), this.aspect, this.ringAt);
      this.m4.lookAt(cam.position, this.ringAt, UP);
      this.q.setFromRotationMatrix(this.m4);
      this.rings.setMatrixAt(3, this.m4.compose(this.ringAt, this.q, this.scl.setScalar(0.5 + 3 * x)));
      this.rings.setColorAt(3, this.c.copy(RED).multiplyScalar(2.4 * (1 - x)));
    } else this.rings.setMatrixAt(3, ZERO);
    this.rings.visible = any;
    this.rings.instanceMatrix.needsUpdate = true;
    if (this.rings.instanceColor) this.rings.instanceColor.needsUpdate = true;
  }

  /** The BCC bomber: lumbers out of the storm beside the hero, is struck at the gate, bursts into scraps. */
  private updateBomber(t: number, aspect: number): void {
    const on = t > BOMBER.from && t < BOMBER.strike + 0.0008;
    this.bomber.visible = on;
    if (on) {
      this.bomberPos(t, aspect, this.p0);
      this.path.tangentAt(t, this.tan);
      this.m4.lookAt(this.p1.copy(this.p0).add(this.tan), this.p0, UP);
      this.q.setFromRotationMatrix(this.m4);
      // overloaded: it wallows (a slow heavy roll), banked toward the lens so the list on its wings shows
      this.qRoll.setFromAxisAngle(this.tan, 0.12 * Math.sin(t * 260) - 0.55);
      this.q.premultiply(this.qRoll);
      const grow = MathUtils.smoothstep(t, BOMBER.from, BOMBER.from + 0.008);
      this.bomber.position.copy(this.p0);
      this.bomber.quaternion.copy(this.q);
      this.bomber.scale.setScalar(5 * grow);
      // the strike lights it up white-violet
      const hit = MathUtils.smoothstep(t, BOMBER.strike - 0.002, BOMBER.strike);
      this.bomberMaterial.emissiveIntensity = 0.42 + 2.2 * hit;
    }
    // the bolt, just before it bursts
    const bx = (t - (BOMBER.strike - 0.0022)) / 0.004;
    this.bolt.visible = bx > 0 && bx < 1;
    this.bomberPos(BOMBER.strike, aspect, this.strikeAt);
    if (this.bolt.visible) {
      this.bolt.position.copy(this.strikeAt);
      this.boltMaterial.opacity = (bx < 0.55 ? 1 : 1 - (bx - 0.55) / 0.45) * (0.75 + 0.25 * Math.sin(bx * 60));
    }
    // ~100 scraps out of the strike, tumbling down into the black sea
    const tau = (t - BOMBER.strike) / 0.026;
    this.burst.visible = tau > 0 && tau < 1;
    if (!this.burst.visible) return;
    const g = this.burst.geometry;
    const pos = g.attributes.position!.array as Float32Array;
    const col = g.attributes.color!.array as Float32Array;
    const n = pos.length / 3;
    const out = 1 - Math.pow(1 - tau, 2.4);
    const bright = Math.pow(1 - tau, 1.1);
    for (let i = 0; i < n; i++) {
      const sp = this.burstDirs[i * 4 + 3]! * 9;
      pos[i * 3] = this.strikeAt.x + this.burstDirs[i * 4]! * sp * out;
      pos[i * 3 + 1] = this.strikeAt.y + this.burstDirs[i * 4 + 1]! * sp * out - 16 * tau * tau;
      pos[i * 3 + 2] = this.strikeAt.z + this.burstDirs[i * 4 + 2]! * sp * out;
      col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = bright * (0.55 + 0.45 * Math.sin(i * 1.7 + tau * 40));
    }
    g.attributes.position!.needsUpdate = true;
    g.attributes.color!.needsUpdate = true;
  }

  // ---- the HUD --------------------------------------------------------------------------------------

  private chip(anchor: Vector3, mode: ChipMode, label: string): void {
    if (this.chipCount >= this.chipPool.length) return;
    const c = this.chipPool[this.chipCount++]!;
    c.anchor.copy(anchor);
    c.mode = mode;
    c.label = label;
    c.shown = true;
  }

  /**
   * What the fleet card and its chips show at story-t `t` (detour clock `u`): the card is a pure
   * function of (t, u) and the landings the visuals chose (src/story/fleet.ts `cardAt`); the chips
   * name each delivery while it flies (`→ Gail`, or its timetable slot `Gail · 09:29` in the V) and for
   * a moment once it has landed (`✓ Gail`). Writes into one reused object.
   */
  state(
    t: number, base: { chips: FleetChip[]; landings: readonly [number, number] }, aspect = 16 / 9, u = 0,
  ): BatchHudState {
    this.landings[0] = base.landings[0];
    this.landings[1] = base.landings[1];
    cardAt(t, u, this.card, this.landings);
    this.chipCount = 0;
    const inOffice = u > 0 && u < 1;
    if (!inOffice) this.buildChips(t, base.chips, aspect);
    for (let i = this.chipCount; i < this.chipPool.length; i++) this.chipPool[i]!.shown = false;
    // the stamps: 550 on the bomber as it bursts, DO-NOT-SEND on the 43rd
    this.stamps[0]!.shown = !inOffice && t >= BOMBER.strike && t < BOMBER.strike + 0.012;
    if (this.stamps[0]!.shown) this.stamps[0]!.anchor.copy(this.strikeAt);
    this.stamps[1]!.shown = !inOffice && t >= SKIPPED.t && t < SKIPPED.t + 0.013;
    if (this.stamps[1]!.shown) {
      this.pose(this.skip, Math.min(t, SKIPPED.t + 0.002), aspect, this.stamps[1]!.anchor);
      this.stamps[1]!.anchor.y += 1.1;
    }
    return this.hud;
  }

  private buildChips(t: number, scouts: FleetChip[], aspect: number): void {
    for (const c of scouts) if (c.shown) this.chip(c.anchor, c.mode, c.label);
    // the wing mates (#3-#5): their timetable slot on the wing, then `→`, then `✓` over the column
    if (this.wings && t > 0.25 && t < 0.32) {
      for (let i = 0; i < this.wings.count; i++) {
        const m: WingMate = this.wings.mate(i)!;
        const ri = m.row;
        if (t < m.land && m.shown) {
          this.p0.copy(m.at).y += 0.75;
          this.chip(this.p0, t < m.from ? 'slot' : 'flying', t < m.from ? CHIP_SLOT[ri]! : CHIP_FLYING[ri]!);
        } else if (t >= m.land && t < m.land + 0.012 && this.columns[ri]!.planned) {
          this.chip(this.columns[ri]!.chip, 'landed', CHIP_LANDED[ri]!);
        }
      }
    }
    // the V: the next three to leave carry their slot in the timetable; `→` on the way down, `✓` on landing
    if (t > FLEET_JOIN[0] && t < 0.36) {
      let slots = 0;
      for (const d of this.list) {
        if (d.kind !== 'v') continue;
        const ri = d.row!.n - 1;
        if (t < d.from) {
          const s = this.formation(d, t, aspect, this.p0);
          if (s > 0.6 && slots < (aspect < 0.8 ? 2 : 3)) {
            slots++;
            this.p0.y += 0.7;
            this.chip(this.p0, 'slot', CHIP_SLOT[ri]!);
          }
        } else if (t < d.land && d.planned) {
          if (this.glide(d, t, this.p0) > 0) this.chip(this.p0.setY(this.p0.y + 0.8), 'flying', CHIP_FLYING[ri]!);
        } else if (t < d.land + 0.012 && this.columns[ri]!.planned) {
          this.chip(this.columns[ri]!.chip, 'landed', CHIP_LANDED[ri]!);
        }
      }
      // Hugo's follow-ups, waiting in his place, then cancelled by his reply (one chip over the pair)
      if (this.hugo.planned) {
        if (t > this.hugo.from + 0.004 && t < REPLY.cancel + 0.008) {
          this.pose(this.ghosts[0]!, Math.min(t, REPLY.cancel + 0.003), aspect, this.p0);
          this.pose(this.ghosts[1]!, Math.min(t, REPLY.cancel + 0.003), aspect, this.p1);
          this.p0.lerp(this.p1, 0.5).y += 0.7;
          this.chip(this.p0, t < REPLY.cancel ? 'ghost' : 'cancel', t < REPLY.cancel ? REPLY.waiting : REPLY.cancelled);
        }
        if (t > this.reply.from + 0.001 && t < this.reply.land + 0.006 && this.pose(this.reply, t, aspect, this.p0) > 0) {
          this.p0.y += 0.6;
          this.chip(this.p0, 'reply', REPLY_CHIP);
        }
      }
    }
    // the bomber's list, readable
    if (t > BOMBER.from + 0.006 && t < BOMBER.strike) {
      this.bomberPos(t, aspect, this.p0);
      this.p0.y += 0.4;
      this.chip(this.p0, 'bad', BOMBER_CHIP);
    }
    // the far columns, the freighter, the terrace and the phones: `✓ name · clock` as each lands
    for (const c of this.columns) {
      const r = c.row;
      if (!c.planned || r.kind === 'wing' || r.kind === 'peel' || r.kind === 'lawn') continue;
      const ri = r.n - 1;
      const land = Number.isFinite(this.landings[ri]!) ? this.landings[ri]! : r.land;
      const d = this.dartOf[ri];
      if (d && t > d.from + 0.003 && t < land && r.kind !== 'ship') {
        if (this.glide(d, t, this.p0) > 0) this.chip(this.p0.setY(this.p0.y + 0.5), 'flying', CHIP_FLYING[ri]!);
      } else if (t >= land && t < land + 0.014) {
        if (c.ship) this.beacon.shipDeckAt(land, c.ship, this.p0).y += 15;
        else this.p0.copy(c.chip);
        this.chip(this.p0, 'landed', r.kind === 'cafe' || r.kind === 'phone' ? CHIP_ROLE[ri]! : CHIP_DONE[ri]!);
      }
    }
    // the auth rings
    for (let k = 0; k < 3; k++) {
      const t0 = this.tLamp + 0.0015 + k * 0.0045;
      if (t < t0 + 0.001 || t > t0 + 0.014) continue;
      const x = Math.min((t - t0) / 0.012, 1);
      const r = 0.9 + 6.5 * (1 - Math.pow(1 - x, 2.2));
      // each label rides its ring's lowest point, under the lamp (the lighthouse card stands beside it)
      this.camRight.setFromMatrixColumn(this.modelCamera(t, aspect).matrixWorld, 1);
      this.p0.copy(this.beacon.lantern).addScaledVector(this.camRight, -r);
      this.chip(this.p0, 'auth', AUTH_CHIPS[k]!);
    }
    // the refused 43rd
    if (t > this.skip.from + 0.002 && t < SKIPPED.t) {
      this.pose(this.skip, Math.min(t, SKIPPED.t + 0.002), aspect, this.p0);
      this.p0.y += 0.7;
      this.chip(this.p0, 'bad', SKIP_CHIP);
    }
    // City's envelopes, darts and the window wave (only while the Engine draws the city)
    if (this.city.group.visible) for (const m of this.city.fleetMail) {
      const ri = m.n - 1;
      if (m.p0 && t > m.from + 0.003 && t < m.land) {
        this.p0.copy(m.pos).y += 0.5;
        this.chip(this.p0, 'flying', CHIP_FLYING[ri]!);
      } else if (t >= m.land && t < m.land + (m.kind === 'wave' ? 0.007 : 0.012)) {
        this.p0.copy(m.at).y += 0.6;
        this.chip(this.p0, 'landed', m.kind === 'wave' ? CHIP_LANDED[ri]! : CHIP_ROLE[ri]!);
      }
    }
  }

  dispose(): void {
    this.dartGeometry.dispose();
    this.dartMaterial.dispose();
    this.paper.dispose();
    this.beamGeometry.dispose();
    this.beamFade.dispose();
    this.beamMaterial.dispose();
    this.ringGeometry.dispose();
    this.ringMaterial.dispose();
    this.bomberGeometry.dispose();
    this.bomberMaterial.dispose();
    this.bomberTex.dispose();
    this.burst.geometry.dispose();
    this.burstMaterial.dispose();
    this.burstFlecks.dispose();
    this.bolt.geometry.dispose();
    this.boltMaterial.dispose();
    if (this.trails) {
      this.trails.geometry.dispose();
      (this.trails.material as LineBasicMaterial).dispose();
    }
  }
}

const REPLY_CHIP = `↩ Re: ${row(REPLY.n).name}`;
const BOMBER_CHIP = 'BCC: amy, ben, dev, eli … +231 more';
const SKIP_CHIP = `✕ ${SKIPPED.email}`;
const AUTH_CHIPS = ['SPF ✓', 'DKIM ✓', 'DMARC ✓'];
