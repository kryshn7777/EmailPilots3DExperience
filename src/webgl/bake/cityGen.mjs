// The night city, shared by scripts/bake-city.mjs (GLB export) and the
// runtime (fallback massing + window placement). Plain ESM so Node can run
// it without a TS loader; types live in cityGen.d.ts. One seed → one
// layout, so the baked GLB and the runtime window quads always agree.

export const CITY_SEED = 20260809;

/**
 * The block grid. Was 14x7 starting at x=-28: 84 cells, ~60 surviving lots,
 * a district the dive crossed in a couple of seconds and then ran out of.
 * 24x11 fixed that; 32x15 goes further, and the origin moves with it so the
 * grid stays centred on the dive rather than growing off one end.
 *
 * Depth is where this reads: the flight only ever crosses ~34 units of x, so
 * extra columns are approach and departure, while extra rows stack the canyon
 * walls deeper into peripheral vision.
 *
 * Note none of this reaches the FAR impostor ring at high tier. Ring distance
 * is measured to the nearest point on the whole spline, and the spline runs
 * the length of the world in x — so for this district only |z| and height
 * separate a lot from the flight, and the widest row is 27 out against a mid
 * radius of 45. Every city lot is a real module at high tier; the impostors
 * only kick in on LOW, whose mid radius is 22.
 */
export const COLS = 32;
export const ROWS = 15;
const X0 = -65;
const Z0 = -27;
const DX = 4.2;
const DZ = 3.9;
/** Every 5th column is a cross street (traffic runs down these gaps). */
const isCrossStreet = (col) => col % 5 === 4;

/** Local-space X of each cross street (center of the skipped columns). */
export const CROSS_STREET_X = Array.from({ length: COLS }, (_, c) => c)
  .filter(isCrossStreet)
  .map((c) => c * DX + X0 + 1.2);

/** Half-extents of the built area, so roads and ground can be sized from it. */
export const CITY_EXTENT = {
  x: [X0, X0 + (COLS - 1) * DX],
  z: [Z0, Z0 + (ROWS - 1) * DZ],
};

// local PRNG copy (util.ts is TypeScript; this file must stay Node-loadable)
function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Building footprints around a flight canyon along +X at z≈canyonZ. */
export function cityLayout(canyonZ = 0) {
  const rand = mulberry32(CITY_SEED);
  const buildings = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      if (isCrossStreet(col)) {
        rand(); rand(); rand(); rand(); // keep the layout stable for other cells
        continue;
      }
      const x = col * DX + rand() * 1.2 + X0;
      const z = canyonZ + Z0 + row * DZ + rand() * 1.1;
      const near = Math.abs(z - canyonZ);
      // keep the canyon the plane dives through open (deep buildings can
      // protrude d/2 ≈ 1.4 toward the gap — 2.7 leaves real wingtip room)
      if (near < 2.7) continue;
      // taller near the canyon walls for the dive drama
      const h = 2 + rand() * 4 + Math.max(0, 6 - near) * (0.5 + rand() * 0.6);
      buildings.push({ x, z, w: 1.8 + rand() * 1.4, h, d: 1.6 + rand() * 1.2 });
    }
  }
  return buildings;
}

/**
 * Lots resolved to kit-module recipes: same seeded walk as cityLayout, each
 * lot picking a module (skyscrapers on the tallest lots), yaw, and a tint.
 * `modules` = manifest.modules from public/models/city-kit/manifest.json —
 * passed in so this file stays fs-free and browser-importable.
 * Tints stay near-white: instanceColor MULTIPLIES the shared colormap.
 */
const TINTS = ['#ffffff', '#e8ecf6', '#d5dbec', '#f2ead9', '#c9d0e4'];

/**
 * Manifest units → the units three actually loads the module in.
 *
 * bake-kit-lods records footprint/height from the SOURCE glb, but the lod0 it
 * writes is quantized: three reads each module with its largest dimension
 * normalised to 2 and does not carry the compensating node scale into
 * mesh.geometry. So a lot authored as `mod.height * s` tall is drawn
 * `2/maxSourceDim` times that — between 0.37x and 1.84x depending on the
 * module.
 *
 * That error used to be invisible in the massing and very visible everywhere
 * else: window bands and roof clutter are placed at full lot height, so the
 * lights sat out in the air beside their buildings. KitCity now fits modules
 * from their own bounding box, which fixes the lights but drew every building
 * at the full lot — bigger than the districts have ever looked. Folding the
 * same factor into the lot keeps each building at exactly the scale it has
 * always rendered at, with its lights attached.
 */
