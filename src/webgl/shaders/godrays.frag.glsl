// Crepuscular rays: a radial march from every pixel toward the sun through a map of what the sun can
// reach. Runs at a fraction of the frame, because shafts are low-frequency, and is composited
// additively by GodRaysEffect.
//
// What lets light through is two things the frame already knows:
//  - depth: only the far plane is sky, so every building, plane and hill is an occluder;
//  - the colour buffer's ALPHA, which the sky dome writes as 1 - (its own cloud cover) and which
//    cloud and mountain materials erode as they draw over it (see skyVisibility in materials/).
//    A cloud in front of the sun therefore blocks light even though it writes no depth.
// Together they make the shafts fall where the sun is actually broken up, not as a uniform halo.
uniform sampler2D uScene;
uniform sampler2D uDepth;
uniform vec2 uSun;        // sun position in uv; may lie outside the frame
uniform float uAspect;
uniform float uDensity;   // how much of the way to the sun each march covers
uniform float uDecay;     // per-step falloff, so light near the pixel counts for more than light near the sun
uniform float uSamples;

varying vec2 vUv;

// interleaved gradient noise: breaks up the stepping into grain the low-res upsample then blurs away
float ign(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

// the light the sky sends down this uv: a bright core and a wide halo, only where the sky is open
float source(vec2 uv) {
  vec2 c = clamp(uv, vec2(0.002), vec2(0.998));
  float sky = step(0.99999, texture2D(uDepth, c).r);
  // partial cloud blocks more than its opacity says: light has to get through all of it
  float open = texture2D(uScene, c).a;
  open *= open;
  vec2 d = (uv - uSun) * vec2(uAspect, 1.0);
  float r2 = dot(d, d);
  float glow = exp(-r2 * 30.0) + 0.16 * exp(-sqrt(r2) * 4.5);
  return sky * open * glow;
}

void main() {
  vec2 delta = (vUv - uSun) * (uDensity / uSamples);
  vec2 pos = vUv - delta * ign(gl_FragCoord.xy);
  float decay = 1.0;
  float sum = 0.0;
  for (int i = 0; i < 64; i++) {
    if (float(i) >= uSamples) break;
    pos -= delta;
    sum += source(pos) * decay;
    decay *= uDecay;
  }
  // contrast: streaks should read as streaks, not as a gentle gradient
  gl_FragColor = vec4(vec3(pow(sum / uSamples, 1.3)), 1.0);
}
