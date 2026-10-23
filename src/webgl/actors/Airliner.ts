import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  Points,
  PointsMaterial,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
  type InterleavedBufferAttribute,
  type Material,
  type Texture,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { asset } from '../asset';
import { glowTexture } from '../bake/CanvasTextures';
import type { Tier } from '../quality';
import { requestCompile } from '../warm';

/**
 * An A320neo-class airliner, nose toward +x, up +y, starboard +z, 7.4 units long (the runway is 9
 * wide). The origin is the fuselage axis; the tyres touch ground at y = -wheelDrop. The main gear
 * stands `mainGearX` along the axis, the nose gear `noseGearX`; `wheelR` is a main tyre's radius.
 */
export const AIRLINER = { length: 7.4, wheelDrop: 0.72, mainGearX: 0.19, noseGearX: 2.7, wheelR: 0.115 };

export interface AirlinerOptions {
  /** 'low' loads the phone model (a third of the triangles, smaller livery, no clearcoat) */
  tier?: Tier;
  /** engines turning, strobes and landing/taxi lights on (the jet on the runway); else parked */
  running?: boolean;
}

/** a quantized (KHR_mesh_quantization) attribute set back to plain floats, so it can be baked */
function dequantized(source: BufferGeometry): BufferGeometry {
  const geometry = source.clone();
  for (const [name, attr] of Object.entries(geometry.attributes)) {
    if (attr.array instanceof Float32Array && !attr.normalized && !(attr as InterleavedBufferAttribute).isInterleavedBufferAttribute) continue;
    const n = attr.itemSize;
    const out = new Float32Array(attr.count * n);
    const get = [attr.getX, attr.getY, attr.getZ, attr.getW];
    for (let i = 0; i < attr.count; i++) for (let k = 0; k < n; k++) out[i * n + k] = get[k]!.call(attr, i);
    geometry.setAttribute(name, new BufferAttribute(out, n));
  }
  return geometry;
}

/** The loaded model, shared by every jet of a tier: geometry baked into the body's frame, the marks
 * (lights and fan axes) and the materials. */
interface Template {
  parts: { name: string; geometry: BufferGeometry }[];
  marks: Map<string, Vector3>;
  materials: Record<string, Material>;
  dispose(): void;
}

const templates = new Map<Tier, { promise: Promise<Template>; users: number }>();

async function loadTemplate(tier: Tier): Promise<Template> {
  const high = tier === 'high';
  const textures: Texture[] = [];
  const texture = (file: string): Texture => {
    const t = new TextureLoader().load(asset(`/models/airliner/${file}`));
    t.flipY = false; // glTF's UV convention
    t.colorSpace = SRGBColorSpace;
    t.anisotropy = high ? 8 : 2;
    textures.push(t);
    return t;
  };
  const livery = texture(high ? 'livery.webp' : 'livery-low.webp');
  const glow = texture('glow.webp');
  // gloss paint takes a clearcoat on HIGH, so the dawn sky slides along the hull
  const paint = (extra: ConstructorParameters<typeof MeshPhysicalMaterial>[0]): Material =>
    high
      ? new MeshPhysicalMaterial({ clearcoat: 0.75, clearcoatRoughness: 0.16, ...extra })
      : new MeshStandardMaterial(extra as ConstructorParameters<typeof MeshStandardMaterial>[0]);
  const std = (extra: ConstructorParameters<typeof MeshStandardMaterial>[0]): Material =>
    new MeshStandardMaterial({ vertexColors: true, ...extra });
  const materials: Record<string, Material> = {
    // the livery atlas; the cabin windows glow warm through the emissive map
    skin: paint({ map: livery, emissiveMap: glow, emissive: '#ffffff', emissiveIntensity: 0.7, roughness: 0.3, metalness: 0.04 }),
    paint: paint({ vertexColors: true, roughness: 0.36, metalness: 0.06 }),
    metal: std({ roughness: 0.24, metalness: 0.92 }),
    dark: std({ roughness: 0.6, metalness: 0.25 }),
    glass: new MeshStandardMaterial({ color: '#0a1016', roughness: 0.04, metalness: 0.9 }),
    lit: new MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
    fan: std({ roughness: 0.32, metalness: 0.75 }),
    gear_paint: std({ roughness: 0.45, metalness: 0.15 }),
    gear_metal: std({ roughness: 0.2, metalness: 0.95 }),
    wheel: std({ roughness: 0.62, metalness: 0.2 }),
  };
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(asset(`/models/airliner/${high ? 'airliner.glb' : 'airliner-low.glb'}`));
  const root = gltf.scene;
  root.updateMatrixWorld(true);
  const parts: Template['parts'] = [];
  const marks = new Map<string, Vector3>();
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (mesh.isMesh) {
      parts.push({ name: o.name, geometry: dequantized(mesh.geometry).applyMatrix4(mesh.matrixWorld) });
      mesh.geometry.dispose();
    } else if (o !== root && o.name) {
      marks.set(o.name, o.getWorldPosition(new Vector3()));
    }
  });
  return {
    parts,
    marks,
    materials,
    dispose: () => {
      for (const p of parts) p.geometry.dispose();
      for (const m of Object.values(materials)) m.dispose();
      for (const t of textures) t.dispose();
    },
  };
}

