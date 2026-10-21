import {
  AdditiveBlending,
  Box3,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  PointLight,
  SphereGeometry,
  SpotLight,
  Quaternion,
  Points,
  PointsMaterial,
  TorusGeometry,
  Vector2,
  Vector3,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  BOOK_SPINE_CELLS,
  bookSpineTexture,
  frameArtTexture,
  glowTexture,
  laptopKeysTexture,
  laptopScreenTexture,
  letterTexture,
} from '../bake/CanvasTextures';
import {
  CURTAIN_WALL, WAINSCOT, curtainWallMaps, leatherMaps, plasterMaps, rugMaps, wainscotMaps, woodMaps,
  type SurfaceMaps,
} from '../bake/RoomTextures';
import { asset } from '../asset';
import { requestCompile } from '../warm';

/**
 * CH1: the night study. The laptop mid-send is the story's launchpad — the
 * flight path starts at its screen and the paper plane flies out of it.
 *
 * A lived-in room rather than an office cell: walnut desk and oak boards under
 * a wool rug, sage plaster over painted wainscot, leather and brass, with one
 * tungsten lamp as the key light (it casts real shadows on HIGH), a warm bounce
 * from the ceiling, and cool light from the window and the laptop for contrast.
 * The letter, coffee and dust motes sit in the lamp pool.
 */
export class Desk {
  readonly group = new Group();
  readonly lamp: SpotLight;
  /** kept out of the static merge — the end balls actually swing */
  private cradle = new Group();
  private cradleArms: Group[] = [];

  private screenLight: PointLight;
  private dust: Points;
  private dustBase: Float32Array;
  private dustGeometry = new BufferGeometry();
  private disposables: { dispose(): void }[] = [];

