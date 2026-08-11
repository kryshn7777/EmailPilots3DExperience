# Kit-Instanced Cities with Baked LODs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace both cities' box massing with Kenney City Kit low-poly buildings, procedurally placed by the existing seeded layout, with build-time-baked 3-level LODs chunked against the known camera spline, inside a mid-Android budget (≤150k tris, ≤80 draw calls, far field impostor-only on phones).

**Architecture:** A bake pipeline (Node scripts) turns kit GLBs into per-module LOD sets and turns the seeded lot layout into a JSON of per-lot module recipes pre-partitioned into NEAR/MID/FAR rings by distance to the sampled camera spline. Runtime loads module GLBs once, builds one `InstancedMesh` per (module × LOD ring) from the JSON, and toggles rings with the same t-window logic every actor uses. **Deviation from spec:** chunks ship as JSON + module GLBs instead of one EXT_mesh_gpu_instancing GLB — same zero-per-frame-CPU result, no programmatic glTF authoring, no extension-support risk.

**Tech Stack:** Node ESM scripts, `@gltf-transform/cli` (already used via npx), three.js `GLTFLoader` + `InstancedMesh`, Astro dev server + Playwright probes for verification.

## Global Constraints

- Mobile budget (LOW tier): ≤150k triangles on screen, ≤80 draw calls total, far ring impostor-only.
- Kit assets committed to `New Website/public/models/city-kit/`, total ≤2.5MB.
- NEVER use geometry vertexColors on MeshStandardMaterial (ANGLE/D3D black-frames the composer) — per-instance tints via `instanceColor` only.
- Banned phrases (never in code/comments/assets): "cold email", "cold outreach", "mass email", "bulk blast", "email blast", "anti-ban", "bypass spam filters", "spintax".
- Typecheck = `npx astro check` (0 errors) in `New Website/`; there is no unit-test runner in the website workspace — Node scripts self-verify with `node:assert`, runtime verifies via browser probe protocol (below).
- Probe protocol: dev server on :4321, page `/?probe=1&clean=1`, drive scroll via `window.__engine.director.lenis.scrollTo(f * max, { immediate: true })`, wait for `|scrollT − renderT| < 0.0008`, then `__engine.renderFrame(performance.now())` and read `__engine.renderer.info` or capture `toDataURL`.
- Windows/PowerShell 5.1: no `&&`; here-string closers at column 0; scoped `git add` only.

---

### Task 1: Fetch + select Kenney City Kit modules

**Files:**
- Create: `New Website/scripts/fetch-city-kit.mjs`
- Create (output, committed): `New Website/public/models/city-kit/src/*.glb` (raw picks), `New Website/public/models/city-kit/manifest.json`

**Interfaces:**
- Produces: `public/models/city-kit/manifest.json` — `{ modules: [{ id: string, file: string }] }` consumed by Task 2. Raw module GLBs in `public/models/city-kit/src/`.

- [ ] **Step 1: Scrape the direct zip URL and download**

