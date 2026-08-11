// Self-test for cityGen v2: determinism + canyon clearance.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { cityRecipes } from '../src/webgl/bake/cityGen.mjs';

const manifest = JSON.parse(
  readFileSync(new URL('../public/models/city-kit/manifest.json', import.meta.url), 'utf8'),
);

const a = JSON.stringify(cityRecipes(manifest.modules));
const b = JSON.stringify(cityRecipes(manifest.modules));
assert.strictEqual(a, b, 'cityRecipes must be deterministic');

const { lots } = cityRecipes(manifest.modules);
for (const lot of lots) {
  // cityLayout guarantees |z - canyonZ| >= 2.7 per lot center; the deepest
  // module face can protrude d/2 toward the canyon
  assert(Math.abs(lot.z) - lot.d / 2 >= 1.2, `lot at z=${lot.z} d=${lot.d} intrudes on the canyon`);
  assert(manifest.modules.some((m) => m.id === lot.moduleId), `unknown module ${lot.moduleId}`);
}
console.log('citygen OK,', lots.length, 'lots');
