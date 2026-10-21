import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  MathUtils,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Quaternion,
  Vector3,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { HOME_CELL, HOME_CELLS } from '../bake/cityGen.mjs';
import { glowTexture, softShadowTexture } from '../bake/CanvasTextures';
import { asset } from '../asset';
import { mulberry32 } from '../util';
import type { Quality } from '../quality';

interface CarType {
  id: string;
  file: string;
  length: number;
  width: number;
  lamp: { head: number[]; tail: number[] };
}

/** One car on a lane; its pose is a function of `s`, how far along the lane it is. */
interface Driver {
  type: number;
  slot: number;
  s: number;
  v: number;
  vMax: number;
}

interface Lane {
  z: number;
  dir: 1 | -1;
  drivers: Driver[];
}

const PAINTS = [
  '#d8d8d4', '#cfd2d6', '#a9afb7', '#6f757e', '#1a1c21', '#23262d', '#8a1f26', '#a8281f',
  '#24467a', '#2f5d92', '#3c5b46', '#d3b13f', '#6c4b33', '#e9e4d6',
];

/** the lane runs from `X0` to `X1`, a fixed stretch of the street well past anything in frame */
const X0 = -12;
const X1 = 150;
const LANE_OFFSET = 0.55; // from the street's centre line; matches the tyre-polished lines in make_ground.py
const FADE = 7;           // units over which a car grows in and out at a lane's ends

/**
 * Traffic and parked cars in the neighbourhood. Moving cars follow the street
 * lanes in a ring, slowing for whoever is ahead (so they never drive through each
 * other); parked cars sit in the front yards of the houses the flight passes. The
 * bodies are instanced (four vehicle types, paint tinted per instance); headlights
 * and tail lights are glow sprites, and the headlights throw a pool onto the road.
 */
export class StreetCars {
  readonly group = new Group();
  private types: CarType[] = [];
  private paint: InstancedMesh[] = [];
  private detail: InstancedMesh[] = [];
  private counts: number[] = [];
  private lanes: Lane[] = [];
  private shadows!: InstancedMesh;
  private pools!: InstancedMesh;
  private heads!: Points;
  private tails!: Points;
  private moving = 0;
  private last = -1;
  private disposables: { dispose(): void }[] = [];
  private ready = false;

  // scratch
  private m4 = new Matrix4();
  private q = new Quaternion();
  private p = new Vector3();
  private sc = new Vector3();
  private tint = new Color();
  private Y = new Vector3(0, 1, 0);

  constructor(
    private quality: Quality,
    /** parked-car spots: x, z, heading in radians */
    private parked: { x: number; z: number; yaw: number }[],
  ) {
    void this.init();
  }

