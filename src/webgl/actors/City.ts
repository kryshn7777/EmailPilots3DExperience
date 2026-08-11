import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
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
  ShaderMaterial,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  CITY_EXTENT,
  CROSS_STREET_X,
  cityLayout,
  cityRecipes,
  type Building,
} from '../bake/cityGen.mjs';
import { neonSignTexture, roadTexture } from '../bake/CanvasTextures';
import { glowTexture } from '../bake/CanvasTextures';
import { KitCity, type KitLot, type KitRingSet } from './KitCity';
import { PaperPlane } from './PaperPlane';
import { asset } from '../asset';
import { mulberry32 } from '../util';
import type { FlightPath } from '../rig/FlightPath';
import type { Quality } from '../quality';
import carVert from '../shaders/carLights.vert.glsl';
import carFrag from '../shaders/carLights.frag.glsl';
import carGlowVert from '../shaders/carGlow.vert.glsl';

const WINDOW_AMBER = new Color('#ffc96b');
const DELIVERIES = 5;

interface Delivery {
  tStart: number;
  tEnd: number;
  from: Vector3;
  to: Vector3;
  windowIndex: number;
}

/**
 * CH8: the city of inboxes. Massing comes from the baked GLB (vertex-AO);
 * windows are instanced amber quads sharing the same deterministic layout.
 * Five escort envelopes peel off on scroll and light their target windows —
 * deliveries, visualized, fully scrub-reversible.
 */
export class City {
  readonly group = new Group();
  private windows!: InstancedMesh;
  private windowBase: number[] = [];
  private deliveries: Delivery[] = [];
  private envelopeMeshes: Mesh[] = [];
  private planeLandings: {
    tStart: number; tEnd: number;
    from: Vector3; ctrl: Vector3; to: Vector3;
    windowIndex: number; plane: PaperPlane; wobble: number;
  }[] = [];
  private landingPos = new Vector3();
  private landingAhead = new Vector3();
  private kitCity: KitCity | null = null;
  private color = new Color();
  private disposables: { dispose(): void }[] = [];

