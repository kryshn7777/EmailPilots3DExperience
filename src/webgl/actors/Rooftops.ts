import {
  AdditiveBlending,
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Quaternion,
  RepeatWrapping,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
} from 'three';
import { HOME_CELL, HOME_CELLS, ROOFTOP_BASE_Y, ROOFTOP_DECK_Y, homeLots } from '../bake/cityGen.mjs';
import { cloudDeckTexture, glowTexture, softShadowTexture } from '../bake/CanvasTextures';
import { KitCity, type KitLot, type KitManifest, type KitRingSet } from './KitCity';
import { asset } from '../asset';
import type { Quality } from '../quality';

/**
 * Streetlamp positions inside one ground cell, in cell units. Mirrors LAMPS in
 * blender/make_ground.py, which paints the matching pools of light.
 */
const LAMPS: [number, number][] = [3.5, 17.5].flatMap((x) =>
  [HOME_CELL.lotD + 0.55, HOME_CELL.lotD + HOME_CELL.street - 0.55].map((z): [number, number] => [x, z]),
);

/**
 * CH2–3: the neighbourhood outside the study window. The study is a high floor
 * of an office tower, so what lies below is a residential district seen from
 * altitude: streets, lawns, houses and trees on a regular grid, with thin
 * cloud drifting between it and the plane. Houses and trees are Blender models
 * (blender/make_buildings.py --set homes) instanced on the shared lot rings:
 * real geometry up close, simple stand-ins past the far ring.
 */
export class Rooftops {
  readonly group = new Group();
  private kitCity: KitCity | null = null;
  private deck: Mesh[] = [];
  private disposables: { dispose(): void }[] = [];

  constructor(rand: () => number, quality: Quality) {
    void rand;
    this.buildGround();

    // two offset cloud sheets drifting over it — broken, not a lid, so the
    // streets stay readable through the gaps
    const deckMap = cloudDeckTexture();
    this.disposables.push(deckMap);
    // repeat counts are high on purpose: the sheets are 900 units across, and
    // at the old 4.5–7 a single cloud tile smeared over most of the frame as
    // soon as the flight climbed — giant marbled slabs, not weather
    for (const [y, repeat, opacity, scale] of [
      // thin on purpose: these hang between the plane and the roofs, and at the
      // tower district's 0.5 they milked every house to a pale shape
      [ROOFTOP_DECK_Y - 3.5, 20, 0.26, 1],
      [ROOFTOP_DECK_Y, 13, 0.2, 0.82],
    ] as const) {
      const material = new MeshBasicMaterial({
        map: deckMap,
        transparent: true,
        opacity,
        depthWrite: false,
        side: DoubleSide,
        fog: true,
      });
      material.map = deckMap.clone();
      material.map.needsUpdate = true;
      material.map.repeat.set(repeat, repeat);
      const sheet = new Mesh(new PlaneGeometry(900 * scale, 760 * scale), material);
      sheet.rotation.x = -Math.PI / 2;
      sheet.position.set(60, y, 0);
      sheet.renderOrder = -2; // always behind anything standing in it
      this.group.add(sheet);
      this.deck.push(sheet);
      this.disposables.push(sheet.geometry, material, material.map);
    }

    this.buildLamps();
    void this.init(quality);
  }

  /**
   * The ground: one painted cell of streets, sidewalks and lawn repeated 28 x
   * 27 times. The plane is sized to a whole number of cells with its corner on
   * a cell boundary, so texture repeats line up with the lot grid the houses
   * are placed on and no offset maths is needed.
   */
  private buildGround(): void {
    const { w, d } = HOME_CELL;
    const loader = new TextureLoader();
    const load = (file: string): ReturnType<TextureLoader['load']> => {
      const t = loader.load(asset(`/models/homes/${file}`));
      t.colorSpace = SRGBColorSpace;
      t.wrapS = t.wrapT = RepeatWrapping;
      t.anisotropy = 8;
      t.repeat.set(28, 27);
      return t;
    };
    const color = load('ground-color.webp');
    const glow = load('ground-glow.webp');
    const material = new MeshStandardMaterial({
      map: color,
      roughness: 0.95,
      metalness: 0,
      // lamp pools on the streets: warm light you can read from altitude
      emissive: '#ffffff',
      emissiveMap: glow,
      emissiveIntensity: 0.5,
    });
    const ground = new Mesh(new PlaneGeometry(w * 28, d * 27), material);
    ground.rotation.x = -Math.PI / 2;
    // x spans -384..512 and z spans -364..338: both edges on cell boundaries
    ground.position.set(w * 2, ROOFTOP_BASE_Y, -d / 2);
    this.group.add(ground);
    this.disposables.push(ground.geometry, material, color, glow);
  }