export function lodScale(mod) {
  return 2 / Math.max(mod.footprint[0], mod.footprint[1], mod.height);
}
export function cityRecipes(modules, canyonZ = 0) {
  const lots = [];
  const rand = mulberry32(CITY_SEED + 7);
  for (const b of cityLayout(canyonZ)) {
    const tall = b.h > 6.5;
    const pool = modules.filter((m) => (tall ? /sky/i.test(m.id) : !/sky/i.test(m.id)));
    const pick = (pool.length ? pool : modules);
    const mod = pick[Math.floor(rand() * pick.length)];
    const ls = lodScale(mod);
    /**
     * Lot size is DERIVED from the module, never chosen independently of it.
     *
     * cityLayout picks w/d/h independently (w 1.8–3.2, d 1.6–2.8, h 2–12), and
     * KitCity fits a module by min(lot.w/geomW, lot.d/geomD, lot.h/geomH) — so
     * whichever ratio came out smallest decided the building, and every tower
     * landed at some arbitrary fraction of its plot. That is why this district
     * read as wrongly scaled next to the window city, which has always derived
     * its lots. One scale s makes all three ratios equal, so the module renders
     * at its own proportions.
     *
     * s comes from the PLOT, not from the height. Solving s for the layout's
     * intended height instead (b.h / mod.height) blew up every squat module:
     * a low-slung block asked to reach 10 units got its footprint multiplied
     * to match, and the district came out as wide flat slabs. A plot has a
     * ground area; the building's height is whatever module stands on it, and
     * `tall` already routes the tall lots to the skyscraper pool.
     *
     * The b.h term keeps the canyon drama: lots the layout wanted tall get a
     * bigger building in every dimension, which is what a downtown core does.
     */
    const s =
      Math.min(b.w / mod.footprint[0], b.d / mod.footprint[1]) * (0.85 + b.h / 14);
    const w = mod.footprint[0] * s * ls;
    const d = mod.footprint[1] * s * ls;
    // cityLayout's clearance test runs on the UNSCALED footprint, and the
    // derived depth can be wider still — enough for a face to reach into the
    // canyon the plane dives through. Re-test with the real depth and drop the
    // lot rather than fly through it.
    if (Math.abs(b.z - canyonZ) - d / 2 < 1.3) continue;
    lots.push({
      x: b.x, z: b.z, w, d, h: mod.height * s * ls,
      yaw: (Math.floor(rand() * 4) * Math.PI) / 2,
      tint: TINTS[Math.floor(rand() * TINTS.length)],
      moduleId: mod.id,
    });
  }
  return { lots };
}

/**
 * The neighbourhood outside the study window (Rooftops actor): streets, houses
 * and trees on a regular grid of cells, seen from altitude.
 *
 * The cell layout is shared with the ground texture (neighbourhoodTexture in
 * CanvasTextures.ts), which paints one cell and repeats it, so every constant
 * here is also a measurement on that canvas. All in site units, z grows toward
 * the south edge of a cell:
 *
 *   z 0 ........ lotD            north row of lots, fronts face +z
 *   lotD ..... lotD + street     the street
 *   then lotD                    south row of lots, fronts face -z
 *   x: `lots` lots of `lotW`, then a cross street `cross` wide
 */
export const HOME_CELL = { w: 32, d: 26, lotW: 7, lots: 4, lotD: 10, street: 6, cross: 4 };
/** cells covered, [from, to) on each axis; sized to what the climb ever sees */
export const HOME_CELLS = { x: [-2, 7], z: [-6, 4] };

/**
 * The ground of the neighbourhood. Only a few units under the window sill, so
 * the plane leaves the window just above the rooftops and climbs away over
 * them. Houses stand ~3 units tall: with the old tower district's ground at
 * -14 they sat 17 units under a camera that looks along the flight line, and
 * were lost to fog and cloud before they were ever in frame.
 */
export const ROOFTOP_BASE_Y = -3.2;
/** the upper cloud sheet; the lower one hangs 3.5 under it. Both float just over the roofs. */
export const ROOFTOP_DECK_Y = 4.1;

const HOUSE_TINTS = ['#ffffff', '#f6efe2', '#e6ecf4', '#eef3e6', '#f3e6e6'];
const TREE_TINTS = ['#ffffff', '#f2f6ea', '#eaf1e2'];

