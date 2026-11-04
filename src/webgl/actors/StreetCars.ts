import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  CustomBlending,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  MathUtils,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  OneFactor,
  OneMinusSrcAlphaFactor,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Quaternion,
  TextureLoader,
  Vector3,
} from 'three';
import type { Material, Texture, WebGLProgramParametersWithUniforms } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { dequantized } from './KitCity';
import { HOME_CELL, HOME_CELLS } from '../bake/cityGen.mjs';
import { glowTexture, softShadowTexture } from '../bake/CanvasTextures';
import { asset } from '../asset';
import { LAMP_CASTER_LAYER } from '../layers';
import { mulberry32 } from '../util';
import type { Quality } from '../quality';

interface CarType {
  id: string;
  /** the lean model: used far away and on the LOW tier */
  file: string;
  /** the hero model for cars near the camera (paint, detail, glass and one wheel), HIGH tier only */
  hi?: string;
  /** the mid model, the same four meshes at a lower resolution, for cars between the hero and lean ranges (HIGH) */
  mid?: string;
  /**
   * the hero paint's baked maps: `paint` packs occlusion, road grime and curvature in R, G and B;
   * `normal` holds the high-poly skin's tangent-space normals (blender/bld/car_bake.py)
   */
  maps?: { paint: string; normal: string };
  length: number;
  width: number;
  /** a supercar: painted from EXOTIC_PAINTS with a glossier clearcoat, dealt out at about one car in seven */
  exotic?: boolean;
  lamp: { head: number[]; tail: number[] };
  wheelRadius?: number;
  /** where the four wheels sit, glTF frame: front pair then rear pair, left (-z) first */
  wheelOffsets?: number[][];
}

/** A car's pose and state. Moving cars are `Driver`s on a lane; parked ones never change. */
interface Car {
  idx: number;
  type: number;
  tint: Color;
  x: number;
  z: number;
  yaw: number;
  scale: number;
  /** distance rolled, which turns the wheels */
  odo: number;
  /** brake-light level, 0 to 1 */
  brake: number;
  /** drawn as a close-up model (kept so the swaps have hysteresis): 0 lean, 1 mid, 2 hero */
  near: 0 | 1 | 2;
}

interface Driver extends Car {
  s: number;
  v: number;
  vMax: number;
}

interface Lane {
  z: number;
  dir: 1 | -1;
  /** the stretch of road the lane covers, along x */
  x0: number;
  x1: number;
  drivers: Driver[];
  /** stop lines along the lane (s, ascending) and the light that governs them; none: the lane never stops */
  stops: number[];
  phase: ((time: number) => 0 | 1 | 2) | null;
}

/** Where traffic runs, when it is not the neighbourhood's own streets. */
export interface CarOptions {
  lanes: {
    z: number; dir: 1 | -1; x0: number; x1: number; count: number;
    /** stop lines (distance along the lane, from where it starts) and the light for them: 0 green, 1 amber, 2 red */
    stops?: number[];
    phase?: (time: number) => 0 | 1 | 2;
  }[];
  /** uniform scale of every car, speed and spacing (the night city draws its cars larger) */
  scale?: number;
}

/** One set of instanced meshes for a vehicle type: the lean tier, or one of the close-up ones (mid, hero). */
interface Tier {
  paint: InstancedMesh;
  detail: InstancedMesh;
  glass?: InstancedMesh;
  wheels?: InstancedMesh;
  /** per-instance brake level, read by the tail-lamp lenses */
  brake?: InstancedBufferAttribute;
  count: number;
}

/**
 * Family-car paints in about the shares real traffic has them: mostly whites, silvers, greys and
 * blacks, then deep reds, blues and greens, a bronze and a champagne, all toned down (nothing
 * saturated, as everywhere in the town).
 */
const PAINTS = [
  '#d9d9d5', '#e6e4dc', '#d2d3d1', '#c1c4c8', '#a4a9ae', '#8d9298', '#6a6f76', '#4a4e54', '#3a3d42',
  '#1b1d21', '#15171a', '#24272c', '#5c2024', '#6e2a27', '#2a3a57', '#3b5571', '#33463b', '#5f5244',
  '#8a8172',
];
const TAXI_PAINT = '#d2a42e';
/** the exotics' own palette, deep rather than loud: rosso, arancio, giallo, verde, blu, white, black, viola, gunmetal, racing green */
const EXOTIC_PAINTS = [
  '#8e1b20', '#b0502a', '#bf9631', '#5d7438', '#23386a', '#e8e9e7', '#0e0f12', '#45324f', '#4a4f57', '#1c3b2e',
];
/**
 * How common each vehicle type is on the street; the rest default to 1. The exotics'
 * share of the total (here about one car in seven) is dealt out evenly rather than drawn
 * (see `dealer`), so every street has its few.
 */
