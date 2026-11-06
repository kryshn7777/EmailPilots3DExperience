/**
 * The fleet: one sample campaign, "Q3 Outreach", as ONE table that everything reads (the HUD tally,
 * the chips, the toasts, the desk names, the envelopes and the flight report). Direction v2, §4.1.
 *
 * 42 personal emails, each to a named person, delivered one at a time on a campaign clock. A 43rd
 * import is refused by the do-not-send list. The hero is #42, Cara: the camera's plane, the last to
 * land, and her reply ends the story.
 *
 * Honesty (direction §0, FEATURES.md Appendix B; the same guardrails as copy.ts):
 *  - the names, roles, clock times and "0 bounces" are the site's own hero mock-up, so on screen the
 *    campaign is always labelled SAMPLE CAMPAIGN;
 *  - no price and no plan names, no placement promise; opens are not tracked, by design;
 *  - "spam" only for the folder / the filters, never for what the user sends.
 *
 * Pure: no three, no DOM, no allocation in the per-frame functions (`delivered`, `clockAt`,
 * `nextRow`, `cardAt` writes into the object it is given). It runs under
 * `node --experimental-strip-types` (scripts/check-fleet.mjs tests it).
 */
import { T_S } from '../webgl/rig/detour';

export type FleetKind =
  /** a scout or a V wingtip that lands on a lawn in the town */
  | 'lawn'
  /** a WingPlane that dives away from the hero's wing; a far column rises where it went */
  | 'wing'
  /** a plane of the V that peels off into the town below; a far column rises where it went */
  | 'peel'
  /** a far column of light only (the sea horizon, the city skyline ahead) */
  | 'column'
  /** onto the freighter's deck off the lighthouse */
  | 'ship'
  /** City: an envelope into a tower window */
  | 'envelope'
  /** onto a table of the restaurant terrace */
  | 'cafe'
  /** into a phone in someone's hand on a plaza */
  | 'phone'
  /** City: a dart into a tower window */
  | 'window'
  /** City: one of the skyline's windows flaring teal (the wave under the copilot climb) */
  | 'wave'
  /** the envelope into the one live laptop in the IT office (keyed on the detour's u) */
  | 'office'
  /** the hero: the recipient's laptop, EMAIL RECEIVED */
  | 'hero';

export interface FleetRow {
  /** delivery order, 1..42 */
  n: number;
  name: string;
  role: string;
  kind: FleetKind;
  /** the story-t it lands at (nominal for the runtime-chosen ones, see `window`) */
  land: number;
  /** campaign clock, 'HH:MM' */
  clock: string;
  where: string;
  /** a landing whose exact story-t is chosen at runtime (the scouts' lawns, the phones) stays inside this */
  window?: readonly [number, number];
}

/**
 * Where in the office detour (its clock u, 0..1) Lena's envelope goes into the live laptop. Her row's
 * `land` is T_S, the detour's story-t, for the table's order and the clock; the landing itself is
 * keyed on u (see `landed`).
 */
export const OFFICE_U = 0.45;
/**
 * The hero's received moment. MUST match `RECEIVED_T` in src/story/chapters.ts (WP-C adds it); the
 * screen flips to EMAIL RECEIVED and the confetti fires there.
 */
export const HERO_RECEIVED_T = 0.99;
/** Cara's reply on the open message */
export const HERO_REPLY_T = 0.995;

export const CAMPAIGN = {
  name: 'Q3 Outreach',
  from: 'you@yourdomain.com',
  start: '09:00',
  /** about 50 a day per mailbox (FEATURES.md: ~50/day default cap) */
  cap: 50,
  total: 42,
  label: 'SAMPLE CAMPAIGN',
} as const;

/** the 43rd import: refused by the do-not-send list in the no-fly zone (not counted) */
export const SKIPPED = {
  email: 'old@defunct.co',
  reason: 'on your do-not-send list',
  /** the red dart is stamped DO-NOT-SEND and unfolds and drops away here */
  t: 0.6,
} as const;

