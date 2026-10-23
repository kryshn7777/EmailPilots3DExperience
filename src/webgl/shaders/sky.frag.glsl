// The dome: a horizon-to-zenith gradient, the sun (a disc, a tight aureole and a wide haze, all HDR so
// bloom takes them), and one layer of cloud high above the flight.
//
// The cloud layer is shaded like a thin volume without being marched: its density is read from the
// shared 3D noise (bake/cloudNoiseGen.ts) where the view ray crosses the layer, then two more reads
// walk toward the sun to see how much of the cloud stands between each point and the light. That is
// enough for dark bellies, bright sunlit tops and a silver lining toward the sun, for a handful of
// fetches a pixel, and because it is looked up in WORLD space it slides overhead as the camera flies.
//
// Alpha carries `1 - cloud opacity`: the share of the sun's light that gets through. Nothing else
// reads it but the god rays (see materials/skyVisibility.ts).
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
uniform float uSunIntensity;
uniform float uFlash;
uniform float uTime;
uniform float uCloud;
uniform sampler3D uShape;
uniform sampler3D uDetail;

varying vec3 vWorldDir;

const float LAYER_Y = 140.0;       // altitude of the layer, above anything the flight reaches
const float LAYER_THICK = 26.0;    // how deep it is, for the length of its shadows
const float SHAPE_SCALE = 1.0 / 520.0;
const float DETAIL_SCALE = 1.0 / 90.0;
const float FINE_SCALE = 1.0 / 27.0;

// cloud density at a point of the layer, xz in world units; .y is the fine billow pattern the
// density was eroded by, which the shading reuses to give each cloud a lumpy surface
vec2 layerDensity(vec2 xz, float thr, float erode, bool fine) {
  // the layer drifts on the wall clock; the noise's third axis moves too, so the puffs slowly reshape
  vec2 p = xz + vec2(1.0, 0.35) * uTime * 0.9;
  float slice = 0.13 + uTime * 0.0006;
  vec4 s = textureLod(uShape, vec3(p.x, slice * 520.0, p.y) * SHAPE_SCALE, 0.0);
  float r = clamp((s.r - 0.55) / 0.4, 0.0, 1.0);
  float billow = dot(s.gba, vec3(0.625, 0.25, 0.125));
  float n = mix(billow, r, 0.55);
  float d = clamp((n - thr) / 0.22, 0.0, 1.0);
  vec3 dn = textureLod(uDetail, vec3(p.x, slice * 90.0, p.y) * DETAIL_SCALE, 0.0).rgb;
  float f = dot(dn, vec3(0.625, 0.25, 0.125));
  // a second, finer pass for the pixel's own density: ragged edges and holes, the part that sells distance
  if (fine) f = mix(f, dot(textureLod(uDetail, vec3(p.x, slice * 27.0, p.y) * FINE_SCALE, 0.0).rgb, vec3(0.625, 0.25, 0.125)), 0.45);
  float e = (1.0 - f) * erode;
  return vec2(clamp((d - e) / (1.0 - e), 0.0, 1.0), f);
}

void main() {
  vec3 dir = normalize(vWorldDir);
  float up = clamp(dir.y, 0.0, 1.0);

  // horizon → zenith gradient with a soft shoulder
  vec3 sky = mix(uHorizon, uZenith, pow(up, 0.55));
  // mirror a dimmed horizon below the belt so the underside isn't dead
  float below = clamp(-dir.y, 0.0, 1.0);
  sky = mix(sky, uHorizon * 0.55, pow(below, 0.7));

  vec3 sd = normalize(uSunDir);
  float sunDot = clamp(dot(dir, sd), 0.0, 1.0);
  vec3 sunLight = uSunColor * uSunIntensity;
  // disc (a little larger than the real one, so it reads as a sun and blooms), aureole, haze: all kept
  // modest outside the disc, because bloom and the god rays both take their light from what is bright here
  float disc = smoothstep(0.99988, 0.99995, sunDot);
  sky += sunLight * (disc * 5.0 + pow(sunDot, 140.0) * 0.8 + pow(sunDot, 22.0) * 0.14 + pow(sunDot, 6.0) * 0.035);

  float vis = 1.0;
  if (uCloud > 0.01 && dir.y > 0.012) {
    float t = (LAYER_Y - cameraPosition.y) / dir.y;
    vec2 xz = cameraPosition.xz + dir.xz * t;
    // the sky is composed, not random: cloud gathers round the sun, so it is seen through breaks in it
    // and the light has something to fall between
    float cover = clamp(uCloud + 0.4 * smoothstep(0.6, 0.97, sunDot) * smoothstep(0.1, 0.3, uCloud), 0.0, 1.0);
    float thr = mix(0.76, 0.34, cover);
    vec2 c0 = layerDensity(xz, thr, 0.55, true);
    float d0 = c0.x;
    if (d0 > 0.001) {
      // walk toward the sun along the layer: the shorter the sun is above the horizon, the longer the shadows
      vec2 sunXZ = normalize(sd.xz + 1e-5);
      float reach = clamp(LAYER_THICK * 0.5 / max(sd.y, 0.12), 8.0, 70.0);
      float d1 = layerDensity(xz + sunXZ * reach * 0.5, thr, 0.4, false).x;
      float d2 = layerDensity(xz + sunXZ * reach, thr, 0.4, false).x;
      float lit = exp(-(d1 + d2) * 1.9);
      float thin = exp(-d0 * 2.2);
      float forward = pow(sunDot, 7.0);

      vec3 ambient = mix(uHorizon, uZenith, 0.5);
      // belly in the sky's own colour, tops in the sun's, and a silver lining where the sun is behind thin cloud
      vec3 col = ambient * (0.62 + 0.3 * lit)
               + sunLight * (0.5 * lit + 1.5 * forward * (0.25 + 0.75 * thin) * (0.3 + 0.7 * lit));
      // lumpy: the bulges of the fine pattern catch more light than the creases between them
      col *= 0.8 + 0.4 * smoothstep(0.25, 0.75, c0.y);

      // toward the horizon the layer is edge-on and miles off: haze takes it
      float fade = smoothstep(0.012, 0.2, dir.y);
      float a = (1.0 - exp(-d0 * 3.6)) * fade;
      sky = mix(sky, col, a);
      vis = 1.0 - a;
    }
  }

  // storm lightning washes the whole dome
  gl_FragColor = vec4(sky + vec3(uFlash) * 0.8, vis);
}
