// The copy guardrails, as a check: `node scripts/check-copy.mjs` exits 1 on a hit.
//
// Scans every source file under src/ (and README.md) for:
//  - FEATURES.md Appendix B's banned framing (read from FEATURES.md itself, so the list lives in one place);
//  - the scene direction's honesty rules: no price, no plan or tier names, no trial; no inbox-placement promise
//    and no bounce-rate stat; and no "Plane N" (every landing is a named person, story/fleet.ts).
// The word "spam" is allowed for the folder and the filters only; that one needs a human read.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const features = readFileSync(join(root, 'FEATURES.md'), 'utf8');
const bannedLine = features.split('\n').find((l) => l.includes('Banned framing')) ?? '';
// the line runs on: take the quoted phrases up to the end of its paragraph
const para = features.slice(features.indexOf(bannedLine)).split('\n\n')[0].split('\n- **The word')[0];
const banned = [...para.matchAll(/"([^"]+)"/g)].map((m) => m[1]);

const RULES = [
  ...banned.map((p) => ({ why: `Appendix B banned framing "${p}"`, re: new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') })),
  { why: 'placement promise', re: /primary inbox|inbox placement guarantee|guaranteed (to land|delivery)/i },
  { why: 'bounce-rate stat', re: /bounce rate|0% (average )?bounce/i },
  { why: 'trial', re: /free trial|\d+-day trial|trial period|start (the|your) trial/i },
  { why: 'price', re: /\$\s?\d|\d\s?(usd|eur)\b|\/\s?(week|wk|mo|month)\b|per (week|month)/i },
  { why: 'plan or tier name', re: /first class|\bsolo (plan|tier)\b|['"]solo['"]|free forever|business suite|\bpro plan\b|upgrade to/i },
  { why: '"Plane N" (landings are named people)', re: /\bPlane \d/ },
];

const SKIP = new Set(['node_modules', 'dist', '.astro']);
const EXT = /\.(ts|tsx|astro|mjs|js|css|md|json)$/;
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (EXT.test(name)) files.push(path);
  }
};
walk(join(root, 'src'));
files.push(join(root, 'README.md'));

let hits = 0;
for (const file of files) {
  readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    for (const { why, re } of RULES) {
      if (re.test(line)) {
        hits++;
        console.log(`${relative(root, file)}:${i + 1}  ${why}\n    ${line.trim().slice(0, 160)}`);
      }
    }
  });
}
console.log(hits ? `\n${hits} hit(s)` : `copy guardrails: clean (${files.length} files, ${banned.length} banned phrases from FEATURES.md)`);
process.exit(hits ? 1 : 0);
