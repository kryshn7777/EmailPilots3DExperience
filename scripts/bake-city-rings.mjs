// Partitions both cities' lots into NEAR/MID/FAR rings by distance to the
// flight spline (sampled densely; the spline passes each region once, so
// distance-to-spline IS distance to the local flyover). Emits both tier
// partitions so runtime does zero LOD math.
import assert from 'node:assert';
import { readFileSync, writeFileSync } from 'node:fs';
import { CatmullRomCurve3, Vector3 } from 'three';
import { PATH_POINTS } from '../src/webgl/rig/pathPoints.mjs';
import { ROOFTOP_BASE_Y, cityRecipes, rooftopLots } from '../src/webgl/bake/cityGen.mjs';

const manifest = JSON.parse(
  readFileSync(new URL('../public/models/city-kit/manifest.json', import.meta.url), 'utf8'),
);

const curve = new CatmullRomCurve3(
  PATH_POINTS.map((p) => new Vector3(...p)),
  false,
  'centripetal',
);
const CAM = curve.getSpacedPoints(400);

// group offsets mirror Engine constructor placement (measured live):
// City group at (chapterAnchor(7).x, 0, 1) = (193.81, 0, 1); the window
// district hangs at ROOFTOP_BASE_Y so its towers rise out of the cloud deck
const OFFSETS = {
  city: { x: 193.81, y: 0, z: 1 },
  rooftops: { x: 0, y: ROOFTOP_BASE_Y, z: 0 },
};

// Ring radii, 35% tighter than the previous pass. The mid boundary is the
// one that pays: MID and NEAR both draw the real module now, so pulling
// near in only moves work sideways, while pulling mid in from 70 to 45
// hands those lots to the FAR impostor at 12 triangles instead of ~1800.
const RINGS = { high: { near: 18, mid: 45 }, low: { near: 8, mid: 22 } };

const partition = (lots, offset) => {
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
      const r = RINGS[tier];
      (best < r.near ? out[tier].near : best < r.mid ? out[tier].mid : out[tier].far).push(i);
    }
  });
  return out;
};

const cityLots = cityRecipes(manifest.modules).lots;
const roofLots = rooftopLots(manifest.modules).lots;
const rings = {
  city: partition(cityLots, OFFSETS.city),
  rooftops: partition(roofLots, OFFSETS.rooftops),
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
