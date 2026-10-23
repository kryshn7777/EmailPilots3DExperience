import {
  Matrix4,
  Uniform,
  Vector2,
  type PerspectiveCamera,
  type Texture,
  type WebGLRenderer,
  type WebGLRenderTarget,
} from 'three';
import { BlendFunction, Effect, EffectAttribute } from 'postprocessing';
import { DepthNormals, ScreenPass, VIEW_SPACE, bindCamera } from './viewSpace';

/**
 * The reflection trace, at half resolution. Every pixel sends a ray along its mirror direction
 * through view space and walks it (48 growing steps, jittered per pixel, then a binary search onto
 * the surface it crosses) against the depth buffer; where it lands, the lit frame there is the
 * reflected colour. How much of it a pixel takes is a guess made from what the frame knows:
 * everything reflects by Fresnel (strongly at a grazing angle: glass, car flanks, facades seen
 * along the canyon), and upward-facing, unsaturated surfaces (asphalt, paving, roofs, car hoods;
 * not lawns or leaves) are wet, more in some patches than others, as `uWet` says per chapter.
 */
const TRACE = /* glsl */ `
uniform sampler2D uColor;
uniform vec2 uResolution;
uniform float uWet;
uniform float uGloss;
uniform float uMode;
varying vec2 vUv;
${VIEW_SPACE}

float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2(1, 0)), f.x), mix(hash2(i + vec2(0, 1)), hash2(i + vec2(1, 1)), f.x), f.y);
}

void main() {
  float d0 = sceneDepth(vUv);
  if (d0 >= 0.99999) { gl_FragColor = vec4(0.0); return; }
  vec3 P = viewPosAt(vUv, d0);
  vec3 N = viewNormal(vUv);
  vec3 V = normalize(P);
  vec3 R = normalize(reflect(V, N));
  vec3 Nw = mat3(uCamWorld) * N;
  vec3 Pw = (uCamWorld * vec4(P, 1.0)).xyz;

  vec3 base = texture2D(uColor, vUv).rgb;
  float hi = max(base.r, max(base.g, base.b));
  float sat = (hi - min(base.r, min(base.g, base.b))) / max(hi, 1e-3);
  float fres = 0.04 + 0.96 * pow(1.0 - clamp(dot(-V, N), 0.0, 1.0), 5.0);
  float puddle = smoothstep(0.38, 0.62, vnoise(Pw.xz * 0.45) * 0.7 + vnoise(Pw.xz * 1.7) * 0.3);
  float wet = smoothstep(0.8, 0.95, Nw.y) * (1.0 - smoothstep(0.16, 0.42, sat)) * uWet * (0.35 + 0.65 * puddle);
  // standing water is close to a mirror even face-on; damp asphalt only at a glance
  float k = min(wet * mix(0.8, 1.15, fres), 0.95) + uGloss * fres;
  // a ray coming back at the lens leaves the frame at once; nothing to find there
  k *= 1.0 - smoothstep(0.25, 0.7, R.z);
  if (uMode > 0.5 && uMode < 1.5) { gl_FragColor = vec4(vec3(k), 1.0); return; }
  if (k < 0.01) { gl_FragColor = vec4(0.0); return; }

  float jitter = ign(gl_FragCoord.xy);
  float stepLen = 0.06 * (1.0 + 0.01 * -P.z);
  vec3 pos = P + N * (0.02 + 0.002 * -P.z) + R * stepLen * jitter;
  vec2 hitUv = vec2(-1.0);
  float travelled = 0.0;
  for (int i = 0; i < 48; i++) {
    pos += R * stepLen;
    travelled += stepLen;
    stepLen *= 1.085;
    vec2 uv = project(pos);
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 || pos.z > -0.05) break;
    float ds = sceneDepth(uv);
    if (ds >= 0.99999) continue;
    float behind = viewPosAt(uv, ds).z - pos.z;
    // a crossing only counts a few pixels away from where the ray left (a grazing ray along its own
    // wall finds the wall), and only on a surface that faces back along the ray
    vec2 px = (uv - vUv) * uResolution;
    if (behind > 0.0 && behind < max(stepLen * 1.2, 0.04) + 0.006 * -pos.z && dot(px, px) > 16.0
        && dot(viewNormal(uv), R) < -0.05) {
      // home in on the crossing
      vec3 a = pos - R * stepLen / 1.085;
      vec3 b = pos;
      for (int j = 0; j < 6; j++) {
        vec3 m = (a + b) * 0.5;
        vec2 muv = project(m);
        if (viewPos(muv).z - m.z > 0.0) b = m; else a = m;
      }
      hitUv = project(b);
      break;
    }
  }
  if (hitUv.x < 0.0) { gl_FragColor = vec4(0.0); return; }
  vec2 edge = smoothstep(vec2(0.0), vec2(0.08), hitUv) * (1.0 - smoothstep(vec2(0.92), vec2(1.0), hitUv));
  float fade = edge.x * edge.y * (1.0 - smoothstep(18.0, 40.0, travelled));
  if (uMode > 1.5) { gl_FragColor = vec4(abs(hitUv - vUv) * 3.0, 0.0, 1.0); return; }
  vec3 col = texture2D(uColor, hitUv).rgb;
  gl_FragColor = vec4(min(col, vec3(8.0)) * k * fade, k * fade);
}
`;

