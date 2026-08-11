import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Mesh,
  ShaderMaterial,
  Vector3,
} from 'three';
import { CONTRAIL_FROM } from '../../story/chapters';
import type { FlightPath } from '../rig/FlightPath';

const SAMPLES = 30;
const STEP = 0.0016; // story-t between ribbon segments
const HALF_WIDTH = 0.16;

/**
 * The hero plane's wake: a translucent ribbon of disturbed air peeling off
 * behind the dart. Sampled off the flight path exactly like the contrail, so
 * it is a pure function of scroll — reverse scrub can never leave a smear.
 *
 * The ribbon widens and thins with age, and the shader runs a slow ripple
 * along it so the surface reads as water rather than a flat decal. Shader is
 * inline: twelve lines each side, not worth two more files in shaders/.
 */
export class AirTrail {
  readonly mesh: Mesh;
  private geometry = new BufferGeometry();
  private positions = new Float32Array(SAMPLES * 2 * 3);
  private material: ShaderMaterial;
  private samples: Vector3[] = [];
  private dir = new Vector3();
  private side = new Vector3();
  private worldUp = new Vector3(0, 1, 0);

  constructor() {
    const age = new Float32Array(SAMPLES * 2);
    const edge = new Float32Array(SAMPLES * 2);
    const index: number[] = [];
    for (let i = 0; i < SAMPLES; i++) {
      const a = i / (SAMPLES - 1);
      age[i * 2] = a;
      age[i * 2 + 1] = a;
      edge[i * 2] = -1;
      edge[i * 2 + 1] = 1;
      if (i < SAMPLES - 1) {
        const b = i * 2;
        index.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
      }
      this.samples.push(new Vector3());
    }
    this.geometry.setAttribute(
      'position',
      new BufferAttribute(this.positions, 3).setUsage(DynamicDrawUsage),
    );
    this.geometry.setAttribute('aAge', new BufferAttribute(age, 1));
    this.geometry.setAttribute('aEdge', new BufferAttribute(edge, 1));
    this.geometry.setIndex(index);

    this.material = new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new Color('#cfe9f2') },
        uOpacity: { value: 0 },
      },
      vertexShader: /* glsl */ `
        attribute float aAge;
        attribute float aEdge;
        varying float vAge;
        varying float vEdge;
        uniform float uTime;
        void main() {
          vAge = aAge;
          vEdge = aEdge;
          // the wake settles and breathes as it dissipates
          vec3 p = position;
          p.y += sin(aAge * 16.0 - uTime * 2.1) * aAge * 0.10 - aAge * aAge * 0.22;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      // NO precision qualifier here: three's prefix already declares highp,
      // and re-declaring mediump would make these varyings mediump in the
      // fragment stage while the vertex stage kept them highp — GLSL ES 3.00
      // refuses to link a cross-stage precision mismatch.
      fragmentShader: /* glsl */ `
        varying float vAge;
        varying float vEdge;
        uniform vec3 uColor;
        uniform float uOpacity;
        uniform float uTime;
        void main() {
          float across = 1.0 - vEdge * vEdge;          // soft edges
          float tail = pow(1.0 - vAge, 1.5);           // dissipates behind
          float ripple = 0.68 + 0.32 * sin(vAge * 30.0 - uTime * 3.2 + vEdge * 2.2);
          float a = across * tail * ripple * uOpacity;
          if (a < 0.004) discard;
          gl_FragColor = vec4(uColor, a);
        }
      `,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    });

    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.visible = false;
  }

  update(t: number, time: number, path: FlightPath, head: Vector3): void {
    this.mesh.visible = t > CONTRAIL_FROM;
    if (!this.mesh.visible) return;
    this.material.uniforms.uTime!.value = time;
    // full strength in open air, gone before the dive into the arrival office
    this.material.uniforms.uOpacity!.value = 0.55 * (1 - smooth(t, 0.95, 0.985));

    this.samples[0]!.copy(head);
    for (let i = 1; i < SAMPLES; i++) {
      path.pointAt(Math.max(t - i * STEP, CONTRAIL_FROM), this.samples[i]!);
    }
    for (let i = 0; i < SAMPLES; i++) {
      // forward direction from the neighbouring sample, so no second curve eval
      const a = this.samples[Math.max(i - 1, 0)]!;
      const b = this.samples[Math.min(i + 1, SAMPLES - 1)]!;
      this.dir.copy(a).sub(b);
      if (this.dir.lengthSq() < 1e-8) this.dir.set(1, 0, 0);
      this.side.crossVectors(this.dir.normalize(), this.worldUp).normalize();
      // the wake spreads as it ages, like disturbed air behind a wing
      const w = HALF_WIDTH * (0.4 + (i / (SAMPLES - 1)) * 2.6);
      const p = this.samples[i]!;
      const o = i * 6;
      this.positions[o] = p.x - this.side.x * w;
      this.positions[o + 1] = p.y - this.side.y * w;
      this.positions[o + 2] = p.z - this.side.z * w;
      this.positions[o + 3] = p.x + this.side.x * w;
      this.positions[o + 4] = p.y + this.side.y * w;
      this.positions[o + 5] = p.z + this.side.z * w;
    }
    this.geometry.attributes.position!.needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

function smooth(x: number, a: number, b: number): number {
  const u = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return u * u * (3 - 2 * u);
}
