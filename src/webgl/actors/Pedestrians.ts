import {
  BufferGeometry,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshDepthMaterial,
  MeshDistanceMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  RGBADepthPacking,
  Vector3,
} from 'three';
import type { Material, WebGLProgramParametersWithUniforms } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { softShadowTexture } from '../bake/CanvasTextures';
import { asset } from '../asset';
import { LAMP_CASTER_LAYER } from '../layers';
import { muted, mulberry32 } from '../util';
import type { Quality } from '../quality';

/** One figure in public/models/people/manifest.json (written by blender/make_people.py). */
interface Variant {
  id: string;
  kind: 'person' | 'dog';
  build: string;
  mesh: string;
  height: number;
  tris: number;
  options: string[];
  /** one pivot per bone (glTF frame, site units): see B_* in blender/bld/people.py */
  pivots: number[][];
  /** thigh and shin length */
  legs: number[];
  /** heel x, y and toe x, y from the ankle */
  foot: number[];
  /** the right palm in the rest pose (the dog's collar), where a leash is held */
  hand: number[];
}
interface Manifest { options: string[]; variants: Variant[] }

/** A walkway people follow: a sidewalk, a front walk, a stroll across a plaza. */
export interface Walk {
  /** its centre line, in the crowd group's x/z; corners are rounded as people follow it */
  points: [number, number][];
  /** usable width: walkers keep to the right half of it and pass each other inside it */
  width: number;
  /** people on it */
  count: number;
  /**
   * What walkers do at its ends: 'wrap' (they shrink away and come back in at the other end; for
   * ends out of sight) or 'turn' (they stop, wait a moment, turn round and walk back).
   */
  ends: 'wrap' | 'turn';
  /** seconds a walker waits at an end before turning round ('turn' only) */
  pause?: [number, number];
  /** share of joggers, of dog walkers, and of people walking with someone beside them */
  joggers?: number;
  dogs?: number;
  pairs?: number;
  /** stretches (arc length from the first point) a walker may only step into while `open(time)`: crossings */
  gates?: { s0: number; s1: number; open: (time: number) => boolean }[];
  /** where along it the walkers start, as a fraction of its length (default all of it) */
  spread?: [number, number];
  /** radius its corners are rounded to (default 0.6) */
  round?: number;
  /** a one-way walkway: everyone walks from the first point to the last (1) or back (-1); default both */
  dir?: 1 | -1;
}

/** Someone standing still: on a porch, by a car, chatting on the sidewalk, in a plaza. */
export interface Stand {
  x: number;
  z: number;
  /** heading: 0 faces +x, as everywhere on the site */
  yaw: number;
  /** 'idle' looks about, 'chat' talks (turns with whoever faces them), 'phone' reads one */
  mood?: 'idle' | 'chat' | 'phone';
  /** people with the same `group` talk in turns rather than all at once */
  group?: number;
}

export interface CrowdPlan {
  walks: Walk[];
  stands: Stand[];
  /** clothing: 'day' (the town on a summer evening) or 'night' (the city: coats, darker, a few bright) */
  look: 'day' | 'night';
  /** uniform scale of everyone (the night city draws people 1.35x, like its cars) */
  scale?: number;
  /** people further than this from the camera are not drawn (their vertices collapse in the shader) */
  far: number;
  seed?: number;
}

// ---- looks -----------------------------------------------------------------------------------

const SKIN = ['#f3cfb3', '#eabf9c', '#e0ac85', '#d29a72', '#c08463', '#a46c49', '#8a5838', '#6e4329', '#553222', '#f6d9c4'];
const HAIR = ['#1b1512', '#2a1c14', '#3b291c', '#4f3524', '#6a4a2e', '#8c6a43', '#b8925c', '#d6bb83', '#8f8a84',
  '#c9c5bf', '#6e2f1c', '#121212'];
const HAIR_W = [3, 3, 3, 2.5, 2, 1.4, 1, 0.8, 0.7, 0.4, 0.5, 2];
const TOPS_DAY = ['#d64545', '#e8833a', '#efc54a', '#5aa264', '#3d7fc2', '#2f4d8a', '#8e5bb5', '#f2efe6', '#fdfdfb',
  '#e9a7b6', '#76c1c4', '#a3b04f', '#3a404b', '#b23a5e', '#5fa8d3', '#cfc6b4', '#e86f5a', '#2d7d6e'].map((c) => muted(c, 0.62));
const BOTTOMS_DAY = ['#3b5068', '#2f3e55', '#4a6585', '#5b7aa0', '#b9a27c', '#8a7a5c', '#5a5e66', '#24262b', '#e6e1d4',
  '#26324d', '#5a5f3c', '#7d4a3a'];
const SKIRTS_DAY = ['#d64545', '#3d7fc2', '#efc54a', '#2f4d8a', '#f2efe6', '#5aa264', '#e9a7b6', '#24262b', '#8e5bb5',
  '#76c1c4', '#b23a5e'];
const SHOES_DAY = ['#f4f3ef', '#f4f3ef', '#2a2a2e', '#4a3423', '#7a5a3c', '#c23b3b', '#3a4f7a', '#1a1a1a', '#d9d4c7'];
const ACC_DAY = ['#2c2c30', '#7a4b2a', '#b5402f', '#3b5e8c', '#d6a23a', '#4e6b3f', '#e3dccf', '#5a2e48', '#1f1f22'];
const UNDER_DAY = ['#f4f2ec', '#dfe7f1', '#c9ccd1', '#2b2d33', '#f4f2ec'];
const COATS = ['#1d1f24', '#2a2d34', '#3a3226', '#4b3a2a', '#7a6040', '#2b3446', '#3c4a3a', '#5a2a2e', '#6e6e70',
  '#232a38', '#3d3d42'];
const COATS_BRIGHT = ['#c8392e', '#e0b21f', '#2d8c8c', '#e8e2d4', '#c25a83', '#4f7cc4'];
const BOTTOMS_NIGHT = ['#1c1d22', '#25272e', '#33363d', '#2f3a4f', '#4a4a4f', '#3a3128', '#28303e'];
const SHOES_NIGHT = ['#151517', '#2a2a2e', '#3b2a1e', '#4a3423', '#1a1a1a', '#d8d6d0'];
const ACC_NIGHT = ['#1c1c20', '#5a2a2e', '#b5402f', '#c9a227', '#3b5e8c', '#e3dccf', '#7a4b2a', '#3d6b5a', '#8a8a8e'];
const TIGHTS = ['#141416', '#23242a', '#3a3a40', '#2b2f45'];
const DOG_COATS = ['#c8995a', '#e0c08a', '#1d1a18', '#5b3a22', '#f0ebe0', '#8a7a6a', '#a8652e', '#3a2d24'];
const COLLARS = ['#c0392b', '#2e6bd1', '#2f9e55', '#e67e22', '#d6458f', '#1f1f22'];

/** how common each variant is, by look; joggers and dogs are placed by the walks themselves */
const MIX: Record<'day' | 'night', Record<string, number>> = {
  day: { 'man-casual': 3, 'man-jacket': 1.2, 'woman-dress': 2.2, 'woman-casual': 3, child: 0, 'man-coat': 0.12, 'woman-coat': 0.12 },
  night: { 'man-coat': 3, 'woman-coat': 3, 'man-jacket': 2.6, 'woman-casual': 1.5, 'man-casual': 0.7, 'woman-dress': 0.8, child: 0 },
};

/** walking speed in metres a second (scaled to site units by 0.33 and the crowd's scale) */
const WALK = [1.15, 1.5];
const JOG = [2.4, 2.95];
const METRE = 0.33;
/** stance share of the cycle and how far the ankle reaches ahead of the hip, per leg length (see legPose) */
const WALK_STANCE = 0.62;
const WALK_REACH = 0.46;
const JOG_STANCE = 0.36;
const JOG_REACH = 0.44;
/** units over which a walker grows in and shrinks away at a wrapping walk's ends */
const FADE = 1.6;

