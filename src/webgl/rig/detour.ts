import { DETOUR_TIMING } from './pathPoints.mjs';

/**
 * The office detour: a stretch of scroll where story-t runs SLOWLY across the IT-office tower and a sub-timeline
 * `u` drives the office.
 *
 * The tower crossing is part of the flight line (pathPoints.mjs): the line goes straight in the tower's west face
 * and straight out of its east face, and the dart is always ON it, except between the two cuts, when the camera is
 * in the office (its own stage, below the world). Story-t does not stop: across the detour's spacer section in the
 * scroll stage (Experience.astro, `[data-detour]`, `W` of the scroll) it runs from T_S to T_E = T_S + D_T, and
 * u = (t - T_S) / D_T. Scroll progress `p` maps to
 *
 *   p <  Ps          t = p (1 - D_T) / (1 - W)                         u = 0
 *   Ps <= p <= Pe    t = T_S + D_T u,  u = (p - Ps) / W                (the detour)
 *   p >  Pe          t = T_E + (p - Pe) (1 - D_T) / (1 - W)            u = 0 (the detour is behind)
 *
 * with Ps = T_S (1 - W) / (1 - D_T) and Pe = Ps + W, so t is continuous and increasing everywhere and the rest of
 * the story keeps its share of the scroll in the same proportions as before. W = 0 (a page without the spacer) is
 * the identity (no office: the dart just flies through the tower). Everything in here is pure (no three, no DOM):
 * `scripts/check-detour.mjs` tests it.
 *
 * The office's beats are keyed on `u` alone (the cuts, the flare, the screen's state), never on events, so a scrub
 * in either direction or a fast flick always lands on the same frame.
 */

/** the story moment the detour starts at (the dart is 0.4 short of the tower's west face) */
export const T_S = DETOUR_TIMING.T_S;
/** how much story-t the detour carries: the run-in, the tower and the burst out of it */
export const D_T = DETOUR_TIMING.D_T;
/** where it ends */
export const T_E = T_S + D_T;

/** the sub-timeline's beats */
export const DETOUR = {
  /** the dart reaches the tower's west face (P(T_S + cutIn D_T) is on it): flare and cut into the office */
  cutIn: DETOUR_TIMING.cutIn,
  /** every monitor in the room flickers on red, the old way (all the same "Dear all"), then dies */
  flickerFrom: 0.1,
  flickerTo: 0.135,
  /** the envelope drops out of the dart's belly toward the one live laptop */
  envelopeFrom: 0.33,
  /** the envelope is inside the live laptop: delivered */
  absorbed: 0.45,
  /** the screen reads received; the card is up until `cardTo` */
  received: 0.47,
  cardTo: 0.64,
  /** the dart reaches the far glass from inside (P(T_S + cutOut D_T) is on the east face): flare and cut back */
  cutOut: DETOUR_TIMING.cutOut,
  /** the glass shards are spent */
  shardsTo: 0.86,
} as const;

/** the story-t at detour clock u */
export function tOfU(u: number): number {
  return T_S + D_T * Math.min(Math.max(u, 0), 1);
}

/** the detour clock at story-t t (0 before the detour, 1 after it) */
export function uOfT(t: number): number {
  return Math.min(Math.max((t - T_S) / D_T, 0), 1);
}

export interface DetourState {
  /** story-t */
  t: number;
  /** the detour's own clock, 0..1, while it runs; 0 outside it (before and after) */
  u: number;
  /** inside the detour's stretch of scroll (0 < u < 1) */
  active: boolean;
}

/**
 * Where the detour starts in scroll progress. `gap` is the linear story-t the spacer sits at: T_S for the plain
 * linear map; the pace warp (rig/pace.ts) puts it where its own pixels reach T_S, so it passes its `gap` here.
 */
export function detourStart(w: number, gap = T_S): number {
  return (gap * (1 - w)) / (1 - D_T);
}

/**
 * Scroll progress (0..1) to linear story-t and the detour clock. With the default `gap` the linear story-t IS
 * story-t (no pace warp); with the pace's `gap` it is the warp's input (the detour runs gap -> gap + D_T in it).
 */
export function detourMap(p: number, w: number, gap = T_S): DetourState {
  const q = Math.min(Math.max(p, 0), 1);
  if (!(w > 0)) return { t: q, u: 0, active: false };
  const ps = detourStart(w, gap);
  const k = (1 - D_T) / (1 - w);
  if (q < ps) return { t: q * k, u: 0, active: false };
  if (q > ps + w) return { t: Math.min(gap + D_T + (q - ps - w) * k, 1), u: 0, active: false };
  const u = (q - ps) / w;
  return { t: gap + D_T * u, u, active: u > 0 && u < 1 };
}

/** the inverse: the scroll progress that shows linear story-t `t` (exact; inside the detour `t` and `u` are the same thing) */
export function progressOf(t: number, w: number, gap = T_S): number {
  const q = Math.min(Math.max(t, 0), 1);
  if (!(w > 0)) return q;
  const ps = detourStart(w, gap);
  const k = (1 - D_T) / (1 - w);
  if (q < gap) return q / k;
  if (q > gap + D_T) return ps + w + (q - gap - D_T) / k;
  return ps + ((q - gap) / D_T) * w;
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
  // the tails are cut off (a faint veil over the dark office read as fog). The way in rises a little earlier:
  // the dart is still on the line at speed until just before the glass, and slows under the white (rig/pace.ts)
  // wide and soft, so the city fades into light and the office fades out of it rather than strobing white
  // (it was 0.02 / 0.014 wide, a flash); the cut itself still sits under the full white at the bump's top
  const f = Math.max(bump(DETOUR.cutIn, 0.055, 0.045), bump(DETOUR.cutOut, 0.04, 0.045));
  return Math.max(0, (f - 0.04) / 0.96);
}

/**
 * How much the office owns the camera and the dart: 1 between the cuts, 0 everywhere else. Outside the office the
 * dart is on the flight line and the camera is the main rig's (its beats frame the run at the glass and the burst
 * out of the far face); the switch is a cut, made under the flare.
 */
export function detourWeight(u: number): number {
  return insideAt(u) ? 1 : 0;
}

/**
 * The fastest the scroll may carry the detour clock, in u per second: a flick across the whole page still plays
 * the detour in about two-thirds of a second, so neither cut can be stepped over between two frames without its
 * flare (see Engine.renderFrame).
 */
export const MAX_U_RATE = 1.5;

export function smooth(x: number, a: number, b: number): number {
  const k = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return k * k * (3 - 2 * k);
}
