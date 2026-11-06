import type { WebGLProgramParametersWithUniforms } from 'three';
import { Vector3, Vector4 } from 'three';

/**
 * What the wet canyon road mirrors, and how. Three layers, all cheap enough for phones:
 *
 * 1. The environment: a cube of the lit canyon (HIGH: the Engine's live probe at the camera; LOW: one cube
 *    rendered once when the city first shows, 128 px), prefiltered by three for roughness (PMREM) and looked
 *    up box-projected (`envBoxGlsl`): the reflection ray is run out to the canyon's walls and roof line and
 *    the cube is read toward that point from where the cube was taken, so the reflected towers, windows and
 *    signs stand where they should in the street, not slide with the viewer as a plain cube lookup does.
 * 2. Mirror glows (`mirrorGlsl`): the bright things the wet street is known for - neon signs, lamp heads and
 *    the cars' head and tail lights - are analytic. Each is a small ellipse in space, found along the
 *    reflected ray: sharp in a puddle, smeared into the long streak toward the viewer on rougher, damp
 *    asphalt. Exact wherever the camera is, and alive (the cars move, the brake lights flare).
 * 3. HIGH keeps the screen-space trace (post/SSR.ts) on top, for what neither knows about.
 *
 * City.ts fills the fields: the signs once, the cars every frame (no allocation), the probe's centre as it moves.
 */
export const MAX_NEON = 10;
export const MAX_CARS = 6;

export const roadReflect = {
  /** each sign: x, y, z (city group), half width; colour rgb * strength, half height */
  neonA: { value: Array.from({ length: MAX_NEON }, () => new Vector4(1e5, -10, 1e5, 0)) },
  neonB: { value: Array.from({ length: MAX_NEON }, () => new Vector4(0, 0, 0, 0)) },
  /** the nearest moving cars: x, z, signed half length (+ heads toward +x), brake 0..1 */
  cars: { value: Array.from({ length: MAX_CARS }, () => new Vector4(1e5, 1e5, 1, 0)) },
  /** where the cube was taken (world) */
  probe: { value: new Vector3(0, 1.4, 0) },
  /** the canyon as a box: centre-line z (world), half width to the facades, roof line, half length along x */
  box: { value: new Vector4(1, 3.2, 14, 40) },
  /** strength of the analytic glows (chapter grade can damp it) and a clock for the ripples */
  glow: { value: 1 },
  time: { value: 0 },
};

/**
 * Box-projected environment lookup for MeshStandardMaterial. Needs `vSW` (position in the city group) and
 * `uSOrigin` (the group's position) declared in the fragment shader, as Streets.ts and RoadDecals.ts do.
 */