  /** Warm lamp sprites over every streetlamp in every cell. */
  private buildLamps(): void {
    const { w, d } = HOME_CELL;
    const positions: number[] = [];
    for (let iz = HOME_CELLS.z[0]; iz < HOME_CELLS.z[1]; iz++) {
      for (let ix = HOME_CELLS.x[0]; ix < HOME_CELLS.x[1]; ix++) {
        for (const [lx, lz] of LAMPS) positions.push(ix * w + lx, ROOFTOP_BASE_Y + 1.7, iz * d + lz);
      }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(positions, 3));
    const lamps = new Points(
      g,
      new PointsMaterial({
        map: glowTexture(),
        color: '#ffc98a',
        size: 0.9,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        blending: AdditiveBlending,
        sizeAttenuation: true,
      }),
    );
    lamps.frustumCulled = false;
    this.group.add(lamps);
    this.disposables.push(g, lamps.material as PointsMaterial);
  }

  /** Soft contact shadows under every house and tree: grounds them on the lawn. */
  private buildShadows(lots: KitLot[], kinds: Map<string, string>): void {
    const map = softShadowTexture();
    const material = new MeshBasicMaterial({
      map, color: '#000000', transparent: true, opacity: 0.55, depthWrite: false, fog: true,
    });
    const geometry = new PlaneGeometry(1, 1);
    geometry.rotateX(-Math.PI / 2);
    const inst = new InstancedMesh(geometry, material, lots.length);
    const m4 = new Matrix4();
    const q = new Quaternion();
    const p = new Vector3();
    const s = new Vector3();
    const Y = new Vector3(0, 1, 0);
    lots.forEach((lot, k) => {
      const tree = kinds.get(lot.moduleId) === 'tree';
      const grow = tree ? 1.25 : 1.5;
      q.setFromAxisAngle(Y, lot.yaw);
      inst.setMatrixAt(k, m4.compose(p.set(lot.x, 0.04, lot.z), q, s.set(lot.w * grow, 1, lot.d * grow)));
    });
    inst.renderOrder = -1;
    this.kitCity?.group.add(inst);
    this.disposables.push(map, material, geometry, inst);
  }

  /** Drifts the two sheets against each other — the deck is never static. */
  update(time: number): void {
    if (!this.group.visible) return;
    for (let i = 0; i < this.deck.length; i++) {
      const map = (this.deck[i]!.material as MeshBasicMaterial).map;
      if (map) map.offset.x = time * (i === 0 ? 0.0016 : 0.0029);
    }
  }

  private async init(quality: Quality): Promise<void> {
    // no-cache: lots and rings MUST come from the same bake — a stale cached
    // rings file indexes past the end of a freshly generated lot list
    const [manifest, allRings] = await Promise.all([
      fetch(asset('/models/homes/manifest.json'), { cache: 'no-cache' }).then(
        (r) => r.json() as Promise<KitManifest>,
      ),
      fetch(asset('/models/city-rings.json'), { cache: 'no-cache' }).then((r) => r.json()),
    ]);
    const rings = allRings.rooftops[quality.tier] as KitRingSet;
    const { lots } = homeLots(manifest.modules);
    // glow: the baked lit windows. This district sits 20–100 units out in a
    // chapter whose fog is tuned for a dark room, so its windows run a little
    // hotter than the city's. cloudEnv: homes in a cloud sea take their light
    // and reflections from the baked cloud environment.
    this.kitCity = new KitCity(lots as KitLot[], rings, manifest, {
      tier: quality.tier, glow: 1.2, cloudEnv: true,
    });
    // the ground sits at ROOFTOP_BASE_Y; every module stands on y = 0 of its group
    this.kitCity.group.position.y = ROOFTOP_BASE_Y;
    this.group.add(this.kitCity.group);
    this.buildShadows(lots as KitLot[], new Map(manifest.modules.map((m) => [m.id, m.kind])));
  }

  dispose(): void {
    this.kitCity?.dispose();
    for (const d of this.disposables) d.dispose();
  }
}
