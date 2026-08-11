attribute float aPhase;

uniform float uTime;
uniform vec3 uBoxMin;
uniform vec3 uBoxSize;
uniform float uSpeed;

varying float vAlpha;

void main() {
  vec3 p = position;
  // wrap fall inside the box
  p.y = uBoxMin.y + mod(position.y - uBoxMin.y - uTime * uSpeed * (0.8 + aPhase * 0.4), uBoxSize.y);
  /**
   * Driven rain, not drizzle — but the push has to be PER DROP, never a
   * function of height in the box.
   *
   * A `(1.0 - fall) * 3.2` term was tried and looked like an ocean bug: drops
   * wrap continuously in y, so keying x to height shears the whole volume
   * coherently and every drop at a given height lands at the same offset. The
   * field stops being rain and becomes ordered diagonal ranks, which over the
   * beacon's sea (same shader) read as a regular fish-scale lattice across the
   * water. Cost me three wrong diagnoses in the ocean shader.
   *
   * The slant is sold in the fragment stage, which shears the streak inside
   * each sprite. That is a look, not a displacement, so it cannot organise the
   * field.
   */
  p.x += sin(uTime * 0.9 + aPhase * 6.283) * 1.5 + (aPhase - 0.5) * 2.2;

  vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
  float depth = -mvPosition.z;
  vAlpha = smoothstep(70.0, 6.0, depth) * 0.95;
  // longer streaks, and they hold their length closer to the lens. The quad
  // is square and the streak only uses a sliver of its width, so the fill
  // cost of the extra size is small.
  gl_PointSize = 130.0 / depth;
  gl_Position = projectionMatrix * mvPosition;
}
