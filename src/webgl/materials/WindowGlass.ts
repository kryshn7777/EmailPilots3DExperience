import { MeshStandardMaterial } from 'three';
import type { BufferGeometry, Texture, WebGLProgramParametersWithUniforms } from 'three';

/**
 * Shared by every window material: how much daylight reaches the rooms (0 at night, 1 at noon)
 * and how brightly the lamps in the lit rooms burn. The Engine sets both from the chapter grade.
 */
export const windowLight = { day: { value: 0.5 }, lamp: { value: 1 } };

/**
 * The hero buildings export their panes as a second mesh, `glass` (blender/bld/model.py
 * `glass_object`), with three UV sets: where the pane sits in its window (0..1), the room code
 * plus a random fraction (see PANE_CODES there), and the window's size in metres. The loader
 * hands them over as uv/uv1/uv2; they are renamed so no built-in map define ever declares them a
 * second time.
 */
export function adoptGlassAttributes(geometry: BufferGeometry): void {
  for (const [from, to] of [['uv', 'aPaneUv'], ['uv1', 'aPane'], ['uv2', 'aPaneSize']] as const) {
    const a = geometry.getAttribute(from);
    if (!a) continue;
    geometry.setAttribute(to, a);
    geometry.deleteAttribute(from);
  }
}

const VERT_HEAD = /* glsl */ `
attribute vec2 aPaneUv;
attribute vec2 aPane;
attribute vec2 aPaneSize;
varying vec2 vPaneUv;
varying vec2 vPane;
varying vec2 vPaneSize;
varying vec3 vGlassPos;
varying vec3 vGlassN;
`;

const VERT_BODY = /* glsl */ `
vPaneUv = aPaneUv;
vPane = aPane;
vPaneSize = aPaneSize;
{
  vec4 gp = vec4(transformed, 1.0);
  mat3 gm = mat3(modelMatrix);
  #ifdef USE_INSTANCING
    gp = instanceMatrix * gp;
    gm = gm * mat3(instanceMatrix);
  #endif
  vGlassPos = (modelMatrix * gp).xyz;
  vGlassN = normalize(gm * objectNormal);
}
`;