/** the BCC bomber in the storm: someone else's way of sending (not ours, not counted) */
export const BOMBER = {
  /** on screen */
  from: 0.39,
  to: 0.44,
  /** the lightning strike at the red gate: the 550 stamp */
  strike: 0.415,
  /** the site's own mock of a BCC'd message, stencilled down its fuselage */
  toLine: 'To: undisclosed-recipients;',
  bccLine: 'BCC: amy@acme.com, ben@acme.com, dev@acme.com, eli@acme.com … +231 more',
  stamp: '550 — SPAM FLAGGED',
} as const;

/** Hugo's reply in the formation: two ghost follow-ups stand down when it passes them */
export const REPLY = {
  /** whose row */
  n: 7,
  /** the gold "Re:" dart rises from his lawn */
  rise: 0.326,
  /** it passes the ghosts; they unfold and flutter down */
  cancel: 0.329,
  ghosts: ['Follow-up · day 3', 'Follow-up · day 7'],
  /** the one chip over both ghosts, then once the reply has passed them */
  waiting: '2 follow-ups · day 3 · day 7',
  cancelled: '✕ 2 follow-ups cancelled',
} as const;

/** The 42, in landing order (direction §4.1's table). */
export const FLEET: readonly FleetRow[] = [
  { n: 1, name: 'Amy', role: 'hiring manager', kind: 'lawn', land: 0.196, clock: '09:02', where: 'town street, north', window: [0.186, 0.2005] },
  { n: 2, name: 'Ben', role: 'candidate', kind: 'lawn', land: 0.206, clock: '09:11', where: 'town street, south', window: [0.2035, 0.216] },
  { n: 3, name: 'Dev', role: 'investor', kind: 'wing', land: 0.285, clock: '09:15', where: 'the town below the cloud sea' },
  { n: 4, name: 'Eli', role: 'client', kind: 'wing', land: 0.292, clock: '09:21', where: 'the town' },
  { n: 5, name: 'Finn', role: 'prospect', kind: 'wing', land: 0.299, clock: '09:24', where: 'the town' },
  { n: 6, name: 'Gail', role: 'decision-maker', kind: 'peel', land: 0.312, clock: '09:29', where: 'the town' },
  { n: 7, name: 'Hugo', role: 'hiring manager', kind: 'lawn', land: 0.319, clock: '09:36', where: 'a lawn in the town' },
  { n: 8, name: 'Ivy', role: 'speaker', kind: 'peel', land: 0.324, clock: '09:40', where: 'the town' },
  { n: 9, name: 'Jude', role: 'early user', kind: 'lawn', land: 0.328, clock: '09:45', where: 'a lawn in the town' },
  { n: 10, name: 'Kofi', role: 'client', kind: 'peel', land: 0.334, clock: '09:48', where: 'the town' },
  { n: 11, name: 'Lars', role: 'candidate', kind: 'peel', land: 0.339, clock: '09:54', where: 'the town' },
  { n: 12, name: 'Maya', role: 'investor', kind: 'peel', land: 0.344, clock: '09:59', where: 'the town' },
  { n: 13, name: 'Noor', role: 'prospect', kind: 'column', land: 0.462, clock: '10:03', where: 'the sea horizon' },
  { n: 14, name: 'Omar', role: 'client', kind: 'column', land: 0.476, clock: '10:10', where: 'the sea horizon' },
  { n: 15, name: 'Priya', role: 'hiring manager', kind: 'column', land: 0.49, clock: '10:13', where: 'the sea horizon' },
  { n: 16, name: 'Quinn', role: 'decision-maker', kind: 'column', land: 0.504, clock: '10:18', where: 'the sea horizon' },
  { n: 17, name: 'Rosa', role: 'client', kind: 'ship', land: 0.548, clock: '10:24', where: 'the freighter deck' },
  { n: 18, name: 'Sam', role: 'prospect', kind: 'ship', land: 0.561, clock: '10:28', where: 'the freighter deck' },
  { n: 19, name: 'Tariq', role: 'founder', kind: 'column', land: 0.63, clock: '10:34', where: 'the city skyline ahead' },
  { n: 20, name: 'Uma', role: 'candidate', kind: 'column', land: 0.648, clock: '10:37', where: 'the city skyline ahead' },
  { n: 21, name: 'Vera', role: 'editor', kind: 'envelope', land: 0.697, clock: '10:42', where: 'a window in the canyon' },
  { n: 22, name: 'Wes', role: 'recruiter', kind: 'envelope', land: 0.709, clock: '10:49', where: 'a window in the canyon' },
  { n: 23, name: 'Marco', role: 'café owner', kind: 'cafe', land: 0.714, clock: '10:53', where: 'Trattoria Luna' },
  { n: 24, name: 'Xin', role: 'prospect', kind: 'phone', land: 0.722, clock: '10:58', where: 'a phone on the plaza', window: [0.7175, 0.7255] },
  { n: 25, name: 'Yara', role: 'hiring manager', kind: 'window', land: 0.728, clock: '11:01', where: 'a window in the canyon' },
  { n: 26, name: 'Zoe', role: 'client', kind: 'envelope', land: 0.731, clock: '11:07', where: 'a window in the canyon' },
  { n: 27, name: 'Arjun', role: 'speaker', kind: 'phone', land: 0.744, clock: '11:12', where: 'a phone on the plaza', window: [0.735, 0.7465] },
  { n: 28, name: 'Bea', role: 'investor', kind: 'window', land: 0.749, clock: '11:16', where: 'a window in the canyon' },
  { n: 29, name: 'Chloe', role: 'decision-maker', kind: 'envelope', land: 0.756, clock: '11:23', where: 'a window in the canyon' },
  { n: 30, name: 'Diego', role: 'early user', kind: 'envelope', land: 0.766, clock: '11:26', where: 'a window in the canyon' },
  { n: 31, name: 'Elif', role: 'candidate', kind: 'window', land: 0.772, clock: '11:31', where: 'a window in the canyon' },
  { n: 32, name: 'Lena', role: 'IT lead, working late', kind: 'office', land: T_S, clock: '11:37', where: 'the IT office' },
  { n: 33, name: 'Felix', role: 'prospect', kind: 'window', land: 0.806, clock: '11:41', where: 'the city below the climb' },
  { n: 34, name: 'Grace', role: 'client', kind: 'wave', land: 0.812, clock: '11:47', where: 'the skyline' },
  { n: 35, name: 'Hana', role: 'hiring manager', kind: 'wave', land: 0.818, clock: '11:50', where: 'the skyline' },
  { n: 36, name: 'Ivan', role: 'investor', kind: 'window', land: 0.823, clock: '11:55', where: 'the city' },
  { n: 37, name: 'Jun', role: 'speaker', kind: 'wave', land: 0.828, clock: '12:02', where: 'the skyline' },
  { n: 38, name: 'Kemi', role: 'decision-maker', kind: 'wave', land: 0.836, clock: '12:06', where: 'the skyline' },
  { n: 39, name: 'Liam', role: 'candidate', kind: 'wave', land: 0.843, clock: '12:11', where: 'the skyline' },
  { n: 40, name: 'Mira', role: 'client', kind: 'wave', land: 0.849, clock: '12:14', where: 'the skyline' },
  { n: 41, name: 'Nils', role: 'prospect', kind: 'wave', land: 0.853, clock: '12:20', where: 'the skyline' },
  { n: 42, name: 'Cara', role: 'prospect', kind: 'hero', land: HERO_RECEIVED_T, clock: '12:25', where: "the recipient's laptop" },
];