const TRAFFIC: Record<string, number> = {
  sedan: 3, hatch: 2.5, suv: 3, pickup: 1.6, van: 0.8, taxi: 0.35, supercar: 0.75, gt: 0.6, hyper: 0.45,
};
const PARKED: Record<string, number> = {
  sedan: 3, hatch: 2.5, suv: 3, pickup: 2, van: 0.8, taxi: 0, supercar: 0.8, gt: 0.6, hyper: 0.4,
};

/** the lane runs from `X0` to `X1`, a fixed stretch of the street well past anything in frame */
const X0 = -12;
const X1 = 150;
const LANE_OFFSET = 0.55; // from the street's centre line; matches the tyre-polished lines in make_ground.py
const FADE = 7;           // units over which a car grows in and out at a lane's ends
/**
 * a car is drawn as a close-up model inside HI_IN of the camera and goes back to the lean one past HI_OUT;
 * inside HERO_IN (out to HERO_OUT) that close-up model is the hero, between there and HI_IN the mid one
 */
const HI_IN = 28;
const HI_OUT = 33;
const HERO_IN = 12;
const HERO_OUT = 15;

/**
 * Material class of each `detail` vertex, packed in the alpha of its colour by
 * blender/bld/cars.py: 0 plastic, 1 chrome, 2 rubber, 3 alloy, 4 fabric, 5 head lamp,
 * 6 tail lamp, 7 plate, 8 brake disc, 9 indicator, 10 gloss black, 11 liner, 12 carbon
 * fibre (clear-coated, a little sheen), 13 LED light guide (running lights, burns
 * brighter than a lamp lens), 14 enamel (painted calipers, badges, centre-lock nuts).
 */
const CLASS_TABLE = `
const float KR[16] = float[16](0.55, 0.10, 0.90, 0.30, 0.95, 0.12, 0.20, 0.50, 0.40, 0.20, 0.08, 0.90, 0.22, 0.15, 0.25, 0.55);
const float KM[16] = float[16](0.0, 1.0, 0.0, 0.9, 0.0, 0.0, 0.0, 0.0, 0.9, 0.0, 0.0, 0.0, 0.25, 0.0, 0.0, 0.0);
const float KE[16] = float[16](0.0, 0.0, 0.0, 0.0, 0.0, 1.6, 0.35, 0.0, 0.0, 1.2, 0.0, 0.0, 0.0, 2.6, 0.0, 0.0);
`;

/**
 * The hero paint of one vehicle type: the shared clear-coated paint with that type's baked maps.
 * The packed map's R (occlusion) is the material's `aoMap`, which dims the sky and reflections it
 * shades; the shader also lets it dim the direct light a little (the bounce a crease never gets)
 * and lays road film over the paint by its G (grime), which roughens the paint and thins the coat.
 */
function heroPaint(base: MeshPhysicalMaterial, packed: Texture, normal: Texture): MeshPhysicalMaterial {
  const mat = base.clone();
  mat.aoMap = packed;
  mat.aoMapIntensity = 1;
  mat.normalMap = normal;          // the GLB carries MikkTSpace tangents, so no flip
  mat.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec3 carPk = texture2D( aoMap, vAoMapUv ).rgb;
        diffuseColor.rgb *= mix( 0.74, 1.0, carPk.r );
        diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.15, 0.125, 0.09 ), carPk.g * 0.5 );`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nroughnessFactor = mix( roughnessFactor, 0.8, carPk.g * 0.55 );',
      )
      .replace(
        '#include <lights_physical_fragment>',
        `#include <lights_physical_fragment>
        material.clearcoat *= 1.0 - 0.65 * carPk.g;
        material.clearcoatRoughness = mix( material.clearcoatRoughness, 0.4, carPk.g );`,
      );
  };
  mat.customProgramCacheKey = () => 'street-cars-hero-paint';
  return mat;
}

/** A standard material whose roughness, metalness and emission come from each vertex's material class. */
function classMaterial(): MeshStandardMaterial {
  const mat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.15 });
  mat.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aBrake;\nvarying float vBrake;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBrake = aBrake;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying float vBrake;\n${CLASS_TABLE}`)
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nint kls = int(clamp(floor(vColor.a * 16.0), 0.0, 15.0));\nroughnessFactor = KR[kls];',
      )
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = KM[kls];')
      .replace(
        '#include <emissivemap_fragment>',
        // the tail lens burns brighter as the brake level rises
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * (KE[kls] + (kls == 6 ? 2.4 * vBrake : 0.0));',
      );
  };
  mat.customProgramCacheKey = () => 'street-cars-class';
  return mat;
}

