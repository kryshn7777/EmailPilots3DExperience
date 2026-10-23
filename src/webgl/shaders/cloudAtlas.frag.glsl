#include ./chunks/noise.glsl;

// One-time GPU bake of the sprite density field (cellular billows, a little simplex
// wobble) into an atlas tile. The live sprite shader then samples this instead
// of evaluating noise per pixel per sprite.
uniform float uSeed;

varying vec2 vUv;

void main() {
  vec2 p = vUv - 0.5;

  // a little wobble keeps the billows from lining up with the sprite's own axes
  vec2 warp = 0.1 * vec2(
    snoise(vec3(p * 2.2, uSeed * 19.0)),
    snoise(vec3(p * 2.2 + 4.7, uSeed * 19.0))
  );
  vec2 q = p + warp;

  // cauliflower: round billows of three sizes, each riding on the one before
  vec3 c = vec3(q * 3.2 + uSeed * 37.0, uSeed * 11.0);
  float big = 1.0 - worley3(c);
  float mid = 1.0 - worley3(c * 2.1 + 5.3);
  float fine = 1.0 - worley3(c * 4.4 + 9.1);
  float cell = big * 0.55 + mid * 0.3 + fine * 0.15;
  float n = mix(cell, fbm3(vec3(q * 2.4 + uSeed * 37.0, uSeed)) * 0.5 + 0.5, 0.25);

  float radial = 1.0 - smoothstep(0.12, 0.5, length(p * vec2(1.0, 1.25)));
  float base = smoothstep(-0.42, -0.12, p.y + (n - 0.5) * 0.2);
  float density = radial * base * smoothstep(0.36, 0.7, n + 0.28 * radial);

  gl_FragColor = vec4(density, 0.0, 0.0, 1.0);
}
