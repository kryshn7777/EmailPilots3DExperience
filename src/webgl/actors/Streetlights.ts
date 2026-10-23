import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  PointLight,
  Points,
  PointsMaterial,
  Quaternion,
  ShaderMaterial,
  SpotLight,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { glowTexture } from '../bake/CanvasTextures';
import type { Tier } from '../quality';
import { LAMP_CASTER_LAYER } from '../layers';

/** how many of each street's lent lights are shadow-casting spots */
const SHADOW_SPOTS = 3;

export interface Lamp {
  x: number;
  z: number;
  /** turn of the arm about y: 0 reaches toward +z, PI toward -z */
  yaw: number;
}

/** pole height and arm reach, in site units (about 5 m and 1.5 m) */
const POLE = 1.62;
const REACH = 0.5;
const HEAD_Y = POLE + 0.043;

const LIGHT = new Color('#ffcf8a');

/** a bar between two points, as a cylinder */
function rod(a: Vector3, b: Vector3, r: number): BufferGeometry {
  const g = new CylinderGeometry(r, r, a.distanceTo(b), 6);
  g.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), b.clone().sub(a).normalize()));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}

/**
 * The town's streetlights: a tapered pole on a plinth, a raked arm reaching over
 * the roadway and a cobra-head luminaire with a glowing lens. Every lamp is an
 * instance of one merged body, one lens, and (HIGH) one soft light cone, so the
 * whole district costs three draw calls and a halo layer. The lamps dim with the
 * daylight: lit under the window at night, cold glass by the morning.
 */
export class Streetlights {
  readonly group = new Group();
  private lens: MeshBasicMaterial;
  private cone: ShaderMaterial | null = null;
  private halo: PointsMaterial;
  /**
   * a few real lights, lent to whichever lamps are nearest the flight (HIGH only): the first
   * SHADOW_SPOTS are spotlights that cast shadows (of the LAMP_CASTER layer: cars, people, street
   * furniture, the posts themselves), the rest plain point lights
   */
  private pool: (PointLight | SpotLight)[] = [];
  private spots: { x: number; z: number }[] = [];
  private reach = 0;
  private scale = 1;
  private local = new Vector3();
  private disposables: { dispose(): void }[] = [];

  /** where each lamp's head hangs, as world x/z (HIGH tier only): for the road reflections */
  get tips(): { x: number; z: number }[] {
    return this.spots;
  }

