import {
  BufferGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Float32BufferAttribute,
  FrontSide,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  NoColorSpace,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  Vector3,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { asset } from '../asset';

/**
 * The birds outside the study window: rock pigeons (most of them), a few starlings and a
 * black-headed gull, modelled in Blender (blender/make_birds.py) with feathered wings and baked
 * maps, one instanced mesh per species (three draws).
 *
 * Two flocks, as before: a stream that loops a bezier from the window over the rooftops on
 * absolute time (phase-offset, scale-fading at both ends, so it runs forever without scroll), and a
 * keyframed squad that crosses the lens as the plane clears the window (t-driven, so it replays
 * identically on every scroll).
 *
 * The wings are a shader rig. Every vertex knows its part (body, wing, tail), whether it is a thin
 * feather and how far it flexes; per bird the CPU writes four numbers a frame (elevation, fold,
 * twist, load) and the vertex shader turns the wing about the shoulder, elbow and wrist pivots
 * (the weights blend across each joint from the rest-pose span, so the membrane and the coverts
 * stretch rather than tear). A downstroke sweeps the extended wing down and pronated with the
 * primaries bending up under the load; the upstroke flexes elbow and wrist so the hand comes up
 * folded and supinated. Birds glide now and then (pigeons in their raised-V glide), bob with the
 * stroke, bank into turns (a coordinated turn: lift along gravity plus the lateral acceleration)
 * and fan the tail as they bank.
 */

interface SpeciesRig {
  shoulder: [number, number, number];
  elbow: [number, number, number];
  wrist: [number, number, number];
  tail: [number, number, number];
  flap: { hz: number; up: number; down: number; fold: number; glide: number };
  tris: number;
  trisLo: number;
  span: number;
}

interface Manifest {
  species: Record<string, SpeciesRig>;
  files: { glb: string; glbLo: string; color: string; orm: string; normal: string; colorLo: string; ormLo: string };
}

type SpeciesId = 'pigeon' | 'starling' | 'gull';
const SPECIES: SpeciesId[] = ['pigeon', 'starling', 'gull'];
/** stream (8) then flyby (5): mostly pigeons, starlings among them, a gull across the lens */
const STREAM: SpeciesId[] = ['pigeon', 'pigeon', 'starling', 'pigeon', 'pigeon', 'starling', 'pigeon', 'pigeon'];
const FLYBY: SpeciesId[] = ['pigeon', 'gull', 'pigeon', 'starling', 'pigeon'];
/** model scale per species (the models are life size in metres): what reads at the window's distance */
const SIZE: Record<SpeciesId, number> = { pigeon: 1.0, starling: 1.25, gull: 0.9 };
/** glides: how often the bird stops flapping (0 never .. 1 mostly gliding), and the glide's wing angle */
const GLIDE: Record<SpeciesId, { share: number; rate: number }> = {
  pigeon: { share: 0.22, rate: 0.35 },
  starling: { share: 0.3, rate: 1.4 },
  gull: { share: 0.5, rate: 0.25 },
};
const DEG = Math.PI / 180;

interface Bird {
  species: SpeciesId;
  slot: number;
  phase: number;
  speed: number;
  zJitter: number;
  yJitter: number;
  /** stroke frequency multiplier, glide seed, individual tint */
  hzMul: number;
  seed: number;
  tint: number;
  size: number;
  /** wing-beat phase, integrated so frequency changes don't jump */
  beat: number;
  lastTime: number;
}

const RIG_GLSL = /* glsl */ `
attribute vec3 _rig;
attribute vec2 _aux;
attribute vec4 aFlap;
attribute vec4 aTail;
uniform vec3 uShoulder;
uniform vec3 uElbow;
uniform vec3 uWrist;
uniform vec3 uTailPivot;
uniform float uSpan;
varying float vThin;
varying float vOcc;
varying float vTint;

mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
mat3 rotZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }

// x out along the wing (mirrored), y up, z forward; pivots are the left wing's, |x|
void birdRig(inout vec3 p, inout vec3 n) {
  float part = floor(_rig.x * 2.0 + 0.5);
  float k = uSpan / 0.62;
  if (part > 1.5) {
    // tail: fan out (spread) and pitch about the tail's root
    vec3 r = p - uTailPivot;
    float back = max(-r.z, 0.0) / (0.12 * k);
    r.x *= 1.0 + aTail.y * back;
    mat3 R = rotX(aTail.x);
    p = R * r + uTailPivot;
    n = R * n;
    return;
  }
  if (part < 0.5) return;
  float sgn = p.x < 0.0 ? -1.0 : 1.0;
  vec3 q = vec3(abs(p.x), p.y, p.z);
  vec3 m = vec3(n.x * sgn, n.y, n.z);
  float x0 = q.x;
  float elev = aFlap.x, fold = aFlap.y, twist = aFlap.z, load = aFlap.w;
  // feather tips bend up under the downstroke's load (primaries most)
  q.y += load * _rig.z * _rig.z * 0.05 * k;
  float d = 0.012 * k;
  // wrist: the hand sweeps back and supinates as the wing folds
  float wW = smoothstep(uWrist.x - d, uWrist.x + d, x0);
  mat3 Rw = rotY(fold * 1.25 * wW) * rotX(-fold * 0.45 * wW);
  q = Rw * (q - uWrist) + uWrist;
  m = Rw * m;
  // elbow: the forearm swings forward
  float wE = smoothstep(uElbow.x - d, uElbow.x + d, x0);
  mat3 Re = rotY(-fold * 0.55 * wE);
  q = Re * (q - uElbow) + uElbow;
  m = Re * m;
  // shoulder: elevation, a little sweep back on the upstroke, pronation on the downstroke
  float wS = smoothstep(uShoulder.x - 0.4 * d, uShoulder.x + 1.6 * d, x0);
  mat3 Rs = rotY(fold * 0.3 * wS) * rotZ(elev * wS) * rotX(twist * wS);
  q = Rs * (q - uShoulder) + uShoulder;
  m = Rs * m;
  p = vec3(q.x * sgn, q.y, q.z);
  n = vec3(m.x * sgn, m.y, m.z);
}
`;

export class Birds {
  readonly group = new Group();
  private birds: Bird[] = [];
  private flyby: Bird[] = [];
  private disposables: { dispose(): void }[] = [];
  private meshes = new Map<SpeciesId, InstancedMesh>();
  private flapAttr = new Map<SpeciesId, InstancedBufferAttribute>();
  private tailAttr = new Map<SpeciesId, InstancedBufferAttribute>();
  private rigs: Manifest['species'] | null = null;
  private disposed = false;

  // window → over the rooftop field
  private p0 = new Vector3(7.2, 1.9, 0.9);
  private p1 = new Vector3(14, 5.2, 2.5);
  private p2 = new Vector3(26, 8.5, 6);
  // the keyframed flyby: a squad cuts right across the camera as the plane
  // clears the window (t-driven, so it replays identically on every scroll)
  private f0 = new Vector3(13.5, 1.1, 3.6);
  private f1 = new Vector3(7.8, 2.45, -2.8);
  private pos = new Vector3();
  private ahead = new Vector3();
  private behind = new Vector3();
  private fwd = new Vector3();
  private up = new Vector3();
  private side = new Vector3();
  private acc = new Vector3();
  private m = new Matrix4();

  constructor(rand: () => number, high = true) {
    // the same six draws per bird as the paper-plane birds took, so every actor seeded after
    // this one keeps its randomness
    const makeBird = (species: SpeciesId, counts: Record<SpeciesId, number>): Bird => {
      const scale = 0.9 + rand() * 0.5;
      const b: Bird = {
        species,
        slot: counts[species]++,
        phase: rand(),
        speed: 0.055 + rand() * 0.02,
        zJitter: (rand() - 0.5) * 4,
        yJitter: (rand() - 0.5) * 1.6,
        hzMul: 0.92 + (rand() * 4) / 4 * 0.16,
        seed: 0,
        tint: 1,
        size: 0,
        beat: 0,
        lastTime: Number.NaN,
      };
      b.seed = (b.phase * 9301 + b.zJitter * 49297) % 233.28;
      // rock doves vary: most blue-bar grey, the odd darker or paler bird
      b.tint = species === 'pigeon' ? 0.86 + 0.26 * frac(b.seed * 7.13) : 0.95 + 0.1 * frac(b.seed * 3.7);
      b.size = SIZE[species] * (0.92 + (scale - 0.9) * 0.3);
      return b;
    };
    const counts: Record<SpeciesId, number> = { pigeon: 0, starling: 0, gull: 0 };
    for (const s of STREAM) this.birds.push(makeBird(s, counts));
    for (const s of FLYBY) {
      const b = makeBird(s, counts);
      b.size *= 1.35; // the squad is close to the lens: bigger birds read better than a smaller flock
      this.flyby.push(b);
    }
    void this.load(high, counts);
  }

  private async load(high: boolean, counts: Record<SpeciesId, number>): Promise<void> {
    const manifest = (await fetch(asset('/models/birds/birds.json')).then((r) => r.json())) as Manifest;
    const f = manifest.files;
    const tl = new TextureLoader();
    const tex = async (file: string, srgb: boolean): Promise<Texture> => {
      const t = await tl.loadAsync(asset(`/models/birds/${file}`));
      t.flipY = false;
      t.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
      t.anisotropy = high ? 4 : 1;
      this.disposables.push(t);
      return t;
    };
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const [gltf, color, orm, normal] = await Promise.all([
      loader.loadAsync(asset(`/models/birds/${high ? f.glb : f.glbLo}`)),
      tex(high ? f.color : f.colorLo, true),
      tex(high ? f.orm : f.ormLo, false),
      high ? tex(f.normal, false) : Promise.resolve(null),
    ]);
    if (this.disposed) return;
    this.rigs = manifest.species;
    gltf.scene.updateMatrixWorld(true);
    const geos = new Map<string, BufferGeometry>();
    gltf.scene.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      // meshopt's quantised positions come with a node transform that undoes them: fold it into
      // float positions, as the rig's pivots are in the model's own metres
      const geo = mesh.geometry;
      const p = geo.getAttribute('position');
      const fl = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i++) {
        fl[i * 3] = p.getX(i);
        fl[i * 3 + 1] = p.getY(i);
        fl[i * 3 + 2] = p.getZ(i);
      }
      geo.setAttribute('position', new Float32BufferAttribute(fl, 3));
      geo.applyMatrix4(mesh.matrixWorld);
      geos.set(mesh.name.replace(/\.(mid|lo)$/, ''), geo);
    });
    for (const s of SPECIES) {
      const geo = geos.get(s);
      const n = counts[s];
      const rig = manifest.species[s];
      if (!geo || !n || !rig) continue;
      const flap = new InstancedBufferAttribute(new Float32Array(n * 4), 4);
      flap.setUsage(DynamicDrawUsage);
      const tail = new InstancedBufferAttribute(new Float32Array(n * 4), 4);
      tail.setUsage(DynamicDrawUsage);
      geo.setAttribute('aFlap', flap);
      geo.setAttribute('aTail', tail);
      const mat = birdMaterial(rig, color, orm, normal, high);
      const mesh = new InstancedMesh(geo, mat, n);
      mesh.name = `birds-${s}`;
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.frustumCulled = false;
      // hidden until the first update has placed them
      mesh.count = 0;
      this.group.add(mesh);
      this.meshes.set(s, mesh);
      this.flapAttr.set(s, flap);
      this.tailAttr.set(s, tail);
      this.disposables.push(geo, mat);
    }
  }

  update(time: number, t: number): void {
    if (!this.group.visible || !this.rigs) return;

    // — keyframed squad: crosses the lens at t ≈ 0.1–0.14 —
    for (let i = 0; i < this.flyby.length; i++) {
      const b = this.flyby[i]!;
      const u = Math.min(Math.max((t - 0.096 - i * 0.007) / 0.042, 0), 1);
      const at = (uu: number, out: Vector3): Vector3 => {
        const v = Math.min(Math.max(uu, 0), 1);
        out.lerpVectors(this.f0, this.f1, v);
        out.y += Math.sin(v * Math.PI) * 0.7 + b.yJitter * 0.4;
        out.z += b.zJitter * 0.35;
        return out;
      };
      at(u, this.pos);
      at(u + 0.03, this.ahead);
      at(u - 0.03, this.behind);
      // the squad crosses in about a second and a half of flight
      const presence = smooth(0, 0.1, u) * (1 - smooth(0.9, 1, u));
      this.place(b, time, 0.03 * 1.5, b.size * Math.max(presence, 0.001));
    }
    for (const b of this.birds) {
      const u = (time * b.speed + b.phase) % 1;
      this.streamAt(b, time, u, this.pos);
      this.streamAt(b, time + 0.25, u + 0.25 * b.speed, this.ahead);
      this.streamAt(b, time - 0.25, u - 0.25 * b.speed, this.behind);
      // fade in at the window, out over the roofs
      const presence = Math.min(u / 0.08, 1) * (1 - Math.max(0, (u - 0.88) / 0.12));
      this.place(b, time, 0.25, b.size * Math.max(presence, 0.001));
    }
    for (const s of SPECIES) {
      const mesh = this.meshes.get(s);
      if (!mesh) continue;
      mesh.count = mesh.instanceMatrix.count;
      mesh.instanceMatrix.needsUpdate = true;
      this.flapAttr.get(s)!.needsUpdate = true;
      this.tailAttr.get(s)!.needsUpdate = true;
    }
  }

  /** a stream bird's position along its bezier, with a slow weave so it banks now and then */
  private streamAt(b: Bird, time: number, u: number, out: Vector3): Vector3 {
    const a = 1 - u;
    out
      .set(0, 0, 0)
      .addScaledVector(this.p0, a * a)
      .addScaledVector(this.p1, 2 * a * u)
      .addScaledVector(this.p2, u * u);
    out.y += b.yJitter * u;
    out.z += b.zJitter * u;
    const w = Math.min(u / 0.15, 1);
    out.z += Math.sin(time * 0.9 + b.seed) * 0.35 * w;
    out.y += Math.sin(time * 0.6 + b.seed * 1.7) * 0.18 * w;
    return out;
  }

  /**
   * Orient and pose one bird from three points of its track (`behind`, `pos`, `ahead`, `dt`
   * seconds apart): nose along the velocity, banked so lift balances gravity and the turn.
   */
  private place(b: Bird, time: number, dt: number, scale: number): void {
    const rig = this.rigs![b.species]!;
    const fl = rig.flap;
    // velocity and acceleration from the track
    this.fwd.subVectors(this.ahead, this.behind);
    const speed = this.fwd.length() / (2 * dt);
    if (this.fwd.lengthSq() < 1e-10) this.fwd.set(-1, 0, 0);
    this.fwd.normalize();
    this.acc.copy(this.ahead).add(this.behind).addScaledVector(this.pos, -2).multiplyScalar(1 / (dt * dt));
    this.acc.addScaledVector(this.fwd, -this.acc.dot(this.fwd));
    // lift: opposes gravity plus the turn, clamped to a 50° bank
    this.up.set(0, 9.8, 0).add(this.acc.clampLength(0, 9.8 * Math.tan(50 * DEG)));
    this.up.addScaledVector(this.fwd, -this.up.dot(this.fwd)).normalize();
    const bank = Math.acos(Math.min(Math.max(this.up.y / Math.max(Math.hypot(this.up.y, this.up.x, this.up.z), 1e-6), -1), 1));

    // wing beat: integrated phase (frequency drifts a little with speed and from bird to bird)
    const hz = fl.hz * b.hzMul * (0.9 + 0.1 * Math.min(speed / 3, 1.5));
    if (Number.isNaN(b.lastTime) || Math.abs(time - b.lastTime) > 0.5) b.beat = time * hz + b.seed;
    else b.beat += (time - b.lastTime) * hz;
    b.lastTime = time;
    const ph = b.beat - Math.floor(b.beat);
    // a downstroke of 55% of the cycle, then the upstroke
    const D = 0.55;
    const psi = ph < D ? (Math.PI * ph) / D : Math.PI + (Math.PI * (ph - D)) / (1 - D);
    // glides: a slow pseudo-random gate per bird; climbing birds keep flapping
    const g0 = 0.5 + 0.5 * Math.sin(time * GLIDE[b.species].rate + b.seed) * Math.cos(time * GLIDE[b.species].rate * 0.61 + b.seed * 2.3);
    const climbing = smooth(0.15, 0.4, this.fwd.y);
    const glide = smooth(1 - GLIDE[b.species].share, 1.06 - GLIDE[b.species].share, g0) * (1 - climbing);
    const mid = ((fl.up + fl.down) / 2) * DEG;
    const amp = ((fl.up - fl.down) / 2) * DEG;
    const flapElev = mid + amp * Math.cos(psi);
    const up = Math.max(0, -Math.sin(psi));
    const flapFold = fl.fold * Math.pow(up, 0.8);
    const elev = flapElev + (fl.glide * DEG - flapElev) * glide;
    const fold = flapFold * (1 - glide) + 0.06 * glide;
    const down = Math.max(0, Math.sin(psi));
    const twist = (0.2 * down - 0.22 * up) * (1 - glide) + 0.03 * glide;
    const load = down * (1 - glide) * 0.9 + 0.25 * glide;
    // the body rises on the downstroke and pitches a touch
    const bob = -Math.cos(psi) * 0.012 * scale * (1 - glide);
    const pitch = Math.sin(psi) * 3 * DEG * (1 - glide);

    // basis: z forward, y up (banked), x to the left wing
    this.side.crossVectors(this.up, this.fwd).normalize();
    this.up.crossVectors(this.fwd, this.side);
    if (pitch !== 0) {
      // nose up about the side axis
      this.fwd.applyAxisAngle(this.side, -pitch);
      this.up.applyAxisAngle(this.side, -pitch);
    }
    this.m.makeBasis(this.side, this.up, this.fwd);
    this.m.scale(this.ahead.set(scale, scale, scale));
    this.m.setPosition(this.pos.x + this.up.x * bob, this.pos.y + this.up.y * bob, this.pos.z + this.up.z * bob);
    const mesh = this.meshes.get(b.species);
    if (!mesh) return;
    mesh.setMatrixAt(b.slot, this.m);
    const fa = this.flapAttr.get(b.species)!.array as Float32Array;
    fa[b.slot * 4] = elev;
    fa[b.slot * 4 + 1] = fold;
    fa[b.slot * 4 + 2] = twist;
    fa[b.slot * 4 + 3] = load;
    const ta = this.tailAttr.get(b.species)!.array as Float32Array;
    // the tail closes in fast flapping flight, fans when gliding or banking, dips on the downstroke
    ta[b.slot * 4] = -0.06 + 0.06 * Math.sin(psi) * (1 - glide) + 0.04 * glide;
    ta[b.slot * 4 + 1] = 0.05 + 0.45 * glide + 0.6 * Math.min(bank / (40 * DEG), 1);
    ta[b.slot * 4 + 2] = b.tint;
  }

  dispose(): void {
    this.disposed = true;
    for (const d of this.disposables) d.dispose();
  }
}

