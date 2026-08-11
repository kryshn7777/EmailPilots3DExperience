// Fetches the Kenney City Kit (Commercial) zip (CC0), unzips it, and copies
// a curated set of building GLBs into public/models/city-kit/src/.
// Bootstrap-only: committed GLBs are the source of truth (URL hashes rot).
import { execSync } from 'node:child_process';
import { mkdirSync, readdirSync, copyFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'models', 'city-kit');
const srcDir = join(outDir, 'src');
const tmp = join(root, '.tmp-city-kit');
const zip = join(tmp, 'kit.zip');

mkdirSync(tmp, { recursive: true });
if (!existsSync(zip)) {
  // scrape the download href from the asset page (same pipe that fetched the
  // pirate kit): /media/pages/assets/city-kit-commercial/<hash>/<file>.zip
  const page = await (await fetch('https://kenney.nl/assets/city-kit-commercial')).text();
  const m = page.match(/https:\/\/kenney\.nl\/media\/pages\/assets\/city-kit-commercial\/[^"]+\.zip/);
  if (!m) throw new Error('download link not found on asset page');
  console.log('downloading', m[0]);
  const buf = Buffer.from(await (await fetch(m[0])).arrayBuffer());
  writeFileSync(zip, buf);
}
if (!existsSync(join(tmp, 'kit'))) {
  // execSync is safe here: zip/tmp are hardcoded repo-relative constants
  // (same reasoning as fetch-models.mjs); Expand-Archive needs the shell.
  execSync(`powershell -NoProfile -Command "Expand-Archive -Force '${zip}' '${tmp}\\kit'"`);
}

// find the GLB dir wherever the zip nests it
const findGlbDir = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const full = join(dir, entry.name);
    if (/glb format/i.test(entry.name)) return full;
    const nested = findGlbDir(full);
    if (nested) return nested;
  }
  return null;
};
const glbDir = findGlbDir(join(tmp, 'kit'));
if (!glbDir) throw new Error('GLB format dir not found in kit zip');

// curate: 10 modules keeps the committed LOD set under the 2.5MB budget —
// yaw + tint + non-uniform lot scale carry the variety
const all = readdirSync(glbDir).filter((f) => f.endsWith('.glb'));
const WANTED = [
  'building-a.glb', 'building-c.glb', 'building-e.glb',
  'building-g.glb', 'building-i.glb', 'building-k.glb',
  'building-skyscraper-a.glb', 'building-skyscraper-b.glb',
  'building-skyscraper-c.glb', 'building-skyscraper-d.glb',
];
const picks = WANTED.filter((f) => all.includes(f));
if (picks.length < 8) {
  console.log('available files:', all.join(', '));
  throw new Error(`too few building modules found: ${picks.length}`);
}

mkdirSync(srcDir, { recursive: true });
const modules = [];
for (const f of picks) {
  copyFileSync(join(glbDir, f), join(srcDir, f));
  modules.push({ id: f.replace(/\.glb$/, ''), file: `src/${f}` });
}
// Kenney GLBs reference an external Textures/colormap.png — ship it beside them
const texDir = join(glbDir, 'Textures');
if (existsSync(texDir)) {
  mkdirSync(join(srcDir, 'Textures'), { recursive: true });
  for (const t of readdirSync(texDir)) copyFileSync(join(texDir, t), join(srcDir, 'Textures', t));
}
writeFileSync(join(outDir, 'manifest.json'), JSON.stringify({ modules }, null, 2));
const total = picks.reduce((s, f) => s + statSync(join(srcDir, f)).size, 0);
console.log('kit modules:', modules.length, '· raw bytes:', total);
