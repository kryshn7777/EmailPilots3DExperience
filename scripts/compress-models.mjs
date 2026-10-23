// Compresses the buildings', trees' and biplane's GLBs in place (public/models/city-kit, public/models/homes,
// public/models/biplane):
// welds identical vertices, quantizes them (KHR_mesh_quantization) and packs the buffers with
// meshopt (EXT_meshopt_compression), which KitCity decodes with three's MeshoptDecoder.
//
// The Blender exporter writes every face of a hero building on vertices of its own, so a 165k
// triangle tower came out at 13 MB; this takes it to a fraction of that. UV sets outside 0..1
// (the window glass's room code and size, see blender/bld/model.py `glass_object`) are left as
// floats by the quantizer, so they arrive exact.
//
//   node scripts/compress-models.mjs            # every GLB not yet compressed
//   node scripts/compress-models.mjs --force    # re-encode all of them
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Logger, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const DIRS = ['public/models/city-kit', 'public/models/homes', 'public/models/biplane', 'public/models/airliner'];
const force = process.argv.includes('--force');

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO()
  .setLogger(new Logger(Logger.Verbosity.WARN))
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

let before = 0;
let after = 0;
for (const dir of DIRS) {
  const root = new URL(`../${dir}/`, import.meta.url);
  for (const name of readdirSync(root).filter((f) => f.endsWith('.glb')).sort()) {
    const path = join(root.pathname, name);
    const doc = await io.read(path);
    const done = doc.getRoot().listExtensionsUsed().some((e) => e.extensionName === 'EXT_meshopt_compression');
    if (done && !force) continue;
    const size0 = statSync(path).size;
    await doc.transform(weld(), meshopt({ encoder: MeshoptEncoder, level: 'high' }));
    await io.write(path, doc);
    const size1 = statSync(path).size;
    before += size0;
    after += size1;
    console.log(`${dir.split('/').pop()}/${name}`.padEnd(48), `${(size0 / 1024).toFixed(0).padStart(6)} KB -> ${(size1 / 1024).toFixed(0).padStart(5)} KB`);
  }
}
console.log(before ? `total ${(before / 1048576).toFixed(1)} MB -> ${(after / 1048576).toFixed(1)} MB` : 'nothing to compress');
