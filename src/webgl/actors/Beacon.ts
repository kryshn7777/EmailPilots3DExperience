import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  Camera,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Points,
  PointsMaterial,
  RingGeometry,
  ShaderMaterial,
  Shape,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  TorusGeometry,
  Vector2,
  Vector3,
} from 'three';
import type { Quality } from '../quality';
import type { Raycast } from '../interact/Raycast';
import type { Tooltip } from '../interact/Tooltip';
import { glowTexture, lighthouseTexture } from '../bake/CanvasTextures';
import beamVert from '../shaders/beam.vert.glsl';
import beamFrag from '../shaders/beam.frag.glsl';
import oceanVert from '../shaders/ocean.vert.glsl';
import oceanFrag from '../shaders/ocean.frag.glsl';
import rainVert from '../shaders/rain.vert.glsl';
import rainFrag from '../shaders/rain.frag.glsl';

/**
 * CH6: the lighthouse in weather. A banded lighthouse on a rock islet in a
 * living night sea — Gerstner-style swells, foam surging against the rocks,
 * splash bursts on the beat, local rain — with the sweeping beam and radar
 * rings carrying the deliverability story through the storm.
 */
/**
 * The lighthouse and its islet are built at unit scale and then scaled as one
 * — the camera crosses this chapter at y≈20 and the old 12-unit tower ended
 * up BELOW the lens, which reads as a model on a table. At 1.75× the lantern
 * sits well above the flight line, so the shot looks UP at the light.
 * Anything anchored to the lantern (beam pivot, flare, tooltip) multiplies by
 * this, so keep those in sync when changing it.
 */
const TOWER_SCALE = 1.55;

/**
 * Where the freighter steams during the beacon chapter, in island-local
 * space. It is staged FAR and LARGE rather than near and cropped: the camera
 * flies 13 units above the water, so a close hull sits under the frame edge
 * (the old one left the shot entirely by t≈0.505). At this range it holds the
 * lower-right third through the whole sweep, and it is heading for the light —
 * a vessel being guided in, which is the chapter's whole point.
 */
/**
 * Riding height. The hull is 5 units deep at this scale, and at the old 0.5
 * it sat roughly 40% under — the ship read as half-sunk rather than loaded.
 */
// Rides higher than it used to. The swells in ocean.vert are 1.6x taller now
// and peak around 2 units above the plane at y=0.15, which at the old 2.15 put
// crests through the boot topping — the exact "half underwater" look this
// number was raised to fix in the first place.
const SHIP_Y = 2.85;
/**
 * The leg stays well out to seaward: the freighter is ~38 units long now, so
 * a track any closer swung its bow in over the islet's rocks.
 */
/** extra scroll the sea holds before it starts letting go — see `reveal` */
const SEA_FADE_DELAY = 0.012;

const SHIP_FROM = new Vector3(25, SHIP_Y, -80);
const SHIP_TO = new Vector3(65, SHIP_Y, -40);

export class Beacon {
  readonly group = new Group();
  /** the island: tower, rocks, cottage — scaled as one by TOWER_SCALE */
  private tower = new Group();
  private beam: Mesh;
  private beamPivot = new Group();
  private beamMaterial: ShaderMaterial;
  private oceanMaterial: ShaderMaterial;
  private sea: Mesh;
  private rainMaterial: ShaderMaterial;
  private splash: Points;
  private splashGeometry = new BufferGeometry();
  private splashMaterial: PointsMaterial;
  private splashBase: { x: number; z: number; phase: number; h: number }[] = [];
  private rings: Mesh[] = [];
  private ringMaterials: MeshStandardMaterial[] = [];
  private hovered = false;
  private towerTop = new Vector3();
  private flareMaterial: SpriteMaterial;
  private ship = new Group();
  private wake!: Mesh;
  /** last computed sweep bearing — derived from t each frame, never carried */
  private beamYaw = 0;
  private disposables: { dispose(): void }[] = [];

