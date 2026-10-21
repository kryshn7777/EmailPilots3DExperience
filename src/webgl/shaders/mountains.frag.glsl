// Distant ranges, drawn as a sky layer: four ridgelines found by azimuth, each
// shaded like a face of rock (strata, gullies, a sun side and a lee side), snow
// on the high peaks, and aerial perspective that pulls the far ones into the
// horizon. All procedural, no textures, no geometry past a cylinder.
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uFog;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
uniform float uSunIntensity;
uniform float uOpacity;
uniform float uFacing; // azimuth of the tallest massif, radians

varying vec3 vWorldDir;

const float TAU = 6.28318530718;

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// value noise on a circle: `per` lattice cells around the full turn
float pnoise(float x, float per, float seed) {
  float i = floor(x);
  float f = x - i;
  f = f * f * (3.0 - 2.0 * f);
  float a = hash11(mod(i, per) + seed * 17.0);
  float b = hash11(mod(i + 1.0, per) + seed * 17.0);
  return mix(a, b, f);
}

float pnoise2(vec2 p, float per, float seed) {
  vec2 i = floor(p);
  vec2 f = p - i;
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(vec2(mod(i.x, per), i.y) + seed);
  float b = hash21(vec2(mod(i.x + 1.0, per), i.y) + seed);
  float c = hash21(vec2(mod(i.x, per), i.y + 1.0) + seed);
  float d = hash21(vec2(mod(i.x + 1.0, per), i.y + 1.0) + seed);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// ridged fractal along the horizon: sharp alpine crests over broad massifs
float ridge(float a, float per, float seed) {
  float x = a * per;
  float amp = 0.5, tot = 0.0, h = 0.0, p = per;
  for (int i = 0; i < 6; i++) {
    float n = pnoise(x, p, seed + float(i));
    float r = 1.0 - abs(2.0 * n - 1.0);
    h += amp * r * r;
    tot += amp;
    amp *= 0.5;
    x *= 2.0;
    p *= 2.0;
  }
  float broad = pnoise(a * per * 0.5, per * 0.5, seed + 9.0);
  return mix(h / tot, broad, 0.35);
}

// face relief: strata and gullies, periodic in azimuth (`per` cells per turn)
float relief(vec2 q, float per, float seed) {
  float s = 0.0, amp = 0.55;
  for (int i = 0; i < 3; i++) {
    s += amp * pnoise2(q, per, seed + float(i) * 3.1);
    q *= 2.0;
    per *= 2.0;
    amp *= 0.5;
  }
  return s;
}

void main() {
  vec3 dir = normalize(vWorldDir);
  float az = atan(dir.z, dir.x);          // -pi..pi
  float a = az / TAU + 0.5;               // 0..1 around the circle
  float el = asin(clamp(dir.y, -1.0, 1.0));
  float aa = fwidth(el) * 1.25 + 1e-5;

  // the tallest massif stands where the flight is heading; the sides fall away
  float env = 0.55 + 0.45 * cos(az - uFacing);
  env = mix(0.5, 1.0, env * env);

  vec3 view = vec3(dir.x, 0.0, dir.z);
  view = normalize(view + vec3(1e-5, 0.0, 0.0));
  vec3 tangent = vec3(-view.z, 0.0, view.x);

  vec3 ambient = mix(uHorizon, uZenith, 0.35);
  vec3 sun = uSunColor * uSunIntensity;
  vec3 col = vec3(0.0);
  float alpha = 0.0;

  // far to near: base elevation, height, lattice, seed, haze, rock colour
  for (int l = 0; l < 4; l++) {
    float fl = float(l);
    float base = mix(0.014, 0.0, fl / 3.0);
    float height = mix(0.24, 0.085, fl / 3.0) * env;
    float per = 5.0 + fl * 2.0;
    float seed = 3.0 + fl * 7.0;
    float haze = mix(0.46, 0.10, fl / 3.0);

    float h = ridge(a, per, seed);
    float top = base + height * pow(h, 1.25);
    float cover = 1.0 - smoothstep(-aa, aa, el - top);
    if (cover <= 0.0) continue;

    // slope of the skyline decides which way this face leans
    float d = 0.0015;
    float hl = ridge(a - d / TAU, per, seed);
    float hr = ridge(a + d / TAU, per, seed);
    float slope = (base + height * pow(hr, 1.25) - (base + height * pow(hl, 1.25))) / (2.0 * d);

    // face relief: a height field in (azimuth, elevation), lit from the side
    vec2 q = vec2(a * 260.0, (el - base) * 95.0);
    float r0 = relief(q, 260.0, seed);
    float rx = relief(q + vec2(0.35, 0.0), 260.0, seed);
    float ry = relief(q + vec2(0.0, 0.35), 260.0, seed);
    vec2 grad = vec2(rx - r0, ry - r0) / 0.35;

    vec3 n = normalize(-view * 1.0 + tangent * (-slope * 0.9 + grad.x * 0.45) + vec3(0.0, 0.45 + grad.y * 0.35, 0.0));
    float lit = clamp(dot(n, normalize(uSunDir)) * 0.8 + 0.2, 0.0, 1.0);

    // rock, with a dark conifer belt on the lower slopes of the near ranges
    vec3 rock = mix(vec3(0.06, 0.075, 0.11), vec3(0.30, 0.31, 0.35), r0);
    float belt = (1.0 - smoothstep(0.0, 0.22, (el - base) / max(top - base, 1e-4))) * step(1.5, fl);
    rock = mix(rock, vec3(0.020, 0.040, 0.034), belt * 0.8);

    // snow on the high crests, ragged along its lower edge
    float into = (top - el) / (height * 0.55 + 1e-4);
    float snowLine = 0.20 + 0.55 * relief(vec2(a * 400.0, el * 90.0), 400.0, seed + 1.0);
    float snow = smoothstep(snowLine + 0.1, snowLine - 0.1, into) * smoothstep(0.05, 0.10, top) * (1.0 - fl * 0.15);
    rock = mix(rock, vec3(0.78, 0.82, 0.90), snow);

    vec3 shaded = rock * (ambient * 1.1 + sun * 0.9 * lit);

    // aerial perspective, heavier toward the foot of the range
    // the foot dissolves into the fog colour the ground ends in, the upper
    // slopes into the sky's horizon, and the haze glows toward the sun
    float foot = 1.0 - smoothstep(base, base + 0.03, el);
    vec3 hazeCol = mix(uFog, uHorizon, smoothstep(0.0, 0.07, el));
    float towardSun = pow(max(dot(view, normalize(vec3(uSunDir.x, 0.0, uSunDir.z) + vec3(1e-5, 0.0, 0.0))), 0.0), 3.0);
    hazeCol += sun * 0.10 * towardSun * (1.0 - foot);
    shaded = mix(shaded, hazeCol, clamp(haze + (1.0 - haze) * foot * 0.9, 0.0, 1.0));

    col = alpha <= 0.0 ? shaded : mix(col, shaded, cover);
    alpha = max(alpha, cover);
  }

  gl_FragColor = vec4(col, alpha * uOpacity);
}
