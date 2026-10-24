import { MathUtils } from 'three';

/**
 * The launch from the study laptop, as pure functions of story-t (so it scrubs both ways).
 *
 * Three envelopes leave the screen one after another. Each floats out in front of it, opens into
 * a letter, folds itself into a dart in mid-air and then joins the airway to the window: the
 * first two are the scouts, the third is the hero the camera follows (CameraRig, Engine and
 * BatchSend all read the numbers here, so they cannot drift apart).
 */

/** story-t at which each envelope leaves the screen: scout 1, scout 2, the hero */
export const RELEASE_T = [0.006, 0.0155, 0.025] as const;

/** by this story-t every plane is on the airway at full speed (the hero is exactly on the path) */
export const JOIN_T = 0.088;

/** an envelope's life, in story-t after its release */
export const STAGE = {
  /** the envelope pops out of the screen and floats */
  pop: 0.005,
  /** it turns flat and the letter slides out of it */
  openFrom: 0.009,
  openTo: 0.014,
  /** the letter folds itself into a dart */
  foldFrom: 0.012,
  foldTo: 0.030,
  /** the little puff of paper flecks, as the last crease goes in */
  puff: 0.029,
} as const;

/** a paper plane next to a laptop: the dart is 1.6 long at scale 1, so this is ~0.5 */
export const ROOM_SCALE = 0.32;

/** How big the planes are at story-t: small in the study, full size as the flight opens up over the town. */
export function planeScale(t: number): number {
  return MathUtils.lerp(ROOM_SCALE, 1, MathUtils.smoothstep(t, 0.092, 0.15));
}

/** hero release, for the hooks that only care about it */
export const HERO_RELEASE = RELEASE_T[2];

/**
 * Where on the flight line a plane released at `release` is at story-t `t`, ending at `sEnd`
 * (JOIN_T plus how far ahead of the hero it is). It eases out of the screen slowly, whooshes
 * through the room and comes onto the airway at exactly the hero's pace (ds/dt = 1), so after
 * JOIN_T the parameter is simply `t + lead`.
 */
export function launchParam(t: number, release: number, sEnd: number): number {
  if (t <= release) return 0;
  const lead = sEnd - JOIN_T;
  if (t >= JOIN_T) return t + lead;
  const span = JOIN_T - release;
  const x = (t - release) / span;
  const m0 = (0.25 * span) / sEnd;
  const m1 = span / sEnd;
  const x2 = x * x;
  const x3 = x2 * x;
  const f = (x3 - 2 * x2 + x) * m0 + (-2 * x3 + 3 * x2) + (x3 - x2) * m1;
  return sEnd * f;
}

/** The hero's place on the flight line: this is `t` itself from JOIN_T on. */
export function heroParam(t: number): number {
  return launchParam(t, RELEASE_T[2], JOIN_T);
}

/** 0..1 bump centred on `at`, `w` wide each side: the soft light pulse from the screen. */
function bump(t: number, at: number, rise: number, fall: number): number {
  if (t < at - rise || t > at + fall) return 0;
  const u = t < at ? (t - (at - rise)) / rise : 1 - (t - at) / fall;
  return u * u * (3 - 2 * u);
}

/** The screen's light pulse at story-t: one soft swell as each envelope is released. */
export function launchPulse(t: number): number {
  let p = 0;
  for (const r of RELEASE_T) p = Math.max(p, bump(t, r + 0.0015, 0.003, 0.012));
  return p;
}

/** How many have left the screen (a letter in the air counts) and how far the next one is. */
export function sentAt(t: number): { sent: number; partial: number } {
  let sent = 0;
  for (const r of RELEASE_T) if (t >= r) sent++;
  const next = RELEASE_T[sent];
  const partial = next === undefined ? 0 : MathUtils.clamp((t - (next - 0.006)) / 0.006, 0, 1);
  return { sent, partial };
}

/**
 * How a plane sits in the air while it is still a letter: nose-up as it opens, levelling out as
 * the dart folds, with a little sway in its bank (none when `calm`) that settles on the airway.
 */
export function launchAttitude(tau: number, t: number, phase: number, calm: boolean): { pitch: number; sway: number } {
  const open = MathUtils.smoothstep(tau, STAGE.openFrom, STAGE.openTo);
  const fold = MathUtils.smoothstep(tau, STAGE.foldFrom, STAGE.foldTo);
  const sway = calm
    ? 0
    : Math.sin(tau * 170 + phase) * 0.2 * MathUtils.smoothstep(tau, 0.004, 0.02) * (1 - MathUtils.smoothstep(t, JOIN_T - 0.012, JOIN_T + 0.02));
  return { pitch: -0.55 * open * (1 - fold), sway };
}
