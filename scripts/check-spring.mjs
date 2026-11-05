// The scrub spring (src/webgl/scroll/spring.ts) replayed through a model of Lenis, frame by frame.
// Run: node --experimental-strip-types scripts/check-spring.mjs [--old]
//
// Each scenario feeds input events to a Lenis model (lerp: damp toward the target at lerp*60 per
// second, done when it rounds to the target; scrollTo with a duration: eased from/to), reads the
// scroll the way ScrollTrigger does (whole pixels / stage length), steps the spring and the detour
// cap exactly as Engine.renderFrame does, at 60 Hz, 144 Hz and a jittered clock with hitches.
// Asserts: overshoot <= 0.3% of the move, no reversal once the scroll has stopped, settled to under
// 0.5 px within 0.7 s of the scroll stopping (plus the detour's own 0.67 s when a move crosses it: the
// cap holds the frame back on purpose), no final snap of 0.5 px or more, and the detour clock never
// faster than MAX_U_RATE.
import assert from 'node:assert';
import { register } from 'node:module';
import { step, capDetour } from '../src/webgl/scroll/spring.ts';
import { detourStart, MAX_U_RATE } from '../src/webgl/rig/detour.ts';

const OLD = process.argv.includes('--old');
/** the spring this replaced (Engine.renderFrame before the scroll-feel work): K 120, C 17.5, one step a frame */
function oldStep(s, target, dt) {
  const err = Math.abs(target - s.x);
  s.v += (target - s.x) * 120 * dt;
  s.v *= Math.exp(-17.5 * dt);
  s.x += s.v * dt;
  if (err < 0.0004 && Math.abs(s.v) < 0.004) {
    s.x = target;
    s.v = 0;
  }
}

const VH = 900;
const STAGE = (10 * 1.2 + 1.2) * VH - VH; // 10980 px
const W = (1.2 * VH) / STAGE;
const PS = detourStart(W);
const easeInOutCubic = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const keyDuration = (dpx) => Math.min(Math.max(0.6 + 2.4 * Math.abs(dpx / STAGE), 0.6), 1.8);

class LenisModel {
  constructor(start, lerp) {
    this.value = start;
    this.to = start;
    this.lerp = lerp;
    this.anim = null;
  }
  wheel(dy) {
    this.anim = null;
    this.to = Math.min(Math.max(this.to + dy, 0), STAGE);
  }
  scrollTo(to, duration) {
    this.anim = { from: this.value, to, duration, time: 0 };
    this.to = to;
  }
  advance(dt) {
    if (this.anim) {
      const a = this.anim;
      a.time += dt;
      const k = Math.min(a.time / a.duration, 1);
      this.value = a.from + (a.to - a.from) * (k >= 1 ? 1 : easeInOutCubic(k));
      if (k >= 1) this.anim = null;
      return;
    }
    this.value += (this.to - this.value) * (1 - Math.exp(-this.lerp * 60 * dt));
    if (Math.round(this.value) === Math.round(this.to)) this.value = this.to;
  }
  get moving() {
    return !!this.anim || this.value !== this.to;
  }
}

/** events: [timeSeconds, (lenis) => void]; omega: the spring's frequency for this input kind */
function run({ start, lerp, omega, events, clock }) {
  const lenis = new LenisModel(start, lerp);
  const s = { x: start / STAGE, v: 0 };
  let time = 0;
  let ei = 0;
  const trace = [];
  let stoppedAt = null;
  for (let frame = 0; frame < 20000 && time < 8; frame++) {
    const dt = clock(frame);
    time += dt;
    while (ei < events.length && events[ei][0] <= time) events[ei++][1](lenis);
    lenis.advance(dt);
    const target = Math.round(lenis.value) / STAGE;
    const prev = s.x;
    if (OLD) oldStep(s, target, Math.min(dt, 0.1));
    else step(s, target, Math.min(dt, 0.1), { omega });
    s.x = Math.min(Math.max(s.x, 0), 1);
    capDetour(s, prev, PS, W, MAX_U_RATE, Math.min(dt, 0.1));
    const inputDone = ei >= events.length && !lenis.moving;
    if (inputDone && stoppedAt === null) stoppedAt = time;
    if (!inputDone) stoppedAt = null;
    trace.push({ time, dt, x: s.x, target, inputDone });
  }
  return { trace, stoppedAt, final: Math.round(lenis.value) / STAGE, start: start / STAGE, detour: crossesDetour(start, lenis.value) };
}

