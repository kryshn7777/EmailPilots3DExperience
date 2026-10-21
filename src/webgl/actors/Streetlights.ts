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
  Points,
  PointsMaterial,
  Quaternion,
  ShaderMaterial,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { glowTexture } from '../bake/CanvasTextures';
import type { Tier } from '../quality';

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
  private disposables: { dispose(): void }[] = [];

  constructor(lamps: Lamp[], tier: Tier, scale = 1) {
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

  /** 0 in full daylight, 1 at night: the lenses, halos and cones follow it */
  setLevel(level: number): void {
    this.lens.color.copy(LIGHT).multiplyScalar(0.5 + 1.9 * level);
    this.halo.opacity = 0.9 * level;
    this.halo.visible = level > 0.02;
    if (this.cone) this.cone.uniforms.uLevel!.value = level;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
