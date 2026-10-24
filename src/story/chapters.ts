/**
 * Single source of truth for the ten-chapter flight.
 * t-ranges drive the master scroll scrub; rig params shape the camera per
 * chapter and are blended across boundaries. FX keyframes join in Phase 3+.
 */

export interface GradeParams {
  /** sky gradient */
  zenith: string;
  horizon: string;
  /** sun (or key practical) */
  sunColor: string;
  sunIntensity: number;
  /** normalized sun direction, world space */
  sunDir: [number, number, number];
  /** fog */
  fogColor: string;
  fogNear: number;
  fogFar: number;
  /** IBL strength */
  envIntensity: number;
  /**
   * Mist standing on the ground or the sea, on top of the distance fog (see
   * webgl/fog.ts): `strength` 0..1 is how much the fog hugs the surface, `boost`
   * how much denser than the plain fog it is down there, `scale` the height over
   * which it thins out. Absent means ordinary distance fog.
   */
  mist?: { strength: number; boost: number; scale: number; base: 'ground' | 'sea' };
  /**
   * How much of the high cloud layer in the sky dome is cloud, 0 (clear) to 1 (overcast). The layer
   * is what the god rays shine through, so it is worth setting where the sun is on screen.
   */
  cloud?: number;
  /**
   * How wet the ground reads to the traced reflections (post/SSR.ts), 0 dry .. 1 after rain:
   * paving, asphalt and roofs mirror the lamps, the neon and the cars in patches. Default 0.25.
   */
  wet?: number;
  /** strength of the one-bounce global illumination (post/SSGI.ts). Default 0.8. */
  bounce?: number;
  /**
   * Multiplies the sun's direct light only (not the sky, the lamps or the windows, which follow
   * `sunIntensity`): a low sun that rakes the roofs and throws long shadows while the street lamps are
   * already on. Default 1.
   */
  key?: number;
  /**
   * The haze glowing toward the sun (webgl/fog.ts `fogSun`): how much of the sun's colour the distance
   * fog takes on when looking toward it. Default 0.
   */
  inscatter?: number;
  /**
   * Volumetric haze lit by the sun, with the sun's shadows in it (post/VolumetricFog.ts, HIGH tier):
   * shafts between the houses and through the trees. `density` is the extinction per unit at the
   * base, `scale` the height over which it thins, `noise` 0..1 how much it breaks into drifting
   * banks, `aniso` the forward lobe (0..0.95), `sun` the sunlight it scatters (x the sun colour),
   * `ambient` the sky light it scatters (x the fog colour). Absent is none.
   */
  volume?: { density: number; scale: number; noise?: number; aniso?: number; sun?: number; ambient?: number; base: 'ground' | 'sea' };
}

export interface RigParams {
  /** vertical FOV in degrees */
  fov: number;
  /** how far behind the plane the camera trails, in t-units */
  camLag: number;
  /** how far ahead of the plane the look target sits, in t-units */
  lookAhead: number;
  /** turbulence amplitude in world units */
  turbAmp: number;
  /** camera offset from its path point (local-ish world units) */
  offsetUp: number;
  offsetSide: number;
  /**
   * extra pull-back along -tangent in WORLD units. Needed where a chapter's
   * zone is spatially short (desk): story-space camLag compresses to nearly
   * zero world distance there, gluing the camera to the plane.
   */
  offsetBack: number;
  /** static dutch tilt in degrees (positive rolls the frame clockwise). Default 0. */
  dutch?: number;
  /** how much the camera banks with the flight line's turns, 0 (level horizon) .. 1. Default 0. */
  bank?: number;
  /**
   * raise (+) or lower (−) the look target, world units: a camera riding low with a raised look
   * target is a hero angle, the houses and towers climbing out of the frame. Default 0.
   */
  lookUp?: number;
}

export interface Chapter {
  id: string;
  t0: number;
  t1: number;
  rig: RigParams;
  grade: GradeParams;
}

