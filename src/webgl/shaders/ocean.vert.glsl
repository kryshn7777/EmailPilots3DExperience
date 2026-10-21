// Gerstner sea: six directional waves with real horizontal motion, so crests
// sharpen and troughs flatten the way water does, and the folding of the surface
// (the Jacobian) comes out of the same sum and drives where foam forms.
//
// The longest waves are 52 units and the shortest 12, against 2.5-unit quads, so
// every one is sampled at least 4.8 times. Everything finer than that comes from
// the mipmapped normal maps in ocean.frag, which can be filtered; sines of world
// position cannot, and aliased into the white speckle this shader replaces.
uniform float uTime;

varying vec3 vWorldPos;
varying vec3 vNormal;
varying float vHeight;
varying float vFold;

const int N = 6;

void main() {
  vec3 base = (modelMatrix * vec4(position, 1.0)).xyz;
  vec2 p = base.xz;

  //                      direction (deg)  wavelength  amplitude  steepness
  const vec4 W0 = vec4(33.0, 52.0, 0.92, 0.80);
  const vec4 W1 = vec4(12.0, 34.0, 0.62, 0.78);
  const vec4 W2 = vec4(58.0, 22.0, 0.40, 0.74);
  const vec4 W3 = vec4(-14.0, 15.5, 0.28, 0.70);
  const vec4 W4 = vec4(82.0, 12.5, 0.20, 0.66);
  const vec4 W5 = vec4(40.0, 12.0, 0.15, 0.60);

  vec3 disp = vec3(0.0);
  float nx = 0.0, nz = 0.0, ny = 0.0;
  float jxx = 0.0, jzz = 0.0, jxz = 0.0;

  for (int i = 0; i < N; i++) {
    vec4 w = i == 0 ? W0 : i == 1 ? W1 : i == 2 ? W2 : i == 3 ? W3 : i == 4 ? W4 : W5;
    float a = radians(w.x);
    vec2 d = vec2(cos(a), sin(a));
    float k = 6.28318530718 / w.y;
    // deep-water dispersion, slowed for the camera: longer waves travel faster. The swell runs on
    // the wall clock (not the scroll), so it has to read as moving on a page that is standing still.
    float omega = 1.0 * sqrt(6.5 * k);
    float phase = k * dot(d, p) - omega * uTime + float(i) * 1.7;
    float s = sin(phase), c = cos(phase);
    float A = w.z, Q = w.w;

    disp.x += Q * A * d.x * c;
    disp.z += Q * A * d.y * c;
    disp.y += A * s;

    nx -= d.x * k * A * c;
    nz -= d.y * k * A * c;
    ny += Q * k * A * s;

    jxx += Q * k * A * d.x * d.x * s;
    jzz += Q * k * A * d.y * d.y * s;
    jxz += Q * k * A * d.x * d.y * s;
  }

  vNormal = normalize(vec3(nx, 1.0 - ny, nz));
  // how much the surface is folding over on itself: < 0 is a breaking crest
  vFold = (1.0 - jxx) * (1.0 - jzz) - jxz * jxz;
  vHeight = disp.y;

  vec3 world = base + disp;
  vWorldPos = world;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
