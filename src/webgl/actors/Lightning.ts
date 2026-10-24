import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  MathUtils,
  Mesh,
  PointLight,
  ShaderMaterial,
  Vector3,
  type PerspectiveCamera,
} from 'three';
import { REFLECTED_LAYER } from '../materials/PlanarReflection';

/**
 * Forked lightning that descends. A strike picks a spot in the view, grows a jagged channel from the
 * cloud base down to the sea in a stepped leader (a dim, branching tip racing downward), and, the
 * instant the tip lands, the return stroke lights the whole channel white and flickers twice before it
 * fades. The channel is a few hundred camera-facing ribbons made by midpoint displacement (the way a
 * real stroke is fractal), with forks that fall away from it; it is in the sea's planar reflection, and
 * each strike lights the sky, the water and (HIGH) the scene with a cold point light.
 */
const VERT = /* glsl */ `
attribute vec3 aA;
attribute vec3 aB;
attribute vec2 aCorner;   // x: 0 at A, 1 at B; y: -1 / +1 across
attribute vec4 aInfo;     // s at A, s at B (0 at the cloud, 1 at the sea), half width, fork depth
uniform float uPixel;
varying float vS;
varying float vAcross;
varying float vFork;
void main() {
  vec3 p = mix(aA, aB, aCorner.x);
  vec3 dir = normalize(aB - aA);
  vec3 toCam = cameraPosition - p;
  float dist = max(length(toCam), 1.0);
  vec3 side = normalize(cross(dir, toCam));
  // never thinner than about a pixel, so a distant bolt is a line and not a flicker of dots
  float w = max(aInfo.z, dist * uPixel * 0.6);
  vS = mix(aInfo.x, aInfo.y, aCorner.x);
  vAcross = aCorner.y;
  vFork = aInfo.w;
  gl_Position = projectionMatrix * viewMatrix * vec4(p + side * aCorner.y * w * 5.0, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform float uProgress;   // how far down the leader has come, 0..1
uniform float uBright;     // the stroke's brightness
uniform float uLead;       // 1 while the leader is still descending
uniform vec3 uColor;
varying float vS;
varying float vAcross;
varying float vFork;
void main() {
  if (vS > uProgress) discard;
  float x = abs(vAcross);
  // a hot narrow core inside a violet-blue sheath
  float core = exp(-x * x * 55.0);
  float sheath = exp(-x * 3.2) * 0.32;
  // the leader's tip glows as it comes down
  float tip = exp(-(uProgress - vS) * 38.0) * uLead;
  float forkDim = 1.0 - 0.45 * vFork;
  float v = (core * (1.0 + 2.5 * tip) + sheath * (0.6 + 1.5 * tip)) * uBright * forkDim;
  vec3 c = mix(uColor, vec3(1.0), clamp(core * 1.1 + tip, 0.0, 1.0));
  // additive blending multiplies by alpha: 1, so the stroke is exactly c * v (and may exceed 1 for the bloom)
  gl_FragColor = vec4(c * v, 1.0);
}
`;

interface Segment { a: Vector3; b: Vector3; sa: number; sb: number; width: number; fork: number }

/** a jagged polyline from a to b by midpoint displacement */
function jag(a: Vector3, b: Vector3, levels: number, roughness: number, rand: () => number): Vector3[] {
  let pts = [a.clone(), b.clone()];
  let amp = a.distanceTo(b) * roughness;
  const axis = new Vector3();
  const perp = new Vector3();
  for (let l = 0; l < levels; l++) {
    const next: Vector3[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i]!;
      const q = pts[i + 1]!;
      axis.copy(q).sub(p).normalize();
      perp.set(rand() - 0.5, (rand() - 0.5) * 0.3, rand() - 0.5);
      perp.addScaledVector(axis, -perp.dot(axis)).normalize();
      next.push(p, p.clone().add(q).multiplyScalar(0.5).addScaledVector(perp, (rand() - 0.5) * 2 * amp));
    }
    next.push(pts[pts.length - 1]!);
    pts = next;
    amp *= 0.52;
  }
  return pts;
}

export interface LightningOptions {
  /** a cold point light that flashes the scene at each strike (HIGH) */
  light: boolean;
  /** draw into the sea's planar reflection (HIGH) */
  reflect: boolean;
}