export const CHAPTERS: Chapter[] = [
  {
    // Reverse angle: camera sits AHEAD looking back, so the laptop screen
    // ("SENDING EMAIL…") faces the viewer as the plane comes out of it; the
    // CH1→CH2 blend swings the camera around behind for the rest of the flight.
    id: 'desk', t0: 0.0, t1: 0.09,
    rig: { fov: 38, camLag: 0.012, lookAhead: -0.002, turbAmp: 0.0, offsetUp: 1.45, offsetSide: 1.0, offsetBack: -4.4, bank: 0 },
    grade: { zenith: '#0a0d18', horizon: '#1a1e2e', sunColor: '#ffb65c', sunIntensity: 0.35, sunDir: [0.3, 0.9, 0.3], fogColor: '#0a0d18', fogNear: 4, fogFar: 40, envIntensity: 0.25, cloud: 0.35, wet: 0.12, bounce: 1.0 },
  },
  {
    id: 'preflight', t0: 0.09, t1: 0.17,
    // rides high and looks flat, not up the climb: aiming far along a steeply
    // rising path pitched the lens at open sky just as the city should appear
    rig: { fov: 42, camLag: 0.014, lookAhead: 0.001, turbAmp: 0.02, offsetUp: 2.6, offsetSide: 0.6, offsetBack: 1.8, bank: 0.3 },
    // the window opens on a tower district standing in an overcast deck, so
    // the haze is cloud-coloured and reaches far: the old near-black fog at
    // 60 units cut every neighbour down to a silhouette
    grade: { zenith: '#141b2e', horizon: '#3b496b', sunColor: '#ffb65c', sunIntensity: 0.85, sunDir: [0.55, 0.2, 0.4], key: 1.6, fogColor: '#2b3652', fogNear: 70, fogFar: 330, envIntensity: 0.5, cloud: 0.6, wet: 0.35, bounce: 0.9,
      // fog belongs to the distance: clear streets below the window, the far town
      // sinking into the horizon (the mist term thickens it along the ground only)
      mist: { strength: 1, boost: 1.9, scale: 6, base: 'ground' },
      inscatter: 0.5, volume: { density: 0.007, scale: 3.5, noise: 0.75, aniso: 0.8, sun: 0.9, ambient: 0.25, base: 'ground' } },
  },
  {
    id: 'takeoff', t0: 0.17, t1: 0.26,
    // low and closer than the other chapters: the street is a long zone, and at the old 0.020
    // lag the camera rode eleven units back with the dart a speck between the lamps
    rig: { fov: 58, camLag: 0.014, lookAhead: 0.010, turbAmp: 0.06, offsetUp: 0.75, offsetSide: 0.45, offsetBack: 0.6, bank: 0.5, lookUp: 0.35 },
    grade: { zenith: '#27324a', horizon: '#8fa8cc', sunColor: '#ffc987', sunIntensity: 0.9, sunDir: [0.6, 0.24, 0.25], key: 1.5, fogColor: '#7f93b4', fogNear: 80, fogFar: 340, envIntensity: 0.45, cloud: 0.5, wet: 0.4, bounce: 0.9,
      mist: { strength: 1, boost: 2.1, scale: 7, base: 'ground' },
      inscatter: 0.5, volume: { density: 0.009, scale: 3.5, noise: 0.75, aniso: 0.8, sun: 0.9, ambient: 0.25, base: 'ground' } },
  },
  {
    id: 'formation', t0: 0.26, t1: 0.36,
    rig: { fov: 50, camLag: 0.024, lookAhead: 0.012, turbAmp: 0.10, offsetUp: 1.2, offsetSide: 1.4, offsetBack: 1.2, bank: 0.7 },
    grade: { zenith: '#7f9cc8', horizon: '#ffd9a0', sunColor: '#ffd9a0', sunIntensity: 1.6, sunDir: [0.62, 0.25, 0.1], fogColor: '#dcc6a4', fogNear: 100, fogFar: 360, envIntensity: 0.6, cloud: 0.55, wet: 0.1, bounce: 0.6,
      mist: { strength: 0.6, boost: 1.4, scale: 6, base: 'ground' },
      // no volume up here: from formation height the ground haze only greys the town (the mist and
      // the fog already give it depth), so it fades out across the takeoff/formation seam
      inscatter: 0.15 },
  },
  {
    id: 'storm', t0: 0.36, t1: 0.48,
    rig: { fov: 60, camLag: 0.016, lookAhead: 0.008, turbAmp: 0.55, offsetUp: 0.8, offsetSide: 0.0, offsetBack: 0.4, dutch: 3, bank: 0.5 },
    grade: { zenith: '#0f1220', horizon: '#3b2e4f', sunColor: '#8a7fb0', sunIntensity: 0.35, sunDir: [0.2, 0.6, -0.3], fogColor: '#1a1530', fogNear: 14, fogFar: 130, envIntensity: 0.2, cloud: 0.9, wet: 0.3, bounce: 0.45 },
  },
  {
    id: 'beacon', t0: 0.48, t1: 0.58,
    rig: { fov: 46, camLag: 0.026, lookAhead: 0.014, turbAmp: 0.09, offsetUp: 1.8, offsetSide: 1.0, offsetBack: 1.5, bank: 0.35 },
    // fog reaches much further than the other night chapters on purpose: the
    // sea and the freighter standing off it are staged at 80–100 units, and
    // at the old far=115 the ship dissolved into fog colour instead of
    // reading as distance
    grade: { zenith: '#060b12', horizon: '#0e2530', sunColor: '#7fe8d8', sunIntensity: 0.38, sunDir: [-0.2, 0.7, 0.4], fogColor: '#0a1a21', fogNear: 40, fogFar: 380, envIntensity: 0.26, cloud: 0.4, wet: 0.95, bounce: 0.7,
      // sea mist lies on the water; the lighthouse, the sky and the stars stand above it
      mist: { strength: 0.7, boost: 1.2, scale: 2.5, base: 'sea' } },
  },
  {
    id: 'no-fly', t0: 0.58, t1: 0.66,
    rig: { fov: 50, camLag: 0.024, lookAhead: 0.012, turbAmp: 0.08, offsetUp: 3.6, offsetSide: 0.4, offsetBack: 1.6, dutch: -1.5, bank: 0.4 },
    grade: { zenith: '#0a0f1c', horizon: '#141c2e', sunColor: '#aab6d0', sunIntensity: 0.4, sunDir: [-0.3, 0.6, 0.2], fogColor: '#101318', fogNear: 20, fogFar: 200, envIntensity: 0.25, cloud: 0.3, wet: 0.25, bounce: 0.7 },
  },
  {
    id: 'city', t0: 0.66, t1: 0.78,
    rig: { fov: 62, camLag: 0.018, lookAhead: 0.008, turbAmp: 0.12, offsetUp: 0.65, offsetSide: 0.35, offsetBack: 0.7, bank: 0.5, lookUp: 0.45 },
    grade: { zenith: '#0b1024', horizon: '#2a2138', sunColor: '#ffc96b', sunIntensity: 0.3, sunDir: [-0.4, 0.5, 0.1], fogColor: '#151a33', fogNear: 14, fogFar: 170, envIntensity: 0.3, cloud: 0.3, wet: 0.85, bounce: 1.25 },
  },
  {
    id: 'copilot', t0: 0.78, t1: 0.88,
    rig: { fov: 40, camLag: 0.024, lookAhead: 0.014, turbAmp: 0.05, offsetUp: 1.4, offsetSide: 1.3, offsetBack: 1.6, bank: 0.45 },
    grade: { zenith: '#05070f', horizon: '#0a0f1c', sunColor: '#9be8ff', sunIntensity: 0.25, sunDir: [-0.5, 0.4, -0.2], fogColor: '#05070f', fogNear: 30, fogFar: 260, envIntensity: 0.15, cloud: 0.1, wet: 0.3, bounce: 0.8 },
  },
  {
    id: 'landing', t0: 0.88, t1: 1.0,
    // tight lag and almost no trail: this chapter ends INSIDE a laptop screen,
    // and at the old 0.018 lag the camera stopped ten units short of it, in
    // the middle of the office, with the payoff a postage stamp in frame
    rig: { fov: 40, camLag: 0.006, lookAhead: 0.004, turbAmp: 0.02, offsetUp: 0.55, offsetSide: 0.25, offsetBack: 0.5, bank: 0.25 },
    grade: { zenith: '#4a5a80', horizon: '#ff9e7a', sunColor: '#ffe8c9', sunIntensity: 1.2, sunDir: [0.7, 0.27, 0.3], fogColor: '#c9a58f', fogNear: 25, fogFar: 200, envIntensity: 0.55, cloud: 0.5, wet: 0.3, bounce: 1.0 },
  },
];

