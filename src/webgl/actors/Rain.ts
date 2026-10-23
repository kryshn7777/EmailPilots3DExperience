import {
  AdditiveBlending,
  Color,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  ShaderMaterial,
  Vector3,
  type Camera,
  type PerspectiveCamera,
} from 'three';

/**
 * Rain that behaves like water, not like confetti: every drop is a thin streak stretched along
 * its own fall (wind-driven, so the sheets lean), a pixel wide at most so it never turns into a
 * smear, and lit where it is. Near the lighthouse the drops pick up the lamp, and where they cross
 * the sweeping beam they light up as the beam passes, brightest when the camera looks along it
 * toward the lamp (a drop refracts light forward; that glint is the look of rain against a light).
 * Splash rings open on the water around the camera. The drops are a box of positions that travels
 * with the camera and wraps, so there is always rain around the lens and none anywhere else.
 */
const DROP_VERT = /* glsl */ `
attribute vec2 corner;
attribute vec4 aSeed;
uniform float uTime;
uniform vec3 uCam;
uniform vec3 uBox;
uniform vec3 uFall;
uniform float uLength;
uniform float uPixel;
uniform float uOpacity;
uniform vec3 uLamp;
uniform vec3 uLampColor;
uniform vec3 uBeamDir;
uniform vec3 uBeamColor;
uniform float uBeamPower;
uniform vec3 uSky;
varying vec2 vC;
varying vec3 vLight;
varying float vAlpha;

void main() {
  float speed = 0.8 + 0.4 * aSeed.w;
  vec3 p = aSeed.xyz * uBox + uFall * speed * uTime;
  vec3 rel = mod(p - uCam + 0.5 * uBox, uBox) - 0.5 * uBox;
  vec3 c = uCam + rel;
  vec3 along = normalize(uFall);
  vec3 toCam = uCam - c;
  float dist = max(length(toCam), 1e-3);
  vec3 V = toCam / dist;
  vec3 side = normalize(cross(along, V));
  // a drop is a few millimetres across: drawn no thinner than a pixel, and dimmer by as much as it
  // had to be widened, so distant rain is a fine haze of lines and not a hatching
  float w = 0.004;
  float wr = max(w, dist * uPixel * 0.8);
  float len = uLength * speed;
  vec3 pos = c + along * (corner.y - 0.5) * len + side * corner.x * wr;
  vC = corner;
  vec3 e = abs(rel) / (0.5 * uBox);
  float edge = 1.0 - smoothstep(0.7, 1.0, max(e.x, max(e.y, e.z)));
  vAlpha = uOpacity * edge * smoothstep(0.25, 1.4, dist) * (w / wr) * 2.2;

  // light on the drop
  vec3 L = uLamp - c;
  float ld = max(length(L), 1e-3);
  L /= ld;
  float glint = pow(max(dot(-V, L), 0.0), 8.0);          // looking through the drop at the lamp
  vec3 lamp = uLampColor * (0.35 + 5.0 * glint) / (1.0 + 0.012 * ld * ld);
  float cone = pow(max(dot(-L, uBeamDir), 0.0), 150.0);   // inside the sweep
  float along_beam = pow(max(dot(-V, -uBeamDir), 0.0), 4.0); // looking back up the beam
  vec3 beam = uBeamColor * uBeamPower * cone * (1.0 - smoothstep(12.0, 46.0, ld)) * (2.5 + 14.0 * along_beam);
  vLight = uSky * 0.55 + lamp + beam;
  gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);
}
`;

const DROP_FRAG = /* glsl */ `
varying vec2 vC;
varying vec3 vLight;
varying float vAlpha;
void main() {
  float across = 1.0 - abs(vC.x);
  // a falling drop is a bright head and a fading tail (the streak is its motion over a frame)
  float along = smoothstep(0.0, 0.85, vC.y) * smoothstep(1.0, 0.92, vC.y);
  float a = across * across * along * vAlpha;
  if (a < 0.002) discard;
  gl_FragColor = vec4(vLight, a);
}
`;

const SPLASH_VERT = /* glsl */ `
attribute vec2 corner;
attribute vec4 aSeed;
uniform float uTime;
uniform vec3 uCam;
uniform float uTile;
uniform float uSeaY;
uniform float uOpacity;
uniform vec3 uLamp;
uniform vec3 uLampColor;
uniform vec3 uSky;
varying vec2 vC;
varying float vLife;
varying vec3 vLight;
varying float vAlpha;

void main() {
  // each splash spot lands again and again, at its own rate, a little elsewhere each time
  float rate = 1.6 + aSeed.w * 1.8;
  float cycle = uTime * rate + aSeed.w * 13.0;
  float life = fract(cycle);
  float n = floor(cycle);
  vec2 jitter = fract(vec2(sin(n * 12.9898 + aSeed.x * 78.2), sin(n * 39.346 + aSeed.y * 11.1)) * 43758.5453) - 0.5;
  vec2 xz = (aSeed.xy + jitter * 0.15) * uTile;
  vec2 rel = mod(xz - uCam.xz + 0.5 * uTile, uTile) - 0.5 * uTile;
  vec3 c = vec3(uCam.x + rel.x, uSeaY, uCam.z + rel.y);
  float r = 0.04 + 0.3 * life;
  vec2 cc = vec2(corner.x, corner.y * 2.0 - 1.0);
  vec3 pos = c + vec3(cc.x, 0.0, cc.y) * r;
  vC = cc;
  vLife = life;
  float dist = length(uCam - c);
  float edge = 1.0 - smoothstep(0.35, 0.5, max(abs(rel.x), abs(rel.y)) / uTile);
  vAlpha = uOpacity * edge * smoothstep(40.0, 6.0, dist);
  vec3 L = uLamp - c;
  vLight = uSky * 0.8 + uLampColor * 0.6 / (1.0 + 0.01 * dot(L, L));
  gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);
}
`;

