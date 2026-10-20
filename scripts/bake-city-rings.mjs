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
const RINGS = {
  city: { high: { near: 18, mid: 1e6 }, low: { near: 8, mid: 45 } },
  rooftops: { high: { near: 22, mid: 110 }, low: { near: 10, mid: 55 } },
};

const partition = (lots, offset, radii) => {
  const out = {
    high: { near: [], mid: [], far: [] },
    low: { near: [], mid: [], far: [] },
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
    for (const tier of ['high', 'low']) {
      const r = radii[tier];
      (best < r.near ? out[tier].near : best < r.mid ? out[tier].mid : out[tier].far).push(i);
    }
  });
  return out;
};

const cityLots = cityRecipes(cityManifest.modules).lots;
const roofLots = homeLots(homesManifest.modules).lots;
const rings = {
  city: partition(cityLots, OFFSETS.city, RINGS.city),
  rooftops: partition(roofLots, OFFSETS.rooftops, RINGS.rooftops),
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
    '· low:',
    rings[key].low.near.length, rings[key].low.mid.length, rings[key].low.far.length,
  );
}

writeFileSync(
  new URL('../public/models/city-rings.json', import.meta.url),
  JSON.stringify(rings),
);
console.log('rings baked');