/**
 * Traffic and parked cars in the neighbourhood. Moving cars follow the street
 * lanes in a ring, slowing for whoever is ahead (so they never drive through each
 * other); parked cars sit in the front yards of the houses the flight passes. The
 * bodies are instanced (nine vehicle types, paint tinted per instance): six family
 * cars and three exotics (a mid-engine supercar, a front-engine GT, a winged
 * hypercar), which take a palette and a glossier clearcoat of their own.
 *
 * Each type exists twice. The lean model (1.4 to 1.6k triangles, its occlusion and
 * road grime baked into vertex colours) is what everything more than HI_IN units from
 * the camera is drawn with, and all there is on the LOW tier. The hero model (HIGH
 * only: a finely lofted body with a baked occlusion, grime and normal map from its
 * high-poly twin, a glasshouse with its interior, lamps, plates, mirrors, multi-spoke
 * rims over ventilated discs, 22 to 26k triangles counting its wheels) is drawn inside
 * HERO_IN; between there and HI_IN a mid model with the same parts at the old close-up
 * resolution (10 to 13k, occlusion baked per vertex) stands in. Both have their four
 * wheels as one more instanced mesh, which is what lets them turn with the distance rolled. Every frame the cars are
 * partitioned between the two sets by distance to the camera, so the cost follows
 * the handful of cars the camera is actually near. Headlights and tail lights are
 * glow sprites (tail lights flare while a car brakes), and the headlights throw a
 * pool onto the road. On HIGH the bodies and wheels also cast into and take the sun's
 * shadow map (the soft contact quads stay underneath), and `setEnvMap` lets a
 * reflection probe feed the paint, glass and close-up detail.
 */
export class StreetCars {
  readonly group = new Group();
  private types: CarType[] = [];
  private lo: Tier[] = [];
  private hi: (Tier | undefined)[] = [];
  private mid: (Tier | undefined)[] = [];
  private counts: number[] = [];
  private cars: Car[] = [];
  private lanes: Lane[] = [];
  private shadows!: InstancedMesh;
  private pools!: InstancedMesh;
  private heads!: Points;
  private tails!: Points;
  private flares!: Points;
  private moving = 0;
  private last = -1;
  private disposables: { dispose(): void }[] = [];
  private ready = false;
  /** uniform scale of the whole fleet (1 in the neighbourhood) */
  private k = 1;
  /** what reflects the surroundings (both paints, the glass, the close-up detail); filled once loaded */
  private reflective: MeshStandardMaterial[] = [];
  /** an environment map handed over before the models had loaded (see `setEnvMap`) */
  private envMap: Texture | null | undefined;

  // the camera, seen by the last frame that drew these cars (see `init`)
  private eye = new Vector3();
  private seen = false;
  private inv = new Matrix4();

  // scratch
  private m4 = new Matrix4();
  private q = new Quaternion();
  private qw = new Quaternion();
  private qSpin = new Quaternion();
  private qFlip = new Quaternion();
  private p = new Vector3();
  private o = new Vector3();
  private sc = new Vector3();
  private Y = new Vector3(0, 1, 0);
  private Z = new Vector3(0, 0, 1);

  constructor(
    private quality: Quality,
    /** parked-car spots: x, z, heading in radians */
    private parked: { x: number; z: number; yaw: number }[],
    /** lanes of its own (the night city's canyon); absent means the neighbourhood's streets */
    private options?: CarOptions,
  ) {
    this.qFlip.setFromAxisAngle(this.Y, Math.PI);
    this.k = options?.scale ?? 1;
    void this.init();
  }