  constructor(anchor: Vector3, raycast: Raycast, private tooltip: Tooltip, quality: Quality) {
    const baseY = anchor.y - 13;
    this.group.position.set(anchor.x + 8, baseY, anchor.z - 2.5);
    this.towerTop.copy(this.group.position).add(new Vector3(0, 12.4 * TOWER_SCALE, 0));
    this.tower.scale.setScalar(TOWER_SCALE);
    this.group.add(this.tower);

    // — the tower: banded hull on a splayed stone base, corbelled gallery
    // with a real balustrade, glazed lantern room around a Fresnel drum,
    // domed roof and lightning rod. Poly Haven has no CC0 lighthouse, so the
    // detail is procedural; every part shares one of four materials so the
    // whole tower is still only a handful of draw calls.
    const hullMap = lighthouseTexture();
    const hullMaterial = new MeshStandardMaterial({ map: hullMap, roughness: 0.55 });
    const trim = new MeshStandardMaterial({ color: '#232a36', roughness: 0.5, metalness: 0.4 });
    const stone = new MeshStandardMaterial({ color: '#5d5b57', roughness: 0.9 });
    const lanternGlass = new MeshStandardMaterial({
      color: '#0d3a38',
      emissive: '#7fe8d8',
      emissiveIntensity: 2.4,
      roughness: 0.3,
    });
    this.disposables.push(hullMaterial, hullMap, trim, stone, lanternGlass);

    /** places a part on the tower centreline and tracks its geometry */
    const part = (g: BufferGeometry, m: MeshStandardMaterial, y: number): Mesh => {
      const mesh = new Mesh(g, m);
      mesh.position.y = y;
      this.tower.add(mesh);
      this.disposables.push(g);
      return mesh;
    };
    /** one draw call for a ring of identical small parts */
    const ring = (
      g: BufferGeometry,
      m: MeshStandardMaterial,
      count: number,
      radius: number,
      y: number,
      faceOut = false,
    ): void => {
      const inst = new InstancedMesh(g, m, count);
      const dummy = new Object3D();
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2;
        dummy.position.set(Math.cos(a) * radius, y, Math.sin(a) * radius);
        dummy.rotation.y = faceOut ? -a : 0;
        dummy.updateMatrix();
        inst.setMatrixAt(i, dummy.matrix);
      }
      inst.instanceMatrix.needsUpdate = true;
      this.tower.add(inst);
      this.disposables.push(g, inst);
    };

    part(new CylinderGeometry(1.5, 1.78, 0.3, 20), stone, 0.12); // plinth
    part(new CylinderGeometry(1.02, 1.32, 0.85, 20), stone, 0.5); // base course
    part(new CylinderGeometry(0.55, 0.95, 11.2, 20), hullMaterial, 6); // banded hull
    part(new CylinderGeometry(1.06, 0.6, 0.5, 20), trim, 11.35); // corbel flare
    part(new CylinderGeometry(1.12, 1.12, 0.12, 20), trim, 11.66); // gallery deck

    // balustrade: hand rail, mid rail, and posts between them
    const railTube = (y: number): void => {
      const r = new Mesh(new TorusGeometry(1.08, 0.032, 6, 28), trim);
      r.rotation.x = Math.PI / 2;
      r.position.y = y;
      this.tower.add(r);
      this.disposables.push(r.geometry);
    };
    railTube(12.06);
    railTube(11.9);
    ring(new BoxGeometry(0.05, 0.36, 0.05), trim, 18, 1.08, 11.9);

    // lantern room: glazing drum, astragal rings top and bottom, vertical
    // mullions, and the stepped Fresnel lens burning inside it
    part(new CylinderGeometry(0.62, 0.62, 0.85, 16), lanternGlass, 12.2);
    for (const y of [11.79, 12.61]) {
      const band = new Mesh(new TorusGeometry(0.635, 0.035, 6, 24), trim);
      band.rotation.x = Math.PI / 2;
      band.position.y = y;
      this.tower.add(band);
      this.disposables.push(band.geometry);
    }
    ring(new BoxGeometry(0.05, 0.86, 0.05), trim, 8, 0.625, 12.2);
    const lensGlass = new MeshStandardMaterial({
      color: '#123c3a',
      emissive: '#eafffb',
      emissiveIntensity: 3.2,
      roughness: 0.15,
    });
    part(new CylinderGeometry(0.3, 0.3, 0.46, 14), lensGlass, 12.18);
    for (const y of [11.94, 12.42]) {
      const step = new Mesh(new TorusGeometry(0.3, 0.045, 6, 18), lensGlass);
      step.rotation.x = Math.PI / 2;
      step.position.y = y;
      this.tower.add(step);
      this.disposables.push(step.geometry);
    }
    this.disposables.push(lensGlass);

    // roof: cone, ventilator dome, finial, lightning rod
    part(new ConeGeometry(0.78, 0.62, 16), trim, 12.96);
    part(new SphereGeometry(0.13, 12, 8), trim, 13.3);
    part(new CylinderGeometry(0.015, 0.015, 0.62, 6), trim, 13.72);