const FRAG_HEAD = /* glsl */ `
uniform float uDay;
uniform float uLamp;
uniform float uOffice;
varying vec2 vPaneUv;
varying vec2 vPane;
varying vec2 vPaneSize;
varying vec3 vGlassPos;
varying vec3 vGlassN;

float paneHash(float n) { return fract(sin(n * 91.3458) * 47453.5453); }

vec3 wallTone(float s) {
  float k = floor(s * 7.0);
  if (k < 1.0) return vec3(0.80, 0.74, 0.62);
  if (k < 2.0) return vec3(0.86, 0.85, 0.81);
  if (k < 3.0) return vec3(0.62, 0.68, 0.57);
  if (k < 4.0) return vec3(0.60, 0.67, 0.75);
  if (k < 5.0) return vec3(0.78, 0.60, 0.48);
  if (k < 6.0) return vec3(0.83, 0.78, 0.70);
  return vec3(0.70, 0.66, 0.70);
}

vec3 fabricTone(float s) {
  float k = floor(s * 6.0);
  if (k < 1.0) return vec3(0.42, 0.13, 0.11);
  if (k < 2.0) return vec3(0.16, 0.24, 0.38);
  if (k < 3.0) return vec3(0.55, 0.50, 0.40);
  if (k < 4.0) return vec3(0.22, 0.32, 0.22);
  if (k < 5.0) return vec3(0.75, 0.72, 0.66);
  return vec3(0.45, 0.30, 0.18);
}

/**
 * The room behind a pane, by interior mapping: the view ray enters at the glass and is traced to
 * the walls, floor and ceiling of a box behind it, so a window shows a room with real depth that
 * slides with parallax as the camera passes, instead of a flat tint. Homes get living rooms
 * (papered walls, a sofa, a picture, a rug, curtains at the sides); towers (uOffice) get open-plan
 * floors under a grid of ceiling panels. Lit rooms burn with a lamp; dark ones take a little of the
 * daylight through their own window. Returns the radiance leaving the room toward the camera.
 */
vec3 interiorRoom(vec3 N, vec3 V) {
  float code = floor(vPane.x);
  float seed = fract(vPane.x);
  // the glTF exporter flips v: back to 0 at the bottom of the window
  vec2 uv = vec2(vPaneUv.x, 1.0 - vPaneUv.y);
  vec2 size = max(vec2(vPaneSize.x, 1.0 - vPaneSize.y), vec2(0.3));

  // the window's frame: x along the wall the way the window's u runs, y up, z into the room
  vec3 T = normalize(cross(vec3(0.0, 1.0, 0.0), N));
  vec3 dp1 = dFdx(vGlassPos), dp2 = dFdy(vGlassPos);
  if (dot(dp1, T) * dFdx(uv.x) + dot(dp2, T) * dFdy(uv.x) < 0.0) T = -T;
  vec3 B = cross(T, N);
  if (B.y < 0.0) B = -B;
  vec3 d = vec3(dot(V, T), dot(V, B), -dot(V, N));
  d.x = abs(d.x) < 1e-4 ? 1e-4 : d.x;
  d.y = abs(d.y) < 1e-4 ? 1e-4 : d.y;
  d.z = max(d.z, 0.04);

  float office = uOffice;
  vec3 p = vec3((uv.x - 0.5) * size.x, uv.y * size.y, 0.0);
  float floorY = -clamp(2.0 - size.y, 0.1, 0.95);
  float ceilY = max(size.y + 0.25, floorY + mix(2.6, 3.0, office));
  float rw = max(size.x + 1.2, mix(3.2, 7.0, office) + seed * 2.0);
  float off = (paneHash(seed * 13.0) - 0.5) * (rw - size.x) * 0.8;
  float x0 = off - rw * 0.5;
  float x1 = off + rw * 0.5;
  float depth = mix(3.0, 6.5, office) + paneHash(seed * 7.0) * 2.5;

  float tx = ((d.x > 0.0 ? x1 : x0) - p.x) / d.x;
  float ty = ((d.y > 0.0 ? ceilY : floorY) - p.y) / d.y;
  float tz = depth / d.z;
  float t = min(tx, min(ty, tz));
  vec3 h = p + d * t;

  vec3 wall = mix(wallTone(seed), vec3(0.78, 0.79, 0.80), office);
  vec3 albedo = wall;
  vec3 nrm = vec3(0.0, 0.0, -1.0);
  float glow = 0.0;           // what glows on its own (a lamp shade, ceiling panels, screens)
  bool ceiling = false;
  if (t == tz) {
    // back wall: a sofa (or a row of desks) along it, a picture over it
    float fy = h.y - floorY;
    if (office > 0.5) {
      if (fy < 0.75 && fract(h.x * 0.45 + seed) < 0.62) albedo = vec3(0.28, 0.27, 0.26);
      if (fy > 0.78 && fy < 1.15 && fract(h.x * 0.45 + seed) < 0.3) { albedo = vec3(0.06, 0.08, 0.1); glow = 0.35; }
    } else {
      if (fy < 0.85 && abs(h.x - off) < 1.05) albedo = fabricTone(paneHash(seed * 5.3)) * (fy > 0.45 ? 1.0 : 0.8);
      vec2 pic = vec2(h.x - off - 0.2, fy - 1.6);
      if (abs(pic.x) < 0.42 && abs(pic.y) < 0.3) {
        albedo = (abs(pic.x) < 0.36 && abs(pic.y) < 0.24) ? fabricTone(paneHash(seed * 9.1)) * 1.2 : vec3(0.12, 0.1, 0.08);
      }
    }
  } else if (t == tx) {
    nrm = vec3(-sign(d.x), 0.0, 0.0);
    // a doorway into the next room, dark
    if (abs(h.z - depth * 0.62) < 0.45 && h.y - floorY < 2.05 && office < 0.5) albedo = wall * 0.18;
    // a bookcase or a tall cupboard against the other side wall
    if (d.x < 0.0 && h.z > depth * 0.25 && h.z < depth * 0.45 && h.y - floorY < 1.9 && office < 0.5)
      albedo = vec3(0.30, 0.21, 0.14) * (0.75 + 0.25 * step(0.5, fract((h.y - floorY) * 2.6)));
  } else if (d.y > 0.0) {
    ceiling = true;
    nrm = vec3(0.0, -1.0, 0.0);
    albedo = vec3(0.86, 0.86, 0.84);
    if (office > 0.5) {
      float panel = step(0.62, fract(h.x * 0.42 + 0.3)) * step(0.55, fract(h.z * 0.5 + 0.2));
      glow = panel * 1.4;
    }
  } else {
    nrm = vec3(0.0, 1.0, 0.0);
    // floorboards, a rug in the middle; carpet tiles in an office
    float plank = 0.82 + 0.18 * step(0.06, fract(h.x * 5.0 + floor(h.z * 0.8) * 0.37));
    albedo = mix(vec3(0.36, 0.25, 0.16) * plank, vec3(0.30, 0.31, 0.34), office);
    if (office < 0.5 && abs(h.x - off) < 1.2 && h.z > depth * 0.3 && h.z < depth * 0.78)
      albedo = fabricTone(paneHash(seed * 2.7)) * 0.9;
  }

  float lit = code < 1.5 ? 0.0 : ((code > 2.5 && code < 3.5) || code > 5.5 ? 0.55 : 1.0);
  vec3 lampCol = code > 4.5 ? vec3(0.72, 0.84, 1.0) : (code > 3.5 ? vec3(1.0, 0.9, 0.74) : vec3(1.0, 0.7, 0.4));
  vec3 lampPos = vec3(off, ceilY - 0.35, depth * 0.5);
  vec3 L = lampPos - h;
  float lambert = clamp(dot(nrm, normalize(L)), 0.0, 1.0) * 0.65 + 0.35;
  float lampK = lit * uLamp;
  vec3 lamp = lampCol * lampK * (mix(3.0, 1.6, office) / (1.0 + 0.32 * dot(L, L))) * lambert;
  if (office > 0.5) lamp += lampCol * lampK * 0.35;
  // daylight through this window: bright by the glass, falling off into the room
  vec3 sky = vec3(0.55, 0.60, 0.68) * uDay * (0.12 + 0.3 * exp(-h.z * 0.45));
  vec3 rad = albedo * (lamp + sky + 0.004);
  rad += lampCol * glow * (office > 0.5 ? lampK : 1.0) * 0.9;
  if (ceiling && office < 0.5) rad += lampCol * lampK * 1.6 * smoothstep(0.32, 0.0, length(h.xz - lampPos.xz));

  // curtains drawn back to the sides (a sheer across some), blinds where the pane says so
  vec3 through = sky * 1.5 + lampCol * lampK * 0.9;
  if (code > 0.5 && code < 1.5) {
    // slats, filtered by their own screen footprint so a far window reads as a lit blind, not noise
    float sy = uv.y * size.y * 9.0;
    float fw = fwidth(sy);
    float slat = mix(smoothstep(0.2 - fw, 0.2 + fw, fract(sy)), 0.8, smoothstep(0.25, 0.7, fw));
    rad = vec3(0.80, 0.76, 0.68) * (0.55 + 0.45 * slat) * (through + 0.01);
  } else if (office < 0.5) {
    float cs = paneHash(seed * 3.1);
    if (cs < 0.75) {
      float cw = 0.1 + 0.16 * paneHash(seed * 5.7);
      float side = step(uv.x, cw) + step(1.0 - cw, uv.x);
      float fold = 0.78 + 0.22 * sin(uv.x * size.x * 42.0);
      vec3 cc = fabricTone(paneHash(seed * 8.3));
      if (side > 0.0) rad = cc * fold * through;
      else if (cs < 0.22) rad = mix(rad, vec3(0.85, 0.83, 0.78) * through, 0.45);
    }
  }
  // the glass's own green-grey tint
  return rad * vec3(0.86, 0.90, 0.91);
}
`;