/** the hero's row (#42) and the office's (#32) */
export const HERO = FLEET[FLEET.length - 1]!;
export const OFFICE_ROW = FLEET.find((r) => r.kind === 'office')!;
/** the three that leave the desk laptop, in release order: scout 1, scout 2, the hero */
export const DESK_NAMES = [FLEET[0]!.name, FLEET[1]!.name, HERO.name] as const;
/** a row by its number (1..42) */
export function row(n: number): FleetRow {
  return FLEET[n - 1]!;
}

/**
 * Landing-time overrides, by row index (n - 1): the visuals pick a few landings at runtime (the
 * scouts' lawns, the phones); passing those times keeps the tally exactly on the landing. A missing,
 * NaN or out-of-window entry falls back to the row's nominal time (clamped into its window).
 */
export type Landings = ArrayLike<number> | null | undefined;

export function landOf(r: FleetRow, landings?: Landings): number {
  const o = landings ? landings[r.n - 1] : undefined;
  if (o === undefined || !Number.isFinite(o)) return r.land;
  if (!r.window) return o;
  return Math.min(Math.max(o, r.window[0]), r.window[1]);
}

/**
 * Has row `r` landed at story-t `t` (detour clock `u`)? The office row is keyed on u inside the
 * detour (u > 0): landed from OFFICE_U. Outside it (u = 0) it is landed once t is past T_S, which
 * holds for both detour mappings (t frozen at T_S while u runs, or t running T_S -> T_E with
 * u = (t - T_S) / D_T): either way t > T_S with u = 0 only happens after the office.
 */
