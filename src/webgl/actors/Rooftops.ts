import {
  CatmullRomCurve3,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  RepeatWrapping,
  NoColorSpace,
  SRGBColorSpace,
  TextureLoader,
  Vector2,
  Vector3,
} from 'three';
import {
  HOME_CELL, HOME_CELLS, ROOFTOP_BASE_Y, fenceRuns, homeLots,
} from '../bake/cityGen.mjs';
import { PATH_POINTS } from '../rig/pathPoints.mjs';
import { meadowTexture, softShadowTexture } from '../bake/CanvasTextures';
import { KitCity, type KitLot, type KitManifest, type KitRingSet } from './KitCity';
import { Fences } from './Fences';
import { Hedges } from './Hedges';
import { Streetlights, type Lamp } from './Streetlights';
import { StreetCars } from './StreetCars';
import { ReflectionProbe } from '../materials/ReflectionProbe';
import { Yards } from './Yards';
import { applyLawns } from '../materials/Lawns';
import { Pools } from './Pools';
import { TownLight } from './TownLight';
import { StreetFurniture } from './StreetFurniture';
import { Pedestrians } from './Pedestrians';
import { townCrowd } from './PedestrianPlans';
import { mulberry32 } from '../util';
import type { FenceRun } from '../bake/cityGen.mjs';
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
 * Showpiece lots: houses the flight passes closest, swapped for a richer model. The lot keeps its
 * place in the list (so the rings and every other index stay put) and its front setback; only the
 * house changes. `was` guards the swap: if the generator ever puts something else there, it stops
 * applying instead of resizing the wrong lot.
 */
const SHOWCASE: { lot: number; was: string; now: string }[] = [
  // the first house the camera passes leaving the window (t≈0.13): a tall tudor box seen from its
  // blank back, now the Victorian with its porch, bays and gables
  { lot: 1042, was: 'home-tudor', now: 'home-victorian' },
];

function showcase(lots: KitLot[], modules: KitManifest['modules']): void {
  const byId = new Map(modules.map((m) => [m.id, m]));
  for (const { lot: i, was, now } of SHOWCASE) {
    const lot = lots[i];
    const a = byId.get(was);
    const b = byId.get(now);
    if (!lot || lot.moduleId !== was || !a || !b) continue;
    const s = Math.min(lot.w / a.footprint[0], (HOME_CELL.lotW - 0.5) / b.footprint[0]);
    const toStreet = Math.cos(lot.yaw) > 0 ? 1 : -1;
    const front = lot.z + toStreet * lot.d / 2;
    lot.moduleId = now;
    lot.w = b.footprint[0] * s;
    lot.d = b.footprint[1] * s;
    lot.h = b.height * s;
    lot.z = front - toStreet * lot.d / 2;
  }
}