  constructor(origin: Vector3, dustCount: number, rand: () => number, private shadows = false) {
    this.group.position.copy(origin);

    // the desk is built below as an office slab (no GLB);
    // an interim invisible-thin top is unnecessary — props already float at
    // the exact height the table's top surface lands on (y −0.10)

    // the room: oak boards, plaster over painted wainscot, and the window wall the
    // flight exits through. One walnut drawing serves the desk, shelves, frames and cabinets.
    const walnut = woodMaps({ boards: 1, base: [116, 80, 56], seed: 21, roughness: 0.36, normal: 1.1 });
    this.disposables.push(walnut.map, walnut.normalMap, walnut.roughnessMap);
    const setRepeat = (m: SurfaceMaps, x: number, y: number): void => {
      for (const t of [m.map, m.normalMap, m.roughnessMap]) t?.repeat.set(x, y);
    };
    const surface = (m: SurfaceMaps, extra: ConstructorParameters<typeof MeshStandardMaterial>[0] = {}): MeshStandardMaterial => {
      this.disposables.push(m.map, m.normalMap);
      if (m.roughnessMap) this.disposables.push(m.roughnessMap);
      return new MeshStandardMaterial({
        map: m.map, normalMap: m.normalMap, ...(m.roughnessMap ? { roughnessMap: m.roughnessMap } : {}), roughness: 1, ...extra,
      });
    };
    // The room runs from the side wall (local x -10) to the window wall's outer
    // face (6.72). These planes used to run on to x = 16, 9 units out into the open
    // air past the window: a ghost wall, ceiling trim and floor standing in the sky
    // that the checklist board (and anything else out there) collided with.
    const ROOM_X0 = -10;
    const ROOM_X1 = 6.72;
    const roomW = ROOM_X1 - ROOM_X0;
    const roomX = (ROOM_X0 + ROOM_X1) / 2;
    const FLOOR_Y = -1.28;

    // sage-green plaster, warm enough that lamplight turns it golden, not grey
    const plaster = plasterMaps([172, 184, 158], 11);
    setRepeat(plaster, roomW / 3.4, 6.5 / 3.4);
    const wall = surface(plaster, { roughness: 0.93, normalScale: new Vector2(0.55, 0.55) });
    // satin-finished oak: planks about a hand wide, long runs with the odd butt joint
    const oak = woodMaps({ boards: 6, base: [190, 138, 86], seed: 3, joints: 1, gap: 2.4, roughness: 0.46, normal: 2.8 });
    setRepeat(oak, roomW / 6.6, 18 / 3.3);
    const floorMat = surface(oak, { metalness: 0, envMapIntensity: 0.9 });
    this.disposables.push(wall, floorMat);
    const floor = new Mesh(new PlaneGeometry(roomW, 18), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(roomX, FLOOR_Y, 0);
    const backWall = new Mesh(new PlaneGeometry(roomW, 6.5), wall);
    backWall.position.set(roomX, 1.9, -3.7);
    const sideWall = new Mesh(new PlaneGeometry(18, 6.5), wall);
    sideWall.rotation.y = Math.PI / 2;
    sideWall.position.set(-4.6, 1.9, 0.6);
    // a plastered ceiling closes the room: it is what bounces the lamp back down
    const ceilingMat = new MeshStandardMaterial({ color: '#e9e1d0', roughness: 0.95 });
    const ceiling = new Mesh(new PlaneGeometry(roomW, 18), ceilingMat);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.set(roomX, 5.16, 0);
    this.group.add(floor, backWall, sideWall, ceiling);
    this.disposables.push(floor.geometry, backWall.geometry, sideWall.geometry, ceiling.geometry, ceilingMat);

    // the tower this floor belongs to: a glass curtain wall dropping from the sill into the
    // overcast, with lit offices. Without it the study reads as a box in the sky the moment
    // the flight turns and looks back at it. It ends at the window wall's outer face: it used
    // to run 7 units out past it, a black shelf the camera looked down on after leaving.
    const facade = curtainWallMaps(19);
    this.disposables.push(facade.map, facade.emissiveMap);
    const towerSkin = new MeshStandardMaterial({
      map: facade.map, emissive: '#ffffff', emissiveMap: facade.emissiveMap, emissiveIntensity: 0.9,
      roughness: 0.22, metalness: 0.65, envMapIntensity: 1.3,
    });
    const ledgeMaterial = new MeshStandardMaterial({ color: '#232a3c', roughness: 0.4, metalness: 0.6 });
    this.disposables.push(towerSkin, ledgeMaterial);
    /** lays the curtain-wall tile over every face of a box at its real size, so bays stay square */
    const clad = (g: BoxGeometry, w: number, h: number, d: number): BoxGeometry => {
      const uv = g.attributes.uv!;
      const tw = CURTAIN_WALL.bays * CURTAIN_WALL.bayW;
      const th = CURTAIN_WALL.floors * CURTAIN_WALL.floorH;
      // BoxGeometry face order: +x, -x, +y, -y, +z, -z; four vertices each
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
    // a slim steel ledge under the window, proud of the facade by a hand
    const sill = new Mesh(new BoxGeometry(skirtW + 0.3, 0.35, 12.9), ledgeMaterial);
    sill.position.set((SKIRT_X0 + SKIRT_X1) / 2 + 0.15, -1.52, 0.5);
    this.group.add(skirt, sill);
    this.disposables.push(skirt.geometry, sill.geometry);

    // painted raised-panel wainscot below a chair rail, with a deep baseboard
    const wainscot = wainscotMaps([222, 211, 188], 5);
    setRepeat(wainscot, roomW / WAINSCOT.bayW, 1);
    const wainscotMat = surface(wainscot, { roughness: 0.55, normalScale: new Vector2(1.1, 1.1) });
    // the side wall shares the drawing, with its own repeat
    const wainscotSide: SurfaceMaps = { map: wainscot.map.clone(), normalMap: wainscot.normalMap.clone() };
    setRepeat(wainscotSide, 18 / WAINSCOT.bayW, 1);
    const wainscotSideMat = surface(wainscotSide, { roughness: 0.55, normalScale: new Vector2(1.1, 1.1) });
    this.disposables.push(wainscotMat, wainscotSideMat);
    const backPanel = new Mesh(new PlaneGeometry(roomW, WAINSCOT.height), wainscotMat);
    backPanel.position.set(roomX, FLOOR_Y + WAINSCOT.height / 2, -3.69);
    const sidePanel = new Mesh(new PlaneGeometry(18, WAINSCOT.height), wainscotSideMat);
    sidePanel.rotation.y = Math.PI / 2;
    sidePanel.position.set(-4.59, FLOOR_Y + WAINSCOT.height / 2, 0.6);
    this.group.add(backPanel, sidePanel);
    this.disposables.push(backPanel.geometry, sidePanel.geometry);

    const paint = new MeshStandardMaterial({ color: '#ddd3bd', roughness: 0.5 });
    this.disposables.push(paint);
    const railY = FLOOR_Y + WAINSCOT.height + 0.02;
    const backRail = new Mesh(new BoxGeometry(roomW, 0.11, 0.1), paint);
    backRail.position.set(roomX, railY, -3.66);
    const sideRail = new Mesh(new BoxGeometry(0.1, 0.11, 18), paint);
    sideRail.position.set(-4.56, railY, 0.6);
    const backBoard = new Mesh(new BoxGeometry(roomW, 0.34, 0.09), paint);
    backBoard.position.set(roomX, FLOOR_Y + 0.17, -3.66);
    const sideBoard = new Mesh(new BoxGeometry(0.09, 0.34, 18), paint);
    sideBoard.position.set(-4.56, FLOOR_Y + 0.17, 0.6);
    // crown moulding where the plaster meets the ceiling
    const crownBack = new Mesh(new BoxGeometry(roomW, 0.26, 0.16), paint);
    crownBack.position.set(roomX, 5.02, -3.62);
    const crownSide = new Mesh(new BoxGeometry(0.16, 0.26, 18), paint);
    crownSide.position.set(-4.52, 5.02, 0.6);
    this.group.add(backRail, sideRail, backBoard, sideBoard, crownBack, crownSide);
    this.disposables.push(
      backRail.geometry, sideRail.geometry, backBoard.geometry, sideBoard.geometry,
      crownBack.geometry, crownSide.geometry,
    );

    // architrave and sill around the window the flight leaves by (opening: z -1.0..2.6, y 0.3..3.7)
    const trim = (w: number, h: number, d: number, x: number, y: number, z: number): void => {
      const m = new Mesh(new BoxGeometry(w, h, d), paint);
      m.position.set(x, y, z);
      this.group.add(m);
      this.disposables.push(m.geometry);
    };
    trim(0.09, 0.22, 3.98, 6.44, 3.69, 0.8);
    trim(0.09, 3.5, 0.2, 6.44, 1.99, -1.1);
    trim(0.09, 3.5, 0.2, 6.44, 1.99, 2.7);
    trim(0.34, 0.08, 4.1, 6.34, 0.3, 0.8);
    trim(0.2, 0.2, 4.1, 6.4, 0.22, 0.8);

    // rug under the desk pulls the furniture into one composition
    const rugSet = rugMaps(8);
    const rugMaterial = new MeshStandardMaterial({
      map: rugSet.map, normalMap: rugSet.normalMap, normalScale: new Vector2(0.7, 0.7), roughness: 1,
    });
    const rug = new Mesh(new PlaneGeometry(7.6, 6.4), rugMaterial);
    rug.rotation.x = -Math.PI / 2;
    rug.rotation.z = 0.02;
    rug.position.set(0.4, -1.272, 0.4);
    this.group.add(rug);
    this.disposables.push(rug.geometry, rugMaterial, rugSet.map, rugSet.normalMap);

    // curtains flanking the window opening: heavy linen, folded
    const curtainMaterial = new MeshStandardMaterial({
      color: '#8a4a3c',
      roughness: 0.92,
      side: DoubleSide,
    });
    this.disposables.push(curtainMaterial);
    for (const cz of [-1.55, 3.2] as const) {
      const g = new PlaneGeometry(1.45, 4.35, 36, 1);
      const pos = g.attributes.position!;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        pos.setZ(i, Math.sin(x * 11) * 0.09 + Math.sin(x * 4.3 + cz) * 0.05);
      }
      g.computeVertexNormals();
      const curtain = new Mesh(g, curtainMaterial);
      curtain.rotation.y = -Math.PI / 2;
      curtain.position.set(6.4, 1.85, cz);
      this.group.add(curtain);
      this.disposables.push(g);
    }
    // curtain rod across the opening, brass, with finials
    const brass = new MeshStandardMaterial({ color: '#c09a5e', roughness: 0.3, metalness: 1, envMapIntensity: 1.2 });
    this.disposables.push(brass);
    const rod = new Mesh(new CylinderGeometry(0.035, 0.035, 6.2, 10), brass);
    rod.rotation.x = Math.PI / 2;
    rod.position.set(6.4, 4.05, 0.8);
    this.group.add(rod);
    for (const fz of [-2.3, 3.9]) {
      const finial = new Mesh(new SphereGeometry(0.085, 12, 10), brass);
      finial.position.set(6.4, 4.05, fz);
      this.group.add(finial);
      this.disposables.push(finial.geometry);
    }
    this.disposables.push(rod.geometry);

    // framed art with a cream mat in walnut frames, and a wall clock, so the walls aren't bare planes
    const frameMaterial = new MeshStandardMaterial({
      map: walnut.map, normalMap: walnut.normalMap, roughnessMap: walnut.roughnessMap, roughness: 1, color: '#8f7258',
    });
    const matMaterial = new MeshStandardMaterial({ color: '#efe6d2', roughness: 0.9 });
    this.disposables.push(frameMaterial, matMaterial);
    ([[-0.6, 2.6, 0], [1.9, 2.35, 1]] as const).forEach(([fx, fy, variant]) => {
      const art = frameArtTexture(variant);
      const artMaterial = new MeshStandardMaterial({ map: art, roughness: 0.8 });
      this.disposables.push(art, artMaterial);
      const frame = new Mesh(new BoxGeometry(1.14, 1.44, 0.07), frameMaterial);
      frame.position.set(fx, fy, -3.66);
      const mat = new Mesh(new PlaneGeometry(1.0, 1.3), matMaterial);
      mat.position.set(fx, fy, -3.623);
      const canvasArt = new Mesh(new PlaneGeometry(0.74, 0.98), artMaterial);
      canvasArt.position.set(fx, fy, -3.619);
      this.group.add(frame, mat, canvasArt);
      this.disposables.push(frame.geometry, mat.geometry, canvasArt.geometry);
    });
    const ink = new MeshStandardMaterial({ color: '#2a2622', roughness: 0.5 });
    const clockFace = new Mesh(
      new CylinderGeometry(0.42, 0.42, 0.06, 32),
      new MeshStandardMaterial({ color: '#f0e9d8', roughness: 0.5 }),
    );
    clockFace.rotation.z = Math.PI / 2;
    clockFace.position.set(-4.55, 3.1, -1.2);
    const clockRim = new Mesh(new TorusGeometry(0.43, 0.035, 8, 32), brass);
    clockRim.rotation.y = Math.PI / 2;
    clockRim.position.set(-4.52, 3.1, -1.2);
    const hourHand = new Mesh(new BoxGeometry(0.02, 0.05, 0.2), ink);
    hourHand.position.set(-4.51, 3.1, -1.26);
    const minuteHand = new Mesh(new BoxGeometry(0.02, 0.05, 0.3), ink);
    minuteHand.rotation.x = 2.1;
    minuteHand.position.set(-4.51, 3.12, -1.16);
    this.group.add(clockFace, clockRim, hourHand, minuteHand);
    this.disposables.push(
      clockFace.geometry, clockFace.material as MeshStandardMaterial, clockRim.geometry,
      hourHand.geometry, minuteHand.geometry, ink,
    );

    // window wall at local x≈6.6 with the opening the path threads (world x≈7)
    const wallX = 6.6;
    const seg = (w: number, h: number, y: number, z: number): void => {
      const g = clad(new BoxGeometry(0.24, h, w), 0.24, h, w);
      // +x is the face the district sees: the glass wall; every other face is plaster
      const m = new Mesh(g, [towerSkin, wall, wall, wall, wall, wall]);
      m.position.set(wallX, y, z);
      this.group.add(m);
      this.disposables.push(g);
    };
    // opening: local z -1.0..2.6, y 0.3..3.7 (window centered on the exit line)
    seg(8.2, 1.6, -0.49 - 0.0, 0.6); // below sill (y -1.29..0.3)
    seg(8.2, 2.0, 4.7 - 0.0, 0.6); // above lintel — hmm see next line
    seg(2.7, 3.4, 2.0, -2.35); // left of opening
    seg(1.9, 3.4, 2.0, 3.55); // right of opening

    // the laptop mid-send — screen faces +X, into the flight line, so the
    // reverse-angle CH1 camera reads "SENDING EMAIL…" as the plane exits it
    const shell = new MeshStandardMaterial({ color: '#242a3a', roughness: 0.5, metalness: 0.55 });
    const deck = new Mesh(new BoxGeometry(1.0, 0.06, 1.5), shell);
    deck.position.set(-0.45, -0.07, 0);
    const keysMat = new MeshStandardMaterial({ map: laptopKeysTexture(), roughness: 0.7 });
    const keys = new Mesh(new PlaneGeometry(0.9, 1.4), keysMat);
    keys.rotation.x = -Math.PI / 2;
    keys.rotation.z = -Math.PI / 2;
    keys.position.set(-0.45, -0.038, 0);
    const screen = new Group();
    screen.position.set(-0.93, -0.06, 0); // hinge at the deck's back edge
    screen.rotation.z = 0.24; // leans back, opening toward the flight line
    const lid = new Mesh(new BoxGeometry(0.04, 1.05, 1.5), shell);
    lid.position.y = 0.52;
    const displayMat = new MeshBasicMaterial({ map: laptopScreenTexture() });
    const display = new Mesh(new PlaneGeometry(1.38, 0.93), displayMat);
    display.rotation.y = Math.PI / 2;
    display.position.set(0.021, 0.52, 0);
    // screen bezel + webcam dot above the glass
    const bezelMaterial = new MeshStandardMaterial({ color: '#10141f', roughness: 0.4 });
    const bezel = new Mesh(new BoxGeometry(0.012, 1.0, 1.46), bezelMaterial);
    bezel.position.set(0.012, 0.52, 0);
    const camDot = new Mesh(new CylinderGeometry(0.012, 0.012, 0.01, 8), bezelMaterial);
    camDot.rotation.z = Math.PI / 2;
    camDot.position.set(0.024, 0.985, 0);
    // brand dart on the lid's back — glows softly into the room
    const emblemMaterial = new MeshStandardMaterial({
      color: '#1a2030', emissive: '#7fb4ff', emissiveIntensity: 1.1,
    });
    const emblem = new Mesh(new CylinderGeometry(0.09, 0.09, 0.012, 3), emblemMaterial);
    emblem.rotation.z = Math.PI / 2;
    emblem.rotation.y = 0.4;
    emblem.position.set(-0.024, 0.55, 0);
    screen.add(lid, display, bezel, camDot, emblem);
    this.group.add(deck, keys, screen);
    this.disposables.push(
      deck.geometry, keys.geometry, keysMat, lid.geometry, display.geometry, displayMat, shell,
      bezel.geometry, bezelMaterial, camDot.geometry, emblem.geometry, emblemMaterial,
    );

    // — deck detail: real keycaps, trackpad, hinges, ports, feet, LED —
    const capGeometry = new BoxGeometry(0.075, 0.014, 0.075);
    const capMaterial = new MeshStandardMaterial({ color: '#2e3547', roughness: 0.6 });
    const ROWS = 5;
    const COLS = 13;
    const caps = new InstancedMesh(capGeometry, capMaterial, ROWS * COLS + 1);
    const capM = new Matrix4();
    const capQ = new Quaternion();
    const capS = new Vector3(1, 1, 1);
    const capP = new Vector3();
    let capIndex = 0;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        capP.set(-0.82 + r * 0.095, -0.032, -0.57 + c * 0.095);
        caps.setMatrixAt(capIndex++, capM.compose(capP, capQ, capS));
      }
    }
    // spacebar
    capP.set(-0.34, -0.032, 0);
    caps.setMatrixAt(capIndex, capM.compose(capP, capQ, new Vector3(1, 1, 6.4)));
    this.group.add(caps);
    this.disposables.push(capGeometry, capMaterial, caps);

