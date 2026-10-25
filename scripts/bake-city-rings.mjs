// Partitions both cities' lots into NEAR/MID/FAR rings by distance to the
// flight spline (sampled densely; the spline passes each region once, so
// distance-to-spline IS distance to the local flyover). Emits both tier
// partitions so runtime does zero LOD math.
import assert from 'node:assert';
import { readFileSync, writeFileSync } from 'node:fs';
import { CatmullRomCurve3, Vector3 } from 'three';
import { PATH_POINTS } from '../src/webgl/rig/pathPoints.mjs';
import { ROOFTOP_BASE_Y, cityRecipes, homeLots } from '../src/webgl/bake/cityGen.mjs';

const readManifest = (dir) =>
  JSON.parse(readFileSync(new URL(`../public/models/${dir}/manifest.json`, import.meta.url), 'utf8'));
const cityManifest = readManifest('city-kit');
const homesManifest = readManifest('homes');

const curve = new CatmullRomCurve3(
  PATH_POINTS.map((p) => new Vector3(...p)),
  false,
  'centripetal',
);
const CAM = curve.getSpacedPoints(400);

// group offsets mirror Engine constructor placement (measured live):
// City group at (chapterAnchor(7).x, 0, 1) = (193.81, 0, 1); the window
// neighbourhood lies at ROOFTOP_BASE_Y, far below the window
const OFFSETS = {
  city: { x: 193.81, y: 0, z: 1 },
  rooftops: { x: 0, y: ROOFTOP_BASE_Y, z: 0 },
};

// Ring radii per city. A module costs ~60-100 triangles now, not ~1800, so the
// real-geometry rings reach much further than they could with the old kit:
// the night city is real buildings throughout on HIGH, and the neighbourhood
// is real houses out to 110 units, with the impostors only past that.
// near = the hero (close-up) models where a set has them, mid = the lean ones.
// Trees have four tiers because they are what the window-exit view is full of: `ultra` -> the
// close-up tree (~50k tris: full branching skeleton, buttress roots, three sizes of leaf card and
// hundreds of individual 3D leaves) for the few the flight passes within a few metres of, `near` ->
// hero trees (~15k tris), `detail` -> the mid-detail tree (~2.4k), `lite` -> a ~700-triangle tree
// with real boughs and leaf cards out to a radius where a lean 60-triangle blob would still read
// as one. Beyond `lite` the lean module stands. Houses only have the hero tier. `ultra` is a
// subset of `near`/`mid`, `detail` and `lite` are subsets of `mid`. Phones (low) have no ultra or
// hero tier but do get detail and lite. Street trees (verge trees, about half the size of a
// yard's) have their own, shorter radii: `streetUltra`, `streetNear`, `streetDetail`, `streetLite`.
// Every instance of a module is drawn whether or not it is in view (an InstancedMesh is culled as
// a whole), so the radii are a triangle budget: the tree total on screen is the sum over the rings.
// `hero` (city): the lots inside `near` that get the full-geometry hero towers and blocks
// (blender `--sheet hero-towers`, 18-170k triangles each), which only the lots the canyon flies
// past can justify; `near` itself still decides the neon and billboard dressing in City.ts.
const RINGS = {
  city: { high: { near: 18, mid: 1e6, hero: 10 }, low: { near: 8, mid: 45 } },
  rooftops: {
    high: {
      near: 11, mid: 110, treeUltra: 6.5, streetUltra: 4.5, treeNear: 12, streetNear: 8,
      treeDetail: 28, treeLite: 78, streetDetail: 16, streetLite: 42,
    },
    low: { near: 10, mid: 55, treeNear: 0, treeDetail: 15, treeLite: 36, streetDetail: 9, streetLite: 24 },
  },
};

