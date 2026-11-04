// Measures the roofs of the night city's block modules for the rooftop props (actors/CityLife.ts).
//
// The kit towers are baked meshes, so where a roof is flat and clear (and how high it is) is read off
// the hero GLBs themselves: every upward-facing triangle is rasterised into a 40 x 40 height grid over
// the module's footprint, in the frame KitCity fits a hero module by (its shell's footprint and height,
// standing on y = 0). A cell is kept when it is flat (its neighbours within 2 cm) and at least 70% of
// the way up the module, so parapets, crowns, baked rooftop plant and setbacks below are never chosen.
//
//   node scripts/bake-city-roofs.mjs      # writes public/models/city-props/roofs.json
//
// Rerun whenever a block module is rebuilt (blender/make_buildings.py).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const N = 40;
const kit = new URL('../public/models/city-kit/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', kit), 'utf8'));
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

const mul = (m, x, y, z) => [
  m[0] * x + m[4] * y + m[8] * z + m[12],
  m[1] * x + m[5] * y + m[9] * z + m[13],
  m[2] * x + m[6] * y + m[10] * z + m[14],
];

const out = {};
for (const mod of manifest.modules.filter((m) => m.lean && m.kind === 'block')) {
  const doc = await io.read(new URL(mod.lod0, kit).pathname);
  const [fw, fd] = mod.footprint;
  const grid = new Float32Array(N * N).fill(-1);
  let bmin = [Infinity, Infinity, Infinity];
  let bmax = [-Infinity, -Infinity, -Infinity];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      const idx = prim.getIndices();
      const n = idx ? idx.getCount() : pos.getCount();
      const v = [];
      const el = [0, 0, 0];
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, el);
        const p = mul(m, el[0], el[1], el[2]);
        v.push(p);
        for (let k = 0; k < 3; k++) { bmin[k] = Math.min(bmin[k], p[k]); bmax[k] = Math.max(bmax[k], p[k]); }
      }
      for (let t = 0; t < n; t += 3) {
        const a = v[idx ? idx.getScalar(t) : t];
        const b = v[idx ? idx.getScalar(t + 1) : t + 1];
        const c = v[idx ? idx.getScalar(t + 2) : t + 2];
        // face normal (y component, normalised)
        const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
        const wx = c[0] - a[0], wy = c[1] - a[1], wz = c[2] - a[2];
        const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
        const len = Math.hypot(nx, ny, nz) || 1;
        // either winding: a roof is a horizontal face, the top-most one wins
        if (Math.abs(ny) / len < 0.97) continue;
        const gx = (p) => ((p[0] / fw) + 0.5) * N;
        const gz = (p) => ((p[2] / fd) + 0.5) * N;
        const x0 = Math.max(0, Math.floor(Math.min(gx(a), gx(b), gx(c))));
        const x1 = Math.min(N - 1, Math.ceil(Math.max(gx(a), gx(b), gx(c))));
        const z0 = Math.max(0, Math.floor(Math.min(gz(a), gz(b), gz(c))));
        const z1 = Math.min(N - 1, Math.ceil(Math.max(gz(a), gz(b), gz(c))));
        const y = (a[1] + b[1] + c[1]) / 3;
        for (let i = x0; i <= x1; i++) {
          for (let j = z0; j <= z1; j++) {
            // the cell centre inside the triangle (2D, x/z)
            const px = ((i + 0.5) / N - 0.5) * fw;
            const pz = ((j + 0.5) / N - 0.5) * fd;
            const d = (p, q, r) => (p[0] - r[0]) * (q[2] - r[2]) - (q[0] - r[0]) * (p[2] - r[2]);
            const P = [px, 0, pz];
            const d1 = d(P, a, b), d2 = d(P, b, c), d3 = d(P, c, a);
            const neg = d1 < 0 || d2 < 0 || d3 < 0;
            const pos_ = d1 > 0 || d2 > 0 || d3 > 0;
            if (neg && pos_) continue;
            grid[j * N + i] = Math.max(grid[j * N + i], y);
          }
        }
      }
    }
  }
  // keep flat cells near the top whose 8 neighbours are the same height
  const top = mod.height;
  if (process.env.DEBUG) { const h = {}; for (const y of grid) { const k = (y / top).toFixed(2); h[k] = (h[k] || 0) + 1; } console.log(mod.id, JSON.stringify(h)); }
  const cells = [];
  for (let j = 1; j < N - 1; j++) {
    for (let i = 1; i < N - 1; i++) {
      const y = grid[j * N + i];
      if (y < top * 0.7) continue;
      let flat = true;
      for (let dj = -1; dj <= 1 && flat; dj++) for (let di = -1; di <= 1; di++) {
        if (Math.abs(grid[(j + dj) * N + i + di] - y) > 0.004) { flat = false; break; }
      }
      if (flat) cells.push([i, j, Math.round((y / top) * 10000) / 10000]);
    }
  }
  out[mod.lean] = { n: N, cells };
  console.log(mod.id.padEnd(22), 'bounds', bmin.map((x) => x.toFixed(3)).join(','), '..', bmax.map((x) => x.toFixed(3)).join(','),
    'footprint', fw, fd, 'h', mod.height, 'flat cells', cells.length);
}
mkdirSync(new URL('../public/models/city-props/', import.meta.url), { recursive: true });
writeFileSync(new URL('../public/models/city-props/roofs.json', import.meta.url), JSON.stringify(out));