    const padMaterial = new MeshStandardMaterial({ color: '#1c2231', roughness: 0.35, metalness: 0.2 });
    const pad = new Mesh(new BoxGeometry(0.3, 0.008, 0.44), padMaterial);
    pad.position.set(-0.16, -0.036, 0);
    this.group.add(pad);
    this.disposables.push(pad.geometry, padMaterial);

    const hingeMaterial = new MeshStandardMaterial({ color: '#161b28', roughness: 0.45, metalness: 0.6 });
    for (const hz of [-0.55, 0.55]) {
      const hinge = new Mesh(new CylinderGeometry(0.035, 0.035, 0.22, 10), hingeMaterial);
      hinge.rotation.x = Math.PI / 2;
      hinge.position.set(-0.93, -0.06, hz);
      this.group.add(hinge);
      this.disposables.push(hinge.geometry);
    }
    this.disposables.push(hingeMaterial);

    // side ports on the near edge
    for (const pz of [0.35, 0.48, 0.61]) {
      const port = new Mesh(new BoxGeometry(0.05, 0.02, 0.07), bezelMaterial);
      port.position.set(-0.45, -0.075, pz + 0.15);
      port.rotation.y = 0;
      this.group.add(port);
      this.disposables.push(port.geometry);
    }

    // power LED: a live coal on the deck edge
    const ledMaterial = new MeshStandardMaterial({
      color: '#0c2a18', emissive: '#5fff9f', emissiveIntensity: 2.2,
    });
    const led = new Mesh(new BoxGeometry(0.02, 0.012, 0.05), ledMaterial);
    led.position.set(0.03, -0.075, 0.72);
    this.group.add(led);
    this.disposables.push(led.geometry, ledMaterial);