const SPLASH_FRAG = /* glsl */ `
varying vec2 vC;
varying float vLife;
varying vec3 vLight;
varying float vAlpha;
void main() {
  float d = length(vC);
  // a ring that opens and thins, and the bright fleck of the drop at its birth
  float ring = smoothstep(0.08, 0.0, abs(d - 0.8)) * (1.0 - vLife);
  float fleck = smoothstep(0.35, 0.0, d) * smoothstep(0.25, 0.0, vLife) * 2.0;
  float a = (ring + fleck) * vAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vLight, a);
}
`;

function quad(count: number, seed: () => number): InstancedBufferGeometry {
  const g = new InstancedBufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 3));
  g.setAttribute('corner', new Float32BufferAttribute([-1, 0, 1, 0, 1, 1, -1, 1], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const seeds = new Float32Array(count * 4);
  for (let i = 0; i < seeds.length; i++) seeds[i] = seed();
  g.setAttribute('aSeed', new InstancedBufferAttribute(seeds, 4));
  g.instanceCount = count;
  return g;
}

export interface RainLight {
  lamp: Vector3;
  lampColor: Color;
  beamDir: Vector3;
  beamColor: Color;
  beamPower: number;
}

export class Rain {
  readonly drops: Mesh;
  readonly splashes: Mesh;
  private dropMaterial: ShaderMaterial;
  private splashMaterial: ShaderMaterial;

  constructor(count: number, splashCount: number, rand: () => number, seaY: number) {
    this.dropMaterial = new ShaderMaterial({
      vertexShader: DROP_VERT,
      fragmentShader: DROP_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uCam: { value: new Vector3() },
        uBox: { value: new Vector3(26, 20, 26) },
        // driven rain: falling fast, leaning with the wind off the sea
        uFall: { value: new Vector3(-2.6, -11.5, 1.4) },
        uLength: { value: 0.55 },
        uPixel: { value: 0.001 },
        uOpacity: { value: 0 },
        uLamp: { value: new Vector3() },
        uLampColor: { value: new Color('#ffe2b0') },
        uBeamDir: { value: new Vector3(1, 0, 0) },
        uBeamColor: { value: new Color('#bff6ee') },
        uBeamPower: { value: 0 },
        uSky: { value: new Color('#2a3a44') },
      },
      transparent: true, depthWrite: false, blending: AdditiveBlending,
    });
    this.drops = new Mesh(quad(count, rand), this.dropMaterial);
    this.drops.frustumCulled = false;
    this.drops.renderOrder = 3;

    this.splashMaterial = new ShaderMaterial({
      vertexShader: SPLASH_VERT,
      fragmentShader: SPLASH_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uCam: this.dropMaterial.uniforms.uCam!,
        uTile: { value: 34 },
        uSeaY: { value: seaY },
        uOpacity: { value: 0 },
        uLamp: this.dropMaterial.uniforms.uLamp!,
        uLampColor: this.dropMaterial.uniforms.uLampColor!,
        uSky: this.dropMaterial.uniforms.uSky!,
      },
      transparent: true, depthWrite: false, blending: AdditiveBlending,
    });
    this.splashes = new Mesh(quad(splashCount, rand), this.splashMaterial);
    this.splashes.frustumCulled = false;
    this.splashes.renderOrder = 2;
  }

  /** `amount` 0..1 fades the whole downpour; `sky` is the light the drops take from the night around them. */
  update(time: number, camera: Camera, amount: number, light: RainLight, sky: Color, viewportHeight: number): void {
    const u = this.dropMaterial.uniforms;
    u.uTime!.value = time;
    (u.uCam!.value as Vector3).setFromMatrixPosition(camera.matrixWorld);
    u.uOpacity!.value = amount;
    const fov = (camera as PerspectiveCamera).fov ?? 50;
    u.uPixel!.value = (2 * Math.tan((fov * Math.PI) / 360)) / Math.max(viewportHeight, 1);
    (u.uLamp!.value as Vector3).copy(light.lamp);
    (u.uLampColor!.value as Color).copy(light.lampColor);
    (u.uBeamDir!.value as Vector3).copy(light.beamDir);
    (u.uBeamColor!.value as Color).copy(light.beamColor);
    u.uBeamPower!.value = light.beamPower;
    (u.uSky!.value as Color).copy(sky);
    this.splashMaterial.uniforms.uTime!.value = time;
    this.splashMaterial.uniforms.uOpacity!.value = amount * 0.55;
    this.drops.visible = this.splashes.visible = amount > 0.005;
  }

  dispose(): void {
    this.drops.geometry.dispose();
    this.splashes.geometry.dispose();
    this.dropMaterial.dispose();
    this.splashMaterial.dispose();
  }
}
