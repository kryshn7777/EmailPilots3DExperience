varying vec3 vWorldDir;

void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldDir = normalize(worldPos.xyz - cameraPosition);
  // pinned to the far plane like the sky: the range is at infinity, so it never
  // clips and never covers anything that is actually in the scene
  vec4 clipPos = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = clipPos.xyww;
}