    // cool screen spill onto the desk and the emerging sheet
    this.screenLight = new PointLight('#9fc4ff', 1.1, 5, 2);
    this.screenLight.position.set(0.5, 0.5, 0);
    this.group.add(this.screenLight);

    const paper = new MeshStandardMaterial({ map: letterTexture(), roughness: 0.9 });
    const letter = new Mesh(new PlaneGeometry(0.92, 1.3), paper);
    letter.rotation.x = -Math.PI / 2;
    letter.rotation.z = 0.5;
    letter.position.set(2.6, -0.09, -1.55); // set dressing in the lamp pool, out of the hero frame
    this.group.add(letter);
    this.disposables.push(letter.geometry, paper);

    // CC0 prop models (Poly Haven, fetched by scripts/fetch-models.mjs) —
    // streamed in after first paint; the desk reads complete without them
    const loader = new GLTFLoader();
    const prop = (url: string, targetH: number, x: number, z: number, rotY: number): void => {
      loader.load(url, (gltf) => {
        const s = gltf.scene;
        const box = new Box3().setFromObject(s);
        const size = box.getSize(new Vector3());
        s.scale.setScalar(targetH / Math.max(size.y, 1e-3));
        box.setFromObject(s);
        s.position.set(x, -0.1 - box.min.y, z); // rest on the desk top
        s.rotation.y = rotY;
        this.group.add(s);
        this.lit(s);
        requestCompile(s);
      });
    };
    prop(asset('/models/potted_plant_04.glb'), 0.95, -2.85, -1.4, 0.6);
    prop(asset('/models/ceramic_vase_01.glb'), 0.62, 2.0, -0.85, 0.2);

    // Paperwork is FLAT, so it fits by footprint, not height: scaling a
    // 2cm-thick notepad to a target height blew it up to a desk-sized slab.
    const flatProp = (url: string, targetW: number, x: number, z: number, rotY: number): void => {
      loader.load(url, (gltf) => {
        const s = gltf.scene;
        const box = new Box3().setFromObject(s);
        const size = box.getSize(new Vector3());
        s.scale.setScalar(targetW / Math.max(size.x, size.z, 1e-3));
        box.setFromObject(s);
        s.position.set(x, -0.1 - box.min.y, z);
        s.rotation.y = rotY;
        this.group.add(s);
        this.lit(s);
        requestCompile(s);
      });
    };
    // notepads by the writing hand, bound notebooks squared up behind the
    // laptop, a clipboard parked at the far corner
    flatProp(asset('/models/office_notepads.glb'), 0.3, 1.72, 0.78, -0.5);
    flatProp(asset('/models/binder_notebook.glb'), 0.28, -1.62, -1.1, 0.22);
    flatProp(asset('/models/binder_notebook.glb'), 0.28, -1.22, -1.0, -0.14);
    flatProp(asset('/models/clipboard.glb'), 0.3, 2.75, 1.02, 1.15);

