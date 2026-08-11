#include ./chunks/noise.glsl;

// One-time GPU bake of the sprite density field (the expensive domain-warped
// fbm) into an atlas tile. The live sprite shader then samples this instead
// of evaluating ~6 simplex calls per pixel per sprite.
uniform float uSeed;

varying vec2 vUv;

void main() {
  vec2 p = vUv - 0.5;

  vec2 warp = 0.32 * vec2(
    snoise(vec3(p * 2.6, uSeed * 19.0)),
    snoise(vec3(p * 2.6 + 4.7, uSeed * 19.0))
  );
  vec2 q = p + warp;
  float n = fbm3(vec3(q * 2.4 + uSeed * 37.0, uSeed));

  float radial = 1.0 - smoothstep(0.12, 0.5, length(p * vec2(1.0, 1.25)));
  float base = smoothstep(-0.42, -0.12, p.y + n * 0.18);
  float density = radial * base * smoothstep(-0.2, 0.5, n);

  gl_FragColor = vec4(density, 0.0, 0.0, 1.0);
}
