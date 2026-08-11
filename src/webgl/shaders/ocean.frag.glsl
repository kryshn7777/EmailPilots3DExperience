uniform float uTime;
uniform vec3 uDeep;
uniform vec3 uCrest;
uniform vec3 uFoam;
uniform vec3 uMoonDir;
uniform vec2 uTowerXZ;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform vec3 uCamPos;
uniform float uReveal;

varying vec3 vWorldPos;
varying vec3 vNormal;
varying float vCrest;

void main() {
  vec3 n = normalize(vNormal);
  float depth = distance(uCamPos, vWorldPos);

  /**
   * Micro-ripples perturb the normal per fragment — vertex waves alone left
   * the surface reading as a smooth rubber sheet up close. They carry the
   * chop the vertex stage had to give up (see ocean.vert).
   *
   * `detail` is not optional. These are sines of world position with ~2–3
   * unit wavelengths, and a procedural function has no mipmap: once one pixel
   * spans several units — which it does within about 30 units at this grazing
   * angle — they alias into a regular fish-scale lattice across the whole
   * shadowed half of the sea. Fading them out with distance is the fix, and
   * it costs nothing visually because past 30 units they were never resolving
   * as ripples anyway.
   */
  // Starts at 8, not 24. Aliasing begins as soon as a pixel spans about half
  // a wavelength, and these ripples are 2-3 units — at this FOV that is inside
  // 15 units, so a fade starting at 24 was already too late to help.
  float detail = 1.0 - smoothstep(8.0, 34.0, depth);
  vec2 rp = vWorldPos.xz;
  float r1 = sin(dot(rp, vec2(2.1, 1.4)) + uTime * 2.8);
  float r2 = sin(dot(rp, vec2(-1.6, 2.5)) + uTime * 3.6);
  float r3 = sin(dot(rp, vec2(3.3, -2.2)) + uTime * 4.4);
  float r4 = sin(dot(rp, vec2(0.85, 0.61)) + uTime * 4.2);
  n = normalize(
    n + vec3(r1 + r3 * 0.5 + r4 * 0.8, 0.0, r2 - r3 * 0.5 + r4 * 0.6) * 0.09 * detail
  );

  // Body colour by crest height. Thresholds are scaled with the swell
  // amplitudes in ocean.vert (1.6x there, ~1.4x here) — left where they were,
  // every wave would clip past the top of the ramp and the sea would read as
  // a flat white sheet. Scaling slightly UNDER the amplitude is deliberate:
  // more of this bigger sea should be breaking.
  float ch = smoothstep(-1.0, 1.2, vCrest);
  vec3 color = mix(uDeep, uCrest, ch);

  // whitecaps on the sharpest crests, broken up by the ripple field
  float cap = smoothstep(0.72, 1.15, vCrest + r1 * 0.08 * detail);
  color = mix(color, uFoam, cap * 0.9);
  // Streaked foam trails blown down the faces and into the troughs. r2*r3 is
  // the worst aliaser of the lot — a product of two high-frequency sines — so
  // it fades with the same distance term.
  float streak = smoothstep(0.6, 1.0, r2 * r3) * smoothstep(0.28, -0.56, vCrest);
  color = mix(color, uFoam, streak * 0.22 * detail);

  // crash ring around the lighthouse islet: a surge that breathes. Faster and
  // travelling twice as far now, because the swell driving it is bigger.
  float d = distance(vWorldPos.xz, uTowerXZ);
  float surge = 2.9 + sin(uTime * 1.5) * 1.15;
  float ring = smoothstep(1.25, 0.0, abs(d - surge)) * smoothstep(7.5, 2.0, d);
  float churn = smoothstep(2.9, 1.2, d); // permanent froth against the rocks
  color = mix(color, uFoam, clamp(ring * 0.95 + churn * 0.75, 0.0, 0.95));

  // moon/beam glint — tight sparkles over a broad sheen
  vec3 view = normalize(uCamPos - vWorldPos);
  vec3 halfDir = normalize(view + normalize(uMoonDir));
  float ndh = max(dot(n, halfDir), 0.0);
  /**
   * The sparkle term is the aliasing AMPLIFIER, and it is why this artifact
   * survived four attempts to fix it upstream.
   *
   * pow(ndh, 240) is a knife-edge function of the normal, so any wobble in n
   * that is undersampled on screen comes back as hard-edged specks — and
   * because the ripple field is periodic, those specks land in a regular
   * lattice rather than as noise. Isolating it took hiding every Points object
   * in the beacon (rain and splashes both innocent) to prove the pattern was
   * on the water surface itself.
   *
   * So it fades with the same distance term as the ripples that feed it. Close
   * up, where the normal is properly sampled, it is untouched; past ~34 units
   * the water keeps the broad sheen and loses the glitter.
   */
  float spec = pow(ndh, 42.0);
  float sparkle = pow(ndh, 240.0) * detail;
  color += vec3(0.55, 0.85, 0.8) * (spec * 0.45 + sparkle * 0.9);

  // manual fog (ShaderMaterial skips the scene fog chunks) — depth is already
  // computed at the top for the detail fade
  float fog = smoothstep(uFogNear, uFogFar, depth);
  color = mix(color, uFogColor, fog);

  gl_FragColor = vec4(color, uReveal);
}
