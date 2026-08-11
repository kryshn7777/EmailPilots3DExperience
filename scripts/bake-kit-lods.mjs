// Per-module city-kit LOD bake (fully programmatic — no CLI flag drift):
// LOD0 = welded+quantized kit mesh; LOD1 = meshopt-simplified to ~25% tris.
// Also measures footprint/height into manifest.json so cityGen can scale
// lots without loading GLBs. LOD2 needs no file — runtime shares one
// impostor box with the emissive facade texture.
import assert from 'node:assert';
import { readFileSync, writeFileSync, statSync, copyFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO, getBounds } from '@gltf-transform/core';
import { dedup, weld, quantize, simplify } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

// every kit GLB references the same colormap palette — embedding it 36×
// blew the size budget. Strip textures here; the runtime assigns ONE shared
// colormap material to every instanced mesh (UVs survive the strip).
const stripTextures = (doc) => {
  for (const material of doc.getRoot().listMaterials()) {
    material.setBaseColorTexture(null);
    material.setMetallicRoughnessTexture(null);
    material.setNormalTexture(null);
    material.setOcclusionTexture(null);
    material.setEmissiveTexture(null);
  }
  for (const texture of doc.getRoot().listTextures()) texture.dispose();
};

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const kitDir = join(root, 'public', 'models', 'city-kit');
const manifest = JSON.parse(readFileSync(join(kitDir, 'manifest.json'), 'utf8'));
const io = new NodeIO();

const triCount = (doc) => {
  let tris = 0;
  for (const mesh of doc.getRoot().listMeshes())
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      tris += (idx ? idx.getCount() : prim.getAttribute('POSITION').getCount()) / 3;
    }
  return Math.round(tris);
};

let totalBytes = 0;
for (const mod of manifest.modules) {
  const src = join(kitDir, mod.file);

  const lod0 = await io.read(src);
  await lod0.transform(dedup(), weld());
  const scene = lod0.getRoot().getDefaultScene() ?? lod0.getRoot().listScenes()[0];
  // NOTE: these are the SOURCE dimensions. quantize() renormalises POSITION
  // and compensates with a node scale that getBounds() accounts for but
  // three's GLTFLoader does not carry into mesh.geometry — three sees each
  // module with its largest dimension normalised to 2. cityGen scales lots by
  // lodScale() to bridge the two; see the comment there.
  const b = getBounds(scene);
  mod.footprint = [+(b.max[0] - b.min[0]).toFixed(3), +(b.max[2] - b.min[2]).toFixed(3)];
  mod.height = +(b.max[1] - b.min[1]).toFixed(3);
  mod.tris0 = triCount(lod0);
  stripTextures(lod0);
  await lod0.transform(quantize());
  const lod0File = join(kitDir, `${mod.id}.lod0.glb`);
  await io.write(lod0File, lod0);
  mod.lod0 = `${mod.id}.lod0.glb`;
  totalBytes += statSync(lod0File).size;

  /**
   * NO decimated mesh LODs, and this is measured rather than assumed. Asking
   * meshopt for 40% of the triangles returns 6-33% off, and asking for 15%
   * with a 4x larger error budget returns 6-35% — the same geometry twice.
   * The kit is flat-shaded: every hard edge is a normal split, weld cannot
   * merge across it, and there is no interior detail left to collapse. Two
   * extra files per module cost 1.5MB to save a handful of triangles.
   *
   * The LOD that works on a blocky building is a box. FAR rides the shared
   * emissive-facade impostor (12 triangles against ~1800), which is the
   * ~100x win; NEAR and MID keep the real module, so everything the camera
   * can actually resolve is real geometry.
   */
  delete mod.lod1;
  delete mod.lod2;
  delete mod.tris1;
  delete mod.tris2;

  assert(mod.footprint[0] > 0 && mod.footprint[1] > 0 && mod.height > 0, `${mod.id}: empty bounds`);
}

// the one shared palette, served once
const colormapSrc = join(kitDir, 'src', 'Textures', 'colormap.png');
if (existsSync(colormapSrc)) {
  copyFileSync(colormapSrc, join(kitDir, 'colormap.png'));
  totalBytes += statSync(join(kitDir, 'colormap.png')).size;
  manifest.colormap = 'colormap.png';
}

writeFileSync(join(kitDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
assert(totalBytes <= 2.5 * 1024 * 1024, `LOD set over budget: ${totalBytes} bytes`);
console.log(
  'baked', manifest.modules.length, 'modules ·',
  Math.round(totalBytes / 1024), 'KB ·',
  'tris0 avg', Math.round(manifest.modules.reduce((s, m) => s + m.tris0, 0) / manifest.modules.length),
);
