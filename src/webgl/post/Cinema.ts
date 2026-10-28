import { Uniform, Vector3 } from 'three';
import { Effect, EffectAttribute } from 'postprocessing';

/**
 * The lens and the film stock, in one fullscreen effect at the end of the chain.
 *
 * Every tier: a soft highlight shoulder and a gentle S-curve (the frame has no tone mapping, so
 * neon, lamps and bloom cores used to clip hard to flat white), animated film grain that also
 * dithers the half-float sky gradients, and letterbox bars the camera rig eases in for its key
 * beats. That part is a handful of ALU ops and samples nothing, so on LOW it merges into the
 * existing effect pass for free.
 *
 * HIGH adds the optics, which read neighbouring pixels and so need their own pass (postprocessing
 * cannot merge two convolution effects, and the zoom blur is one):
 *  - depth of field: an 8-tap gather whose radius grows behind the focus plane (the dart), each tap
 *    weighted by its own blur so a sharp foreground never smears over the background behind it.
 *    No near-field blur, and the sky stays sharp (the stars and the moon).
 *  - chromatic aberration: red and blue split radially, only towards the corners of the frame.
 */

const body = /* glsl */ `
uniform float uBars;
uniform float uGrain;
uniform float uGrainSize;
uniform float uSeed;
uniform float uCurve;
uniform float uFilmic;
uniform float uExposure;
uniform float uSat;
uniform vec3 uBalance;
#ifdef OPTICS
uniform float uAberration;
uniform float uFocus;
uniform float uBokeh;
#endif

// Khronos PBR Neutral: values below about 0.76 pass untouched, brighter ones are compressed toward
// white while keeping their hue, so a bright lit leaf stays a leaf and does not clip to flat lime
vec3 neutralTone(vec3 color) {
  const float startCompression = 0.8 - 0.04;
  const float desaturation = 0.15;
  float x = min(color.r, min(color.g, color.b));
  float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  color -= offset;
  float peak = max(color.r, max(color.g, color.b));
  if (peak < startCompression) return color;
  float d = 1.0 - startCompression;
  float newPeak = 1.0 - d * d / (peak + d - startCompression);
  color *= newPeak / peak;
  float g = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
  return mix(color, vec3(newPeak), g);
}

float cineHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

#ifdef OPTICS
// blur radius in pixels for a raw depth sample: zero up to just behind the dart, rising towards
// uBokeh with distance (thin-lens shaped), and zero for the sky
float cineCoc(const in float d) {
  if (d > 0.99999) return 0.0;
  float z = -getViewZ(d);
  float f = uFocus + 1.2;
  return uBokeh * clamp((z - f) / (z + f * 0.6), 0.0, 1.0);
}
#endif

MAIN_IMAGE {
  vec3 c = inputColor.rgb;

#ifdef OPTICS
  float pxScale = 1.0 / (texelSize.y * 720.0); // radii are authored at 720 lines
  float c0 = cineCoc(depth) * pxScale;
  float blur = 0.0;
  if (c0 > 0.35) {
    vec3 sum = c;
    float wsum = 1.0;
    for (int i = 0; i < 8; i++) {
      float fi = float(i);
      float r = sqrt((fi + 0.5) / 8.0) * c0;
      float a = fi * 2.39996323;
      vec2 suv = uv + vec2(cos(a), sin(a)) * r * texelSize;
      float sc = cineCoc(readDepth(suv)) * pxScale;
      float w = clamp(sc - r + 1.0, 0.0, 1.0);
      sum += texture2D(inputBuffer, suv).rgb * w;
      wsum += w;
    }
    c = sum / wsum;
    blur = clamp(c0 / 3.0, 0.0, 1.0);
  }
  if (uAberration > 0.0) {
    vec2 fromCentre = uv - 0.5;
    float edge = dot(fromCentre, fromCentre) * 2.0; // 0 at the centre, 1 in the corners
    vec2 shift = fromCentre * edge * uAberration * texelSize.x * 2.0;
    float r = texture2D(inputBuffer, uv + shift).r;
    float b = texture2D(inputBuffer, uv - shift).b;
    // the split only shows where the image is sharp; defocus already spreads the rest
    float keep = 1.0 - blur;
    c.r += (r - inputColor.r) * keep;
    c.b += (b - inputColor.b) * keep;
  }
#endif

  // film response, in a display-like space (sqrt is close enough to the sRGB curve here)
  c = max(c, 0.0);
  const float K = 0.8;
  vec3 over = max(c - K, 0.0);
  vec3 shoulder = K + (1.0 - K) * (1.0 - exp(-over / (1.0 - K)));
  vec3 plain = mix(c, mix(c, shoulder, step(K, c)), uCurve);
  c = mix(plain, neutralTone(c * uExposure * uBalance), uFilmic);
  vec3 d = sqrt(min(c, vec3(1.0)));
  d = mix(d, d * d * (3.0 - 2.0 * d), 0.14 * uCurve);
  float l = dot(d, vec3(0.299, 0.587, 0.114));
  // a breath of split-tone: cool shadows, warm highlights
  d += (vec3(-0.006, 0.002, 0.010) * (1.0 - l) + vec3(0.010, 0.003, -0.008) * l) * uCurve;
  d = mix(vec3(l), d, uSat);

  // grain: two hashes summed (a softer, film-like distribution), strongest in the mid-darks
  vec2 cell = floor(gl_FragCoord.xy / uGrainSize);
  float n = cineHash(cell + uSeed) + cineHash(cell * 1.37 + uSeed * 1.91) - 1.0;
  d += n * uGrain * smoothstep(0.0, 0.18, l) * (1.0 - 0.65 * l);
  c = max(d, 0.0);
  c *= c;

  // letterbox: matte black, with a one-pixel soft edge
  float fromMid = abs(uv.y - 0.5);
  float bar = smoothstep(0.5 - uBars - texelSize.y, 0.5 - uBars, fromMid) * step(0.0005, uBars);
  c *= 1.0 - bar;

  outputColor = vec4(c, inputColor.a);
}
`;