export class Lightning {
  readonly group = new Group();
  /** 0..1, jumps at each return stroke and decays: the sky and the sea take it with the storm's own flash */
  flash = 0;
  /** inspection aid: pin the strike's age (seconds) instead of letting it run on the clock */
  debugAge: number | null = null;
  private debugStruck = false;
  private debugFrames = 0;
  private mesh: Mesh;
  private geometry = new BufferGeometry();
  private material: ShaderMaterial;
  private light: PointLight | null = null;
  private age = 99;
  private nextAt = 0;
  private lightAt = new Vector3();
  private rand = Math.random;

  /** descent time, and how long the whole strike lasts */
  private static readonly DESCENT = 0.24;
  private static readonly LIFE = 1.1;

  constructor(opts: LightningOptions) {
    this.material = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uPixel: { value: 0.001 },
        uProgress: { value: 0 },
        uBright: { value: 0 },
        uLead: { value: 1 },
        uColor: { value: new Color('#8fa6ff') },
      },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      fog: false,
    });
    this.geometry.setAttribute('position', new BufferAttribute(new Float32Array(12), 3));
    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    this.mesh.visible = false;
    if (opts.reflect) this.mesh.layers.enable(REFLECTED_LAYER);
    this.group.add(this.mesh);
    if (opts.light) {
      this.light = new PointLight('#9fb4ff', 0, 260, 1.6);
      this.group.add(this.light);
    }
  }

  /**
   * Grows a new bolt in front of the camera: from the cloud base (`top`) to the water (`bottom`),
   * somewhere inside the view. Public so the inspection harness can strike on demand.
   */
  strike(camera: PerspectiveCamera, bottomY: number, topY: number): void {
    const rand = this.rand;
    const fwd = new Vector3();
    // the rig has just moved the camera this frame: aim from where it is now, not where it last drew
    camera.updateMatrixWorld();
    camera.getWorldDirection(fwd);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-4) fwd.set(1, 0, 0);
    fwd.normalize();
    // a heading inside the frame (the field of view is narrower on a portrait phone)
    const halfH = Math.atan(Math.tan(MathUtils.degToRad(camera.fov) / 2) * camera.aspect);
    const az = (rand() * 2 - 1) * halfH * 0.8;
    const dist = 70 + rand() * 90;
    const cos = Math.cos(az);
    const sin = Math.sin(az);
    const dir = new Vector3(fwd.x * cos - fwd.z * sin, 0, fwd.x * sin + fwd.z * cos);
    const base = new Vector3().copy(camera.position).addScaledVector(dir, dist);
    const top = new Vector3(base.x + (rand() - 0.5) * 12, topY, base.z + (rand() - 0.5) * 12);
    const bottom = new Vector3(base.x + (rand() - 0.5) * 24, bottomY, base.z + (rand() - 0.5) * 24);
    const height = top.y - bottom.y;

    const segments: Segment[] = [];
    const sOf = (y: number): number => MathUtils.clamp((top.y - y) / height, 0, 1);
    const add = (pts: Vector3[], width: number, fork: number): void => {
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i]!;
        const b = pts[i + 1]!;
        segments.push({ a, b, sa: sOf(a.y), sb: sOf(b.y), width, fork });
      }
    };
    const main = jag(top, bottom, 6, 0.2, rand);
    add(main, 0.2, 0);
    // forks fall away from the channel and fade as they go; a few have a smaller fork of their own
    const forks = 3 + Math.floor(rand() * 3);
    for (let f = 0; f < forks; f++) {
      const i = 6 + Math.floor(rand() * (main.length - 24));
      const from = main[i]!;
      const sideAz = (rand() < 0.5 ? -1 : 1) * (0.25 + rand() * 0.5);
      const drop = height * (0.14 + rand() * 0.22);
      const to = new Vector3(
        from.x + (dir.z * Math.sign(sideAz)) * drop * Math.abs(sideAz) * 1.4 + (rand() - 0.5) * 6,
        Math.max(from.y - drop, bottom.y + 2),
        from.z - (dir.x * Math.sign(sideAz)) * drop * Math.abs(sideAz) * 1.4 + (rand() - 0.5) * 6,
      );
      const branch = jag(from, to, 4, 0.22, rand);
      add(branch, 0.1, 1);
      if (rand() < 0.5) {
        const j = 3 + Math.floor(rand() * (branch.length - 6));
        const p = branch[j]!;
        const sub = jag(p, new Vector3(p.x + (rand() - 0.5) * 16, Math.max(p.y - drop * 0.5, bottom.y + 1), p.z + (rand() - 0.5) * 16), 3, 0.25, rand);
        add(sub, 0.06, 1);
      }
    }
    this.build(segments);
    this.age = 0;
    this.lightAt.copy(main[Math.floor(main.length * 0.62)]!);
  }

  private build(segments: Segment[]): void {
    const n = segments.length;
    const a = new Float32Array(n * 12);
    const b = new Float32Array(n * 12);
    const corner = new Float32Array(n * 8);
    const info = new Float32Array(n * 16);
    const index = new Uint32Array(n * 6);
    const pos = new Float32Array(n * 12);
    segments.forEach((s, k) => {
      for (let v = 0; v < 4; v++) {
        const o = (k * 4 + v) * 3;
        a[o] = s.a.x; a[o + 1] = s.a.y; a[o + 2] = s.a.z;
        b[o] = s.b.x; b[o + 1] = s.b.y; b[o + 2] = s.b.z;
        pos[o] = s.a.x; pos[o + 1] = s.a.y; pos[o + 2] = s.a.z;
        const c = (k * 4 + v) * 2;
        corner[c] = v < 2 ? 0 : 1;
        corner[c + 1] = v % 2 === 0 ? -1 : 1;
        const q = (k * 4 + v) * 4;
        info[q] = s.sa; info[q + 1] = s.sb; info[q + 2] = s.width; info[q + 3] = s.fork;
      }
      const i = k * 6;
      const v0 = k * 4;
      index.set([v0, v0 + 1, v0 + 2, v0 + 1, v0 + 3, v0 + 2], i);
    });
    const g = this.geometry;
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('aA', new BufferAttribute(a, 3));
    g.setAttribute('aB', new BufferAttribute(b, 3));
    g.setAttribute('aCorner', new BufferAttribute(corner, 2));
    g.setAttribute('aInfo', new BufferAttribute(info, 4));
    g.setIndex(new BufferAttribute(index, 1));
    g.computeBoundingSphere();
  }

  /**
   * `amount` 0..1 is how stormy the sky is (it sets how often a strike comes: none at 0); `seaY` is
   * the water the bolt lands on and `cloudY` the cloud base it leaves.
   */
  update(time: number, dt: number, amount: number, camera: PerspectiveCamera, seaY: number, cloudY: number, viewportHeight: number): void {
    if (amount < 0.05) {
      this.mesh.visible = false;
      this.flash = 0;
      if (this.light) this.light.intensity = 0;
      this.nextAt = 0;
      return;
    }
    // (the harness jumps the story: the camera's look target takes a few frames to settle before a strike aims true)
    if (this.debugAge !== null && !this.debugStruck && ++this.debugFrames >= 5) {
      this.debugStruck = true;
      this.strike(camera, seaY, cloudY);
    }
    if (this.debugAge === null && this.age >= Lightning.LIFE && time > this.nextAt) {
      if (this.nextAt === 0) {
        // the sky has just turned: the first strike comes a moment later, then one every 1.6 to 4.2 s
        this.nextAt = time + 0.4 + this.rand() * 0.8;
      } else {
        this.nextAt = time + 1.6 + this.rand() * 2.6;
        this.strike(camera, seaY, cloudY);
      }
    }
    if (this.debugAge !== null) this.age = this.debugAge;
    else if (this.age < Lightning.LIFE) this.age += dt;

    const D = Lightning.DESCENT;
    const age = this.age;
    const live = age < Lightning.LIFE;
    this.mesh.visible = live;
    const u = this.material.uniforms;
    u.uPixel!.value = (2 * Math.tan(MathUtils.degToRad(camera.fov) / 2)) / Math.max(viewportHeight, 1);
    if (!live) {
      this.flash = 0;
      if (this.light) this.light.intensity = 0;
      return;
    }
    // the leader steps down in jerks; the return stroke is the whole channel at once, twice more
    const stepped = age / D - 0.05 * Math.abs(Math.sin(age * 120));
    u.uProgress!.value = age < D ? MathUtils.clamp(stepped, 0, 1) : 1.01;
    u.uLead!.value = age < D ? 1 : 0;
    let b = 0.8;
    if (age >= D) {
      const r = age - D;
      b = 3.2 * Math.exp(-r * 20) + 1.6 * Math.exp(-Math.pow((r - 0.1) / 0.035, 2)) + 0.9 * Math.exp(-Math.pow((r - 0.2) / 0.04, 2)) + 0.5 * Math.exp(-r * 4.5);
    }
    u.uBright!.value = b * amount;
    this.flash = age >= D ? Math.min(1, b / 2.6) * amount : 0;
    if (this.light) {
      this.light.position.copy(this.lightAt);
      this.light.intensity = this.flash * 5200;
    }
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
