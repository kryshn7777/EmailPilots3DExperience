import {
  Color,
  HalfFloatType,
  LinearFilter,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Uniform,
  Vector2,
  WebGLRenderTarget,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { Effect, EffectAttribute } from 'postprocessing';
import fullscreenVert from '../shaders/fullscreen.vert.glsl';
import marchFrag from '../shaders/godrays.frag.glsl';

export interface GodRaysQuality {
  /** steps of the radial march */
  samples: number;
  /** shaft buffer size as a fraction of the frame */
  scale: number;
}

const composite = /* glsl */ `
uniform sampler2D uShafts;
uniform vec3 uColor;
uniform float uIntensity;
uniform float uDebug;
uniform vec2 uSunUv;
uniform float uAspect;
uniform float uFlare;

// how much of the sun's disc is open sky: depth says whether anything solid stands in front, the
// frame's alpha how much cloud (see materials/skyVisibility.ts); five taps across the disc
float sunOpen() {
  float open = 0.0;
  for (int i = 0; i < 5; i++) {
    float a = float(i) * 1.2566371;
    vec2 o = i == 0 ? vec2(0.0) : vec2(cos(a), sin(a) * uAspect) * 0.006;
    vec2 s = uSunUv + o;
    if (s.x < 0.0 || s.x > 1.0 || s.y < 0.0 || s.y > 1.0) continue;
    open += step(0.9999, readDepth(s)) * texture(inputBuffer, s).a;
  }
  return open / 5.0;
}

// The lens, not the sky: a glare core and starburst around the sun, an anamorphic streak through it,
// and ghosts of the aperture strung along the line from the sun through the middle of the frame.
vec3 flare(vec2 uv) {
  vec2 asp = vec2(uAspect, 1.0);
  vec2 d = (uv - uSunUv) * asp;
  float r = length(d);
  float core = exp(-r * 22.0) * 0.9 + 0.12 / (1.0 + r * r * 160.0);
  float ang = atan(d.y, d.x);
  float star = pow(abs(cos(ang * 4.0 + 0.4)), 60.0) + 0.6 * pow(abs(cos(ang * 7.0 - 0.2)), 90.0);
  vec3 c = uColor * (core + star * 0.35 * exp(-r * 7.0));
  // the streak: long and thin, cooler than the sun (the coating of an anamorphic lens)
  c += vec3(0.55, 0.75, 1.0) * exp(-abs(d.y) * 260.0) * exp(-abs(d.x) * 2.6) * 0.45;
  // ghosts: discs at fixed fractions of the sun-to-centre axis, each its own tint
  vec2 axis = vec2(0.5) - uSunUv;
  const float AT[5] = float[5](0.55, 0.95, 1.3, 1.62, 2.1);
  for (int i = 0; i < 5; i++) {
    float k = float(i);
    float size = 0.03 + 0.035 * fract(k * 0.618 + 0.21);
    vec2 g = (uv - (uSunUv + axis * AT[i])) * asp;
    float disc = smoothstep(size, size * 0.72, length(g));
    vec3 tint = mix(vec3(1.0, 0.65, 0.35), vec3(0.4, 0.85, 0.9), fract(k * 0.37 + 0.1));
    c += tint * disc * 0.05;
  }
  // a faint halo ring centred on the sun
  c += uColor * smoothstep(0.03, 0.0, abs(r - 0.42)) * 0.035;
  return c;
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 lens = uFlare > 0.002 ? flare(uv) * uFlare * sunOpen() : vec3(0.0);
  if (uDebug > 1.5) {
    outputColor = vec4(vec3(inputColor.a), 1.0);
    return;
  }
  if (uIntensity < 0.0005) {
    outputColor = uDebug > 0.5 ? vec4(0.0, 0.0, 0.0, 1.0) : vec4(inputColor.rgb + lens, inputColor.a);
    return;
  }
  // shafts are light scattered in the air in front of everything, so they add over buildings and sky
  // alike; over what is already bright they would only wash it out, so they give way to it
  vec3 shafts = uColor * texture(uShafts, uv).rgb * uIntensity;
  float room = 1.0 - clamp(dot(inputColor.rgb, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0) * 0.75;
  outputColor = uDebug > 0.5 ? vec4(shafts, 1.0) : vec4(inputColor.rgb + shafts * room + lens, inputColor.a);
}
`;

/**
 * Sun shafts. Each frame the effect marches from every pixel of a small buffer toward the sun,
 * summing the sky the sun can reach (see godrays.frag.glsl), then the final pass adds that,
 * upsampled and tinted, to the picture. Costs nothing while the sun is off screen or dim:
 * `set()` zeroes the strength, the march is skipped and the composite early-outs.
 */
export class GodRaysEffect extends Effect {
  private target: WebGLRenderTarget;
  private material: ShaderMaterial;
  private scene = new Scene();
  private camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private quad: Mesh;
  private depth: Texture | null = null;
  private strength = 0;

  constructor(quality: GodRaysQuality, private fraction = quality.scale) {
    const target = new WebGLRenderTarget(2, 2, {
      type: HalfFloatType,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      depthBuffer: false,
    });
    super('GodRaysEffect', composite, {
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map<string, Uniform>([
        ['uShafts', new Uniform(target.texture)],
        ['uColor', new Uniform(new Color('#ffd9a0'))],
        ['uIntensity', new Uniform(0)],
        ['uDebug', new Uniform(0)],
        ['uSunUv', new Uniform(new Vector2(0.5, 0.5))],
        ['uAspect', new Uniform(1)],
        ['uFlare', new Uniform(0)],
      ]),
    });
    this.target = target;
    this.material = new ShaderMaterial({
      vertexShader: fullscreenVert,
      fragmentShader: marchFrag,
      uniforms: {
        uScene: { value: null },
        uDepth: { value: null },
        uSun: { value: new Vector2(0.5, 0.5) },
        uAspect: { value: 1 },
        uDensity: { value: 0.96 },
        uDecay: { value: Math.pow(0.5, 1 / quality.samples) },
        uSamples: { value: quality.samples },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new Mesh(new PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  /** inspection aid for the harness: 1 shows the shafts alone, 2 shows the sky-visibility alpha */
  set debug(mode: number) {
    this.uniforms.get('uDebug')!.value = mode;
  }

  /**
   * `strength` 0 turns the effect off entirely; `sun` is the sun's position in uv. `flare` is the lens
   * flare's strength, 0 (none) to 1, for when the sun itself is in frame.
   */
  set(sun: Vector2, strength: number, color: Color, intensity: number, flare = 0): void {
    this.strength = strength;
    (this.material.uniforms.uSun!.value as Vector2).copy(sun);
    (this.uniforms.get('uSunUv')!.value as Vector2).copy(sun);
    this.uniforms.get('uFlare')!.value = flare;
    (this.uniforms.get('uColor')!.value as Color).copy(color);
    this.uniforms.get('uIntensity')!.value = strength * intensity;
  }

  override setDepthTexture(depthTexture: Texture): void {
    this.depth = depthTexture;
  }

  override setSize(width: number, height: number): void {
    this.target.setSize(Math.max(2, Math.round(width * this.fraction)), Math.max(2, Math.round(height * this.fraction)));
    this.material.uniforms.uAspect!.value = width / height;
    this.uniforms.get('uAspect')!.value = width / height;
  }

  override update(renderer: WebGLRenderer, inputBuffer: WebGLRenderTarget): void {
    if (this.strength < 0.002 || !this.depth) return;
    const u = this.material.uniforms;
    u.uScene!.value = inputBuffer.texture;
    u.uDepth!.value = this.depth;
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(previous);
  }

  override dispose(): void {
    this.target.dispose();
    this.material.dispose();
    this.quad.geometry.dispose();
    super.dispose();
  }
}