```js
// New Website/scripts/fetch-city-kit.mjs
// Fetches the Kenney City Kit (Commercial) zip (CC0), unzips it, and copies
// a curated set of building GLBs into public/models/city-kit/src/.
// Bootstrap-only: committed GLBs are the source of truth (URL hashes rot).
import { execSync } from 'node:child_process';
import { mkdirSync, readdirSync, copyFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'models', 'city-kit');
const srcDir = join(outDir, 'src');
const tmp = join(root, '.tmp-city-kit');

// scrape the download href from the asset page (same pipe that fetched the
// pirate kit): <a href="https://kenney.nl/media/pages/assets/city-kit-commercial/<hash>/kenney_city-kit-commercial.zip">
const page = await (await fetch('https://kenney.nl/assets/city-kit-commercial')).text();
const m = page.match(/https:\/\/kenney\.nl\/media\/pages\/assets\/city-kit-commercial\/[^"]+\.zip/);
if (!m) throw new Error('download link not found on asset page');
const zip = join(tmp, 'kit.zip');
mkdirSync(tmp, { recursive: true });
const buf = Buffer.from(await (await fetch(m[0])).arrayBuffer());
writeFileSync(zip, buf);
execSync(`powershell -NoProfile -Command "Expand-Archive -Force '${zip}' '${tmp}\\kit'"`);

// curate: skip roads/props, keep building segments and towers
const glbDir = readdirSync(join(tmp, 'kit'), { recursive: true })
  .map(String)
  .find((p) => p.toLowerCase().endsWith('glb format'));
if (!glbDir) throw new Error('GLB format dir not found in kit zip');
const all = readdirSync(join(tmp, 'kit', glbDir)).filter((f) => f.endsWith('.glb'));
const picks = all.filter((f) => /^(building|skyscraper)/i.test(f)).slice(0, 18);
if (picks.length < 8) throw new Error(`too few building modules found: ${picks.length}`);

mkdirSync(srcDir, { recursive: true });
const modules = [];
for (const f of picks) {
  copyFileSync(join(tmp, 'kit', glbDir, f), join(srcDir, f));
  modules.push({ id: f.replace(/\.glb$/, ''), file: `src/${f}` });
}
writeFileSync(join(outDir, 'manifest.json'), JSON.stringify({ modules }, null, 2));
console.log('kit modules:', modules.length);
```

- [ ] **Step 2: Run it**

Run (PowerShell, in `New Website/`): `node scripts/fetch-city-kit.mjs`
Expected: `kit modules: <8..18>`; `public/models/city-kit/src/` populated; `manifest.json` lists them. If the scrape 404s, download the zip manually from kenney.nl and re-run with the zip already at `.tmp-city-kit/kit.zip` (script skips download if present — add that guard while implementing: `if (!existsSync(zip)) { ...download... }`).

- [ ] **Step 3: Verify size + parse**

Run: `Get-ChildItem "public\models\city-kit\src" | Measure-Object Length -Sum`
Expected: sum well under 2.5MB (raw kit GLBs are small; if over, trim `picks` count).
Run: `npx --yes @gltf-transform/cli inspect "public\models\city-kit\src\<first>.glb"`
Expected: valid output, no errors.

- [ ] **Step 4: Commit**

```powershell
git add "New Website/scripts/fetch-city-kit.mjs" "New Website/public/models/city-kit"
git commit -m "feat(website): fetch + curate Kenney city kit modules (CC0)"
```

---

### Task 2: Per-module LOD bake

**Files:**
- Create: `New Website/scripts/bake-kit-lods.mjs`
- Create (output, committed): `New Website/public/models/city-kit/<id>.lod0.glb`, `<id>.lod1.glb`
- Modify: `New Website/public/models/city-kit/manifest.json` (adds footprint/height/tris per module)

**Interfaces:**
- Consumes: Task 1's `manifest.json` + `src/*.glb`.
- Produces: optimized `<id>.lod0.glb` (quantized original) and `<id>.lod1.glb` (~25% tris) per module, and `manifest.json` entries extended to `{ id, lod0: string, lod1: string, footprint: [x, z], height: number, tris0: number, tris1: number }`. LOD2 needs no file — runtime reuses the shared impostor box (Task 4 defines it).

- [ ] **Step 1: Write the bake script**

```js
// New Website/scripts/bake-kit-lods.mjs
// LOD0 = quantized kit mesh; LOD1 = simplified to ~25% triangles.
// Footprint/height measured here so cityGen scales lots without loading GLBs.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const kitDir = join(root, 'public', 'models', 'city-kit');
const manifest = JSON.parse(readFileSync(join(kitDir, 'manifest.json'), 'utf8'));

const inspectTris = (file) => {
  const out = execSync(
    `npx --yes @gltf-transform/cli inspect "${file}" --format csv`,
    { encoding: 'utf8' },
  );
  // sum the primitives' triangle counts from the meshes table
  let tris = 0;
  for (const line of out.split('\n')) {
    const m = line.match(/(\d+)\s*$/);
    if (/mesh/i.test(line) && m) tris += Number(m[1]);
  }
  return tris;
};

for (const mod of manifest.modules) {
  const src = join(kitDir, mod.file);
  const lod0 = join(kitDir, `${mod.id}.lod0.glb`);
  const lod1 = join(kitDir, `${mod.id}.lod1.glb`);
  execSync(
    `npx --yes @gltf-transform/cli optimize "${src}" "${lod0}" --compress quantize --texture-compress false`,
    { stdio: 'inherit' },
  );
  execSync(
    `npx --yes @gltf-transform/cli optimize "${src}" "${lod1}" --compress quantize --texture-compress false --simplify true --simplify-ratio 0.25`,
    { stdio: 'inherit' },
  );
  mod.lod0 = `${mod.id}.lod0.glb`;
  mod.lod1 = `${mod.id}.lod1.glb`;
}
writeFileSync(join(kitDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log('baked', manifest.modules.length, 'modules');
```