const partition = (lots, offset, radii, kindOf = () => undefined) => {
  const out = {
    high: { near: [], mid: [], far: [], detail: [], lite: [], hero: [], ultra: [] },
    low: { near: [], mid: [], far: [], detail: [], lite: [], hero: [], ultra: [] },
  };
  lots.forEach((lot, i) => {
    let best = Infinity;
    const wx = lot.x + offset.x;
    const wz = lot.z + offset.z;
    for (const c of CAM) {
      // 3D distance to the building's nearest span point: flat xz distance
      // alone called rooftops "near" under a leg flying 18 units overhead
      const dy = Math.max(0, c.y - (lot.h + offset.y));
      const d = Math.hypot(wx - c.x, dy, wz - c.z);
      if (d < best) best = d;
    }
    const isTree = kindOf(lot) === 'tree';
    if (lot.forest) {
      // woodland is scenery: stand-ins in every ring, never a real module
      out.high.far.push(i);
      out.low.far.push(i);
      return;
    }
    for (const tier of ['high', 'low']) {
      const r = radii[tier];
      // verge trees are small and many: the hero tier only right beside the flight
      let near = isTree && r.treeNear !== undefined ? r.treeNear : r.near;
      if (lot.street) near = r.streetNear ?? 0;
      const ultraTo = lot.street ? r.streetUltra : r.treeUltra;
      if (isTree && ultraTo !== undefined && best < ultraTo) out[tier].ultra.push(i);
      const detailTo = lot.street ? Math.min(r.treeDetail ?? 0, r.streetDetail ?? 22) : r.treeDetail;
      const liteTo = lot.street ? Math.min(r.treeLite ?? 0, r.streetLite ?? 30) : r.treeLite;
      (best < near ? out[tier].near : best < r.mid ? out[tier].mid : out[tier].far).push(i);
      if (r.hero !== undefined && best < Math.min(r.hero, near)) out[tier].hero.push(i);
      if (isTree && best >= near && best < r.mid) {
        if (detailTo !== undefined && best < detailTo) out[tier].detail.push(i);
        else if (liteTo !== undefined && best < liteTo) out[tier].lite.push(i);
      }
    }
  });
  // a set without a hero radius swaps its whole near ring (the homes), so it carries no list
  for (const tier of ['high', 'low']) {
    if (radii[tier].hero === undefined) delete out[tier].hero;
    if (!out[tier].ultra.length) delete out[tier].ultra;
  }
  return out;
};

const cityLots = cityRecipes(cityManifest.modules).lots;
const roofLots = homeLots(homesManifest.modules).lots;
const homeKind = Object.fromEntries(homesManifest.modules.map((m) => [m.id, m.kind]));
const rings = {
  city: partition(cityLots, OFFSETS.city, RINGS.city),
  rooftops: partition(roofLots, OFFSETS.rooftops, RINGS.rooftops, (lot) => homeKind[lot.moduleId]),
};

for (const [key, lots] of [['city', cityLots], ['rooftops', roofLots]]) {
  for (const tier of ['high', 'low']) {
    const r = rings[key][tier];
    assert.strictEqual(
      r.near.length + r.mid.length + r.far.length,
      lots.length,
      `${key}/${tier}: every lot in exactly one ring`,
    );
  }
  console.log(
    key,
    'high near/mid/far:',
    rings[key].high.near.length, rings[key].high.mid.length, rings[key].high.far.length,
    `(ultra ${rings[key].high.ultra?.length ?? 0}, detail ${rings[key].high.detail.length}, lite ${rings[key].high.lite.length}` +
      `${rings[key].high.hero ? `, hero ${rings[key].high.hero.length}` : ''})`,
    '· low:',
    rings[key].low.near.length, rings[key].low.mid.length, rings[key].low.far.length,
    `(detail ${rings[key].low.detail.length}, lite ${rings[key].low.lite.length})`,
  );
}

writeFileSync(
  new URL('../public/models/city-rings.json', import.meta.url),
  JSON.stringify(rings),
);
console.log('rings baked');