    // stairwell slits winding up the hull — the tower reads as climbable
    const slit = new MeshStandardMaterial({
      color: '#1a1408',
      emissive: '#ffc06a',
      emissiveIntensity: 1.1,
    });
    const slitGeometry = new BoxGeometry(0.2, 0.44, 0.07);
    const slits = new InstancedMesh(slitGeometry, slit, 6);
    const slitDummy = new Object3D();
    for (let i = 0; i < 6; i++) {
      const y = 1.9 + i * 1.55;
      const a = i * 1.9; // ~one turn every three floors
      const r = 0.95 - 0.4 * ((y - 0.4) / 11.2) + 0.02;
      slitDummy.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
      slitDummy.rotation.y = -a;
      slitDummy.updateMatrix();
      slits.setMatrixAt(i, slitDummy.matrix);
    }
    slits.instanceMatrix.needsUpdate = true;
    this.tower.add(slits);
    this.disposables.push(slitGeometry, slit, slits);

    // entry: door into the base with a small hood, reached off the walkway
    const doorway = new Mesh(
      new BoxGeometry(0.5, 0.95, 0.14),
      new MeshStandardMaterial({ color: '#1b2a34', roughness: 0.6 }),
    );
    doorway.position.set(1.02, 0.62, 0.55);
    doorway.rotation.y = -0.5;
    const hood = new Mesh(new BoxGeometry(0.68, 0.08, 0.3), trim);
    hood.position.set(1.06, 1.14, 0.58);
    hood.rotation.y = -0.5;
    this.tower.add(doorway, hood);
    this.disposables.push(
      doorway.geometry, doorway.material as MeshStandardMaterial, hood.geometry,
    );

    // walkway from the cottage to the door, so the two buildings connect
    const walk = new Mesh(new BoxGeometry(1.9, 0.1, 0.75), stone);
    walk.position.set(1.9, 0.28, 0.5);
    walk.rotation.y = -0.25;
    this.tower.add(walk);
    this.disposables.push(walk.geometry);

    // — the islet: wet rocks breaking the swell —
    const rock = new MeshStandardMaterial({ color: '#151c26', roughness: 0.35, metalness: 0.1 });
    this.disposables.push(rock);
    const rockSeeds: [number, number, number, number][] = [
      [0, 0.1, 0, 2.1], [1.6, -0.15, 0.9, 1.2], [-1.4, -0.2, 1.1, 1.0],
      [0.9, -0.25, -1.5, 1.3], [-1.7, -0.3, -0.9, 0.9], [2.4, -0.4, -0.4, 0.7],
    ];
    for (const [x, y, z, s] of rockSeeds) {
      const g = new IcosahedronGeometry(s, 0);
      const m = new Mesh(g, rock);
      m.position.set(x, y, z);
      m.scale.y = 0.55;
      m.rotation.set(x, z, x * z);
      this.tower.add(m);
      this.disposables.push(g);
    }

    // — keeper's cottage beside the tower: walls, pitched roof, chimney,
    // door, and two lit windows — the islet reads inhabited, not a prop —
    const cottageWall = new MeshStandardMaterial({ color: '#8e8578', roughness: 0.85 });
    const cottageRoof = new MeshStandardMaterial({ color: '#2e2a33', roughness: 0.7 });
    const cottage = new Group();
    const walls = new Mesh(new BoxGeometry(2.3, 1.35, 1.7), cottageWall);
    walls.position.y = 0.62;
    const roofPrism = new Mesh(new BoxGeometry(1.62, 1.62, 1.9), cottageRoof);
    roofPrism.rotation.z = Math.PI / 4;
    roofPrism.scale.y = 0.62;
    roofPrism.position.y = 1.38;
    const chimney = new Mesh(new BoxGeometry(0.28, 0.7, 0.28), cottageWall);
    chimney.position.set(0.7, 1.75, -0.4);
    const door = new Mesh(
      new PlaneGeometry(0.42, 0.78),
      new MeshStandardMaterial({ color: '#20303c', roughness: 0.6 }),
    );
    door.position.set(-0.6, 0.42, 0.86);
    const windowGlow = new MeshStandardMaterial({
      color: '#241c10',
      emissive: '#ffc06a',
      emissiveIntensity: 1.6,
    });
    for (const wx of [0.25, 0.85]) {
      const win = new Mesh(new PlaneGeometry(0.3, 0.34), windowGlow);
      win.position.set(wx, 0.72, 0.86);
      cottage.add(win);
      this.disposables.push(win.geometry);
    }
    cottage.add(walls, roofPrism, chimney, door);
    cottage.position.set(2.4, 0, 0.4);
    cottage.rotation.y = -0.25;
    this.tower.add(cottage);
    this.disposables.push(
      walls.geometry, roofPrism.geometry, chimney.geometry, door.geometry,
      cottageWall, cottageRoof, door.material as MeshStandardMaterial, windowGlow,
    );

