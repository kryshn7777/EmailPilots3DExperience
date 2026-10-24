import {
  Color,
  Matrix4,
  Uniform,
  Vector2,
  Vector3,
  type DepthTexture,
  type DirectionalLight,
  type PerspectiveCamera,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { Effect, EffectAttribute } from 'postprocessing';
import { ScreenPass, VIEW_SPACE, bindCamera } from './viewSpace';

/**
 * Light in the air: the haze over the town lit by the sun, with the sun's own shadows in it. Each
 * pixel of a half-resolution buffer marches its view ray through an exponential height fog (thick
 * at the lawns, thinning with altitude, stirred by a slow drifting noise) and, at every step, asks
 * the sun's shadow map whether the sun reaches that point. Where it does the air scatters sunlight
 * toward the eye, strongly when looking toward the sun (a Henyey-Greenstein forward lobe); where a
 * roof, a tree or a chimney stands between, it does not. That is what draws the shafts between the
 * houses and through the canopies, the beams of a low sun in a hazy evening: the volumetric fog an
 * engine like Unreal draws, on the same principle (shadowed single scattering through a density
 * field), at a size a browser can afford.
 *
 * The march writes inscattered light and transmittance; a depth-aware blur turns the per-pixel
 * jitter into smoothness; the composite upsamples it against the full-resolution depth (so a roof
 * edge against the bright air does not bleed) and lays it over the frame: colour × transmittance
 * + inscatter. Off (no march, no cost) whenever the chapter's density is zero. HIGH tier only.
 */
const MARCH = /* glsl */ `
uniform vec3 uCamPos;
uniform sampler2DShadow uShadow;
uniform mat4 uShadowMatrix;
uniform float uShadowOn;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uAmbient;
uniform float uDensity;
uniform float uBase;
uniform float uScale;
uniform float uNoise;
uniform float uAniso;
uniform float uMaxDist;
uniform float uTime;
uniform vec2 uWind;
varying vec2 vUv;
${VIEW_SPACE}

const int STEPS = 32;

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}

// the air's density: an exponential layer on the ground, broken into drifting banks
float density(vec3 p) {
  float h = max(p.y - uBase, 0.0);
  float d = exp(-h / uScale);
  if (uNoise > 0.0) {
    vec3 q = vec3(p.x + uWind.x * uTime, p.y * 1.6, p.z + uWind.y * uTime);
    float n = vnoise(q * 0.045) * 0.65 + vnoise(q * 0.13 + 7.3) * 0.35;
    d *= mix(1.0, smoothstep(0.18, 0.8, n) * 1.9, uNoise);
  }
  return d * uDensity;
}

float sunVisible(vec3 p) {
  if (uShadowOn < 0.5) return 1.0;
  vec4 s = uShadowMatrix * vec4(p, 1.0);
  s.xyz /= s.w;
  // outside the shadow window the sun is taken to reach: shafts fade out at its edge
  vec2 e = abs(s.xy - 0.5);
  if (max(e.x, e.y) > 0.5 || s.z > 1.0) return 1.0;
  float fade = smoothstep(0.5, 0.42, max(e.x, e.y));
  return mix(1.0, texture(uShadow, vec3(s.xy, s.z - 0.0015)), fade);
}

float phaseHG(float mu, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (12.566371 * pow(max(1.0 + g2 - 2.0 * g * mu, 1e-4), 1.5));
}

void main() {
  float d = sceneDepth(vUv);
  vec3 P = viewPosAt(vUv, min(d, 0.9999999));
  vec3 W = (uCamWorld * vec4(P, 1.0)).xyz;
  vec3 ray = W - uCamPos;
  float far = length(ray);
  ray /= max(far, 1e-4);
  // the sky: the ray runs on into the haze, as far as the march reaches
  if (d >= 0.99999) far = uMaxDist;
  far = min(far, uMaxDist);

  float mu = dot(ray, uSunDir);
  // a sharp forward lobe for the shafts, a broad one so the air glows around the sun, a little back-scatter
  float phase = mix(phaseHG(mu, uAniso), phaseHG(mu, 0.2), 0.35) * 12.566371;
  vec3 sun = uSunColor * phase;

  float jitter = ign(gl_FragCoord.xy);
  vec3 light = vec3(0.0);
  float T = 1.0;
  float prev = 0.0;
  for (int i = 0; i < STEPS; i++) {
    // steps crowd near the lens, where shafts are sharp, and spread out with distance
    float f = (float(i) + jitter) / float(STEPS);
    float t = far * f * f;
    float dt = t - prev;
    prev = t;
    vec3 p = uCamPos + ray * t;
    float sigma = density(p);
    if (sigma < 1e-5) continue;
    vec3 S = sun * sunVisible(p) + uAmbient;
    float ext = exp(-sigma * dt);
    // energy-conserving step: the light scattered in over dt, already dimmed by the air in it
    light += T * S * (1.0 - ext);
    T *= ext;
    if (T < 0.01) break;
  }
  gl_FragColor = vec4(light, T);
}
`;

/** Smooths the jittered march across a surface, never across a depth edge. */
const BLUR = /* glsl */ `
uniform sampler2D uVol;
uniform vec2 uTexel;
uniform vec2 uDir;
varying vec2 vUv;
${VIEW_SPACE}

float lin(vec2 uv) { return -viewPos(uv).z; }

void main() {
  float z0 = lin(vUv);
  vec4 sum = vec4(0.0);
  float wsum = 0.0;
  for (int i = -3; i <= 3; i++) {
    vec2 uv = vUv + uDir * uTexel * float(i) * 1.5;
    float z = lin(uv);
    float w = exp(-abs(z - z0) / (0.05 * max(z0, 1.0))) / (1.0 + float(i * i) * 0.2);
    sum += texture2D(uVol, uv) * w;
    wsum += w;
  }
  gl_FragColor = sum / max(wsum, 1e-4);
}
`;

const composite = /* glsl */ `
uniform sampler2D uVol;
uniform vec2 uVolTexel;
uniform float uIntensity;
uniform float uDebug;

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  if (uIntensity < 0.001) { outputColor = inputColor; return; }
  // joint-bilateral upsample: of the four half-resolution texels around this pixel, trust the ones
  // that sit at this pixel's depth, so the bright air behind a roof does not bleed onto its edge
  float z0 = getViewZ(depth);
  vec2 base = (floor(uv / uVolTexel - 0.5) + 0.5) * uVolTexel;
  vec2 f = uv / uVolTexel - 0.5 - floor(uv / uVolTexel - 0.5);
  vec4 acc = vec4(0.0);
  float wsum = 0.0;
  for (int j = 0; j < 2; j++) {
    for (int i = 0; i < 2; i++) {
      vec2 o = vec2(float(i), float(j));
      vec2 s = base + o * uVolTexel;
      float z = getViewZ(readDepth(s));
      vec2 bw = mix(1.0 - f, f, o);
      float w = bw.x * bw.y * exp(-abs(z - z0) / (0.04 * max(-z0, 1.0))) + 1e-5;
      acc += texture(uVol, s) * w;
      wsum += w;
    }
  }
  vec4 v = acc / wsum;
  float T = mix(1.0, v.a, uIntensity);
  vec3 c = inputColor.rgb * T + v.rgb * uIntensity;
  if (uDebug > 1.5) { outputColor = vec4(vec3(v.a), 1.0); return; }
  outputColor = uDebug > 0.5 ? vec4(v.rgb * uIntensity, 1.0) : vec4(c, inputColor.a);
}
`;

export interface VolumeParams {
  /** extinction at the base of the layer, per world unit */
  density: number;
  /** world height the layer stands on */
  base: number;
  /** scale height: the density falls by e every this many units of altitude */
  scale: number;
  /** how much drifting noise breaks the layer into banks, 0..1 */
  noise: number;
  /** forward-scattering anisotropy of the sharp lobe, 0..0.95 */
  aniso: number;
  /** sunlight scattered, as a multiple of the sun's colour */
  sun: number;
  /** sky light scattered from every direction, as a colour */
  ambient: Color;
}

/** Volumetric height fog with shadowed sunlight (HIGH tier). */
export class VolumetricFogEffect extends Effect {
  private march: ScreenPass;
  private blurH: ScreenPass;
  private blurV: ScreenPass;
  private depth: Texture | null = null;
  /** 0 switches the whole effect off; the Engine fades it with the chapter */
  intensity = 0;
  readonly params: VolumeParams = {
    density: 0, base: 0, scale: 6, noise: 0.5, aniso: 0.75, sun: 1, ambient: new Color(),
  };

  constructor(private camera: PerspectiveCamera, private sun: DirectionalLight, fraction = 0.5) {
    const view = () => ({
      uDepth: { value: null }, uNormal: { value: null },
      uProj: { value: new Matrix4() }, uInvProj: { value: new Matrix4() }, uCamWorld: { value: new Matrix4() },
    });
    const march = new ScreenPass(MARCH, {
      ...view(),
      uCamPos: { value: new Vector3() },
      uShadow: { value: null },
      uShadowMatrix: { value: new Matrix4() },
      uShadowOn: { value: 0 },
      uSunDir: { value: new Vector3(0, 1, 0) },
      uSunColor: { value: new Color() },
      uAmbient: { value: new Color() },
      uDensity: { value: 0 },
      uBase: { value: 0 },
      uScale: { value: 6 },
      uNoise: { value: 0.5 },
      uAniso: { value: 0.75 },
      uMaxDist: { value: 120 },
      uTime: { value: 0 },
      uWind: { value: new Vector2(0.9, 0.35) },
    }, fraction);
    const blur = (src: ScreenPass, dir: [number, number]) => new ScreenPass(BLUR, {
      ...view(), uVol: { value: src.target.texture }, uTexel: { value: new Vector2(1, 1) }, uDir: { value: new Vector2(...dir) },
    }, fraction);
    const blurH = blur(march, [1, 0]);
    const blurV = blur(blurH, [0, 1]);
    super('VolumetricFogEffect', composite, {
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map<string, Uniform>([
        ['uVol', new Uniform(blurV.target.texture)],
        ['uVolTexel', new Uniform(new Vector2(1, 1))],
        ['uIntensity', new Uniform(0)],
        ['uDebug', new Uniform(0)],
      ]),
    });
    this.march = march;
    this.blurH = blurH;
    this.blurV = blurV;
  }

  /** inspection aid: 1 shows the scattered light alone, 2 the transmittance */
  set debug(mode: number) {
    this.uniforms.get('uDebug')!.value = mode;
  }

  override setDepthTexture(depthTexture: Texture): void {
    this.depth = depthTexture;
  }

  override setSize(width: number, height: number): void {
    for (const p of [this.march, this.blurH, this.blurV]) p.setSize(width, height);
    const w = this.march.target.width;
    const h = this.march.target.height;
    for (const p of [this.blurH, this.blurV]) (p.material.uniforms.uTexel!.value as Vector2).set(1 / w, 1 / h);
    (this.uniforms.get('uVolTexel')!.value as Vector2).set(1 / w, 1 / h);
  }

  override update(renderer: WebGLRenderer, _input: unknown, deltaTime?: number): void {
    const on = this.intensity > 0.001 && this.params.density > 1e-5 && !!this.depth;
    this.uniforms.get('uIntensity')!.value = on ? this.intensity : 0;
    if (!on) return;
    const u = this.march.material.uniforms;
    const p = this.params;
    u.uTime!.value += deltaTime ?? 0.016;
    u.uDensity!.value = p.density;
    u.uBase!.value = p.base;
    u.uScale!.value = p.scale;
    u.uNoise!.value = p.noise;
    u.uAniso!.value = p.aniso;
    (u.uAmbient!.value as Color).copy(p.ambient);
    (u.uSunColor!.value as Color).copy(this.sun.color).multiplyScalar(p.sun);
    (u.uSunDir!.value as Vector3).copy(this.sun.position).sub(this.sun.target.position).normalize();
    (u.uCamPos!.value as Vector3).setFromMatrixPosition(this.camera.matrixWorld);
    const map = this.sun.castShadow ? (this.sun.shadow.map?.depthTexture as DepthTexture | null | undefined) : null;
    u.uShadowOn!.value = map ? 1 : 0;
    if (map) {
      u.uShadow!.value = map;
      (u.uShadowMatrix!.value as Matrix4).copy(this.sun.shadow.matrix);
    }
    for (const pass of [this.march, this.blurH, this.blurV]) {
      pass.material.uniforms.uDepth!.value = this.depth;
      bindCamera(pass.material, this.camera);
    }
    this.march.render(renderer);
    this.blurH.render(renderer);
    this.blurV.render(renderer);
  }

  override dispose(): void {
    this.march.dispose();
    this.blurH.dispose();
    this.blurV.dispose();
    super.dispose();
  }
}