// ---- the shader ---------------------------------------------------------------------------------

/**
 * The walk cycle, posed per vertex. Every vertex knows its bone (`aRig.x`, which also holds its
 * colour region) and how much of that bone's own turn it takes (`aRig.z`); the bone's pivot comes
 * from `uPiv`. A vertex is turned
 * about its own joint and then about every joint above it (foot, shin, thigh, pelvis; forearm,
 * upper arm, chest, pelvis), so the figure is a small forward-kinematics rig with no skinning data.
 *
 * The legs are solved, not just swung: for each leg the stance foot's ankle slides back under the
 * hip at a constant speed (so it stays planted while the runtime advances the phase by distance
 * walked), the thigh angle is the 2-bone solution that puts it there for the knee's current flex,
 * and the foot rolls heel - flat - toe. The pelvis then drops until the lower foot touches the
 * ground, which gives the bob of a walk for free. Arms swing against the legs with the elbows
 * bending on the forward swing, the chest counter-rotates against the pelvis, the head holds its
 * line. Joggers run the same rig with a short stance, high knee fold, pumping arms, forward lean
 * and a flight phase. Standing people sway their weight, look about, talk with their hands.
 */
const RIG = /* glsl */ `
// (bone * 16 + region, option, weight * 255, occlusion * 255), packed by blender/make_people.py
attribute vec4 aRig;
attribute vec4 aGait;
attribute vec4 aPose;
attribute vec4 aCol0;
attribute vec4 aCol1;
uniform vec3 uPiv[16];
uniform vec4 uLeg;
uniform vec4 uFoot;
uniform float uTime;
uniform float uFar;
// the main camera: the shadow passes draw from the light, and cameraPosition is the light there
uniform vec3 uEye;

const float ROUGH[9] = float[9](0.6, 0.48, 0.84, 0.8, 0.45, 0.6, 0.84, 0.5, 0.62);

vec3 rotX(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(p.x, c * p.y - s * p.z, s * p.y + c * p.z); }
vec3 rotY(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z); }
vec3 rotZ(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(c * p.x - s * p.y, s * p.x + c * p.y, p.z); }
float hat(float x, float c, float w) { return 0.5 + 0.5 * cos(PI * clamp((x - c) / w, -1.0, 1.0)); }
// the same on the phase circle, for bumps that run across the cycle's end
float hatp(float x, float c, float w) { float d = x - c; d -= floor(d + 0.5); return hat(d, 0.0, w); }

vec3 unpackColor(float c) {
  vec3 s = vec3(floor(c / 65536.0), mod(floor(c / 256.0), 256.0), mod(c, 256.0)) / 255.0;
  return mix(s / 12.92, pow((s + 0.055) / 1.055, vec3(2.4)), step(0.04045, s));
}
`;

const PERSON = /* glsl */ `
// one leg at its own phase f (0 = heel strike), stride amount a, jog j: thigh angle, knee flex,
// ankle angle, and the lowest point of the sole below the hip
vec4 legPose(float f, float a, float j) {
  float st = mix(${WALK_STANCE.toFixed(2)}, ${JOG_STANCE.toFixed(2)}, j);
  float reach = mix(uLeg.z, uLeg.w, j) * a;
  // the ankle: back under the hip at a constant speed through stance, swung forward in swing
  float ax = f < st ? reach * (1.0 - 2.0 * f / st) : reach * (-1.0 + 2.0 * smoothstep(st, 1.0, f));
  float knee = a * (mix(0.16, 0.55, j) * hat(f, st * 0.3, st * 0.3)
                  + mix(1.05, 1.8, j) * hatp(f, st + mix(0.11, 0.26, j), mix(0.2, 0.3, j)));
  // the foot's pitch against the ground: heel strike, flat, heel rise and toe-off, swing
  float pw = 0.25 * (1.0 - smoothstep(0.0, 0.08, f)) - 0.5 * smoothstep(st - 0.2, st, f) * (1.0 - smoothstep(st, st + 0.16, f))
           + 0.25 * smoothstep(st + 0.1, 1.0, f);
  float pj = 0.05 * (1.0 - smoothstep(0.0, 0.1, f)) - 0.7 * smoothstep(st - 0.18, st, f) * (1.0 - smoothstep(st, st + 0.2, f))
           + 0.1 * smoothstep(st + 0.25, 1.0, f);
  float pitch = a * mix(pw, pj, j);
  // two-bone solve: the thigh angle that puts the ankle ax ahead of the hip for this knee flex
  float A = uLeg.x + uLeg.y * cos(knee);
  float B = uLeg.y * sin(knee);
  float th = atan(B, A) + asin(clamp(ax / sqrt(A * A + B * B), -1.0, 1.0));
  float sh = th - knee;
  float ay = -(uLeg.x * cos(th) + uLeg.y * cos(sh));
  float c = cos(pitch), s = sin(pitch);
  float low = ay + min(s * uFoot.x + c * uFoot.y, s * uFoot.z + c * uFoot.w);
  return vec4(th, knee, pitch - sh, low);
}

void pose(inout vec3 p, inout vec3 n) {
  int bone = int(aRig.x + 0.5) / 16;
  float w = aRig.z / 255.0;
  float ph = aGait.x, a = aGait.y, j = aGait.z, seed = aGait.w;
  float t = uTime;
  int mode = int(aPose.z + 0.5);
  float still = 1.0 - clamp(a * 3.0, 0.0, 1.0);
  vec4 L = legPose(ph, a, j);
  vec4 R = legPose(fract(ph + 0.5), a, j);
  // the pelvis drops until the lower foot is on the ground; a jogger leaves it between strides
  float rest = -(uLeg.x + uLeg.y) + min(uFoot.y, uFoot.w);
  float bob = rest - min(L.w, R.w);
  float g = fract(2.0 * ph), fl = 2.0 * mix(${WALK_STANCE.toFixed(2)}, ${JOG_STANCE.toFixed(2)}, j);
  bob += j * a * 0.07 * (uLeg.x + uLeg.y) * (g > fl ? sin(PI * (g - fl) / (1.0 - fl)) : 0.0);
  // +1 while the left leg is forward
  float sw = cos(2.0 * PI * (ph - 0.04));
  // arms swing against the legs; the elbow bends on the forward swing
  float armA = mix(0.34, 0.62, j) * a;
  float shL = -armA * sw, shR = armA * sw;
  float elB = mix(0.18, 1.45, j);
  float elL = elB + a * mix(0.3, 0.2, j) * max(0.0, -sw);
  float elR = elB + a * mix(0.3, 0.2, j) * max(0.0, sw);
  shL += still * 0.035 * sin(t * 0.8 + seed * 31.0);
  shR += still * 0.035 * sin(t * 0.7 + seed * 17.0);
  float abL = 0.0, abR = 0.0;
  // talking: one hand comes up and moves, in turns with whoever they are talking to
  float turn = step(0.5, fract(t / 7.0 + seed));
  float talk = aPose.y * turn * smoothstep(0.15, 0.6, 0.5 + 0.5 * sin(t * 0.9 + seed * 9.0));
  elR += talk * (0.75 + 0.35 * sin(t * 3.3 + seed * 5.0));
  shR += talk * 0.22;
  elL += talk * 0.3 * (0.5 + 0.5 * sin(t * 2.1 + seed * 3.0));
  float hPitch = -0.03 * a + 0.1 * j * a + aPose.y * (1.0 - turn) * 0.05 * sin(t * 2.6 + seed * 3.0);
  if (mode == 1) { shR = 0.42; elR = 0.6; abR = -0.1; }                         // holding a leash
  if (mode == 2) { shR = 0.32; elR = 1.9; abR = 0.12; hPitch = -0.42; }          // reading a phone
  // chest against pelvis, forward lean, a standing weight shift
  float tYaw = 0.09 * a * sw * (1.0 + j);
  float pYaw = -0.07 * a * sw;
  float lean = -(0.03 * a + 0.14 * j * a);
  float roll = still * 0.02 * sin(t * 0.43 + seed * 13.0);
  float sway = -0.016 * a * cos(2.0 * PI * (ph - 0.31)) * (uLeg.x + uLeg.y) + still * 0.012 * (uLeg.x + uLeg.y) * sin(t * 0.43 + seed * 13.0);
  // the head holds its line, glances about now and then, and looks around more when standing
  float glance = (0.12 + 0.4 * still) * sin(t * 0.37 + seed * 23.0) * smoothstep(0.3, 0.9, 0.5 + 0.5 * sin(t * 0.21 + seed * 7.0));
  float hYaw = -(tYaw + pYaw) * 0.85 + aPose.x + (mode == 2 ? 0.0 : glance);

  vec3 q;
  if (bone == 9 || bone == 12) {                 // feet
    vec4 lg = bone == 9 ? L : R;
    q = uPiv[bone]; p = q + rotZ(p - q, lg.z * w); n = rotZ(n, lg.z * w);
    bone -= 1; w = 1.0;
  }
  if (bone == 8 || bone == 11) {                 // shins
    vec4 lg = bone == 8 ? L : R;
    q = uPiv[bone]; p = q + rotZ(p - q, -lg.y * w); n = rotZ(n, -lg.y * w);
    bone -= 1; w = 1.0;
  }
  if (bone == 7 || bone == 10) {                 // thighs
    vec4 lg = bone == 7 ? L : R;
    q = uPiv[bone]; p = q + rotZ(p - q, lg.x * w); n = rotZ(n, lg.x * w);
    bone = 0; w = 1.0;
  }
  if (bone == 4 || bone == 6) {                  // forearms
    float e = (bone == 4 ? elL : elR) * w;
    q = uPiv[bone]; p = q + rotZ(p - q, e); n = rotZ(n, e);
    bone -= 1; w = 1.0;
  }
  if (bone == 3 || bone == 5) {                  // upper arms: out a little, then the swing
    float s = (bone == 3 ? shL : shR) * w;
    float o = (bone == 3 ? 0.03 + abL : -0.03 + abR) * w;
    q = uPiv[bone]; p = q + rotZ(rotX(p - q, o), s); n = rotZ(rotX(n, o), s);
    bone = 1; w = 1.0;
  }
  if (bone == 2) {                               // head
    q = uPiv[2]; p = q + rotY(rotZ(p - q, hPitch * w), hYaw * w); n = rotY(rotZ(n, hPitch * w), hYaw * w);
    bone = 1; w = 1.0;
  }
  if (bone == 1) {                               // chest
    q = uPiv[1]; p = q + rotY(rotZ(rotX(p - q, roll * w), lean * w), tYaw * w);
    n = rotY(rotZ(rotX(n, roll * w), lean * w), tYaw * w);
    bone = 0;
  }
  if (bone == 13) {                              // a skirt or coat tails: each side follows its thigh
    float side = smoothstep(abs(uPiv[7].z), -abs(uPiv[7].z), p.z);
    float s = w * mix(R.x, L.x, side);
    q = uPiv[13]; p = q + rotZ(p - q, s); n = rotZ(n, s);
    bone = 0;
  }
  if (bone == 14) {                              // a bag on the hip bounces at each step
    float s = 0.12 * a * sin(4.0 * PI * ph) * (1.0 + j);
    q = uPiv[14]; p = q + rotZ(p - q, s); n = rotZ(n, s);
    bone = 0;
  }
  q = uPiv[0];
  p = q + rotY(p - q, pYaw);
  n = rotY(n, pYaw);
  p.y += bob;
  p.z += sway;
}
`;