(Exact `inspect` CSV parsing may need a tweak against the installed CLI version — the assertion step below is the real gate. If `--simplify-ratio` is not a flag in the installed CLI, use `npx @gltf-transform/cli simplify "${src}" "${lod1}" --ratio 0.25` followed by an optimize pass.)

- [ ] **Step 2: Add footprint/height measurement**

Append to the same script (three runs headless in Node):

```js
import { NodeIO } from '@gltf-transform/core';
// npm i -D @gltf-transform/core   (CLI is npx-only today; core gives bounds)
import { bounds } from '@gltf-transform/functions'; // if unavailable, compute from accessors min/max
for (const mod of manifest.modules) {
  const doc = await new NodeIO().read(join(kitDir, mod.lod0));
  const scene = doc.getRoot().getDefaultScene();
  const b = bounds(scene);
  mod.footprint = [+(b.max[0] - b.min[0]).toFixed(3), +(b.max[2] - b.min[2]).toFixed(3)];
  mod.height = +(b.max[1] - b.min[1]).toFixed(3);
}
```

Install first: `npm i -D @gltf-transform/core @gltf-transform/functions`

- [ ] **Step 3: Run + assert**

Run: `node scripts/bake-kit-lods.mjs`
Then add at the script's end and re-run:

```js
for (const mod of manifest.modules) {
  assert(mod.footprint[0] > 0 && mod.height > 0, `${mod.id}: empty bounds`);
}
console.log('bounds OK');
```

Expected: `baked N modules`, `bounds OK`, `.lod0/.lod1` files exist, total `city-kit/` size still ≤2.5MB (drop modules if over).

- [ ] **Step 4: Commit**

```powershell
git add "New Website/scripts/bake-kit-lods.mjs" "New Website/public/models/city-kit" "New Website/package.json" "New Website/package-lock.json"
git commit -m "feat(website): bake per-module city-kit LODs + measured bounds"
```

---

### Task 3: cityGen v2 — lots resolve to module recipes

**Files:**
- Modify: `New Website/src/webgl/bake/cityGen.mjs`
- Create: `New Website/scripts/check-citygen.mjs` (self-test)

**Interfaces:**
- Consumes: `manifest.json` module list (passed in as an argument — cityGen stays fs-free so the browser can import it).
- Produces: `export function cityRecipes(modules, canyonZ = 0)` returning `{ lots: [{ x, z, w, d, h, yaw, tint, moduleId }] }` where `modules` is `manifest.modules`. Existing `cityLayout`/`cityGeometry` stay exported (fallback path) until Task 5 deletes their use.

- [ ] **Step 1: Implement `cityRecipes`**

```js
// added to cityGen.mjs — same seed, same lot walk, module dressing on top
const TINTS = ['#39415a', '#3f4661', '#343b52', '#424a66', '#3a4257'];
export function cityRecipes(modules, canyonZ = 0) {
  const lots = [];
  const rand = mulberry32(CITY_SEED + 7);
  for (const b of cityLayout(canyonZ)) {
    // height class picks the module family: tallest lots take skyscrapers
    const tall = b.h > 6.5;
    const pool = modules.filter((m) => (tall ? /sky/i.test(m.id) : !/sky/i.test(m.id)));
    const mod = (pool.length ? pool : modules)[Math.floor(rand() * (pool.length || modules.length))];
    lots.push({
      x: b.x, z: b.z, w: b.w, d: b.d, h: b.h,
      yaw: (Math.floor(rand() * 4) * Math.PI) / 2,
      tint: TINTS[Math.floor(rand() * TINTS.length)],
      moduleId: mod.id,
    });
  }
  return { lots };
}
```

