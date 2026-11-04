/**
 * Noise, crack and parallax helpers for the city's shaders (Streets.ts, Facades.ts). The town keeps its
 * own copies in Lawns.ts (`g*`) and Roofs.ts (`r*`); these are the same ideas under `n*` names so they
 * can sit in a program of their own. Lengths are metres.
 */
export const NOISE = /* glsl */ `
float nHash(vec2 p) { p = fract(p * vec2(127.13, 311.71)); p += dot(p, p + 34.53); return fract(p.x * p.y); }
float nNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(nHash(i), nHash(i + vec2(1.0, 0.0)), f.x), mix(nHash(i + vec2(0.0, 1.0)), nHash(i + 1.0), f.x), f.y);
}
const mat2 nRot = mat2(1.6, 1.2, -1.2, 1.6);
float nFbm(vec2 p) { return nNoise(p) * 0.55 + nNoise(nRot * p + 5.3) * 0.3 + nNoise(nRot * nRot * p * 1.075 + 1.7) * 0.15; }
/** crack network: contour lines of two noise fields, thick in worn zones. 0 on sound ground, 1 at the groove */
float nCrack(vec2 pm) {
  vec2 p = pm / 3.0;
  float zone = smoothstep(0.42, 0.72, nNoise(p * 0.11 + 9.0));
  float n = nNoise(p * 0.85) * 0.62 + nNoise(nRot * p * 0.85 + 3.7) * 0.38;
  float line = 1.0 - smoothstep(0.0, 0.03, abs(n - 0.5));
  float fine = 1.0 - smoothstep(0.0, 0.02, abs(nNoise(p * 3.1 + 2.0) * 0.7 + nNoise(nRot * p * 3.1) * 0.3 - 0.5));
  return clamp(line * (0.3 + 0.7 * zone) + fine * zone * 0.85, 0.0, 1.0);
}
/**
 * Parallax: how far (in uv units, uv in metres) the texel seen through a surface moves per metre of depth
 * below it, along the view ray. The frame comes from screen-space derivatives of position and uv, so it
 * needs no tangents and works on instanced, rotated modules.
 */
vec2 nParaDir(vec2 uv, vec3 Nv) {
  vec3 pos = -vViewPosition;
  vec3 dp1 = dFdx(pos), dp2 = dFdy(pos);
  vec2 duv1 = dFdx(uv), duv2 = dFdy(uv);
  vec3 dp2perp = cross(dp2, Nv), dp1perp = cross(Nv, dp1);
  vec3 T = dp2perp * duv1.x + dp1perp * duv2.x;
  vec3 B = dp2perp * duv1.y + dp1perp * duv2.y;
  float tt = dot(T, T), bb = dot(B, B);
  if (tt < 1e-18 || bb < 1e-18) return vec2(0.0);
  vec3 V = normalize(vViewPosition);
  float vn = max(dot(V, Nv), 0.2);
  return -vec2(dot(V, T) * inversesqrt(tt), dot(V, B) * inversesqrt(bb)) / vn;
}
`;

/** the city's scale: a person stands 0.76 units tall (1.75 m) */
export const METRES_PER_UNIT = 2.3;