const DOG = /* glsl */ `
void pose(inout vec3 p, inout vec3 n) {
  int bone = int(aRig.x + 0.5) / 16;
  float w = aRig.z / 255.0;
  float ph = aGait.x, a = aGait.y, seed = aGait.w;
  float t = uTime;
  float still = 1.0 - clamp(a * 3.0, 0.0, 1.0);
  vec3 q;
  // a trot: diagonal pairs move together (front left with hind right)
  if (bone == 4 || bone == 6 || bone == 8 || bone == 11) {
    bool front = bone <= 6;
    bool left = bone == 4 || bone == 8;
    float f = ph + (front == left ? 0.0 : 0.5);
    float fold = -a * (front ? 0.8 : 0.65) * max(0.0, cos(2.0 * PI * f));
    q = uPiv[bone]; p = q + rotZ(p - q, fold * w); n = rotZ(n, fold * w);
    bone -= 1; w = 1.0;
  }
  if (bone == 3 || bone == 5 || bone == 7 || bone == 10) {
    bool front = bone <= 5;
    bool left = bone == 3 || bone == 7;
    float f = ph + (front == left ? 0.0 : 0.5);
    float s = a * (front ? 0.45 : 0.4) * sin(2.0 * PI * f) * w;
    q = uPiv[bone]; p = q + rotZ(p - q, s); n = rotZ(n, s);
    bone = 0;
  }
  if (bone == 15) {                              // the tail wags, faster when it walks
    float y = (0.35 + 0.2 * still) * sin(t * (8.0 + 3.0 * seed) + seed * 20.0);
    float u = 0.12 * sin(t * 1.3 + seed * 4.0);
    q = uPiv[15]; p = q + rotY(rotZ(p - q, u), y); n = rotY(rotZ(n, u), y);
    bone = 0;
  }
  if (bone == 2) {                               // the head: bobs with the trot, sniffs about when it stops
    float pitch = 0.06 * a * cos(4.0 * PI * ph) - still * 0.3 * smoothstep(0.4, 0.9, 0.5 + 0.5 * sin(t * 0.5 + seed * 7.0));
    float yaw = still * 0.5 * sin(t * 0.37 + seed * 11.0) + 0.08 * sin(t * 1.1 + seed);
    float k = w;
    q = uPiv[2]; p = q + rotY(rotZ(p - q, pitch * k), yaw * k); n = rotY(rotZ(n, pitch * k), yaw * k);
    bone = 0;
  }
  p.y += 0.02 * uLeg.x * a * cos(4.0 * PI * ph);
}
`;

/** The vertex patch shared by the lit material and the shadow passes' depth materials. */
const CULL = /* glsl */ `
  // past uFar (or an option this person does without, or faded to nothing): collapse to a point
  vec3 origin = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  int opt = int(aRig.y + 0.5);
  int mask = int(aPose.w + 0.5);
  bool gone = distance(origin, uEye) > uFar || (opt > 0 && ((mask >> (opt - 1)) & 1) == 0);
`;

interface Shared { uTime: { value: number }; uFar: { value: number }; uEye: { value: Vector3 } }

/**
 * The materials of one variant: a standard material posed and tinted per instance (see RIG), and
 * the depth and distance materials the sun's and the lamps' shadow passes draw it with, posed the
 * same way so the shadows walk too. One set per variant: its pivots are its own.
 */