    // — the sea — oversized so the camera never looks past its far edge
    // into black void on the way out of the chapter. Scaled up with the
    // island: the freighter now stands well out to sea, and the water has to
    // read as open ocean behind it rather than a pond with a far edge.
    /**
     * 256, not 128. The mesh is 640 units across, so 128 segments meant 5-unit
     * quads against a shortest swell wavelength of 12 units — 2.4 samples per
     * wave, which is marginal. 2.5-unit quads take it to ~4.8. Costs 65k
     * triangles.
     *
     * Kept for its own sake, NOT as the fix for the fish-scale lattice this
     * was raised chasing: that turned out to be the rain shader shearing its
     * drop field by height (see rain.vert), and it survived this change
     * untouched.
     */
    const seg = quality.tier === 'high' ? 256 : 120;
    const seaGeometry = new PlaneGeometry(640, 420, seg, Math.floor(seg / 2));
    this.oceanMaterial = new ShaderMaterial({
      vertexShader: oceanVert,
      fragmentShader: oceanFrag,
      uniforms: {
        uTime: { value: 0 },
        uDeep: { value: new Color('#04141a') },
        uCrest: { value: new Color('#0d3540') },
        uFoam: { value: new Color('#9fd6cf') },
        uMoonDir: { value: new Vector3(-0.2, 0.7, 0.4) },
        uTowerXZ: { value: new Vector2(this.group.position.x, this.group.position.z) },
        uFogColor: { value: new Color('#0a1d24') },
        uFogNear: { value: 20 },
        // pushed out with the bigger sea, so the horizon is distance rather
        // than a wall of fog a few ship-lengths out
        uFogFar: { value: 210 },
        uCamPos: { value: new Vector3() },
        uReveal: { value: 0 },
      },
      transparent: true,
    });
    this.sea = new Mesh(seaGeometry, this.oceanMaterial);
    this.sea.rotation.x = -Math.PI / 2;
    this.sea.position.y = 0.15;
    this.group.add(this.sea);
    this.disposables.push(seaGeometry, this.oceanMaterial);