/** A house or tree in the town, in world x/z: what the scout planes pick their landings from. */
export interface TownSite { x: number; z: number; w: number; d: number; h: number; yaw: number; street?: boolean }
export interface TownSites { houses: TownSite[]; trees: TownSite[] }

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
  private fences: Fences | null = null;
  private hedges: Hedges | null = null;
  private cars: StreetCars | null = null;
  private yards: Yards | null = null;
  private pools: Pools | null = null;
  private townLight: TownLight | null = null;
  private furniture: StreetFurniture | null = null;
  private people: Pedestrians | null = null;
  private lamps: Streetlights | null = null;
  private groundMaterial: MeshStandardMaterial | null = null;
  private path: Vector3[] | null = null;
  /** every house and tree once the lots are known (null while the manifest streams in) */
  sites: TownSites | null = null;
  private disposables: { dispose(): void }[] = [];

  constructor(rand: () => number, quality: Quality) {
    void rand;
    this.buildGround(quality.tier === 'high');

    this.buildLamps(quality);
    this.buildFences(quality);
    void this.init(quality);
  }

  /**
   * The ground: one painted cell of streets, sidewalks and lawn repeated 28 x
   * 27 times. The plane is sized to a whole number of cells with its corner on
   * a cell boundary, so texture repeats line up with the lot grid the houses
   * are placed on and no offset maths is needed.
   */
  private buildGround(shadows: boolean): void {
    const { w, d } = HOME_CELL;
    const cellsX = HOME_CELLS.x[1] - HOME_CELLS.x[0];
    const cellsZ = HOME_CELLS.z[1] - HOME_CELLS.z[0];
    const loader = new TextureLoader();
    const load = (file: string, srgb = true): ReturnType<TextureLoader['load']> => {
      const t = loader.load(asset(`/models/homes/${file}`));
      t.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
      t.wrapS = t.wrapT = RepeatWrapping;
      t.anisotropy = 8;
      t.repeat.set(cellsX, cellsZ);
      return t;
    };
    const color = load('ground-color.webp');
    const glow = load('ground-glow.webp');
    // HIGH reads the surface as PBR: aggregate and slab joints from the normal map, wet-polished
    // tyre lanes and paint from the roughness map (phones keep the colour alone)
    const normal = shadows ? load('ground-normal.webp', false) : null;
    const rough = shadows ? load('ground-rough.webp', false) : null;
    const material = new MeshStandardMaterial({
      map: color,
      ...(normal ? { normalMap: normal, normalScale: new Vector2(1, 1) } : {}),
      ...(rough ? { roughnessMap: rough, roughness: 1 } : { roughness: 0.95 }),
      metalness: 0,
      // lamp pools on the streets: warm light you can read from altitude
      emissive: '#ffffff',
      emissiveMap: glow,
      emissiveIntensity: 0.5,
    });
    // exactly the cells the houses occupy, corners on cell boundaries so the texture
    // repeats line up with the lot grid; the country beyond is a different surface
    const ground = new Mesh(new PlaneGeometry(w * cellsX, d * cellsZ), material);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = shadows;
    ground.position.set(w * (HOME_CELLS.x[0] + HOME_CELLS.x[1]) / 2, ROOFTOP_BASE_Y, d * (HOME_CELLS.z[0] + HOME_CELLS.z[1]) / 2);
    this.group.add(ground);
    // every lot its own grass, mowing stripes, dry and lush patches (the cell alone repeats)
    applyLawns(material, new Vector2(ground.position.x, ground.position.z));

    // the meadow and fields under the woodland, out past the edge of town
    const meadow = meadowTexture();
    meadow.repeat.set(30, 30);
    const meadowMaterial = new MeshStandardMaterial({ map: meadow, roughness: 1, metalness: 0 });
    const outskirts = new Mesh(new PlaneGeometry(1500, 1500), meadowMaterial);
    outskirts.rotation.x = -Math.PI / 2;
    outskirts.receiveShadow = shadows;
    outskirts.position.set(80, ROOFTOP_BASE_Y - 0.06, -26);
    this.group.add(outskirts);
    this.groundMaterial = material;
    this.disposables.push(ground.geometry, material, color, glow, outskirts.geometry, meadowMaterial, meadow);
    if (normal) this.disposables.push(normal);
    if (rough) this.disposables.push(rough);
  }

  /** A real streetlight at every lamp position in every cell: pole, arm, luminaire, glow. */
  private buildLamps(quality: Quality): void {
    const { w, d } = HOME_CELL;
    const street = HOME_CELL.lotD + HOME_CELL.street / 2;
    const lamps: Lamp[] = [];
    for (let iz = HOME_CELLS.z[0]; iz < HOME_CELLS.z[1]; iz++) {
      for (let ix = HOME_CELLS.x[0]; ix < HOME_CELLS.x[1]; ix++) {
        // the arm always reaches out over the roadway
        for (const [lx, lz] of LAMPS) lamps.push({ x: ix * w + lx, z: iz * d + lz, yaw: lz < street ? 0 : Math.PI });
      }
    }
    this.lamps = new Streetlights(lamps, quality.tier);
    this.lamps.group.position.y = ROOFTOP_BASE_Y;
    this.group.add(this.lamps.group);
  }

  /**
   * Fences along the lot lines. Cut-out cards everywhere; on HIGH, the runs the
   * flight passes within a few units of become real posts, rails and boards.
   */
  /** the flight path sampled densely: what "near the flight" means for fences and parked cars */
  private pathSamples(): Vector3[] {
    this.path ??= new CatmullRomCurve3(PATH_POINTS.map((p) => new Vector3(...p)), false, 'centripetal')
      .getSpacedPoints(400);
    return this.path;
  }

  private buildFences(quality: Quality): void {
    const runs = fenceRuns();
    let isNear = (_run: FenceRun): boolean => false;
    if (quality.tier === 'high') {
      const path = this.pathSamples();
      const mid = new Vector3();
      isNear = (run) => {
        mid.set((run.x0 + run.x1) / 2, ROOFTOP_BASE_Y + 0.2, (run.z0 + run.z1) / 2);
        for (const c of path) if (c.distanceToSquared(mid) < 13 * 13) return true;
        return false;
      };
    }
    this.fences = new Fences(runs, isNear);
    this.fences.group.position.y = ROOFTOP_BASE_Y;
    this.group.add(this.fences.group);
    // clipped hedges down the lot lines that have no fence: the property lines, drawn in green
    this.hedges = new Hedges(quality.tier);
    this.hedges.group.position.y = ROOFTOP_BASE_Y;
    this.group.add(this.hedges.group);
  }

  /** Soft contact shadows under every house and tree: grounds them on the lawn. */
  private buildShadows(lots: KitLot[], kinds: Map<string, string>, high: boolean): void {
    const map = softShadowTexture();
    const material = new MeshBasicMaterial({
      // with real sun shadows on HIGH these are only ambient contact darkening
      map, color: '#000000', transparent: true, opacity: high ? 0.36 : 0.55, depthWrite: false, fog: true,
    });
    const geometry = new PlaneGeometry(1, 1);
    geometry.rotateX(-Math.PI / 2);
    lots = lots.filter((lot) => !lot.forest);
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

  /** Per-frame work: lamps by the hour, traffic, and the firepits' flicker. `night` is 0 by day, 1 in the dark. */
  update(time: number, night = 1, focus?: Vector3, eye?: Vector3): void {
    if (!this.group.visible) return;
    KitCity.tick(time);
    this.lamps?.setLevel(night);
    if (focus) this.lamps?.follow(focus);
    // the pools of lamplight painted on the streets fade with the lamps
    if (this.groundMaterial) this.groundMaterial.emissiveIntensity = 0.5 * night;
    this.cars?.update(time);
    this.people?.update(time);
    this.yards?.update(time);
    this.pools?.update(time, night);
    if (eye) this.townLight?.update(night, eye);
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
    showcase(lots as KitLot[], manifest.modules);
    // glow: the baked lit windows. This district sits 20–100 units out in a
    // chapter whose fog is tuned for a dark room, so its windows run a little
    // hotter than the city's. cloudEnv: homes in a cloud sea take their light
    // and reflections from the baked cloud environment.
    this.kitCity = new KitCity(lots as KitLot[], rings, manifest, {
      tier: quality.tier, glow: 1.2, cloudEnv: true, shadows: quality.tier === 'high', roofs: true,
    });
    // the ground sits at ROOFTOP_BASE_Y; every module stands on y = 0 of its group
    this.kitCity.group.position.y = ROOFTOP_BASE_Y;
    this.group.add(this.kitCity.group);
    const kinds = new Map(manifest.modules.map((m) => [m.id, m.kind]));
    const site = (lot: KitLot): TownSite => ({
      x: lot.x, z: lot.z, w: lot.w, d: lot.d, h: lot.h, yaw: lot.yaw, ...(lot.street ? { street: true } : {}),
    });
    this.sites = {
      houses: (lots as KitLot[]).filter((l) => kinds.get(l.moduleId) === 'house').map(site),
      trees: (lots as KitLot[]).filter((l) => kinds.get(l.moduleId) === 'tree' && !l.forest).map(site),
    };
    this.buildShadows(lots as KitLot[], kinds, quality.tier === 'high');
    this.buildCars(lots as KitLot[], kinds, quality);
    this.buildFurniture(quality);
    // the wet-night look: lamps doubled in the road, puddles that mirror the sky, window light on the
    // lawns (HIGH tier)
    if (quality.tier === 'high' && this.lamps && this.sites) {
      const path = this.pathSamples();
      const near = (x: number, z: number, reach: number): boolean => {
        for (const c of path) if ((c.x - x) ** 2 + (c.z - z) ** 2 < reach * reach) return true;
        return false;
      };
      this.townLight = new TownLight(this.lamps.tips, this.sites.houses, near);
      this.townLight.group.position.y = ROOFTOP_BASE_Y;
      this.group.add(this.townLight.group);
    }
  }

  /**
   * Traffic on every street, plus a car in the front yard of about half the houses
   * the flight passes over (the ones far from it would be invisible, and cost).
   */
  private buildCars(lots: KitLot[], kinds: Map<string, string>, quality: Quality): void {
    const rand = mulberry32(5521);
    const path = this.pathSamples();
    const reach = quality.tier === 'high' ? 70 : 40;
    const spots: { x: number; z: number; yaw: number }[] = [];
    const at = new Vector3();
    for (const lot of lots) {
      if (kinds.get(lot.moduleId) !== 'house' || rand() > 0.55) continue;
      at.set(lot.x, ROOFTOP_BASE_Y, lot.z);
      let near = false;
      for (const c of path) if (c.distanceToSquared(at) < reach * reach) { near = true; break; }
      if (!near) continue;
      const toStreet = Math.cos(lot.yaw) > 0 ? 1 : -1;
      const side = rand() < 0.5 ? -1 : 1;
      // nose to the street or to the house, half and half; yaw turns +x onto the z axis
      const nose = rand() < 0.5 ? toStreet : -toStreet;
      spots.push({
        x: lot.x + side * (lot.w / 2 + 0.55),
        z: lot.z + toStreet * (lot.d / 2 + 0.85),
        yaw: nose > 0 ? -Math.PI / 2 : Math.PI / 2,
      });
    }
    this.cars = new StreetCars(quality, spots);
    // paint, chrome and windscreens mirror the street itself (the live probe, HIGH)
    if (ReflectionProbe.current) this.cars.setEnvMap(ReflectionProbe.current.texture);
    this.cars.group.position.y = ROOFTOP_BASE_Y;
    this.group.add(this.cars.group);
    this.buildPeople(lots, kinds, spots, quality);

    // Yard details for every house the flight passes over: beds, patios, pools,
    // sheds, play sets, lights. Each lot draws its own mix (see Yards.ts).
    const yardReach = quality.tier === 'high' ? 90 : 50;
    const richReach = quality.tier === 'high' ? 30 : 18;
    const at2 = new Vector3();
    this.yards = new Yards(
      lots,
      kinds,
      spots,
      (lot) => {
        at2.set(lot.x, ROOFTOP_BASE_Y, lot.z);
        for (const c of path) if (c.distanceToSquared(at2) < yardReach * yardReach) return true;
        return false;
      },
      quality.tier,
      // the lots the camera passes close by get the full garden: beds round every wall, an
      // ornamental tree, island beds, stepping stones, a bird bath, chairs on the lawn
      (lot) => {
        at2.set(lot.x, ROOFTOP_BASE_Y, lot.z);
        for (const c of path) if (c.distanceToSquared(at2) < richReach * richReach) return true;
        return false;
      },
    );
    this.yards.group.position.y = ROOFTOP_BASE_Y;
    this.group.add(this.yards.group);
    // the swimming pools, as real pools (HIGH tier; phones keep the painted decal)
    if (quality.tier === 'high' && this.yards.poolSites.length) {
      this.pools = new Pools(this.yards.poolSites);
      this.pools.group.position.y = ROOFTOP_BASE_Y;
      this.group.add(this.pools.group);
    }
  }

  /** Hydrants, stop signs, bins out for collection, bus shelters: the street's own furniture. */
  private buildFurniture(quality: Quality): void {
    if (!this.sites) return;
    const path = this.pathSamples();
    const reach = quality.tier === 'high' ? 80 : 45;
    const at = new Vector3();
    this.furniture = new StreetFurniture(this.sites.houses, (x, z) => {
      at.set(x, ROOFTOP_BASE_Y, z);
      for (const c of path) if (c.distanceToSquared(at) < reach * reach) return true;
      return false;
    }, quality.tier);
    this.furniture.group.position.y = ROOFTOP_BASE_Y;
    this.group.add(this.furniture.group);
  }

  /**
   * People on the sidewalks near the flight (thickest on the street it flies down), up and down
   * front walks, on porches and by their cars (see PedestrianPlans.townCrowd).
   */
  private buildPeople(lots: KitLot[], kinds: Map<string, string>, spots: { x: number; z: number; yaw: number }[], quality: Quality): void {
    this.people = new Pedestrians(quality, townCrowd(lots, kinds, spots, this.pathSamples(), quality));
    this.people.group.position.y = ROOFTOP_BASE_Y;
    this.group.add(this.people.group);
  }

  dispose(): void {
    this.kitCity?.dispose();
    this.fences?.dispose();
    this.hedges?.dispose();
    this.cars?.dispose();
    this.people?.dispose();
    this.yards?.dispose();
    this.pools?.dispose();
    this.townLight?.dispose();
    this.furniture?.dispose();
    this.lamps?.dispose();
    for (const d of this.disposables) d.dispose();
  }
}
