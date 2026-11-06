import {
  BoxGeometry,
  type BufferGeometry,
  Euler,
  InstancedBufferAttribute,
  InstancedMesh,
  MathUtils,
  Matrix4,
  MeshStandardMaterial,
  NoColorSpace,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  type Texture,
  TextureLoader,
  Vector3,
  type WebGLProgramParametersWithUniforms,
  Group,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { METRES_PER_UNIT, NOISE } from '../materials/glsl';
import { ROAD_WET, streetLampGlsl } from '../materials/Streets';
import { envBoxGlsl, mirrorGlsl } from '../materials/RoadReflect';
import { DECAL_CELLS, type DecalName } from './roadDecalAtlas';
import { litByLamps } from './CityLife';
import { asset } from '../asset';
import { mulberry32 } from '../util';
import type { Quality } from '../quality';

/** the canyon road's kerb (CityStreet.ROAD_HALF), the cross streets' half width (CROSS_HALF) */
const ROAD_HALF = 2.3;
const CROSS_HALF = 1.3;
/**
 * heights above the city group: the canyon's asphalt is at 0.006 (its junction boxes 0.0075), the paving at -0.02.
 * A decal stands 1.4 cm clear of its surface (in the frame's depth buffer anything nearer was lost to the
 * road under a flight-height camera), with a depth bias on top.
 */
const ON_ROAD = 0.02;
const ON_PAVING = 0.0;

interface Decal {
  name: DecalName;
  x: number;
  z: number;
  y: number;
  /** across (u) and along (v), city units; a negative width mirrors it */
  w: number;
  l: number;
  /** heading of the decal's top (its far end): radians, 0 = +x */
  head: number;
  tint: [number, number, number];
  alpha: number;
  /** erosion threshold (0 pristine, ~0.5 half gone; negative: none), roughness, glow, seed */
  wear: number;
  rough: number;
  glow: number;
}

export interface RoadDecalOptions {
  origin: Vector3;
  quality: Quality;
  crossX: readonly number[];
  /** the canyon road's run in x */
  x0: number;
  x1: number;
  parked: { x: number; z: number; yaw: number }[];
  occupied: { x: number; z: number; r: number }[];
  plazas: { x0: number; x1: number; z0: number; z1: number }[];
  vents: { x: number; z: number }[];
}

/**
 * The marks a city street collects, as decals over the canyon road and its pavements: painted words and
 * symbols (BUS LANE, SLOW, turn arrows, cycle and disabled-bay stencils, a hatched island, give-way teeth,
 * double yellow lines), repairs and sealed cracks, oil under the parked cars and at the stop lines, skid
 * marks, puddles, cast-iron covers with their lettering, utility dig marks sprayed in fluorescent paint,
 * gum, leaves, litter, wet footprints, cat's eyes down the centre line, and sunken gully grates (modelled).
 *
 * One instanced draw of thin quads from one atlas (scripts/make-street-decals.py), drawn just above the
 * asphalt with a depth bias; each copy has its own tint, opacity and wear, and wears again in world space
 * so no two look alike. They are lit like the road (the lamp field), go glossy where the road is wet, and
 * mirror the canyon as the road does (RoadReflect). HIGH adds the normal/roughness atlas. Plus one draw for
 * the grates. Placement comes from its own seeded streams (nothing else in the city moves) and keeps out of
 * the crossings, the parked cars, the plazas and terrace, the props, and each other.
 */
export class RoadDecals {
  readonly group = new Group();
  readonly count: number;
  private disposables: { dispose(): void }[] = [];

  constructor(o: RoadDecalOptions, envMap: Texture | null) {
    const high = o.quality.tier === 'high';
    const list = place(o, high);
    this.count = list.length;

    // ---- the decal draw ---------------------------------------------------------------------------------
    const load = (file: string, srgb: boolean): Texture => {
      const t = new TextureLoader().load(asset(`/models/street-decals/${file}`));
      t.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
      t.anisotropy = 8;
      this.disposables.push(t);
      return t;
    };
    const color = load('decals-color.webp', true);
    const nrm = high ? load('decals-nrm.webp', false) : null;
    const geometry = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const n = list.length;
    const rect = new Float32Array(n * 4);
    const tint = new Float32Array(n * 4);
    const parm = new Float32Array(n * 4);
    const mesh = new InstancedMesh(geometry, decalMaterial(o.origin, nrm, envMap, high, color), n);
    const m4 = new Matrix4();
    const q = new Quaternion();
    const e = new Euler();
    const p = new Vector3();
    const s = new Vector3();
    list.forEach((d, i) => {
      // the quad's top (v = 1) is its local -z; turn it to face `head`
      q.setFromEuler(e.set(0, Math.atan2(-Math.cos(d.head), -Math.sin(d.head)), 0));
      mesh.setMatrixAt(i, m4.compose(p.set(d.x, d.y, d.z), q, s.set(Math.abs(d.w), 1, d.l)));
      // a mirrored copy (negative width) reads its cell right to left, so its faces keep their winding
      const [u0, v0, du, dv] = DECAL_CELLS[d.name];
      rect.set(d.w < 0 ? [u0 + du, v0, -du, dv] : [u0, v0, du, dv], i * 4);
      tint.set([...d.tint, d.alpha], i * 4);
      parm.set([d.wear, d.rough, d.glow, (i * 0.618) % 1], i * 4);
    });
    geometry.setAttribute('aRect', new InstancedBufferAttribute(rect, 4));
    geometry.setAttribute('aTint', new InstancedBufferAttribute(tint, 4));
    geometry.setAttribute('aParm', new InstancedBufferAttribute(parm, 4));
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    mesh.name = 'road-decals';
    this.group.add(mesh);
    this.disposables.push(geometry, mesh.material as MeshStandardMaterial, mesh);

    // ---- gully grates: cast iron over the pits, sunk flush in the gutter -------------------------------
    const grates = list.filter((d) => d.name === 'drain');
    if (grates.length) {
      const parts: BufferGeometry[] = [];
      const bar = (sx: number, sz: number, x: number, z: number): void => {
        parts.push(new BoxGeometry(sx, 0.012, sz).translate(x, 0.012, z));
      };
      // frame, then slats running with the flow (along x)
      const GX = 0.27;
      const GZ = 0.165;
      bar(GX, 0.014, 0, -GZ / 2);
      bar(GX, 0.014, 0, GZ / 2);
      bar(0.014, GZ, -GX / 2, 0);
      bar(0.014, GZ, GX / 2, 0);
      for (let k = 1; k < 7; k++) bar(GX - 0.02, 0.009, 0, -GZ / 2 + (k * GZ) / 7);
      bar(0.01, GZ - 0.01, 0, 0);
      const grate = mergeGeometries(parts)!;
      for (const g of parts) g.dispose();
      const iron = new MeshStandardMaterial({ color: '#2a2c30', roughness: 0.42, metalness: 0.55 });
      litByLamps(iron, o.origin, high ? 3 : 6);
      if (envMap) iron.envMap = envMap;
      const gm = new InstancedMesh(grate, iron, grates.length);
      grates.forEach((d, i) => gm.setMatrixAt(i, m4.compose(p.set(d.x, 0.002, d.z), q.identity(), s.set(1, 1, 1))));
      gm.frustumCulled = false;
      gm.name = 'road-grates';
      this.group.add(gm);
      this.disposables.push(grate, iron, gm);
    }
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}

/** the decals' material: atlas colour and coverage, worn in world space, lit and mirrored like the road */
function decalMaterial(origin: Vector3, nrm: Texture | null, envMap: Texture | null, high: boolean, color: Texture): MeshStandardMaterial {
  const material = new MeshStandardMaterial({
    map: color,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -16,
    roughness: 0.6,
    metalness: 0,
  });
  if (envMap) material.envMap = envMap;
  const M = METRES_PER_UNIT.toFixed(2);
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    shader.uniforms.uSOrigin = { value: origin };
    if (nrm) shader.uniforms.uDecalN = { value: nrm };
    const lampPars = streetLampGlsl(shader, high ? 3 : 9);
    const mirrorPars = mirrorGlsl(shader, true);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', /* glsl */ `#include <common>
        uniform vec3 uSOrigin;
        attribute vec4 aRect;
        attribute vec4 aTint;
        attribute vec4 aParm;
        varying vec3 vSW;
        varying vec4 vTint;
        varying vec4 vParm;
        varying vec3 vDT;
        varying vec3 vDB;`)
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvMapUv = aRect.xy + uv * aRect.zw;')
      .replace('#include <begin_vertex>', /* glsl */ `#include <begin_vertex>
        mat4 dm = modelMatrix * instanceMatrix;
        vSW = (dm * vec4(position, 1.0)).xyz - uSOrigin;
        vDT = normalize(mat3(dm) * vec3(1.0, 0.0, 0.0)) * sign(aRect.z);
        vDB = normalize(mat3(dm) * vec3(0.0, 0.0, -1.0));
        vTint = aTint;
        vParm = aParm;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', /* glsl */ `#include <common>
        varying vec3 vSW;
        uniform vec3 uSOrigin;
        varying vec4 vTint;
        varying vec4 vParm;
        varying vec3 vDT;
        varying vec3 vDB;
        ${nrm ? 'uniform sampler2D uDecalN;' : ''}
        ${NOISE}
        ${ROAD_WET}
        float decalWet = 0.0;
        vec3 decalN = vec3(0.0, 0.0, 1.0);
        vec3 decalNT = vec3(0.5, 0.5, 0.6);
        ${lampPars}
        ${mirrorPars}`)
      .replace('#include <map_fragment>', /* glsl */ `#include <map_fragment>
        {
          vec2 pm = vSW.xz * ${M};
          // each copy wears on its own: erosion in world space, past a threshold of its own
          float er = nNoise(pm * 11.0 + vParm.w * 17.0) * 0.45 + nNoise(pm * 0.9 + 3.0 + vParm.w * 5.0) * 0.55;
          diffuseColor.a *= vTint.a * (vParm.x < 0.0 ? 1.0 : smoothstep(vParm.x - 0.12, vParm.x + 0.12, er));
          diffuseColor.rgb *= vTint.rgb * 0.85;
          float lz = abs(vSW.z);
          decalWet = lz < 2.3 ? roadWet(pm, lz) : smoothstep(0.62, 0.74, nFbm(pm * 0.16 + 31.0)) * 0.8;
          diffuseColor.rgb *= 1.0 - 0.4 * decalWet;
          ${nrm ? /* glsl */ `
          decalNT = texture2D(uDecalN, vMapUv).rgb;
          decalN = vec3(decalNT.xy * 2.0 - 1.0, 1.0);` : ''}
        }`)
      .replace('#include <roughnessmap_fragment>', /* glsl */ `#include <roughnessmap_fragment>
        ${nrm ? 'roughnessFactor = mix(vParm.y, decalNT.b, 0.6);' : 'roughnessFactor = vParm.y;'}
        roughnessFactor = mix(roughnessFactor, 0.035, decalWet * 0.85);`)
      .replace('#include <normal_fragment_maps>', /* glsl */ `#include <normal_fragment_maps>
        ${nrm ? /* glsl */ `
        {
          vec3 T = normalize((viewMatrix * vec4(vDT, 0.0)).xyz);
          vec3 B = normalize((viewMatrix * vec4(vDB, 0.0)).xyz);
          normal = normalize(T * decalN.x * (1.0 - decalWet) + B * decalN.y * (1.0 - decalWet) + normal);
        }` : ''}`)
      .replace('#include <emissivemap_fragment>', /* glsl */ `#include <emissivemap_fragment>
        {
          vec3 Vw2 = normalize(cameraPosition - (vSW + uSOrigin));
          vec3 Nw = inverseTransformDirection(normal, viewMatrix);
          totalEmissiveRadiance += streetLamps(vSW, Nw, Vw2, diffuseColor.rgb, roughnessFactor);
          // cat's eyes: the lenses hand the lamps (and any headlight) straight back
          float lens = smoothstep(0.2, 0.45, dot(diffuseColor.rgb, vec3(0.3333)));
          totalEmissiveRadiance += diffuseColor.rgb * lens * vParm.z * (0.35 + streetLampI * 3.0);
          float fr = 0.02 + 0.98 * pow(1.0 - max(dot(Nw, Vw2), 0.0), 5.0);
          totalEmissiveRadiance += roadMirror(vSW, reflect(-Vw2, Nw), roughnessFactor) * fr * mix(0.1, 1.0, max(decalWet, 1.0 - smoothstep(0.03, 0.2, vParm.y)));
        }`);
    if (envMap) envBoxGlsl(shader);
  };
  material.customProgramCacheKey = () => `road-decals-${high ? 'hi' : 'lo'}-${envMap ? 'env' : 'noenv'}`;
  return material;
}

// ---- placement ---------------------------------------------------------------------------------------------

const WHITE: [number, number, number] = [1, 1, 1];
const FLUORO: [number, number, number][] = [[1, 0.34, 0.04], [1, 0.12, 0.55], [0.35, 1, 0.18], [0.15, 0.55, 1], [1, 0.9, 0.08]];

function place(o: RoadDecalOptions, high: boolean): Decal[] {
  const out: Decal[] = [];
  // circles already taken by markings (no two painted symbols on top of each other)
  const taken: { x: number; z: number; r: number }[] = [];
  const nearCross = (x: number): number => Math.min(...o.crossX.map((sx) => Math.abs(x - sx)));
  /** the crossing band (zebra and stop lines) of either side of a junction */
  const onCrossing = (x: number, r: number): boolean => {
    const d = nearCross(x);
    return d + r > CROSS_HALF + 0.2 && d - r < CROSS_HALF + 2.5;
  };
  const inJunction = (x: number, r: number): boolean => nearCross(x) - r < CROSS_HALF;
  const underCar = (x: number, z: number, r: number): boolean =>
    o.parked.some((c) => Math.abs(c.x - x) < 1.45 + r && Math.abs(c.z - z) < 0.5 + r);
  const clash = (x: number, z: number, r: number): boolean => taken.some((t) => Math.hypot(t.x - x, t.z - z) < t.r + r);
  const onProp = (x: number, z: number, r: number): boolean =>
    o.occupied.some((t) => Math.hypot(t.x - x, t.z - z) < t.r + r) ||
    o.plazas.some((pz) => x > pz.x0 - r && x < pz.x1 + r && z > Math.min(pz.z0, pz.z1) - r && z < Math.max(pz.z0, pz.z1) + r);
  const add = (d: Partial<Decal> & Pick<Decal, 'name' | 'x' | 'z' | 'w' | 'l' | 'head'>, mark = false): void => {
    const full: Decal = { y: ON_ROAD, tint: WHITE, alpha: 1, wear: 0.2, rough: 0.5, glow: 0, ...d };
    out.push(full);
    if (mark) taken.push({ x: full.x, z: full.z, r: Math.max(Math.abs(full.w), full.l) / 2 });
  };

  // ---- painted markings, before every junction in each lane ----------------------------------------------
  const rand = mulberry32(60311);
  const lanes = [{ z: 1.1, dir: 1 }, { z: -1.1, dir: -1 }];
  let bus = 0;
  for (const sx of o.crossX) {
    for (const lane of lanes) {
      // the lane approaches this junction from -dir
      const at = (before: number): number => sx - lane.dir * before;
      const head = lane.dir > 0 ? 0 : Math.PI;
      const jitter = (): number => (rand() - 0.5) * 0.06;
      const r = rand();
      const arrowX = at(5.6 + rand() * 0.6);
      if (at(12) > o.x0 && at(12) < o.x1) {
        if (r < 0.55) add({ name: 'arrowAhead', x: arrowX, z: lane.z + jitter(), w: 0.62, l: 2.6, head: head + jitter() * 0.3, wear: 0.15 + rand() * 0.35 }, true);
        else if (r < 0.9) add({ name: 'arrowLeft', x: arrowX, z: lane.z + jitter(), w: (r < 0.75 ? 1 : -1) * 0.62, l: 2.6, head: head + jitter() * 0.3, wear: 0.15 + rand() * 0.35 }, true);
        // words further back: SLOW before some crossings, BUS LANE on two stretches of the kerb-side lane
        const words = rand();
        if (lane.dir > 0 && bus < 2 && words < 0.4) {
          bus++;
          add({ name: 'busLane', x: at(10.2), z: lane.z + jitter(), w: 1.15, l: 3.3, head, wear: 0.2 + rand() * 0.3 }, true);
        } else if (words < 0.6) {
          add({ name: 'slow', x: at(10.0), z: lane.z + jitter(), w: 1.05, l: 3.0, head, wear: 0.25 + rand() * 0.35 }, true);
        }
        // a hatched island down the centre before some crossings
        if (lane.dir > 0 && rand() < 0.35) add({ name: 'hatch', x: at(7.2), z: 0, w: 0.62, l: 3.4, head, wear: 0.3 + rand() * 0.3 }, true);
      }
      // skid marks and an oil blot where the cars stop
      if (rand() < 0.5) add({ name: 'skid', x: at(4.2 + rand() * 2.5), z: lane.z + (rand() - 0.5) * 0.1, w: 1.95, l: 1.8 + rand() * 2.2, head: head + (rand() - 0.5) * 0.06, alpha: 0.5 + rand() * 0.4, wear: -1, rough: 0.35 });
      if (rand() < 0.6) add({ name: rand() < 0.5 ? 'oil' : 'oilDrips', x: at(3.0 + rand() * 0.6), z: lane.z + (rand() - 0.5) * 0.2, w: 0.5 + rand() * 0.4, l: 0.5 + rand() * 0.4, head: rand() * 6.28, alpha: 0.5 + rand() * 0.4, wear: -1, rough: 0.12 });
    }
    // give-way teeth across the cross street's lanes, out past its stop line, on both sides
    for (const side of [1, -1]) {
      for (const lx of [0.6, -0.6]) {
        // the lane at sx + 0.6 comes in from +z (heading -z), the one at sx - 0.6 from -z
        if ((lx > 0) !== (side > 0)) continue;
        for (const du of [-0.27, 0.27]) {
          add({ name: 'yield', x: sx + lx + du, z: side * (ROAD_HALF + 1.35), w: 0.52, l: 0.32, head: side > 0 ? -Math.PI / 2 : Math.PI / 2, wear: 0.25 + rand() * 0.3 });
        }
      }
    }
    // double yellow lines in the gutter pan, where nothing may park by the junction
    for (const side of [1, -1]) {
      for (const e of [-1, 1]) {
        let x = sx + e * (CROSS_HALF + 0.1);
        const end = sx + e * (CROSS_HALF + 3.0 + rand() * 1.5);
        while ((end - x) * e > 0.2) {
          const len = Math.min(1.6 + rand() * 0.8, Math.abs(end - x));
          add({ name: 'kerbYellow', x: x + (e * len) / 2, z: side * 2.168, w: 0.1, l: len, head: 0, wear: 0.25 + rand() * 0.35, rough: 0.45 });
          x += e * len;
        }
      }
    }
  }
  // cycle stencils and disabled bays along the kerb side, clear of the parked cars
  const kerbR = mulberry32(60317);
  for (let x = o.x0 + 4; x < o.x1 - 4; x += 6 + kerbR() * 8) {
    const side = kerbR() < 0.5 ? 1 : -1;
    const z = side * 1.68;
    const kind = kerbR();
    if (kind < 0.3 && !onCrossing(x, 0.6) && !inJunction(x, 0.6) && !underCar(x, z, 0.4) && !clash(x, z, 0.55)) {
      add({ name: 'bike', x, z, w: 0.55, l: 1.0, head: side > 0 ? 0 : Math.PI, wear: 0.2 + kerbR() * 0.35 }, true);
    } else if (kind > 0.93 && !onCrossing(x, 0.5) && !inJunction(x, 0.5) && !underCar(x, side * 1.95, 0.4) && !clash(x, side * 1.95, 0.4)) {
      add({ name: 'disabled', x, z: side * 1.95, w: 0.52, l: 0.52, head: side > 0 ? 0 : Math.PI, wear: 0.15 + kerbR() * 0.3 }, true);
    }
  }

  // ---- wear and tear on the asphalt -----------------------------------------------------------------------
  const wearR = mulberry32(60323);
  const roadSpot = (r: number, zs = 2.0): { x: number; z: number } | null => {
    for (let k = 0; k < 12; k++) {
      const x = o.x0 + 3 + wearR() * (o.x1 - o.x0 - 6);
      const z = (wearR() * 2 - 1) * zs;
      if (onCrossing(x, r) || clash(x, z, r)) continue;
      return { x, z };
    }
    return null;
  };
  for (let i = 0; i < 16; i++) {
    const s = roadSpot(0.9);
    if (!s || underCar(s.x, s.z, 0.6)) continue;
    const w = 0.5 + wearR() * 1.1;
    add({ name: 'patch', x: s.x, z: s.z, w, l: 0.5 + wearR() * 1.2, head: (wearR() < 0.5 ? 0 : Math.PI / 2) + (wearR() - 0.5) * 0.08, alpha: 0.75 + wearR() * 0.25, wear: -1, rough: 0.6, tint: [0.9 + wearR() * 0.4, 0.9 + wearR() * 0.4, 0.95 + wearR() * 0.4] }, true);
  }
  for (let i = 0; i < (high ? 22 : 12); i++) {
    const s = roadSpot(0.5);
    if (!s) continue;
    add({ name: wearR() < 0.5 ? 'crackA' : 'crackB', x: s.x, z: s.z, w: 0.35 + wearR() * 0.3, l: 0.8 + wearR() * 0.9, head: wearR() * 6.28, alpha: 0.8 + wearR() * 0.2, wear: -1, rough: 0.3 });
  }
  // puddles: in the ruts and the low spots, larger in the gutters
  for (let i = 0; i < 24; i++) {
    const s = roadSpot(0.5, 2.15);
    if (!s) continue;
    const big = 0.5 + wearR() * 1.2;
    add({ name: wearR() < 0.5 ? 'puddleA' : 'puddleB', x: s.x, z: Math.abs(s.z) > 1.9 ? Math.sign(s.z) * (1.95 + wearR() * 0.2) : s.z, w: big, l: big * (0.7 + wearR() * 0.6), head: wearR() * 6.28, alpha: 0.7 + wearR() * 0.25, wear: -1, rough: 0.02 });
  }
  // oil under the parked cars, toward the engine
  for (const c of o.parked) {
    if (wearR() > 0.7) continue;
    const fwd = Math.cos(c.yaw) > 0 ? 1 : -1;
    add({ name: wearR() < 0.5 ? 'oil' : 'oilDrips', x: c.x + fwd * (0.4 + wearR() * 0.5), z: c.z + (wearR() - 0.5) * 0.2, w: 0.45 + wearR() * 0.5, l: 0.45 + wearR() * 0.5, head: wearR() * 6.28, alpha: 0.55 + wearR() * 0.4, wear: -1, rough: 0.12 });
  }
  // cast covers: the steaming ones, and more of them about the road
  for (const v of o.vents) add({ name: 'manhole', x: v.x, z: v.z, y: 0.032, w: 0.31, l: 0.31, head: wearR() * 6.28, wear: -1, rough: 0.5 });
  for (let i = 0; i < 10; i++) {
    const s = roadSpot(0.25);
    if (!s || underCar(s.x, s.z, 0.2)) continue;
    const sq = wearR() < 0.4;
    add({ name: sq ? 'manholeSq' : 'manhole', x: s.x, z: s.z, w: sq ? 0.26 : 0.32, l: sq ? 0.26 : 0.32, head: sq ? Math.PI / 2 * Math.floor(wearR() * 4) : wearR() * 6.28, wear: -1, rough: 0.5 }, true);
    // the utility's dig marks sprayed round it, now and then
    if (wearR() < 0.55) {
      const a = wearR() * 6.28;
      add({ name: wearR() < 0.5 ? 'spray' : 'spray2', x: s.x + Math.cos(a) * 0.45, z: MathUtils.clamp(s.z + Math.sin(a) * 0.45, -2.1, 2.1), w: 0.45 + wearR() * 0.25, l: 0.45 + wearR() * 0.25, head: wearR() * 6.28, tint: FLUORO[Math.floor(wearR() * FLUORO.length)]!, alpha: 0.75 + wearR() * 0.25, wear: 0.15 + wearR() * 0.3, rough: 0.55 });
    }
  }
  for (let i = 0; i < 6; i++) {
    const s = roadSpot(0.4);
    if (!s) continue;
    add({ name: wearR() < 0.5 ? 'spray' : 'spray2', x: s.x, z: s.z, w: 0.5 + wearR() * 0.3, l: 0.5 + wearR() * 0.3, head: wearR() * 6.28, tint: FLUORO[Math.floor(wearR() * FLUORO.length)]!, alpha: 0.8, wear: 0.15 + wearR() * 0.35, rough: 0.55 });
  }
  // gully grates in the gutters, every dozen metres or so, clear of the junctions
  const drainR = mulberry32(60329);
  for (const side of [1, -1]) {
    for (let x = o.x0 + 3 + drainR() * 5; x < o.x1 - 3; x += 5 + drainR() * 3.5) {
      if (nearCross(x) < CROSS_HALF + 0.6) continue;
      add({ name: 'drain', x, z: side * 2.16, y: 0.012, w: 0.29, l: 0.66, head: 0, wear: -1, rough: 0.1, alpha: 0.95 });
      // leaves and grit silted against it
      if (drainR() < 0.5) add({ name: 'leaves', x: x + (drainR() - 0.5) * 0.6, z: side * 2.12, w: 0.35, l: 0.35, head: drainR() * 6.28, tint: [0.55, 0.5, 0.45], alpha: 0.9, wear: -1, rough: 0.3 });
    }
  }
  // cat's eyes down the centre line (and phones every other one)
  const step = high ? 1.8 : 3.6;
  for (let x = o.x0 + 2; x < o.x1 - 2; x += step) {
    if (nearCross(x) < CROSS_HALF + 2.6) continue;
    add({ name: 'catsEye', x, z: 0, y: 0.024, w: 0.095, l: 0.075, head: 0, tint: [1, 0.86, 0.6], wear: -1, rough: 0.2, glow: 0.6 });
  }

  // ---- the pavements: gum, leaves, litter, wet footprints by the crossings ---------------------------------
  const paveR = mulberry32(60331);
  const pave = high ? 64 : 34;
  for (let i = 0; i < pave; i++) {
    const x = o.x0 + 2 + paveR() * (o.x1 - o.x0 - 4);
    const side = paveR() < 0.5 ? 1 : -1;
    const z = side * (ROAD_HALF + 0.12 + paveR() * 0.75);
    if (inJunction(x, 0.3) || onProp(x, z, 0.25)) continue;
    const k = paveR();
    const name: DecalName = k < 0.4 ? 'gum' : k < 0.7 ? 'leaves' : 'litter';
    const sz = 0.4 + paveR() * 0.4;
    add({ name, x, z, y: ON_PAVING, w: sz, l: sz, head: paveR() * 6.28, alpha: name === 'gum' ? 0.7 : 0.95, wear: -1, rough: name === 'leaves' ? 0.35 : 0.6 });
  }
  for (const sx of o.crossX) {
    if (paveR() < 0.4) continue;
    const e = paveR() < 0.5 ? 1 : -1;
    const side = paveR() < 0.5 ? 1 : -1;
    const x = sx + e * (CROSS_HALF + 0.5 + paveR() * 0.5);
    const z = side * (ROAD_HALF + 0.55);
    if (onProp(x, z, 0.3)) continue;
    add({ name: 'footprints', x, z, y: ON_PAVING, w: 0.4, l: 0.8, head: side > 0 ? -Math.PI / 2 : Math.PI / 2, alpha: 0.6, wear: -1, rough: 0.05 });
  }
  return out;
}
