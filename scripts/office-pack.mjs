// Finishes the office props' GLB that Blender exported (blender/make_it_office.py runs this):
//
// - Every prop's root node becomes a plain group with an identity transform and its mesh moves to a
//   child node (`<name>_mesh`). compress:models quantizes positions and stores the dequantization
//   as the mesh node's scale and translation; on a child that leaves the root node, which the
//   engine positions, at the prop's floor-centre origin.
// - Attaches the shared atlas: the `office` material gets the colour (sRGB), ORM (occlusion +
//   roughness/metalness, linear) and normal (linear) WebP maps; the `led` material samples the
//   colour atlas's LED palette cells for both its base colour and its emission. The screens, bulb,
//   panel and whiteboard face keep plain factors (the engine drives or draws on them).
//
//   node scripts/office-pack.mjs <glb> <color.webp> <orm.webp> <normal.webp>
import { readFileSync } from 'node:fs';
import { Logger, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';

const [glb, colorPath, ormPath, normalPath] = process.argv.slice(2);
const io = new NodeIO().setLogger(new Logger(Logger.Verbosity.WARN)).registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(glb);

let nested = 0;
for (const scene of doc.getRoot().listScenes()) {
  for (const node of scene.listChildren()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const child = doc.createNode(`${node.getName()}_mesh`).setMesh(mesh);
    node.setMesh(null).addChild(child);
    nested++;
  }
}

let found = 0;
if (colorPath) {
  doc.createExtension(EXTTextureWebP).setRequired(true);
  const tex = (path, name) => doc.createTexture(name).setImage(readFileSync(path)).setMimeType('image/webp').setURI(`${name}.webp`);
  const color = tex(colorPath, 'office-color');
  const orm = tex(ormPath, 'office-orm');
  const normal = tex(normalPath, 'office-normal');
  for (const m of doc.getRoot().listMaterials()) {
    if (m.getName() === 'office') {
      m.setBaseColorTexture(color).setMetallicRoughnessTexture(orm).setOcclusionTexture(orm).setNormalTexture(normal);
      m.setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(1).setMetallicFactor(1).setOcclusionStrength(1).setNormalScale(1);
      found++;
    } else if (m.getName() === 'led') {
      m.setBaseColorTexture(color).setEmissiveTexture(color).setEmissiveFactor([1, 1, 1]).setMetallicFactor(0);
      found++;
    }
  }
  if (!found) throw new Error('no office/led material in ' + glb);
}
await io.write(glb, doc);
console.log(`${nested} props nested under group nodes; textures attached to ${found} materials`);