/**
 * The hero's letter folds into the dart across this t-window, in the air over the desk: it is
 * the third envelope to leave the laptop (webgl/rig/launch.ts: released at 0.025, folding from
 * +0.012 to +0.030 after it).
 */
export const FOLD_WINDOW = { start: 0.037, end: 0.055 };

/** Contrail becomes visible once airborne. */
export const CONTRAIL_FROM = 0.17;

/** Touchdown moment inside CH10 — confetti fires crossing it. */
export const TOUCHDOWN_T = 0.952;

/** The dart unfolds back into the letter after rollout. */
export const UNFOLD_WINDOW = { start: 0.958, end: 0.985 };

const BLEND_BAND = 0.025;

function lerp(a: number, b: number, u: number): number {
  return a + (b - a) * u;
}

function lerpRig(a: RigParams, b: RigParams, u: number): RigParams {
  return {
    fov: lerp(a.fov, b.fov, u),
    camLag: lerp(a.camLag, b.camLag, u),
    lookAhead: lerp(a.lookAhead, b.lookAhead, u),
    turbAmp: lerp(a.turbAmp, b.turbAmp, u),
    offsetUp: lerp(a.offsetUp, b.offsetUp, u),
    offsetSide: lerp(a.offsetSide, b.offsetSide, u),
    offsetBack: lerp(a.offsetBack, b.offsetBack, u),
    dutch: lerp(a.dutch ?? 0, b.dutch ?? 0, u),
    bank: lerp(a.bank ?? 0, b.bank ?? 0, u),
    lookUp: lerp(a.lookUp ?? 0, b.lookUp ?? 0, u),
  };
}

