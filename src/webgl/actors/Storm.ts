import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  PointLight,
  Points,
  ShaderMaterial,
  TorusGeometry,
  Vector3,
} from 'three';
import type { FlightPath } from '../rig/FlightPath';
import rainVert from '../shaders/rain.vert.glsl';
import rainFrag from '../shaders/rain.frag.glsl';

const GATE_TS = [0.385, 0.415, 0.445] as const;

/**
 * CH5: the storm. Emissive red warning gates on the slalom line, shader-
 * animated rain sheet, and a lightning controller whose flash value the
 * engine feeds to the sky dome and bloom.
 */
export class Storm {
  readonly group = new Group();
  readonly light: PointLight;
  flash = 0;

  private rainMaterial: ShaderMaterial;
  private rainGeometry = new BufferGeometry();
  private nextFlash = 2;
  private gates: { t: number; material: MeshStandardMaterial }[] = [];
  private gatePositions: Vector3[] = [];
  private disposables: { dispose(): void }[] = [];

  constructor(path: FlightPath, rainCount: number, rand: () => number) {
    /**
     * One material PER gate, not one shared: each ring fades itself in on the
     * approach. Shared, the only control was the group's visibility flag, so
     * all three switched on together at t=0.3 and the nearest one appeared
     * fully lit a few units off the lens — the pop.
     */
    for (const gt of GATE_TS) {
      const p = path.storyPoint(gt);
      const g = new TorusGeometry(2.8, 0.14, 10, 40);
      const material = new MeshStandardMaterial({
        color: '#3a0f14',
        emissive: '#e24b4b',
        emissiveIntensity: 0,
        roughness: 0.5,
        transparent: true,
        opacity: 0,
      });
      const gate = new Mesh(g, material);
      gate.position.copy(p);
      gate.rotation.y = Math.PI / 2;
      this.group.add(gate);
      this.gates.push({ t: gt, material });
      this.gatePositions.push(p);
      this.disposables.push(g, material);
    }

    // rain volume around the slalom stretch
    const center = path.storyPoint(0.42);
    const boxMin = new Vector3(center.x - 30, center.y - 14, center.z - 25);
    const boxSize = new Vector3(60, 28, 50);
    const positions = new Float32Array(rainCount * 3);
    const phases = new Float32Array(rainCount);
    for (let i = 0; i < rainCount; i++) {
      positions[i * 3] = boxMin.x + rand() * boxSize.x;
      positions[i * 3 + 1] = boxMin.y + rand() * boxSize.y;
      positions[i * 3 + 2] = boxMin.z + rand() * boxSize.z;
      phases[i] = rand();
    }
    this.rainGeometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    this.rainGeometry.setAttribute('aPhase', new Float32BufferAttribute(phases, 1));
    this.rainMaterial = new ShaderMaterial({
      vertexShader: rainVert,
      fragmentShader: rainFrag,
      uniforms: {
        uTime: { value: 0 },
        uBoxMin: { value: boxMin },
        uBoxSize: { value: boxSize },
        uSpeed: { value: 34 },
        uColor: { value: new Color('#aab6d0') },
        uOpacity: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
    });
    const rain = new Points(this.rainGeometry, this.rainMaterial);
    rain.frustumCulled = false;
    this.group.add(rain);
    this.disposables.push(this.rainGeometry, this.rainMaterial);

    this.light = new PointLight('#eaf2ff', 0, 90, 1.6);
    this.light.position.copy(center).add(new Vector3(0, 10, 0));
    this.group.add(this.light);
  }

  /** stormness in [0,1] fades rain/lightning in and out around CH5. */
  update(time: number, dt: number, stormness: number, rand: () => number, t: number): void {
    this.rainMaterial.uniforms.uTime!.value = time;
    this.rainMaterial.uniforms.uOpacity!.value = stormness;

    /**
     * Each gate rises out of the murk on its own approach and drops away once
     * it is behind you.
     *
     * The ramp is driven by story-t, not by camera distance, so it replays
     * identically on every scroll-through. It is deliberately lopsided: 0.055
     * of story to arrive — a long way out, so the ring resolves gradually
     * through the rain — against 0.018 to leave, because a gate you have
     * already flown through is behind the lens and only costs fill.
     */
    for (const gate of this.gates) {
      const appear = MathUtils.smoothstep(t, gate.t - 0.075, gate.t - 0.02);
      const leave = 1 - MathUtils.smoothstep(t, gate.t + 0.012, gate.t + 0.03);
      const a = appear * leave * stormness;
      gate.material.opacity = a;
      gate.material.emissiveIntensity = 1.6 * a;
    }

    if (stormness > 0.2 && time > this.nextFlash) {
      this.flash = 1;
      // a strike every 0.7–2.0s instead of 1.8–4.6: at the old cadence the
      // slalom could be flown end to end on two flashes
      this.nextFlash = time + 0.7 + rand() * 1.3;
      const gate = this.gatePositions[Math.floor(rand() * this.gatePositions.length)]!;
      this.light.position.set(gate.x + (rand() - 0.5) * 16, gate.y + 8 + rand() * 6, gate.z + (rand() - 0.5) * 16);
    }
    // time-based decay (~150ms tail) — frame-based decay hangs bright under
    // rAF throttling and would freeze the flash on occluded windows
    this.flash *= Math.exp(-9 * dt);
    if (this.flash < 0.002) this.flash = 0;
    this.light.intensity = this.flash * 900 * stormness;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
