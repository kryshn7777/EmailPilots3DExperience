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
  Vector3,
} from 'three';
import type { Material, WebGLProgramParametersWithUniforms } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { HOME_CELL, HOME_CELLS } from '../bake/cityGen.mjs';
import { glowTexture, softShadowTexture } from '../bake/CanvasTextures';
import { asset } from '../asset';
import { mulberry32 } from '../util';
import type { Quality } from '../quality';

interface CarType {
  id: string;
  /** the lean model: used far away and on the LOW tier */
  file: string;
  /** the close-up model (paint, detail, glass and one wheel), HIGH tier only */
  hi?: string;
  length: number;
  width: number;
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
  /** drawn as the close-up model (kept so the swap has hysteresis) */
  near: boolean;
}

interface Driver extends Car {
  s: number;
  v: number;
  vMax: number;
}

interface Lane {
  z: number;
  dir: 1 | -1;
  drivers: Driver[];
}

/** One set of instanced meshes for a vehicle type: the lean tier, or the close-up one. */
interface Tier {
  paint: InstancedMesh;
  detail: InstancedMesh;
  glass?: InstancedMesh;
  wheels?: InstancedMesh;
  /** per-instance brake level, read by the tail-lamp lenses */
  brake?: InstancedBufferAttribute;
  count: number;
}

const PAINTS = [
  '#d8d8d4', '#cfd2d6', '#a9afb7', '#6f757e', '#1a1c21', '#23262d', '#8a1f26', '#a8281f',
  '#24467a', '#2f5d92', '#3c5b46', '#d3b13f', '#6c4b33', '#e9e4d6',
];
const TAXI_PAINT = '#e6b422';
/** how common each vehicle type is on the street; the rest default to 1 */
const TRAFFIC: Record<string, number> = { sedan: 3, hatch: 2.5, suv: 3, pickup: 1.6, van: 0.8, taxi: 0.35 };
const PARKED: Record<string, number> = { sedan: 3, hatch: 2.5, suv: 3, pickup: 2, van: 0.8, taxi: 0 };

/** the lane runs from `X0` to `X1`, a fixed stretch of the street well past anything in frame */
const X0 = -12;
const X1 = 150;
const LANE_OFFSET = 0.55; // from the street's centre line; matches the tyre-polished lines in make_ground.py
const FADE = 7;           // units over which a car grows in and out at a lane's ends
/** a car is drawn as the close-up model inside HI_IN of the camera and goes back to the lean one past HI_OUT */
const HI_IN = 28;
const HI_OUT = 33;

/**
 * Material class of each `detail` vertex, packed in the alpha of its colour by
 * blender/bld/cars.py: 0 plastic, 1 chrome, 2 rubber, 3 alloy, 4 fabric, 5 head lamp,
 * 6 tail lamp, 7 plate, 8 brake disc, 9 indicator, 10 gloss black, 11 liner.
 */
const CLASS_TABLE = `
const float KR[16] = float[16](0.55, 0.10, 0.90, 0.30, 0.95, 0.12, 0.20, 0.50, 0.40, 0.20, 0.08, 0.90, 0.55, 0.55, 0.55, 0.55);
const float KM[16] = float[16](0.0, 1.0, 0.0, 0.9, 0.0, 0.0, 0.0, 0.0, 0.9, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
const float KE[16] = float[16](0.0, 0.0, 0.0, 0.0, 0.0, 1.6, 0.35, 0.0, 0.0, 1.2, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
`;

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
 * bodies are instanced (six vehicle types, paint tinted per instance).
 *
 * Each type exists twice. The lean model (~1.4k triangles) is what everything
 * more than HI_IN units from the camera is drawn with, and all there is on the LOW
 * tier. The close-up model (HIGH only: a glasshouse with its interior, lamps, plates,
 * mirrors, ~5 to 8k triangles) has its four wheels as one more instanced mesh, which
 * is what lets them turn with the distance rolled. Every frame the cars are
 * partitioned between the two sets by distance to the camera, so the cost follows
 * the handful of cars the camera is actually near. Headlights and tail lights are
 * glow sprites (tail lights flare while a car brakes), and the headlights throw a
 * pool onto the road.
 */
