import {
  AdditiveBlending,
  Color,
  DoubleSide,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  MathUtils,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
} from 'three';

/**
 * Crepuscular shafts over the town, seen out of the study window and down the street pass: the low sun
 * breaking through the overcast deck. The post-process god rays (post/GodRays.ts) are a smear toward the
 * sun's pixel; these are shafts IN the world, so they have a place: they stand in the haze above the
 * rooftops, run along the sun's direction, are cut by the buildings and trees in front of them, drift,
 * and sweep past as the camera moves.
 *
 * One InstancedMesh of long ribbons that turn about their own axis to face the lens (a beam billboard):
 * a soft profile across the width, a streaky noise that slides slowly, and a fade at the cloud end, into
 * the rooftop haze at the foot, and close to the camera (a flat ribbon seen from a metre away looks flat).
 * Additive, no depth write: a draw call and a few hundred vertices.
 */
const FROM = 0.082;
const TO = 0.235;

const VERT = /* glsl */ `
attribute vec3 aCenter;
attribute vec3 aParams; // width, half-length, seed
uniform vec3 uAxis;
varying vec2 vUv;
varying vec3 vWorld;
varying float vSeed;
void main() {
  vec3 toCam = cameraPosition - aCenter;
  vec3 side = normalize(cross(uAxis, toCam));
  vec3 pos = aCenter + uAxis * (position.y * aParams.y * 2.0) + side * (position.x * aParams.x);
  vWorld = pos;
  vUv = uv;
  vSeed = aParams.z;
  gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);
}`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
uniform float uStrength;
uniform vec3 uAxis;
varying vec2 vUv;
varying vec3 vWorld;
varying float vSeed;
float h1(float n) { return fract(sin(n * 127.1) * 43758.5453); }
float n1(float x) { float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(h1(i), h1(i + 1.0), f); }
void main() {
  // across the beam: soft edges, with streaks that drift sideways
  float x = vUv.x * 2.0 - 1.0;
  float profile = pow(max(1.0 - x * x, 0.0), 1.2);
  float streak = 0.7 + 0.3 * n1(vUv.x * 9.0 + vSeed * 17.0 + uTime * 0.05) * n1(vUv.x * 23.0 - uTime * 0.03 + vSeed * 5.0);
  // along it: in at the cloud (the top, v = 1), thinning toward the rooftops
  float along = smoothstep(0.0, 0.3, vUv.y) * (1.0 - smoothstep(0.82, 1.0, vUv.y));
  // into the haze above the roofs, never a hard line through the houses
  float height = smoothstep(-1.2, 3.0, vWorld.y);
  // close to the lens a ribbon reads as a card
  float d = distance(vWorld, cameraPosition);
  float near = smoothstep(3.0, 11.0, d);
  float far = 1.0 - smoothstep(60.0, 150.0, d);
  float pulse = 0.65 + 0.35 * sin(uTime * 0.21 + vSeed * 6.2831) * sin(uTime * 0.13 + vSeed * 3.1);
  float a = profile * streak * along * height * near * far * pulse * uStrength;
  gl_FragColor = vec4(uColor * a, a);
}`;

export class LightShafts {
  readonly group = new Group();
  private mesh: InstancedMesh;
  private material: ShaderMaterial;
  private geometry: PlaneGeometry;
  private color = new Color();
  private white = new Color('#ffffff');
  private axis = new Vector3();

  constructor(rand: () => number, high: boolean) {
    const count = high ? 12 : 6;
    this.geometry = new PlaneGeometry(1, 1);
    this.material = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uColor: { value: new Color() }, uTime: { value: 0 }, uStrength: { value: 0 }, uAxis: { value: new Vector3(0, -1, 0) } },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
    });
    this.mesh = new InstancedMesh(this.geometry, this.material, count);
    const centers = new Float32Array(count * 3);
    const params = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      // over the town, either side of the street and the climb out of it; high in the haze, long
      centers.set([34 + rand() * 70, 6 + rand() * 7, -10 + rand() * 46], i * 3);
      params.set([5 + rand() * 8, 22 + rand() * 14, rand()], i * 3);
    }
    this.geometry.setAttribute('aCenter', new InstancedBufferAttribute(centers, 3));
    this.geometry.setAttribute('aParams', new InstancedBufferAttribute(params, 3));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.group.add(this.mesh);
    this.group.visible = false;
  }

  /** `sunDir` points to the sun; the beams run the other way, down out of the cloud */
  update(time: number, t: number, sunDir: Vector3, sunColor: Color, level: number): void {
    const v = MathUtils.smoothstep(t, FROM, FROM + 0.028) * (1 - MathUtils.smoothstep(t, TO - 0.045, TO));
    const strength = v * MathUtils.smoothstep(level, 0.3, 0.8);
    this.group.visible = strength > 0.004;
    if (!this.group.visible) return;
    this.axis.copy(sunDir).negate().normalize();
    this.color.copy(sunColor).lerp(this.white, 0.4);
    const u = this.material.uniforms;
    (u.uAxis!.value as Vector3).copy(this.axis);
    (u.uColor!.value as Color).copy(this.color);
    u.uTime!.value = time;
    u.uStrength!.value = strength * 0.55;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
