uniform float uProgress;

varying vec3 vNormal;
varying vec3 vViewDir;
varying float vNoise;

const vec3 PAPER = vec3(0.969, 0.953, 0.925);
const vec3 GOLD = vec3(1.0, 0.851, 0.627);
const vec3 BEAM = vec3(0.498, 0.910, 0.847);

void main() {
  float fresnel = pow(1.0 - clamp(dot(vNormal, vViewDir), 0.0, 1.0), 2.5);
  float lambert = clamp(dot(vNormal, normalize(vec3(0.6, 0.8, 0.4))), 0.0, 1.0);

  vec3 base = PAPER * (0.25 + 0.75 * lambert);
  vec3 tint = mix(GOLD, BEAM, uProgress);

  // Fresnel rim pushed past 1.0 so bloom picks it up.
  vec3 color = base + tint * fresnel * (1.2 + vNoise * 0.5);

  gl_FragColor = vec4(color, 1.0);
}