const composite = /* glsl */ `
uniform sampler2D uReflection;
uniform vec2 uTexel;
uniform float uDebug;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  // a little blur: wet asphalt is not a mirror
  vec4 r = texture(uReflection, uv) * 0.4
    + texture(uReflection, uv + uTexel * vec2(1.5, 0.5)) * 0.15
    + texture(uReflection, uv + uTexel * vec2(-1.5, -0.5)) * 0.15
    + texture(uReflection, uv + uTexel * vec2(-0.5, 1.5)) * 0.15
    + texture(uReflection, uv + uTexel * vec2(0.5, -1.5)) * 0.15;
  outputColor = uDebug > 0.5 ? vec4(r.rgb, 1.0) : vec4(inputColor.rgb + r.rgb, inputColor.a);
}
`;

/**
 * Screen-space traced reflections (HIGH tier): wet streets that double the lamps, the neon and
 * the cars' lights, puddles that hold the houses, glass and paint that pick up what is really
 * beside them. What the trace cannot find (off screen, behind something) falls back to what the
 * materials already reflect: the live probe and the environment maps.
 */
export class SSREffect extends Effect {
  private pass: ScreenPass;
  private depth: Texture | null = null;
  /** how wet the ground is, 0..1, set per chapter by the Engine */
  wet = 0.4;

  constructor(private camera: PerspectiveCamera, private normals: DepthNormals, private fraction = 0.5) {
    const pass = new ScreenPass(TRACE, {
      uColor: { value: null }, uDepth: { value: null }, uNormal: { value: normals.texture },
      uProj: { value: new Matrix4() }, uInvProj: { value: new Matrix4() }, uCamWorld: { value: new Matrix4() },
      uResolution: { value: new Vector2(1, 1) }, uWet: { value: 0.4 }, uGloss: { value: 0.14 }, uMode: { value: 0 },
    }, fraction);
    super('SSREffect', composite, {
      blendFunction: BlendFunction.NORMAL,
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map<string, Uniform>([
        ['uReflection', new Uniform(pass.target.texture)],
        ['uTexel', new Uniform(new Vector2(1, 1))],
        ['uDebug', new Uniform(0)],
      ]),
    });
    this.pass = pass;
  }

  /** inspection aid: 1 shows the reflections alone, 2 the reflectivity, 3 how far each ray went on screen */
  set debug(mode: number) {
    this.uniforms.get('uDebug')!.value = mode > 0 ? 1 : 0;
    this.pass.material.uniforms.uMode!.value = mode > 1 ? mode - 1 : 0;
  }

  override setDepthTexture(depthTexture: Texture): void {
    this.depth = depthTexture;
  }

  override setSize(width: number, height: number): void {
    this.pass.setSize(width, height);
    this.normals.setSize(width, height);
    (this.uniforms.get('uTexel')!.value as Vector2).set(1 / (width * this.fraction), 1 / (height * this.fraction));
    (this.pass.material.uniforms.uResolution!.value as Vector2).set(width, height);
  }

  override update(renderer: WebGLRenderer, inputBuffer: WebGLRenderTarget): void {
    if (!this.depth) return;
    this.normals.update(renderer, this.depth, this.camera);
    const u = this.pass.material.uniforms;
    u.uColor!.value = inputBuffer.texture;
    u.uDepth!.value = this.depth;
    u.uWet!.value = this.wet;
    bindCamera(this.pass.material, this.camera);
    this.pass.render(renderer);
  }

  override dispose(): void {
    this.pass.dispose();
    super.dispose();
  }
}
