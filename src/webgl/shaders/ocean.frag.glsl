// The night sea.
//
//  - waves: the vertex swell (ocean.vert) plus four scales of mipmapped normal map, each turned and
//    drifting its own way, plus rain ripples that spread from drops landing on the surface
//  - reflection: the picture of the lighthouse, ship, beam and sky drawn from a camera mirrored through
//    the water (materials/PlanarReflection.ts), looked up through the wave normals and a little blurred
//    by how rough the surface is; a plain sky gradient stands in where no mirror is drawn
//  - light: GGX highlights for the moon and for the lamp, with the roughness taken from how much the
//    filtered normal maps have averaged out, so glitter softens with distance instead of crawling
//  - body: a dark teal that brightens where thin crests are lit through, turns to green shallows round
//    the islet, and takes the lamp's sweep as it passes
//  - foam: only where the surface folds, in lace and in wind-drawn streaks, lit like a solid
uniform float uTime;
uniform sampler2D uNormalMap;
uniform sampler2D uFoamMap;
uniform sampler2D uReflection;
uniform mat4 uReflMatrix;
uniform float uReflect;     // 1 while a planar reflection is being drawn
uniform float uPlaneY;      // world height of the mirror
uniform float uRain;        // 0 dry .. 1 downpour

uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uFoam;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uMoonDir;
uniform vec3 uMoonColor;
uniform float uFlash;

uniform vec3 uLantern;      // world position of the lamp
uniform vec2 uBeamDir;      // world xz bearing of the beam
uniform vec3 uBeamColor;
uniform float uBeamPower;   // 0 when the lamp is out

uniform vec2 uTowerXZ;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform vec4 uFogHeight;
uniform vec3 uCamPos;
uniform float uReveal;

varying vec3 vWorldPos;
varying vec3 vNormal;
varying float vHeight;
varying float vFold;

const float PI = 3.14159265;

vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

// a normal map layer as a slope, so layers add rather than blend. .z is how far mipmapping has
// averaged the normal short of unit length: the roughness the map can no longer show
vec3 layer(vec2 uv) {
  vec3 d = texture2D(uNormalMap, uv).rgb * 2.0 - 1.0;
  vec3 n = vec3(d.r, d.b, d.g); // stored as (x, z, y)
  float len = max(length(n), 0.35);
  return vec3(-n.xz / max(n.y, 0.2), (1.0 - len) / len);
}

// rings spreading from drops: one drop per cell, each ring its own age, returned as a slope
vec2 ripples(vec2 xz, float cell, float seed) {
  vec2 g = xz / cell;
  vec2 id = floor(g);
  vec2 f = fract(g) - 0.5;
  vec2 h = hash22(id + seed);
  vec2 d = f - (h - 0.5) * 0.4;
  float age = fract(uTime * (0.6 + 0.5 * h.x) + h.y);
  float r = length(d) / 0.5;
  float front = r - age * 0.95;
  float env = exp(-front * front * 60.0) * (1.0 - age) * smoothstep(0.0, 0.06, age) * step(r, 1.0);
  return normalize(d + 1e-4) * cos(front * 38.0) * env;
}

float ggx(float ndh, float a2) {
  float d = ndh * ndh * (a2 - 1.0) + 1.0;
  return a2 / (PI * d * d);
}

