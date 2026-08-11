attribute float aSeed;

uniform float uTime;

varying vec2 vUv;
varying float vSeed;
varying float vDepth;
varying float vScale;

void main() {
  vUv = uv;
  vSeed = aSeed;

  vec4 center = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float scale = length(vec3(instanceMatrix[0][0], instanceMatrix[0][1], instanceMatrix[0][2]));
  vScale = scale;

  // slow drift so the field breathes
  center.x += sin(uTime * 0.03 + aSeed * 12.0) * 0.8;

  vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 worldPos = center.xyz + (camRight * position.x + camUp * position.y) * scale;

  vec4 mvPosition = viewMatrix * vec4(worldPos, 1.0);
  vDepth = -mvPosition.z;
  gl_Position = projectionMatrix * mvPosition;
}
