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

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  if (uDebug > 1.5) {
    outputColor = vec4(vec3(inputColor.a), 1.0);
    return;
  }
  if (uIntensity < 0.0005) {
    outputColor = uDebug > 0.5 ? vec4(0.0, 0.0, 0.0, 1.0) : inputColor;
    return;
  }
  // shafts are light scattered in the air in front of everything, so they add over buildings and sky
  // alike; over what is already bright they would only wash it out, so they give way to it
  vec3 shafts = uColor * texture(uShafts, uv).rgb * uIntensity;
  float room = 1.0 - clamp(dot(inputColor.rgb, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0) * 0.75;
  outputColor = uDebug > 0.5 ? vec4(shafts, 1.0) : vec4(inputColor.rgb + shafts * room, inputColor.a);
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

  /** `strength` 0 turns the effect off entirely; `sun` is the sun's position in uv */
  set(sun: Vector2, strength: number, color: Color, intensity: number): void {
    this.strength = strength;
    (this.material.uniforms.uSun!.value as Vector2).copy(sun);
    (this.uniforms.get('uColor')!.value as Color).copy(color);
    this.uniforms.get('uIntensity')!.value = strength * intensity;
  }

  override setDepthTexture(depthTexture: Texture): void {
    this.depth = depthTexture;
  }

  override setSize(width: number, height: number): void {
    this.target.setSize(Math.max(2, Math.round(width * this.fraction)), Math.max(2, Math.round(height * this.fraction)));
    this.material.uniforms.uAspect!.value = width / height;
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