export function envBoxGlsl(shader: WebGLProgramParametersWithUniforms): void {
  shader.uniforms.uEnvProbe = roadReflect.probe;
  shader.uniforms.uEnvBox = roadReflect.box;
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <envmap_common_pars_fragment>', /* glsl */ `#include <envmap_common_pars_fragment>
      uniform vec3 uEnvProbe;
      uniform vec4 uEnvBox;
      vec3 envBoxDir(vec3 R) {
        vec3 P = vSW + uSOrigin;
        vec3 lo = vec3(P.x - uEnvBox.w, -0.5, uEnvBox.x - uEnvBox.y);
        vec3 hi = vec3(P.x + uEnvBox.w, uEnvBox.z, uEnvBox.x + uEnvBox.y);
        vec3 a = (lo - P) / R, b = (hi - P) / R;
        vec3 f = max(a, b);
        float t = min(min(f.x, f.y), f.z);
        return normalize(P + R * max(t, 0.0) - uEnvProbe);
      }`)
    .replace(
      'reflectVec = transformDirectionByInverseViewMatrix( reflectVec, viewMatrix );',
      'reflectVec = transformDirectionByInverseViewMatrix( reflectVec, viewMatrix );\nreflectVec = envBoxDir(reflectVec);',
    );
}

/**
 * The analytic glows, as GLSL: `roadMirror(P, R, rough)` returns the radiance seen along the reflected ray R
 * from P (both in the city group's frame). `lamps` adds the streetlamp heads (from lampField's uniforms,
 * which the caller declares).
 */
export function mirrorGlsl(shader: WebGLProgramParametersWithUniforms, lamps: boolean): string {
  shader.uniforms.uNeonA = roadReflect.neonA;
  shader.uniforms.uNeonB = roadReflect.neonB;
  shader.uniforms.uCars = roadReflect.cars;
  shader.uniforms.uGlowK = roadReflect.glow;
  return /* glsl */ `
    uniform vec4 uNeonA[${MAX_NEON}];
    uniform vec4 uNeonB[${MAX_NEON}];
    uniform vec4 uCars[${MAX_CARS}];
    uniform float uGlowK;
    /** a glowing ellipse at S (half size hs: across, up) seen in the mirror ray P + R t */
    float mGlow(vec3 P, vec3 R, vec3 S, vec2 hs, float rough) {
      vec3 D = S - P;
      float t = dot(D, R);
      if (t <= 0.0) return 0.0;
      vec3 o = D - R * t;
      vec3 hd = normalize(vec3(-R.z, 0.0, R.x) + 1e-5);
      float ox = dot(o, hd);
      float oy = length(o - hd * ox);
      float bx = hs.x + t * (0.004 + rough * 0.05);
      float by = hs.y + t * (0.01 + rough * 0.45);
      float e = ox * ox / (bx * bx) + oy * oy / (by * by);
      return e > 9.0 ? 0.0 : exp(-e) * (hs.x * hs.y) / (bx * by);
    }
    vec3 roadMirror(vec3 P, vec3 R, float rough) {
      vec3 sum = vec3(0.0);
      if (R.y < 0.005) return sum;
      for (int i = 0; i < ${MAX_NEON}; i++) {
        vec4 a = uNeonA[i];
        if (abs(a.x - P.x) > 30.0) continue;
        sum += uNeonB[i].rgb * mGlow(P, R, a.xyz, vec2(a.w, uNeonB[i].w), rough);
      }
      for (int i = 0; i < ${MAX_CARS}; i++) {
        vec4 c = uCars[i];
        if (abs(c.x - P.x) > 30.0) continue;
        // c.z is the signed half length: the heads at the +c.z end, facing that way
        vec3 head = vec3(c.x + c.z, 0.3, c.y);
        vec3 tail = vec3(c.x - c.z, 0.36, c.y);
        // a lamp shows in the mirror only to a ray that runs toward its face
        float toHead = smoothstep(0.0, 0.35, -R.x * sign(c.z));
        float toTail = smoothstep(0.0, 0.35, R.x * sign(c.z));
        sum += vec3(1.0, 0.86, 0.62) * 2.4 * toHead * mGlow(P, R, head, vec2(0.34, 0.05), rough);
        sum += vec3(1.0, 0.1, 0.05) * (0.7 + 1.3 * c.w) * toTail * mGlow(P, R, tail, vec2(0.3, 0.04), rough);
      }
      ${lamps ? /* glsl */ `
      {
        float col = floor((P.x - uLampInfo.x) / uLampInfo.y);
        for (int ci = -1; ci <= 2; ci++) {
          float cc = col + float(ci);
          if (cc < 0.0 || cc >= uLampInfo.z) continue;
          for (int sd = 0; sd < 2; sd++) {
            vec2 hp = uLamps[int(cc) * 2 + sd];
            sum += vec3(1.0, 0.74, 0.44) * 3.2 * uLampLevel * mGlow(P, R, vec3(hp.x, uLampInfo.w, hp.y), vec2(0.12, 0.05), rough);
          }
        }
      }` : ''}
      return sum * uGlowK;
    }`;
}
