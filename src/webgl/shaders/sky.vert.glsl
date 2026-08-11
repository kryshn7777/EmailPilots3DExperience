varying vec3 vWorldDir;

void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldDir = normalize(worldPos.xyz - cameraPosition);
  // pin the dome to the far plane so it never clips
  vec4 clipPos = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = clipPos.xyww;
}