    // — splash bursts where the surge meets the rocks —
    const SPLASHES = 70;
    const rand = (() => { let s = 4207; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
    const splashPos = new Float32Array(SPLASHES * 3);
    for (let i = 0; i < SPLASHES; i++) {
      const a = rand() * Math.PI * 2;
      // the surge ring follows the island's new footprint
      const r = (1.9 + rand() * 1.4) * TOWER_SCALE;
      this.splashBase.push({
        x: Math.cos(a) * r,
        z: Math.sin(a) * r,
        phase: rand(),
        h: (1.2 + rand() * 1.6) * TOWER_SCALE,
      });
      splashPos[i * 3] = this.splashBase[i]!.x;
      splashPos[i * 3 + 2] = this.splashBase[i]!.z;
    }
    const splashAttr = new Float32BufferAttribute(splashPos, 3);
    splashAttr.setUsage(DynamicDrawUsage);
    this.splashGeometry.setAttribute('position', splashAttr);
    this.splashMaterial = new PointsMaterial({
      map: glowTexture(),
      color: '#bfe6df',
      size: 0.34,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.splash = new Points(this.splashGeometry, this.splashMaterial);
    this.splash.frustumCulled = false;
    this.group.add(this.splash);
    this.disposables.push(this.splashGeometry, this.splashMaterial);

    // — local rain over the sea —
    const rainCount = Math.floor(quality.rainCount * 0.6);
    const rainGeometry = new BufferGeometry();
    const boxMin = new Vector3(this.group.position.x - 26, 0, this.group.position.z - 20);
    const boxSize = new Vector3(52, 24, 40);
    const rp = new Float32Array(rainCount * 3);
    const rphase = new Float32Array(rainCount);
    for (let i = 0; i < rainCount; i++) {
      rp[i * 3] = boxMin.x + rand() * boxSize.x - this.group.position.x;
      rp[i * 3 + 1] = boxMin.y + rand() * boxSize.y;
      rp[i * 3 + 2] = boxMin.z + rand() * boxSize.z - this.group.position.z;
      rphase[i] = rand();
    }
    rainGeometry.setAttribute('position', new Float32BufferAttribute(rp, 3));
    rainGeometry.setAttribute('aPhase', new Float32BufferAttribute(rphase, 1));
    // rain box is in group-local space: min/size shifted to local origin
    this.rainMaterial = new ShaderMaterial({
      vertexShader: rainVert,
      fragmentShader: rainFrag,
      uniforms: {
        uTime: { value: 0 },
        uBoxMin: { value: new Vector3(-26, 0, -20) },
        uBoxSize: { value: boxSize },
        uSpeed: { value: 14 },
        uColor: { value: new Color('#a5c4c9') },
        uOpacity: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
    });
    const rain = new Points(rainGeometry, this.rainMaterial);
    rain.frustumCulled = false;
    this.group.add(rain);
    this.disposables.push(rainGeometry, this.rainMaterial);

    // — sweeping beam (unchanged core) —
    this.beamMaterial = new ShaderMaterial({
      vertexShader: beamVert,
      fragmentShader: beamFrag,
      uniforms: {
        uColor: { value: new Color('#7fe8d8') },
        uTime: { value: 0 },
        uIntensity: { value: 0.8 },
      },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
    });
    // The cone widens with the tower and reaches far enough to rake the
    // freighter standing off to seaward. It also tilts DOWN now: the lantern
    // sits ~8 units above the flight line at 1.75×, so a level beam would
    // sweep over the lens and the "light crosses the camera" beat would die.
    const beamGeometry = new CylinderGeometry(0.12 * TOWER_SCALE, 3.2 * TOWER_SCALE, 46, 24, 1, true);
    this.beam = new Mesh(beamGeometry, this.beamMaterial);
    this.beam.rotation.z = Math.PI / 2;
    this.beam.position.x = 23;
    this.beamPivot.position.y = 12.2 * TOWER_SCALE;
    this.beamPivot.rotation.z = -0.26;
    this.beamPivot.add(this.beam);
    this.group.add(this.beamPivot);
    this.disposables.push(beamGeometry, this.beamMaterial);

    // — lantern flare: blooms only when the sweep points at the camera —
    this.flareMaterial = new SpriteMaterial({
      map: glowTexture(),
      color: '#bffbee',
      transparent: true,
      opacity: 0,
      blending: AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });
    const flare = new Sprite(this.flareMaterial);
    flare.position.set(0, 12.2 * TOWER_SCALE, 0);
    flare.scale.setScalar(5 * TOWER_SCALE);
    this.group.add(flare);
    this.disposables.push(this.flareMaterial);

    this.buildShip();

    // — radar rings riding just above the swell —
    for (let i = 0; i < 3; i++) {
      const m = new MeshStandardMaterial({
        color: '#06211f',
        emissive: '#7fe8d8',
        emissiveIntensity: 1.2,
        transparent: true,
        opacity: 0,
        roughness: 0.5,
      });
      const ring = new Mesh(new RingGeometry(0.96, 1, 48), m);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 1.1 * TOWER_SCALE;
      this.group.add(ring);
      this.rings.push(ring);
      this.ringMaterials.push(m);
      this.disposables.push(ring.geometry, m);
    }

    raycast.register({
      object: this.group,
      onEnter: () => {
        this.hovered = true;
        this.tooltip.show('SPF ✓ DKIM ✓ DMARC ✓ · EXACT DNS VALUES HANDED TO YOU');
      },
      onLeave: () => {
        this.hovered = false;
        this.tooltip.hide();
      },
    });
  }

  /**
   * A modern container freighter riding the swell off the islet, nav lights
   * on. It is procedural because Poly Haven has no modern vessel to download:
   * its entire `ships` category is four wooden colonial sailing ships from a
   * single collection, so every downloadable option reads as a pirate ship —
   * which is exactly what this replaces. Materials are shared per colour, so
   * the whole freighter is about a dozen draw calls.
   */
  private buildShip(): void {
    const hullPaint = new MeshStandardMaterial({ color: '#6d2f2a', roughness: 0.62, metalness: 0.25 });
    const topside = new MeshStandardMaterial({ color: '#20272f', roughness: 0.7, metalness: 0.3 });
    const deckPaint = new MeshStandardMaterial({ color: '#414956', roughness: 0.88 });
    const superstructure = new MeshStandardMaterial({ color: '#c3c7cd', roughness: 0.6 });
    this.disposables.push(hullPaint, topside, deckPaint, superstructure);

    const piece = (
      g: BufferGeometry,
      m: MeshStandardMaterial,
      x: number,
      y: number,
      z = 0,
    ): Mesh => {
      const mesh = new Mesh(g, m);
      mesh.position.set(x, y, z);
      this.ship.add(mesh);
      this.disposables.push(g);
      return mesh;
    };

    // hull: a real ship plan — parallel midbody running out to a flared bow —
    // extruded downward, so the silhouette is a hull and not a floating box
    const plan = new Shape();
    plan.moveTo(-4, -0.95);
    plan.lineTo(2.5, -0.95);
    plan.quadraticCurveTo(4.1, -0.66, 4.65, 0);
    plan.quadraticCurveTo(4.1, 0.66, 2.5, 0.95);
    plan.lineTo(-4, 0.95);
    plan.closePath();
    const hullGeometry = new ExtrudeGeometry(plan, { depth: 1.15, bevelEnabled: false });
    hullGeometry.rotateX(Math.PI / 2); // plan lies in XY; stand it up as XZ
    piece(hullGeometry, hullPaint, 0, 0.62);
    // boot-topping stripe at the waterline + the deck itself
    piece(new BoxGeometry(7.9, 0.12, 1.94), topside, -0.2, 0.2);
    piece(new BoxGeometry(6.6, 0.06, 1.8), deckPaint, -0.5, 0.64);
    // bulbous bow breaking the surface ahead of the stem
    piece(new SphereGeometry(0.33, 12, 8), hullPaint, 4.5, 0.05);

    // container stacks: one InstancedMesh per colour keeps the deck cheap
    // (per-instance colour would mean a colour attribute, and this project
    // does not put vertex colours on standard materials)
    const boxGeometry = new BoxGeometry(0.6, 0.32, 0.52);
    const stackColors = ['#8d5326', '#2f5f7d', '#7d3540', '#4a6b4f'];
    const slots: number[][][] = stackColors.map(() => []);
    let n = 0;
    for (let c = 0; c < 9; c++) {
      const x = -3.3 + c * 0.68;
      for (const z of [-0.6, 0, 0.6]) {
        // the stack steps down toward the bow, the way a loaded ship sits
        const high = c < 6 ? 3 : 2;
        for (let level = 0; level < high; level++) {
          slots[n++ % stackColors.length]!.push([x, 0.83 + level * 0.33, z]);
        }
      }
    }
    const dummy = new Object3D();
    for (let i = 0; i < stackColors.length; i++) {
      const m = new MeshStandardMaterial({ color: stackColors[i]!, roughness: 0.8 });
      const cells = slots[i]!;
      const inst = new InstancedMesh(boxGeometry, m, cells.length);
      for (let k = 0; k < cells.length; k++) {
        const [x, y, z] = cells[k]!;
        dummy.position.set(x!, y!, z!);
        dummy.updateMatrix();
        inst.setMatrixAt(k, dummy.matrix);
      }
      inst.instanceMatrix.needsUpdate = true;
      this.ship.add(inst);
      this.disposables.push(m, inst);
    }
    this.disposables.push(boxGeometry);

    // deck house aft: accommodation block, bridge with a lit window band,
    // funnel, and the radar mast above it
    piece(new BoxGeometry(1.4, 1.35, 1.6), superstructure, -3.3, 1.32);
    piece(new BoxGeometry(1.62, 0.32, 1.78), superstructure, -3.3, 2.14);
    const bridgeGlass = new MeshStandardMaterial({
      color: '#141d24',
      emissive: '#ffd9a0',
      emissiveIntensity: 1.5,
    });
    piece(new BoxGeometry(1.5, 0.17, 1.84), bridgeGlass, -3.3, 2.14);
    this.disposables.push(bridgeGlass);
    piece(new BoxGeometry(0.66, 0.9, 0.78), topside, -3.8, 2.58); // funnel, seated on the block
    piece(new BoxGeometry(0.7, 0.16, 0.82), hullPaint, -3.8, 2.78); // funnel band
    piece(new CylinderGeometry(0.022, 0.022, 1.1, 6), topside, -3.3, 2.85);

    // warm portholes along the hull + red/green running lights + mast light
    const lights: number[] = [];
    for (let i = 0; i < 9; i++) {
      lights.push(-3.4 + i * 0.82, 0.82, 0.97);
      lights.push(-3.4 + i * 0.82, 0.82, -0.97);
    }
    const lightGeometry = new BufferGeometry();
    lightGeometry.setAttribute('position', new Float32BufferAttribute(lights, 3));
    const lightMaterial = new PointsMaterial({
      map: glowTexture(),
      color: '#ffd9a0',
      size: 0.34,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    const portholes = new Points(lightGeometry, lightMaterial);
    portholes.frustumCulled = false;
    const nav = (color: string, x: number, y: number, z: number): Points => {
      const g = new BufferGeometry();
      g.setAttribute('position', new Float32BufferAttribute([x, y, z], 3));
      const m = new PointsMaterial({
        map: glowTexture(),
        color,
        size: 0.5,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
        blending: AdditiveBlending,
      });
      const point = new Points(g, m);
      point.frustumCulled = false;
      this.disposables.push(g, m);
      return point;
    };
    this.ship.add(
      portholes,
      nav('#ff6f6f', 4.1, 1.02, -0.62),
      nav('#7fff9f', 4.1, 1.02, 0.62),
      nav('#eafcff', -3.3, 3.42, 0),
    );
    this.disposables.push(lightGeometry, lightMaterial);

    // Staged out to seaward on the camera's right, bow up toward the light,
    // and big — the old hull sat dead ahead UNDER the flight line, so the
    // camera flew over its containers and never read the ship at all. The
    // heading is baked from the SHIP_FROM→SHIP_TO leg so the bow always
    // points where it is actually going.
    this.ship.position.copy(SHIP_FROM);
    const leg = SHIP_TO.clone().sub(SHIP_FROM);
    this.ship.rotation.y = Math.atan2(-leg.z, leg.x); // model's bow is +x
    this.ship.scale.setScalar(4.4);

    // wake: a long foam wedge lying flat on the water behind the hull, kept
    // in the island's frame (not the ship's) so the swell roll never tips it
    const wakeMaterial = new MeshStandardMaterial({
      color: '#0b2b30',
      emissive: '#9fd6cf',
      emissiveIntensity: 0.9,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      side: DoubleSide,
      map: glowTexture(),
    });
    const wakeGeometry = new PlaneGeometry(54, 7);
    this.wake = new Mesh(wakeGeometry, wakeMaterial);
    this.wake.rotation.x = -Math.PI / 2;
    this.wake.renderOrder = 1;
    this.group.add(this.wake);
    this.disposables.push(wakeGeometry, wakeMaterial);
    this.group.add(this.ship);
  }

  update(time: number, camera: Camera, t: number, planePos: Vector3): number {
    if (!this.group.visible) return 0;
    /**
     * The sweep is SCROLL-DRIVEN: there is no wall-clock term anywhere in the
     * bearing, so the beam does not turn on a still page. It used to add
     * `time * 0.45`, which meant the lamp kept sweeping whether or not you
     * were reading.
     *
     * What stays is the rate limiter, and it is not decoration. The scroll
     * gain is 40–60 radians per unit t, so a thousandth of scroll jitter —
     * the scrub spring settling, the camera's own turbulence — is several
     * degrees of swing. Driving rotation.y straight off t made the beam
     * shiver on a still page just as visibly as the old clock did, and blew
     * the lens beat entirely. Clamping the per-frame step absorbs that and
     * still comes to a complete stop once t stops changing.
     */
    const freeYaw = t * 40;
    // keyframed beat at t≈0.515: the beam deliberately sweeps across the
    // lens — guaranteed on every scroll-through, not left to sweep luck
    let camYaw = 0;
    {
      const dx = camera.position.x - this.towerTop.x;
      const dz = camera.position.z - this.towerTop.z;
      camYaw = Math.atan2(-dz, dx);
    }
    const beat = MathUtils.smoothstep(t, 0.495, 0.505) * (1 - MathUtils.smoothstep(t, 0.53, 0.54));
    const sweep = camYaw + (t - 0.5175) * 60; // crosses the lens mid-window
    // blend ANGLES, not raw accumulators: freeYaw is hundreds of radians, so
    // a direct lerp spun the beam wildly through the blend (the stutter)
    const freeNear = sweep + Math.atan2(Math.sin(freeYaw - sweep), Math.cos(freeYaw - sweep));
    const desired = MathUtils.lerp(freeNear, sweep, beat);
    // a ±π wrap flip becomes a fast continuous sweep, not a single-frame
    // teleport — and scroll jitter becomes nothing at all
    const step = Math.atan2(Math.sin(desired - this.beamYaw), Math.cos(desired - this.beamYaw));
    this.beamYaw += MathUtils.clamp(step, -0.11, 0.11);
    this.beamPivot.rotation.y = this.beamYaw;
    this.beamMaterial.uniforms.uTime!.value = time;
    // the beam stands down entering CH7 — inside-the-cone frames wash teal
    this.beamMaterial.uniforms.uIntensity!.value =
      0.8 * (1 - MathUtils.smoothstep(t, 0.575, 0.61));
    this.oceanMaterial.uniforms.uTime!.value = time;
    (this.oceanMaterial.uniforms.uCamPos!.value as Vector3).copy(camera.position);

    // weather intensity follows the chapter window
    const beaconness =
      MathUtils.smoothstep(t, 0.45, 0.5) * (1 - MathUtils.smoothstep(t, 0.57, 0.605));
    this.rainMaterial.uniforms.uTime!.value = time;
    this.rainMaterial.uniforms.uOpacity!.value = beaconness * 0.85;
    // The sea is gone before the no-fly map develops — overlapping them put
    // red exclusion circles on the water, and the sea plane is wide enough to
    // reach right over the CH7 map.
    //
    // SEA_FADE_DELAY holds the water at full strength for another ~90px of
    // scroll (about half a second at an unhurried pace on this 7.5k-pixel
    // story) and then fades quicker, so only the START moves. The END stays
    // pinned at 0.605 on purpose: red arrives at 0.59 and has to be gone
    // before the city at 0.65, so pushing the whole window would ripple
    // straight through two downstream chapters.
    const reveal =
      MathUtils.smoothstep(t, 0.44, 0.49) *
      (1 - MathUtils.smoothstep(t, 0.575 + SEA_FADE_DELAY, 0.6));
    this.oceanMaterial.uniforms.uReveal!.value = reveal;
    // a fullscreen transparent plane at alpha≈0 still pays full fragment cost
    this.sea.visible = reveal > 0.003;
    // the freighter's additive nav/porthole points outlive the dark hull —
    // a lone red dot hung in the no-fly sky until the group cut at 0.615
    this.ship.visible = reveal > 0.05;

    // — beam hits: the sweep catching the plane, then the lens —
    const beamX = Math.cos(this.beamYaw);
    const beamZ = -Math.sin(this.beamYaw);
    const lampGlow = this.beamMaterial.uniforms.uIntensity!.value / 0.8;
    let dx = planePos.x - this.towerTop.x;
    let dz = planePos.z - this.towerTop.z;
    let len = Math.hypot(dx, dz) || 1;
    const planeHit = Math.pow(Math.max((beamX * dx + beamZ * dz) / len, 0), 40) * lampGlow;
    dx = camera.position.x - this.towerTop.x;
    dz = camera.position.z - this.towerTop.z;
    len = Math.hypot(dx, dz) || 1;
    const camHit = Math.pow(Math.max((beamX * dx + beamZ * dz) / len, 0), 30) * lampGlow;
    this.flareMaterial.opacity = camHit * 0.95;

    // — the freighter stands in toward the light —
    // The passage is STORY-T driven, not wall-clock: the ship has to cross
    // the same part of the frame on every scroll-through, or the shot is
    // whatever the page happened to be doing when you got there. Wall-clock
    // is left to the swell it rides on.
    const passage = MathUtils.smoothstep(t, 0.43, 0.6);
    this.ship.position.lerpVectors(SHIP_FROM, SHIP_TO, passage);
    // Works this sea harder than the last one — two beat frequencies so the
    // hull never settles into an obvious loop, and real pitch and roll. The
    // bob stays modest relative to the swell (±0.34 against ~2 units of wave)
    // because the failure mode here has always been the trough dipping the
    // boot topping under; it is the ROTATION that sells the weather.
    this.ship.position.y =
      SHIP_Y + Math.sin(time * 0.7) * 0.22 + Math.sin(time * 1.13 + 0.7) * 0.12;
    this.ship.rotation.z = Math.sin(time * 0.7 + 1.3) * 0.115 + Math.sin(time * 1.31) * 0.04;
    this.ship.rotation.x = Math.sin(time * 0.55) * 0.075;

    // the wake lies flat astern, along the heading, fading with the sea
    this.wake.visible = this.ship.visible;
    if (this.wake.visible) {
      this.wake.position.set(
        this.ship.position.x - Math.cos(this.ship.rotation.y) * 21,
        0.32,
        this.ship.position.z + Math.sin(this.ship.rotation.y) * 21,
      );
      // a plane pitched flat by rotation.x maps its long axis to
      // (cos z, 0, −sin z), so this matches the hull's heading exactly
      this.wake.rotation.z = this.ship.rotation.y;
      (this.wake.material as MeshStandardMaterial).opacity = reveal * 0.3;
    }

    // splash bursts: parabolic arcs synced to the surge beat
    const attr = this.splashGeometry.attributes.position!;
    const arr = attr.array as Float32Array;
    for (let i = 0; i < this.splashBase.length; i++) {
      const s = this.splashBase[i]!;
      const u = (time * 0.55 + s.phase) % 1;
      const drift = 1 + u * 0.5;
      arr[i * 3] = s.x * drift;
      arr[i * 3 + 1] = 0.3 + 4 * u * (1 - u) * s.h;
      arr[i * 3 + 2] = s.z * drift;
    }
    attr.needsUpdate = true;
    this.splashMaterial.opacity = 0.5 + Math.sin(time * 1.15) * 0.3; // breathes with the surge

    // rings retire with the sea — pulsing at full strength until the group
    // cut, one read as a stray white circle in the no-fly sky mid-bend
    const ringFade = 1 - MathUtils.smoothstep(t, 0.575, 0.6);
    // the rings open around the PLANE, not around the island — it flies
    // through their centre instead of across a set of circles beside it
    const ringX = planePos.x - this.group.position.x;
    const ringZ = planePos.z - this.group.position.z;
    for (let i = 0; i < this.rings.length; i++) {
      const phase = ((time * 0.35 + i / 3) % 1 + 1) % 1;
      const radius = 1 + phase * 16;
      this.rings[i]!.position.x = ringX;
      this.rings[i]!.position.z = ringZ;
      this.rings[i]!.scale.setScalar(radius);
      this.ringMaterials[i]!.opacity =
        MathUtils.smoothstep(phase, 0, 0.12) * (1 - phase) * 0.8 * ringFade;
    }

    if (this.hovered) this.tooltip.pin(this.towerTop, camera, 30);
    return planeHit;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
