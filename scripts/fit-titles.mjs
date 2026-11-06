// Refit the pinned titles' spots (src/webgl/actors/PinnedTitles.ts SPOTS) to the camera.
//
// Two steps, both against a served build (`npx astro build`, then serve `dist/` on a port):
//
//   1. sample: drive the engine headless (?probe) through every title's window at a screen size and record the
//      camera at nine story times in each (position, rotation, fov), plus each title's drawn lockup size:
//        URL=http://localhost:4414/ W=390 H=800 node scripts/fit-titles.mjs sample phone.json
//        URL=http://localhost:4414/ W=1280 H=720 node scripts/fit-titles.mjs sample desk.json
//      (Playwright is not a project dependency: PLAYWRIGHT=/path/to/playwright/index.mjs, default 'playwright'.)
//   2. fit: for each title (or the ids given), search positions around the camera's mean line of sight, face the
//      title to the mean camera at its own height (or keep a flat one flat on the hint's height and yaw), and
//      for each, the biggest scale whose lettering (the lockup less its PAD margin) projects inside the safe rect
//      at every sample; print the one with the biggest worst-case lettering, nearest the current spot:
//        node scripts/fit-titles.mjs fit phone.json [ids] [hints.json]
//      The safe rect is a 16 px gutter at the sides, clear of the fleet card at the top and the cue at the foot
//      (portrait: y 132 .. H - 96; landscape: y 84 .. H - 84 and outside the card's top-left corner); MAXW caps
//      the width (use ~540 on a desktop: as big as fits is too big there). hints.json may give per id
//      { from, to } (a shorter window), { x0, x1, y0, y1 } (keep clear of the board, the popup, the laptop),
//      { minY } (stand on the ground) and { pos, flat } (the current spot, as the tie-break and a flat title's
//      height). Paste the result into SPOTS (`pos`, `width`, `face` | `flat`), in `portrait` for a phone.
//   3. check: node scripts/fit-titles.mjs check phone.json spots.json  (prints each title's box per sample)
//
// Then shoot the acceptance frames and look: the fit knows nothing of what stands in front of a title (use
// `over: true` on a phone's spot where houses or the desk would bite it) or of the haze.
import { readFileSync, writeFileSync } from 'node:fs';
import { Object3D, PerspectiveCamera, Vector3 } from 'three';

const [, , mode, file, arg3, arg4] = process.argv;
const PAD = 124;
const CANVAS_W = 2048;
const UP = new Vector3(0, 1, 0);

if (mode === 'sample') await sample(file);
else if (mode === 'fit') fit(file, arg3, arg4);
else if (mode === 'check') check(file, arg3);
else console.log('usage: fit-titles.mjs sample out.json | fit cams.json [ids] [hints.json] | check cams.json spots.json');

async function sample(out) {
  const { chromium } = await import(process.env.PLAYWRIGHT ?? 'playwright');
  const W = Number(process.env.W ?? 390);
  const H = Number(process.env.H ?? 800);
  const N = Number(process.env.N ?? 9);
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  await page.goto(`${process.env.URL ?? 'http://localhost:4321/'}?probe&q=${process.env.Q ?? 'low'}`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => !!window.__engine, null, { timeout: 120000 });
  await page.waitForTimeout(3000);
  await page.evaluate(() => { window.__engine.disposed = true; });
  const setT = (t) => page.evaluate((t) => {
    const e = window.__engine;
    const p = e.progressForT(t);
    e.scrollP = p; e.renderP = p; e.scrubVel = 0;
    e.renderFrame();
  }, t);
  // the titles' windows and drawn sizes, as this screen has them
  const titles = await page.evaluate(() => window.__engine.pinned.titles.map((t) => ({ id: t.copy.id, from: t.from, to: t.to, cw: t.cw, ch: t.ch })));
  const res = {};
  const sizes = {};
  for (const { id, from, to, cw, ch } of titles) {
    sizes[id] = { cw, ch, from, to };
    const a = from + 0.012;
    const b = to - 0.012;
    res[id] = [];
    for (let i = 0; i < N; i++) {
      const t = Math.max(0, a + ((b - a) * i) / (N - 1));
      // approach from a little earlier, the way a scroll would, so the damped look and roll have settled
      for (const k of [0.006, 0.004, 0.002, 0.001, 0]) await setT(Math.max(0, t - k));
      const cam = await page.evaluate(() => {
        const c = window.__camera;
        c.updateMatrixWorld();
        return { p: c.position.toArray(), q: c.quaternion.toArray(), fov: c.fov, aspect: c.aspect };
      });
      res[id].push({ t, ...cam });
    }
    console.log(id, res[id].length);
  }
  writeFileSync(out, JSON.stringify({ W, H, res, sizes }, null, 1));
  await browser.close();
}