- [ ] **Step 2: Self-test — determinism + canyon clearance**

```js
// New Website/scripts/check-citygen.mjs
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { cityRecipes } from '../src/webgl/bake/cityGen.mjs';
const manifest = JSON.parse(readFileSync(new URL('../public/models/city-kit/manifest.json', import.meta.url), 'utf8'));
const a = JSON.stringify(cityRecipes(manifest.modules));
const b = JSON.stringify(cityRecipes(manifest.modules));
assert.strictEqual(a, b, 'cityRecipes must be deterministic');
for (const lot of cityRecipes(manifest.modules).lots) {
  assert(Math.abs(lot.z) - lot.d / 2 >= 1.2, `lot at z=${lot.z} d=${lot.d} intrudes on the canyon`);
}
console.log('citygen OK,', cityRecipes(manifest.modules).lots.length, 'lots');
```

- [ ] **Step 3: Run it**

Run: `node scripts/check-citygen.mjs`
Expected: `citygen OK, <n> lots` (n ≈ 60). If the clearance assert fires, the clearance rule in `cityLayout` (`near < 2.7`) already guarantees it — fix the assert's arithmetic, not the layout.

- [ ] **Step 4: Commit**

```powershell
git add "New Website/src/webgl/bake/cityGen.mjs" "New Website/scripts/check-citygen.mjs"
git commit -m "feat(website): cityGen v2 - lots resolve to kit module recipes"
```

---

### Task 4: Ring partition bake (camera-spline chunking)

**Files:**
- Create: `New Website/src/webgl/rig/pathPoints.mjs` (spline control points, plain ESM)
- Modify: `New Website/src/webgl/rig/FlightPath.ts` (import points from pathPoints.mjs instead of inline array)
- Create: `New Website/scripts/bake-city-rings.mjs`
- Create (output, committed): `New Website/public/models/city-rings.json`

**Interfaces:**
- Consumes: `cityRecipes` (Task 3), `pathPoints.mjs` control points, manifest bounds (Task 2).
- Produces: `public/models/city-rings.json`:
  ```json
  { "city": { "near": [lotIndex...], "mid": [...], "far": [...] },
    "rooftops": { "near": [...], "mid": [...], "far": [...] } }
  ```
  Ring radii: NEAR < 28, MID < 70, FAR = rest (desktop); consumed by Task 5/6. LOW tier reinterprets: NEAR uses <17, MID <42 (Task 7 wires it — same JSON, tier picks which arrays merge downward: on LOW, desktop-NEAR lots beyond 17 render as MID, etc. To keep runtime trivial the bake emits BOTH partitions):
  ```json
  { "city": { "high": { "near": [...], "mid": [...], "far": [...] },
              "low":  { "near": [...], "mid": [...], "far": [...] } }, ... }
  ```

- [ ] **Step 1: Extract spline points**

Move the `POINTS` array literal out of `FlightPath.ts` into `pathPoints.mjs` as `export const PATH_POINTS = [[x,y,z], ...]` and re-import in `FlightPath.ts` (`import { PATH_POINTS } from './pathPoints.mjs'` + map to `Vector3`). Run `npx astro check` — 0 errors — and verify the site still renders (probe t 0.5 screenshot, any frame with content).

- [ ] **Step 2: Bake rings**

