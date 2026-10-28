import { Color } from 'three';

/** Deterministic PRNG so procedural layouts never reshuffle between reloads
 * (and so the /bake GLB and runtime window placement agree on the city). */
export function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A palette colour with its saturation scaled by `keep` (1 = unchanged): the props' primaries (shirts,
 * umbrellas, play sets, flowers) read as toys at full strength; real fabric and paint are duller.
 */
export function muted(hex: string, keep: number): string {
  const c = new Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  return `#${c.setHSL(hsl.h, hsl.s * keep, hsl.l).getHexString()}`;
}