export class StreetCars {
  readonly group = new Group();
  private types: CarType[] = [];
  private lo: Tier[] = [];
  private hi: (Tier | undefined)[] = [];
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
  ) {
    this.qFlip.setFromAxisAngle(this.Y, Math.PI);
    void this.init();
  }

  private async init(): Promise<void> {
    const high = this.quality.tier === 'high';
    const manifest = (await fetch(asset('/models/cars/manifest.json'), { cache: 'no-cache' }).then((r) =>
      r.json(),
    )) as { types: CarType[] };
    this.types = manifest.types;
    const rand = mulberry32(88211);
    const loader = new GLTFLoader();
    // the paint is one physical material (clearcoat) for both tiers on HIGH, so the swap does not change its look
    const paintMat = high
      ? new MeshPhysicalMaterial({
        color: '#ffffff', metalness: 0.5, roughness: 0.35, clearcoat: 0.9, clearcoatRoughness: 0.08,
      })
      : new MeshStandardMaterial({ color: '#ffffff', metalness: 0.55, roughness: 0.33 });
    const detailMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.15 });
    const hiDetailMat = classMaterial();
    // tinted glass: what it lets through is dimmed by its opacity, what it reflects is added on top
    const glassMat = new MeshPhysicalMaterial({
      color: '#06090d', roughness: 0.04, metalness: 0, ior: 1.9, envMapIntensity: 1.6, transparent: true,
      opacity: 0.5, depthWrite: false, blending: CustomBlending, blendSrc: OneFactor, blendDst: OneMinusSrcAlphaFactor,
    });
    this.disposables.push(paintMat, detailMat, hiDetailMat, glassMat);

    // lanes: both directions of every street in the district
    const { d, lotD, street } = HOME_CELL;
    const perLane = high ? 6 : 3;
    const pick = (weights: Record<string, number>): number => {
      const w = this.types.map((t) => weights[t.id] ?? 1);
      let r = rand() * w.reduce((a, b) => a + b, 0);
      for (let i = 0; i < w.length; i++) {
        r -= w[i]!;
        if (r < 0) return i;
      }
      return w.length - 1;
    };
    const paintFor = (type: number): Color => new Color(
      this.types[type]!.id === 'taxi' ? TAXI_PAINT : PAINTS[Math.floor(rand() * PAINTS.length)]!,
    );
    const car = (type: number, x: number, z: number, yaw: number): Car => ({
      idx: this.cars.length, type, tint: paintFor(type), x, z, yaw, scale: 1, odo: rand() * 40, brake: 0, near: false,
    });
    for (let iz = HOME_CELLS.z[0]; iz < HOME_CELLS.z[1]; iz++) {
      const zc = iz * d + lotD + street / 2;
      for (const dir of [1, -1] as const) {
        const lane: Lane = { z: zc + dir * LANE_OFFSET, dir, drivers: [] };
        const length = X1 - X0;
        for (let k = 0; k < perLane; k++) {
          const s = ((k + rand() * 0.6) / perLane) * length;
          const type = pick(TRAFFIC);
          const driver: Driver = {
            ...car(type, 0, lane.z, dir > 0 ? 0 : Math.PI), s,
            v: 2.1 + rand() * 0.8, vMax: 2.1 + rand() * 0.8,
          };
          this.cars.push(driver);
          lane.drivers.push(driver);
        }
        this.lanes.push(lane);
      }
    }
    this.moving = this.cars.length;
    for (const spot of this.parked) this.cars.push(car(pick(PARKED), spot.x, spot.z, spot.yaw));
    this.counts = this.types.map(() => 0);
    for (const c of this.cars) this.counts[c.type]!++;

    const geometries = (file: string): Promise<Record<string, Mesh>> => new Promise((res, rej) => {
      loader.load(asset(`/models/cars/${file}`), (g) => {
        const out: Record<string, Mesh> = {};
        g.scene.traverse((o) => {
          const mesh = o as Mesh;
          if (!mesh.isMesh) return;
          for (const part of ['paint', 'detail', 'glass', 'wheel']) if (mesh.name.startsWith(part)) out[part] = mesh;
        });
        res(out);
      }, undefined, rej);
    });
    const loaded = await Promise.all(this.types.map(async (t) => ({
      lo: await geometries(t.file),
      hi: high && t.hi ? await geometries(t.hi) : undefined,
    })));

    const instance = (geo: BufferGeometry, mat: Material, cap: number): InstancedMesh => {
      const inst = new InstancedMesh(geo, mat, Math.max(cap, 1));
      inst.instanceMatrix.setUsage(DynamicDrawUsage);
      inst.frustumCulled = false;
      inst.count = 0;
      inst.visible = false;
      this.group.add(inst);
      this.disposables.push(inst, geo);
      return inst;
    };
    const tier = (parts: Record<string, Mesh>, detail: Material, cap: number, close: boolean): Tier => {
      const paint = instance(parts.paint!.geometry, paintMat, cap);
      const det = instance(parts.detail!.geometry, detail, cap);
      det.instanceMatrix = paint.instanceMatrix;       // one pose, drawn by every mesh of the set
      const t: Tier = { paint, detail: det, count: 0 };
      if (close) {
        const glass = instance(parts.glass!.geometry, glassMat, cap);
        glass.instanceMatrix = paint.instanceMatrix;
        glass.renderOrder = 1;
        const wheels = instance(parts.wheel!.geometry, hiDetailMat, cap * 4);
        const brake = new InstancedBufferAttribute(new Float32Array(Math.max(cap, 1)), 1);
        brake.setUsage(DynamicDrawUsage);
        det.geometry.setAttribute('aBrake', brake);
        Object.assign(t, { glass, wheels, brake });
      }
      return t;
    };
    loaded.forEach((l, ti) => {
      const cap = this.counts[ti]!;
      this.lo[ti] = tier(l.lo, detailMat, cap, false);
      if (l.hi) this.hi[ti] = tier(l.hi, hiDetailMat, cap, true);
    });

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
    const length = X1 - X0;

    for (const lane of this.lanes) {
      const ds = lane.drivers;
      // order along the lane, so each car knows who is directly ahead
      ds.sort((a, b) => a.s - b.s);
      for (let i = 0; i < ds.length; i++) {
        const car = ds[i]!;
        const ahead = ds[(i + 1) % ds.length]!;
        const len = this.types[car.type]!.length;
        let gap = ahead.s - car.s - (this.types[ahead.type]!.length + len) / 2;
        if (ds.length > 1 && i === ds.length - 1) gap += length;
        // roll to a stop short of the car in front, ease back to cruising speed
        const want = car.vMax * MathUtils.clamp((gap - 0.35) / 1.4, 0, 1);
        // the brake lamps light while the car is shedding speed, and while it waits
        const braking = want < car.v - 0.12 || car.v < 0.2;
        car.brake += ((braking ? 1 : 0) - car.brake) * Math.min(1, dt * (braking ? 14 : 6));
        car.v += (want - car.v) * Math.min(1, dt * 3);
        car.s += car.v * dt;
        car.odo += car.v * dt;
        if (car.s >= length) car.s -= length;

        car.x = lane.dir > 0 ? X0 + car.s : X1 - car.s;
        const fade = MathUtils.smoothstep(car.s, 0, FADE) * (1 - MathUtils.smoothstep(car.s, length - FADE, length));
        car.scale = Math.max(fade, 0.001);
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
        const dx = x - this.o.x;
        const dy = 0.2 - this.o.y;
        const dz = z - this.o.z;
        const r = car.near ? HI_OUT : HI_IN;
        car.near = dx * dx + dy * dy + dz * dz < r * r;
        if (car.near) tier = close;
      } else car.near = false;

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
          car.idx, this.m4.compose(this.p.set(x + fwd * (type.length / 2 + 1.1 * scale), 0.035, z), this.q,
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
    const spin = (car.odo / type.wheelRadius!) % (Math.PI * 2);
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

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
