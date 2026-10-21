import {
  Box3,
  CanvasTexture,
  CatmullRomCurve3,
  BoxGeometry,
  BufferAttribute,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  PointLight,
  SphereGeometry,
  Vector2,
  Vector3,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  BOOK_SPINE_CELLS, bookSpineTexture, frameArtTexture, meadowTexture, replyTexture, runwayTexture,
} from '../bake/CanvasTextures';
import {
  WAINSCOT, arrivalScreens, leatherMaps, plasterMaps, rugMaps, wainscotMaps, woodMaps, type SurfaceMaps,
} from '../bake/RoomTextures';
import { asset } from '../asset';
import { requestCompile } from '../warm';
import { AIRLINER, Airliner } from './Airliner';
import { createLaptop, type Laptop } from './Laptop';
import type { Quality } from '../quality';

/**
 * CH10: a real dawn airfield. Marked runway with edge/threshold lights, an
 * approach-light "rabbit" strobing toward the threshold, PAPI bars, a
 * control tower, hangar, apron and windsock — and after touchdown the dart
 * unfolds back into the letter while the "Re:" reply slides out.
 */
/**
 * The arrival office, and the desk height its laptop sits at. These are
 * fixed world coordinates on purpose: the flight line's final control point
 * (pathPoints.mjs) is authored to end inside this screen, so the two must be
 * edited together.
 */
const OFFICE = { x: 278, z: 17 };
const DESK_TOP = 0.62;
/** how bright the waiting inbox is, and when it flips to the delivered state (the dart is inside) */
const IDLE_GLOW = 0.5;
const RECEIVED_AT = 0.9885;

export class Landing {
  readonly group = new Group();
  private edgeLightMaterial: MeshStandardMaterial;
  private rabbitMaterials: MeshStandardMaterial[] = [];
  private windsock: Mesh;
  private reply: Mesh;
  private replyHome = new Vector3();
  private screenMaterial: MeshStandardMaterial | null = null;
  private screens: { idle: CanvasTexture; received: CanvasTexture } | null = null;
  private showing: 'idle' | 'received' = 'idle';
  private screenLight: PointLight | null = null;
  private officeBuilt = false;
  /** the departure: lined up on the runway, rolls and climbs out as the dart comes in behind it */
  private departing = new Airliner();
  /** one parked at the apron */
  private parked = new Airliner();
  /** the landed jet's route: down the runway, then off onto the taxiway toward the apron */
  private route!: CatmullRomCurve3;
  private disposables: { dispose(): void }[] = [];