function figureMaterials(v: Variant, shared: Shared): { lit: MeshStandardMaterial; depth: Material; distance: Material } {
  const dog = v.kind === 'dog';
  const pivots = Array.from({ length: 16 }, (_, k) => new Vector3(...(v.pivots[k] ?? v.pivots[0]!) as [number, number, number]));
  const legLen = v.legs[0]! + v.legs[1]!;
  const uniforms = {
    uPiv: { value: pivots },
    uLeg: { value: [v.legs[0]!, v.legs[1]!, WALK_REACH * legLen, JOG_REACH * legLen] },
    uFoot: { value: v.foot },
    ...shared,
  };
  const head = `#include <common>\n${RIG}\n${dog ? DOG : PERSON}`;
  const key = dog ? 'pedestrian-dog' : 'pedestrian-person';

  const lit = new MeshStandardMaterial({ roughness: 0.8, metalness: 0 });
  lit.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `${head}\nvarying vec3 vTint;\nvarying float vRough;\nvarying float vOcc;`)
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
        vec3 posed = position;
        ${CULL}
        if (gone) posed = vec3(0.0);
        else pose(posed, objectNormal);
        int reg = int(aRig.x + 0.5) % 16;
        float pk = reg == 0 ? aCol0.x : reg == 1 ? aCol0.y : reg == 2 ? aCol0.z : reg == 3 ? aCol0.w
                 : reg == 4 ? aCol1.x : reg == 5 ? aCol1.y : reg == 6 ? aCol1.z : -1.0;
        vTint = pk >= 0.0 ? unpackColor(pk) : (reg == 7 ? vec3(0.018, 0.017, 0.016) : vec3(0.7, 0.69, 0.66));
        vRough = ROUGH[clamp(reg, 0, 8)];
        vOcc = aRig.w / 255.0;`,
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed = posed;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTint;\nvarying float vRough;\nvarying float vOcc;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vTint * mix(1.0, vOcc, 0.85);')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = vRough;');
  };
  lit.customProgramCacheKey = () => key;

  const posedDepth = <T extends Material>(mat: T, suffix: string): T => {
    mat.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', head)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          vec3 nrm = vec3(0.0, 1.0, 0.0);
          ${CULL}
          if (gone) transformed = vec3(0.0);
          else pose(transformed, nrm);
        }`);
    };
    mat.customProgramCacheKey = () => `${key}-${suffix}`;
    return mat;
  };
  return {
    lit,
    depth: posedDepth(new MeshDepthMaterial({ depthPacking: RGBADepthPacking }), 'depth'),
    distance: posedDepth(new MeshDistanceMaterial(), 'distance'),
  };
}

// ---- walkways ------------------------------------------------------------------------------------

/** A polyline with rounded corners, sampled by arc length. */
class Route {
  private xs: number[] = [];
  private zs: number[] = [];
  private cum: number[] = [];
  readonly length: number;

  constructor(points: [number, number][], round = 0.6) {
    const add = (x: number, z: number): void => {
      const n = this.xs.length;
      if (n && Math.hypot(x - this.xs[n - 1]!, z - this.zs[n - 1]!) < 1e-4) return;
      this.xs.push(x);
      this.zs.push(z);
    };
    add(...points[0]!);
    for (let i = 1; i < points.length - 1; i++) {
      const [ax, az] = points[i - 1]!;
      const [bx, bz] = points[i]!;
      const [cx, cz] = points[i + 1]!;
      const l0 = Math.hypot(bx - ax, bz - az);
      const l1 = Math.hypot(cx - bx, cz - bz);
      const r = Math.min(round, l0 / 2, l1 / 2);
      const px = bx + ((ax - bx) / l0) * r;
      const pz = bz + ((az - bz) / l0) * r;
      const qx = bx + ((cx - bx) / l1) * r;
      const qz = bz + ((cz - bz) / l1) * r;
      for (let k = 0; k <= 6; k++) {
        const t = k / 6;
        const u = 1 - t;
        add(u * u * px + 2 * u * t * bx + t * t * qx, u * u * pz + 2 * u * t * bz + t * t * qz);
      }
    }
    add(...points[points.length - 1]!);
    let s = 0;
    this.cum.push(0);
    for (let i = 1; i < this.xs.length; i++) {
      s += Math.hypot(this.xs[i]! - this.xs[i - 1]!, this.zs[i]! - this.zs[i - 1]!);
      this.cum.push(s);
    }
    this.length = s;
  }

  /** position and unit tangent at arc length s (clamped to the route) */
  at(s: number, out: { x: number; z: number; tx: number; tz: number }): void {
    const c = this.cum;
    s = Math.min(Math.max(s, 0), this.length);
    let lo = 0;
    let hi = c.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (c[mid]! <= s) lo = mid;
      else hi = mid;
    }
    const seg = c[hi]! - c[lo]! || 1;
    const t = (s - c[lo]!) / seg;
    const dx = this.xs[hi]! - this.xs[lo]!;
    const dz = this.zs[hi]! - this.zs[lo]!;
    out.x = this.xs[lo]! + dx * t;
    out.z = this.zs[lo]! + dz * t;
    const l = Math.hypot(dx, dz) || 1;
    out.tx = dx / l;
    out.tz = dz / l;
  }
}

// ---- the crowd ---------------------------------------------------------------------------------------

/** One drawn figure, person or dog: where it is and how it moves this frame. */
interface Body {
  variant: number;
  slot: number;
  shadow: number;
  moving: boolean;
  x: number;
  z: number;
  yaw: number;
  /** velocity, for whoever is deciding whether to pass it */
  vx: number;
  vz: number;
  scale: number;
  fade: number;
  phase: number;
  amp: number;
  jog: number;
  seed: number;
  /** personal radius */
  r: number;
  pose: [number, number, number, number];
  colors: [number, number, number, number, number, number, number];
}

interface Walker {
  body: Body;
  route: Route;
  walk: Walk;
  /** arc length along the route, direction of travel, lateral offset to the walker's own left */
  s: number;
  dir: 1 | -1;
  ul: number;
  ulPref: number;
  v: number;
  v0: number;
  /** stride per cycle at full amount */
  stride: number;
  state: 'walk' | 'wait' | 'turn';
  timer: number;
  turnFrom: number;
  /** someone walking beside this one, on its left */
  mate?: { body: Body; stride: number; offset: number };
  dog?: { body: Body; stride: number };
  /** how far the group reaches to the walker's left and right */
  lo: number;
  hi: number;
  /** seconds spent held up, and seconds left of squeezing past (see `step`) */
  stuck: number;
  squeeze: number;
}

const packColor = (hex: string): number => parseInt(hex.slice(1), 16);
const GRID = 1024;

/**
 * Pedestrians: people walking the sidewalks, going up front walks to their doors, standing on
 * porches and driveways, chatting, reading their phones, jogging, walking dogs. Blender figures
 * (blender/make_people.py: eight people and a dog, each one instanced mesh, so one draw call a
 * variant) posed in the vertex shader (see RIG), with every person's skin, hair and clothes their
 * own colours (packed per instance), options (hats, bags, backpacks, ponytails, beards, scarves)
 * switched per instance, and a soft contact shadow under each. On HIGH they also cast real shadows
 * (sun and streetlight spots), through depth materials posed by the same shader code.
 *
 * Walking is decided on the CPU, cheaply: every walker follows its walkway, keeps right, and each
 * frame tries a few lateral positions against everyone within a couple of metres ahead (found
 * through a hash grid), taking the clear one nearest its own side; when nothing is clear it slows
 * behind whoever blocks it. Pairs walk side by side, dogs trot ahead on a leash. The phase of the
 * walk advances by the distance walked, so feet stay planted. Only the moving people's matrices
 * and gait are uploaded each frame (they come first in every mesh); standing people are written once.
 */
export class Pedestrians {
  readonly group = new Group();
  private variants: Variant[] = [];
  private meshes: (InstancedMesh | null)[] = [];
  private gaits: (InstancedBufferAttribute | null)[] = [];
  private moving: number[] = [];
  private bodies: Body[] = [];
  private walkers: Walker[] = [];
  private shadows: InstancedMesh | null = null;
  private shadowMoving = 0;
  private leash: LineSegments | null = null;
  private leashed: Walker[] = [];
  private uniforms: Shared = { uTime: { value: 0 }, uFar: { value: 60 }, uEye: { value: new Vector3(0, 1e5, 0) } };
  private ready = false;
  private last = -1;
  private rand = mulberry32(9137);
  private k = 1;
  private disposables: { dispose(): void }[] = [];

