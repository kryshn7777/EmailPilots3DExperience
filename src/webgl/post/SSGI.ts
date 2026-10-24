import {
  Matrix4,
  Uniform,
  Vector2,
  type PerspectiveCamera,
  type Texture,
  type WebGLRenderer,
  type WebGLRenderTarget,
} from 'three';
import { Effect, EffectAttribute } from 'postprocessing';
import { DepthNormals, ScreenPass, VIEW_SPACE, bindCamera } from './viewSpace';

/**
 * One bounce of light, gathered from the lit frame. Every pixel looks at a disc of the frame
 * around it (20 samples on a golden-angle spiral, turned per pixel, sized to a fixed radius in the
 * world), rebuilds each sample's position and normal, and takes its colour as light arriving from
 * there: weighted by how squarely the two surfaces face each other and by distance, so a sunlit
 * lawn greens the wall above it, a red brick facade warms the pavement, neon and lit windows spill
 * colour onto the street at night. This is the bounce a path tracer or Lumen would add, limited to
 * what the frame can see.
 */
const GATHER = /* glsl */ `
uniform sampler2D uColor;
uniform vec2 uResolution;
uniform float uRadius;
varying vec2 vUv;
${VIEW_SPACE}

const int SAMPLES = 20;

void main() {
  float d0 = sceneDepth(vUv);
  if (d0 >= 0.99999) { gl_FragColor = vec4(0.0); return; }
  vec3 P = viewPosAt(vUv, d0);
  vec3 N = viewNormal(vUv);
  // the radius in uv, at this depth
  float rs = min(uRadius * uProj[1][1] * 0.5 / max(-P.z, 0.1), 0.22);
  vec2 aspect = vec2(uResolution.y / uResolution.x, 1.0);
  float rot = ign(gl_FragCoord.xy) * 6.2831853;
  vec3 gi = vec3(0.0);
  for (int i = 0; i < SAMPLES; i++) {
    float f = (float(i) + 0.5) / float(SAMPLES);
    float a = rot + float(i) * 2.3999632;
    vec2 uv = vUv + vec2(cos(a), sin(a)) * sqrt(f) * rs * aspect;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) continue;
    float ds = sceneDepth(uv);
    if (ds >= 0.99999) continue;
    vec3 d = viewPosAt(uv, ds) - P;
    float dist = length(d);
    if (dist < 1e-3) continue;
    vec3 dn = d / dist;
    float receive = max(dot(N, dn), 0.0);
    float emit = max(dot(viewNormal(uv), -dn), 0.0);
    float fall = 1.0 / (1.0 + dist * dist / (uRadius * uRadius) * 3.0);
    gi += min(texture2D(uColor, uv).rgb, vec3(6.0)) * receive * emit * fall;
  }
  // a cosine-weighted hemisphere integrates to a half; the disc sees about that much of it
  gl_FragColor = vec4(gi * (2.0 / float(SAMPLES)), 1.0);
}
`;

/** A depth-aware blur of the gathered light: smooth across a surface, never across an edge. */
const BLUR = /* glsl */ `
uniform sampler2D uGi;
uniform vec2 uTexel;
varying vec2 vUv;
${VIEW_SPACE}

void main() {
  float z0 = viewPos(vUv).z;
  vec3 n0 = viewNormal(vUv);
  vec3 sum = vec3(0.0);
  float wsum = 0.0;
  for (int y = -2; y <= 2; y++) {
    for (int x = -2; x <= 2; x++) {
      vec2 uv = vUv + vec2(float(x), float(y)) * uTexel * 1.5;
      float z = viewPos(uv).z;
      float w = exp(-abs(z - z0) / (0.04 * max(-z0, 1.0))) * pow(max(dot(viewNormal(uv), n0), 0.0), 8.0);
      w *= 1.0 / (1.0 + float(x * x + y * y) * 0.25);
      sum += texture2D(uGi, uv).rgb * w;
      wsum += w;
    }
  }
  gl_FragColor = vec4(sum / max(wsum, 1e-4), 1.0);
}
`;

const composite = /* glsl */ `
uniform sampler2D uGi;
uniform float uIntensity;
uniform float uDebug;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 gi = texture(uGi, uv).rgb * uIntensity;
  // the bounce lands on the surface's own colour: the frame's colour, normalised, stands in for
  // the albedo the deferred renderers have and this one does not
  vec3 c = inputColor.rgb;
  float hi = max(c.r, max(c.g, c.b));
  vec3 albedo = hi > 1e-4 ? clamp(c / hi, 0.0, 1.0) * 0.75 + 0.15 : vec3(0.5);
  outputColor = uDebug > 0.5 ? vec4(gi, 1.0) : vec4(c + gi * albedo, inputColor.a);
}
`;

/** Screen-space global illumination (HIGH tier): one diffuse bounce, half resolution, denoised. */
export class SSGIEffect extends Effect {
  private gather: ScreenPass;
  private blur: ScreenPass;
  private depth: Texture | null = null;
  /** how much bounce light is added, set per chapter by the Engine */
  intensity = 0.8;

  constructor(private camera: PerspectiveCamera, private normals: DepthNormals, radius = 2.4, fraction = 0.5) {
    const view = () => ({
      uDepth: { value: null }, uNormal: { value: normals.texture },
      uProj: { value: new Matrix4() }, uInvProj: { value: new Matrix4() }, uCamWorld: { value: new Matrix4() },
    });
    const gather = new ScreenPass(GATHER, {
      ...view(), uColor: { value: null }, uResolution: { value: new Vector2(1, 1) }, uRadius: { value: radius },
    }, fraction);
    const blur = new ScreenPass(BLUR, { ...view(), uGi: { value: gather.target.texture }, uTexel: { value: new Vector2(1, 1) } }, fraction);
    super('SSGIEffect', composite, {
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map<string, Uniform>([
        ['uGi', new Uniform(blur.target.texture)],
        ['uIntensity', new Uniform(0.8)],
        ['uDebug', new Uniform(0)],
      ]),
    });
    this.gather = gather;
    this.blur = blur;
  }

  /** inspection aid: 1 shows the bounce light alone */
  set debug(mode: number) {
    this.uniforms.get('uDebug')!.value = mode;
  }

  /** world radius the bounce is gathered over */
  set radius(r: number) {
    this.gather.material.uniforms.uRadius!.value = r;
  }

  override setDepthTexture(depthTexture: Texture): void {
    this.depth = depthTexture;
  }

  override setSize(width: number, height: number): void {
    this.normals.setSize(width, height);
    this.gather.setSize(width, height);
    this.blur.setSize(width, height);
    (this.gather.material.uniforms.uResolution!.value as Vector2).set(width, height);
    const t = this.blur.material.uniforms.uTexel!.value as Vector2;
    t.set(1 / this.blur.target.width, 1 / this.blur.target.height);
  }

  override update(renderer: WebGLRenderer, inputBuffer: WebGLRenderTarget): void {
    this.uniforms.get('uIntensity')!.value = this.intensity;
    if (!this.depth) return;
    // built even while the bounce is off: the ambient occlusion, which runs next, reads the same normals
    this.normals.update(renderer, this.depth, this.camera);
    if (this.intensity < 0.01) return;
    for (const p of [this.gather, this.blur]) {
      p.material.uniforms.uDepth!.value = this.depth;
      bindCamera(p.material, this.camera);
    }
    this.gather.material.uniforms.uColor!.value = inputBuffer.texture;
    this.gather.render(renderer);
    this.blur.render(renderer);
  }

  override dispose(): void {
    this.gather.dispose();
    this.blur.dispose();
    super.dispose();
  }
}