export function landed(r: FleetRow, t: number, u = 0, landings?: Landings): boolean {
  if (r.kind === 'office') return u > 0 && u < 1 ? u >= OFFICE_U : t > T_S;
  return t >= landOf(r, landings);
}

/** How many of the 42 are delivered at story-t `t` (detour clock `u`): pure and monotonic. */
export function delivered(t: number, u = 0, landings?: Landings): number {
  let n = 0;
  for (let i = 0; i < FLEET.length; i++) if (landed(FLEET[i]!, t, u, landings)) n++;
  return n;
}

/** the latest landed row (null before Amy) */
export function lastLanded(t: number, u = 0, landings?: Landings): FleetRow | null {
  let best: FleetRow | null = null;
  let bestT = -1;
  for (let i = 0; i < FLEET.length; i++) {
    const r = FLEET[i]!;
    if (!landed(r, t, u, landings)) continue;
    const lt = landOf(r, landings);
    if (lt >= bestT) {
      bestT = lt;
      best = r;
    }
  }
  return best;
}

/** the first row not landed yet (null once Cara has) */
export function nextRow(t: number, u = 0, landings?: Landings): FleetRow | null {
  for (let i = 0; i < FLEET.length; i++) if (!landed(FLEET[i]!, t, u, landings)) return FLEET[i]!;
  return null;
}

// ---- the campaign clock ------------------------------------------------------------------------

/** 'HH:MM' -> minutes after midnight */
export function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
}

