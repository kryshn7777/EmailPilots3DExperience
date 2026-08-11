import { Uniform } from 'three';
import { Effect, EffectAttribute } from 'postprocessing';

const fragmentShader = /* glsl */ `
uniform float uStrength;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  if (uStrength < 0.0005) {
    outputColor = inputColor;
    return;
  }
  // zoom blur toward a point just above center — reads as speed along the
  // flight line while the hero plane near the focus stays legible
  vec2 center = vec2(0.5, 0.55);
  vec2 toCenter = uv - center;
  vec4 sum = inputColor;
  for (int i = 1; i <= 7; i++) {
    sum += texture(inputBuffer, uv - toCenter * (uStrength * float(i) / 7.0));
  }
  outputColor = sum / 8.0;
}
`;

/**
 * Scroll-speed motion blur: a radial zoom blur whose strength the engine
 * drives from how far the rendered flight trails the scrollbar. Free when
 * idle (early-out), 7 extra taps while scrubbing fast.
 */
export class ZoomBlurEffect extends Effect {
  constructor() {
    super('ZoomBlurEffect', fragmentShader, {
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map([['uStrength', new Uniform(0)]]),
    });
  }

  get strength(): number {
    return this.uniforms.get('uStrength')!.value as number;
  }

  set strength(value: number) {
    this.uniforms.get('uStrength')!.value = value;
  }
}