/**
 * Houses and trees resolved to module lots. `modules` is manifest.modules of
 * the homes set, each with a `kind` of 'house' or 'tree'.
 *
 * Unlike the towers, nothing here is sized by lot: a module is already at its
 * true size in site units (blender/bld/homes.py exports at a fixed scale), so
 * a lot only nudges it by a few percent and keeps it inside its plot.
 */
export function homeLots(modules) {
  const rand = mulberry32(CITY_SEED + 53);
  // lots are placed with the lean modules; a module that carries `lean` is a
  // hero/detail replacement the rings swap in, never a lot of its own
  const houses = modules.filter((m) => m.kind === 'house' && !m.lean);
  const trees = modules.filter((m) => m.kind === 'tree' && !m.lean);
  const { w, d, lotW, lots: perRow, lotD, street } = HOME_CELL;
  const lots_ = perRow;
  const lots = [];
  const pick = (list) => list[Math.floor(rand() * list.length)];

  const tree = (x, z, scale) => {
    const mod = pick(trees);
    const s = scale * (0.8 + rand() * 0.45);
    lots.push({
      x, z, w: mod.footprint[0] * s, d: mod.footprint[1] * s, h: mod.height * s,
      yaw: rand() * Math.PI * 2, tint: pick(TREE_TINTS), moduleId: mod.id,
    });
  };

  for (let iz = HOME_CELLS.z[0]; iz < HOME_CELLS.z[1]; iz++) {
    for (let ix = HOME_CELLS.x[0]; ix < HOME_CELLS.x[1]; ix++) {
      for (const row of [0, 1]) {
        for (let k = 0; k < perRow; k++) {
          const cx = ix * w + k * lotW + lotW / 2;
          const zRow = iz * d + (row === 0 ? 0 : lotD + street);
          // the street-side edge of the lot, and which way a house faces from it
          const front = row === 0 ? zRow + lotD : zRow;
          const toStreet = row === 0 ? 1 : -1;
          const rear = front - toStreet * lotD;

          if (rand() < 0.07) {
            // an empty lot: a little copse instead of a house
            const n = 2 + Math.floor(rand() * 2);
            for (let i = 0; i < n; i++) {
              tree(cx + (rand() - 0.5) * (lotW - 1.2), rear + toStreet * (1 + rand() * (lotD - 2)), 1);
            }
            continue;
          }
          const mod = pick(houses);
          const s = Math.min(0.94 + rand() * 0.14, (lotW - 0.5) / mod.footprint[0]);
          const hw = mod.footprint[0] * s;
          const hd = mod.footprint[1] * s;
          const setback = 1.5 + rand() * 1.3;
          lots.push({
            x: cx, z: front - toStreet * (setback + hd / 2), w: hw, d: hd, h: mod.height * s,
            yaw: row === 0 ? 0 : Math.PI, tint: pick(HOUSE_TINTS), moduleId: mod.id,
          });
          // backyard tree behind the house, most of the time
          if (rand() < 0.85) {
            tree(cx + (rand() - 0.5) * (lotW - 1.6), rear + toStreet * (0.9 + rand() * 1.4), 1);
          }
          // and sometimes one in the front yard, off to a corner
          if (rand() < 0.4) {
            const side = rand() < 0.5 ? -1 : 1;
            tree(cx + side * (lotW / 2 - 1.0), front - toStreet * (0.8 + rand() * 0.8), 0.85);
          }
        }
      }
    }
  }
  // — more green, from a stream of its own so no house or tree above ever moves.
  // Street trees stand on the verge along every street (small, `street: true`, so the
  // rings never give them the close-up tier), and a windbreak of poplars and pines
  // backs some rear fences.
  const extra = mulberry32(CITY_SEED + 97);
  const planted = (x, z, scale, opts = {}) => {
    const mod = trees[Math.floor(extra() * trees.length)];
    const s = scale * (0.85 + extra() * 0.35);
    lots.push({
      x, z, w: mod.footprint[0] * s, d: mod.footprint[1] * s, h: mod.height * s,
      yaw: extra() * Math.PI * 2, tint: TREE_TINTS[Math.floor(extra() * TREE_TINTS.length)],
      moduleId: mod.id, ...opts,
    });
  };
  const { cross } = HOME_CELL;
  for (let iz = HOME_CELLS.z[0]; iz < HOME_CELLS.z[1]; iz++) {
    for (let ix = HOME_CELLS.x[0]; ix < HOME_CELLS.x[1]; ix++) {
      const x0 = ix * w;
      for (const zv of [iz * d + lotD + 0.35, iz * d + lotD + street - 0.35]) {
        for (let x = x0 + 1.4; x < x0 + lots_ * lotW - 1.0; x += 5.2 + extra() * 1.2) {
          if (extra() < 0.78) planted(x + (extra() - 0.5) * 1.0, zv, 0.5, { street: true });
        }
      }
      // corner trees on the cross streets
      if (extra() < 0.6) planted(x0 + lots_ * lotW + cross * 0.5, iz * d + lotD + 0.35, 0.55, { street: true });
      // windbreak behind some rear fences
      for (const rz of [iz * d + 0.55, iz * d + d - 0.55]) {
        for (let x = x0 + 1; x < x0 + lots_ * lotW; x += 3.5 + extra() * 2) {
          if (extra() < 0.17) planted(x, rz, 0.8);
        }
      }
    }
  }
  // — the country beyond the town: groves and woodland in patches with meadow between,
  // so the town ends in trees rather than in an empty street grid. Far-ring stand-ins
  // only (`forest: true`), never real modules.
  const sm = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
  const hash2 = (ix, iz) => {
    let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const vnoise = (x, z) => {
    const ix = Math.floor(x), iz = Math.floor(z);
    const fx = x - ix, fz = z - iz;
    const a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), e = hash2(ix + 1, iz + 1);
    const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + e * u) * v;
  };
  const townX0 = HOME_CELLS.x[0] * w - 7, townX1 = HOME_CELLS.x[1] * w + 7;
  const townZ0 = HOME_CELLS.z[0] * d - 7, townZ1 = HOME_CELLS.z[1] * d + 7;
  for (let gx = -340; gx < 470; gx += 9) {
    for (let gz = -340; gz < 310; gz += 9) {
      const x = gx + (extra() - 0.5) * 8, z = gz + (extra() - 0.5) * 8;
      if (x > townX0 && x < townX1 && z > townZ0 && z < townZ1) continue;
      const density = sm(0.4, 0.62, vnoise(x / 75 + 3.1, z / 75 - 1.7)) * 0.85 + 0.04;
      if (extra() > density) continue;
      planted(x, z, 1.0 + extra() * 0.7, { forest: true });
    }
  }
  return { lots };
}