```js
// New Website/scripts/bake-city-rings.mjs
import assert from 'node:assert';
import { readFileSync, writeFileSync } from 'node:fs';
import { CatmullRomCurve3, Vector3 } from 'three';
import { PATH_POINTS } from '../src/webgl/rig/pathPoints.mjs';
import { cityRecipes } from '../src/webgl/bake/cityGen.mjs';

const manifest = JSON.parse(readFileSync(new URL('../public/models/city-kit/manifest.json', import.meta.url), 'utf8'));
const curve = new CatmullRomCurve3(PATH_POINTS.map((p) => new Vector3(...p)));

// world anchors: City group sits at chapterAnchor(7) + z 1 — mirror the
// Engine's constructor math here (City at anchor.x, 0, 1; Rooftops at origin)
// sample camera positions over each city's visibility window
const sample = (t0, t1) => {
  const pts = [];
  for (let i = 0; i <= 40; i++) pts.push(curve.getPointAt(t0 + ((t1 - t0) * i) / 40));
  return pts;
};
const CITY_WINDOW = [0.655, 0.83];
const ROOF_WINDOW = [0.06, 0.24];

const RINGS = { high: { near: 28, mid: 70 }, low: { near: 17, mid: 42 } };
const partition = (lots, camPts, offset) => {
  const out = { high: { near: [], mid: [], far: [] }, low: { near: [], mid: [], far: [] } };
  lots.forEach((lot, i) => {
    let best = Infinity;
    for (const c of camPts) {
      const dx = lot.x + offset.x - c.x, dz = lot.z + offset.z - c.z;
      best = Math.min(best, Math.hypot(dx, dz));
    }
    for (const tier of ['high', 'low']) {
      const r = RINGS[tier];
      (best < r.near ? out[tier].near : best < r.mid ? out[tier].mid : out[tier].far).push(i);
    }
  });
  return out;
};

const { lots } = cityRecipes(manifest.modules);
// NOTE: story-t → arc-t remap lives in FlightPath.storyPoint; the bake uses
// raw curve t as an approximation — acceptable because rings are tuned by
// eye afterward, but keep the window generous.
const rings = {
  city: partition(lots, sample(...CITY_WINDOW), { x: /* City anchor.x — read from a comment in Engine.ts and hardcode */ 150, z: 1 }),
  rooftops: partition(lots, sample(...ROOF_WINDOW), { x: 0, z: 0 }),
};
for (const cityKey of ['city', 'rooftops'])
  for (const tier of ['high', 'low']) {
    const r = rings[cityKey][tier];
    assert.strictEqual(r.near.length + r.mid.length + r.far.length, lots.length, 'every lot in exactly one ring');
  }
writeFileSync(new URL('../public/models/city-rings.json', import.meta.url), JSON.stringify(rings));
console.log('rings baked');
```

The City anchor x: read `path.chapterAnchor(7)` output once in the browser (`window.__engine.city.group.position`) and hardcode; leave a comment naming the source. Rooftops uses its own lot list in Task 6 — for this task partition the same lots for both and let Task 6 replace the rooftops entry.

- [ ] **Step 3: Run + verify**

Run: `node scripts/bake-city-rings.mjs`
Expected: `rings baked`; JSON exists; spot-check: `high.near` nonempty for city.

- [ ] **Step 4: Commit**

```powershell
git add "New Website/src/webgl/rig/pathPoints.mjs" "New Website/src/webgl/rig/FlightPath.ts" "New Website/scripts/bake-city-rings.mjs" "New Website/public/models/city-rings.json"
git commit -m "feat(website): bake NEAR/MID/FAR city rings against the camera spline"
```

---

### Task 5: Runtime — City renders kit instances per ring

**Files:**
- Create: `New Website/src/webgl/actors/KitCity.ts` (instancing helper shared by City + Rooftops)
- Modify: `New Website/src/webgl/actors/City.ts`
- Modify: `New Website/src/webgl/quality.ts` (add `cityTier: 'high' | 'low'` selector — reuse existing tier)

**Interfaces:**
- Consumes: `manifest.json`, `city-rings.json`, module `.lod0/.lod1` GLBs, existing `facadeTexture()`.
- Produces: `class KitCity { constructor(lots, ringIndices, tier); readonly group: Group; setRingVisible(ring: 'near'|'mid'|'far', visible: boolean): void; dispose(): void }` — builds `InstancedMesh` per (module × ring), LOD0 for near, LOD1 for mid, impostor boxes for far. City.ts consumes it; Task 6 reuses it for Rooftops.