function cameras(list) {
  return list.map((s) => {
    const c = new PerspectiveCamera(s.fov, s.aspect, 0.05, 5000);
    c.position.fromArray(s.p);
    c.quaternion.fromArray(s.q);
    c.updateProjectionMatrix();
    c.updateMatrixWorld(true);
    return c;
  });
}

function pose(obj, pos, face, flat) {
  obj.position.copy(pos);
  obj.rotation.set(0, 0, 0);
  obj.quaternion.identity();
  if (flat !== undefined) {
    obj.rotation.x = -Math.PI / 2;
    obj.rotateOnWorldAxis(UP, flat);
  } else {
    obj.lookAt(face);
  }
  obj.updateMatrixWorld(true);
}

/** the lettering's box on screen at scale k (null when any of it is behind the lens) */
function box(obj, c, cw, ch, k, W, H) {
  const hx = (cw / 2 - PAD) * k;
  const hy = (ch / 2 - PAD) * k;
  const v = new Vector3();
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 1], [0, -1], [1, 0], [-1, 0]]) {
    v.set(sx * hx, sy * hy, 0).applyMatrix4(obj.matrixWorld);
    if (v.clone().applyMatrix4(c.matrixWorldInverse).z > -0.05) return null;
    v.project(c);
    const px = (v.x * 0.5 + 0.5) * W;
    const py = (-v.y * 0.5 + 0.5) * H;
    x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
  }
  return { x0, x1, y0, y1 };
}

function within(list, lo, hi) {
  return list.filter((s) => s.t >= lo - 1e-6 && s.t <= hi + 1e-6);
}

