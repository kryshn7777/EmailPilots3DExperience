#include ./chunks/noise.glsl;

uniform float uTime;
uniform float uProgress;

varying vec3 vNormal;
varying vec3 vViewDir;
varying float vNoise;

void main() {
  float n = fbm(normal * 1.6 + uTime * 0.15);
  vNoise = n;

  vec3 displaced = position + normal * n * (0.12 + 0.25 * uProgress);

  vec4 mvPosition = modelViewMatrix * vec4(displaced, 1.0);
  vNormal = normalize(normalMatrix * normal);
  vViewDir = normalize(-mvPosition.xyz);

  gl_Position = projectionMatrix * mvPosition;
}
