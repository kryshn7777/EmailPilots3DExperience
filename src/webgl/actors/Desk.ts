import {
  Box3,
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  PointLight,
  Points,
  PointsMaterial,
  Quaternion,
  SphereGeometry,
  SpotLight,
  TorusGeometry,
  Vector3,
  DoubleSide,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { glowTexture, laptopScreenTexture, letterTexture } from '../bake/CanvasTextures';
import { CURTAIN_WALL, curtainWallMaps } from '../bake/RoomTextures';
import { asset } from '../asset';
import { createLaptop } from './Laptop';
import { requestCompile } from '../warm';
import { Kit, additiveKeepAlpha, bevelBox, glowCard, helix, lathe, rod, skipInNormalPass, tube } from './StudyKit';
import { studyMaterials, type Dispose } from './StudyMaterials';
import { buildRoom, ROOM, type Room } from './StudyRoom';
import { FLOOR_Y, buildChair, buildFurniture, type Furniture } from './StudyFurniture';
import { TOP, buildDeskProps, type DeskProps } from './StudyProps';

/**
 * CH1: the night study. The laptop mid-send is the story's launchpad: the flight path starts at
 * its screen and the paper planes fly out of it.
 *
 * A lived-in room rather than an office cell, drawn the way an architect would: herringbone oak
 * under a wool rug, sage plaster over raised-panel wainscot with a chair rail, picture rail and
 * cove cornice, a casement window with a deep reveal, drapes and a library of books; a walnut
 * desk with a leather inlay, drawers and brass; and one tungsten lamp as the key light (it casts
 * real shadows on HIGH) with a warm bounce from the ceiling and cool light from the window and the
 * laptop. The room's architecture is in StudyRoom, its furniture in StudyFurniture and the things
 * on the desk in StudyProps; all static geometry is baked by material (StudyKit) so the whole
 * study is a few dozen draw calls.
 */
export class Desk {
  readonly group = new Group();
  readonly lamp: SpotLight;
  /** the cradle's moving balls (its frame is baked with everything else) */
  private cradle = new Group();
  private cradleArms: Group[] = [];

  private screenLight: PointLight;
  private dust: Points;
  private dustBase: Float32Array;
  private dustGeometry = new BufferGeometry();
  private dustMotes = 0;
  private lampPos = new Vector3();
  private lampAxis = new Vector3();
  private disposables: Dispose[] = [];
  private room: Room;
  private furniture: Furniture;
  private props: DeskProps;
  /** triangles baked into the study's merged meshes */
  readonly triangles: number;

  constructor(origin: Vector3, dustCount: number, rand: () => number, private shadows = false) {
    this.group.position.copy(origin);
    const tier = this.shadows ? 'high' : 'low';
    const high = this.shadows;
    const own = this.disposables;
    const keep = <T extends Dispose>(x: T): T => { own.push(x); return x; };
    const m = studyMaterials(tier, own);
    const kit = new Kit();

    // the room, its furniture, and the things on the desk
    this.room = buildRoom(kit, this.group, m, own, tier);
    this.furniture = buildFurniture(kit, this.group, m, own, tier);
    buildChair(kit, m, high);
    this.props = buildDeskProps(kit, this.group, m, own, tier);

    // ——— the tower this floor belongs to: a glass curtain wall dropping from the sill into the overcast ———
    const facade = curtainWallMaps(19);
    own.push(facade.map, facade.emissiveMap);
    const towerSkin = keep(new MeshStandardMaterial({
      map: facade.map, emissive: '#ffffff', emissiveMap: facade.emissiveMap, emissiveIntensity: 0.9,
      roughness: 0.22, metalness: 0.65, envMapIntensity: 1.3,
    }));
    const ledge = keep(new MeshStandardMaterial({ color: '#232a3c', roughness: 0.4, metalness: 0.6 }));
    const tw = CURTAIN_WALL.bays * CURTAIN_WALL.bayW;
    const th = CURTAIN_WALL.floors * CURTAIN_WALL.floorH;
    /** lays the curtain-wall tile over every face of a box at its real size, so bays stay square */
    const clad = (g: BoxGeometry, w: number, h: number, d: number): BoxGeometry => {
      const uv = g.attributes.uv!;
      const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
      for (let f = 0; f < 6; f++) {
        for (let k = 0; k < 4; k++) {
          const i = f * 4 + k;
          uv.setXY(i, uv.getX(i) * dims[f]![0]! / tw, uv.getY(i) * dims[f]![1]! / th);
        }
      }
      return g;
    };
    const SKIRT_X0 = -9.1;
    const SKIRT_X1 = 6.72;
    const skirtW = SKIRT_X1 - SKIRT_X0;
    const skirt = new Mesh(clad(new BoxGeometry(skirtW, 26, 12.6), skirtW, 26, 12.6), towerSkin);
    skirt.position.set((SKIRT_X0 + SKIRT_X1) / 2, -14.4, 0.5);
    const sill = new Mesh(new BoxGeometry(skirtW + 0.3, 0.35, 12.9), ledge);
    sill.position.set((SKIRT_X0 + SKIRT_X1) / 2 + 0.15, -1.52, 0.5);
    this.group.add(skirt, sill);
    own.push(skirt.geometry, sill.geometry);

    // ——— the window wall: 0.24 thick, plaster inside, curtain wall outside, the opening between ———
    // one quad per face (the old boxes drew six materials each); the reveals are the casing's liners
    const { winZ0, winZ1, winY0, winY1, zBack, zFront, ceil } = ROOM;
    const planar = (g: BufferGeometry, su: number, sv: number): BufferGeometry => {
      const pos = g.attributes.position!;
      const uv = g.attributes.uv!;
      for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getZ(i) * su, pos.getY(i) * sv);
      return g;
    };
    const wallQuad = (z0: number, z1: number, y0: number, y1: number, x: number, outside: boolean): void => {
      const g = new PlaneGeometry(z1 - z0, y1 - y0);
      g.rotateY(outside ? Math.PI / 2 : -Math.PI / 2);
      g.translate(x, (y0 + y1) / 2, (z0 + z1) / 2);
      if (outside) planar(g, 1 / tw, 1 / th);
      else planar(g, 1 / m.plasterTile, 1 / m.plasterTile);
      if (outside) {
        const mesh = new Mesh(g, towerSkin);
        this.group.add(mesh);
        own.push(g);
      } else {
        kit.add(g, m.plaster);
      }
    };
    for (const outside of [false, true]) {
      const x = outside ? 6.72 : ROOM.x1;
      const top = outside ? 5.7 : ceil;
      const bot = outside ? -1.4 : FLOOR_Y;
      wallQuad(zBack, winZ0, bot, top, x, outside);
      wallQuad(winZ1, zFront, bot, top, x, outside);
      wallQuad(winZ0, winZ1, bot, winY0, x, outside);
      wallQuad(winZ0, winZ1, winY1, top, x, outside);
    }

    // ——— the laptop mid-send: its screen faces +X, into the flight line ———
    const displayMat = keep(new MeshBasicMaterial({ map: laptopScreenTexture() }));
    const laptop = createLaptop({ screen: displayMat, tilt: 0.24, tier });
    laptop.group.position.set(-0.93, TOP, 0);
    this.group.add(laptop.group);
    own.push(laptop);
    this.screenLight = new PointLight('#9fc4ff', 1.1, 5, 2);
    this.screenLight.position.set(0.5, 0.5, 0);
    this.group.add(this.screenLight);

    // the letter on the desk, in the lamp pool
    const paper = keep(new MeshStandardMaterial({ map: letterTexture(), roughness: 0.9 }));
    kit.add(new PlaneGeometry(0.92, 1.3).rotateX(-Math.PI / 2), paper, { x: 2.6, y: TOP + 0.001, z: -1.55, ry: 0.5 });
    // stacked sheets and a pen resting across them
    for (let i = 0; i < 3; i++) kit.add(new BoxGeometry(0.78, 0.014, 1.05), m.paper, { x: 3.05, y: TOP + 0.007 + i * 0.015, z: -0.5, ry: 0.12 + i * 0.09 });
    const penMat = keep(new MeshStandardMaterial({ color: '#1d2a4a', roughness: 0.3, metalness: 0.4 }));
    kit.add(new CylinderGeometry(0.018, 0.018, 0.5, 8).rotateX(Math.PI / 2).rotateY(0.5), penMat, { x: 3.0, y: TOP + 0.06, z: -0.42 });

    // ——— CC0 prop models (Poly Haven), streamed in after first paint; the desk reads complete without them ———
    const loader = new GLTFLoader();
    const prop = (url: string, targetH: number, x: number, z: number, rotY: number): void => {
      loader.load(url, (gltf) => {
        const s = gltf.scene;
        const box = new Box3().setFromObject(s);
        const size = box.getSize(new Vector3());
        s.scale.setScalar(targetH / Math.max(size.y, 1e-3));
        box.setFromObject(s);
        s.position.set(x, TOP - box.min.y, z);
        s.rotation.y = rotY;
        this.group.add(s);
        this.lit(s);
        requestCompile(s);
      });
    };
    prop(asset('/models/potted_plant_04.glb'), 0.95, -2.85, -1.4, 0.6);
    prop(asset('/models/ceramic_vase_01.glb'), 0.62, 2.0, -0.85, 0.2);
    // paperwork is FLAT, so it fits by footprint, not height
    const flatProp = (url: string, targetW: number, x: number, z: number, rotY: number): void => {
      loader.load(url, (gltf) => {
        const s = gltf.scene;
        const box = new Box3().setFromObject(s);
        const size = box.getSize(new Vector3());
        s.scale.setScalar(targetW / Math.max(size.x, size.z, 1e-3));
        box.setFromObject(s);
        s.position.set(x, TOP - box.min.y, z);
        s.rotation.y = rotY;
        this.group.add(s);
        this.lit(s);
        requestCompile(s);
      });
    };
    flatProp(asset('/models/binder_notebook.glb'), 0.62, -2.05, -1.2, 0.22);
    flatProp(asset('/models/binder_notebook.glb'), 0.62, -1.4, -1.15, -0.14);
    flatProp(asset('/models/clipboard.glb'), 0.7, 3.05, 1.18, 1.15);

    // ——— Newton's cradle: a walnut base on brass feet, steel posts and rails; only the balls move ———
    {
      const o = kit.at({ x: 2.95, y: TOP, z: 0.42, ry: -0.5, s: 1.45 });
      o.add(bevelBox(0.46, 0.03, 0.3, 0.008), m.walnut, { y: 0.015 });
      for (const sx of [-0.2, 0.2]) {
        for (const sz of [-0.12, 0.12]) {
          o.add(rod(new Vector3(sx, 0.03, sz), new Vector3(sx, 0.35, sz), 0.01, 8), m.steel);
          o.add(new SphereGeometry(0.0125, 8, 6), m.steel, { x: sx, y: 0.355, z: sz });
          o.add(new CylinderGeometry(0.018, 0.022, 0.012, 10), m.brass, { x: sx, y: 0.034, z: sz });
        }
        o.add(new SphereGeometry(0.02, 8, 6), m.brass, { x: sx * 1.12, y: 0.0, z: 0.13 });
        o.add(new SphereGeometry(0.02, 8, 6), m.brass, { x: sx * 1.12, y: 0.0, z: -0.13 });
      }
      for (const sz of [-0.12, 0.12]) o.add(rod(new Vector3(-0.2, 0.35, sz), new Vector3(0.2, 0.35, sz), 0.009, 8), m.steel);
      this.cradle.position.set(2.95, TOP, 0.42);
      this.cradle.rotation.y = -0.5;
      this.cradle.scale.setScalar(1.45);
      this.group.add(this.cradle);
      const cordMat = keep(new MeshStandardMaterial({ color: '#8d94a6', roughness: 0.6 }));
      const ballGeometry = keep(new SphereGeometry(0.037, 18, 14));
      const cordGeometry = keep(new CylinderGeometry(0.0035, 0.0035, 0.23, 4));
      for (let i = 0; i < 5; i++) {
        const arm = new Group();
        arm.position.set(-0.148 + i * 0.074, 0.35, 0);
        this.cradle.add(arm);
        this.cradleArms.push(arm);
        for (const sz of [-0.12, 0.12]) {
          const cord = new Mesh(cordGeometry, cordMat);
          cord.position.set(0, -0.115, sz / 2);
          cord.rotation.x = sz > 0 ? -0.44 : 0.44;
          arm.add(cord);
        }
        const ball = new Mesh(ballGeometry, m.steel);
        ball.position.y = -0.228;
        arm.add(ball);
      }
    }

    // ——— flowers rising from the vase: stems, ray-petalled heads and a pair of leaves each ———
    {
      const stemMat = keep(new MeshStandardMaterial({ color: '#3e5a3a', roughness: 0.8, side: DoubleSide }));
      const FLOWERS: { tilt: number; lean: number; h: number; color: string }[] = [
        { tilt: 0.0, lean: -0.22, h: 0.52, color: '#d96a7b' }, { tilt: 2.1, lean: 0.28, h: 0.42, color: '#e8b13c' },
        { tilt: 4.2, lean: 0.16, h: 0.6, color: '#c37ad9' }, { tilt: 1.2, lean: 0.34, h: 0.34, color: '#f0e6d2' },
      ];
      for (const f of FLOWERS) {
        const head = keep(new MeshStandardMaterial({ color: f.color, emissive: f.color, emissiveIntensity: 0.12, roughness: 0.7, side: DoubleSide }));
        const o = kit.at({ x: 2.0, y: 0.38, z: -0.85, ry: f.tilt, rz: f.lean });
        o.add(rod(new Vector3(0, 0, 0), new Vector3(0, f.h, 0), 0.013, 6, 0.016), stemMat);
        for (let p = 0; p < (high ? 9 : 6); p++) {
          const a = (p / (high ? 9 : 6)) * Math.PI * 2;
          o.add(new SphereGeometry(1, 8, 6).scale(0.075, 0.012, 0.028), head, { x: Math.cos(a) * 0.06, y: f.h + 0.03, z: Math.sin(a) * 0.06, ry: -a, rz: 0.25 });
        }
        o.add(new SphereGeometry(0.03, 8, 6), m.ink, { y: f.h + 0.035 });
        for (const s of [-1, 1]) o.add(new SphereGeometry(1, 8, 6).scale(0.09, 0.01, 0.03), stemMat, { x: s * 0.07, y: f.h * 0.42, rz: s * 0.5 });
      }
    }

    // ——— pendant over the desk: an enamel dome on a cord, a bare warm bulb inside ———
    const PX = 0.9;
    const PZ = -0.3;
    kit.add(lathe([[0.5, 0], [0.495, 0.02], [0.47, 0.12], [0.4, 0.22], [0.28, 0.3], [0.15, 0.34], [0.06, 0.355], [0, 0.36]], high ? 40 : 20), m.enamel, { x: PX, y: 4.04, z: PZ });
    kit.add(lathe([[0, 0.35], [0.06, 0.345], [0.14, 0.33], [0.27, 0.29], [0.39, 0.21], [0.46, 0.12], [0.49, 0.02]], high ? 40 : 20), m.enamelInner, { x: PX, y: 4.04, z: PZ });
    kit.add(new TorusGeometry(0.5, 0.012, 6, high ? 40 : 20).rotateX(Math.PI / 2), m.brass, { x: PX, y: 4.04, z: PZ });
    kit.add(lathe([[0.06, 0], [0.075, 0.02], [0.04, 0.05], [0.04, 0.12], [0.06, 0.13], [0.06, 0.16]], 14), m.brass, { x: PX, y: 4.37, z: PZ });
    kit.add(rod(new Vector3(PX, 4.52, PZ), new Vector3(PX, ceil, PZ), 0.014, 6), m.ink);
    const pendantBulb = new Mesh(new SphereGeometry(0.11, 16, 12), m.bulb);
    pendantBulb.position.set(PX, 4.0, PZ);
    pendantBulb.userData.glow = true;
    this.group.add(pendantBulb);
    own.push(pendantBulb.geometry);
    const panelLight = new PointLight('#ffd3a0', 9, 14, 1.6);
    panelLight.position.set(PX, 3.7, PZ);
    this.group.add(panelLight);
    this.group.add(new HemisphereLight('#ffe3c2', '#5c3d27', 0.5));

    // ——— the desk lamp: a weighted brass base, a counterbalanced parallelogram arm with springs, and an enamel shade that glows ———
    const J0 = new Vector3(1.8, TOP + 0.13, -1.85);
    const J1 = new Vector3(1.62, 0.64, -1.8);
    const J2 = new Vector3(1.22, 0.95, -1.48);
    kit.add(lathe([[0, 0], [0.21, 0], [0.22, 0.015], [0.21, 0.04], [0.14, 0.075], [0.07, 0.11], [0.05, 0.135], [0, 0.135]], high ? 36 : 20), m.brass, { x: J0.x, y: TOP, z: J0.z });
    kit.add(new CylinderGeometry(0.21, 0.21, 0.006, 24), m.black, { x: J0.x, y: TOP + 0.003, z: J0.z });
    const arm = (a: Vector3, b: Vector3, spring: boolean): void => {
      const dir = b.clone().sub(a).normalize();
      const off = new Vector3().crossVectors(dir, new Vector3(0, 0, 1)).normalize().multiplyScalar(0.034);
      for (const s of [-1, 1]) kit.add(rod(a.clone().addScaledVector(off, s), b.clone().addScaledVector(off, s), 0.017, 8), m.brass);
      if (spring) kit.add(helix(a.clone().addScaledVector(dir, 0.1).addScaledVector(off, 0.0), a.clone().addScaledVector(dir, 0.1 + a.distanceTo(b) * 0.7), 0.03, 22, 0.0045), m.steel);
    };
    arm(J0, J1, true);
    arm(J1, J2, false);
    for (const [j, r] of [[J0, 0.05], [J1, 0.055], [J2, 0.055]] as const) {
      kit.add(new SphereGeometry(r, 14, 10), m.brass, { x: j.x, y: j.y, z: j.z });
      kit.add(new CylinderGeometry(r * 0.55, r * 0.55, 0.13, 12).rotateX(Math.PI / 2), m.brassAged, { x: j.x, y: j.y, z: j.z });
    }
    // aimed at the middle of the desk, where the planes' first fold will lie
    const aim = new Vector3(1.0, TOP, -0.7);
    const toAim = aim.clone().sub(J2).normalize();
    const shadeAt = new Matrix4().compose(
      J2.clone().addScaledVector(toAim, 0.17),
      new Quaternion().setFromUnitVectors(new Vector3(0, -1, 0), toAim),
      new Vector3(1, 1, 1),
    );
    const shadeKit = kit.at(shadeAt);
    shadeKit.add(lathe([[0.27, -0.17], [0.274, -0.15], [0.25, -0.1], [0.2, -0.02], [0.14, 0.07], [0.08, 0.14], [0.04, 0.17], [0, 0.18]], high ? 40 : 22), m.enamel);
    shadeKit.add(lathe([[0, 0.175], [0.04, 0.165], [0.078, 0.135], [0.138, 0.065], [0.198, -0.025], [0.246, -0.1], [0.266, -0.15]], high ? 40 : 22), m.enamelInner);
    shadeKit.add(new TorusGeometry(0.272, 0.008, 6, high ? 40 : 22).rotateX(Math.PI / 2), m.brass, { y: -0.16 });
    shadeKit.add(lathe([[0.035, 0.17], [0.05, 0.19], [0.03, 0.23], [0.02, 0.26]], 12), m.brass);
    shadeKit.add(new SphereGeometry(0.022, 8, 6), m.brass, { y: 0.27 });
    // a little pull chain hanging from the rim
    for (let i = 0; i < 6; i++) shadeKit.add(new SphereGeometry(0.006, 5, 4), m.brass, { x: 0.12, y: -0.18 - i * 0.017, z: 0.2 });
    // its cord runs off the back of the desk
    kit.add(tube([[J0.x, TOP + 0.01, J0.z - 0.1], [1.9, TOP + 0.004, -2.05], [1.97, -0.3, -2.3], [2.0, -1.0, -2.45]], 0.007, 14, 5), m.ink);
    const lampBulb = new Mesh(new SphereGeometry(0.075, 16, 12), m.bulb);
    lampBulb.position.copy(J2).addScaledVector(toAim, 0.2);
    lampBulb.userData.glow = true; // neither merged nor casting: the lamp's own light sits inside it
    this.group.add(lampBulb);
    own.push(lampBulb.geometry);
    // the glow of the bulb through the open shade, a soft flare toward the viewer
    const flare = glowCard(keep(glowTexture()), '#ffc98a', 0.45);
    flare.mesh.position.copy(lampBulb.position).addScaledVector(toAim, 0.12);
    flare.mesh.scale.setScalar(0.55);
    this.group.add(flare.mesh);
    own.push(flare.material, flare.mesh.geometry);

    this.lamp = new SpotLight('#ffcc8f', 10, 0, 0.82, 0.6, 1.5);
    this.lamp.position.copy(lampBulb.position);
    this.lamp.target.position.copy(aim);
    this.group.add(this.lamp, this.lamp.target);
    if (this.shadows) {
      this.lamp.castShadow = true;
      this.lamp.shadow.mapSize.set(1024, 1024);
      this.lamp.shadow.camera.near = 0.2;
      this.lamp.shadow.camera.far = 9;
      this.lamp.shadow.bias = -0.0004;
      this.lamp.shadow.normalBias = 0.012;
      this.lamp.shadow.radius = 5;
    }

    // ——— a lamp on the credenza too: a ginger-jar body under a cream linen shade ———
    const ceramic = keep(new MeshStandardMaterial({ color: '#d9d2c2', roughness: 0.22 }));
    const linen = keep(new MeshStandardMaterial({ color: '#f1dfbd', emissive: '#ffc98a', emissiveIntensity: 0.85, roughness: 0.9, side: DoubleSide }));
    const TLX = 4.3; const TLZ = -3.1; const TLY = -0.34;
    kit.add(lathe([[0, 0], [0.12, 0], [0.18, 0.04], [0.23, 0.14], [0.24, 0.26], [0.2, 0.38], [0.11, 0.44], [0.08, 0.48], [0.1, 0.5], [0, 0.5]], high ? 32 : 18), ceramic, { x: TLX, y: TLY, z: TLZ });
    kit.add(new TorusGeometry(0.235, 0.012, 6, 28).rotateX(Math.PI / 2), m.brass, { x: TLX, y: TLY + 0.25, z: TLZ });
    kit.add(rod(new Vector3(TLX, TLY + 0.5, TLZ), new Vector3(TLX, TLY + 0.72, TLZ), 0.025, 8), m.brass);
    kit.add(new CylinderGeometry(0.2, 0.32, 0.36, high ? 32 : 18, 1, true), linen, { x: TLX, y: TLY + 0.8, z: TLZ });
    kit.add(new TorusGeometry(0.2, 0.006, 5, 28).rotateX(Math.PI / 2), m.brass, { x: TLX, y: TLY + 0.98, z: TLZ });
    const tableLight = new PointLight('#ffc98a', 2.6, 9, 1.7);
    tableLight.position.set(TLX, TLY + 0.8, TLZ + 0.15);
    this.group.add(tableLight);

    // dusk light from the window side (cool, with a trace of the town's warmth): the counterpoint to all that tungsten
    const moon = new PointLight('#b8a6c6', 3.4, 22, 1.6);
    moon.position.set(3.5, 2.6, 2.5);
    this.group.add(moon);

    // ——— dust: motes that only show where light finds them (the lamp's cone, the window's shafts) ———
    this.lampPos.copy(lampBulb.position);
    this.lampAxis.copy(toAim);
    const positions = new Float32Array(dustCount * 3);
    for (let i = 0; i < dustCount; i++) {
      const window = i > dustCount * 0.7;
      positions[i * 3] = window ? 2.2 + rand() * 4 : -1.5 + rand() * 2.6;
      positions[i * 3 + 1] = window ? -0.6 + rand() * 3.4 : -0.1 + rand() * 1.2;
      positions[i * 3 + 2] = window ? -0.8 + rand() * 3.4 : -2.1 + rand() * 2.4;
    }
    this.dustBase = positions.slice();
    this.dustGeometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    this.dustGeometry.setAttribute('color', new Float32BufferAttribute(new Float32Array(dustCount * 3), 3));
    this.dustGeometry.computeBoundingSphere();
    const dustMaterial = additiveKeepAlpha(new PointsMaterial({
      map: glowTexture(), vertexColors: true, size: 0.045, transparent: true, depthWrite: false, toneMapped: false,
    }));
    this.dust = new Points(this.dustGeometry, dustMaterial);
    this.dust.frustumCulled = false;
    skipInNormalPass(this.dust);
    this.dust.userData.glow = true;
    this.group.add(this.dust);
    own.push(this.dustGeometry, dustMaterial);
    this.dustMotes = dustCount;

    // ——— ship everything baked, one mesh per material ———
    this.triangles = kit.triangles;
    kit.flush(this.group, own);
    this.lit(this.group);
  }

  /** On HIGH the lamp's shadows fall on everything in the room, and everything in it throws them. */
  private lit(root: Object3D): void {
    if (!this.shadows) return;
    root.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh || mesh.userData.glow) return;
      const mat = mesh.material as { userData?: { noShadow?: boolean } };
      if (mat.userData?.noShadow) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });
  }

  update(time: number): void {
    // live-screen flicker: the send is happening right now
    this.screenLight.intensity = 1.1 + Math.sin(time * 2.6) * 0.25;

    // Newton's cradle: only the end balls move, and only one at a time
    const beat = Math.sin(time * 2.9);
    const swing = 0.5 * Math.abs(beat) * (0.75 + 0.25 * Math.cos(time * 0.4));
    this.cradleArms[0]!.rotation.z = beat > 0 ? swing : 0;
    this.cradleArms[4]!.rotation.z = beat > 0 ? 0 : -swing;
    this.room.update(time);
    this.furniture.update(time);
    this.props.update(time);
    // each mote drifts, and glows only as much light as reaches it: bright inside the lamp's cone
    // (fading with distance down the beam), a faint warm glint in the window's shafts, black (so
    // invisible under additive blending) everywhere else
    const attr = this.dustGeometry.attributes.position!;
    const col = this.dustGeometry.attributes.color!;
    const arr = attr.array as Float32Array;
    const carr = col.array as Float32Array;
    const tanCone = Math.tan(0.82);
    for (let n = 0; n < this.dustMotes; n++) {
      const i = n * 3;
      const x = this.dustBase[i]! + Math.sin(time * 0.12 + i) * 0.12;
      const y = this.dustBase[i + 1]! + Math.sin(time * 0.07 + i * 1.7) * 0.08;
      const z = this.dustBase[i + 2]! + Math.sin(time * 0.09 + i * 0.6) * 0.06;
      arr[i] = x; arr[i + 1] = y; arr[i + 2] = z;
      const dx = x - this.lampPos.x; const dy = y - this.lampPos.y; const dz = z - this.lampPos.z;
      const along = dx * this.lampAxis.x + dy * this.lampAxis.y + dz * this.lampAxis.z;
      let b = 0;
      if (along > 0.15) {
        const px = dx - this.lampAxis.x * along; const py = dy - this.lampAxis.y * along; const pz = dz - this.lampAxis.z * along;
        const edge = Math.hypot(px, py, pz) / (along * tanCone);
        b = (1 - Math.min(Math.max((edge - 0.45) / 0.55, 0), 1)) / (1 + 0.45 * along * along);
      }
      const win = n > this.dustMotes * 0.7 ? 0.22 : 0;
      const twinkle = 0.7 + 0.3 * Math.sin(time * 1.3 + n * 1.9);
      const v = (b * 1.25 + win) * twinkle;
      carr[i] = v; carr[i + 1] = v * 0.84; carr[i + 2] = v * 0.62;
    }
    attr.needsUpdate = true;
    col.needsUpdate = true;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
