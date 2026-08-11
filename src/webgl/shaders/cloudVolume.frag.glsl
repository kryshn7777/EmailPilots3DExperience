#include ./chunks/noise.glsl;

uniform vec3 uBoxMin;
uniform vec3 uBoxMax;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uShadowColor;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform float uTime;
uniform float uSteps;
uniform float uCoverage;

varying vec3 vWorldPos;

// cheap screen-space hash for march jitter (stands in for blue noise)
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 rayBox(vec3 origin, vec3 dir) {
  vec3 inv = 1.0 / dir;
  vec3 t0 = (uBoxMin - origin) * inv;
  vec3 t1 = (uBoxMax - origin) * inv;
  vec3 tmin = min(t0, t1);
  vec3 tmax = max(t0, t1);
  return vec2(max(max(tmin.x, tmin.y), tmin.z), min(min(tmax.x, tmax.y), tmax.z));
}

float density(vec3 p) {
  float h = clamp((p.y - uBoxMin.y) / (uBoxMax.y - uBoxMin.y), 0.0, 1.0);
  // flat-bottomed, billowy-topped cumulus shaping
  float shape = smoothstep(0.0, 0.18, h) * smoothstep(1.0, 0.5, h);
  vec3 q = p * 0.055 + vec3(uTime * 0.02, 0.0, uTime * 0.008);
  float n = fbm3(q);
  return clamp((n - (1.0 - uCoverage)) * shape * 2.2, 0.0, 1.0);
}

void main() {
  vec3 rayDir = normalize(vWorldPos - cameraPosition);
  vec2 hit = rayBox(cameraPosition, rayDir);
  float tNear = max(hit.x, 0.0);
  float tFar = hit.y;
  if (tFar <= tNear) discard;
  // fully fogged-out: skip the march entirely
  if (tNear > uFogFar) discard;

  float steps = max(uSteps, 8.0);
  float stepLen = (tFar - tNear) / steps;
  // STATIC jitter: re-rolling it per frame made the whole slab crawl with
  // shimmering grain — a stable dither pattern reads as texture, not noise
  float jitter = hash12(gl_FragCoord.xy);
  float t = tNear + stepLen * jitter;

  vec3 sunDir = normalize(uSunDir);
  float transmittance = 1.0;
  vec3 light = vec3(0.0);

  for (int i = 0; i < 64; i++) {
    if (float(i) >= steps || transmittance < 0.02) break;
    vec3 p = cameraPosition + rayDir * t;
    float d = density(p);
    if (d > 0.0) {
      // one-tap sun gradient: cheap self-shadowing — skipped for wisps too
      // thin to shadow anything (saves the second fbm on ~half the samples)
      float toSun = d > 0.05 ? density(p + sunDir * 3.2) * 1.5 : 0.0;
      float shadow = exp(-toSun * 1.6);
      // powder: brighten thin edges facing the sun
      float powder = 1.0 - exp(-d * 4.0);
      vec3 sample_ = mix(uShadowColor, uSunColor, shadow) * powder;

      float absorb = exp(-d * stepLen * 0.55);
      light += sample_ * transmittance * (1.0 - absorb);
      transmittance *= absorb;
    }
    t += stepLen;
  }

  float alpha = 1.0 - transmittance;
  if (alpha < 0.01) discard;

  float viewDepth = tNear;
  float fog = smoothstep(uFogNear, uFogFar, viewDepth);
  vec3 color = mix(light / max(alpha, 1e-4), uFogColor, fog);

  gl_FragColor = vec4(color, alpha * (1.0 - fog * 0.9));
}