function acquire(tier: Tier): Promise<Template> {
  let entry = templates.get(tier);
  if (!entry) {
    entry = { promise: loadTemplate(tier), users: 0 };
    templates.set(tier, entry);
  }
  entry.users++;
  return entry.promise;
}

function release(tier: Tier): void {
  const entry = templates.get(tier);
  if (!entry || --entry.users > 0) return;
  templates.delete(tier);
  entry.promise.then((t) => t.dispose(), () => undefined);
}

/** after first paint, when the main thread has a moment */
function whenIdle(fn: () => void): void {
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (ric) ric(fn, { timeout: 3000 });
  else setTimeout(fn, 1200);
}

/**
 * The airliner, modelled in Blender (blender/make_airliner.py, ~45k triangles; the LOW tier ~12k):
 * a lofted fuselage with a shaped nose, framed cockpit glass, cabin windows, door outlines, a belly
 * fairing and a tail cone with the APU exhaust; swept wings with dihedral and an airfoil section,
 * slats, flaps on flap-track fairings, ailerons, spoiler panel lines and sharklets; high-bypass
 * nacelles with a metal intake lip, fan blades and spinner, cowl and reverser seams, the core
 * nozzle and plug on pylons; a fin and tailplane in the livery; main and nose gear with doors and
 * twin wheels; navigation, strobe, beacon, landing and taxi lights. It streams in after first
 * paint, shared between the jets of a tier. `wheels` spin, `gear` retracts, `body` pitches.
 */
export class Airliner {
  readonly group = new Group();
  readonly body = new Group();
  readonly gear = new Group();
  readonly wheels: { pivot: Object3D; r: number }[] = [];
  private fans: Object3D[] = [];
  private strobe: PointsMaterial | null = null;
  private beacon: PointsMaterial | null = null;
  private readonly tier: Tier;
  private readonly running: boolean;
  private disposed = false;
  private acquired = false;
  private disposables: { dispose(): void }[] = [];

  constructor(options: AirlinerOptions = {}) {
    this.tier = options.tier ?? 'high';
    this.running = options.running ?? false;
    this.body.add(this.gear);
    this.group.add(this.body);
    whenIdle(() => {
      if (this.disposed) return;
      this.acquired = true;
      acquire(this.tier).then(
        (t) => { if (!this.disposed) this.assemble(t); },
        (err) => console.warn('airliner model failed to load', err),
      );
    });
  }