function check(name, res) {
  const { trace, stoppedAt, final, start } = res;
  const move = final - start;
  const dir = Math.sign(move);
  // overshoot past the final position, as a share of the move
  let over = 0;
  for (const f of trace) over = Math.max(over, (f.x - final) * dir);
  const overPct = (over / Math.abs(move)) * 100;
  // reversal: once the scroll has stopped, the rendered value only ever moves toward the final one
  let reversals = 0;
  let prevDx = 0;
  for (let i = 1; i < trace.length; i++) {
    if (!trace[i].inputDone) continue;
    const dx = trace[i].x - trace[i - 1].x;
    if (dx !== 0 && prevDx !== 0 && Math.sign(dx) !== Math.sign(prevDx)) reversals++;
    if (dx !== 0) prevDx = dx;
  }
  // settle: from the scroll stopping to under 0.5 px from the end, for good
  let settle = null;
  for (let i = trace.length - 1; i >= 0; i--) {
    if (Math.abs(trace[i].x - final) * STAGE >= 0.5) {
      settle = (trace[i + 1]?.time ?? Infinity) - stoppedAt;
      break;
    }
  }
  settle = Math.max(settle ?? 0, 0);
  // the detour clock's speed
  let uRate = 0;
  const uOf = (x) => Math.min(Math.max((x - PS) / W, 0), 1);
  for (let i = 1; i < trace.length; i++) {
    const du = Math.abs(uOf(trace[i].x) - uOf(trace[i - 1].x));
    if (du > 0) uRate = Math.max(uRate, du / Math.min(trace[i].dt, 0.1));
  }
  // the last frame's move: the old spring snapped the last 4.4 px in one frame (a visible pop)
  let lastStep = 0;
  for (let i = trace.length - 1; i > 0; i--) {
    const d = Math.abs(trace[i].x - trace[i - 1].x) * STAGE;
    if (d > 0) {
      lastStep = d;
      break;
    }
  }
  // crossing the detour, the cap holds the frame back on purpose (the whole detour takes 1/MAX_U_RATE s)
  const settleMax = res.detour ? 0.7 + 1 / MAX_U_RATE : 0.7;
  const ok = overPct <= 0.3 && reversals === 0 && settle <= settleMax && uRate <= MAX_U_RATE * (1 + 1e-6) && lastStep < 0.5;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(40)} move ${(move * STAGE).toFixed(0).padStart(5)} px  overshoot ${overPct.toFixed(3)}%  reversals ${reversals}  settle ${(settle * 1000).toFixed(0).padStart(4)} ms  last step ${lastStep.toFixed(2)} px` +
      (uRate > 0 ? `  detour u-rate max ${uRate.toFixed(3)}/s` : ''),
  );
  return ok;
}

function crossesDetour(a, b) {
  const lo = Math.min(a, b) / STAGE;
  const hi = Math.max(a, b) / STAGE;
  return hi > PS && lo < PS + W;
}

let seed = 7;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const clocks = {
  '60 Hz': () => 1 / 60,
  '144 Hz': () => 1 / 144,
  jittered: () => (rnd() < 0.03 ? 0.05 + rnd() * 0.05 : 1 / 144 + rnd() * (1 / 40 - 1 / 144)),
};

const scenarios = {
  '10 notches of 100 px at 120 ms': {
    start: 1200, lerp: 0.075, omega: 9,
    events: Array.from({ length: 10 }, (_, i) => [0.05 + i * 0.12, (l) => l.wheel(100)]),
  },
  'trackpad flick': {
    start: 3000, lerp: 0.14, omega: 13,
    events: Array.from({ length: 45 }, (_, i) => [0.05 + i * 0.016, (l) => l.wheel(Math.round(70 * Math.pow(0.91, i) * 100) / 100)]),
  },
  '900 px key jump': {
    start: 4000, lerp: 0.075, omega: 16,
    events: [[0.05, (l) => l.scrollTo(4900, keyDuration(900))]],
  },
  'jump across chapters (desk to storm)': {
    start: 300, lerp: 0.075, omega: 16,
    events: [[0.05, (l) => l.scrollTo(4300, keyDuration(4000))]],
  },
  'jump across the detour': {
    start: 7000, lerp: 0.075, omega: 16,
    events: [[0.05, (l) => l.scrollTo(9600, keyDuration(2600))]],
  },
  'notches backwards into the detour': {
    start: 9200, lerp: 0.075, omega: 9,
    events: Array.from({ length: 12 }, (_, i) => [0.05 + i * 0.09, (l) => l.wheel(-100)]),
  },
};

let all = true;
for (const [clockName, clock] of Object.entries(clocks)) {
  console.log(`-- ${clockName}`);
  for (const [name, sc] of Object.entries(scenarios)) {
    seed = 7;
    all = check(name, run({ ...sc, events: sc.events.map((e) => [...e]), clock })) && all;
  }
}
if (OLD) {
  console.log('(--old: the spring this replaced, for comparison; not asserted)');
  process.exit(0);
}
assert(all, 'spring checks failed');

// load readiness (src/webgl/load/Readiness.ts): the cap holds short of a closed gate, never behind the
// frame, opens when the load lands, and lets go after 12 s whatever happens
// the sources import each other without extensions (Vite style): try '.ts' when a relative import misses
register(
  'data:text/javascript,' +
    encodeURIComponent(
      `export async function resolve(s, c, n) { try { return await n(s, c); } catch (e) {
         if (/^\\.{1,2}\\//.test(s) && !/\\.[mc]?[jt]s$/.test(s)) return n(s + '.ts', c); throw e; } }`,
    ),
);
globalThis.window ??= { dispatchEvent() {} };
const { Readiness } = await import('../src/webgl/load/Readiness.ts');
const r = new Readiness();
const id = (t) => t; // progressForT: the identity is enough here
assert.strictEqual(r.capTarget(0.9, 0.2, 0, id), 0.9, 'nothing registered: no cap');
let land;
r.register(0.5, new Promise((res) => (land = res)));
assert(Math.abs(r.capTarget(0.9, 0.2, 0, id) - 0.496) < 1e-9, 'held short of the gate');
assert.strictEqual(r.capTarget(0.9, 0.6, 0, id), 0.6, 'never behind the frame');
assert.strictEqual(r.capTarget(0.3, 0.2, 0, id), 0.3, 'below the gate: untouched');
land();
await new Promise((res) => setTimeout(res, 0));
assert.strictEqual(r.capTarget(0.9, 0.2, 0, id), 0.9, 'open once loaded');
r.register(0.7, new Promise(() => {})); // never lands
assert(r.capTarget(0.9, 0.2, 1000, id) < 0.9);
assert(r.capTarget(0.9, 0.2, 12000, id) < 0.9, 'still held at 11 s');
r.capTarget(0.9, 0.2, 13100, id);
assert.strictEqual(r.capTarget(0.9, 0.2, 13200, id), 0.9, 'released after 12 s');
console.log('readiness OK');
console.log('spring OK');