  constructor(anchor: Vector3, path: FlightPath, quality: Quality) {
    this.group.position.set(anchor.x, 0, 1);

    // ground sheet under the buildings
    const groundMaterial = new MeshStandardMaterial({ color: '#0a0d16', roughness: 0.95 });
    // 260x200, not 140x100: the district is 97 x 39 now and the old sheet's
    // edge cut across the frame in the upper corners of the dive
    const ground = new Mesh(new PlaneGeometry(260, 200), groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    this.group.add(ground);
    this.disposables.push(ground.geometry, groundMaterial);

    this.buildTraffic();
    void this.init(path, quality);
  }

  /**
   * Buildings are kit-instanced with ring-baked LODs (see KitCity). Dressing
   * follows the rings: windows spawn on NEAR+MID lots, clutter/parapets/
   * billboards on NEAR only — FAR carries its windows in the impostor texture.
   */
  private async init(path: FlightPath, quality: Quality): Promise<void> {
    // no-cache: lots and rings MUST come from the same bake — a stale cached
    // rings file indexes past the end of a freshly generated lot list
    const [manifest, allRings] = await Promise.all([
      fetch(asset('/models/city-kit/manifest.json'), { cache: 'no-cache' }).then((r) => r.json()),
      fetch(asset('/models/city-rings.json'), { cache: 'no-cache' }).then((r) => r.json()),
    ]);
    const rings = allRings.city[quality.tier] as KitRingSet;
    const { lots } = cityRecipes(manifest.modules);
    this.kitCity = new KitCity(lots as KitLot[], rings, manifest.modules, quality.tier);
    this.group.add(this.kitCity.group);

    // effective wall half-extents per lot: kit modules are uniform-fit
    // INSIDE the lot box, so dressing placed on the old box faces would
    // hover in air beside the real walls (yaw 90/270 swaps the axes)
    const extents = new Map<number, { hx: number; hz: number }>();
    (lots as KitLot[]).forEach((lot, i) => {
      const mod = manifest.modules.find((m: { id: string }) => m.id === lot.moduleId);
      if (!mod) return;
      const sxz = Math.min(lot.w / mod.footprint[0], lot.d / mod.footprint[1]);
      const hx = (sxz * mod.footprint[0]) / 2;
      const hz = (sxz * mod.footprint[1]) / 2;
      const quarter = Math.round(lot.yaw / (Math.PI / 2)) % 2 !== 0;
      extents.set(i, quarter ? { hx: hz, hz: hx } : { hx, hz });
    });

    const buildings = cityLayout(0);
    const nearSet = new Set(rings.near);
    const nearMid = new Set([...rings.near, ...rings.mid]);
    const keep = (set: Set<number>): [Building, { hx: number; hz: number }][] =>
      buildings
        .map((b, i) => [b, extents.get(i), set.has(i)] as const)
        .filter((row): row is [Building, { hx: number; hz: number }, true] => !!row[1] && row[2])
        .map(([b, e]) => [b, e]);
    this.buildWindows(keep(nearMid));
    this.buildRoofClutter(keep(nearSet));
    this.buildRoofDetail(buildings.filter((_, i) => nearSet.has(i)));
    this.buildStreetDressing(keep(nearSet));
    this.buildDeliveries(buildings, path);
    this.buildPlaneLandings(path);
  }

  private blinkMaterial!: PointsMaterial;

  /**
   * Street level + skyline dressing: lamp posts lining the canyon with warm
   * glow sprites, neon signs on the canyon-facing walls, and antennas with
   * red aircraft-warning blinkers on the tallest towers. Five draws total.
   */
  private buildStreetDressing(rows: [Building, { hx: number; hz: number }][]): void {
    const rand = mulberry32(880);

    // lamp posts, both canyon curbs
    const poleMaterial = new MeshStandardMaterial({ color: '#232936', roughness: 0.5, metalness: 0.5 });
    const poleGeometry = new CylinderGeometry(0.03, 0.04, 1.5, 6);
    const positions: number[] = [];
    const poles: Matrix4[] = [];
    const q = new Quaternion();
    const s = new Vector3(1, 1, 1);
    const p = new Vector3();
    for (let x = -30; x <= 34; x += 6.4) {
      for (const z of [-2.05, 2.05]) {
        p.set(x + rand() * 0.6, 0.75, z);
        poles.push(new Matrix4().compose(p, q, s));
        positions.push(p.x, 1.55, z);
      }
    }
    const poleMesh = new InstancedMesh(poleGeometry, poleMaterial, poles.length);
    poles.forEach((m, i) => poleMesh.setMatrixAt(i, m));
    this.group.add(poleMesh);
    this.disposables.push(poleGeometry, poleMaterial, poleMesh);

    const lampGeometry = new BufferGeometry();
    lampGeometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    const lampMaterial = new PointsMaterial({
      map: glowTexture(),
      color: '#ffd9a0',
      size: 0.5,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    const lamps = new Points(lampGeometry, lampMaterial);
    lamps.frustumCulled = false;
    this.group.add(lamps);
    this.disposables.push(lampGeometry, lampMaterial);

    // neon signs on walls facing the canyon — on the ACTUAL kit walls
    const NEON = ['#ff5f8f', '#5fd0ff', '#ffd05f', '#8fff9f', '#c88fff'];
    const sign = neonSignTexture();
    const signMaterial = new MeshBasicMaterial({
      map: sign,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    const signGeometry = new PlaneGeometry(1.5, 0.75);
    const candidates = rows.filter(([b]) => Math.abs(b.z) < 5 && b.h > 3);
    const signs = new InstancedMesh(signGeometry, signMaterial, Math.min(10, candidates.length));
    const yaw = new Quaternion();
    const Y = new Vector3(0, 1, 0);
    for (let i = 0; i < signs.count; i++) {
      const [b, e] = candidates[Math.floor(rand() * candidates.length)]!;
      const north = b.z < 0;
      p.set(
        b.x + (rand() - 0.5) * e.hx * 0.5,
        1.6 + rand() * Math.min(b.h - 2, 3.5),
        b.z + (e.hz + 0.06) * (north ? 1 : -1),
      );
      yaw.setFromAxisAngle(Y, north ? 0 : Math.PI);
      signs.setMatrixAt(i, new Matrix4().compose(p, yaw, s));
      signs.setColorAt(i, this.color.set(NEON[i % NEON.length]!));
    }
    if (signs.instanceColor) signs.instanceColor.needsUpdate = true;
    this.group.add(signs);
    this.disposables.push(signGeometry, signMaterial, sign, signs);

    // antennas + red blinkers on the tallest towers
    const tall = rows.map(([b]) => b).sort((a, b) => b.h - a.h).slice(0, 9);
    const antennaGeometry = new CylinderGeometry(0.015, 0.025, 1.6, 5);
    const antennas = new InstancedMesh(antennaGeometry, poleMaterial, tall.length);
    const blinkPos: number[] = [];
    tall.forEach((b, i) => {
      p.set(b.x, b.h + 0.8, b.z);
      antennas.setMatrixAt(i, new Matrix4().compose(p, q, s));
      blinkPos.push(b.x, b.h + 1.62, b.z);
    });
    this.group.add(antennas);
    this.disposables.push(antennaGeometry, antennas);

    const blinkGeometry = new BufferGeometry();
    blinkGeometry.setAttribute('position', new Float32BufferAttribute(blinkPos, 3));
    this.blinkMaterial = new PointsMaterial({
      map: glowTexture(),
      color: '#ff3b30',
      size: 0.45,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    const blinkers = new Points(blinkGeometry, this.blinkMaterial);
    blinkers.frustumCulled = false;
    this.group.add(blinkers);
    this.disposables.push(blinkGeometry, this.blinkMaterial);
  }

  /**
   * AC units + water tanks on the roofs. The city entry looks DOWN at the
   * massing — bare flat roofs read as gray slabs no matter how lit the walls
   * are. Two instanced draws total.
   */
  private buildRoofClutter(rows: [Building, { hx: number; hz: number }][]): void {
    const rand = mulberry32(60309);
    /**
     * Both carry a lift of emissive. This chapter's key light is 0.3 and the
     * hemisphere under it is nearly black, so an unlit #2a3145 box crushed to
     * pure black — 151 of them read as holes punched in the roofline rather
     * than as clutter standing on it. The roof dressing over in KitCity has
     * always had this and never showed the problem.
     */
    const clutterMaterial = new MeshStandardMaterial({
      color: '#2a3145', roughness: 0.8, emissive: '#131a2a', emissiveIntensity: 0.55,
    });
    const tankMaterial = new MeshStandardMaterial({
      color: '#1f2634', roughness: 0.6, metalness: 0.3, emissive: '#121826', emissiveIntensity: 0.5,
    });
    this.disposables.push(clutterMaterial, tankMaterial);

    const boxes: Matrix4[] = [];
    const tanks: Matrix4[] = [];
    const q = new Quaternion();
    const p = new Vector3();
    const s = new Vector3();
    const yaw = new Quaternion();
    const Y = new Vector3(0, 1, 0);
    for (const [b, e] of rows) {
      // clutter only on flat low/mid roofs — kit skyscrapers step back near
      // the top, and boxes placed at the old box height hover in air there
      if (b.h < 3.5 || b.h > 6.5) continue;
      // stay well inside the ACTUAL kit roof (effective extents)
      const rx = Math.max(e.hx * 2 - 0.7, 0.3);
      const rz = Math.max(e.hz * 2 - 0.7, 0.3);
      const units = 1 + Math.floor(rand() * 2);
      for (let i = 0; i < units; i++) {
        const w = 0.5 + rand() * 0.9;
        const h = 0.25 + rand() * 0.45;
        p.set(b.x + (rand() - 0.5) * rx, b.h + h / 2, b.z + (rand() - 0.5) * rz);
        s.set(Math.min(w, rx), h, Math.min(0.4 + rand() * 0.8, rz));
        yaw.setFromAxisAngle(Y, rand() * Math.PI);
        const m = new Matrix4().compose(p, yaw, s);
        boxes.push(m);
      }
      if (b.h > 5 && rand() < 0.45 && Math.min(rx, rz) > 1.2) {
        p.set(b.x + (rand() - 0.5) * (rx - 1), b.h + 0.55, b.z + (rand() - 0.5) * (rz - 1));
        s.set(1, 1.1, 1);
        tanks.push(new Matrix4().compose(p, q, s));
      }
    }
    const unitGeometry = new BoxGeometry(1, 1, 1);
    const units = new InstancedMesh(unitGeometry, clutterMaterial, boxes.length);
    boxes.forEach((m, i) => units.setMatrixAt(i, m));
    const tankGeometry = new CylinderGeometry(0.55, 0.55, 1, 10);
    const tankMesh = new InstancedMesh(tankGeometry, tankMaterial, tanks.length);
    tanks.forEach((m, i) => tankMesh.setMatrixAt(i, m));
    this.group.add(units, tankMesh);
    this.disposables.push(unitGeometry, units, tankGeometry, tankMesh);
  }

  /**
   * Big lit billboards on the tallest towers — kit modules carry their own
   * cornices, so the old parapet lips are gone. One instanced draw.
   */
  private buildRoofDetail(buildings: Building[]): void {
    const rand = mulberry32(3117);

    // rooftop billboards, glowing over the skyline
    const NEON = ['#ff5f8f', '#5fd0ff', '#ffd05f', '#8fff9f'];
    const sign = neonSignTexture();
    const boardMaterial = new MeshBasicMaterial({
      map: sign,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
    });
    const boardGeometry = new PlaneGeometry(2.6, 1.3);
    const tall = [...buildings].sort((a, b) => b.h - a.h).slice(2, 8);
    const boards = new InstancedMesh(boardGeometry, boardMaterial, tall.length);
    const Y = new Vector3(0, 1, 0);
    const yaw = new Quaternion();
    const p = new Vector3();
    const s = new Vector3(1, 1, 1);
    tall.forEach((b, i) => {
      p.set(b.x, b.h + 1.0, b.z);
      yaw.setFromAxisAngle(Y, (rand() - 0.5) * 0.9 + (b.z > 0 ? Math.PI : 0));
      boards.setMatrixAt(i, new Matrix4().compose(p, yaw, s));
      boards.setColorAt(i, this.color.set(NEON[i % NEON.length]!));
    });
    if (boards.instanceColor) boards.instanceColor.needsUpdate = true;
    this.group.add(boards);
    this.disposables.push(boardGeometry, boardMaterial, sign, boards);
  }

  private trafficMaterial: ShaderMaterial | null = null;
  private cars!: InstancedMesh;
  private carLanes: { origin: number; z: number; dir: 1 | -1; phase: number; speed: number }[] = [];
  private carLightGeometry = new BufferGeometry();
  private carMatrix = new Matrix4();
  private carQuatFwd = new Quaternion();
  private carQuatBack = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI);
  private carPos = new Vector3();
  // 1.35: the district grew and the canyon road with it, which left the cars
  // reading as specks against the block faces. Applied as instance scale so
  // the head/taillight sprites, which are placed from the same lane formula,
  // keep sitting on the bodies.
  private carScale = new Vector3(1.35, 1.35, 1.35);

  private static readonly CANYON_LEN = 66;
  private static readonly CANYON_X0 = -32;

  /** Roads in the canyon + cross streets, real cars on the canyon lanes. */
  private buildTraffic(): void {
    const road = roadTexture();
    const roadMat = new MeshStandardMaterial({ map: road, roughness: 0.95 });
    this.disposables.push(roadMat, road);
    // roads span the built grid rather than a hardcoded 66x27: the district is
    // 24x11 blocks now, and the old canyon road stopped dead a third of the way
    // along it with buildings either side of open ground
    const [x0, x1] = CITY_EXTENT.x;
    const [z0, z1] = CITY_EXTENT.z;
    const runX = x1 - x0 + 12; // a little past the last block at each end
    const runZ = z1 - z0 + 10;
    const canyonRoad = new Mesh(new PlaneGeometry(runX, 4.6), roadMat);
    canyonRoad.rotation.x = -Math.PI / 2;
    canyonRoad.position.set((x0 + x1) / 2, 0.005, 0);
    // one dash tile per ~7 units, so the markings keep their spacing as the
    // road grows instead of stretching
    if (canyonRoad.material.map) canyonRoad.material.map.repeat.set(Math.round(runX / 7.3), 1);
    this.group.add(canyonRoad);
    this.disposables.push(canyonRoad.geometry);
    for (const sx of CROSS_STREET_X) {
      // the long axis carries the dashes (texture U), then swings onto world z
      const cross = new Mesh(new PlaneGeometry(runZ, 2.6), roadMat);
      cross.rotation.x = -Math.PI / 2;
      cross.rotation.z = Math.PI / 2;
      cross.position.set(sx, 0.004, (z0 + z1) / 2);
      this.group.add(cross);
      this.disposables.push(cross.geometry);
    }

    // cross-street ambience stays a cheap shader-driven dot stream
    interface Lane { origin: Vector3; dir: Vector3; len: number; hue: number; count: number }
    const lanes: Lane[] = [];
    for (const sx of CROSS_STREET_X) {
      // lanes run the full cross street, so traffic no longer stops short of
      // the pavement at both ends
      const z0Lane = (z0 + z1) / 2 - runZ / 2;
      lanes.push(
        { origin: new Vector3(sx - 0.6, 0.12, z0Lane), dir: new Vector3(0, 0, 1), len: runZ, hue: 0, count: 8 },
        { origin: new Vector3(sx + 0.6, 0.12, z0Lane), dir: new Vector3(0, 0, 1), len: runZ, hue: 1, count: 8 },
      );
    }

    const rand = mulberry32(5150);
    const pos: number[] = [];
    const dir: number[] = [];
    const lens: number[] = [];
    const phases: number[] = [];
    const hues: number[] = [];
    for (const lane of lanes) {
      for (let i = 0; i < lane.count; i++) {
        pos.push(lane.origin.x, lane.origin.y, lane.origin.z);
        dir.push(lane.dir.x, lane.dir.y, lane.dir.z);
        lens.push(lane.len);
        phases.push(rand());
        hues.push(lane.hue);
      }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    g.setAttribute('aLaneDir', new Float32BufferAttribute(dir, 3));
    g.setAttribute('aLaneLen', new Float32BufferAttribute(lens, 1));
    g.setAttribute('aPhase', new Float32BufferAttribute(phases, 1));
    g.setAttribute('aHue', new Float32BufferAttribute(hues, 1));
    this.trafficMaterial = new ShaderMaterial({
      vertexShader: carVert,
      fragmentShader: carFrag,
      uniforms: {
        uTime: { value: 0 },
        uSpeed: { value: 3.2 },
        uIntensity: { value: 2.2 },
      },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    const traffic = new Points(g, this.trafficMaterial);
    traffic.frustumCulled = false;
    this.group.add(traffic);
    this.disposables.push(g, this.trafficMaterial);

    this.buildCars(rand);
  }

  /**
   * Visible vehicles: instanced body+cabin boxes driving both canyon lanes,
   * with paired head/taillight glow sprites. Simulated in JS each frame so the
   * bodies, lights, and scroll surge all share one travel formula.
   */
  private buildCars(rand: () => number): void {
    const body = new BoxGeometry(0.5, 0.14, 0.24);
    body.translate(0, 0.1, 0);
    const cabin = new BoxGeometry(0.26, 0.11, 0.2);
    cabin.translate(-0.04, 0.22, 0);
    const carGeometry = mergeGeometries([body, cabin]);
    body.dispose();
    cabin.dispose();

    const paint = new MeshStandardMaterial({
      color: '#ffffff',
      roughness: 0.4,
      metalness: 0.5,
      emissive: '#10141f',
      emissiveIntensity: 0.7,
    });
    const PAINTS = ['#3a4356', '#565d6e', '#2c3242', '#5d3a3a', '#38504c', '#454a58'];

    const CARS = 22;
    this.cars = new InstancedMesh(carGeometry, paint, CARS);
    this.cars.instanceMatrix.setUsage(DynamicDrawUsage);
    for (let i = 0; i < CARS; i++) {
      // z −1.1 lane drives −x (oncoming, headlights at the camera);
      // z +1.1 lane drives +x with the flight (taillights)
      const oncoming = i % 2 === 0;
      this.carLanes.push({
        origin: City.CANYON_X0,
        z: oncoming ? -1.1 : 1.1,
        dir: oncoming ? -1 : 1,
        phase: rand(),
        speed: 2.6 + rand() * 1.4,
      });
      this.cars.setColorAt(i, this.color.set(PAINTS[Math.floor(rand() * PAINTS.length)]!));
    }
    if (this.cars.instanceColor) this.cars.instanceColor.needsUpdate = true;
    this.group.add(this.cars);
    this.disposables.push(carGeometry, paint, this.cars);

    // 4 glow sprites per car, positions rewritten from the simulation
    const lightPos = new Float32Array(CARS * 4 * 3);
    const lightHue = new Float32Array(CARS * 4);
    for (let i = 0; i < CARS; i++) {
      lightHue[i * 4] = 0;
      lightHue[i * 4 + 1] = 0;
      lightHue[i * 4 + 2] = 1;
      lightHue[i * 4 + 3] = 1;
    }
    const lightAttr = new Float32BufferAttribute(lightPos, 3);
    lightAttr.setUsage(DynamicDrawUsage);
    this.carLightGeometry.setAttribute('position', lightAttr);
    this.carLightGeometry.setAttribute('aHue', new Float32BufferAttribute(lightHue, 1));
    const glowMaterial = new ShaderMaterial({
      vertexShader: carGlowVert,
      fragmentShader: carFrag,
      uniforms: { uIntensity: { value: 2.6 } },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    const glows = new Points(this.carLightGeometry, glowMaterial);
    glows.frustumCulled = false;
    this.group.add(glows);
    this.disposables.push(this.carLightGeometry, glowMaterial);
  }

  private updateCars(surgedTime: number): void {
    const posAttr = this.carLightGeometry.attributes.position!;
    const arr = posAttr.array as Float32Array;
    for (let i = 0; i < this.carLanes.length; i++) {
      const lane = this.carLanes[i]!;
      const travel =
        (lane.phase * City.CANYON_LEN + surgedTime * lane.speed) % City.CANYON_LEN;
      const x = lane.origin + (lane.dir === 1 ? travel : City.CANYON_LEN - travel);
      this.carPos.set(x, 0.02, lane.z);
      this.carMatrix.compose(
        this.carPos,
        lane.dir === 1 ? this.carQuatFwd : this.carQuatBack,
        this.carScale,
      );
      this.cars.setMatrixAt(i, this.carMatrix);
      // lights: white pair at the nose (travel direction), red pair at the tail
      const nose = x + lane.dir * 0.26;
      const tail = x - lane.dir * 0.26;
      const o = i * 12;
      arr[o] = nose; arr[o + 1] = 0.12; arr[o + 2] = lane.z - 0.08;
      arr[o + 3] = nose; arr[o + 4] = 0.12; arr[o + 5] = lane.z + 0.08;
      arr[o + 6] = tail; arr[o + 7] = 0.14; arr[o + 8] = lane.z - 0.08;
      arr[o + 9] = tail; arr[o + 10] = 0.14; arr[o + 11] = lane.z + 0.08;
    }
    this.cars.instanceMatrix.needsUpdate = true;
    posAttr.needsUpdate = true;
  }

  private buildWindows(rows: [Building, { hx: number; hz: number }][]): void {
    const rand = mulberry32(77);
    const slots: { pos: Vector3; quat: Quaternion; lit: number }[] = [];
    const Y = new Vector3(0, 1, 0);
    const faceCanyonPos = new Quaternion(); // +Z
    const faceCanyonNeg = new Quaternion().setFromAxisAngle(Y, Math.PI); // -Z
    const faceBackX = new Quaternion().setFromAxisAngle(Y, -Math.PI / 2); // -X, toward the approaching camera

    for (const [b, e] of rows) {
      const floors = Math.max(1, Math.floor(b.h / 1.1) - 1);
      for (let f = 0; f < floors; f++) {
        const y = 0.8 + f * 1.1;
        // dense + bright: sparse dim windows lost to the massing at the city
        // entry and whole blocks read as gray boxes
        const litRoll = (): number => (rand() < 0.72 ? 0.5 + rand() * 0.85 : 0.06);
        // kit towers step back near their tops — no quads above 70% height,
        // that's where they hovered in air off the old box faces
        if (y > b.h * 0.7) continue;
        // canyon-facing wall (seen while banking through the dive) — placed
        // on the ACTUAL kit wall (effective extents), not the old lot box
        if (rand() >= 0.2) {
          const facingCanyon = b.z > 0 ? -1 : 1; // canyon sits at z≈0 local
          slots.push({
            pos: new Vector3(
              b.x - e.hx / 2 + rand() * e.hx,
              y,
              b.z + (e.hz + 0.03) * facingCanyon,
            ),
            quat: facingCanyon === -1 ? faceCanyonNeg : faceCanyonPos,
            lit: litRoll(),
          });
        }
        // -X wall: faces the camera flying up the canyon — without these the
        // whole city reads black (canyon windows are edge-on to the flight)
        if (rand() >= 0.18) {
          slots.push({
            pos: new Vector3(
              b.x - e.hx - 0.03,
              y,
              b.z - e.hz / 2 + rand() * e.hz,
            ),
            quat: faceBackX,
            lit: litRoll(),
          });
        }
      }
    }

    const geometry = new PlaneGeometry(0.4, 0.55);
    const material = new MeshBasicMaterial({ color: '#ffffff' });
    this.windows = new InstancedMesh(geometry, material, slots.length);
    const m = new Matrix4();
    const s = new Vector3(1, 1, 1);
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i]!;
      m.compose(slot.pos, slot.quat, s);
      this.windows.setMatrixAt(i, m);
      this.windows.setColorAt(i, this.color.copy(WINDOW_AMBER).multiplyScalar(slot.lit));
      this.windowBase.push(slot.lit);
    }
    this.windows.instanceMatrix.needsUpdate = true;
    if (this.windows.instanceColor) this.windows.instanceColor.needsUpdate = true;
    this.group.add(this.windows);
    this.disposables.push(geometry, material, this.windows);
  }

  private buildDeliveries(buildings: Building[], path: FlightPath): void {
    const rand = mulberry32(41);
    const envGeometry = new BoxGeometry(0.5, 0.05, 0.35);
    this.disposables.push(envGeometry);

    // pick tall canyon-adjacent buildings, spread along the dive
    const candidates = buildings
      .filter((b) => Math.abs(b.z) < 7 && b.h > 5)
      .sort((a, b) => a.x - b.x);

    for (let i = 0; i < DELIVERIES; i++) {
      const tStart = 0.675 + i * 0.017;
      const tEnd = tStart + 0.022;
      const b = candidates[Math.floor((i / DELIVERIES) * candidates.length)] ?? candidates[0];
      if (!b) break;
      const to = new Vector3(
        this.group.position.x + b.x,
        b.h - 0.6,
        this.group.position.z + b.z + (b.z > 0 ? -(b.d / 2 + 0.1) : b.d / 2 + 0.1),
      );

      const material = new MeshStandardMaterial({
        color: '#ddd6c8',
        emissive: '#ffd9a0',
        emissiveIntensity: 0.6,
        roughness: 0.7,
      });
      const mesh = new Mesh(envGeometry, material);
      mesh.visible = false;
      this.group.add(mesh);
      this.envelopeMeshes.push(mesh);
      this.disposables.push(material);

      // nearest window slot on that building lights up on arrival
      let windowIndex = 0;
      let best = Infinity;
      const tmp = new Vector3();
      const wm = new Matrix4();
      for (let w = 0; w < this.windowBase.length; w++) {
        this.windows.getMatrixAt(w, wm);
        tmp.setFromMatrixPosition(wm).add(this.group.position);
        const d = tmp.distanceToSquared(to);
        if (d < best) {
          best = d;
          windowIndex = w;
        }
      }

      this.deliveries.push({
        tStart,
        tEnd,
        from: path.storyPoint(tStart),
        to,
        windowIndex,
      });
      void rand;
    }
  }

  /**
   * Other pilots' mail arriving: five paper darts dive out of the night and
   * disappear INTO windows spread across the city — each landing lights its
   * window through the same mechanism the envelope deliveries use.
   */
  private buildPlaneLandings(path: FlightPath): void {
    const rand = mulberry32(1201);
    if (!this.windowBase.length) return;
    const wm = new Matrix4();
    const slot = new Vector3();
    // canyon-adjacent windows only, sorted along the dive so each landing
    // happens AHEAD of the camera where its window is actually in frame
    const candidates: { index: number; x: number }[] = [];
    for (let w = 0; w < this.windowBase.length; w++) {
      this.windows.getMatrixAt(w, wm);
      slot.setFromMatrixPosition(wm);
      if (Math.abs(slot.z) < 7 && slot.x > -24 && slot.x < 30 && slot.y > 1.5) {
        candidates.push({ index: w, x: slot.x });
      }
    }
    if (!candidates.length) return;
    candidates.sort((a, b) => a.x - b.x);
    for (let i = 0; i < 5; i++) {
      const tStart = 0.698 + i * 0.021;
      const tEnd = tStart + 0.03;
      const pick = candidates[Math.min(
        Math.floor(((i + rand() * 0.6) / 5) * candidates.length),
        candidates.length - 1,
      )]!;
      this.windows.getMatrixAt(pick.index, wm);
      const to = slot.setFromMatrixPosition(wm).clone();
      // enter high over the canyon, slightly ahead of the flight line
      const from = path.storyPoint(Math.min(tStart + 0.012, 0.82)).clone();
      from.x -= this.group.position.x;
      from.z -= this.group.position.z;
      from.y += 5 + rand() * 3;
      from.z += (rand() < 0.5 ? -1 : 1) * (3 + rand() * 3);
      const ctrl = from.clone().lerp(to, 0.45);
      ctrl.y = Math.max(from.y, to.y) + 2;
      const plane = new PaperPlane();
      plane.setFold(1);
      plane.group.scale.setScalar(0.55);
      plane.group.visible = false;
      this.group.add(plane.group);
      this.planeLandings.push({
        tStart, tEnd, from, ctrl, to, windowIndex: pick.index, plane, wobble: rand() * 6.28,
      });
    }
  }

  update(t: number, time = 0): void {
    if (!this.group.visible) return;
    // traffic loops on absolute time only — the scene lives on its own, with
    // or without scroll (scroll-coupled surge removed by request)
    if (this.trafficMaterial) this.trafficMaterial.uniforms.uTime!.value = time;
    if (this.cars) this.updateCars(time);
    // aircraft-warning strobes on the antenna tips
    if (this.blinkMaterial) this.blinkMaterial.opacity = 0.25 + 0.65 * Math.abs(Math.sin(time * 2.1));
    let colorsDirty = false;
    for (let i = 0; i < this.deliveries.length; i++) {
      const d = this.deliveries[i]!;
      const mesh = this.envelopeMeshes[i]!;
      const u = MathUtils.clamp((t - d.tStart) / (d.tEnd - d.tStart), 0, 1);
      const inFlight = u > 0 && u < 1;
      mesh.visible = inFlight;
      if (inFlight) {
        // arc: lerp with a lifted midpoint
        const eased = u * u * (3 - 2 * u);
        mesh.position.lerpVectors(d.from, d.to, eased);
        mesh.position.x -= this.group.position.x;
        mesh.position.z -= this.group.position.z;
        mesh.position.y += Math.sin(eased * Math.PI) * 2.2 - (1 - eased) * 0;
        mesh.rotation.y = eased * 2.2;
      }
      const arrived = u >= 1;
      const base = this.windowBase[d.windowIndex]!;
      const target = arrived ? 2.2 : base;
      this.windows.getColorAt(d.windowIndex, this.color);
      const current = this.color.r / Math.max(WINDOW_AMBER.r, 1e-4);
      if (Math.abs(current - target) > 0.02) {
        this.windows.setColorAt(
          d.windowIndex,
          this.color.copy(WINDOW_AMBER).multiplyScalar(current + (target - current) * 0.25),
        );
        colorsDirty = true;
      }
    }
    // — dart landings: dive in, shrink into the window, light it —
    for (const landing of this.planeLandings) {
      const u = MathUtils.clamp((t - landing.tStart) / (landing.tEnd - landing.tStart), 0, 1);
      const inFlight = u > 0 && u < 1;
      landing.plane.group.visible = inFlight;
      if (inFlight) {
        const eased = u * u * (3 - 2 * u);
        const a = 1 - eased;
        this.landingPos
          .copy(landing.from).multiplyScalar(a * a)
          .addScaledVector(landing.ctrl, 2 * a * eased)
          .addScaledVector(landing.to, eased * eased);
        landing.plane.group.position.copy(this.landingPos);
        const u2 = Math.min(eased + 0.04, 1);
        const a2 = 1 - u2;
        this.landingAhead
          .copy(landing.from).multiplyScalar(a2 * a2)
          .addScaledVector(landing.ctrl, 2 * a2 * u2)
          .addScaledVector(landing.to, u2 * u2);
        // lookAt wants WORLD space; the group only translates, never rotates
        this.landingAhead.add(this.group.position);
        landing.plane.group.lookAt(this.landingAhead);
        landing.plane.flex(time + landing.wobble, 1);
        // shrink into the window over the last stretch — "lands inside"
        const swallow = MathUtils.smoothstep(u, 0.82, 1);
        landing.plane.group.scale.setScalar(0.55 * (1 - swallow));
      }
      const arrived = u >= 1;
      const base = this.windowBase[landing.windowIndex]!;
      const target = arrived ? 2.2 : base;
      this.windows.getColorAt(landing.windowIndex, this.color);
      const current = this.color.r / Math.max(WINDOW_AMBER.r, 1e-4);
      if (Math.abs(current - target) > 0.02) {
        this.windows.setColorAt(
          landing.windowIndex,
          this.color.copy(WINDOW_AMBER).multiplyScalar(current + (target - current) * 0.25),
        );
        colorsDirty = true;
      }
    }
    if (colorsDirty && this.windows.instanceColor) this.windows.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.kitCity?.dispose();
    for (const landing of this.planeLandings) landing.plane.dispose();
    for (const d of this.disposables) d.dispose();
  }
}