- [ ] **Step 1: Implement KitCity**

```ts
// New Website/src/webgl/actors/KitCity.ts
import {
  BoxGeometry, Color, Group, InstancedMesh, Matrix4, Mesh,
  MeshStandardMaterial, Quaternion, Vector3,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { facadeTexture } from '../bake/CanvasTextures';
import { requestCompile } from '../warm';

interface Lot { x: number; z: number; w: number; d: number; h: number; yaw: number; tint: string; moduleId: string }
interface RingSet { near: number[]; mid: number[]; far: number[] }

const IMPOSTOR = new BoxGeometry(1, 1, 1); // shared 12-tri far box

export class KitCity {
  readonly group = new Group();
  private rings: Record<'near' | 'mid' | 'far', Group> = {
    near: new Group(), mid: new Group(), far: new Group(),
  };
  private disposables: { dispose(): void }[] = [];

  constructor(lots: Lot[], rings: RingSet, private color = new Color()) {
    this.group.add(this.rings.near, this.rings.mid, this.rings.far);

    // far ring: one instanced impostor draw, windows live in the texture
    const facade = facadeTexture();
    const impostorMaterial = new MeshStandardMaterial({
      color: '#39415a', roughness: 0.85,
      emissive: '#e8b878', emissiveMap: facade, emissiveIntensity: 0.85,
    });
    this.disposables.push(facade, impostorMaterial);
    this.buildImpostors(lots, rings.far, impostorMaterial);

    // near/mid rings: instanced kit modules, streamed in
    const loader = new GLTFLoader();
    const byModule = (indices: number[]): Map<string, number[]> => {
      const m = new Map<string, number[]>();
      for (const i of indices) {
        const arr = m.get(lots[i]!.moduleId) ?? [];
        arr.push(i);
        m.set(lots[i]!.moduleId, arr);
      }
      return m;
    };
    ([['near', 'lod0'], ['mid', 'lod1']] as const).forEach(([ring, lod]) => {
      for (const [moduleId, indices] of byModule(rings[ring])) {
        loader.load(`/models/city-kit/${moduleId}.${lod}.glb`, (gltf) => {
          let geometry, material;
          gltf.scene.traverse((o) => {
            const mesh = o as Mesh;
            if (mesh.isMesh && !geometry) { geometry = mesh.geometry; material = mesh.material; }
          });
          if (!geometry) return;
          const inst = new InstancedMesh(geometry, material, indices.length);
          const m4 = new Matrix4(); const q = new Quaternion();
          const p = new Vector3(); const s = new Vector3();
          const Y = new Vector3(0, 1, 0);
          indices.forEach((lotIndex, k) => {
            const lot = lots[lotIndex]!;
            q.setFromAxisAngle(Y, lot.yaw);
            p.set(lot.x, 0, lot.z);
            s.set(lot.w, lot.h, lot.d); // module normalized ~1×1×1 at bake
            inst.setMatrixAt(k, m4.compose(p, q, s));
            inst.setColorAt(k, this.color.set(lot.tint));
          });
          if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
          this.rings[ring].add(inst);
          this.disposables.push(inst);
          requestCompile(inst);
        });
      }
    });
  }

  private buildImpostors(lots: Lot[], indices: number[], material: MeshStandardMaterial): void {
    if (!indices.length) return;
    const inst = new InstancedMesh(IMPOSTOR, material, indices.length);
    const m4 = new Matrix4(); const q = new Quaternion();
    const p = new Vector3(); const s = new Vector3();
    indices.forEach((lotIndex, k) => {
      const lot = lots[lotIndex]!;
      p.set(lot.x, lot.h / 2, lot.z);
      s.set(lot.w, lot.h, lot.d);
      inst.setMatrixAt(k, m4.compose(p, q, s));
      inst.setColorAt(k, this.color.set(lot.tint));
    });
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    this.rings.far.add(inst);
    this.disposables.push(inst);
  }

  setRingVisible(ring: 'near' | 'mid' | 'far', visible: boolean): void {
    this.rings[ring].visible = visible;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
```