    // — the study set: real furniture, floor-standing —
    const floorProp = (url: string, targetH: number, x: number, z: number, rotY: number): void => {
      loader.load(url, (gltf) => {
        const s = gltf.scene;
        const box = new Box3().setFromObject(s);
        const size = box.getSize(new Vector3());
        s.scale.setScalar(targetH / Math.max(size.y, 1e-3));
        box.setFromObject(s);
        s.position.set(x, -1.28 - box.min.y, z);
        s.rotation.y = rotY;
        this.group.add(s);
        requestCompile(s);
      });
    };
    // the desk itself: a walnut pedestal desk with a lacquered top and brass pulls.
    // Its top face lands exactly at y −0.10 where the laptop + props sit.
    const deskTop = new MeshPhysicalMaterial({
      map: walnut.map, normalMap: walnut.normalMap, roughnessMap: walnut.roughnessMap, roughness: 1,
      clearcoat: 0.55, clearcoatRoughness: 0.22, envMapIntensity: 1.1,
    });
    const deskDark = new MeshStandardMaterial({
      map: walnut.map, normalMap: walnut.normalMap, roughnessMap: walnut.roughnessMap, roughness: 1,
      color: '#a68e79', envMapIntensity: 0.9,
    });
    const deskSteel = new MeshStandardMaterial({
      color: '#9aa1b0', roughness: 0.16, metalness: 0.95, envMapIntensity: 1.6,
    });
    const rubber = new MeshStandardMaterial({ color: '#1b1a19', roughness: 0.7 });
    this.disposables.push(deskTop, deskSteel, deskDark, rubber);
    /** a box face shows a proportional window of the grain, so small panels keep the top's grain density */
    const grained = <T extends BufferGeometry>(g: T, su: number, sv: number, ou = 0, ov = 0): T => {
      const uv = g.attributes.uv!;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, ou + uv.getX(i) * su, ov + uv.getY(i) * sv);
      return g;
    };
    // furniture is authored as loose boxes but SHIPS as three merged meshes —
    // one per material. Thirty-odd draw calls for static geometry is the
    // kind of thing that quietly eats the mobile call budget.
    const furniture = new Map<MeshStandardMaterial, BufferGeometry[]>();
    const part = (
      g: BufferGeometry,
      m: MeshStandardMaterial,
      x: number,
      y: number,
      z: number,
      rot?: [number, number, number],
    ): void => {
      if (rot) g.rotateX(rot[0]), g.rotateY(rot[1]), g.rotateZ(rot[2]);
      g.translate(x, y, z);
      const bucket = furniture.get(m);
      if (bucket) bucket.push(g);
      else furniture.set(m, [g]);
    };
    part(new BoxGeometry(7.0, 0.09, 4.3), deskTop, 0, -0.145, 0);
    // a thick moulded apron under the slab reads as the top's edge
    part(grained(new BoxGeometry(7.0, 0.13, 4.3), 1, 0.05, 0, 0.3), deskDark, 0, -0.245, 0);
    // panel legs + modesty panel
    part(grained(new BoxGeometry(0.16, 1.09, 3.7), 0.4, 0.5), deskDark, -3.3, -0.815, 0);
    part(grained(new BoxGeometry(0.16, 1.09, 3.7), 0.4, 0.5, 0.5), deskDark, 3.3, -0.815, 0);
    part(grained(new BoxGeometry(6.5, 0.62, 0.06), 0.9, 0.15, 0, 0.5), deskDark, 0, -0.58, -1.78);
    // drawer pedestal: two raised drawer fronts and brass pulls
    part(grained(new BoxGeometry(1.5, 1.02, 1.0), 0.25, 0.25, 0.1, 0.1), deskDark, -2.35, -0.79, -0.9);
    part(grained(new BoxGeometry(1.38, 0.4, 0.04), 0.2, 0.09, 0.4, 0.2), deskTop, -2.35, -0.55, -0.39);
    part(grained(new BoxGeometry(1.38, 0.4, 0.04), 0.2, 0.09, 0.4, 0.6), deskTop, -2.35, -1.01, -0.39);
    part(new BoxGeometry(0.5, 0.035, 0.03), brass, -2.35, -0.44, -0.365);
    part(new BoxGeometry(0.5, 0.035, 0.03), brass, -2.35, -0.9, -0.365);
    // (the worn bookshelf that stood here read as a junk-room prop; the wall
    // of document binders below does the same job in an office register)

    // — wall unit of document binders behind the desk —
    const shelfBoard = new MeshStandardMaterial({
      map: walnut.map, normalMap: walnut.normalMap, roughnessMap: walnut.roughnessMap, roughness: 1, color: '#9a8470',
    });
    this.disposables.push(shelfBoard);
    // ONE material for every book on the wall. Detail comes from the spine
    // atlas instead of from colour: each book's box UVs are remapped into one
    // of sixteen cells, so mergeStatics still collapses the whole shelf to a
    // single draw call. Per-book materials cost ~60 calls, which is why this
    // wall used to be flat blocks of colour.
    const spineMap = bookSpineTexture();
    const bookMaterial = new MeshStandardMaterial({ map: spineMap, roughness: 0.74 });
    this.disposables.push(spineMap, bookMaterial);

    /**
     * Points a box at one atlas cell. The inset keeps the sample off the cell
     * border — without it, mips blend neighbouring spines and books pick up a
     * fringe of the wrong colour along their edges.
     */
    const spineCell = (geometry: BoxGeometry, cell: number): BoxGeometry => {
      const uv = geometry.attributes.uv as BufferAttribute;
      const step = 1 / BOOK_SPINE_CELLS;
      const inset = step * 0.03;
      const span = step - inset * 2;
      const cx = (cell % BOOK_SPINE_CELLS) * step + inset;
      const cy = Math.floor(cell / BOOK_SPINE_CELLS) * step + inset;
      for (let v = 0; v < uv.count; v++) {
        uv.setXY(v, cx + uv.getX(v) * span, cy + uv.getY(v) * span);
      }
      uv.needsUpdate = true;
      return geometry;
    };

    const book = (
      w: number, h: number, d: number, cell: number, x: number, y: number, z: number,
    ): Mesh => {
      const mesh = new Mesh(spineCell(new BoxGeometry(w, h, d), cell), bookMaterial);
      mesh.position.set(x, y, z);
      this.group.add(mesh);
      this.disposables.push(mesh.geometry);
      return mesh;
    };

    for (let row = 0; row < 3; row++) {
      const shelfY = -0.55 + row * 0.78;
      const board = new Mesh(new BoxGeometry(3.4, 0.07, 0.62), shelfBoard);
      board.position.set(-2.6, shelfY, -3.32);
      this.group.add(board);
      this.disposables.push(board.geometry);
      // books stood on their spines, leaning at the end of each run
      let x = -4.18;
      let i = 0;
      while (x < -1.06) {
        const wide = 0.11 + ((row * 7 + i) % 4) * 0.035;
        const tall = 0.44 + ((row * 5 + i) % 3) * 0.07;
        // depth varies too — a shelf where every fore-edge lines up perfectly
        // reads as a texture swatch, not as books someone actually pulls out
        const deep = 0.42 + ((row * 3 + i) % 3) * 0.035;
        const spine = book(
          wide, tall, deep, (row * 5 + i * 3) % (BOOK_SPINE_CELLS * BOOK_SPINE_CELLS),
          x + wide / 2, shelfY + 0.035 + tall / 2, -3.34 + (0.46 - deep) / 2,
        );
        if (x + wide > -1.3) spine.rotation.z = 0.22; // the run leans over
        x += wide + 0.012;
        i++;
      }
      // a few laid flat in the gap the leaning run opens up, plus one left
      // face-out against the stack — the small disorder that says in use
      if (row < 2) {
        const stackX = -1.02;
        for (let s = 0; s < 2 + row; s++) {
          book(
            0.44, 0.1, 0.38 + s * 0.02, (row * 7 + s * 5 + 2) % (BOOK_SPINE_CELLS * BOOK_SPINE_CELLS),
            stackX, shelfY + 0.09 + s * 0.105, -3.36,
          ).rotation.y = 0.06 * (s % 2 ? 1 : -1);
        }
      }
    }

    // — Newton's cradle on the desk: frame, cords, five polished balls —
    const cradleSteel = new MeshStandardMaterial({
      color: '#c3c9d6',
      roughness: 0.18,
      metalness: 0.95,
    });
    const cradleBase = deskDark;
    const cordMat = new MeshStandardMaterial({ color: '#8d94a6', roughness: 0.6 });
    this.disposables.push(cradleSteel, cordMat);
    this.cradle.position.set(2.95, -0.1, 0.42);
    this.cradle.rotation.y = -0.5;
    this.cradle.scale.setScalar(1.45);
    this.group.add(this.cradle);
    const cradlePart = (g: BufferGeometry, m: MeshStandardMaterial, px: number, py: number, pz: number): Mesh => {
      const mesh = new Mesh(g, m);
      mesh.position.set(px, py, pz);
      this.cradle.add(mesh);
      this.disposables.push(g);
      return mesh;
    };
    cradlePart(new BoxGeometry(0.46, 0.03, 0.3), cradleBase, 0, 0.015, 0);
    for (const sx of [-0.2, 0.2]) {
      cradlePart(new BoxGeometry(0.02, 0.34, 0.02), cradleSteel, sx, 0.19, -0.12);
      cradlePart(new BoxGeometry(0.02, 0.34, 0.02), cradleSteel, sx, 0.19, 0.12);
    }
    for (const sz of [-0.12, 0.12]) {
      cradlePart(new BoxGeometry(0.42, 0.02, 0.02), cradleSteel, 0, 0.35, sz);
    }
    const ballGeometry = new SphereGeometry(0.037, 14, 12);
    this.disposables.push(ballGeometry);
    for (let i = 0; i < 5; i++) {
      const arm = new Group();
      arm.position.set(-0.148 + i * 0.074, 0.35, 0);
      this.cradle.add(arm);
      this.cradleArms.push(arm);
      for (const sz of [-0.12, 0.12]) {
        const cord = new Mesh(new CylinderGeometry(0.0035, 0.0035, 0.23, 4), cordMat);
        cord.position.set(0, -0.115, sz / 2);
        cord.rotation.x = sz > 0 ? -0.44 : 0.44;
        arm.add(cord);
        this.disposables.push(cord.geometry);
      }
      const ball = new Mesh(ballGeometry, cradleSteel);
      ball.position.y = -0.228;
      arm.add(ball);
    }

    // low credenza along the back wall — the carved console it replaces was
    // the loudest period piece left in frame
    const CX = 4.9;
    const CY = -1.28;
    const CZ = -3.15;
    part(grained(new BoxGeometry(2.6, 0.78, 0.62), 0.37, 0.2, 0.1, 0.5), deskDark, CX, CY + 0.52, CZ);
    part(grained(new BoxGeometry(2.68, 0.05, 0.68), 0.38, 0.16, 0.2, 0.7), deskTop, CX, CY + 0.935, CZ);
    for (const dx of [-0.65, 0.65]) {
      part(grained(new BoxGeometry(1.16, 0.62, 0.03), 0.17, 0.14, dx > 0 ? 0.6 : 0.3, 0.4), deskTop, CX + dx, CY + 0.52, CZ + 0.32);
      part(new BoxGeometry(0.42, 0.03, 0.025), brass, CX + dx, CY + 0.75, CZ + 0.35);
    }
    for (const dx of [-1.15, 1.15]) {
      part(new BoxGeometry(0.05, 0.14, 0.5), brass, CX + dx, CY + 0.07, CZ);
    }

    // modern task chair pulled up to the desk (its own group so the whole
    // chair can be yawed, then merged with everything else by material)
    const chair = new Group();
    chair.position.set(-2.3, -1.28, 2.5);
    chair.rotation.y = -2.45;
    this.group.add(chair);
    const leather = leatherMaps([104, 62, 38], 31);
    this.disposables.push(leather.map, leather.normalMap, leather.roughnessMap!);
    const seatFabric = new MeshStandardMaterial({
      map: leather.map, normalMap: leather.normalMap, roughnessMap: leather.roughnessMap, roughness: 1,
      normalScale: new Vector2(0.9, 0.9),
    });
    this.disposables.push(seatFabric);
    const chairParts = new Map<MeshStandardMaterial, BufferGeometry[]>();
    const chairPart = (
      g: BufferGeometry,
      m: MeshStandardMaterial,
      x: number,
      y: number,
      z: number,
      rot?: [number, number, number],
    ): void => {
      if (rot) g.rotateX(rot[0]), g.rotateY(rot[1]), g.rotateZ(rot[2]);
      g.translate(x, y, z);
      const bucket = chairParts.get(m);
      if (bucket) bucket.push(g);
      else chairParts.set(m, [g]);
    };
    chairPart(new BoxGeometry(0.62, 0.1, 0.6), seatFabric, 0, 0.62, 0);
    chairPart(new BoxGeometry(0.6, 0.72, 0.08), seatFabric, 0, 1.02, -0.28, [-0.14, 0, 0]);
    chairPart(new CylinderGeometry(0.05, 0.06, 0.5, 10), deskSteel, 0, 0.32, 0);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      chairPart(
        new BoxGeometry(0.34, 0.05, 0.07), deskSteel,
        Math.cos(a) * 0.17, 0.1, Math.sin(a) * 0.17, [0, -a, 0],
      );
      chairPart(
        new CylinderGeometry(0.045, 0.045, 0.04, 8), rubber,
        Math.cos(a) * 0.33, 0.05, Math.sin(a) * 0.33, [0, 0, Math.PI / 2],
      );
    }
    for (const [material, parts] of chairParts) {
      const merged = mergeGeometries(parts, false);
      parts.forEach((g) => g.dispose());
      if (!merged) continue;
      chair.add(new Mesh(merged, material));
      this.disposables.push(merged);
    }
    for (const [material, parts] of furniture) {
      const merged = mergeGeometries(parts, false);
      parts.forEach((g) => g.dispose());
      if (!merged) continue;
      this.group.add(new Mesh(merged, material));
      this.disposables.push(merged);
    }
    // pendant over the desk: a green enamel dome on a cord, a bare warm bulb inside
    const enamel = new MeshStandardMaterial({
      color: '#27503f', roughness: 0.32, metalness: 0.35, side: DoubleSide, envMapIntensity: 1.2,
    });
    const bulbGlow = new MeshStandardMaterial({
      color: '#fff1d6', emissive: '#ffd49a', emissiveIntensity: 1.5,
    });
    this.disposables.push(enamel, bulbGlow);
    const PX = 0.9;
    const PZ = -0.3;
    const cord = new Mesh(new CylinderGeometry(0.012, 0.012, 1.0, 6), ink);
    cord.position.set(PX, 4.66, PZ);
    const dome = new Mesh(new SphereGeometry(0.5, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), enamel);
    dome.position.set(PX, 4.04, PZ);
    const cap = new Mesh(new CylinderGeometry(0.05, 0.07, 0.1, 12), brass);
    cap.position.set(PX, 4.55, PZ);
    const pendantBulb = new Mesh(new SphereGeometry(0.11, 16, 12), bulbGlow);
    pendantBulb.position.set(PX, 4.0, PZ);
    this.group.add(cord, dome, cap, pendantBulb);
    this.disposables.push(cord.geometry, dome.geometry, cap.geometry, pendantBulb.geometry);
    // its light, and the warm bounce that fills the ceiling and walls around it
    const panelLight = new PointLight('#ffd3a0', 9, 14, 1.6);
    panelLight.position.set(PX, 3.7, PZ);
    this.group.add(panelLight);
    this.group.add(new HemisphereLight('#ffe3c2', '#5c3d27', 0.5));

    // flowers rising from the vase mouth — stems + heads + a leaf each
    const flowers = new Group();
    flowers.position.set(2.0, 0.38, -0.85);
    const stemMaterial = new MeshStandardMaterial({ color: '#3e5a3a', roughness: 0.8 });
    const stemGeometry = new CylinderGeometry(0.012, 0.016, 0.5, 6);
    const headGeometry = new CylinderGeometry(0.02, 0.075, 0.11, 8);
    const leafGeometry = new PlaneGeometry(0.07, 0.2);
    this.disposables.push(stemMaterial, stemGeometry, headGeometry, leafGeometry);
    const FLOWERS: { tilt: number; lean: number; h: number; color: string }[] = [
      { tilt: 0.0, lean: -0.22, h: 0.52, color: '#d96a7b' },
      { tilt: 2.1, lean: 0.28, h: 0.42, color: '#e8b13c' },
      { tilt: 4.2, lean: 0.16, h: 0.6, color: '#c37ad9' },
    ];
    for (const f of FLOWERS) {
      const one = new Group();
      const stem = new Mesh(stemGeometry, stemMaterial);
      stem.scale.y = f.h / 0.5;
      stem.position.y = f.h / 2;
      const headMaterial = new MeshStandardMaterial({
        color: f.color,
        emissive: f.color,
        emissiveIntensity: 0.12, // reads in lamplight without glowing
        roughness: 0.7,
        side: DoubleSide,
      });
      this.disposables.push(headMaterial);
      const head = new Mesh(headGeometry, headMaterial);
      head.position.y = f.h + 0.04;
      const leaf = new Mesh(leafGeometry, stemMaterial);
      leaf.position.set(0.05, f.h * 0.45, 0);
      leaf.rotation.set(0.4, 0, -0.7);
      one.add(stem, head, leaf);
      one.rotation.set(0, f.tilt, f.lean);
      flowers.add(one);
    }
    this.group.add(flowers);

    // two coffee mugs: one mid-desk by the letter work, one parked behind
    // the laptop — body, handle, and a dark coffee surface
    const makeMug = (bodyColor: string): Group => {
      const mug = new Group();
      const bodyMaterial = new MeshStandardMaterial({ color: bodyColor, roughness: 0.35 });
      // the body stops just under the rim so the coffee is the top surface —
      // it used to sit at 0.156 inside a solid cylinder whose cap reached
      // 0.17, i.e. buried in the mug where nothing could ever see it
      const body = new Mesh(new CylinderGeometry(0.105, 0.09, 0.15, 18), bodyMaterial);
      body.position.y = 0.075;
      const handle = new Mesh(new TorusGeometry(0.055, 0.015, 8, 18, Math.PI), bodyMaterial);
      handle.position.set(0.1, 0.08, 0);
      handle.rotation.z = -Math.PI / 2;
      const coffeeMaterial = new MeshStandardMaterial({
        color: '#4b2c17',
        roughness: 0.12,
        metalness: 0.05,
      });
      const coffee = new Mesh(new CylinderGeometry(0.094, 0.094, 0.006, 18), coffeeMaterial);
      coffee.position.y = 0.152;
      mug.add(body, handle, coffee);
      this.disposables.push(body.geometry, handle.geometry, coffee.geometry, bodyMaterial, coffeeMaterial);
      return mug;
    };
    const mugA = makeMug('#b8434a');
    mugA.position.set(1.35, -0.1, 1.05);
    mugA.rotation.y = 0.7;
    const mugB = makeMug('#3f4a63');
    mugB.position.set(-1.75, -0.1, 1.1);
    mugB.rotation.y = -1.9;
    this.group.add(mugA, mugB);

    // work clutter: sticky notes, a paper stack, a pen resting on it
    const NOTE_COLORS = ['#ffd977', '#9fd6a8', '#f2a7a0'];
    const noteGeometry = new PlaneGeometry(0.22, 0.22);
    this.disposables.push(noteGeometry);
    NOTE_COLORS.forEach((c, i) => {
      const noteMaterial = new MeshStandardMaterial({ color: c, roughness: 0.9, side: DoubleSide });
      this.disposables.push(noteMaterial);
      const note = new Mesh(noteGeometry, noteMaterial);
      note.rotation.x = -Math.PI / 2;
      note.rotation.z = 0.4 + i * 1.9;
      note.position.set(0.55 + i * 0.3, -0.096, 1.45 - i * 0.18);
      this.group.add(note);
    });
    const stackMaterial = new MeshStandardMaterial({ color: '#e8e2d4', roughness: 0.9 });
    this.disposables.push(stackMaterial);
    for (let i = 0; i < 3; i++) {
      const sheetGeometry = new BoxGeometry(0.78, 0.014, 1.05);
      this.disposables.push(sheetGeometry);
      const sheet = new Mesh(sheetGeometry, stackMaterial);
      sheet.position.set(3.05, -0.095 + i * 0.015, -0.5);
      sheet.rotation.y = 0.12 + i * 0.09;
      this.group.add(sheet);
    }
    const penMaterial = new MeshStandardMaterial({ color: '#1d2a4a', roughness: 0.3, metalness: 0.4 });
    const pen = new Mesh(new CylinderGeometry(0.016, 0.016, 0.42, 8), penMaterial);
    pen.rotation.set(Math.PI / 2, 0, 0.5);
    pen.position.set(3.0, -0.04, -0.42);
    this.group.add(pen);
    this.disposables.push(pen.geometry, penMaterial);

    // the desk lamp: a brass-jointed arm with a green enamel shade, bulb inside. It is
    // the key light of the room, and on HIGH the only one that casts shadows
    const rod3 = (a: Vector3, b: Vector3, r: number, m: MeshStandardMaterial): void => {
      const len = a.distanceTo(b);
      const mesh = new Mesh(new CylinderGeometry(r, r, len, 10), m);
      mesh.position.copy(a).add(b).multiplyScalar(0.5);
      mesh.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), b.clone().sub(a).normalize());
      this.group.add(mesh);
      this.disposables.push(mesh.geometry);
    };
    const joint = (at: Vector3, r: number): void => {
      const mesh = new Mesh(new SphereGeometry(r, 12, 10), brass);
      mesh.position.copy(at);
      this.group.add(mesh);
      this.disposables.push(mesh.geometry);
    };
    const lampBase = new Mesh(new CylinderGeometry(0.17, 0.2, 0.05, 28), brass);
    lampBase.position.set(1.8, -0.075, -1.85);
    this.group.add(lampBase);
    this.disposables.push(lampBase.geometry);
    const J0 = new Vector3(1.8, -0.05, -1.85);
    const J1 = new Vector3(1.62, 0.64, -1.8);
    const J2 = new Vector3(1.22, 0.95, -1.48);
    rod3(J0, J1, 0.022, brass);
    rod3(J1, J2, 0.02, brass);
    joint(J1, 0.045);
    joint(J2, 0.05);
    // aimed at the middle of the desk where the letter and the paper plane's first fold will lie
    const aim = new Vector3(1.0, -0.1, -0.7);
    const toAim = aim.clone().sub(J2).normalize();
    const shade = new Mesh(new CylinderGeometry(0.075, 0.27, 0.34, 32, 1, true), enamel);
    shade.position.copy(J2).addScaledVector(toAim, 0.17);
    shade.quaternion.setFromUnitVectors(new Vector3(0, -1, 0), toAim);
    const lampBulb = new Mesh(new SphereGeometry(0.075, 16, 12), bulbGlow);
    lampBulb.position.copy(J2).addScaledVector(toAim, 0.2);
    // the bulb must neither merge nor cast: the lamp's own light sits inside it
    lampBulb.userData.glow = true;
    this.group.add(shade, lampBulb);
    this.disposables.push(shade.geometry, lampBulb.geometry);

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

    // a lamp on the credenza too: a ceramic body under a cream linen shade
    const ceramic = new MeshStandardMaterial({ color: '#d9d2c2', roughness: 0.28 });
    const linen = new MeshStandardMaterial({
      color: '#f1dfbd', emissive: '#ffc98a', emissiveIntensity: 0.85, roughness: 0.9, side: DoubleSide,
    });
    this.disposables.push(ceramic, linen);
    const TLX = 4.3;
    const TLZ = -3.1;
    const TLY = -0.3; // credenza top
    const tlBody = new Mesh(new SphereGeometry(0.2, 18, 14), ceramic);
    tlBody.scale.y = 1.25;
    tlBody.position.set(TLX, TLY + 0.25, TLZ);
    const tlNeck = new Mesh(new CylinderGeometry(0.035, 0.05, 0.28, 10), brass);
    tlNeck.position.set(TLX, TLY + 0.57, TLZ);
    const tlShade = new Mesh(new CylinderGeometry(0.2, 0.32, 0.36, 28, 1, true), linen);
    tlShade.position.set(TLX, TLY + 0.8, TLZ);
    this.group.add(tlBody, tlNeck, tlShade);
    this.disposables.push(tlBody.geometry, tlNeck.geometry, tlShade.geometry);
    const tableLight = new PointLight('#ffc98a', 2.6, 9, 1.7);
    tableLight.position.set(TLX, TLY + 0.8, TLZ + 0.15);
    this.group.add(tableLight);

    // cool moonlight from the window side: the counterpoint to all that tungsten
    const moon = new PointLight('#86a2d6', 3.4, 22, 1.6);
    moon.position.set(3.5, 2.6, 2.5);
    this.group.add(moon);

    // dust in the lamp cone
    const positions = new Float32Array(dustCount * 3);
    for (let i = 0; i < dustCount; i++) {
      positions[i * 3] = -1.5 + rand() * 2.6;
      positions[i * 3 + 1] = -0.1 + rand() * 1.2;
      positions[i * 3 + 2] = -2.1 + rand() * 2.4;
    }
    this.dustBase = positions.slice();
    this.dustGeometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    const dustMaterial = new PointsMaterial({
      map: glowTexture(),
      color: '#dde5f4',
      size: 0.035,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.dust = new Points(this.dustGeometry, dustMaterial);
    this.group.add(this.dust);
    this.disposables.push(this.dustGeometry, dustMaterial);

    this.mergeStatics();
  }

  /**
   * Collapse every static mesh in the room into one draw per material. The
   * study is authored as ~60 individual props, which is the right way to
   * write it and the wrong way to ship it: on the mobile tier those props
   * alone blew the whole frame's draw-call budget before the city even
   * appeared. Instanced meshes and the animated dust cloud are left alone,
   * and GLB props stream in after this runs, so they are untouched.
   */
  private mergeStatics(): void {
    this.group.updateMatrixWorld(true);
    const toGroup = this.group.matrixWorld.clone().invert();
    const byMaterial = new Map<MeshStandardMaterial, BufferGeometry[]>();
    const drop: Mesh[] = [];
    this.group.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh || (mesh as unknown as InstancedMesh).isInstancedMesh || mesh.userData.glow) return;
      // anything under a moving parent must keep its own transform
      for (let p: Object3D | null = mesh; p; p = p.parent) if (p === this.cradle) return;
      const material = mesh.material;
      if (Array.isArray(material) || !(material as MeshStandardMaterial).isMeshStandardMaterial) {
        return;
      }
      const local = toGroup.clone().multiply(mesh.matrixWorld);
      const geometry = mesh.geometry.clone().applyMatrix4(local);
      const key = material as MeshStandardMaterial;
      const bucket = byMaterial.get(key);
      if (bucket) bucket.push(geometry);
      else byMaterial.set(key, [geometry]);
      drop.push(mesh);
    });
    for (const mesh of drop) mesh.removeFromParent();
    for (const [material, parts] of byMaterial) {
      const merged = parts.length === 1 ? parts[0]! : mergeGeometries(parts, false);
      if (parts.length > 1) parts.forEach((g) => g.dispose());
      if (!merged) continue;
      this.group.add(new Mesh(merged, material));
      this.disposables.push(merged);
    }
    this.lit(this.group);
  }

  /** On HIGH the lamp's shadows fall on everything in the room, and everything in it throws them. */
  private lit(root: Object3D): void {
    if (!this.shadows) return;
    root.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh || mesh.userData.glow) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });
  }

  update(time: number): void {
    // live-screen flicker: the send is happening right now
    this.screenLight.intensity = 1.1 + Math.sin(time * 2.6) * 0.25;

    // Newton's cradle: only the end balls move, and only one at a time —
    // the middle three hang dead, which is the whole reason it reads as one
    const beat = Math.sin(time * 2.9);
    const swing = 0.5 * Math.abs(beat) * (0.75 + 0.25 * Math.cos(time * 0.4));
    this.cradleArms[0]!.rotation.z = beat > 0 ? swing : 0;
    this.cradleArms[4]!.rotation.z = beat > 0 ? 0 : -swing;
    const attr = this.dustGeometry.attributes.position!;
    const arr = attr.array as Float32Array;
    for (let i = 0; i < arr.length; i += 3) {
      arr[i] = this.dustBase[i]! + Math.sin(time * 0.12 + i) * 0.12;
      arr[i + 1] = this.dustBase[i + 1]! + Math.sin(time * 0.07 + i * 1.7) * 0.08;
    }
    attr.needsUpdate = true;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