  private assemble(t: Template): void {
    const high = this.tier === 'high';
    for (const { name, geometry } of t.parts) {
      const kind = name.startsWith('wheel') ? 'wheel' : name.startsWith('fan') ? 'fan' : name;
      const mesh = new Mesh(geometry, t.materials[kind] ?? t.materials.paint!);
      const lamp = kind === 'lit' || kind === 'glass';
      mesh.castShadow = !lamp;
      mesh.receiveShadow = high && !lamp;
      if (kind === 'wheel' || kind === 'fan') {
        // turn about its own axle: the wheel's is its middle, the fan's is marked in the model
        if (!geometry.boundingBox) geometry.computeBoundingBox();
        const box = geometry.boundingBox!;
        const centre = (kind === 'fan' && t.marks.get(name.replace('fan', 'fanaxis'))) || box.getCenter(new Vector3());
        const pivot = new Group();
        pivot.position.copy(centre);
        mesh.position.copy(centre).negate();
        pivot.add(mesh);
        if (kind === 'wheel') {
          this.gear.add(pivot);
          this.wheels.push({ pivot, r: (box.max.y - box.min.y) / 2 });
        } else {
          this.body.add(pivot);
          this.fans.push(pivot);
        }
      } else {
        (kind.startsWith('gear') ? this.gear : this.body).add(mesh);
      }
    }

    // the lamps' glow: steady red and green at the wingtips and white at the tail, a red beacon
    // top and bottom; running, the white strobes and the landing and taxi lights too
    const glow = glowTexture();
    this.disposables.push(glow);
    const dots = (names: string[], color: string, size: number): PointsMaterial => {
      const at: number[] = [];
      for (const n of names) {
        const p = t.marks.get(n);
        if (p) at.push(p.x, p.y, p.z);
      }
      const g = new BufferGeometry();
      g.setAttribute('position', new Float32BufferAttribute(at, 3));
      const m = new PointsMaterial({
        map: glow, color, size, transparent: true, depthWrite: false, blending: AdditiveBlending, sizeAttenuation: true,
      });
      const p = new Points(g, m);
      p.frustumCulled = false;
      this.body.add(p);
      this.disposables.push(g, m);
      return m;
    };
    dots(['nav_red'], '#ff3b30', 0.34);
    dots(['nav_green'], '#3bff7a', 0.34);
    dots(['nav_tail'], '#ffffff', 0.24);
    this.beacon = dots(['beacon_top', 'beacon_bot'], '#ff3b30', 0.42);
    if (this.running) {
      this.strobe = dots(['strobe_l', 'strobe_r', 'strobe_tail'], '#ffffff', 0.7);
      dots(['land_l', 'land_r'], '#fff4d8', 0.7);
      dots(['taxi'], '#fff4d8', 0.85);
    }
    requestCompile(this.group);
  }

  /** Strobes and the beacon flash, the fans turn; call every frame. */
  blink(time: number): void {
    const flash = (time * 1.1) % 1;
    if (this.strobe) this.strobe.opacity = flash < 0.06 || (flash > 0.14 && flash < 0.2) ? 1 : 0;
    if (this.beacon) this.beacon.opacity = Math.sin(time * 5) > 0.2 ? 0.9 : 0.12;
    // idling engines, or a parked fan windmilling in the breeze
    const rate = this.running ? 9 : 0.35;
    for (let i = 0; i < this.fans.length; i++) this.fans[i]!.rotation.x = time * rate + i;
  }

  /** Spin the tyres for `distance` travelled, retract the legs when `up` is 1. */
  rollAndGear(distance: number, up: number): void {
    for (const w of this.wheels) w.pivot.rotation.z = -distance / w.r;
    this.gear.visible = up < 0.98;
    this.gear.scale.y = Math.max(0.01, 1 - up);
    this.gear.position.y = up * 0.35;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const d of this.disposables) d.dispose();
    if (this.acquired) release(this.tier);
  }
}
