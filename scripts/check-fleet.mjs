// Self-test for the fleet table and its tally (src/story/fleet.ts; docs/fleet.md).
// Run: node --experimental-strip-types scripts/check-fleet.mjs
//
// Checks that delivered(t, u) is pure and monotonic over the whole flight (1e-4 steps) and across the
// office detour under both mappings (t held at T_S while u runs, or t running T_S -> T_E with u), that
// it has the direction's values at the listed story-t, that it never steps by 2 within 0.002 of story-t
// (also with the runtime-chosen landings at the edges of their windows), that every row has a kind
// something in the scene draws, that the clock only runs forward, and that the card's copy keeps the
// honesty rules (SAMPLE CAMPAIGN on the report, no "Plane N", none of the banned phrases).
import { register } from 'node:module';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

// the sources import each other without extensions (Vite style): try '.ts' when a relative import misses
register(
  'data:text/javascript,' +
    encodeURIComponent(
      `export async function resolve(s, c, n) { try { return await n(s, c); } catch (e) {
         if (/^\\.{1,2}\\//.test(s) && !/\\.[mc]?[jt]s$/.test(s)) return n(s + '.ts', c); throw e; } }`,
    ),
);

const F = await import('../src/story/fleet.ts');
const { T_S } = await import('../src/webgl/rig/detour.ts');
const { FLEET, SKIPPED, CAMPAIGN, CARD, REPORT, HERO, HERO_RECEIVED_T, OFFICE_U, delivered, clockAt, cardAt, nextIn } = F;

let failures = 0;
const check = (ok, msg) => {
  if (ok) return;
  failures++;
  console.error('FAIL', msg);
};

// ---- the table -------------------------------------------------------------------------------------
check(FLEET.length === 42 && CAMPAIGN.total === 42, `42 rows (${FLEET.length})`);
FLEET.forEach((r, i) => check(r.n === i + 1, `row ${i} is numbered ${r.n}`));
check(HERO.n === 42 && HERO.kind === 'hero' && HERO.land === HERO_RECEIVED_T, 'the hero is #42 and lands at the received moment');
check(new Set(FLEET.map((r) => r.name)).size === 42, 'every name is different');
check(!FLEET.some((r) => r.name === SKIPPED.email), 'the skipped 43rd is not a row');
// every row has something in the scene that is seen to land (who draws it)
const DRAWN = {
  lawn: 'BatchSend (scouts) / BatchFleet (V wingtips): a dart onto a lawn',
  wing: 'WingPlanes dives, BatchFleet column',
  peel: 'BatchFleet: V dart glides down, column',
  column: 'BatchFleet: far column in view',
  ship: 'BatchFleet: dart onto the freighter, column',
  envelope: 'City: envelope into a window, lit teal',
  cafe: 'BatchFleet dart, CafeTerrace ping and wave',
  phone: 'BatchFleet: dart into a phone, column',
  window: 'City: dart into a window, lit teal',
  wave: 'City: window flare (or a BatchFleet column)',
  office: 'Office (detour): envelope into the live laptop',
  hero: 'Engine/Landing: EMAIL RECEIVED on the laptop',
};
for (const r of FLEET) check(r.kind in DRAWN, `row ${r.n} (${r.name}) has a visible kind (${r.kind})`);
for (let i = 1; i < FLEET.length; i++) {
  const a = FLEET[i - 1];
  const b = FLEET[i];
  check(b.land >= a.land, `rows are in landing order (${a.n} ${a.land} -> ${b.n} ${b.land})`);
  check(F.minutes(b.clock) > F.minutes(a.clock), `clock times rise (${a.clock} -> ${b.clock})`);
}
for (const r of FLEET) if (r.window) check(r.window[0] <= r.land && r.land <= r.window[1], `row ${r.n}'s window holds its time`);