  constructor(runwayEnd: Vector3, quality: Quality) {
    const cx = runwayEnd.x;
    const cz = runwayEnd.z;
    const RUNWAY_LEN = 64;
    const RUNWAY_W = 9;
    const startX = cx - 48; // threshold the plane crosses first

    // apron of dark grass under everything
    const meadow = meadowTexture();
    meadow.repeat.set(4, 2.5);
    const grass = new MeshStandardMaterial({ map: meadow, color: '#b4bda4', roughness: 1 });
    this.disposables.push(meadow);
    const field = new Mesh(new PlaneGeometry(190, 120), grass);
    field.rotation.x = -Math.PI / 2;
    field.position.set(cx - 14, -0.02, cz);
    this.group.add(field);
    field.receiveShadow = quality.tier === 'high';
    this.disposables.push(field.geometry, grass);

    // runway strip (texture long-axis = V → rotate so V runs along X)
    const asphalt = new MeshStandardMaterial({ map: runwayTexture(), roughness: 0.92 });
    const strip = new Mesh(new PlaneGeometry(RUNWAY_W, RUNWAY_LEN), asphalt);
    strip.rotation.x = -Math.PI / 2;
    strip.rotation.z = Math.PI / 2;
    strip.position.set(startX + RUNWAY_LEN / 2 - 6, 0.01, cz);
    this.group.add(strip);
    strip.receiveShadow = quality.tier === 'high';
    this.disposables.push(strip.geometry, asphalt);

    // taxiway + apron slab by the hangar
    const taxi = new MeshStandardMaterial({ color: '#1d2028', roughness: 0.95 });
    const taxiway = new Mesh(new PlaneGeometry(3.4, 16), taxi);
    taxiway.rotation.x = -Math.PI / 2;
    taxiway.position.set(cx - 4, 0.008, cz + 11);
    const apron = new Mesh(new PlaneGeometry(16, 12), taxi);
    apron.rotation.x = -Math.PI / 2;
    apron.position.set(cx - 6, 0.006, cz + 21);
    this.group.add(taxiway, apron);
    taxiway.receiveShadow = apron.receiveShadow = quality.tier === 'high';
    this.disposables.push(taxiway.geometry, apron.geometry, taxi);

    // traffic: a jet lined up to depart (animated in update) and one parked at the apron
    this.route = new CatmullRomCurve3([
      new Vector3(cx - 40, 0, 0), new Vector3(cx - 12, 0, 0), new Vector3(cx - 6.5, 0, 0.25),
      new Vector3(cx - 4, 0, 2.8), new Vector3(cx - 4, 0, 6.5), new Vector3(cx - 4, 0, 10.5),
    ], false, 'centripetal');
    this.group.add(this.departing.group, this.parked.group);
    this.parked.group.position.set(cx - 5.3, 0.006, cz + 21);
    this.parked.body.position.y = AIRLINER.wheelDrop;
    this.parked.group.rotation.y = 0.12;
    this.disposables.push(this.departing, this.parked);

    // runway edge lights (warm) + threshold bars (green near / red far)
    this.edgeLightMaterial = new MeshStandardMaterial({
      color: '#4a2e10',
      emissive: '#ffc96b',
      emissiveIntensity: 1.6,
    });
    const bulb = new SphereGeometry(0.09, 8, 8);
    this.disposables.push(bulb, this.edgeLightMaterial);
    for (let i = 0; i <= 16; i++) {
      for (const sideZ of [-RUNWAY_W / 2 - 0.4, RUNWAY_W / 2 + 0.4]) {
        const light = new Mesh(bulb, this.edgeLightMaterial);
        light.position.set(startX + (i * RUNWAY_LEN) / 16 - 6, 0.1, cz + sideZ);
        this.group.add(light);
      }
    }
    const greenMat = new MeshStandardMaterial({ color: '#062a10', emissive: '#3ef58a', emissiveIntensity: 2 });
    const redMat = new MeshStandardMaterial({ color: '#2a0808', emissive: '#ff4b4b', emissiveIntensity: 2 });
    this.disposables.push(greenMat, redMat);
    for (let i = 0; i < 9; i++) {
      const z = cz - RUNWAY_W / 2 + 0.5 + (i * (RUNWAY_W - 1)) / 8;
      const g = new Mesh(bulb, greenMat);
      g.position.set(startX - 6.6, 0.1, z);
      const r = new Mesh(bulb, redMat);
      r.position.set(startX + RUNWAY_LEN - 5.4, 0.1, z);
      this.group.add(g, r);
    }

    // approach "rabbit": gantry strobes sweeping toward the threshold
    const strobeGeo = new SphereGeometry(0.12, 8, 8);
    this.disposables.push(strobeGeo);
    for (let i = 0; i < 10; i++) {
      const m = new MeshStandardMaterial({
        color: '#101318',
        emissive: '#eaf2ff',
        emissiveIntensity: 0,
      });
      const s = new Mesh(strobeGeo, m);
      s.position.set(startX - 10 - i * 3.4, 0.5 + i * 0.12, cz);
      this.group.add(s);
      this.rabbitMaterials.push(m);
      this.disposables.push(m);
    }

    // PAPI: four lights beside the touchdown zone, two white two red
    const papiWhite = new MeshStandardMaterial({ color: '#222', emissive: '#fff4e0', emissiveIntensity: 2.2 });
    const papiRed = new MeshStandardMaterial({ color: '#220808', emissive: '#ff4b4b', emissiveIntensity: 2.2 });
    this.disposables.push(papiWhite, papiRed);
    for (let i = 0; i < 4; i++) {
      const m = i < 2 ? papiWhite : papiRed;
      const p = new Mesh(bulb, m);
      p.position.set(startX + 10, 0.16, cz - RUNWAY_W / 2 - 2.2 - i * 0.9);
      this.group.add(p);
    }

    // control tower
    const towerMat = new MeshStandardMaterial({ color: '#242a34', roughness: 0.6 });
    const towerGlass = new MeshStandardMaterial({
      color: '#0d2028',
      emissive: '#ffc96b',
      emissiveIntensity: 1.1,
      roughness: 0.3,
    });
    const shaft = new Mesh(new CylinderGeometry(0.7, 1, 8, 10), towerMat);
    shaft.position.set(cx - 12, 4, cz + 24);
    const cab = new Mesh(new CylinderGeometry(1.5, 1.2, 1.6, 10), towerGlass);
    cab.position.set(cx - 12, 8.6, cz + 24);
    const cap = new Mesh(new ConeGeometry(1.5, 0.8, 10), towerMat);
    cap.position.set(cx - 12, 9.8, cz + 24);
    this.group.add(shaft, cab, cap);
    this.disposables.push(shaft.geometry, cab.geometry, cap.geometry, towerMat, towerGlass);

    // hangar: box + half-cylinder roof
    const hangarMat = new MeshStandardMaterial({ color: '#2a2f3a', roughness: 0.8 });
    const hangarBody = new Mesh(new BoxGeometry(10, 3.2, 8), hangarMat);
    hangarBody.position.set(cx - 2, 1.6, cz + 24);
    const roof = new Mesh(new CylinderGeometry(4, 4, 10, 14, 1, false, 0, Math.PI), hangarMat);
    roof.rotation.z = Math.PI / 2;
    roof.position.set(cx - 2, 3.2, cz + 24);
    this.group.add(hangarBody, roof);
    this.disposables.push(hangarBody.geometry, roof.geometry, hangarMat);

    // windsock
    const pole = new Mesh(new CylinderGeometry(0.04, 0.05, 2.6, 8), towerMat);
    pole.position.set(startX + 4, 1.3, cz + RUNWAY_W / 2 + 3);
    const sockMat = new MeshStandardMaterial({ color: '#d96a2b', roughness: 0.7 });
    this.windsock = new Mesh(new ConeGeometry(0.22, 1.1, 8, 1, true), sockMat);
    this.windsock.position.set(startX + 4, 2.5, cz + RUNWAY_W / 2 + 3);
    this.windsock.rotation.z = Math.PI / 2 - 0.25;
    this.group.add(pole, this.windsock);
    this.disposables.push(pole.geometry, this.windsock.geometry, sockMat);

    // the office has a lot of surface to draw; it is built once the page is idle (and at
    // once if the flight lands on it first), not during boot
    const idle = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void })
      .requestIdleCallback;
    if (idle) idle(() => this.ensureOffice(), { timeout: 4000 });
    else setTimeout(() => this.ensureOffice(), 2500);

    // the printed reply waits on the arrival desk, beside the laptop
    const paper = new MeshStandardMaterial({ map: replyTexture(), roughness: 0.9 });
    this.reply = new Mesh(new PlaneGeometry(0.5, 0.7), paper);
    this.reply.rotation.x = -Math.PI / 2;
    this.reply.rotation.z = -0.12;
    this.replyHome.set(OFFICE.x + 0.95, DESK_TOP + 0.01, OFFICE.z + 1.9);
    this.reply.position.copy(this.replyHome);
    this.group.add(this.reply);
    this.disposables.push(this.reply.geometry, paper);
  }

  /**
   * The delivery itself: a warm reception office off the apron with its door open to the
   * taxiway, a walnut desk, and the laptop the flight ends inside. The flight line's
   * last control point IS this screen, so the dart flies into it head-on.
   *
   * Same language as the study: sage plaster over painted wainscot, oak boards under a
   * wool rug, leather and brass, one warm lamp and a warm ceiling bounce, with the dawn
   * coming in cool-gold through the side windows.
   */
  private buildArrivalOffice(): void {
    const { x, z } = OFFICE;
    const W = 11; // room width and depth
    const H = 3.6;
    const own = (...items: { dispose(): void }[]): void => { this.disposables.push(...items); };
    const surface = (m: SurfaceMaps, extra: ConstructorParameters<typeof MeshStandardMaterial>[0] = {}): MeshStandardMaterial => {
      own(m.map, m.normalMap);
      if (m.roughnessMap) own(m.roughnessMap);
      return new MeshStandardMaterial({
        map: m.map, normalMap: m.normalMap, ...(m.roughnessMap ? { roughnessMap: m.roughnessMap } : {}), roughness: 1, ...extra,
      });
    };
    const repeat = (m: SurfaceMaps, u: number, v: number): void => {
      for (const t of [m.map, m.normalMap, m.roughnessMap]) t?.repeat.set(u, v);
    };
    const add = (mesh: Object3D): void => { this.group.add(mesh); };
    const box = (m: MeshStandardMaterial, w: number, h: number, d: number, px: number, py: number, pz: number): Mesh => {
      const mesh = new Mesh(new BoxGeometry(w, h, d), m);
      mesh.position.set(px, py, pz);
      add(mesh);
      own(mesh.geometry);
      return mesh;
    };
    const plane = (m: MeshStandardMaterial | MeshBasicMaterial, w: number, h: number, px: number, py: number, pz: number, ry = 0, rx = 0): Mesh => {
      const mesh = new Mesh(new PlaneGeometry(w, h), m);
      mesh.position.set(px, py, pz);
      mesh.rotation.set(rx, ry, 0);
      add(mesh);
      own(mesh.geometry);
      return mesh;
    };

    // the outside: pale painted stucco, seen from the taxiway
    const stuccoMaps = plasterMaps([214, 204, 184], 41);
    repeat(stuccoMaps, 3, 1);
    const stucco = surface(stuccoMaps, { roughness: 0.95 });
    own(stucco);
    // floor slab, back and side walls, ceiling. The −z face stays open: that
    // is the doorway the dart comes through.
    const slab = new MeshStandardMaterial({ color: '#3b3a38', roughness: 0.9 });
    own(slab);
    box(slab, W, 0.08, W, x, 0.04, z);
    box(stucco, W, H, 0.16, x, H / 2, z + W / 2);
    box(stucco, 0.16, H, W, x - W / 2, H / 2, z);
    box(stucco, 0.16, H, W, x + W / 2, H / 2, z);
    box(stucco, W, 0.16, W, x, H + 0.06, z);

    // inside: sage plaster
    const plaster = plasterMaps([172, 184, 158], 43);
    repeat(plaster, 3, 1.1);
    const wall = surface(plaster, { roughness: 0.93, normalScale: new Vector2(0.55, 0.55) });
    const ceilingMat = new MeshStandardMaterial({ color: '#ece4d2', roughness: 0.95 });
    own(wall, ceilingMat);
    const inX0 = x - W / 2 + 0.081;
    const inX1 = x + W / 2 - 0.081;
    const inZ1 = z + W / 2 - 0.081;
    plane(wall, W, H, x, H / 2, inZ1, Math.PI);          // back wall, faces the door
    plane(wall, W, H, inX0, H / 2, z, Math.PI / 2);      // left wall, faces +x
    plane(wall, W, H, inX1, H / 2, z, -Math.PI / 2);     // right wall, faces -x
    plane(ceilingMat, W, W, x, H - 0.0, z, 0, Math.PI / 2);

    // oak boards and a wool rug under the desk
    const oak = woodMaps({ boards: 8, base: [190, 138, 86], seed: 47, joints: 1, gap: 2.2, roughness: 0.46, normal: 2.6 });
    repeat(oak, W / 5.5, W / 3.2);
    const floorMat = surface(oak, { metalness: 0 });
    own(floorMat);
    plane(floorMat, W, W, x, 0.085, z, 0, -Math.PI / 2);
    const rugSet = rugMaps(51);
    const rugMat = new MeshStandardMaterial({ map: rugSet.map, normalMap: rugSet.normalMap, normalScale: new Vector2(0.7, 0.7), roughness: 1 });
    own(rugSet.map, rugSet.normalMap, rugMat);
    plane(rugMat, 6.2, 4.6, x, 0.09, z + 2.0, 0, -Math.PI / 2);

    // painted wainscot, chair rail, baseboard and crown
    const wain = wainscotMaps([222, 211, 188], 53);
    repeat(wain, W / WAINSCOT.bayW, 1);
    const wainMat = surface(wain, { roughness: 0.55, normalScale: new Vector2(1.1, 1.1) });
    const paint = new MeshStandardMaterial({ color: '#ddd3bd', roughness: 0.5 });
    own(wainMat, paint);
    plane(wainMat, W, WAINSCOT.height, x, 0.09 + WAINSCOT.height / 2, inZ1 - 0.002, Math.PI);
    plane(wainMat, W, WAINSCOT.height, inX0 + 0.002, 0.09 + WAINSCOT.height / 2, z, Math.PI / 2);
    plane(wainMat, W, WAINSCOT.height, inX1 - 0.002, 0.09 + WAINSCOT.height / 2, z, -Math.PI / 2);
    const railY = 0.09 + WAINSCOT.height + 0.02;
    box(paint, W - 0.3, 0.1, 0.09, x, railY, inZ1 - 0.04);
    box(paint, 0.09, 0.1, W - 0.3, inX0 + 0.04, railY, z);
    box(paint, 0.09, 0.1, W - 0.3, inX1 - 0.04, railY, z);
    box(paint, W - 0.3, 0.3, 0.08, x, 0.25, inZ1 - 0.04);
    box(paint, 0.08, 0.3, W - 0.3, inX0 + 0.04, 0.25, z);
    box(paint, 0.08, 0.3, W - 0.3, inX1 - 0.04, 0.25, z);
    box(paint, W - 0.3, 0.22, 0.14, x, H - 0.1, inZ1 - 0.06);
    box(paint, 0.14, 0.22, W - 0.3, inX0 + 0.06, H - 0.1, z);
    box(paint, 0.14, 0.22, W - 0.3, inX1 - 0.06, H - 0.1, z);

    // doorway reveal — a painted frame so the opening reads as a door
    box(paint, 0.3, H, 0.3, x - 2.6, H / 2, z - 5.4);
    box(paint, 0.3, H, 0.3, x + 2.6, H / 2, z - 5.4);
    box(paint, 5.5, 0.3, 0.3, x, H - 0.15, z - 5.4);

    // dawn at the side windows: a pane of low gold light in a white frame, with a mullion cross
    const dawn = new MeshBasicMaterial({ toneMapped: false });
    own(dawn);
    dawn.color.set('#ffd2a2').multiplyScalar(1.5);
    const windowAt = (pz: number, side: 1 | -1): void => {
      const wx = side === 1 ? inX0 + 0.012 : inX1 - 0.012;
      const ry = side === 1 ? Math.PI / 2 : -Math.PI / 2;
      plane(dawn, 1.5, 1.9, wx, 1.95, pz, ry);
      // frame + cross
      const f = (w: number, h: number, dy: number, dz: number): void => {
        box(paint, 0.06, h, w, wx + side * 0.03, 1.95 + dy, pz + dz);
      };
      f(0.09, 2.08, 0, -0.795); f(0.09, 2.08, 0, 0.795);
      f(1.7, 0.09, 1.0, 0); f(1.7, 0.09, -1.0, 0);
      f(1.5, 0.05, 0, 0); f(0.05, 1.9, 0, 0);
    };
    for (const pz of [z - 1.4, z + 2.4]) { windowAt(pz, 1); windowAt(pz, -1); }
    for (const side of [1, -1] as const) {
      const wl = new PointLight('#ffc48a', 3.2, 9, 1.6);
      wl.position.set(side === 1 ? inX0 + 1.0 : inX1 - 1.0, 1.9, z + 0.5);
      this.group.add(wl);
    }

    // a walnut desk facing the door, brass pulls, leather chair behind it
    const walnut = woodMaps({ boards: 1, base: [116, 80, 56], seed: 55, roughness: 0.36, normal: 1.1 });
    own(walnut.map, walnut.normalMap, walnut.roughnessMap);
    const deskTop = new MeshStandardMaterial({
      map: walnut.map, normalMap: walnut.normalMap, roughnessMap: walnut.roughnessMap, roughness: 1, envMapIntensity: 0.9,
    });
    const deskDark = new MeshStandardMaterial({
      map: walnut.map, normalMap: walnut.normalMap, roughnessMap: walnut.roughnessMap, roughness: 1, color: '#a68e79',
    });
    const brass = new MeshStandardMaterial({ color: '#c09a5e', roughness: 0.3, metalness: 1 });
    own(deskTop, deskDark, brass);
    box(deskTop, 4.2, 0.09, 2.2, x, DESK_TOP, z + 2.1);
    box(deskDark, 4.2, 0.12, 2.2, x, DESK_TOP - 0.1, z + 2.1);
    box(deskDark, 0.14, 0.62, 2.0, x - 1.95, DESK_TOP - 0.46, z + 2.1);
    box(deskDark, 0.14, 0.62, 2.0, x + 1.95, DESK_TOP - 0.46, z + 2.1);
    box(deskDark, 3.8, 0.4, 0.05, x, DESK_TOP - 0.3, z + 3.05);
    box(deskDark, 1.1, 0.52, 1.8, x + 1.3, DESK_TOP - 0.3, z + 2.15); // drawer unit
    box(brass, 0.4, 0.03, 0.03, x + 1.3, DESK_TOP - 0.2, z + 1.23);
    box(brass, 0.4, 0.03, 0.03, x + 1.3, DESK_TOP - 0.45, z + 1.23);

    const leather = leatherMaps([104, 62, 38], 57);
    own(leather.map, leather.normalMap, leather.roughnessMap!);
    const seat = new MeshStandardMaterial({ map: leather.map, normalMap: leather.normalMap, roughnessMap: leather.roughnessMap, roughness: 1 });
    own(seat);
    const chair = new Group();
    chair.position.set(x + 0.2, 0.09, z + 3.9);
    chair.rotation.y = Math.PI + 0.15;
    const cp = (m: MeshStandardMaterial, w: number, h: number, d: number, px: number, py: number, pz: number): void => {
      const mesh = new Mesh(new BoxGeometry(w, h, d), m);
      mesh.position.set(px, py, pz);
      chair.add(mesh);
      own(mesh.geometry);
    };
    cp(seat, 0.9, 0.16, 0.9, 0, 0.55, 0);
    cp(seat, 0.9, 1.0, 0.14, 0, 1.1, -0.42);
    cp(seat, 0.14, 0.3, 0.7, -0.5, 0.78, 0);
    cp(seat, 0.14, 0.3, 0.7, 0.5, 0.78, 0);
    cp(brass, 0.1, 0.5, 0.1, 0, 0.25, 0);
    cp(brass, 0.8, 0.06, 0.1, 0, 0.04, 0);
    cp(brass, 0.1, 0.06, 0.8, 0, 0.04, 0);
    add(chair);

    // the laptop: the Blender model, hinge at the back of the desk, display toward the door. Its
    // display shows a mail client that waits, and only reads EMAIL RECEIVED once the dart is inside
    // (see `update`): two canvases, swapped by flight time
    this.screens = arrivalScreens();
    own(this.screens.idle, this.screens.received);
    const screenMaterial = new MeshStandardMaterial({
      map: this.screens.idle,
      emissiveMap: this.screens.idle,
      emissive: '#ffffff',
      emissiveIntensity: IDLE_GLOW,
      roughness: 0.25,
    });
    this.screenMaterial = screenMaterial;
    own(screenMaterial);
    const laptop: Laptop = createLaptop({ screen: screenMaterial, tilt: 0.18, tier: 'high' });
    laptop.group.position.set(x - 0.5, DESK_TOP + 0.045, z + 2.25);
    laptop.group.rotation.y = Math.PI / 2; // the base runs out toward the door (-z)
    add(laptop.group);
    own(laptop);
    this.screenLight = new PointLight('#9be8ff', 0, 6, 2);
    this.screenLight.position.set(x - 0.5, DESK_TOP + 0.7, z + 1.4);
    add(this.screenLight);

    // a brass desk lamp with a green shade: the warm key light of the room
    const enamel = new MeshStandardMaterial({ color: '#27503f', roughness: 0.32, metalness: 0.35, side: DoubleSide });
    const bulbGlow = new MeshStandardMaterial({ color: '#fff1d6', emissive: '#ffd49a', emissiveIntensity: 1.5 });
    own(enamel, bulbGlow);
    const lx = x + 1.7;
    const lz = z + 2.7;
    const lampBase = new Mesh(new CylinderGeometry(0.16, 0.19, 0.04, 24), brass);
    lampBase.position.set(lx, DESK_TOP + 0.065, lz);
    const lampStem = new Mesh(new CylinderGeometry(0.022, 0.022, 0.62, 8), brass);
    lampStem.position.set(lx, DESK_TOP + 0.38, lz);
    const lampShade = new Mesh(new CylinderGeometry(0.07, 0.24, 0.3, 28, 1, true), enamel);
    lampShade.position.set(lx, DESK_TOP + 0.74, lz);
    const lampBulb = new Mesh(new SphereGeometry(0.07, 12, 10), bulbGlow);
    lampBulb.position.set(lx, DESK_TOP + 0.68, lz);
    add(lampBase); add(lampStem); add(lampShade); add(lampBulb);
    own(lampBase.geometry, lampStem.geometry, lampShade.geometry, lampBulb.geometry);
    const deskLight = new PointLight('#ffcc8f', 3.4, 8, 1.6);
    deskLight.position.set(lx, DESK_TOP + 0.6, lz - 0.1);
    add(deskLight);

    // a warm ceiling bounce, and a pair of pendants over the desk
    const roomLight = new PointLight('#ffd9a8', 6.5, 14, 1.6);
    roomLight.position.set(x, 2.9, z + 0.6);
    add(roomLight);
    for (const px of [-1.3, 1.3]) {
      const cord = new Mesh(new CylinderGeometry(0.01, 0.01, 0.9, 6), paint);
      cord.position.set(x + px, H - 0.45, z + 2.2);
      const dome = new Mesh(new CylinderGeometry(0.05, 0.3, 0.26, 24, 1, true), enamel);
      dome.position.set(x + px, H - 1.0, z + 2.2);
      const glow = new Mesh(new SphereGeometry(0.08, 10, 8), bulbGlow);
      glow.position.set(x + px, H - 1.04, z + 2.2);
      add(cord); add(dome); add(glow);
      own(cord.geometry, dome.geometry, glow.geometry);
    }

    // a wall of books on the right, a framed picture or two, a clock, a plant
    const shelfWood = new MeshStandardMaterial({
      map: walnut.map, normalMap: walnut.normalMap, roughnessMap: walnut.roughnessMap, roughness: 1, color: '#9a8470',
    });
    const spineMap = bookSpineTexture();
    const books = new MeshStandardMaterial({ map: spineMap, roughness: 0.74 });
    own(shelfWood, spineMap, books);
    const spineCell = (g: BoxGeometry, cell: number): BoxGeometry => {
      const uv = g.attributes.uv as BufferAttribute;
      const step = 1 / BOOK_SPINE_CELLS;
      const inset = step * 0.03;
      const span = step - inset * 2;
      const cx = (cell % BOOK_SPINE_CELLS) * step + inset;
      const cy = Math.floor(cell / BOOK_SPINE_CELLS) * step + inset;
      for (let v = 0; v < uv.count; v++) uv.setXY(v, cx + uv.getX(v) * span, cy + uv.getY(v) * span);
      return g;
    };
    const shelfX = inX1 - 0.3;
    const shelfZ = z - 1.2;
    // an open bookcase: a back, two ends and a top, so the books on its boards show
    box(shelfWood, 0.04, 3.0, 3.4, shelfX + 0.23, 0.09 + 1.5, shelfZ);
    box(shelfWood, 0.5, 3.0, 0.06, shelfX, 0.09 + 1.5, shelfZ - 1.7);
    box(shelfWood, 0.5, 3.0, 0.06, shelfX, 0.09 + 1.5, shelfZ + 1.7);
    box(shelfWood, 0.56, 0.06, 3.5, shelfX, 0.09 + 3.0, shelfZ);
    for (let row = 0; row < 5; row++) {
      const y = 0.1 + row * 0.62 + 0.03;
      box(shelfWood, 0.5, 0.05, 3.4, shelfX, y + 0.02, shelfZ);
      let zz = shelfZ - 1.55;
      let i = 0;
      while (zz < shelfZ + 1.4) {
        const wd = 0.1 + ((row * 7 + i) % 4) * 0.035;
        const th = 0.34 + ((row * 5 + i) % 3) * 0.07;
        const dp = 0.3 + ((row * 3 + i) % 3) * 0.03;
        const book = new Mesh(spineCell(new BoxGeometry(dp, th, wd), (row * 5 + i * 3) % (BOOK_SPINE_CELLS * BOOK_SPINE_CELLS)), books);
        book.position.set(shelfX - 0.05 - (0.3 - dp) / 2 + 0.02, y + 0.05 + th / 2, zz + wd / 2);
        add(book);
        own(book.geometry);
        zz += wd + 0.012;
        i++;
        if (i % 11 === 0) zz += 0.25; // a gap now and then
      }
    }
    const frameWood = new MeshStandardMaterial({
      map: walnut.map, normalMap: walnut.normalMap, roughnessMap: walnut.roughnessMap, roughness: 1, color: '#8f7258',
    });
    const mat = new MeshStandardMaterial({ color: '#efe6d2', roughness: 0.9 });
    own(frameWood, mat);
    ([[-2.4, 2.35, 0], [2.6, 2.3, 1]] as const).forEach(([dx, fy, variant]) => {
      const art = frameArtTexture(variant);
      const artMat = new MeshStandardMaterial({ map: art, roughness: 0.8 });
      own(art, artMat);
      const fz = inZ1 - 0.06;
      box(frameWood, 1.5, 1.8, 0.06, x + dx, fy, fz);
      plane(mat, 1.34, 1.64, x + dx, fy, fz - 0.034, Math.PI);
      plane(artMat, 1.0, 1.3, x + dx, fy, fz - 0.036, Math.PI);
    });
    const clockFace = new Mesh(new CylinderGeometry(0.4, 0.4, 0.05, 32), new MeshStandardMaterial({ color: '#f0e9d8', roughness: 0.5 }));
    clockFace.rotation.z = Math.PI / 2;
    clockFace.position.set(inX0 + 0.05, 2.7, z + 0.5);
    add(clockFace);
    own(clockFace.geometry, clockFace.material as MeshStandardMaterial);

    // the plant is the same potted plant as the study's, streamed in after first paint
    new GLTFLoader().load(asset('/models/potted_plant_04.glb'), (gltf) => {
      const s = gltf.scene;
      const bb = new Box3().setFromObject(s);
      const size = bb.getSize(new Vector3());
      s.scale.setScalar(1.5 / Math.max(size.y, 1e-3));
      bb.setFromObject(s);
      s.position.set(inX0 + 0.8, 0.09 - bb.min.y, z + 4.2);
      this.group.add(s);
      requestCompile(s);
    });
  }

  /**
   * The jet that has just landed ahead of the dart: it rolls out down the runway on the
   * centreline braking hard, then turns off onto the taxiway toward the apron and creeps to a
   * stop. A pure function of t (position on a fixed curve, eased out), so it scrubs both ways.
   */
  private flyDeparture(t: number, time: number): void {
    const u = MathUtils.clamp((t - 0.88) / (1.0 - 0.88), 0, 1);
    // distance along the route, braking: fast at first, then slower and slower
    const s = 1 - Math.pow(1 - u, 3);
    const route = this.route;
    const p = route.getPointAt(s);
    const tan = route.getTangentAt(Math.min(s, 0.999));
    this.departing.group.position.set(p.x, 0.012, this.group.position.z + p.z);
    this.departing.group.rotation.y = Math.atan2(-tan.z, tan.x);
    // the nose dips a touch under braking, and recovers as it slows
    const brake = Math.pow(1 - u, 2);
    this.departing.body.rotation.z = -0.02 * brake;
    this.departing.body.position.set(0, AIRLINER.wheelDrop, 0);
    this.departing.rollAndGear(route.getLength() * s, 0);
    this.departing.blink(time);
    this.parked.blink(time + 0.4);
  }

  private ensureOffice(): void {
    if (this.officeBuilt) return;
    this.officeBuilt = true;
    this.buildArrivalOffice();
  }

  update(t: number, time: number): void {
    if (!this.group.visible) return;
    this.ensureOffice();
    this.edgeLightMaterial.emissiveIntensity = 1.4 + Math.sin(time * 1.6) * 0.4;

    // the rabbit: one bright pulse racing toward the threshold, looping
    const sweep = (time * 1.4) % 1;
    for (let i = 0; i < this.rabbitMaterials.length; i++) {
      const pos = 1 - i / this.rabbitMaterials.length; // far → near
      const d = Math.abs(sweep - pos);
      this.rabbitMaterials[i]!.emissiveIntensity = Math.max(0, 1 - d * 9) * 5;
    }

    this.windsock.rotation.y = Math.sin(time * 0.7) * 0.4;
    this.flyDeparture(t, time);

    // the mail lands: the screen wakes as the dart reaches it, then holds
    // The waiting inbox burns steadily; the screen wakes brighter as the dart reaches it, and the
    // mail reads EMAIL RECEIVED only once the dart is in (a flash marks the change)
    const arrive = MathUtils.smoothstep(t, 0.978, RECEIVED_AT);
    const done = t >= RECEIVED_AT ? 1 : 0;
    const flash = done ? Math.exp(-(t - RECEIVED_AT) * 260) : 0;
    const ping = arrive * (1 + Math.sin(time * 3.4) * 0.05);
    const want = done ? 'received' : 'idle';
    if (this.screenMaterial && this.screens && want !== this.showing) {
      this.showing = want;
      this.screenMaterial.map = this.screenMaterial.emissiveMap = this.screens[want];
      this.screenMaterial.needsUpdate = true;
    }
    if (this.screenMaterial) this.screenMaterial.emissiveIntensity = IDLE_GLOW + ping * 0.6 + done * 0.5 + flash * 2.4;
    if (this.screenLight) this.screenLight.intensity = ping * 2.0 + done * 1.6 + flash * 4;

    // the printed reply slides out of the tray once the mail is in
    const slide = MathUtils.smoothstep(t, 0.985, 0.999);
    this.reply.position
      .copy(this.replyHome)
      .add(new Vector3(0.1 * slide, 0, -0.75 * slide));
    this.reply.rotation.z = -0.12 - slide * 0.22;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
