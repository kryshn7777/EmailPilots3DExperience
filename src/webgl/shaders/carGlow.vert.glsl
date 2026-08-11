// Head/taillight glow sprites for the canyon cars. Positions are written from
// JS each frame (the car simulation owns them) — this shader only sizes and
// fades by depth.
attribute float aHue; // 0 = headlight (white), 1 = taillight (red)

varying float vHue;
varying float vAlpha;

void main() {
  vHue = aHue;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  float depth = -mvPosition.z;
  vAlpha = smoothstep(150.0, 28.0, depth);
  gl_PointSize = clamp(95.0 / depth, 2.0, 10.0);
  gl_Position = projectionMatrix * mvPosition;
}