// ---- delivered(t): monotonic, the listed values, at most one step per 0.002 -------------------------
const STEP = 1e-4;
const N = Math.round(1 / STEP);
const scan = (landings, label) => {
  let prev = -1;
  const values = new Int32Array(N + 1);
  for (let i = 0; i <= N; i++) {
    const t = i * STEP;
    const v = delivered(t, 0, landings);
    values[i] = v;
    check(v >= prev, `${label}: monotonic at t=${t.toFixed(4)} (${prev} -> ${v})`);
    check(v === delivered(t, 0, landings), `${label}: pure at t=${t.toFixed(4)}`);
    prev = v;
  }
  const win = Math.round(0.002 / STEP);
  for (let i = 0; i + win <= N; i++) {
    check(values[i + win] - values[i] <= 1, `${label}: +${values[i + win] - values[i]} within 0.002 from t=${(i * STEP).toFixed(4)}`);
  }
  return values;
};
scan(undefined, 'nominal');
// the runtime picks (scouts, phones) at either edge of their windows
const edges = (side) => {
  const a = new Float64Array(42).fill(NaN);
  for (const r of FLEET) if (r.window) a[r.n - 1] = r.window[side];
  return a;
};
scan(edges(0), 'windows low');
scan(edges(1), 'windows high');
// mixed: Amy late and Ben early, the phones the same
const mixed = new Float64Array(42).fill(NaN);
mixed[0] = FLEET[0].window[1];
mixed[1] = FLEET[1].window[0];
mixed[23] = FLEET[23].window[1];
mixed[26] = FLEET[26].window[0];
scan(mixed, 'windows crossed');

const AFTER_OFFICE = T_S + 0.0005;
const listed = [
  [0.19, 0, 0], [0.21, 0, 2], [0.35, 0, 12], [0.51, 0, 16], [0.57, 0, 18], [0.66, 0, 20], [0.78, 0, 31],
  [T_S, 0.3, 31], [T_S, OFFICE_U, 32], [AFTER_OFFICE, 0, 32], [0.8, 0, 32], [0.86, 0, 41], [0.995, 0, 42], [1, 0, 42],
];
for (const [t, u, want] of listed) check(delivered(t, u) === want, `delivered(${t.toFixed(4)}, u=${u}) = ${delivered(t, u)}, want ${want}`);

// across the office: (a) t held at T_S while u runs (today's mapping); (b) t runs T_S -> T_E with u (direction §4.2)
const across = (label, seq) => {
  let prev = -1;
  for (const [t, u] of seq) {
    const v = delivered(t, u);
    check(v >= prev, `${label}: monotonic at t=${t.toFixed(5)} u=${u.toFixed(3)} (${prev} -> ${v})`);
    check(v - prev <= 1 || prev < 0, `${label}: one step at a time at t=${t.toFixed(5)} u=${u.toFixed(3)}`);
    prev = v;
  }
  return prev;
};
const held = [];
for (let t = 0.76; t < T_S; t += STEP) held.push([t, 0]);
for (let u = 0; u <= 1; u += 0.001) held.push([T_S, u >= 1 ? 0.999999 : u]);
for (let t = T_S + STEP; t <= 0.83; t += STEP) held.push([t, 0]);
across('office, t held', held);
for (const DT of [0.01, 0.012, 0.014]) {
  const run = [];
  for (let t = 0.76; t < T_S; t += STEP) run.push([t, 0]);
  for (let u = 0; u < 1; u += 0.001) run.push([T_S + u * DT, u]);
  for (let t = T_S + DT; t <= 0.83; t += STEP) run.push([t, 0]);
  across(`office, t running (D_T ${DT})`, run);
}

