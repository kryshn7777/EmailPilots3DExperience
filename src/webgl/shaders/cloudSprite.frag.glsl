uniform float uTime;
uniform sampler2D uAtlas;
uniform vec3 uSunColor;
uniform vec3 uShadowColor;
uniform vec2 uSunScreenDir;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform float uOpacity;

varying vec2 vUv;
varying float vSeed;
varying float vDepth;
varying float vScale;

void main() {
  // per-sprite rotation (plus a silent drift) so the field never reads as
  // stamped copies of the 8 baked variants
  float ang = vSeed * 6.2831853 + uTime * 0.012;
  vec2 p = vUv - 0.5;
  p = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * p;

  // density comes from the baked atlas — the domain-warped fbm used to cost
  // ~6 simplex evaluations per pixel here, multiplied by heavy overdraw
  float variant = floor(vSeed * 7.999);
  vec2 tile = vec2(mod(variant, 4.0), floor(variant / 4.0));
  vec2 local = clamp(p + 0.5, 0.01, 0.99);
  float density = texture2D(uAtlas, (tile + local) / vec2(4.0, 2.0)).r;
  if (density < 0.015) discard;

  // lighting: sun gradient across the sprite + bright silver-lined rim
  float radial = 1.0 - smoothstep(0.12, 0.5, length(p * vec2(1.0, 1.25)));
  vec2 sunDir2 = normalize(uSunScreenDir + 1e-5);
  float lit = clamp(dot(normalize(p + 1e-5), sunDir2) * 0.5 + 0.5, 0.0, 1.0);
  // real cloud shadow is lit by the sky, never black — pinning the dark side
  // to the raw shadow colour turned every puff over the bright city into a
  // dark marbled smear
  vec3 shade = mix(uShadowColor, uSunColor, 0.38);
  vec3 color = mix(shade, uSunColor, lit * lit * 0.9 + 0.1);
  float rim = pow(1.0 - radial, 1.8) * pow(lit, 2.0);
  color += uSunColor * rim * 0.9;

  float fog = smoothstep(uFogNear, uFogFar, vDepth);
  color = mix(color, uFogColor, fog);

  // Fade out sprites the camera is about to fly through — a near sprite is a
  // fullscreen quad, the single biggest overdraw cost in the scene. The band
  // has to scale WITH the sprite: puffs run 5–19 units across, so a fixed
  // 2.5–9 fade left the big ones filling the lens with raw atlas swirl once
  // the deck straddled the flight line.
  float near_ = smoothstep(max(vScale * 0.8, 3.0), max(vScale * 2.4, 11.0), vDepth);

  gl_FragColor = vec4(color, min(density * 1.35, 1.0) * uOpacity * near_ * (1.0 - fog));
}
