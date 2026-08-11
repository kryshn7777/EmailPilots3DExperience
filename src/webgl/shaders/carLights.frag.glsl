uniform float uIntensity;

varying float vHue;
varying float vAlpha;

void main() {
  vec2 pc = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.12, length(pc)) * vAlpha;
  if (a < 0.02) discard;
  vec3 color = mix(vec3(1.0, 0.96, 0.85), vec3(1.0, 0.22, 0.18), vHue);
  gl_FragColor = vec4(color * uIntensity, a);
}
