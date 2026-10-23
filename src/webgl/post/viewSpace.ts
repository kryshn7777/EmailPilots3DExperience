import {
  HalfFloatType,
  LinearFilter,
  Matrix4,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  WebGLRenderTarget,
  type PerspectiveCamera,
  type Texture,
  type WebGLRenderer,
} from 'three';

/**
 * GLSL shared by the screen-space passes: the scene's depth and view-space normals turned back
 * into view-space positions and directions. Depth is the composer's plain [0,1] depth buffer,
 * normals view space, packed to 0..1 (see DepthNormals).
 */
export const VIEW_SPACE = /* glsl */ `
uniform sampler2D uDepth;
uniform sampler2D uNormal;
uniform mat4 uProj;
uniform mat4 uInvProj;
uniform mat4 uCamWorld;

float sceneDepth(vec2 uv) { return texture2D(uDepth, uv).r; }

vec3 viewPosAt(vec2 uv, float depth) {
  vec4 p = uInvProj * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  return p.xyz / p.w;
}

vec3 viewPos(vec2 uv) { return viewPosAt(uv, sceneDepth(uv)); }

vec3 viewNormal(vec2 uv) { return normalize(texture2D(uNormal, uv).xyz * 2.0 - 1.0); }

vec2 project(vec3 p) {
  vec4 c = uProj * vec4(p, 1.0);
  return c.xy / c.w * 0.5 + 0.5;
}

// interleaved gradient noise: a per-pixel offset that a blur turns into smoothness, not banding
float ign(vec2 px) { return fract(52.9829189 * fract(dot(px, vec2(0.06711056, 0.00583715)))); }
`;

export const FULLSCREEN_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/** A fullscreen pass drawn into its own half-float target, for the effects' internal buffers. */
export class ScreenPass {
  readonly target: WebGLRenderTarget;
  readonly material: ShaderMaterial;
  private scene = new Scene();
  private camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private quad: Mesh;

  constructor(fragmentShader: string, uniforms: Record<string, { value: unknown }>, private fraction: number) {
    this.target = new WebGLRenderTarget(2, 2, {
      type: HalfFloatType, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: false,
    });
    this.material = new ShaderMaterial({
      vertexShader: FULLSCREEN_VERT, fragmentShader, uniforms, depthTest: false, depthWrite: false,
    });
    this.quad = new Mesh(new PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  setSize(width: number, height: number): void {
    this.target.setSize(Math.max(2, Math.round(width * this.fraction)), Math.max(2, Math.round(height * this.fraction)));
  }

  render(renderer: WebGLRenderer): void {
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(previous);
  }

  dispose(): void {
    this.target.dispose();
    this.material.dispose();
    this.quad.geometry.dispose();
  }
}

/**
 * View-space normals rebuilt from the depth buffer, once a frame, for the screen-space passes.
 * The NormalPass buffer also holds the transparent light cones and glow cards (it draws every mesh,
 * depth-writing or not), which would tilt the ground under every lamp; depth only holds what is
 * really there. Each normal is the cross product of the smaller of the two differences on each
 * axis, so it does not bend across an edge.
 */
const NORMALS = /* glsl */ `
uniform sampler2D uDepth;
uniform mat4 uInvProj;
uniform vec2 uTexel;
varying vec2 vUv;

vec3 at(vec2 uv) {
  vec4 p = uInvProj * vec4(uv * 2.0 - 1.0, texture2D(uDepth, uv).r * 2.0 - 1.0, 1.0);
  return p.xyz / p.w;
}

void main() {
  vec3 p = at(vUv);
  vec3 r = at(vUv + vec2(uTexel.x, 0.0)) - p;
  vec3 l = p - at(vUv - vec2(uTexel.x, 0.0));
  vec3 u = at(vUv + vec2(0.0, uTexel.y)) - p;
  vec3 d = p - at(vUv - vec2(0.0, uTexel.y));
  vec3 dx = abs(r.z) < abs(l.z) ? r : l;
  vec3 dy = abs(u.z) < abs(d.z) ? u : d;
  vec3 n = normalize(cross(dx, dy));
  if (dot(n, p) > 0.0) n = -n;
  gl_FragColor = vec4(n * 0.5 + 0.5, 1.0);
}
`;

export class DepthNormals {
  readonly pass: ScreenPass;
  private fresh = false;

  constructor(fraction = 0.5) {
    this.pass = new ScreenPass(NORMALS, {
      uDepth: { value: null }, uInvProj: { value: new Matrix4() }, uTexel: { value: new Vector2(1, 1) },
    }, fraction);
  }

  get texture(): Texture {
    return this.pass.target.texture;
  }

  setSize(width: number, height: number): void {
    this.pass.setSize(width, height);
    (this.pass.material.uniforms.uTexel!.value as Vector2).set(1 / width, 1 / height);
  }

  /** The frame is new: the next pass that asks rebuilds the normals. */
  invalidate(): void {
    this.fresh = false;
  }

  /** Rebuilds the normals, at most once per frame however many passes ask. */
  update(renderer: WebGLRenderer, depth: Texture, camera: PerspectiveCamera): void {
    if (this.fresh) return;
    this.fresh = true;
    this.pass.material.uniforms.uDepth!.value = depth;
    (this.pass.material.uniforms.uInvProj!.value as Matrix4).copy(camera.projectionMatrixInverse);
    this.pass.render(renderer);
  }

  dispose(): void {
    this.pass.dispose();
  }
}

/** Copies the camera's matrices into a pass's view-space uniforms. */
export function bindCamera(material: ShaderMaterial, camera: PerspectiveCamera): void {
  const u = material.uniforms;
  u.uProj!.value.copy(camera.projectionMatrix);
  u.uInvProj!.value.copy(camera.projectionMatrixInverse);
  u.uCamWorld!.value.copy(camera.matrixWorld);
}