  constructor(lamps: Lamp[], tier: Tier, scale = 1) {
    this.scale = scale;
    const parts: BufferGeometry[] = [];
    parts.push(new CylinderGeometry(0.06, 0.075, 0.12, 8).translate(0, 0.06, 0));
    parts.push(new CylinderGeometry(0.024, 0.04, POLE, 8).translate(0, POLE / 2 + 0.1, 0));
    parts.push(rod(new Vector3(0, POLE - 0.02, 0), new Vector3(0, POLE + 0.06, REACH * 0.85), 0.017));
    parts.push(new CylinderGeometry(0.034, 0.034, 0.05, 8).translate(0, POLE - 0.02, 0));
    // the housing: a flattened box with a swept-back cap
    parts.push(new BoxGeometry(0.15, 0.05, 0.3).translate(0, POLE + 0.066, REACH));
    parts.push(new BoxGeometry(0.11, 0.03, 0.22).translate(0, POLE + 0.1, REACH - 0.02));
    const body = mergeGeometries(parts, false)!;
    parts.forEach((g) => g.dispose());
    const bodyMaterial = new MeshStandardMaterial({ color: '#4a5058', roughness: 0.5, metalness: 0.65 });
    const lensGeometry = new PlaneGeometry(0.115, 0.255);
    lensGeometry.rotateX(Math.PI / 2); // faces down
    lensGeometry.translate(0, HEAD_Y, REACH);
    this.lens = new MeshBasicMaterial({ color: LIGHT.clone().multiplyScalar(2.4), toneMapped: false });
    this.disposables.push(body, bodyMaterial, lensGeometry, this.lens);

    const m4 = new Matrix4();
    const q = new Quaternion();
    const up = new Vector3(0, 1, 0);
    const p = new Vector3();
    const s = new Vector3(scale, scale, scale);
    const bodies = new InstancedMesh(body, bodyMaterial, lamps.length);
    const lenses = new InstancedMesh(lensGeometry, this.lens, lamps.length);
    const halos: number[] = [];
    lamps.forEach((lamp, i) => {
      q.setFromAxisAngle(up, lamp.yaw);
      m4.compose(p.set(lamp.x, 0, lamp.z), q, s);
      bodies.setMatrixAt(i, m4);
      lenses.setMatrixAt(i, m4);
      // the halo sits under the lens, out along the arm
      halos.push(
        lamp.x + Math.sin(lamp.yaw) * REACH * scale, (HEAD_Y - 0.02) * scale, lamp.z + Math.cos(lamp.yaw) * REACH * scale,
      );
    });
    bodies.frustumCulled = lenses.frustumCulled = false;
    bodies.castShadow = tier === 'high';
    bodies.layers.enable(LAMP_CASTER_LAYER);
    this.group.add(bodies, lenses);
    this.disposables.push(bodies, lenses);

    const haloGeometry = new BufferGeometry();
    haloGeometry.setAttribute('position', new Float32BufferAttribute(halos, 3));
    this.halo = new PointsMaterial({
      map: glowTexture(), color: '#ffc98a', size: 0.8 * scale, transparent: true, opacity: 0.9,
      depthWrite: false, blending: AdditiveBlending, sizeAttenuation: true,
    });
    const haloPoints = new Points(haloGeometry, this.halo);
    haloPoints.frustumCulled = false;
    this.group.add(haloPoints);
    this.disposables.push(haloGeometry, this.halo);

    // the real lights, lent out by `follow`
    if (tier === 'high') {
      this.spots = lamps.map((l) => ({
        x: l.x + Math.sin(l.yaw) * REACH * scale, z: l.z + Math.cos(l.yaw) * REACH * scale,
      }));
      this.reach = 5.2 * scale * scale;
      for (let i = 0; i < 6; i++) {
        if (i < SHADOW_SPOTS) {
          // a downlight with a shadow: the cars, people and posts under the nearest lamps throw
          // shadows across the road that swing as they pass, the way a real streetlight's do
          const spot = new SpotLight('#ffbd78', this.reach * 1.6, 9 * scale, Math.PI * 0.36, 0.65, 1.5);
          spot.castShadow = true;
          spot.shadow.mapSize.set(512, 512);
          spot.shadow.bias = -0.0008;
          spot.shadow.normalBias = 0.02;
          spot.shadow.radius = 3;
          spot.shadow.camera.near = 0.05;
          spot.shadow.camera.far = 9 * scale;
          spot.shadow.camera.layers.set(LAMP_CASTER_LAYER);
          this.group.add(spot, spot.target);
          this.pool.push(spot);
          continue;
        }
        const light = new PointLight('#ffbd78', this.reach, 9 * scale, 1.5);
        this.pool.push(light);
        this.group.add(light);
      }
    }

    // the cone of light under each head: soft at the edges, fading toward the ground
    if (tier === 'high') {
      const cone = new ConeGeometry(0.7, HEAD_Y, 20, 1, true);
      cone.translate(0, -HEAD_Y / 2, 0);
      this.cone = new ShaderMaterial({
        uniforms: { uColor: { value: LIGHT.clone() }, uLevel: { value: 1 }, uHeight: { value: HEAD_Y } },
        vertexShader: /* glsl */ `
          varying vec3 vNormal;
          varying vec3 vView;
          varying float vDepth;
          uniform float uHeight;
          void main() {
            mat4 m = modelMatrix * instanceMatrix;
            vec4 wp = m * vec4(position, 1.0);
            vNormal = normalize(mat3(m) * normal);
            vView = cameraPosition - wp.xyz;
            vDepth = 1.0 + position.y / uHeight; // 1 at the lens, 0 on the ground
            gl_Position = projectionMatrix * viewMatrix * wp;
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor;
          uniform float uLevel;
          varying vec3 vNormal;
          varying vec3 vView;
          varying float vDepth;
          void main() {
            float facing = abs(dot(normalize(vNormal), normalize(vView)));
            float far = 1.0 - smoothstep(50.0, 150.0, length(vView));
            float a = 0.075 * uLevel * pow(facing, 1.6) * pow(vDepth, 1.5) * far;
            gl_FragColor = vec4(uColor * a, a);
          }`,
        transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide,
      });
      const cones = new InstancedMesh(cone, this.cone, lamps.length);
      lamps.forEach((lamp, i) => {
        p.set(lamp.x + Math.sin(lamp.yaw) * REACH * scale, HEAD_Y * scale, lamp.z + Math.cos(lamp.yaw) * REACH * scale);
        cones.setMatrixAt(i, m4.compose(p, q.identity(), s));
      });
      cones.frustumCulled = false;
      cones.renderOrder = 2;
      this.group.add(cones);
      this.disposables.push(cone, this.cone, cones);
    }
  }

  /**
   * Real light from the lamps nearest `focus` (a world position): the pool's few point lights
   * hop to the closest lamp heads each frame, so streets, cars and facades near the flight are
   * lit by an actual lamp while the rest only glow. The lights' count never changes.
   */
  follow(focus: Vector3): void {
    if (!this.pool.length) return;
    this.group.updateWorldMatrix(true, false);
    this.local.copy(focus);
    this.group.worldToLocal(this.local);
    const taken: number[] = [];
    for (let k = 0; k < this.pool.length; k++) {
      let best = -1;
      let bestD = Infinity;
      for (let i = 0; i < this.spots.length; i++) {
        if (taken.includes(i)) continue;
        const dx = this.spots[i]!.x - this.local.x;
        const dz = this.spots[i]!.z - this.local.z;
        const d = dx * dx + dz * dz;
        if (d < bestD) { bestD = d; best = i; }
      }
      taken.push(best);
      const spot = this.spots[best]!;
      const light = this.pool[k]!;
      light.position.set(spot.x, (HEAD_Y - 0.1) * this.scale, spot.z);
      if ((light as SpotLight).isSpotLight) (light as SpotLight).target.position.set(spot.x, 0, spot.z);
    }
  }

  /** 0 in full daylight, 1 at night: the lenses, halos and cones follow it */
  setLevel(level: number): void {
    for (const l of this.pool) {
      const spot = (l as SpotLight).isSpotLight;
      l.intensity = this.reach * level * (spot ? 1.6 : 1);
      // a lamp that is out casts nothing: its shadow map stops being redrawn (switching the shadow
      // off instead would change every lit material's program)
      if (spot) {
        l.shadow!.autoUpdate = level > 0.02;
        // but the map must exist: a shadow sampler bound to nothing is a GL error on every draw
        if (!l.shadow!.map) l.shadow!.needsUpdate = true;
      }
    }
    this.lens.color.copy(LIGHT).multiplyScalar(0.5 + 1.9 * level);
    this.halo.opacity = 0.9 * level;
    this.halo.visible = level > 0.02;
    if (this.cone) this.cone.uniforms.uLevel!.value = level;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