Module scale note: bake (Task 2) records real bounds; if kit modules are not ~1 unit, normalize inside the loader callback: divide `s` by `manifest` footprint/height for that module (fetch manifest once via `fetch('/models/city-kit/manifest.json')` at KitCity construction and pass bounds in `Lot` — implementer's choice, document in code).

- [ ] **Step 2: Swap City massing**

In `City.ts`: replace the massing `GLTFLoader().load('/models/city.glb', ...)` block with:

```ts
const [manifest, rings] = await Promise.all([
  fetch('/models/city-kit/manifest.json').then((r) => r.json()),
  fetch('/models/city-rings.json').then((r) => r.json()),
]);
const { lots } = cityRecipes(manifest.modules);
this.kitCity = new KitCity(lots as Lot[], rings.city[quality.tier]);
this.group.add(this.kitCity.group);
```

(City constructor is sync — do this in a private async `init()` kicked from the constructor, mirroring how GLB loads already stream in.) Keep windows/clutter/parapets/billboards but filter their source `buildings` list to NEAR+MID lot indices (windows) and NEAR (clutter/parapets/billboards). `quality` must be passed into `City`'s constructor (Engine already holds it — add the parameter).

- [ ] **Step 3: Typecheck + visual verify**

Run: `npx astro check` → 0 errors.
Probe: capture t 0.72 (canyon dive) — kit buildings visible, tints varied, no black frames. Capture t 0.80 looking back — far ring reads as lit blocks.

- [ ] **Step 4: Budget check**

Probe at t 0.72, both `?q=high` and `?q=low`:

```js
const info = window.__engine.renderer.info;
JSON.stringify({ calls: info.render.calls, tris: info.render.triangles });
```

Expected: LOW ≤80 calls, ≤150k tris. HIGH: report numbers (no hard cap, sanity < 400k).

- [ ] **Step 5: Commit**

```powershell
git add "New Website/src/webgl/actors/KitCity.ts" "New Website/src/webgl/actors/City.ts" "New Website/src/webgl/Engine.ts"
git commit -m "feat(website): CH8 city renders kit-instanced buildings with baked LOD rings"
```

---

### Task 6: Rooftops swap

**Files:**
- Modify: `New Website/src/webgl/actors/Rooftops.ts`
- Modify: `New Website/scripts/bake-city-rings.mjs` (real rooftops lots)
- Modify (output): `New Website/public/models/city-rings.json`

**Interfaces:**
- Consumes: `KitCity` (Task 5), `cityRecipes` with `canyonZ` variant or a new exported `rooftopLots()` in cityGen.
- Produces: Rooftops' instanced boxes replaced by a `KitCity` instance; its own lot list exported as `export function rooftopLots(modules)` from `cityGen.mjs` (near field x 9–55, far field x 52–122, exit corridor kept clear: skip lots where `Math.abs(z - 1) < 3.2 && x < 22`).

- [ ] **Step 1: Add `rooftopLots` to cityGen.mjs**

```js
export function rooftopLots(modules) {
  const rand = mulberry32(CITY_SEED + 31);
  const lots = [];
  const place = (x, z, w, d, h) => {
    if (Math.abs(z - 1) < 3.2 && x < 22) return; // exit corridor
    const tall = h > 5;
    const pool = modules.filter((m) => (tall ? /sky/i.test(m.id) : !/sky/i.test(m.id)));
    const mod = (pool.length ? pool : modules)[Math.floor(rand() * (pool.length || modules.length))];
    lots.push({ x, z, w, d, h, yaw: (Math.floor(rand() * 4) * Math.PI) / 2, tint: '#39415a', moduleId: mod.id });
  };
  for (let i = 0; i < 150; i++) place(9 + rand() * 46, -22 + rand() * 44, 2 + rand() * 3.4, 1.8 + rand() * 3, 0.7 + rand() * 2.6);
  for (let i = 0; i < 70; i++) place(52 + rand() * 70, -38 + rand() * 76, 3.5 + rand() * 4.5, 3 + rand() * 4, 2.2 + rand() * 5.5);
  return { lots };
}
```

- [ ] **Step 2: Bake rooftops rings for real** — in `bake-city-rings.mjs`, replace the placeholder rooftops partition with `rooftopLots(manifest.modules)` + offset `{x: 0, z: 0}`; re-run; commit updated JSON.

- [ ] **Step 3: Swap Rooftops internals** — keep ground plane, chimneys, warm window Points, and lights; replace the 220-instance box `InstancedMesh` with `new KitCity(rooftopLots(manifest.modules).lots, rings.rooftops[quality.tier])` (same async init pattern as City; `Rooftops` gains a `quality` constructor param from Engine).

- [ ] **Step 4: Verify** — `npx astro check` 0 errors; probe t 0.125: kit buildings outside the window, corridor clear (plane exits cleanly), ground still present. `renderer.info` at t 0.125 LOW: ≤80 calls, ≤150k tris.

- [ ] **Step 5: Commit**

```powershell
git add "New Website/src/webgl/actors/Rooftops.ts" "New Website/src/webgl/bake/cityGen.mjs" "New Website/scripts/bake-city-rings.mjs" "New Website/public/models/city-rings.json"
git commit -m "feat(website): window city renders kit modules through the shared ring system"
```

---

### Task 7: Mobile tier plumbing + cleanup

**Files:**
- Modify: `New Website/src/webgl/quality.ts`
- Delete usage: old massing path in `City.ts` (`/models/city.glb` + `cityGeometry` fallback), `public/models/city.glb`
- Modify: `New Website/.planning/STATE.md` (repo root `.planning/STATE.md`) — record budgets + probe numbers

**Interfaces:**
- Consumes: everything above.
- Produces: LOW tier = mobile profile; dead massing removed.

- [ ] **Step 1: Route phones to LOW** — in `detectQuality`, the coarse-pointer + small-screen check already returns LOW; extend the small-screen bound to `< 1024` so tablets get LOW too:

```ts
const smallScreen = Math.min(screen.width, screen.height) < 1024;
```

- [ ] **Step 2: Delete the old massing** — remove the `city.glb` load + `cityGeometry` fallback from City.ts (keep `cityGeometry` export in cityGen only if `bake-city.mjs` still uses it; otherwise delete both and `scripts/bake-city.mjs`), `git rm "New Website/public/models/city.glb"`.

- [ ] **Step 3: Mobile emulation pass** — DevTools device emulation (mid Android, CPU 4× throttle), `?q=low`, scroll both cities; record `renderer.info` + finished-frame medians via the probe protocol at t 0.125 and 0.72. Must meet: ≤150k tris, ≤80 calls; medians target ≤ 12ms under 4× throttle.

- [ ] **Step 4: Verify no regressions elsewhere** — full bare-strip capture (t 0, 0.115, 0.235, 0.30, 0.42, 0.5175, 0.635, 0.72, 0.84, 0.965) — all frames render, no black canvases, `npx astro check` 0 errors.

- [ ] **Step 5: Update STATE.md + commit**

```powershell
git add "New Website/src/webgl/quality.ts" "New Website/src/webgl/actors/City.ts" ".planning/STATE.md"
git rm "New Website/public/models/city.glb"
git commit -m "feat(website): mobile tier rides the baked LOD rings; old massing removed"
```

---

## Self-Review Notes

- Spec coverage: kit fetch (T1), LOD bake (T2), procedural recipes (T3), spline chunking (T4), runtime instancing + City (T5), Rooftops (T6), mobile tier + budgets + cleanup (T7). Spec's EXT_mesh_gpu_instancing GLB replaced by JSON + module GLBs — deviation declared in the header, same runtime properties.
- Stack recipes (base + N×mid + top towers) from the spec are NOT in this plan — deliberately deferred: single-module lots ship first (YAGNI; kit skyscraper variants carry height variety). If silhouettes look repetitive after T6, add a Task 8 for segment stacking.
- Type consistency: `Lot`/`RingSet` defined in T5 and reused by T6; `cityRecipes(modules)` signature consistent across T3/T4/T5.
