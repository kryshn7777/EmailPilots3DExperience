import {
  CustomBlending,
  OneMinusSrcAlphaFactor,
  SrcAlphaFactor,
  ZeroFactor,
  type Material,
} from 'three';

/**
 * Makes a transparent material draw over the sky like ordinary alpha blending, except that the
 * frame's ALPHA channel is eroded instead of accumulated.
 *
 * The sky dome writes `1 - its own cloud cover` into alpha, so after every cloud, haze and
 * mountain layer has drawn, alpha is the fraction of the sun's light still reaching that pixel.
 * The god-ray march reads it (post/GodRays.ts): clouds write no depth, and without this they
 * would be invisible to it. Colour is unchanged — only the alpha function differs from
 * NormalBlending, and the canvas has no alpha, so nothing downstream sees it.
 */
export function erodesSkyVisibility<T extends Material>(material: T): T {
  material.blending = CustomBlending;
  material.blendSrc = SrcAlphaFactor;
  material.blendDst = OneMinusSrcAlphaFactor;
  material.blendSrcAlpha = ZeroFactor;
  material.blendDstAlpha = OneMinusSrcAlphaFactor;
  return material;
}
