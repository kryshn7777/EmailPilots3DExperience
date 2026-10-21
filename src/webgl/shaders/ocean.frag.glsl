// The night sea. Fresnel reflection of the sky the chapter is wearing, a dim
// body colour that glows where thin crests are lit from behind, wave detail from
// mipmapped normal maps at three scales, foam only where the surface folds, and the
// lighthouse beam raking across the swell as a sector of light with a sparkle
// path running back to the lamp.
uniform float uTime;
uniform sampler2D uNormalMap;
uniform sampler2D uFoamMap;

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

// a normal map layer as a slope, so layers add rather than blend
vec2 slopeOf(vec2 uv) {
  vec3 d = texture2D(uNormalMap, uv).rgb * 2.0 - 1.0;
  vec3 n = vec3(d.r, d.b, d.g); // stored as (x, z, y)
  return -n.xz / max(n.y, 0.2);
}

void main() {
  vec3 P = vWorldPos;
  vec3 V = normalize(uCamPos - P);
  float dist = distance(uCamPos, P);

  // — wave detail: three scales of the same spectrum, turned and drifting different ways
  vec2 xz = P.xz;
  float flow = uTime * 1.9; // the detail maps and the foam drift on the wall clock, briskly enough to read
  vec2 uvA = xz / 64.0 + vec2(0.012, 0.007) * flow;
  vec2 uvB = mat2(0.80, 0.60, -0.60, 0.80) * xz / 17.9 + vec2(-0.021, 0.015) * flow;
  vec2 uvC = mat2(0.45, -0.89, 0.89, 0.45) * xz / 4.7 + vec2(0.05, -0.03) * flow;
  float fineFade = 1.0 - smoothstep(30.0, 140.0, dist);
  vec2 slope = slopeOf(uvA) * 0.55 + slopeOf(uvB) * 0.42 + slopeOf(uvC) * 0.30 * fineFade;
  vec3 N = normalize(vec3(vNormal.x - slope.x, vNormal.y, vNormal.z - slope.y));

  // — reflection of the sky
  vec3 R = reflect(-V, N);
  R.y = abs(R.y);
  vec3 sky = mix(uHorizon, uZenith, pow(clamp(R.y, 0.0, 1.0), 0.45));
  sky += vec3(0.55, 0.65, 0.9) * uFlash * 0.55;
  float cosV = clamp(dot(N, V), 0.0, 1.0);
  float fres = 0.02 + 0.98 * pow(1.0 - cosV, 5.0);
  // a rough sea scatters the grazing reflection rather than mirroring it
  fres = min(fres, 0.78);

  // — the body of the water: dark, brightest where a thin crest is lit through
  vec3 L = normalize(uMoonDir);
  float crest = smoothstep(-0.3, 1.1, vHeight);
  float ndl = max(dot(N, L), 0.0);
  float through = pow(clamp(dot(V, -L) * 0.5 + 0.5, 0.0, 1.0), 3.0) * smoothstep(0.1, 1.0, vHeight);
  vec3 body = mix(uDeep, uShallow, crest * 0.7 + ndl * 0.15);
  body += uMoonColor * through * 0.28;

  vec3 color = mix(body, sky, fres);

  // — moonlight: a narrow path of glitter and a broad sheen
  vec3 Hm = normalize(V + L);
  float ndh = max(dot(N, Hm), 0.0);
  color += uMoonColor * (pow(ndh, 700.0) * 1.6 + pow(ndh, 90.0) * 0.16) * fres;

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
  // the glitter trail between the lamp and the lens
  float glint = pow(max(dot(R, toLamp), 0.0), 120.0);
  color += uBeamColor * glint * sector * uBeamPower * 1.4 * fres;

  // — foam: only where the surface folds over, broken up by lace and the baked foam map
  vec4 fm = texture2D(uFoamMap, xz / 64.0 + vec2(0.004, 0.002) * flow);
  float lace = texture2D(uFoamMap, mat2(0.6, 0.8, -0.8, 0.6) * xz / 14.0 + vec2(0.02, 0.0) * flow).g;
  float fold = smoothstep(0.42, 0.04, vFold);
  float foam = clamp(fold * (0.35 + 0.9 * lace) + fm.r * 0.55 * smoothstep(0.1, 0.9, vHeight), 0.0, 1.0);
  // the surge around the islet
  float d = distance(P.xz, uTowerXZ);
  float surge = 2.9 + sin(uTime * 1.5) * 1.15;
  float ring = smoothstep(1.2, 0.0, abs(d - surge)) * smoothstep(7.5, 2.0, d);
  float churn = smoothstep(3.0, 1.2, d);
  foam = clamp(foam + (ring * 0.9 + churn * 0.8) * (0.5 + 0.7 * lace), 0.0, 1.0);
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
