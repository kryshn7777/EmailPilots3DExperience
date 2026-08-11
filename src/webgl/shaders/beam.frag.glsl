#include ./chunks/noise.glsl;

uniform vec3 uColor;
uniform float uTime;
uniform float uIntensity;

varying vec2 vUv;
varying vec3 vWorldPos;

void main() {
  // uv.y runs along the cone (0 = apex at the tower, 1 = wide end)
  float lengthFade = smoothstep(1.0, 0.15, vUv.y);
  // soft cylindrical edge: uv.x wraps around the cone
  float edge = sin(vUv.x * 3.14159265);
  edge = pow(clamp(edge, 0.0, 1.0), 1.6);

  // drifting volumetric streaks
  float streaks = 0.75 + 0.25 * fbm3(vec3(vUv.x * 6.0, vUv.y * 2.5 - uTime * 0.25, uTime * 0.08));

  float a = lengthFade * edge * streaks * uIntensity;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor * (1.2 + 0.6 * (1.0 - vUv.y)), a);
}