// postprocessing only hands mainImage the depth when its signature names it, so the two tiers differ here
const fragmentShader = (optics: boolean): string =>
  body.replace(
    'MAIN_IMAGE',
    optics
      ? 'void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor)'
      : 'void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor)',
  );

export interface CinemaOptions {
  /** the neighbour-reading half (depth of field + chromatic aberration): HIGH tier only */
  optics: boolean;
}

export class CinemaEffect extends Effect {
  readonly optics: boolean;
  /** 0..1, how far the letterbox bars are in; the bar height itself follows the aspect ratio */
  letterbox = 0;
  private aspect = 16 / 9;

  constructor({ optics }: CinemaOptions) {
    super('CinemaEffect', fragmentShader(optics), {
      attributes: optics ? EffectAttribute.CONVOLUTION | EffectAttribute.DEPTH : EffectAttribute.NONE,
      defines: optics ? new Map([['OPTICS', '1']]) : new Map(),
      uniforms: new Map<string, Uniform>([
        ['uBars', new Uniform(0)],
        ['uGrain', new Uniform(optics ? 0.03 : 0.026)],
        ['uGrainSize', new Uniform(1)],
        ['uSeed', new Uniform(0)],
        ['uCurve', new Uniform(1)],
        ['uFilmic', new Uniform(0)],
        ['uExposure', new Uniform(1)],
        ['uSat', new Uniform(1)],
        ['uBalance', new Uniform(new Vector3(1, 1, 1))],
        ['uAberration', new Uniform(0)],
        ['uFocus', new Uniform(4)],
        ['uBokeh', new Uniform(0)],
      ]),
    });
    this.optics = optics;
  }

  /**
   * Per frame. `focus` is the camera-to-subject distance (world units), `bokeh` the background blur
   * radius in pixels at 720 lines, `aberration` the red/blue split in the corners, in pixels.
   */
  frame(focus: number, bokeh: number, aberration: number): void {
    const u = this.uniforms;
    u.get('uSeed')!.value = (Math.random() * 512) | 0;
    // the bars make a ~2.2:1 frame on a 16:9 screen; a portrait phone gets a thinner matte
    const full = Math.min(this.aspect < 1 ? 0.06 : 0.1, Math.max(0, (1 - this.aspect / 2.2) / 2));
    u.get('uBars')!.value = full * this.letterbox;
    u.get('uFocus')!.value = focus;
    u.get('uBokeh')!.value = bokeh;
    u.get('uAberration')!.value = aberration;
  }

  /** Per frame, from the chapter's grade: the neutral tone curve's weight, its exposure, the frame's saturation and its white balance. */
  look(filmic: number, exposure: number, saturation: number, balance: [number, number, number]): void {
    const u = this.uniforms;
    (u.get('uBalance')!.value as Vector3).set(...balance);
    u.get('uFilmic')!.value = filmic;
    u.get('uExposure')!.value = exposure;
    u.get('uSat')!.value = saturation;
  }

  /** grain is drawn in CSS pixels, so a 2x phone does not get a finer, invisible grain */
  set pixelRatio(value: number) {
    this.uniforms.get('uGrainSize')!.value = Math.max(1, Math.round(value * 0.75));
  }

  override setSize(width: number, height: number): void {
    this.aspect = width / Math.max(height, 1);
  }
}
