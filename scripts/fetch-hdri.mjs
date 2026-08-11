// Fetches the one external asset: a CC0 1k HDRI from Poly Haven, committed to
// public/hdri/. Manual (`npm run setup:assets`) — never a postinstall, so
// offline installs keep working. The engine falls back to RoomEnvironment
// PMREM when the file is absent.
import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { get } from 'node:https';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'hdri');
const outFile = join(outDir, 'sky_1k.hdr');
// night sky matches the overnight arc (CC0, Poly Haven)
const url = 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/dikhololo_night_1k.hdr';

if (existsSync(outFile)) {
  console.log('HDRI already present:', outFile);
  process.exit(0);
}

mkdirSync(outDir, { recursive: true });

function download(target, redirectsLeft = 3) {
  get(target, (res) => {
    if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      if (redirectsLeft === 0) throw new Error('Too many redirects');
      download(res.headers.location, redirectsLeft - 1);
      return;
    }
    if (res.statusCode !== 200) {
      console.error(`Download failed: HTTP ${res.statusCode}`);
      process.exit(1);
    }
    res.pipe(createWriteStream(outFile)).on('finish', () => {
      console.log('Saved', outFile);
    });
  }).on('error', (err) => {
    console.error('Download failed:', err.message);
    process.exit(1);
  });
}

download(url);
