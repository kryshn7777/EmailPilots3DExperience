// Night ocean under the beacon: three directional swells with sharpened
// crests. Normals via finite differences (cheap at this vertex density).
uniform float uTime;

varying vec3 vWorldPos;
varying vec3 vNormal;
varying float vCrest;

// Amplitudes are 1.6x the first pass and the whole field runs ~30% faster:
// this is weather, not a harbour on a calm night. The consumers of vCrest in
// the fragment shader have their thresholds scaled with it (by ~1.4, so foam
// coverage grows too), and Beacon lifts the freighter to match — a bigger sea
// under an unmoved hull is how the ship ends up looking swamped.
float swell(vec2 p, float t) {
  float h = 0.0;
  // four directions: long storm swells + shorter wind chop
  h += 0.74 * sin(dot(p, vec2(0.14, 0.06)) + t * 1.3);
  h += 0.48 * sin(dot(p, vec2(-0.09, 0.17)) + t * 1.8);
  h += 0.29 * sin(dot(p, vec2(0.23, -0.19)) + t * 2.4);
  h += 0.14 * sin(dot(p, vec2(0.4, 0.33)) + t * 3.2);
  /**
   * The two high-frequency chop terms that used to sit here are GONE.
   *
   * They had wavelengths of 5.7 and 5.1 units against 5-unit quads — about one
   * sample per wave, which is genuinely undersampled and worth removing on its
   * own merits at these amplitudes. Their detail now comes from the
   * per-fragment ripple field in ocean.frag, which has no sampling rate to
   * violate.
   *
   * They were NOT, however, the fish-scale lattice they were removed chasing.
   * That was the rain shader shearing its drop field by height (rain.vert),
   * and it outlived this edit by two more wrong guesses.
   */
  // sharpen crests, keep troughs broad
  return h + 0.3 * pow(abs(sin(dot(p, vec2(0.11, 0.13)) + t * 1.2)), 4.0);
}

void main() {
  vec3 p = position; // plane is rotated -90° around X: local xy → world xz
  float t = uTime;
  vec2 xz = (modelMatrix * vec4(p, 1.0)).xz;

  float h = swell(xz, t);
  float hx = swell(xz + vec2(0.35, 0.0), t);
  float hz = swell(xz + vec2(0.0, 0.35), t);
  p.z += h; // local z = world y before the mesh rotation

  // 0.45, not 0.6: a smaller up component tilts the normals harder for the
  // same slope, so the bigger swells actually catch and lose the moon instead
  // of staying evenly lit across a face
  vNormal = normalize(vec3(h - hx, 0.45, h - hz));
  vCrest = h;

  vec4 world = modelMatrix * vec4(p, 1.0);
  vWorldPos = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
