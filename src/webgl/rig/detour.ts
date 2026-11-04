/**
 * The office detour: a stretch of scroll where story-t STOPS and a sub-timeline `u` runs instead.
 *
 * Story-t is written as literal numbers across the whole engine (visibility gates, grades, beats,
 * titles), so the detour is not a chapter: it is a pause in t. One extra spacer section in the
 * scroll stage (Experience.astro, `[data-detour]`) is `W` of the scroll; scroll progress `p` maps to
 *
 *   p <  Ps          t = p / (1 - W)                u = 0
 *   Ps <= p <= Ps+W  t = T_S                        u = (p - Ps) / W
 *   p >  Ps + W      t = (p - W) / (1 - W)          u = 0 (the detour is behind)
 *
 * with Ps = T_S * (1 - W), so t is continuous at both edges and every chapter keeps its own
 * stretch of scroll in the same proportions as before. W = 0 (a page without the spacer) is the
 * identity. Everything in here is pure (no three, no DOM): `scripts/check-detour.mjs` tests it.
 *
 * Everything in the detour is keyed on `u` alone (the cuts, the flare, the screen's state), never
 * on events, so a scrub in either direction or a fast flick always lands on the same frame.
 */

/** the story moment the detour leaves from and rejoins: the copilot climb, above the night city */
export const T_S = 0.79;

/** the sub-timeline's beats */
export const DETOUR = {
  /** the dart reaches the tower's glass: flare and cut into the office */
  cutIn: 0.08,
  /** the establishing shot from the window ends; the envelope comes out after the dart */
  envelopeFrom: 0.2,
  /** the envelope is inside the live laptop */
  absorbed: 0.45,
  /** the screen reads received; the card is up until `cardTo` */
  received: 0.47,
  cardTo: 0.62,
  /** the dart turns for the window */
  leave: 0.6,
  /** the dart reaches the glass from inside: flare and cut back to the city */
  cutOut: 0.66,
  /** out of the facade; the climb over the city starts */
  climb: 0.72,
} as const;

export interface DetourState {
  /** story-t */
  t: number;
  /** the detour's own clock, 0..1; 0 outside the detour */
  u: number;
  /** inside the detour's stretch of scroll (0 < u < 1) */
  active: boolean;
}

/** where the detour starts in scroll progress */
export function detourStart(w: number): number {
  return T_S * (1 - w);
}

/** scroll progress (0..1) to story-t and the detour clock */
export function detourMap(p: number, w: number): DetourState {
  const q = Math.min(Math.max(p, 0), 1);
  if (!(w > 0)) return { t: q, u: 0, active: false };
  const ps = detourStart(w);
  if (q < ps) return { t: q / (1 - w), u: 0, active: false };
  if (q > ps + w) return { t: Math.min((q - w) / (1 - w), 1), u: 0, active: false };
  const u = (q - ps) / w;
  return { t: T_S, u, active: u > 0 && u < 1 };
}

/** the inverse: the scroll progress that shows story-t `t` (u = 0 before T_S, u at T_S, past it after) */
export function progressOf(t: number, w: number, u = 0): number {
  if (!(w > 0)) return t;
  if (t < T_S) return t * (1 - w);
  if (t > T_S) return t * (1 - w) + w;
  return detourStart(w) + Math.min(Math.max(u, 0), 1) * w;
}

/** in the office (the room is on screen and the rest of the world is hidden) */
export function insideAt(u: number): boolean {
  return u >= DETOUR.cutIn && u < DETOUR.cutOut;
}

/** the white-out over each cut, 0..1: a narrow bump centred on the cut, wide enough to be seen at any scroll speed */
export function flareAt(u: number): number {
  const bump = (c: number, rise: number, fall: number): number => {
    const d = u - c;
    const s = d < 0 ? rise : fall;
    return Math.exp(-(d / s) * (d / s));
  };
  if (u <= 0 || u >= 1) return 0;
  return Math.max(bump(DETOUR.cutIn, 0.016, 0.022), bump(DETOUR.cutOut, 0.016, 0.022));
}

/**
 * How much the detour owns the camera and the dart: 0 at both ends (the frame IS the main rig's),
 * 1 once it is under way. The poses it blends toward start and end on the main rig's own pose, so
 * the ramp only has to cover what the main rig does that the detour does not model (turbulence).
 */
export function detourWeight(u: number): number {
  if (u <= 0 || u >= 1) return 0;
  return smooth(u, 0, 0.025) * (1 - smooth(u, 0.975, 1));
}

/**
 * The fastest the scroll may carry the detour clock, in u per second: a flick across the whole
 * page still plays the detour in about two-thirds of a second, so neither cut can be stepped over
 * between two frames without its flare (see Engine.renderFrame).
 */
export const MAX_U_RATE = 1.5;

export function smooth(x: number, a: number, b: number): number {
  const k = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return k * k * (3 - 2 * k);
}