/**
 * Window glass for the close-up buildings: a near-black, near-mirror physical surface (the PBR
 * Fresnel gives the sky and the sun on it, weak face-on and strong at a grazing angle) with the
 * room behind it added as light passing through: what the glass does not reflect, it transmits.
 * `office` switches the rooms to open-plan floors (the night city's towers).
 */
export function windowGlassMaterial(envMap: Texture | null, office: boolean): MeshStandardMaterial {
  const mat = new MeshStandardMaterial({ color: '#06080a', roughness: 0.035, metalness: 0, envMapIntensity: 1 });
  if (envMap) mat.envMap = envMap;
  mat.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    shader.uniforms.uDay = windowLight.day;
    shader.uniforms.uLamp = windowLight.lamp;
    shader.uniforms.uOffice = { value: office ? 1 : 0 };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_HEAD}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${VERT_BODY}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_HEAD}`)
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          vec3 gN = normalize(vGlassN);
          vec3 gV = normalize(vGlassPos - cameraPosition);
          float cosT = clamp(dot(gN, -gV), 0.0, 1.0);
          float fres = 0.04 + 0.96 * pow(1.0 - cosT, 5.0);
          totalEmissiveRadiance += interiorRoom(gN, gV) * (1.0 - fres);
        }`,
      );
  };
  mat.customProgramCacheKey = () => `window-glass-${office ? 'office' : 'home'}`;
  return mat;
}
