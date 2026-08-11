uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
uniform float uSunIntensity;
uniform float uFlash;

varying vec3 vWorldDir;

void main() {
  vec3 dir = normalize(vWorldDir);
  float up = clamp(dir.y, 0.0, 1.0);

  // horizon → zenith gradient with a soft shoulder
  vec3 sky = mix(uHorizon, uZenith, pow(up, 0.55));
  // mirror a dimmed horizon below the belt so the underside isn't dead
  float below = clamp(-dir.y, 0.0, 1.0);
  sky = mix(sky, uHorizon * 0.55, pow(below, 0.7));

  // sun disc + haze
  float sunDot = clamp(dot(dir, normalize(uSunDir)), 0.0, 1.0);
  vec3 sun = uSunColor * uSunIntensity * (pow(sunDot, 350.0) * 2.0 + pow(sunDot, 8.0) * 0.35);

  // storm lightning washes the whole dome
  vec3 color = sky + sun + vec3(uFlash) * 0.8;

  gl_FragColor = vec4(color, 1.0);
}
