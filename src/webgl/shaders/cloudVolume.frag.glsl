// The cloud slab the flight passes through: a raymarched cumulus field.
//
// Shape and detail come from two baked 3D noise volumes (bake/cloudNoiseGen.ts), read with ONE
// filtered fetch each. The old shader evaluated three simplex octaves per step (and three more for
// each sun tap), which is what capped it at 22 coarse steps; this one spends the same budget on
// lighting instead:
//
//  - density: baked Perlin-Worley shape, cut by a flat-bellied, round-crowned height profile and
//    eroded by baked Worley detail so edges cauliflower rather than blur
//  - light: four coarse taps toward the sun give the optical depth to it; three octaves of
//    multiple scattering turn that into light that creeps into the cloud instead of stopping dead,
//    each with its own Henyey-Greenstein lobe (a hard forward one is the silver lining when the
//    sun is ahead); a tap upward occludes the sky light so bellies sit in shadow
//  - cost: steps are spread densely near the lens and sparsely far away, empty space costs one
//    mip-biased fetch, the march stops once the cloud is opaque, and it never reaches past the
//    fog.
uniform sampler3D uShape;
uniform sampler3D uDetail;
uniform vec3 uBoxMin;
uniform vec3 uBoxMax;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyColor;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform float uTime;
uniform float uSteps;
uniform float uCoverage;

varying vec3 vWorldPos;

const float SHAPE_SCALE = 1.0 / 64.0;   // world units per tile of the shape volume: one texel per unit
const float DETAIL_SCALE = 1.0 / 12.0;
const float SIGMA = 0.5;                 // extinction per unit of density per world unit
const float PI4 = 12.566370614;

// interleaved gradient noise: a stable dither that reads as texture rather than shimmer
float ign(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

vec2 rayBox(vec3 origin, vec3 dir) {
  vec3 inv = 1.0 / dir;
  vec3 t0 = (uBoxMin - origin) * inv;
  vec3 t1 = (uBoxMax - origin) * inv;
  vec3 tmin = min(t0, t1);
  vec3 tmax = max(t0, t1);
  return vec2(max(max(tmin.x, tmin.y), tmin.z), min(min(tmax.x, tmax.y), tmax.z));
}

float heightFrac(float y) {
  return clamp((y - uBoxMin.y) / (uBoxMax.y - uBoxMin.y), 0.0, 1.0);
}

// the cloud's mass without its fine detail: what the light taps read, at a coarse mip
float shapeDensity(vec3 p, float h, float lod) {
  vec3 q = p * SHAPE_SCALE + vec3(uTime * 0.0016, 0.0, uTime * 0.0007);
  vec4 s = textureLod(uShape, q, lod);
  float r = clamp((s.r - 0.55) / 0.4, 0.0, 1.0);
  float billow = dot(s.gba, vec3(0.625, 0.25, 0.125));
  float n = mix(billow, r, 0.55);
  // flat belly, rounded crown
  float profile = smoothstep(0.0, 0.12, h) * smoothstep(1.0, 0.6, h);
  // a steep ramp: cumulus have crisp edges and soft insides, and the softness comes from the light
  return clamp((n * profile - (1.0 - uCoverage)) / max(uCoverage * 0.55, 0.03), 0.0, 1.0);
}

// the same, eroded: only worth the extra fetch where there is cloud to erode
float erodedDensity(float d, vec3 p, float h, float lod) {
  vec3 q = p * DETAIL_SCALE + vec3(uTime * 0.006, uTime * 0.002, uTime * 0.0027);
  float f = dot(textureLod(uDetail, q, lod).rgb, vec3(0.625, 0.25, 0.125));
  float e = (1.0 - f) * mix(0.5, 0.34, h);
  return clamp((d - e) / (1.0 - e), 0.0, 1.0);
}

float henyey(float c, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (PI4 * pow(1.0 + g2 - 2.0 * g * c, 1.5));
}

void main() {
  vec3 rayDir = normalize(vWorldPos - cameraPosition);
  vec2 hit = rayBox(cameraPosition, rayDir);
  float tNear = max(hit.x, 0.0);
  // nothing past the fog can be seen, so nothing past it is marched
  float tFar = min(hit.y, uFogFar);
  if (tFar <= tNear) discard;

  float steps = max(uSteps, 8.0);
  float jitter = ign(gl_FragCoord.xy);
  float span = tFar - tNear;

  vec3 sunDir = normalize(uSunDir);
  float cosSun = dot(rayDir, sunDir);
  // dual-lobe phase: a hard forward lobe (silver lining) with a gentle backward one
  float phase = mix(henyey(cosSun, 0.62), henyey(cosSun, -0.28), 0.3) * PI4;

  float transmittance = 1.0;
  vec3 light = vec3(0.0);
  float depthSum = 0.0;
  float prevT = tNear;

  for (int i = 0; i < 64; i++) {
    if (float(i) >= steps || transmittance < 0.03) break;
    // steps get longer with distance: fine where the lens can see them, coarse where fog is thickening
    float t1 = min(tNear + span * pow((float(i) + 1.0 + jitter) / steps, 1.5), tFar);
    float t0 = prevT;
    prevT = t1;
    float dt = t1 - t0;
    vec3 p = cameraPosition + rayDir * (t0 + 0.5 * dt);
    float h = heightFrac(p.y);
    float mip = clamp(log2(dt) - 2.0, 0.0, 3.0);

    float d = shapeDensity(p, h, mip);
    if (d <= 0.002) continue;
    d = erodedDensity(d, p, h, mip);
    if (d <= 0.002) continue;

    // optical depth toward the sun: four taps, each twice as far as the last
    float od = 0.0;
    float len = 1.6;
    vec3 sp = p;
    for (int k = 0; k < 4; k++) {
      sp += sunDir * len;
      od += shapeDensity(sp, heightFrac(sp.y), 1.0 + float(k) * 0.6) * len;
      len *= 2.0;
    }
    // three octaves of multiple scattering: each lets more light survive and spreads it wider
    float direct = exp(-od * SIGMA) * phase
                 + 0.5 * exp(-od * SIGMA * 0.25) * mix(henyey(cosSun, 0.3), 0.08, 0.5) * PI4
                 + 0.25 * exp(-od * SIGMA * 0.06) * 0.18;
    // sky light, shut out from underneath by whatever stands over this point
    float over = shapeDensity(p + vec3(0.0, 7.0, 0.0), heightFrac(p.y + 7.0), 2.0);
    float sky = (0.3 + 0.7 * h) * (1.0 - 0.7 * over);
    // thin edges are brighter than their depth suggests (the powder effect)
    float powder = 0.6 + 0.4 * (1.0 - exp(-d * 3.0));

    vec3 radiance = (uSunColor * direct * 0.42 + uSkyColor * sky * 0.5) * powder;

    float step_ = exp(-d * SIGMA * dt);
    light += radiance * transmittance * (1.0 - step_);
    depthSum += (t0 + 0.5 * dt) * transmittance * (1.0 - step_);
    transmittance *= step_;
  }

  float alpha = 1.0 - transmittance;
  if (alpha < 0.01) discard;

  // aerial perspective by where the cloud actually is, not where its box begins
  float viewDepth = depthSum / max(alpha, 1e-4);
  float fog = smoothstep(uFogNear, uFogFar, viewDepth);
  vec3 color = mix(light / max(alpha, 1e-4), uFogColor, fog);

  gl_FragColor = vec4(color, alpha * (1.0 - fog * 0.9));
}
