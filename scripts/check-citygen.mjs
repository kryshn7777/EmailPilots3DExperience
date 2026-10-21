// Self-test for cityGen v2: determinism + canyon clearance.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { CROSS_STREET_X, cityRecipes } from '../src/webgl/bake/cityGen.mjs';

const manifest = JSON.parse(
  readFileSync(new URL('../public/models/city-kit/manifest.json', import.meta.url), 'utf8'),
);

const a = JSON.stringify(cityRecipes(manifest.modules));
const b = JSON.stringify(cityRecipes(manifest.modules));
assert.strictEqual(a, b, 'cityRecipes must be deterministic');

const { lots } = cityRecipes(manifest.modules);
for (const lot of lots) {
  // a quarter turn swaps width and depth, so the extent along z is the width on those lots; no face
  // may stand on the canyon road (2.3 half width) or its pavement
  const turned = Math.round(lot.yaw / (Math.PI / 2)) % 2 !== 0;
  const hz = (turned ? lot.w : lot.d) / 2;
  assert(Math.abs(lot.z) - hz >= 2.7, `lot at x=${lot.x} z=${lot.z} reaches ${Math.abs(lot.z) - hz} of the canyon road`);
  // nor a cross street (2.6 wide)
  const hx = (turned ? lot.d : lot.w) / 2;
  for (const sx of CROSS_STREET_X) {
    assert(Math.abs(lot.x - sx) - hx >= 1.3, `lot at x=${lot.x} z=${lot.z} stands in the cross street at ${sx}`);
  }
  assert(manifest.modules.some((m) => m.id === lot.moduleId), `unknown module ${lot.moduleId}`);
}
console.log('citygen OK,', lots.length, 'lots');
