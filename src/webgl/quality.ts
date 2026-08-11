export type Tier = 'high' | 'low';

/**
 * Blockout mode: every lit material renders flat, and the expensive passes
 * (ambient occlusion, bloom, the raymarched cloud slab) are off, so the scene
 * can be judged on staging, silhouette and colour alone before any of it is
 * lit.
 *
 * OPT-IN now (user call, 2026-08-11). It was the default through the art
 * passes, which meant the shipped render was the blockout: no AO, no bloom, no
 * volumetric slab, and every MeshStandardMaterial flattened to basic — which
 * is also why roof clutter and kit trim read as black slabs, having lost the
 * emissive term that lit them. `?blockout=1` brings it back for staging work;
 * `?lit=1` is still accepted and now does nothing, being the default.
 */
export const UNLIT = new URLSearchParams(
  typeof location === 'undefined' ? '' : location.search,
).has('blockout');

export interface Quality {
  tier: Tier;
  maxDpr: number;
  /** extra resolution multiplier under maxDpr — iGPUs are fill-bound, so
   * rendering fewer pixels and letting CSS upscale is the biggest lever */
  renderScale: number;
  /** raymarched cloud slab on/off (billboards always render) */
  volumetricClouds: boolean;
  cloudSteps: number;
  cloudSprites: number;
  rainCount: number;
  dustCount: number;
}

const HIGH: Quality = {
  tier: 'high',
  maxDpr: 2,
  renderScale: 1,
  volumetricClouds: true,
  /**
   * 22 dithered steps + the thin-sample sun-tap skip.
   *
   * Briefly 32 as part of the max-fidelity pass, and that is what made the
   * formation chapter lag: the slab is a fullscreen raymarch and the camera
   * flies INSIDE it, so every step is paid on every pixel of the frame. The
   * step count is the one term that scales that cost linearly. Every pass
   * still renders — AO, bloom, the slab itself — this is only the march.
   */
  cloudSteps: 22,
  // density comes from COUNT, not from fog: thickening the haze instead just
  // turned the climb to flat milk and took the staging with it
  cloudSprites: 640,
  rainCount: 2600,
  dustCount: 250,
};

const LOW: Quality = {
  tier: 'low',
  maxDpr: 1,
  renderScale: 0.75,
  volumetricClouds: false,
  cloudSteps: 0,
  cloudSprites: 360,
  rainCount: 900,
  dustCount: 90,
};

/**
 * Max-fidelity by default (user call, 2026-08-09): every desktop gets HIGH —
 * volumetric clouds, full DPR. Only touch-first small screens drop to LOW,
 * plus the `?q=low` escape hatch for testing / weak machines.
 */
export function detectQuality(gpuString: string): Quality {
  void gpuString;
  const forced = new URLSearchParams(location.search).get('q');
  // the raymarched slab is the single heaviest thing in the frame and it is
  // a lighting effect — blockout mode does without it
  const tier = (q: Quality): Quality => (UNLIT ? { ...q, volumetricClouds: false, cloudSteps: 0 } : q);
  if (forced === 'low') return tier(LOW);
  if (forced === 'high') return tier(HIGH);

  // phones AND tablets ride the mobile profile (baked LOW city rings etc.)
  const smallScreen = Math.min(screen.width, screen.height) < 1024;
  const coarse = matchMedia('(pointer: coarse)').matches;
  if (coarse && smallScreen) return tier(LOW);
  return tier(HIGH);
}

/** Unmasked GPU renderer string, best effort. */
export function gpuRendererString(gl: WebGLRenderingContext | WebGL2RenderingContext): string {
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  if (!ext) return '';
  try {
    return String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));
  } catch {
    return '';
  }
}
