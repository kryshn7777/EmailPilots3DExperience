import {
  BufferAttribute,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  MathUtils,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  Vector3,
  type BufferGeometry,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { meadowTexture, runwayTexture } from '../bake/CanvasTextures';
import { TOWER } from '../rig/endingPoints.mjs';
import { AIRLINER, Airliner } from './Airliner';
import { CommTower } from './CommTower';
import { RecipientRoom } from './RecipientRoom';
import type { Quality } from '../quality';

/**
 * CH10, the last mile (docs/ending.md): a dawn airfield whose runway points straight at a communications tower,
 * and beyond the tower a small house with one lit, open window. The dart comes down out of the cloud onto the
 * runway's centreline, runs low along it with the approach "rabbit" racing ahead of it toward the tower, flies
 * into the tower's relay hall, rides its glass relay tube up the core, leaves through the main dish into the
 * sunrise and arcs down through the house's window into the recipient's laptop (the line: rig/endingPoints.mjs;
 * the camera: rig/endingShot.ts).
 *
 * Here: the meadow, the runway (edge lights, threshold bars, PAPI, the rabbit), a windsock, a parked airliner
 * holding short on the parallel taxiway as a scale cue, tree lines and a garden round the house, and the two actors that carry the story: CommTower and
 * RecipientRoom (children of this group). The lights are instanced (four draws for all of them); nothing here is a
 * real-time light.
 */
const RUNWAY = { x0: 262, x1: 332, w: 9 };
const TAXI_Z = 15;

export class Landing {
  readonly group = new Group();
  readonly tower: CommTower;
  readonly room: RecipientRoom;
  private edge: InstancedMesh;
  private edgeMat: MeshBasicMaterial;
  private bars: InstancedMesh;
  private barsMat: MeshBasicMaterial;
  private rabbit: InstancedMesh;
  private rabbitMat: MeshBasicMaterial;
  private rabbitX: number[] = [];
  private windsock: Mesh;
  /** tree lines, copses and the house's garden (one instanced draw) */
  private trees: InstancedMesh;
  /** one jet holding short on the parallel taxiway (a scale cue) */
  private parked: Airliner;
  private disposables: { dispose(): void }[] = [];
  private readonly col = new Color();

  constructor(anchor: Vector3, quality: Quality) {
    const cz = anchor.z;
    const high = quality.tier === 'high';
    const own = (...d: { dispose(): void }[]): void => { this.disposables.push(...d); };

    // the meadow under everything, out past the house to the haze (the flight crests at 27 over it)
    const meadow = meadowTexture();
    meadow.repeat.set(16, 11);
    const grass = new MeshStandardMaterial({ map: meadow, color: '#b4bda4', roughness: 1 });
    const field = new Mesh(new PlaneGeometry(900, 620), grass);
    field.rotation.x = -Math.PI / 2;
    field.position.set(380, -0.02, cz);
    field.receiveShadow = high;
    this.group.add(field);
    own(meadow, field.geometry, grass);

    // the runway, its long axis on x, ending short of the tower's footings
    const len = RUNWAY.x1 - RUNWAY.x0;
    const cx = (RUNWAY.x0 + RUNWAY.x1) / 2;
    const asphalt = new MeshStandardMaterial({ map: runwayTexture(), roughness: 0.92 });
    const strip = new Mesh(new PlaneGeometry(RUNWAY.w, len), asphalt);
    strip.rotation.x = -Math.PI / 2;
    strip.rotation.z = Math.PI / 2;
    strip.position.set(cx, 0.01, cz);
    strip.receiveShadow = high;
    this.group.add(strip);
    own(strip.geometry, asphalt, asphalt.map!);
    // the parallel taxiway, and a link to the runway's far end
    const taxiMat = new MeshStandardMaterial({ color: '#1d2028', roughness: 0.95 });
    const taxi = new Mesh(new PlaneGeometry(len - 10, 3.4), taxiMat);
    taxi.rotation.x = -Math.PI / 2;
    taxi.position.set(cx - 2, 0.008, cz + TAXI_Z);
    const link = new Mesh(new PlaneGeometry(3.4, TAXI_Z - RUNWAY.w / 2), taxiMat);
    link.rotation.x = -Math.PI / 2;
    link.position.set(RUNWAY.x0 + 8, 0.007, cz + RUNWAY.w / 2 + (TAXI_Z - RUNWAY.w / 2) / 2);
    taxi.receiveShadow = link.receiveShadow = high;
    this.group.add(taxi, link);
    own(taxi.geometry, link.geometry, taxiMat);

    const bulb = new SphereGeometry(0.09, 8, 6);
    own(bulb);
    const m4 = new Matrix4();
    // edge lights (warm), both sides
    this.edgeMat = new MeshBasicMaterial({ color: '#ffc96b', toneMapped: false });
    const edgeN = 17;
    this.edge = new InstancedMesh(bulb, this.edgeMat, edgeN * 2);
    for (let i = 0; i < edgeN; i++) {
      for (const [k, sz] of [[0, -RUNWAY.w / 2 - 0.4], [1, RUNWAY.w / 2 + 0.4]] as const) {
        this.edge.setMatrixAt(i * 2 + k, m4.makeTranslation(RUNWAY.x0 + (i * len) / (edgeN - 1), 0.1, cz + sz));
      }
    }
    // threshold bars (green at the near end, red at the far end) and PAPI (two white, two red), one draw
    this.barsMat = new MeshBasicMaterial({ color: '#ffffff', toneMapped: false });
    this.bars = new InstancedMesh(bulb, this.barsMat, 18 + 4);
    const green = new Color('#3ef58a').multiplyScalar(2);
    const red = new Color('#ff4b4b').multiplyScalar(2);
    const papiWhite = new Color('#fff4e0').multiplyScalar(2.2);
    for (let i = 0; i < 9; i++) {
      const z = cz - RUNWAY.w / 2 + 0.5 + (i * (RUNWAY.w - 1)) / 8;
      this.bars.setMatrixAt(i, m4.makeTranslation(RUNWAY.x0 - 0.6, 0.1, z));
      this.bars.setColorAt(i, green);
      this.bars.setMatrixAt(9 + i, m4.makeTranslation(RUNWAY.x1 + 0.6, 0.1, z));
      this.bars.setColorAt(9 + i, red);
    }
    for (let i = 0; i < 4; i++) {
      this.bars.setMatrixAt(18 + i, m4.makeTranslation(RUNWAY.x0 + 14, 0.16, cz - RUNWAY.w / 2 - 2.2 - i * 0.9));
      this.bars.setColorAt(18 + i, i < 2 ? papiWhite : red);
    }
    // the rabbit: flush strobes down the centreline, a pulse racing toward the tower
    this.rabbitMat = new MeshBasicMaterial({ color: '#ffffff', toneMapped: false });
    const strobe = new SphereGeometry(0.13, 8, 6);
    own(strobe);
    const rabbitN = 22;
    this.rabbit = new InstancedMesh(strobe, this.rabbitMat, rabbitN);
    for (let i = 0; i < rabbitN; i++) {
      const x = RUNWAY.x0 - 14 + (i * (RUNWAY.x1 - 2 - (RUNWAY.x0 - 14))) / (rabbitN - 1);
      this.rabbitX.push(x);
      this.rabbit.setMatrixAt(i, m4.makeTranslation(x, 0.06, cz));
      this.rabbit.setColorAt(i, this.col.setRGB(0, 0, 0));
    }
    for (const im of [this.edge, this.bars, this.rabbit]) {
      im.frustumCulled = false;
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      this.group.add(im);
    }
    own(this.edgeMat, this.barsMat, this.rabbitMat);

    // windsock beside the touchdown zone
    const poleMat = new MeshStandardMaterial({ color: '#242a34', roughness: 0.6 });
    const pole = new Mesh(new CylinderGeometry(0.04, 0.05, 2.6, 8), poleMat);
    pole.position.set(RUNWAY.x0 + 18, 1.3, cz + RUNWAY.w / 2 + 3);
    const sockMat = new MeshStandardMaterial({ color: '#d96a2b', roughness: 0.7 });
    this.windsock = new Mesh(new ConeGeometry(0.22, 1.1, 8, 1, true), sockMat);
    this.windsock.position.set(RUNWAY.x0 + 18, 2.5, cz + RUNWAY.w / 2 + 3);
    this.windsock.rotation.z = Math.PI / 2 - 0.25;
    this.group.add(pole, this.windsock);
    own(pole.geometry, poleMat, this.windsock.geometry, sockMat);

    // the jet holding short on the taxiway, nose toward the runway's threshold
    this.parked = new Airliner({ tier: quality.tier });
    this.parked.group.position.set(cx + 6, 0.008, cz + TAXI_Z);
    this.parked.body.position.y = AIRLINER.wheelDrop;
    this.parked.group.rotation.y = Math.PI;
    this.group.add(this.parked.group);
    own(this.parked);

    this.trees = this.plantTrees(cz, high);
    this.group.add(this.trees);
    own(this.trees.geometry, this.trees.material as MeshStandardMaterial);

    // the communications tower at the runway's end, and the recipient's house beyond it
    this.tower = new CommTower(new Vector3(...TOWER), quality.tier);
    this.room = new RecipientRoom(quality.tier);
    this.group.add(this.tower.group, this.room.group);
    own(this.tower, this.room);
  }

  /**
   * Trees, one instanced draw: tree lines along the field's edges either side of the runway, copses out in the
   * country, and a garden round the house. None stands near the flight line, the tower or the camera's paths
   * (the corridor along the line from the runway to the window, and the tower's sunward side where the camera
   * cranes up).
   */
  private plantTrees(cz: number, high: boolean): InstancedMesh {
    const parts: BufferGeometry[] = [];
    const colored = (g: BufferGeometry, c: Color, at: Matrix4): BufferGeometry => {
      const geo = g.index ? g.toNonIndexed() : g;
      geo.applyMatrix4(at);
      const n = geo.getAttribute('position')!.count;
      const col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
      geo.setAttribute('color', new BufferAttribute(col, 3));
      geo.deleteAttribute('uv');
      return geo;
    };
    const m = new Matrix4();
    parts.push(colored(new CylinderGeometry(0.1, 0.17, 2.2, high ? 7 : 5), new Color('#5a4332'), m.makeTranslation(0, 1.1, 0)));
    parts.push(colored(new IcosahedronGeometry(1.5, high ? 1 : 0), new Color('#557a3c'), m.compose(new Vector3(0, 3.1, 0), new Quaternion(), new Vector3(1, 1.25, 1))));
    if (high) {
      parts.push(colored(new IcosahedronGeometry(1.05, 1), new Color('#4d7236'), m.compose(new Vector3(0.75, 2.6, 0.35), new Quaternion(), new Vector3(1, 1.1, 1))));
      parts.push(colored(new IcosahedronGeometry(0.95, 1), new Color('#5d8443'), m.compose(new Vector3(-0.6, 2.75, -0.45), new Quaternion(), new Vector3(1, 1.1, 1))));
    }
    const geo = mergeGeometries(parts, false)!;
    for (const p of parts) p.dispose();
    geo.computeVertexNormals();
    const mat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.92, flatShading: true });
    // where trees may not stand: the open airfield, the line's corridor to the window, the tower and the crane's side
    const clear = (x: number, z: number): boolean => {
      const dz = z - cz;
      if (x > 200 && x < 340 && Math.abs(dz) < 30) return false;
      if (x >= 318 && x < 386 && Math.abs(dz) < 11) return false;
      if (x > 318 && x < 352 && dz > -30 && dz < 12) return false;
      // the house itself
      if (x > 374 && x < 393 && dz > -8.5 && dz < 8.5) return false;
      return true;
    };
    let seed = 20261106;
    const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const spots: [number, number, number][] = [];
    const tryAdd = (x: number, z: number, s: number): void => {
      if (clear(x, z)) spots.push([x, z, s]);
    };
    // tree lines along the field edges either side of the runway
    for (let x = 230; x < 520; x += high ? 5.5 : 9) {
      for (const side of [-1, 1]) {
        const off = side * (40 + rnd() * 6 + (side > 0 ? 6 : 0));
        tryAdd(x + rnd() * 3, cz + off, 0.9 + rnd() * 0.5);
      }
    }
    // copses out in the country
    const copses = [[300, -75], [365, 62], [420, -48], [455, 30], [262, 70], [500, -10], [410, 85], [345, -95]];
    for (const [cx0, cz0] of copses) {
      for (let k = 0; k < (high ? 9 : 4); k++) tryAdd(cx0! + (rnd() - 0.5) * 16, cz + cz0! + (rnd() - 0.5) * 16, 0.8 + rnd() * 0.7);
    }
    // the garden round the house: a few big trees behind and beside it
    const hx = 378.6;
    for (const [dx, dz, s] of [[4, -13.5, 1.3], [12, -12.5, 1.1], [19, -6, 1.35], [17, 7.5, 1.2], [6.5, 12.5, 1.05], [-3, 13, 0.95], [24, 2, 1.25], [-4, -14, 1.0]] as const) {
      tryAdd(hx + dx, cz + dz, s);
    }
    const im = new InstancedMesh(geo, mat, spots.length);
    const q = new Quaternion();
    const col = new Color();
    spots.forEach(([x, z, s], i) => {
      q.setFromAxisAngle(new Vector3(0, 1, 0), rnd() * Math.PI * 2);
      im.setMatrixAt(i, m.compose(new Vector3(x, 0, z), q, new Vector3(s, s * (0.85 + rnd() * 0.35), s)));
      im.setColorAt(i, col.setHSL(0.24 + rnd() * 0.06, 0.25 + rnd() * 0.2, 0.75 + rnd() * 0.3));
    });
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    // no new shadow casters (only the tower casts one more, on HIGH)
    im.receiveShadow = high;
    im.computeBoundingSphere();
    return im;
  }

  /** resolves once the tower has streamed in (the readiness gate can wait on it) */
  get loaded(): Promise<void> {
    return this.tower.loaded;
  }

  update(t: number, time: number): void {
    if (!this.group.visible) return;
    // the airfield wakes as the dart comes down out of the cloud: the edge lights first, then the bars and PAPI,
    // then the rabbit and the tower
    const edge = MathUtils.smoothstep(t, 0.832, 0.862);
    const bars = MathUtils.smoothstep(t, 0.846, 0.872);
    const rabbit = MathUtils.smoothstep(t, 0.856, 0.882);
    this.edgeMat.color.set('#ffc96b').multiplyScalar((1.4 + Math.sin(time * 1.6) * 0.4) * edge);
    this.barsMat.color.setScalar(bars);
    // the rabbit: one bright pulse racing down the runway toward the tower, over and over
    const sweep = (time * 0.9) % 1;
    const n = this.rabbitX.length;
    for (let i = 0; i < n; i++) {
      const d = Math.abs(sweep - i / (n - 1));
      const k = Math.max(0, 1 - d * 8) * 5 * rabbit;
      this.rabbit.setColorAt(i, this.col.setRGB(k * 0.92, k * 0.95, k));
    }
    if (this.rabbit.instanceColor) this.rabbit.instanceColor.needsUpdate = true;
    this.windsock.rotation.y = Math.sin(time * 0.7) * 0.4;
    this.parked.blink(time + 0.4);
    this.tower.update(t, time, rabbit);
    this.room.update(t, time);
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