  // the hash grid of everyone's position, rebuilt each frame
  private head = new Int32Array(GRID);
  private next = new Int32Array(0);

  // scratch
  private m4 = new Matrix4();
  private q = new Quaternion();
  private p = new Vector3();
  private sc = new Vector3();
  private Y = new Vector3(0, 1, 0);
  private pt = { x: 0, z: 0, tx: 1, tz: 0 };
  private handL = new Vector3();
  private collar = new Vector3();

  constructor(private quality: Quality, private plan: CrowdPlan) {
    this.k = plan.scale ?? 1;
    this.uniforms.uFar.value = plan.far;
    // dev hook for automated inspection (like the engine's `__engine`): the crowds, under ?probe
    if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('probe')) {
      const w = window as unknown as { __crowds?: Pedestrians[] };
      (w.__crowds ??= []).push(this);
    }
    void this.init();
  }

  private async init(): Promise<void> {
    const manifest = (await fetch(asset('/models/people/manifest.json'), { cache: 'no-cache' }).then((r) =>
      r.json(),
    )) as Manifest;
    this.variants = manifest.variants;
    const gltf = await new GLTFLoader().loadAsync(asset('/models/people/people.glb'));
    const geos = new Map<string, BufferGeometry>();
    gltf.scene.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh) geos.set(m.name, m.geometry);
    });
    this.populate(manifest);
    const high = this.quality.tier === 'high';

    // one instanced mesh per variant, moving people first
    const counts = this.variants.map(() => 0);
    for (const b of this.bodies) counts[b.variant]!++;
    this.moving = this.variants.map(() => 0);
    const order = [...this.bodies].sort((a, b) => Number(b.moving) - Number(a.moving));
    const filled = this.variants.map(() => 0);
    order.forEach((b, i) => {
      b.slot = filled[b.variant]!++;
      b.shadow = i;
      if (b.moving) this.moving[b.variant]!++;
    });
    this.shadowMoving = order.filter((b) => b.moving).length;

    this.variants.forEach((v, vi) => {
      const geo = geos.get(v.mesh);
      const n = counts[vi]!;
      if (!geo || !n) {
        this.meshes.push(null);
        this.gaits.push(null);
        return;
      }
      geo.setAttribute('aRig', geo.getAttribute('_rig'));
      geo.deleteAttribute('_rig');
      const gait = new InstancedBufferAttribute(new Float32Array(n * 4), 4);
      gait.setUsage(DynamicDrawUsage);
      const pose = new InstancedBufferAttribute(new Float32Array(n * 4), 4);
      const col0 = new InstancedBufferAttribute(new Float32Array(n * 4), 4);
      const col1 = new InstancedBufferAttribute(new Float32Array(n * 4), 4);
      geo.setAttribute('aGait', gait);
      geo.setAttribute('aPose', pose);
      geo.setAttribute('aCol0', col0);
      geo.setAttribute('aCol1', col1);
      const mats = figureMaterials(v, this.uniforms);
      const mesh = new InstancedMesh(geo, mats.lit, n);
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.frustumCulled = false;
      // real shadows on HIGH, from the sun and the lamps, cast by the posed figure (the contact
      // blob stays under them either way)
      if (high) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.customDepthMaterial = mats.depth;
        mesh.customDistanceMaterial = mats.distance;
        // the streetlights' shadow-casting spots draw only this layer
        mesh.layers.enable(LAMP_CASTER_LAYER);
      }
      // the far cull is measured from whatever camera draws the figures (shadow passes do not call this)
      mesh.onBeforeRender = (_r, _s, camera) => {
        if ((camera as PerspectiveCamera).isPerspectiveCamera) this.uniforms.uEye.value.setFromMatrixPosition(camera.matrixWorld);
      };
      this.group.add(mesh);
      this.meshes.push(mesh);
      this.gaits.push(gait);
      this.disposables.push(geo, mats.lit, mats.depth, mats.distance, mesh);
      for (const b of this.bodies) {
        if (b.variant !== vi) continue;
        pose.setXYZW(b.slot, ...b.pose);
        col0.setXYZW(b.slot, b.colors[0], b.colors[1], b.colors[2], b.colors[3]);
        col1.setXYZW(b.slot, b.colors[4], b.colors[5], b.colors[6], 0);
      }
    });

    // contact shadows: a soft dark disc under every figure
    const flat = new PlaneGeometry(1, 1);
    flat.rotateX(-Math.PI / 2);
    const map = softShadowTexture();
    const shadowMat = new MeshBasicMaterial({
      map, color: '#000000', transparent: true, opacity: this.plan.look === 'night' ? 0.55 : 0.42, depthWrite: false,
    });
    this.shadows = new InstancedMesh(flat, shadowMat, Math.max(1, this.bodies.length));
    this.shadows.instanceMatrix.setUsage(DynamicDrawUsage);
    this.shadows.frustumCulled = false;
    this.shadows.renderOrder = -1;
    this.group.add(this.shadows);
    this.disposables.push(flat, map, shadowMat, this.shadows);

    // leashes: a slack line from the walker's hand to the dog's collar (a pixel wide: HIGH only)
    this.leashed = this.quality.tier === 'high' ? this.walkers.filter((w) => w.dog) : [];
    if (this.leashed.length) {
      const g = new BufferGeometry();
      const pos = new Float32Array(this.leashed.length * LEASH_SEGS * 2 * 3);
      g.setAttribute('position', new Float32BufferAttribute(pos, 3).setUsage(DynamicDrawUsage));
      const lm = new LineBasicMaterial({ color: '#26211d' });
      this.leash = new LineSegments(g, lm);
      this.leash.frustumCulled = false;
      this.group.add(this.leash);
      this.disposables.push(g, lm);
    }

    this.next = new Int32Array(this.bodies.length);
    this.ready = true;
    for (const b of this.bodies) this.write(b);
    this.flush(true);
  }

  // ---- who is out ----------------------------------------------------------------------------------

  private populate(manifest: Manifest): void {
    const plan = this.plan;
    const rand = mulberry32(plan.seed ?? 4471);
    const night = plan.look === 'night';
    const byId = new Map(this.variants.map((v, i) => [v.id, i]));
    const pick = <T,>(list: T[]): T => list[Math.floor(rand() * list.length)]!;
    const weighted = (w: Record<string, number>): string => {
      const ids = Object.keys(w).filter((id) => byId.has(id) && w[id]! > 0);
      let r = rand() * ids.reduce((a, id) => a + w[id]!, 0);
      for (const id of ids) {
        r -= w[id]!;
        if (r < 0) return id;
      }
      return ids[ids.length - 1]!;
    };
    const bit = (name: string): number => 1 << manifest.options.indexOf(name);
    const k = this.k;

    const dress = (id: string): Body => {
      const v = this.variants[byId.get(id)!]!;
      const has = (o: string): boolean => v.options.includes(o);
      let opts = 0;
      const maybe = (o: string, p: number): void => { if (has(o) && rand() < p) opts |= bit(o); };
      const woman = v.build === 'woman';
      if (woman || id === 'jogger' || id === 'child') {
        // one hair style on top of the base cut (or none)
        const r = rand();
        const style = id === 'jogger' ? (r < 0.45 ? 'ponytail' : '') : id === 'child' ? (r < 0.3 ? 'ponytail' : '')
          : r < 0.27 ? 'ponytail' : r < 0.42 ? 'bun' : r < 0.72 ? 'long' : '';
        if (style && has(style)) opts |= bit(style);
      }
      maybe('beard', 0.22);
      maybe('cap', id === 'jogger' ? 0.35 : id === 'child' ? 0.3 : 0.15);
      maybe('beanie', night ? 0.24 : 0.04);
      maybe('scarf', night ? 0.38 : 0.03);
      maybe('bag', night ? 0.3 : 0.18);
      maybe('backpack', id === 'child' ? 0.55 : night ? 0.14 : 0.12);
      // a hat squashes a bun, and nobody wears two hats or a bag and a backpack
      if (opts & bit('beanie')) opts &= ~bit('cap');
      if (opts & (bit('beanie') | bit('cap'))) opts &= ~bit('bun');
      if (opts & bit('backpack')) opts &= ~bit('bag');

      const skin = pick(SKIN);
      let hr = rand() * HAIR_W.reduce((a, b) => a + b, 0);
      let hair = HAIR[0]!;
      for (let i = 0; i < HAIR.length; i++) {
        hr -= HAIR_W[i]!;
        if (hr < 0) { hair = HAIR[i]!; break; }
      }
      const coat = v.id.endsWith('coat') || (night && v.id === 'man-jacket');
      const top = night
        ? (coat || rand() < 0.5 ? (rand() < 0.16 ? pick(COATS_BRIGHT) : pick(COATS)) : pick(TOPS_DAY))
        : pick(TOPS_DAY);
      let bottom = night ? pick(BOTTOMS_NIGHT) : pick(BOTTOMS_DAY);
      if (v.id === 'woman-dress') bottom = rand() < 0.4 ? top : pick(SKIRTS_DAY);
      if (id === 'jogger') bottom = pick(['#1c1d22', '#2b2d33', '#3a4f7a', '#24262b', '#5a5e66']);
      const shoes = night ? pick(SHOES_NIGHT) : pick(SHOES_DAY);
      const acc = night ? pick(ACC_NIGHT) : pick(ACC_DAY);
      let under = pick(UNDER_DAY);
      if (v.id === 'woman-dress') under = rand() < (night ? 0.25 : 0.65) ? skin : pick(TIGHTS);
      if (v.id === 'woman-coat') under = rand() < 0.75 ? pick(TIGHTS) : pick(['#3b5068', '#2f3e55']);
      const s = (0.95 + rand() * 0.1) * k;
      return {
        variant: byId.get(id)!, slot: 0, shadow: 0, moving: false, x: 0, z: 0, yaw: 0, vx: 0, vz: 0, scale: s, fade: 1,
        phase: rand(), amp: 0, jog: 0, seed: rand(), r: 0.082 * s * (v.build === 'child' ? 0.8 : 1),
        pose: [0, 0, 0, opts],
        colors: [packColor(skin), packColor(hair), packColor(top), packColor(bottom), packColor(shoes), packColor(acc),
          packColor(under)],
      };
    };
    const dogBody = (): Body => ({
      variant: byId.get('dog')!, slot: 0, shadow: 0, moving: true, x: 0, z: 0, yaw: 0, vx: 0, vz: 0,
      scale: (0.85 + rand() * 0.3) * k, fade: 1, phase: rand(), amp: 0, jog: 0, seed: rand(), r: 0.06 * k,
      pose: [0, 0, 0, 0],
      colors: [0, packColor(pick(DOG_COATS)), packColor(pick(DOG_COATS)), 0, 0, packColor(pick(COLLARS)), 0],
    });
    const strideOf = (b: Body, jog: boolean): number => {
      const v = this.variants[b.variant]!;
      const leg = v.legs[0]! + v.legs[1]!;
      return (jog ? (2 * JOG_REACH * leg) / JOG_STANCE : (2 * WALK_REACH * leg) / WALK_STANCE) * b.scale;
    };

    // walkers
    for (const walk of plan.walks) {
      const route = new Route(walk.points, walk.round ?? 0.6);
      // a companion or a dog needs a walkway wide enough to walk beside
      const roomy = walk.width > 0.75 * k;
      if (route.length < 0.5) continue;
      const [f0, f1] = walk.spread ?? [0, 1];
      for (let i = 0; i < walk.count; i++) {
        const jog = rand() < (walk.joggers ?? 0);
        const id = jog ? 'jogger' : weighted(MIX[plan.look]);
        const body = dress(id);
        body.moving = true;
        body.jog = jog ? 1 : 0;
        const withDog = roomy && !jog && byId.has('dog') && rand() < (walk.dogs ?? 0);
        const withMate = roomy && !jog && !withDog && rand() < (walk.pairs ?? 0);
        const dir: 1 | -1 = walk.dir ?? (rand() < 0.5 ? 1 : -1);
        const speed = (jog ? JOG[0]! + rand() * (JOG[1]! - JOG[0]!) : WALK[0]! + rand() * (WALK[1]! - WALK[0]!)) * METRE * k;
        const half = walk.width / 2;
        const w: Walker = {
          body, route, walk, dir,
          s: route.length * (f0 + (f1 - f0) * ((i + rand() * 0.7) / walk.count)),
          ul: 0, ulPref: 0, v: speed * 0.5, v0: speed, stride: strideOf(body, jog),
          state: 'walk', timer: 0, turnFrom: 0, lo: -body.r, hi: body.r, stuck: 0, squeeze: 0,
        };
        if (withMate) {
          // a companion on the left: a child beside a parent sometimes, else another adult
          const mateId = rand() < 0.3 && byId.has('child') ? 'child' : weighted(MIX[plan.look]);
          const mb = dress(mateId);
          mb.moving = true;
          const offset = 0.36 * k;
          w.mate = { body: mb, stride: strideOf(mb, false), offset };
          w.hi = offset + mb.r;
          // the pair walks at the slower one's pace
          w.v0 = Math.min(w.v0, (WALK[0]! + rand() * 0.15) * METRE * k);
          this.bodies.push(mb);
        }
        if (withDog) {
          const db = dogBody();
          const dv = this.variants[db.variant]!;
          w.dog = { body: db, stride: 2.6 * dv.legs[0]! * db.scale };
          w.lo = -(body.r + 0.24 * k);
          body.pose[2] = 1;
          this.bodies.push(db);
        } else if (!jog && !withMate && rand() < 0.07) {
          body.pose[2] = 2;   // walking along reading a phone
        }
        // keep right: the group's right edge a little in from the walkway's
        w.ulPref = Math.max(-half - w.lo, Math.min(half - w.hi, -half * 0.5 + (rand() - 0.5) * half * 0.25));
        w.ul = w.ulPref;
        this.bodies.push(body);
        this.walkers.push(w);
        this.place(w, 0);
      }
    }

    // people standing about; within a group, every other one talks while the rest listen
    const turns = new Map<number, number>();
    for (const st of plan.stands) {
      const body = dress(weighted(MIX[plan.look]));
      body.x = st.x;
      body.z = st.z;
      body.yaw = st.yaw;
      if (st.mood === 'chat') body.pose[1] = 0.7 + rand() * 0.3;
      if (st.mood === 'phone') body.pose[2] = 2;
      if (st.group !== undefined) {
        const n = turns.get(st.group) ?? 0;
        turns.set(st.group, n + 1);
        body.seed = (st.group * 0.618 + 0.5 * n) % 1;
      }
      this.bodies.push(body);
    }
  }

  // ---- each frame --------------------------------------------------------------------------------------

  update(time: number): void {
    if (!this.ready) return;
    this.uniforms.uTime.value = time;
    const dt = this.last < 0 ? 0.016 : Math.min(Math.max(time - this.last, 0), 0.1);
    this.last = time;
    if (!this.walkers.length) return;
    this.index();
    for (const w of this.walkers) this.step(w, dt, time);
    for (const b of this.bodies) if (b.moving) this.write(b);
    this.flush(false);
  }

  /** Everyone into the hash grid, by the cell they stand in. */
  private index(): void {
    this.head.fill(-1);
    const cell = 1.2 * this.k;
    this.bodies.forEach((b, i) => {
      const h = this.hash(Math.floor(b.x / cell), Math.floor(b.z / cell));
      this.next[i] = this.head[h]!;
      this.head[h] = i;
    });
  }

  private hash(ix: number, iz: number): number {
    return ((Math.imul(ix, 73856093) ^ Math.imul(iz, 19349663)) >>> 0) & (GRID - 1);
  }

  /** One walker's frame: wait, turn, or steer along its walkway; then its companion and dog follow. */
  private step(w: Walker, dt: number, time: number): void {
    const b = w.body;
    const k = this.k;
    const len = w.route.length;
    const x0 = b.x;
    const z0 = b.z;
    let target = 0;

    if (w.state === 'wait') {
      w.timer -= dt;
      w.v = 0;
      if (w.timer <= 0) {
        const atEnd = w.s <= 1e-3 || w.s >= len - 1e-3;
        if (atEnd && w.walk.ends === 'turn') {
          w.state = 'turn';
          w.timer = 1.1;
          w.turnFrom = b.yaw;
        } else w.state = 'walk';
      }
    } else if (w.state === 'turn') {
      // turning round on the spot, with a few small steps
      w.timer -= dt;
      const t = 1 - Math.max(w.timer, 0) / 1.1;
      b.yaw = w.turnFrom + Math.PI * (t * t * (3 - 2 * t));
      b.amp += (0.22 - b.amp) * Math.min(1, dt * 6);
      b.phase = (b.phase + dt * 1.6) % 1;
      if (w.timer <= 0) {
        w.dir = w.dir > 0 ? -1 : 1;
        w.ul = -w.ul;      // the same spot on the walkway, seen from the other way
        w.state = 'walk';
      }
    } else {
      // look ahead and choose a lateral position that is clear
      const pt = this.pt;
      w.route.at(w.s, pt);
      const hx = pt.tx * w.dir;
      const hz = pt.tz * w.dir;
      // the walker's left (heading +x has its left at -z)
      const lx = hz;
      const lz = -hx;
      const look = 1.1 * k + w.v * 0.9;
      const half = w.walk.width / 2;
      // a body may overhang the walkway's edge by half its radius (onto the kerb, the lawn)
      const slack = b.r * 0.5;
      const minU = Math.min(-half - w.lo - slack, 0);
      const maxU = Math.max(half - w.hi + slack, 0);
      // squeezing past: shoulders brush (see below)
      const shrink = w.squeeze > 0 ? 0.35 : 1;
      const cand = [w.ulPref, w.ul, w.ulPref + 0.14 * k, w.ulPref + 0.28 * k, w.ulPref + 0.42 * k,
        w.ulPref - 0.14 * k, w.ul + 0.14 * k, w.ul - 0.14 * k, minU, maxU];
      let best = w.ul;
      let bestScore = Infinity;
      let bestBlock = look;
      let bestAlong = 0;
      const cell = 1.2 * k;
      const cx = Math.floor(b.x / cell);
      const cz = Math.floor(b.z / cell);
      for (const c0 of cand) {
        const c = Math.min(Math.max(c0, minU), maxU);
        let block = look;
        let along = 0;
        for (let gx = cx - 2; gx <= cx + 2; gx++) {
          for (let gz = cz - 2; gz <= cz + 2; gz++) {
            for (let j = this.head[this.hash(gx, gz)]!; j >= 0; j = this.next[j]!) {
              const o = this.bodies[j]!;
              if (o === b || o === w.mate?.body || o === w.dog?.body) continue;
              const rx = o.x - b.x;
              const rz = o.z - b.z;
              const d = rx * hx + rz * hz;
              if (d < -0.05 * k || d > block) continue;
              const va = o.vx * hx + o.vz * hz;
              // someone ahead going our way at least as fast is no obstacle
              if (va >= w.v - 0.02 && d > 0.25 * k) continue;
              const e = w.ul + rx * lx + rz * lz;   // their lateral place on the walkway, in our frame
              if (c + w.lo * shrink < e + o.r * shrink && c + w.hi * shrink > e - o.r * shrink) {
                block = Math.max(d, 0);
                along = Math.max(va, 0);
              }
            }
          }
        }
        const score = Math.abs(c - w.ulPref) * 1.0 + Math.abs(c - w.ul) * 0.6 + (look - block) * 3.5;
        if (score < bestScore) {
          bestScore = score;
          best = c;
          bestBlock = block;
          bestAlong = along;
        }
      }
      w.ul += (best - w.ul) * Math.min(1, dt * 2.6);
      // slow behind whoever is in the way
      const gap = bestBlock - 0.28 * k;
      target = bestBlock < look ? Math.min(w.v0, Math.max(0, bestAlong + gap * 1.6)) : w.v0;
      // Held up with nowhere to go (head-on on a narrow pavement, a group across the way): after a
      // moment's patience squeeze past, shoulders brushing; if even that does not get through, turn back.
      w.squeeze = Math.max(0, w.squeeze - dt);
      if (target < 0.1 * w.v0) {
        w.stuck += dt;
        if (w.stuck > 1.6 + b.seed * 2) {
          if (w.squeeze > 0) {
            w.state = 'turn';
            w.timer = 1.1;
            w.turnFrom = b.yaw;
            w.squeeze = 0;
          } else w.squeeze = 2.5;
          w.stuck = 0;
        }
      } else w.stuck = Math.max(0, w.stuck - dt * 2);
      // a crossing: wait at its edge until it opens (that is not being held up)
      for (const g of w.walk.gates ?? []) {
        const edge = w.dir > 0 ? g.s0 : g.s1;
        const ahead = (edge - w.s) * w.dir;
        if (ahead > 0 && ahead < 0.35 * k + w.v * 0.4 && !g.open(time)) {
          target = Math.min(target, Math.max(0, (ahead - 0.05 * k) * 2));
          w.stuck = 0;
        }
      }
      const rate = target < w.v ? 5 : 1.6;
      w.v += (target - w.v) * Math.min(1, dt * rate);
      w.s += w.dir * w.v * dt;
      if (w.walk.ends === 'wrap') {
        if (w.s > len) w.s -= len;
        if (w.s < 0) w.s += len;
      } else if (w.s > len || w.s < 0) {
        w.s = Math.min(Math.max(w.s, 0), len);
        w.state = 'wait';
        const [p0, p1] = w.walk.pause ?? [1, 3];
        w.timer = p0 + this.rand() * (p1 - p0);
      }
    }

    this.place(w, dt);
    const moved = Math.hypot(b.x - x0, b.z - z0);
    b.vx = dt > 0 ? (b.x - x0) / dt : 0;
    b.vz = dt > 0 ? (b.z - z0) / dt : 0;
    if (moved > 2 * k) { b.vx = 0; b.vz = 0; }  // wrapped round
    // stride amount follows speed; the phase follows the distance walked, so feet stay put
    if (w.state !== 'turn') {
      const want = Math.min(w.v / w.v0, 1.1);
      b.amp += (want - b.amp) * Math.min(1, dt * 4);
      b.phase = (b.phase + w.v * dt / Math.max(b.amp * w.stride, 0.12 * w.stride)) % 1;
    }
    if (w.mate) {
      const m = w.mate.body;
      m.amp = b.amp;
      m.phase = (m.phase + (w.state === 'turn' ? dt * 1.6 : w.v * dt / Math.max(b.amp * w.mate.stride, 0.12 * w.mate.stride))) % 1;
      m.vx = b.vx;
      m.vz = b.vz;
    }
    if (w.dog) {
      const d = w.dog.body;
      // trot a little ahead, on the walker's right; chase that spot like a dog on a lead
      const c = Math.cos(b.yaw);
      const s = Math.sin(b.yaw);
      const tx = b.x + c * 0.34 * k + s * 0.2 * k;
      const tz = b.z - s * 0.34 * k + c * 0.2 * k;
      const ox = d.x;
      const oz = d.z;
      if (Math.hypot(tx - d.x, tz - d.z) > 1.5 * k) {
        d.x = tx;
        d.z = tz;
      } else {
        d.x += (tx - d.x) * Math.min(1, dt * 4);
        d.z += (tz - d.z) * Math.min(1, dt * 4);
      }
      const dv = Math.hypot(d.x - ox, d.z - oz);
      const sp = dt > 0 ? dv / dt : 0;
      if (sp > 0.05 * k && dv < k) d.yaw = Math.atan2(-(d.z - oz), d.x - ox);
      d.amp += (Math.min(sp / Math.max(w.v0, 1e-3), 1) - d.amp) * Math.min(1, dt * 4);
      if (dv < k) d.phase = (d.phase + dv / Math.max(d.amp * w.dog.stride, 0.15 * w.dog.stride)) % 1;
      d.vx = dt > 0 && dv < k ? (d.x - ox) / dt : 0;
      d.vz = dt > 0 && dv < k ? (d.z - oz) / dt : 0;
      d.fade = b.fade;
    }
  }

  /** Puts a walker (and its companion) on its walkway: position, heading, fade at a wrapping end. */
  private place(w: Walker, dt: number): void {
    const b = w.body;
    const pt = this.pt;
    w.route.at(w.s, pt);
    const lx = pt.tz * w.dir;
    const lz = -pt.tx * w.dir;
    b.x = pt.x + lx * w.ul;
    b.z = pt.z + lz * w.ul;
    if (w.state === 'walk') {
      // face along the walkway, turned a touch toward wherever the walker is drifting
      const yaw = Math.atan2(-pt.tz * w.dir, pt.tx * w.dir);
      b.yaw = dt > 0 ? b.yaw + wrapAngle(yaw - b.yaw) * Math.min(1, dt * 8) : yaw;
    }
    b.fade = 1;
    if (w.walk.ends === 'wrap') {
      const len = w.route.length;
      const f = Math.min(w.s / FADE, (len - w.s) / FADE, 1);
      b.fade = Math.max(f, 0.001);
    }
    if (w.mate) {
      const m = w.mate.body;
      m.x = b.x + lx * w.mate.offset;
      m.z = b.z + lz * w.mate.offset;
      m.yaw = b.yaw;
      m.fade = b.fade;
    }
  }

  /** Writes one figure's matrix and gait (and its shadow's matrix). */
  private write(b: Body): void {
    const mesh = this.meshes[b.variant];
    if (!mesh) return;
    const s = b.scale * b.fade;
    this.q.setFromAxisAngle(this.Y, b.yaw);
    mesh.setMatrixAt(b.slot, this.m4.compose(this.p.set(b.x, 0, b.z), this.q, this.sc.set(s, s, s)));
    this.gaits[b.variant]?.setXYZW(b.slot, b.phase, b.amp, b.jog, b.seed);
    const dog = this.variants[b.variant]!.kind === 'dog';
    const r = (dog ? 0.32 : 0.36) * s;
    this.shadows?.setMatrixAt(b.shadow, this.m4.compose(this.p.set(b.x, 0.018, b.z), this.q,
      this.sc.set(dog ? r * 1.7 : r * 1.1, 1, r)));
  }

  private flush(all: boolean): void {
    this.meshes.forEach((m, vi) => {
      if (!m) return;
      const gait = this.gaits[vi];
      if (!gait) return;
      const n = all ? m.count : this.moving[vi]!;
      if (!n) return;
      m.instanceMatrix.clearUpdateRanges();
      m.instanceMatrix.addUpdateRange(0, n * 16);
      m.instanceMatrix.needsUpdate = true;
      gait.clearUpdateRanges();
      gait.addUpdateRange(0, n * 4);
      gait.needsUpdate = true;
    });
    if (this.shadows) {
      const n = all ? this.bodies.length : this.shadowMoving;
      this.shadows.instanceMatrix.clearUpdateRanges();
      this.shadows.instanceMatrix.addUpdateRange(0, n * 16);
      this.shadows.instanceMatrix.needsUpdate = true;
    }
    this.drawLeashes();
  }

  /** The leashes: from the right hand (held out in front, see the shader's leash pose) to the collar, sagging. */
  private drawLeashes(): void {
    if (!this.leash) return;
    const attr = this.leash.geometry.attributes.position as Float32BufferAttribute;
    const arr = attr.array as Float32Array;
    this.leashed.forEach((w, i) => {
      const b = w.body;
      const d = w.dog!.body;
      const v = this.variants[b.variant]!;
      this.handPoint(v, this.handL);
      const s = b.scale * b.fade;
      const c = Math.cos(b.yaw);
      const sn = Math.sin(b.yaw);
      // model frame to the group: turn by yaw about y (x' = c x + s z, z' = -s x + c z), scale, move
      const hx = b.x + (c * this.handL.x + sn * this.handL.z) * s;
      const hy = this.handL.y * s;
      const hz = b.z + (-sn * this.handL.x + c * this.handL.z) * s;
      const dv = this.variants[d.variant]!;
      this.collar.set(dv.hand[0]!, dv.hand[1]!, dv.hand[2]!);
      const ds = d.scale * d.fade;
      const dc = Math.cos(d.yaw);
      const dsn = Math.sin(d.yaw);
      const cx = d.x + (dc * this.collar.x + dsn * this.collar.z) * ds;
      const cy = this.collar.y * ds;
      const cz = d.z + (-dsn * this.collar.x + dc * this.collar.z) * ds;
      const sag = 0.06 * this.k;
      let o = i * LEASH_SEGS * 6;
      for (let k = 0; k < LEASH_SEGS; k++) {
        for (const t of [k / LEASH_SEGS, (k + 1) / LEASH_SEGS]) {
          arr[o++] = hx + (cx - hx) * t;
          arr[o++] = hy + (cy - hy) * t - sag * 4 * t * (1 - t);
          arr[o++] = hz + (cz - hz) * t;
        }
      }
    });
    attr.needsUpdate = true;
  }

  /** The right palm in the leash pose, in the walker's model frame: the shader's arm chain, on the CPU. */
  private handPoint(v: Variant, out: Vector3): void {
    const [ex, ey] = v.pivots[6]!;
    const [sx, sy, sz] = v.pivots[5]!;
    out.set(v.hand[0]!, v.hand[1]!, v.hand[2]!);
    // forearm: elbow 0.6 about z
    rotZ(out, ex!, ey!, 0.6);
    // upper arm: out by -0.13 about x, swing 0.42 about z, at the shoulder
    out.x -= sx!;
    out.y -= sy!;
    out.z -= sz!;
    const ca = Math.cos(-0.13);
    const sa = Math.sin(-0.13);
    const y = ca * out.y - sa * out.z;
    out.z = sa * out.y + ca * out.z;
    out.y = y;
    rotZ(out, 0, 0, 0.42);
    out.x += sx!;
    out.y += sy!;
    out.z += sz!;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}

const LEASH_SEGS = 6;

function wrapAngle(a: number): number {
  return a - Math.PI * 2 * Math.round(a / (Math.PI * 2));
}

/** rotate `p` about the z axis through (px, py) */
function rotZ(p: Vector3, px: number, py: number, a: number): void {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const x = p.x - px;
  const y = p.y - py;
  p.x = px + c * x - s * y;
  p.y = py + s * x + c * y;
}
