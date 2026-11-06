// Compresses the buildings', trees', biplane's, ship's, cars', props', office, people and ending GLBs in place (public/models/city-kit, homes,
// ship, cars, biplane, airliner, city-props, yard-props, office, people, birds, cafe, comm-tower, recipient-room):
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

const DIRS = ['public/models/city-kit', 'public/models/homes', 'public/models/biplane', 'public/models/airliner', 'public/models/ship', 'public/models/cars',
  'public/models/city-props', 'public/models/yard-props', 'public/models/office', 'public/models/people', 'public/models/birds', 'public/models/cafe',
  'public/models/comm-tower', 'public/models/recipient-room'];
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
    // the cars' clear-coated paint mirrors the street, so its normals keep 12 bits (16-bit storage):
    // the default 8 bits band the reflections on a smooth body
    // the office props sample one 2048 px atlas: their UVs keep 14 bits (12 can shift a texel) and
    // their normals and tangents 10, for the smooth plastics and the baked normal map; the people's atlas
    // (4096) keeps 14 bits too (a quarter texel) and their normals 10
    const extra = dir.endsWith('/cars') ? { quantizeNormal: 12 }
      : dir.endsWith('/office') ? { quantizeNormal: 10, quantizeTexcoord: 14 }
      : dir.endsWith('/people') ? { quantizeNormal: 10, quantizeTexcoord: 14 }
      // the birds' feather cards sample slots a few texels wide in a 1024 atlas: 14-bit UVs, 10-bit normals
      : dir.endsWith('/birds') ? { quantizeNormal: 10, quantizeTexcoord: 14 }
      // the café terrace's props sample 256 px tiles of one 1024 atlas: 14-bit UVs too
      : dir.endsWith('/cafe') ? { quantizeNormal: 10, quantizeTexcoord: 14 }
      // the ending's tower and house sample 256 px cells of their atlases, and the tower's glass tube carries its
      // arc length in uv.y for the light streak: 14-bit UVs, 10-bit normals
      : dir.endsWith('/comm-tower') || dir.endsWith('/recipient-room') ? { quantizeNormal: 10, quantizeTexcoord: 14 } : {};
    await doc.transform(weld(), meshopt({ encoder: MeshoptEncoder, level: 'high', ...extra }));
    await io.write(path, doc);
    const size1 = statSync(path).size;
    before += size0;
    after += size1;
    console.log(`${dir.split('/').pop()}/${name}`.padEnd(48), `${(size0 / 1024).toFixed(0).padStart(6)} KB -> ${(size1 / 1024).toFixed(0).padStart(5)} KB`);
  }
}
console.log(before ? `total ${(before / 1048576).toFixed(1)} MB -> ${(after / 1048576).toFixed(1)} MB` : 'nothing to compress');