// ---- the clock and the card --------------------------------------------------------------------------
{
  let prev = -Infinity;
  for (let i = 0; i <= N; i++) {
    const t = i * STEP;
    const c = clockAt(t, 0);
    check(c >= prev - 1e-9, `clock runs forward at t=${t.toFixed(4)} (${prev} -> ${c})`);
    check(nextIn(t, 0) >= 0, `countdown is never negative at t=${t.toFixed(4)}`);
    prev = c;
  }
  check(Math.abs(clockAt(FLEET[0].land) - F.minutes(FLEET[0].clock)) < 1e-6, 'the clock reads Amy\'s time as she lands');
  check(Math.abs(clockAt(1) - F.minutes(HERO.clock)) < 1e-6, 'the clock ends on Cara\'s time');
}
{
  const card = F.newCardState();
  let prevCount = -1;
  let prevT = 0;
  // a frame-by-frame scrub 0.18 -> 1.0 at a steady scroll (about 0.0005 of story-t a frame)
  for (let t = 0.18; t <= 1.00001; t += 0.0005) {
    cardAt(t, 0, card);
    check(card.visible, `card visible at t=${t.toFixed(4)}`);
    if (prevCount >= 0) {
      check(card.delivered >= prevCount, `card count never goes back (t ${prevT.toFixed(4)} -> ${t.toFixed(4)})`);
      check(card.delivered - prevCount <= 1, `card count steps by one (t ${prevT.toFixed(4)} -> ${t.toFixed(4)}: ${prevCount} -> ${card.delivered})`);
    }
    check(card.foot.length > 0 && card.footShort.length > 0, `card has a foot at t=${t.toFixed(4)}`);
    check(card.footShort.length <= 44, `phone foot fits one line at t=${t.toFixed(4)}: "${card.footShort}"`);
    prevCount = card.delivered;
    prevT = t;
  }
  cardAt(0.003, 0, card);
  check(!card.visible, 'card is down before the first envelope leaves the laptop');
  cardAt(0.87, 0, card);
  check(card.report === REPORT.rows.length, `all ${REPORT.rows.length} report rows are up at 0.87 (${card.report})`);
  cardAt(0.995, 0, card);
  check(card.delivered === 42 && card.foot === CARD.heroReply, 'the end: 42/42 and the reply line');
  cardAt(0.991, 0, card);
  check(card.foot === CARD.received, 'received: 42/42 delivered · 0 bounces · this campaign');
  cardAt(T_S, 0.5, card);
  check(card.foot.includes('Lena'), 'the office toasts Lena on u');
  cardAt(SKIPPED.t + 0.001, 0, card);
  check(card.tone === 'bad' && card.foot.includes(SKIPPED.email), 'the no-fly skip toast is red');
}

// ---- honesty --------------------------------------------------------------------------------------------
check(REPORT.rows.some(([a, b]) => `${a} ${b}`.includes('SAMPLE CAMPAIGN')), 'the report says SAMPLE CAMPAIGN');
check(CAMPAIGN.label === 'SAMPLE CAMPAIGN', 'the campaign is labelled SAMPLE CAMPAIGN');
check(/CAMPAIGN\.label/.test(readFileSync(new URL('../src/webgl/interact/BatchHud.ts', import.meta.url), 'utf8')), 'the card shows CAMPAIGN.label');
const sources = ['src/story/fleet.ts', 'src/webgl/actors/BatchFleet.ts', 'src/webgl/interact/BatchHud.ts', 'src/webgl/actors/BatchSend.ts', 'src/styles/fleet.css']
  .map((f) => [f, readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')]);
const BANNED = ['cold email', 'cold outreach', 'mass email', 'bulk blast', 'email blast', 'anti-ban', 'bypass spam', 'spintax', 'primary inbox', '/week', '/mo', 'first class', 'trial'];
for (const [f, text] of sources) {
  check(!/Plane \d/.test(text), `${f}: no "Plane N"`);
  for (const b of BANNED) check(!text.toLowerCase().includes(b), `${f}: no "${b}"`);
}

// ---- the contract with chapters.ts (WP-C adds RECEIVED_T) --------------------------------------------
try {
  const chapters = await import('../src/story/chapters.ts');
  if ('RECEIVED_T' in chapters) check(chapters.RECEIVED_T === HERO_RECEIVED_T, `HERO_RECEIVED_T (${HERO_RECEIVED_T}) = chapters.RECEIVED_T (${chapters.RECEIVED_T})`);
  else console.log('note: chapters.ts has no RECEIVED_T yet; fleet.ts holds', HERO_RECEIVED_T);
} catch (e) {
  console.log('note: chapters.ts not importable here:', String(e).slice(0, 80));
}

if (failures) {
  console.error(`check-fleet: ${failures} failure(s)`);
  process.exit(1);
}
const last = (t) => delivered(t);
console.log(`check-fleet ok: 42 rows, monotonic at 1e-4 (3 window variants), office across u (held and running), at most one step per 0.002;`
  + ` delivered at 0.19/0.21/0.35/0.51/0.57/0.66/0.78/after office/0.86/0.995 = ${[0.19, 0.21, 0.35, 0.51, 0.57, 0.66, 0.78].map(last).join('/')}/${delivered(AFTER_OFFICE)}/${last(0.86)}/${last(0.995)}`);
assert.ok(true);