  private async init(): Promise<void> {
    const high = this.quality.tier === 'high';
    const manifest = (await fetch(asset('/models/cars/manifest.json'), { cache: 'no-cache' }).then((r) =>
      r.json(),
    )) as { types: CarType[] };
    this.types = manifest.types;
    const rand = mulberry32(88211);
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    // the paint is a physical material (clearcoat) on HIGH, the same for both tiers but for the hero's baked
    // maps, so the swap does not change its look; the exotics' is glossier (a deeper, sharper clearcoat).
    // The lean bodies carry their occlusion and grime as vertex colours. Each type is one draw either way.
    const paintMat = high
      ? new MeshPhysicalMaterial({
        color: '#ffffff', metalness: 0.12, roughness: 0.42, clearcoat: 0.9, clearcoatRoughness: 0.12, vertexColors: true,
      })
      : new MeshStandardMaterial({ color: '#ffffff', metalness: 0.55, roughness: 0.33, vertexColors: true });
    const exoticPaintMat = high
      ? new MeshPhysicalMaterial({
        color: '#ffffff', metalness: 0.45, roughness: 0.24, clearcoat: 1, clearcoatRoughness: 0.03, vertexColors: true,
      })
      : new MeshStandardMaterial({ color: '#ffffff', metalness: 0.5, roughness: 0.24, vertexColors: true });
    const detailMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.15 });
    const hiDetailMat = classMaterial();
    // tinted glass: what it lets through is dimmed by its opacity, what it reflects is added on top
    const glassMat = new MeshPhysicalMaterial({
      color: '#06090d', roughness: 0.04, metalness: 0, ior: 1.9, envMapIntensity: 1.6, transparent: true,
      opacity: 0.5, depthWrite: false, blending: CustomBlending, blendSrc: OneFactor, blendDst: OneMinusSrcAlphaFactor,
    });
    this.disposables.push(paintMat, exoticPaintMat, detailMat, hiDetailMat, glassMat);
    this.reflective = [paintMat, exoticPaintMat, glassMat, hiDetailMat];
    if (this.envMap !== undefined) this.setEnvMap(this.envMap);

    // lanes: both directions of every street in the district
    const { d, lotD, street } = HOME_CELL;
    const perLane = high ? 6 : 3;
    // Vehicle types by weight, except that the exotics' share of the weights is dealt out
    // evenly (a running tally hands one out each time it passes a whole car) instead of
    // drawn: a plain draw leaves whole streets without one and bunches them on others.
    const dealer = (weights: Record<string, number>): (() => number) => {
      const w = this.types.map((t) => weights[t.id] ?? 1);
      const ex = this.types.map((t) => !!t.exotic);
      const total = (exotic: boolean): number => w.reduce((a, v, i) => a + (ex[i] === exotic ? v : 0), 0);
      const share = total(true) / Math.max(total(true) + total(false), 1e-6);
      let tally = rand();
      return () => {
        tally += share;
        const exotic = tally >= 1;
        if (exotic) tally -= 1;
        let r = rand() * total(exotic);
        let last = 0;
        for (let i = 0; i < w.length; i++) {
          if (ex[i] !== exotic || !w[i]) continue;
          last = i;
          r -= w[i]!;
          if (r < 0) return i;
        }
        return last;
      };
    };
    const paintFor = (type: number): Color => {
      const t = this.types[type]!;
      if (t.id === 'taxi') return new Color(TAXI_PAINT);
      const palette = t.exotic ? EXOTIC_PAINTS : PAINTS;
      return new Color(palette[Math.floor(rand() * palette.length)]!);
    };
    const traffic = dealer(TRAFFIC);
    const parking = dealer(PARKED);
    const car = (type: number, x: number, z: number, yaw: number): Car => ({
      idx: this.cars.length, type, tint: paintFor(type), x, z, yaw, scale: 1, odo: rand() * 40, brake: 0, near: 0,
    });
    const k0 = this.k;
    const addLane = (
      z: number, dir: 1 | -1, x0: number, x1: number, count: number,
      stops: number[] = [], phase: Lane['phase'] = null,
    ): void => {
      const lane: Lane = { z, dir, x0, x1, drivers: [], stops: [...stops].sort((a, b) => a - b), phase };
      const length = x1 - x0;
      for (let k = 0; k < count; k++) {
        const s = ((k + rand() * 0.6) / count) * length;
        const type = traffic();
        const driver: Driver = {
          ...car(type, 0, lane.z, dir > 0 ? 0 : Math.PI), s,
          v: (2.1 + rand() * 0.8) * k0, vMax: (2.1 + rand() * 0.8) * k0,
        };
        this.cars.push(driver);
        lane.drivers.push(driver);
      }
      this.lanes.push(lane);
    };
    if (this.options) {
      for (const l of this.options.lanes) addLane(l.z, l.dir, l.x0, l.x1, l.count, l.stops, l.phase ?? null);
    } else {
      for (let iz = HOME_CELLS.z[0]; iz < HOME_CELLS.z[1]; iz++) {
        const zc = iz * d + lotD + street / 2;
        for (const dir of [1, -1] as const) addLane(zc + dir * LANE_OFFSET, dir, X0, X1, perLane);
      }
    }
    this.moving = this.cars.length;
    for (const spot of this.parked) this.cars.push(car(parking(), spot.x, spot.z, spot.yaw));
    this.counts = this.types.map(() => 0);
    for (const c of this.cars) this.counts[c.type]!++;

    // the GLBs are quantized and meshopt-packed (scripts/compress-models.mjs): float copies with each node's
    // dequantizing transform baked in
    const geometries = (file: string): Promise<Record<string, BufferGeometry>> => new Promise((res, rej) => {
      loader.load(asset(`/models/cars/${file}`), (g) => {
        const out: Record<string, BufferGeometry> = {};
        g.scene.updateMatrixWorld(true);
        g.scene.traverse((o) => {
          const mesh = o as Mesh;
          if (!mesh.isMesh) return;
          for (const part of ['paint', 'detail', 'glass', 'wheel']) {
            if (mesh.name.startsWith(part)) out[part] = dequantized(mesh.geometry).applyMatrix4(mesh.matrixWorld);
          }
          mesh.geometry.dispose();
        });
        res(out);
      }, undefined, rej);
    });
    const textures = new TextureLoader();
    const map = (file: string): Promise<Texture> => textures.loadAsync(asset(`/models/cars/${file}`)).then((t) => {
      t.flipY = false;               // glTF's UV convention
      t.anisotropy = 4;
      this.disposables.push(t);
      return t;
    });
    const loaded = await Promise.all(this.types.map(async (t) => {
      const hero = high && t.hi;
      const [lo, hi, mid, maps] = await Promise.all([
        geometries(t.file),
        hero ? geometries(t.hi!) : undefined,
        hero && t.mid ? geometries(t.mid) : undefined,
        hero && t.maps ? Promise.all([map(t.maps.paint), map(t.maps.normal)]) : undefined,
      ]);
      return { lo, hi, mid, maps };
    }));

    // On HIGH the cars cast into the sun's shadow map and take its shadows (their own and the
    // houses' and trees'), on top of the soft contact quads, and cast into the streetlights'
    // spots too (LAMP_CASTER_LAYER); the glass neither casts (light falls through the windows
    // into the cabin) nor receives.
    const instance = (geo: BufferGeometry, mat: Material, cap: number, shadows = true): InstancedMesh => {
      const inst = new InstancedMesh(geo, mat, Math.max(cap, 1));
      inst.instanceMatrix.setUsage(DynamicDrawUsage);
      inst.frustumCulled = false;
      inst.castShadow = inst.receiveShadow = high && shadows;
      if (high && shadows) inst.layers.enable(LAMP_CASTER_LAYER);
      inst.count = 0;
      inst.visible = false;
      this.group.add(inst);
      this.disposables.push(inst, geo);
      return inst;
    };
    const tier = (
      id: string, parts: Record<string, BufferGeometry>, paintM: Material, detail: Material, cap: number,
      close: false | 'mid' | 'hero',
    ): Tier => {
      const paint = instance(parts.paint!, paintM, cap);
      const det = instance(parts.detail!, detail, cap);
      const band = typeof close === 'string' ? close : 'lean';
      paint.name = `car-${id}-${band}-paint`;
      det.name = `car-${id}-${band}-detail`;
      det.instanceMatrix = paint.instanceMatrix;       // one pose, drawn by every mesh of the set
      const t: Tier = { paint, detail: det, count: 0 };
      if (close) {
        const glass = instance(parts.glass!, glassMat, cap, false);
        glass.instanceMatrix = paint.instanceMatrix;
        glass.renderOrder = 1;
        const wheels = instance(parts.wheel!, hiDetailMat, cap * 4);
        const brake = new InstancedBufferAttribute(new Float32Array(Math.max(cap, 1)), 1);
        brake.setUsage(DynamicDrawUsage);
        det.geometry.setAttribute('aBrake', brake);
        glass.name = `car-${id}-${band}-glass`;
        wheels.name = `car-${id}-${band}-wheels`;
        Object.assign(t, { glass, wheels, brake });
      }
      return t;
    };
    loaded.forEach((l, ti) => {
      const cap = this.counts[ti]!;
      const base = this.types[ti]!.exotic ? exoticPaintMat : paintMat;
      const id = this.types[ti]!.id;
      this.lo[ti] = tier(id, l.lo, base, detailMat, cap, false);
      if (l.hi) {
        // the hero paint: that type's baked maps on the shared paint (a vertex-coloured lean paint without them)
        let hero: Material = base;
        if (l.maps && (base as MeshPhysicalMaterial).isMeshPhysicalMaterial) {
          const m = heroPaint(base as MeshPhysicalMaterial, l.maps[0], l.maps[1]);
          m.vertexColors = false;
          this.disposables.push(m);
          this.reflective.push(m);
          hero = m;
        }
        this.hi[ti] = tier(id, l.hi, hero, hiDetailMat, cap, 'hero');
      }
      if (l.mid) this.mid[ti] = tier(id, l.mid, base, hiDetailMat, cap, 'mid');
    });
    if (this.envMap !== undefined) this.setEnvMap(this.envMap);

    // contact shadows and headlight pools under moving cars; lights above them
    const flat = new PlaneGeometry(1, 1);
    flat.rotateX(-Math.PI / 2);
    this.disposables.push(flat);
    const shadowMap = softShadowTexture();
    const shadowMat = new MeshBasicMaterial({
      map: shadowMap, color: '#000000', transparent: true, opacity: 0.5, depthWrite: false,
    });
    this.shadows = new InstancedMesh(flat, shadowMat, this.cars.length);
    this.shadows.instanceMatrix.setUsage(DynamicDrawUsage);
    this.shadows.frustumCulled = false;
    this.shadows.renderOrder = -1;
    // the camera for the distance swap: whatever main camera last drew this mesh (never the shadow-map pass,
    // which this mesh does not cast into)
    this.shadows.onBeforeRender = (_r, _s, camera) => {
      if ((camera as PerspectiveCamera).isPerspectiveCamera) {
        this.eye.setFromMatrixPosition(camera.matrixWorld);
        this.seen = true;
      }
    };
    this.group.add(this.shadows);
    const glow = glowTexture();
    const poolMat = new MeshBasicMaterial({
      map: glow, color: '#ffe2b0', transparent: true, opacity: 0.32, depthWrite: false,
      blending: AdditiveBlending,
    });
    this.pools = new InstancedMesh(flat, poolMat, this.moving);
    this.pools.instanceMatrix.setUsage(DynamicDrawUsage);
    this.pools.frustumCulled = false;
    this.pools.renderOrder = -1;
    this.group.add(this.pools);
    this.disposables.push(shadowMap, shadowMat, poolMat, glow, this.shadows, this.pools);

    const glowGeometry = (n: number): BufferGeometry => {
      const g = new BufferGeometry();
      const a = new Float32BufferAttribute(new Float32Array(n * 3), 3);
      a.setUsage(DynamicDrawUsage);
      g.setAttribute('position', a);
      // brightness per lamp: additive blending makes colour the amount of light
      const c = new Float32BufferAttribute(new Float32Array(n * 3).fill(1), 3);
      c.setUsage(DynamicDrawUsage);
      g.setAttribute('color', c);
      return g;
    };
    const lampMaterial = (color: string, size: number): PointsMaterial => new PointsMaterial({
      map: glow, color, size, transparent: true, opacity: 0.95, depthWrite: false,
      blending: AdditiveBlending, sizeAttenuation: true, vertexColors: true,
    });
    this.heads = new Points(glowGeometry(this.moving * 2), lampMaterial('#ffe9bd', 0.42));
    this.tails = new Points(glowGeometry(this.moving * 2), lampMaterial('#ff3a26', 0.32));
    // the wider flare around a lit brake lamp
    this.flares = new Points(glowGeometry(this.moving * 2), lampMaterial('#ff2616', 0.55));
    for (const p of [this.heads, this.tails, this.flares]) {
      p.frustumCulled = false;
      this.group.add(p);
      this.disposables.push(p.geometry, p.material as PointsMaterial);
    }
    this.ready = true;
    this.update(0, true);
  }

  update(time: number, force = false): void {
    if (!this.ready) return;
    if (!this.group.visible && !force) {
      this.last = -1;
      return;
    }
    const dt = this.last < 0 ? 0.016 : MathUtils.clamp(time - this.last, 0, 0.1);
    this.last = time;
    const k = this.k;

    for (const lane of this.lanes) {
      const length = lane.x1 - lane.x0;
      const ds = lane.drivers;
      // order along the lane, so each car knows who is directly ahead
      ds.sort((a, b) => a.s - b.s);
      for (let i = 0; i < ds.length; i++) {
        const car = ds[i]!;
        const ahead = ds[(i + 1) % ds.length]!;
        const len = this.types[car.type]!.length * k;
        let gap = ahead.s - car.s - (this.types[ahead.type]!.length * k + len) / 2;
        if (ds.length > 1 && i === ds.length - 1) gap += length;
        // roll to a stop short of the car in front, ease back to cruising speed
        let want = car.vMax * MathUtils.clamp((gap - 0.35 * k) / (1.4 * k), 0, 1);
        // the signal: a red (or an amber it can still stop for) holds the car short of the next stop line it
        // has not yet passed; past the line it clears the junction whatever the light does
        if (lane.phase && lane.stops.length) {
          const light = lane.phase(time);
          if (light !== 0) {
            const front = car.s + len / 2;
            for (const stop of lane.stops) {
              if (stop < front - 0.2 * k) continue;
              const room = stop - front - 0.25 * k;
              if (light === 1 && room < (car.v * car.v) / 5) break;
              want = Math.min(want, car.vMax * MathUtils.clamp(room / (1.4 * k), 0, 1));
              break;
            }
          }
        }
        // the brake lamps light while the car is shedding speed, and while it waits
        const braking = want < car.v - 0.12 || car.v < 0.2;
        car.brake += ((braking ? 1 : 0) - car.brake) * Math.min(1, dt * (braking ? 14 : 6));
        car.v += (want - car.v) * Math.min(1, dt * 3);
        car.s += car.v * dt;
        car.odo += car.v * dt;
        if (car.s >= length) car.s -= length;

        car.x = lane.dir > 0 ? lane.x0 + car.s : lane.x1 - car.s;
        const fade = MathUtils.smoothstep(car.s, 0, FADE) * (1 - MathUtils.smoothstep(car.s, length - FADE, length));
        car.scale = Math.max(fade, 0.001) * k;
      }
    }
    this.draw(force);
  }

  /** Sorts the cars into the lean and close-up sets by distance to the camera and writes every instance. */
  private draw(force: boolean): void {
    const hiOn = this.seen && this.hi.some(Boolean);
    if (hiOn) {
      this.group.updateWorldMatrix(true, false);
      this.inv.copy(this.group.matrixWorld).invert();
      this.o.copy(this.eye).applyMatrix4(this.inv);
    }
    for (const t of this.lo) t.count = 0;
    for (const t of this.hi) if (t) t.count = 0;
    for (const t of this.mid) if (t) t.count = 0;

    const headAttr = this.heads.geometry.attributes.position!;
    const tailAttr = this.tails.geometry.attributes.position!;
    const flareAttr = this.flares.geometry.attributes.position!;
    const tailCol = this.tails.geometry.attributes.color!;
    const flareCol = this.flares.geometry.attributes.color!;

    for (const car of this.cars) {
      const type = this.types[car.type]!;
      const { x, z, yaw, scale } = car;

      let tier = this.lo[car.type]!;
      const close = hiOn ? this.hi[car.type] : undefined;
      if (close) {
        const mid = this.mid[car.type];
        const dx = x - this.o.x;
        const dy = 0.2 - this.o.y;
        const dz = z - this.o.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        const r = car.near ? HI_OUT : HI_IN;
        const rh = car.near === 2 ? HERO_OUT : HERO_IN;
        car.near = d2 < rh * rh || (!mid && d2 < r * r) ? 2 : d2 < r * r ? 1 : 0;
        if (car.near === 2) tier = close;
        else if (car.near === 1) tier = mid!;
      } else car.near = 0;

      const k = tier.count++;
      this.q.setFromAxisAngle(this.Y, yaw);
      this.m4.compose(this.p.set(x, 0, z), this.q, this.sc.set(scale, scale, scale));
      tier.paint.setMatrixAt(k, this.m4);
      tier.paint.setColorAt(k, car.tint);
      if (car.near) {
        tier.brake!.setX(k, car.brake);
        this.writeWheels(tier, type, k, car);
      }

      if (car.idx < this.moving) {
        const fwd = Math.cos(yaw) > 0 ? 1 : -1;
        // lamps: both sides of the nose and the tail, scaled with the fade
        for (const side of [1, -1]) {
          const n = car.idx * 2 + (side > 0 ? 0 : 1);
          headAttr.setXYZ(n, x + fwd * type.lamp.head[0]! * scale, type.lamp.head[2]! * scale,
            z + side * type.lamp.head[1]! * scale * fwd);
          const tx = x + fwd * type.lamp.tail[0]! * scale;
          const ty = type.lamp.tail[2]! * scale;
          const tz = z + side * type.lamp.tail[1]! * scale * fwd;
          tailAttr.setXYZ(n, tx, ty, tz);
          flareAttr.setXYZ(n, tx + fwd * -0.02, ty, tz);
          const lit = 0.55 + 0.45 * car.brake;
          tailCol.setXYZ(n, lit, lit, lit);
          const flare = car.brake * car.brake * 0.9;
          flareCol.setXYZ(n, flare, flare, flare);
        }
        // headlight pool ahead of the car
        this.pools.setMatrixAt(
          car.idx, this.m4.compose(this.p.set(x + fwd * (type.length / 2 + 1.1) * scale, 0.035, z), this.q,
            this.sc.set(2.6 * scale, 1, 1.5 * scale)),
        );
      }
      // contact shadow
      if (car.idx < this.moving || force) {
        this.q.setFromAxisAngle(this.Y, yaw);
        this.shadows.setMatrixAt(
          car.idx,
          this.m4.compose(this.p.set(x, 0.03, z), this.q, this.sc.set(type.length * 1.25 * scale, 1, type.width * 1.5 * scale)),
        );
      }
    }

    const flush = (t: Tier): void => {
      for (const m of [t.paint, t.detail, t.glass]) {
        if (!m) continue;
        m.count = t.count;
        m.visible = t.count > 0;
      }
      if (t.wheels) {
        t.wheels.count = t.count * 4;
        t.wheels.visible = t.count > 0;
        t.wheels.instanceMatrix.needsUpdate = true;
      }
      t.paint.instanceMatrix.needsUpdate = true;
      if (t.paint.instanceColor) t.paint.instanceColor.needsUpdate = true;
      if (t.brake) t.brake.needsUpdate = true;
    };
    for (const t of this.lo) flush(t);
    for (const t of this.hi) if (t) flush(t);
    for (const t of this.mid) if (t) flush(t);
    headAttr.needsUpdate = true;
    tailAttr.needsUpdate = true;
    flareAttr.needsUpdate = true;
    tailCol.needsUpdate = true;
    flareCol.needsUpdate = true;
    this.shadows.instanceMatrix.needsUpdate = true;
    this.pools.instanceMatrix.needsUpdate = true;
  }

  /**
   * The four wheels of a close-up car: each is the one wheel mesh turned about its axle by
   * the distance rolled (the wheel is built for the left side; the right side's copies
   * are turned half way round to show their outer face, which also reverses their spin).
   */
  private writeWheels(tier: Tier, type: CarType, k: number, car: Car): void {
    const offsets = type.wheelOffsets!;
    const spin = (car.odo / (type.wheelRadius! * this.k)) % (Math.PI * 2);
    for (let w = 0; w < 4; w++) {
      const off = offsets[w]!;
      const right = off[2]! > 0;
      this.qw.setFromAxisAngle(this.Y, car.yaw);
      this.p.set(off[0]!, off[1]!, off[2]!).multiplyScalar(car.scale).applyQuaternion(this.qw);
      this.p.x += car.x;
      this.p.z += car.z;
      if (right) this.qw.multiply(this.qFlip);
      this.qw.multiply(this.qSpin.setFromAxisAngle(this.Z, right ? spin : -spin));
      tier.wheels!.setMatrixAt(k * 4 + w, this.m4.compose(this.p, this.qw, this.sc.set(car.scale, car.scale, car.scale)));
    }
  }

  /**
   * The materials that reflect the surroundings: the family and exotic paints (and each type's
   * hero paint), the glass and the close-up detail (chrome, alloy, lamp lenses). Empty until the
   * models have loaded.
   */
  materials(): MeshStandardMaterial[] {
    return this.reflective;
  }

  /**
   * Hands every reflective material a new environment map (e.g. a live probe of the street);
   * one handed over before the models load is applied when they do. The programs are only
   * rebuilt when the map comes or goes or changes kind, so a probe may call this every frame.
   */
  setEnvMap(map: Texture | null): void {
    this.envMap = map;
    for (const m of this.reflective) {
      const prev = m.envMap;
      if (prev === map) continue;
      m.envMap = map;
      if (!prev || !map || prev.mapping !== map.mapping || prev.isRenderTargetTexture !== map.isRenderTargetTexture) {
        m.needsUpdate = true;
      }
    }
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