export interface GradeBlend {
  from: GradeParams;
  to: GradeParams;
  /** 0 = fully `from`, 1 = fully `to` */
  u: number;
}

/**
 * Grade at t as a from/to/u blend — the engine lerps colors and numbers in
 * one place. Blends across a wider band than the rig so light changes feel
 * like weather, not cuts.
 */
export function gradeBlendAt(t: number): GradeBlend {
  const GRADE_BAND = 0.05;
  const i = chapterIndexAt(t);
  const current = CHAPTERS[i]!;
  const next = CHAPTERS[i + 1];
  if (!next) return { from: current.grade, to: current.grade, u: 0 };

  const blendStart = next.t0 - GRADE_BAND;
  if (t < blendStart) return { from: current.grade, to: current.grade, u: 0 };
  const u = Math.min((t - blendStart) / GRADE_BAND, 1);
  return { from: current.grade, to: next.grade, u: u * u * (3 - 2 * u) };
}

export function chapterIndexAt(t: number): number {
  for (let i = CHAPTERS.length - 1; i >= 0; i--) {
    if (t >= CHAPTERS[i]!.t0) return i;
  }
  return 0;
}

/** Rig params at t, smoothly blended across the boundary band between chapters. */
export function rigParamsAt(t: number): RigParams {
  const i = chapterIndexAt(t);
  const current = CHAPTERS[i]!;
  const next = CHAPTERS[i + 1];
  if (!next) return current.rig;

  const blendStart = next.t0 - BLEND_BAND;
  if (t < blendStart) return current.rig;
  const u = (t - blendStart) / BLEND_BAND;
  // smoothstep the band so params ease instead of snapping
  const s = u * u * (3 - 2 * u);
  return lerpRig(current.rig, next.rig, Math.min(s, 1));
}