  private async init(): Promise<void> {
    const manifest = (await fetch(asset('/models/cars/manifest.json'), { cache: 'no-cache' }).then((r) =>
      r.json(),
    )) as { types: CarType[] };
    this.types = manifest.types;
    const rand = mulberry32(88211);
    const loader = new GLTFLoader();
    const paintMat = new MeshStandardMaterial({ color: '#ffffff', metalness: 0.55, roughness: 0.33 });
    const detailMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.15 });
    this.disposables.push(paintMat, detailMat);

    // lanes: both directions of every street in the district
    const { d, lotD, street } = HOME_CELL;
    const perLane = this.quality.tier === 'high' ? 6 : 3;
    for (let iz = HOME_CELLS.z[0]; iz < HOME_CELLS.z[1]; iz++) {
      const zc = iz * d + lotD + street / 2;
      for (const dir of [1, -1] as const) {
        const lane: Lane = { z: zc + dir * LANE_OFFSET, dir, drivers: [] };
        const length = X1 - X0;
        for (let k = 0; k < perLane; k++) {
          const s = ((k + rand() * 0.6) / perLane) * length;
          lane.drivers.push({
            type: Math.floor(rand() * this.types.length), slot: 0, s,
            v: 2.1 + rand() * 0.8, vMax: 2.1 + rand() * 0.8,
          });
        }
        this.lanes.push(lane);
      }
    }
    this.moving = this.lanes.reduce((n, l) => n + l.drivers.length, 0);

    // how many of each type: moving + parked, assigned round-robin so every type is used
    const parkedType = this.parked.map(() => Math.floor(rand() * this.types.length));
    this.counts = this.types.map(() => 0);
    for (const lane of this.lanes) for (const dr of lane.drivers) dr.slot = this.counts[dr.type]!++;
    const parkedSlot = parkedType.map((t) => this.counts[t]!++);

    const gltfs = await Promise.all(
      this.types.map((t) => new Promise<Group>((res, rej) => {
        loader.load(asset(`/models/cars/${t.file}`), (g) => res(g.scene), undefined, rej);
      })),
    );
    gltfs.forEach((scene, ti) => {
      scene.updateMatrixWorld(true);
      scene.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh) return;
        const isPaint = mesh.name.startsWith('paint');
        const inst = new InstancedMesh(mesh.geometry, isPaint ? paintMat : detailMat, Math.max(this.counts[ti]!, 1));
        inst.instanceMatrix.setUsage(DynamicDrawUsage);
        inst.frustumCulled = false;
        inst.count = this.counts[ti]!;
        if (isPaint) {
          for (let i = 0; i < inst.count; i++) {
            inst.setColorAt(i, this.tint.set(PAINTS[Math.floor(rand() * PAINTS.length)]!));
          }
          if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
          this.paint[ti] = inst;
        } else {
          this.detail[ti] = inst;
        }
        this.group.add(inst);
        this.disposables.push(inst);
      });
    });

    // parked cars are fixed: write them once
    this.parked.forEach((spot, i) => {
      const ti = parkedType[i]!;
      this.place(ti, parkedSlot[i]!, spot.x, spot.z, spot.yaw, 1);
    });

    // contact shadows and headlight pools under moving cars; lights above them
    const flat = new PlaneGeometry(1, 1);
    flat.rotateX(-Math.PI / 2);
    this.disposables.push(flat);
    const total = this.moving + this.parked.length;
    const shadowMap = softShadowTexture();
    const shadowMat = new MeshBasicMaterial({
      map: shadowMap, color: '#000000', transparent: true, opacity: 0.5, depthWrite: false,
    });
    this.shadows = new InstancedMesh(flat, shadowMat, total);
    this.shadows.instanceMatrix.setUsage(DynamicDrawUsage);
    this.shadows.frustumCulled = false;
    this.shadows.renderOrder = -1;
    this.group.add(this.shadows);
    const poolMat = new MeshBasicMaterial({
      map: glowTexture(), color: '#ffe2b0', transparent: true, opacity: 0.32, depthWrite: false,
      blending: AdditiveBlending,
    });
    this.pools = new InstancedMesh(flat, poolMat, this.moving);
    this.pools.instanceMatrix.setUsage(DynamicDrawUsage);
    this.pools.frustumCulled = false;
    this.pools.renderOrder = -1;
    this.group.add(this.pools);
    this.disposables.push(shadowMap, shadowMat, poolMat, this.shadows, this.pools);

    const glowGeometry = (n: number): BufferGeometry => {
      const g = new BufferGeometry();
      const a = new Float32BufferAttribute(new Float32Array(n * 3), 3);
      a.setUsage(DynamicDrawUsage);
      g.setAttribute('position', a);
      return g;
    };
    const lampMaterial = (color: string, size: number): PointsMaterial => new PointsMaterial({
      map: glowTexture(), color, size, transparent: true, opacity: 0.95, depthWrite: false,
      blending: AdditiveBlending, sizeAttenuation: true,
    });
    this.heads = new Points(glowGeometry(this.moving * 2), lampMaterial('#ffe9bd', 0.42));
    this.tails = new Points(glowGeometry(this.moving * 2), lampMaterial('#ff3a26', 0.32));
    for (const p of [this.heads, this.tails]) {
      p.frustumCulled = false;
      this.group.add(p);
      this.disposables.push(p.geometry, p.material as PointsMaterial);
    }
    this.ready = true;
    this.update(0, true);
  }

  /** writes one car's instance matrices (paint and detail share the pose) */
  private place(type: number, slot: number, x: number, z: number, yaw: number, scale: number): void {
    this.q.setFromAxisAngle(this.Y, yaw);
    this.m4.compose(this.p.set(x, 0, z), this.q, this.sc.set(scale, scale, scale));
    this.paint[type]?.setMatrixAt(slot, this.m4);
    this.detail[type]?.setMatrixAt(slot, this.m4);
    if (this.paint[type]) this.paint[type]!.instanceMatrix.needsUpdate = true;
    if (this.detail[type]) this.detail[type]!.instanceMatrix.needsUpdate = true;
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
    const headAttr = this.heads.geometry.attributes.position!;
    const tailAttr = this.tails.geometry.attributes.position!;
    let n = 0;

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
        car.v += (want - car.v) * Math.min(1, dt * 3);
        car.s += car.v * dt;
        if (car.s >= length) car.s -= length;

        const x = lane.dir > 0 ? X0 + car.s : X1 - car.s;
        const yaw = lane.dir > 0 ? 0 : Math.PI;
        const fade = MathUtils.smoothstep(car.s, 0, FADE) * (1 - MathUtils.smoothstep(car.s, length - FADE, length));
        const scale = Math.max(fade, 0.001);
        this.place(car.type, car.slot, x, lane.z, yaw, scale);

        const type = this.types[car.type]!;
        const fwd = lane.dir;
        // lamps: both sides of the nose and the tail, scaled with the fade
        for (const side of [1, -1]) {
          const hx = x + fwd * type.lamp.head[0]! * scale;
          const hz = lane.z + side * type.lamp.head[1]! * scale * fwd;
          headAttr.setXYZ(n, hx, type.lamp.head[2]! * scale, hz);
          const tx = x + fwd * type.lamp.tail[0]! * scale;
          const tz = lane.z + side * type.lamp.tail[1]! * scale * fwd;
          tailAttr.setXYZ(n, tx, type.lamp.tail[2]! * scale, tz);
          n++;
        }
        const k = n / 2 - 1;
        // shadow under the car, headlight pool ahead of it
        this.q.setFromAxisAngle(this.Y, yaw);
        this.shadows.setMatrixAt(
          k, this.m4.compose(this.p.set(x, 0.03, lane.z), this.q, this.sc.set(type.length * 1.25 * scale, 1, type.width * 1.5 * scale)),
        );
        this.pools.setMatrixAt(
          k, this.m4.compose(this.p.set(x + fwd * (type.length / 2 + 1.1 * scale), 0.035, lane.z), this.q,
            this.sc.set(2.6 * scale, 1, 1.5 * scale)),
        );
      }
    }
    headAttr.needsUpdate = true;
    tailAttr.needsUpdate = true;
    this.shadows.instanceMatrix.needsUpdate = true;
    this.pools.instanceMatrix.needsUpdate = true;
    // parked cars' shadows sit after the moving ones; written once
    if (force) {
      this.parked.forEach((spot, i) => {
        const type = this.types[0]!;
        this.q.setFromAxisAngle(this.Y, spot.yaw);
        this.shadows.setMatrixAt(
          this.moving + i,
          this.m4.compose(this.p.set(spot.x, 0.03, spot.z), this.q, this.sc.set(type.length * 1.25, 1, type.width * 1.5)),
        );
      });
    }
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