function fit(camsPath, only, hintsPath) {
  const { W, H, res, sizes } = JSON.parse(readFileSync(camsPath, 'utf8'));
  const hints = hintsPath ? JSON.parse(readFileSync(hintsPath, 'utf8')) : {};
  const portrait = W < H;
  const MAXW = Number(process.env.MAXW ?? W);
  const CARD = portrait ? null : { x1: 380, y1: 130 };
  const obj = new Object3D();
  const out = {};
  for (const id of Object.keys(res)) {
    if (only && only !== 'all' && !only.split(',').includes(id)) continue;
    const hint = { ...sizes[id], ...hints[id] };
    const { cw, ch } = hint;
    const lo = (hints[id]?.from ?? sizes[id].from) + 0.012;
    const hi = (hints[id]?.to ?? sizes[id].to) - 0.012;
    const cs = cameras(within(res[id], lo, hi));
    const safe = portrait ? { x0: 16, x1: W - 16, y0: 132, y1: H - 96 } : { x0: 16, x1: W - 16, y0: 84, y1: H - 84 };
    for (const key of ['x0', 'x1', 'y0', 'y1']) if (hint[key] !== undefined) safe[key] = hint[key];
    const minY = hint.minY ?? -Infinity;
    const fits = (k, pos) => {
      if (hint.flat === undefined && pos.y - (ch / 2 - PAD) * k < minY) return 0;
      let minW = Infinity;
      for (const c of cs) {
        if (c.position.distanceTo(pos) < 0.5 * CANVAS_W * k) return 0;
        const b = box(obj, c, cw, ch, k, W, H);
        if (!b || b.x0 < safe.x0 || b.x1 > safe.x1 || b.y0 < safe.y0 || b.y1 > safe.y1) return 0;
        if (CARD && b.x0 < CARD.x1 && b.y0 < CARD.y1) return 0;
        if (b.x1 - b.x0 > MAXW) return 0;
        minW = Math.min(minW, b.x1 - b.x0);
      }
      return minW;
    };
    const mid = cs[Math.floor(cs.length / 2)];
    const fwd = new Vector3();
    const mean = new Vector3();
    for (const c of cs) {
      fwd.add(new Vector3(0, 0, -1).applyQuaternion(c.quaternion));
      mean.add(c.position);
    }
    fwd.normalize();
    mean.multiplyScalar(1 / cs.length);
    const right = new Vector3().crossVectors(fwd, UP).normalize();
    const up = new Vector3().crossVectors(right, fwd).normalize();
    const hintPos = hint.pos ? new Vector3(...hint.pos) : mean.clone().addScaledVector(fwd, 10);
    const D0 = Math.max(hintPos.distanceTo(mid.position), 0.5);
    const tanH = Math.tan((mid.fov * Math.PI) / 360);
    let top = null;
    for (let f = 0.3; f <= 1.6; f += 0.05) {
      const d = D0 * f;
      for (let xi = -6; xi <= 6; xi++) {
        for (let yi = -6; yi <= 6; yi++) {
          const pos = mean.clone().addScaledVector(fwd, d)
            .addScaledVector(right, (xi / 6) * d * tanH * mid.aspect * 0.9)
            .addScaledVector(up, (yi / 6) * d * tanH * 0.9);
          if (hint.flat !== undefined) pos.y = hintPos.y;
          const face = new Vector3(mean.x, pos.y, mean.z);
          pose(obj, pos, face, hint.flat);
          if (!fits(1e-6, pos)) continue;
          let a = 0;
          let b = (d * 4) / CANVAS_W;
          for (let i = 0; i < 22; i++) {
            const m = (a + b) / 2;
            if (fits(m, pos) > 0) a = m;
            else b = m;
          }
          if (a <= 0) continue;
          const minW = fits(a * 0.97, pos);
          const score = minW - 0.02 * pos.distanceTo(hintPos) * (W / D0);
          if (!top || score > top.score) {
            top = { score, minW: Math.round(minW), pos: pos.toArray().map((n) => +n.toFixed(2)), width: +(a * 0.97 * CANVAS_W).toFixed(3) };
            if (hint.flat === undefined) top.face = face.toArray().map((n) => +n.toFixed(2));
            else top.flat = hint.flat;
          }
        }
      }
    }
    out[id] = top;
    console.error(id, JSON.stringify(top));
  }
  console.log(JSON.stringify(out, null, 1));
}

function check(camsPath, spotsPath) {
  const { W, H, res, sizes = {} } = JSON.parse(readFileSync(camsPath, 'utf8'));
  const spots = JSON.parse(readFileSync(spotsPath, 'utf8'));
  const obj = new Object3D();
  for (const [id, spot] of Object.entries(spots)) {
    if (!res[id]) continue;
    const sp = { ...sizes[id], ...spot };
    pose(obj, new Vector3(...sp.pos), sp.face ? new Vector3(...sp.face) : null, sp.flat);
    const k = sp.width / CANVAS_W;
    const lines = [];
    let ok = true;
    for (const [i, c] of cameras(res[id]).entries()) {
      const t = res[id][i].t;
      if (sp.from !== undefined && t < sp.from + 0.012 - 1e-6) continue;
      if (sp.to !== undefined && t > sp.to - 0.012 + 1e-6) continue;
      const b = box(obj, c, sp.cw, sp.ch, k, W, H);
      const inside = !!b && b.x0 >= 16 && b.x1 <= W - 16 && b.y0 >= 0 && b.y1 <= H;
      ok &&= inside;
      lines.push(b ? `  t ${t.toFixed(4)} x ${b.x0.toFixed(0)}..${b.x1.toFixed(0)} y ${b.y0.toFixed(0)}..${b.y1.toFixed(0)}${inside ? '' : '  OUT'}` : `  t ${t.toFixed(4)} behind the lens`);
    }
    console.log(id, ok ? 'inside the gutter' : 'CLIPS');
    console.log(lines.join('\n'));
  }
}