/**
 * Fence lines of the neighbourhood, one entry per straight run between two
 * points (site units, same frame as homeLots). Side lines run from the rear to
 * just past the front of the house, rear lines close the back, and low pickets
 * sometimes edge the front lawn with a gap for the walkway. Side lines are shared
 * by two neighbours, so each is generated once per boundary, not once per lot.
 * Independent of homeLots' random stream, so adding a style here never moves a
 * house.
 */
export const FENCE_STYLES = ['picket', 'privacy', 'rail'];

export function fenceRuns() {
  const rand = mulberry32(CITY_SEED + 211);
  const { w, d, lotW, lots: perRow, lotD, street } = HOME_CELL;
  const runs = [];
  const style = () => FENCE_STYLES[Math.floor(rand() * FENCE_STYLES.length)];
  const add = (x0, z0, x1, z1, st, kind) => runs.push({ x0, z0, x1, z1, style: st, kind });

  for (let iz = HOME_CELLS.z[0]; iz < HOME_CELLS.z[1]; iz++) {
    for (let ix = HOME_CELLS.x[0]; ix < HOME_CELLS.x[1]; ix++) {
      for (const row of [0, 1]) {
        const zRow = iz * d + (row === 0 ? 0 : lotD + street);
        const front = row === 0 ? zRow + lotD : zRow;
        const toStreet = row === 0 ? 1 : -1;
        const rear = front - toStreet * lotD;
        // side lines stop short of the street, at roughly the front of the house
        const sideEnd = front - toStreet * 3.4;
        for (let k = 0; k <= perRow; k++) {
          const x = ix * w + k * lotW;
          const edge = k === 0 || k === perRow;
          if (rand() < (edge ? 0.45 : 0.78)) add(x, rear, x, sideEnd, style(), 'side');
        }
        for (let k = 0; k < perRow; k++) {
          const x0 = ix * w + k * lotW;
          if (rand() < 0.72) add(x0, rear, x0 + lotW, rear, style(), 'rear');
          if (rand() < 0.38) {
            // a low picket along the front lawn, open at the walkway
            const zf = front - toStreet * 0.45;
            const cx = x0 + lotW / 2;
            add(x0 + 0.1, zf, cx - 0.6, zf, 'picket', 'front');
            add(cx + 0.6, zf, x0 + lotW - 0.1, zf, 'picket', 'front');
          }
        }
      }
    }
  }
  return runs;
}