/** minutes after midnight -> 'HH:MM' */
export function hhmm(min: number): string {
  const m = Math.floor(min);
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** the sending starts with takeoff: the clock reads the campaign's start until here */
export const CLOCK_FROM = 0.17;
const START_MIN = minutes(CAMPAIGN.start);
const ROW_MIN = FLEET.map((r) => minutes(r.clock));

/**
 * The campaign clock at story-t `t`, in minutes after midnight (fractional): CAMPAIGN.start until
 * takeoff, then piecewise-linear through every row's (land, clock), held at the last. Lena's knot is
 * at T_S, so the clock stands at her minute through the office whichever way the detour maps t.
 */
export function clockAt(t: number, _u = 0, landings?: Landings): number {
  let pt = CLOCK_FROM;
  let pm = START_MIN;
  if (t <= pt) return pm;
  for (let i = 0; i < FLEET.length; i++) {
    const lt = landOf(FLEET[i]!, landings);
    const m = ROW_MIN[i]!;
    if (t < lt) return pm + (m - pm) * Math.min(Math.max((t - pt) / Math.max(lt - pt, 1e-9), 0), 1);
    pt = lt;
    pm = m;
  }
  return pm;
}

/** campaign minutes until the next row lands (0 once all have) */
export function nextIn(t: number, u = 0, landings?: Landings): number {
  const next = nextRow(t, u, landings);
  if (!next) return 0;
  return Math.max(minutes(next.clock) - clockAt(t, u, landings), 0);
}

/** '4m 12s' */
export function countdown(min: number): string {
  const s = Math.max(Math.round(min * 60), 0);
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

/** the smallest and largest gap between two deliveries on the campaign clock, in minutes */
export function gapRange(): [number, number] {
  let lo = Infinity;
  let hi = 0;
  for (let i = 1; i < ROW_MIN.length; i++) {
    const g = ROW_MIN[i]! - ROW_MIN[i - 1]!;
    lo = Math.min(lo, g);
    hi = Math.max(hi, g);
  }
  return [lo, hi];
}

// ---- the card ----------------------------------------------------------------------------------

/** a toast holds the foot this long after its landing (a newer landing replaces it sooner) */
export const TOAST_HOLD = 0.005;

/** the card's copy (direction §3 and §4.1): the HUD renders these, A may read them */
export const CARD = {
  brand: 'Email Pilots',
  head: `${CAMPAIGN.name} · ${CAMPAIGN.label}`,
  headShort: `${CAMPAIGN.name} · Sample`,
  count: (n: number): string => `${n}/${CAMPAIGN.total}`,
  countWord: 'delivered',
  desk: 'Personalising… {{Name}} → ' + DESK_NAMES.join(', ') + '…',
  preflightCheck: 'Pre-flight check…',
  preflight: 'Pre-flight: ready for takeoff ✓',
  waiting: (min: number): string => `Waiting ${countdown(min)}… · natural human pacing`,
  waitingShort: (min: number): string => `Waiting ${countdown(min)}…`,
  sending: (r: FleetRow): string => `Sending to ${r.name}…`,
  toast: (r: FleetRow): string => `✓ ${r.name} · ${r.role} · ${r.clock}`,
  toastShort: (r: FleetRow): string => `✓ ${r.name} · ${r.clock}`,
  reply: `↩ ${row(REPLY.n).name} replied · 2 follow-ups cancelled`,
  bccRed: 'BCC to 100 → 550 spam flagged',
  bccGreen: 'Yours: one email per person · looks human ✓',
  bccGreenShort: 'Yours: one per person ✓',
  dailyCap: (n: number): string => `Today ${n}/${CAMPAIGN.cap} · daily cap`,
  auth: 'SPF ✓ DKIM ✓ DMARC ✓ · cleared',
  skip: `✕ ${SKIPPED.email} · skipped · ${SKIPPED.reason}`,
  skipShort: `✕ ${SKIPPED.email} · skipped`,
  cleared: `${CAMPAIGN.total} cleared · 1 skipped`,
  queued: `${CAMPAIGN.total} queued`,
  copilot: 'Copilot: on-device · 0 bytes sent',
  lastOne: `Last one: ${HERO.name}`,
  tower: 'Sent through your own Gmail or Outlook, never our servers.',
  towerShort: 'Through your own inbox, never our servers.',
  received: `${CAMPAIGN.total}/${CAMPAIGN.total} delivered · 0 bounces · this campaign`,
  heroReply: `↩ ${HERO.name} replied · 2 follow-ups cancelled`,
} as const;

/** chips over the 3D landings: `→ name` while it flies, `✓ name` once landed */
export function chipLabel(r: FleetRow, isLanded: boolean): string {
  return `${isLanded ? '✓' : '→'} ${r.name}`;
}
/** a timetable chip in the formation: 'Dev · 09:15' */
export function slotLabel(r: FleetRow): string {
  return `${r.name} · ${r.clock}`;
}
/** the same, built once per row (index n - 1), for the per-frame callers */
export const CHIP_FLYING: readonly string[] = FLEET.map((r) => chipLabel(r, false));
export const CHIP_LANDED: readonly string[] = FLEET.map((r) => chipLabel(r, true));
export const CHIP_SLOT: readonly string[] = FLEET.map((r) => slotLabel(r));
/** a landed chip with the campaign clock ('✓ Noor · 10:03') and one with the role ('✓ Marco · café owner') */
export const CHIP_DONE: readonly string[] = FLEET.map((r) => `✓ ${r.name} · ${r.clock}`);
export const CHIP_ROLE: readonly string[] = FLEET.map((r) => `✓ ${r.name} · ${r.role}`);

/** The flight report at the crest (rows revealed one per REPORT.step from REPORT.from). */
export const REPORT = {
  from: 0.855,
  to: 0.885,
  /** the first row shows at `reveal`, the next ones `step` apart: all seven are up by 0.869 */
  reveal: 0.856,
  step: 0.0022,
  rows: ((): readonly [string, string][] => {
    const [lo, hi] = gapRange();
    const last = FLEET[FLEET.length - 2]!;
    return [
      [`Flight report · ${CAMPAIGN.name}`, CAMPAIGN.label],
      [`${CAMPAIGN.total - 1} / ${CAMPAIGN.total} delivered`, 'one still in the air: yours'],
      [`${CAMPAIGN.start} → ${last.clock}`, `one by one · ${lo} to ${hi} minutes apart`],
      ['From', `${CAMPAIGN.from} · your own inbox`],
      ['Bounces 0 · Skipped 1', SKIPPED.reason],
      ['Opens', 'not tracked, by design · we count replies'],
      ['Today', `${CAMPAIGN.total} / ${CAMPAIGN.cap} · under the daily cap`],
    ];
  })(),
} as const;

export type CardTone = 'info' | 'wait' | 'ok' | 'bad' | 'reply';

export interface CardState {
  /** the card is up (story-t 0.006 to the end) */
  visible: boolean;
  delivered: number;
  /** the meter: 0..1 and what it measures */
  meter: number;
  meterKind: 'delivered' | 'cap';
  /** the big line under the brand */
  foot: string;
  /** a shorter foot for phones (the card is one line high there) */
  footShort: string;
  tone: CardTone;
  /** the right-hand badge in the bar: the campaign clock, then the do-not-send tally */
  badge: string;
  clock: string;
  /** the report: how many of its 7 rows are revealed (0 = the card is not expanded) */
  report: number;
}

export function newCardState(): CardState {
  return {
    visible: false, delivered: 0, meter: 0, meterKind: 'delivered', foot: '', footShort: '', tone: 'info',
    badge: '', clock: CAMPAIGN.start, report: 0,
  };
}

/** the card is up from the first envelope leaving the laptop */
export const CARD_FROM = 0.006;

function put(out: CardState, foot: string, short: string, tone: CardTone): CardState {
  out.foot = foot;
  out.footShort = short;
  out.tone = tone;
  return out;
}

const TOASTS = FLEET.map((r) => CARD.toast(r));
const TOASTS_SHORT = FLEET.map((r) => CARD.toastShort(r));
const OFFICE_TOAST = CARD.toast(OFFICE_ROW);
const OFFICE_TOAST_SHORT = CARD.toastShort(OFFICE_ROW);
const OFFICE_FLYING = `→ ${OFFICE_ROW.name} · ${OFFICE_ROW.role}`;

// string caches (the per-frame call builds a string only when what it shows changes)
let waitKey = -1;
let waitLong = '';
let waitShort = '';
let clockKey = -1;
let clockStr = '';
let capKey = -1;
let capStr = '';

/**
 * What the fleet card shows at story-t `t` (detour clock `u`), written into `out`. Pure in its
 * arguments: a special moment (the reply, the storm, the beacon, the skip, the ocean's daily cap,
 * the copilot, the report, the tower, the end) wins, then a fresh delivery's green toast, then the
 * ambient line (the desk, the pre-flight, the orange countdown).
 */
export function cardAt(t: number, u = 0, out: CardState = newCardState(), landings?: Landings): CardState {
  const inOffice = u > 0 && u < 1;
  const n = delivered(t, u, landings);
  out.visible = t >= CARD_FROM;
  out.delivered = n;
  out.meter = n / CAMPAIGN.total;
  out.meterKind = 'delivered';
  out.report = 0;
  const cmin = clockAt(t, u, landings);
  const ck = Math.floor(cmin);
  if (ck !== clockKey) {
    clockKey = ck;
    clockStr = hhmm(cmin);
  }
  out.clock = clockStr;
  out.badge = t >= SKIPPED.t ? CARD.cleared : clockStr;

  // the office: Lena's toast, keyed on u (the detour's own clock)
  if (inOffice) {
    if (u >= OFFICE_U) return put(out, OFFICE_TOAST, OFFICE_TOAST_SHORT, 'ok');
    return put(out, OFFICE_FLYING, OFFICE_FLYING, 'wait');
  }
  // the end: received, then the reply
  if (t >= HERO_REPLY_T) return put(out, CARD.heroReply, CARD.heroReply, 'reply');
  if (t >= HERO_RECEIVED_T) return put(out, CARD.received, CARD.received, 'ok');
  // the tower and the ride up it
  if (t >= 0.928) return put(out, CARD.tower, CARD.towerShort, 'info');
  if (t >= REPORT.to) return put(out, CARD.lastOne, CARD.lastOne, 'wait');
  if (t >= REPORT.from) {
    out.report = t < REPORT.reveal ? 0 : Math.min(1 + Math.floor((t - REPORT.reveal) / REPORT.step), REPORT.rows.length);
    return put(out, CARD.lastOne, CARD.lastOne, 'info');
  }
  // the copilot docks; the window wave's names are on the chips
  if (t >= 0.8) return put(out, CARD.copilot, CARD.copilot, 'info');
  // the no-fly zone: the 43rd is refused
  if (t >= SKIPPED.t && t < SKIPPED.t + 0.016) return put(out, CARD.skip, CARD.skipShort, 'bad');
  // the beacon: the beam locks on, the dart goes through the lamp and three auth rings stamp out of it
  if (t >= 0.54 && t < 0.559) return put(out, CARD.auth, CARD.auth, 'ok');
  // the storm: the bomber is struck, ours flies through
  if (t >= 0.424 && t < 0.448) return put(out, CARD.bccGreen, CARD.bccGreenShort, 'ok');
  if (t >= 0.403 && t < 0.424) return put(out, CARD.bccRed, CARD.bccRed, 'bad');
  // the formation: Hugo's reply cancels his follow-ups
  if (t >= REPLY.rise && t < REPLY.rise + 0.007) return put(out, CARD.reply, CARD.reply, 'reply');

  // the ocean: the cadence against the daily cap (the horizon's columns carry the names on their chips)
  if (t >= 0.452 && t < 0.515) {
    out.meter = n / CAMPAIGN.cap;
    out.meterKind = 'cap';
    if (n !== capKey) {
      capKey = n;
      capStr = CARD.dailyCap(n);
    }
    return put(out, capStr, capStr, 'wait');
  }
  // a fresh delivery
  const last = lastLanded(t, u, landings);
  if (last && last.kind !== 'office' && last.kind !== 'hero' && t < landOf(last, landings) + TOAST_HOLD) {
    return put(out, TOASTS[last.n - 1]!, TOASTS_SHORT[last.n - 1]!, 'ok');
  }
  if (t < 0.098) return put(out, CARD.desk, CARD.desk, 'info');
  if (t < 0.131) return put(out, CARD.preflightCheck, CARD.preflightCheck, 'info');
  if (t < CLOCK_FROM) return put(out, CARD.preflight, CARD.preflight, 'ok');
  // between deliveries: the orange countdown to the next one
  const next = nextRow(t, u, landings);
  const wait = nextIn(t, u, landings);
  // under half a campaign minute to go, it says whose turn it is instead of a 0m 00s countdown
  const soon = !!next && wait < 0.5;
  const wk = soon ? -1000 - next.n : Math.round(wait * 60);
  if (wk !== waitKey) {
    waitKey = wk;
    waitLong = soon ? CARD.sending(next) : CARD.waiting(wait);
    waitShort = soon ? CARD.sending(next) : CARD.waitingShort(wait);
  }
  return put(out, waitLong, waitShort, 'wait');
}