void main() {
  vec3 P = vWorldPos;
  vec3 V = normalize(uCamPos - P);
  float dist = distance(uCamPos, P);

  // — wave detail: four scales of the same spectrum, turned and drifting different ways
  vec2 xz = P.xz;
  float flow = uTime * 1.9; // the detail maps and the foam drift on the wall clock, briskly enough to read
  vec2 uvA = xz / 64.0 + vec2(0.012, 0.007) * flow;
  vec2 uvB = mat2(0.80, 0.60, -0.60, 0.80) * xz / 17.9 + vec2(-0.021, 0.015) * flow;
  vec2 uvC = mat2(0.45, -0.89, 0.89, 0.45) * xz / 4.7 + vec2(0.05, -0.03) * flow;
  vec2 uvD = mat2(0.28, 0.96, -0.96, 0.28) * xz / 1.55 + vec2(-0.09, 0.06) * flow;
  float fineFade = 1.0 - smoothstep(30.0, 140.0, dist);
  float ultraFade = 1.0 - smoothstep(10.0, 55.0, dist);
  vec3 la = layer(uvA);
  vec3 lb = layer(uvB);
  vec3 lc = layer(uvC);
  vec3 ld = layer(uvD);
  vec2 slope = la.xy * 0.55 + lb.xy * 0.42 + lc.xy * 0.30 * fineFade + ld.xy * 0.15 * ultraFade;
  // roughness: each layer's lost detail, weighted as its slope is
  float variance = la.z * 0.30 + lb.z * 0.18 + lc.z * 0.09 * fineFade + ld.z * 0.02 * ultraFade;

  // rain: rings across the swell, fading with distance (they are a metre wide) and with the downpour
  float rainFade = uRain * (1.0 - smoothstep(40.0, 150.0, dist));
  if (rainFade > 0.01) {
    slope += (ripples(xz, 3.1, 0.0) + ripples(xz + 17.0, 2.3, 7.0)) * 0.42 * rainFade;
    variance += 0.01 * rainFade;
  }
  vec3 N = normalize(vec3(vNormal.x - slope.x, vNormal.y, vNormal.z - slope.y));
  float a2 = clamp(0.0016 + variance * 0.6, 0.0006, 0.35);

  float cosV = clamp(dot(N, V), 0.0, 1.0);
  float fres = 0.02 + 0.98 * pow(1.0 - cosV, 5.0);
  // a rough sea scatters the grazing reflection rather than mirroring it
  fres = min(fres, 0.8);

  // — reflection of what stands over the water
  vec3 R = reflect(-V, N);
  R.y = abs(R.y);
  vec3 sky = mix(uHorizon, uZenith, pow(clamp(R.y, 0.0, 1.0), 0.45));
  sky += vec3(0.55, 0.65, 0.9) * uFlash * 0.55;
  vec3 mirrored = sky;
  if (uReflect > 0.5) {
    vec4 rp = uReflMatrix * vec4(P.x, uPlaneY, P.z, 1.0);
    vec2 ruv = rp.xy / rp.w + (N.xz - vNormal.xz) * (0.09 / (1.0 + dist * 0.012));
    float blur = 0.004 + sqrt(variance) * 0.03;
    mirrored = texture2D(uReflection, ruv).rgb * 0.4
             + texture2D(uReflection, ruv + vec2(blur, 0.0)).rgb * 0.15
             + texture2D(uReflection, ruv - vec2(blur, 0.0)).rgb * 0.15
             + texture2D(uReflection, ruv + vec2(0.0, blur)).rgb * 0.15
             + texture2D(uReflection, ruv - vec2(0.0, blur)).rgb * 0.15;
    mirrored += vec3(0.55, 0.65, 0.9) * uFlash * 0.25;
  }

  // — the body of the water: dark, brightest where a thin crest is lit through, green over the shallows
  vec3 L = normalize(uMoonDir);
  float crest = smoothstep(-0.3, 1.1, vHeight);
  float ndl = max(dot(N, L), 0.0);
  float through = pow(clamp(dot(V, -L) * 0.5 + 0.5, 0.0, 1.0), 3.0) * smoothstep(0.1, 1.0, vHeight);
  vec3 body = mix(uDeep, uShallow, crest * 0.7 + ndl * 0.15);
  body += uMoonColor * through * 0.28;
  float towerD = distance(P.xz, uTowerXZ);
  float shore = smoothstep(34.0, 7.0, towerD);
  body = mix(body, vec3(0.05, 0.22, 0.2) + uMoonColor * 0.05, shore * 0.5);

  vec3 color = mix(body, mirrored, fres);

  // — moonlight: a narrow path of glitter and a broad sheen
  vec3 Hm = normalize(V + L);
  float ndh = max(dot(N, Hm), 0.0);
  float vh = max(dot(V, Hm), 0.05);
  float specVis = 0.25 / (vh * vh);
  color += uMoonColor * (ggx(ndh, a2) * specVis * 0.012 + pow(ndh, 90.0) * 0.1) * fres * ndl;

  // — the lighthouse beam on the water
  vec2 rel = P.xz - uLantern.xz;
  float r = length(rel);
  vec2 bearing = rel / max(r, 1e-3);
  float ang = acos(clamp(dot(bearing, uBeamDir), -1.0, 1.0));
  float sector = exp(-ang * ang / (2.0 * 0.15 * 0.15));
  float reach = smoothstep(10.0, 38.0, r) * (1.0 - smoothstep(110.0, 200.0, r));
  vec3 toLamp = normalize(uLantern - P);
  float lit = sector * reach * uBeamPower;
  color += uBeamColor * lit * (0.10 + 0.55 * max(dot(N, toLamp), 0.0));
  // the lamp itself, in the water: a column of glitter running back to the lens, always faintly there
  // and flaring as the sweep goes by
  vec3 Hl = normalize(V + toLamp);
  float lampGlint = ggx(max(dot(N, Hl), 0.0), a2) * (0.25 / max(dot(V, Hl) * dot(V, Hl), 0.05));
  float lampLevel = (0.18 + sector * uBeamPower * 1.5) * uBeamPower / (1.0 + r * r * 0.00035);
  color += uBeamColor * lampGlint * lampLevel * 0.035 * fres;

  // — foam: only where the surface folds over, broken up by lace, wind-drawn streaks and the baked foam map
  vec4 fm = texture2D(uFoamMap, xz / 64.0 + vec2(0.004, 0.002) * flow);
  float lace = texture2D(uFoamMap, mat2(0.6, 0.8, -0.8, 0.6) * xz / 14.0 + vec2(0.02, 0.0) * flow).g;
  // streaks lie along the wind: the same map stretched four times along it
  vec2 wind = vec2(0.82, 0.57);
  vec2 wuv = vec2(dot(xz, wind) / 52.0, dot(xz, vec2(-wind.y, wind.x)) / 9.0) + vec2(0.006, 0.0) * flow;
  float streak = smoothstep(0.45, 0.9, texture2D(uFoamMap, wuv).g) * smoothstep(0.25, 1.0, vHeight);
  float fold = smoothstep(0.42, 0.04, vFold);
  float foam = clamp(fold * (0.35 + 0.9 * lace) + fm.r * 0.55 * smoothstep(0.1, 0.9, vHeight) + streak * 0.28, 0.0, 1.0);
  // the surge around the islet
  float d = towerD;
  float surge = 2.9 + sin(uTime * 1.5) * 1.15;
  float ring = smoothstep(1.2, 0.0, abs(d - surge)) * smoothstep(7.5, 2.0, d);
  float churn = smoothstep(3.0, 1.2, d);
  // shoals break the swell well before it reaches the rock
  float shoal = smoothstep(16.0, 5.0, d) * smoothstep(0.0, 0.6, vHeight) * (0.4 + 0.6 * lace);
  foam = clamp(foam + (ring * 0.9 + churn * 0.8) * (0.5 + 0.7 * lace) + shoal * 0.5, 0.0, 1.0);
  foam *= smoothstep(260.0, 90.0, dist);
  // foam is lit like a solid: sky ambient, moon, and the beam when it passes
  vec3 foamLit = uFoam * (uHorizon * 1.1 + 0.05 + uMoonColor * 0.25 * ndl + uBeamColor * lit * 1.3 + vec3(0.5, 0.6, 0.8) * uFlash);
  color = mix(color, foamLit, foam * 0.85);

  // — mist standing on the sea (see webgl/fog.ts), then the plain distance fog
  float fogF = smoothstep(uFogNear, uFogFar, dist);
  if (uFogHeight.x > 0.0 && fogF > 0.0) {
    float tau = -log(max(1.0 - fogF, 1e-4));
    float k = 1.0 / max(uFogHeight.z, 0.1);
    float h0 = max(uCamPos.y - uFogHeight.y, 0.0);
    float h1 = max(P.y - uFogHeight.y, 0.0);
    float e0 = exp(-k * h0), e1 = exp(-k * h1);
    float dh = k * (h1 - h0);
    float along = abs(dh) < 1e-3 ? e0 : clamp((e0 - e1) / dh, 0.0, 1.0);
    fogF = 1.0 - exp(-tau * mix(1.0, along * uFogHeight.w, uFogHeight.x));
  }
  color = mix(color, uFogColor, fogF);

  gl_FragColor = vec4(color, uReveal);
}
