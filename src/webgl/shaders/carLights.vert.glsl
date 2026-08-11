attribute vec3 aLaneDir;
attribute float aLaneLen;
attribute float aPhase;
attribute float aHue; // 0 = headlights (white), 1 = taillights (red)

uniform float uTime;
uniform float uSpeed;

varying float vHue;
varying float vAlpha;

void main() {
  vHue = aHue;
  float travel = mod(aPhase * aLaneLen + uTime * uSpeed * (0.75 + aPhase * 0.5), aLaneLen);
  vec3 p = position + aLaneDir * travel;

  vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
  float depth = -mvPosition.z;
  vAlpha = smoothstep(120.0, 25.0, depth);
  gl_PointSize = clamp(70.0 / depth, 1.5, 7.0);
  gl_Position = projectionMatrix * mvPosition;
}