function frac(x: number): number {
  return x - Math.floor(x);
}

function smooth(a: number, b: number, x: number): number {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
}

/**
 * Lit like the rest of the scene (MeshStandardMaterial under the sun, sky and environment), from
 * the baked atlas: colour with the feathers' cut-outs in alpha, ORM (R occlusion, G roughness,
 * B the neck's iridescence mask) and on HIGH the normal map. On top: the rig, the vertex occlusion
 * of tucked feather roots, the paler underside of a feather, the green-purple sheen of a pigeon's
 * (and a starling's) neck turning with the view, and the low sun shining through thin feathers.
 */
function birdMaterial(
  rig: SpeciesRig,
  color: Texture,
  orm: Texture,
  normal: Texture | null,
  high: boolean,
): MeshStandardMaterial {
  const mat = new MeshStandardMaterial({
    map: color,
    aoMap: orm,
    roughnessMap: orm,
    normalMap: normal,
    roughness: 1,
    metalness: 0,
    alphaTest: 0.5,
    side: high ? DoubleSide : FrontSide,
  });
  const uniforms = {
    uShoulder: { value: new Vector3(...rig.shoulder) },
    uElbow: { value: new Vector3(...rig.elbow) },
    uWrist: { value: new Vector3(...rig.wrist) },
    uTailPivot: { value: new Vector3(...rig.tail) },
    uSpan: { value: rig.span },
  };
  mat.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${RIG_GLSL}`)
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
        vec3 rigged = position;
        birdRig(rigged, objectNormal);
        vThin = _rig.y;
        vOcc = _aux.x;
        vTint = aTail.z;`,
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed = rigged;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vThin;\nvarying float vOcc;\nvarying float vTint;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        // vertex occlusion (feather roots under the next row) and part of the baked AO also dim the sun
        diffuseColor.rgb *= vOcc * mix(1.0, texture2D(aoMap, vAoMapUv).r, 0.5);`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        diffuseColor.rgb *= vTint;
        // a feather's underside is paler and greyer than its top
        if (!gl_FrontFacing && vThin > 0.5) diffuseColor.rgb = mix(diffuseColor.rgb, vec3(dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11))) * 1.3, 0.4);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        {
          // structural colour: green face-on, purple at grazing angles, on the masked neck feathers
          float sh = texture2D(roughnessMap, vRoughnessMapUv).b;
          float nv = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
          vec3 irid = mix(vec3(0.42, 0.12, 0.5), vec3(0.08, 0.5, 0.26), smoothstep(0.25, 0.8, nv));
          diffuseColor.rgb = mix(diffuseColor.rgb, irid * 0.5 + diffuseColor.rgb * 0.5, sh * 0.75);
          roughnessFactor = mix(roughnessFactor, 0.38, sh * 0.6);
        }`,
      )
      .replace(
        '#include <opaque_fragment>',
        `#if NUM_DIR_LIGHTS > 0
        {
          // thin feathers glow warm with the low sun behind them
          vec3 Ld = directionalLights[0].direction;
          float thru = pow(max(dot(-normalize(vViewPosition), Ld), 0.0), 4.0);
          float wrap = max(dot(-normal, Ld), 0.0);
          outgoingLight += vThin * (thru * 0.5 + wrap * 0.1) * directionalLights[0].color * diffuseColor.rgb * vec3(1.0, 0.86, 0.72) * 0.22;
        }
        #endif
        #include <opaque_fragment>`,
      );
  };
  mat.customProgramCacheKey = () => `birds-${high ? 'hi' : 'lo'}`;
  return mat;
}
