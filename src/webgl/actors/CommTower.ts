import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  MathUtils,
  Mesh,
  MeshDepthMaterial,
  MeshStandardMaterial,
  Object3D,
  Points,
  PointsMaterial,
  RGBADepthPacking,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  TextureLoader,
  Vector3,
  type InterleavedBufferAttribute,
  type Material,
  type Texture,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { asset } from '../asset';
import { glowTexture } from '../bake/CanvasTextures';
import type { Tier } from '../quality';
import { ENDING_BEATS, TUBE } from '../rig/endingPoints.mjs';
import { requestCompile } from '../warm';

/**
 * The communications tower at the end of the runway (docs/ending.md): the network's relay hub the dart flies into.
 * The model is blender/make_comm_tower.py's (public/models/comm-tower: a galvanised lattice with red/white banding,
 * the glass relay hall, three cabins, a gallery of six drum dishes, the main dish and the glass relay tube). The
 * dart enters the bell-mouth in the hall at the runway's height, rides the tube up the tower's core and leaves
 * through the main dish's feed; everything here is keyed to the line's own timetable (ENDING_BEATS), so it scrubs.
 *
 * Draws: the GLB's named parts are merged by material, each vertex keeping its part's id (`aGroup`), so the shader
 * can still turn the six drum dishes and nod the main dish about their pivots and flash the cabins, the racks, the
 * intake and the beacons: 3 draws on HIGH (steel, tube, hall glass), 2 on LOW (steel, glass), plus the pop's flecks
 * and flare for a moment at the dish. No lights: every glow is emissive. The steel casts the sun's shadow on HIGH.
 */

/** part ids (`aGroup`): 0 the steel; 1..6 the drum dishes; 7 the main dish; 8..10 the cabins' windows; 11..14 beacons; 15 racks; 16 the intake */
const GROUP: Record<string, number> = {
  lattice: 0, dish_1_mesh: 1, dish_2_mesh: 2, dish_3_mesh: 3, dish_4_mesh: 4, dish_5_mesh: 5, dish_6_mesh: 6, dish_main_mesh: 7,
  cabin_glow_1: 8, cabin_glow_2: 9, cabin_glow_3: 10, beacon_1: 11, beacon_2: 12, beacon_3: 13, beacon_4: 14, rack_glow: 15, intake_glow: 16,
};
const GROUPS = 17;
const PIVOTS = 8;

/** where the dart is in the tube (0 at the bell's throat, 1 at the dish's feed) at story-t */
export function tubeHead(t: number): number {
  return (t - ENDING_BEATS.intake) / (ENDING_BEATS.exit - ENDING_BEATS.intake);
}

/** the dart's height in the tube's straight at story-t (clamped to the straight) */
function dartY(t: number): number {
  const k = MathUtils.clamp((t - ENDING_BEATS.tube) / (ENDING_BEATS.tubeTop - ENDING_BEATS.tube), 0, 1);
  return TUBE.foot[1] + (TUBE.top[1] - TUBE.foot[1]) * k;
}

function easeOutBack(x: number): number {
  const c1 = 1.9;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

/** a quantized (KHR_mesh_quantization) attribute set back to plain floats, so the parts can be merged */
function plain(source: BufferGeometry): BufferGeometry {
  const g = new BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const attr = source.getAttribute(name) as BufferAttribute | InterleavedBufferAttribute | undefined;
    if (!attr) continue;
    const n = attr.itemSize;
    const out = new Float32Array(attr.count * n);
    for (let i = 0; i < attr.count; i++) {
      out[i * n] = attr.getX(i);
      if (n > 1) out[i * n + 1] = attr.getY(i);
      if (n > 2) out[i * n + 2] = attr.getZ(i);
    }
    g.setAttribute(name, new BufferAttribute(out, n));
  }
  if (source.index) g.setIndex(new BufferAttribute(Uint32Array.from(source.index.array as ArrayLike<number>), 1));
  return g;
}

export class CommTower {
  readonly group = new Group();
  readonly loaded: Promise<void>;
  private readonly high: boolean;
  private readonly glow = new Float32Array(GROUPS).fill(1);
  private readonly angle = new Float32Array(PIVOTS);
  private readonly pivot: Vector3[] = Array.from({ length: PIVOTS }, () => new Vector3());
  /** each drum dish's yaw as modelled (the shader turns it by -yaw0 to face +x) */
  private readonly yaw0 = new Float32Array(7);
  private cabinY = [8.4, 15.3, 20.7];
  private readonly streak = { head: { value: -1 }, after: { value: 0 }, idle: { value: 0 }, time: { value: 0 }, flash: { value: 0 } };
  private readonly towerUniforms = {
    uGlow: { value: this.glow },
    uAngle: { value: this.angle },
    uPivot: { value: this.pivot },
  };
  private steel: Mesh | null = null;
  private glassMat: MeshStandardMaterial | null = null;
  private flecks: Points;
  private fleckBase: Float32Array;
  private fleckVel: Float32Array;
  private flare: Sprite;
  private readonly exitWorld = new Vector3();
  private readonly bore = new Vector3(Math.cos(TUBE.exitPitch), Math.sin(TUBE.exitPitch), 0);
  private disposables: { dispose(): void }[] = [];

  constructor(position: Vector3, tier: Tier) {
    this.high = tier === 'high';
    this.group.position.copy(position);
    this.group.name = 'comm-tower';
    this.exitWorld.fromArray(TUBE.exit);
    // the pop at the dish: paper flecks thrown out along the boresight, and a flare (pure in t)
    const N = this.high ? 90 : 40;
    this.fleckBase = new Float32Array(N * 3);
    this.fleckVel = new Float32Array(N * 3);
    let seed = 7;
    const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < N; i++) {
      const spread = new Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).multiplyScalar(5.5);
      const v = this.bore.clone().multiplyScalar(3 + rnd() * 9).add(spread);
      this.fleckVel.set([v.x, v.y, v.z], i * 3);
    }
    const fg = new BufferGeometry();
    fg.setAttribute('position', new Float32BufferAttribute(new Float32Array(N * 3), 3));
    const fm = new PointsMaterial({
      map: glowTexture(), color: '#fff6e8', size: 0.22, transparent: true, opacity: 0, depthWrite: false, blending: AdditiveBlending,
    });
    this.flecks = new Points(fg, fm);
    this.flecks.frustumCulled = false;
    this.flecks.visible = false;
    const flareMat = new SpriteMaterial({
      map: fm.map, color: '#bffcff', transparent: true, opacity: 0, depthWrite: false, blending: AdditiveBlending, fog: false,
    });
    this.flare = new Sprite(flareMat);
    this.flare.visible = false;
    this.flare.position.fromArray(TUBE.exit).sub(position);
    this.group.add(this.flecks, this.flare);
    this.disposables.push(fg, fm, flareMat, fm.map!);
    this.loaded = this.load(tier);
  }

  private async load(tier: Tier): Promise<void> {
    const high = tier === 'high';
    const textures: Texture[] = [];
    const tex = (file: string, srgb: boolean): Texture => {
      const t = new TextureLoader().load(asset(`/models/comm-tower/${file}`));
      t.flipY = false;
      if (srgb) t.colorSpace = SRGBColorSpace;
      t.anisotropy = high ? 8 : 2;
      textures.push(t);
      return t;
    };
    const prefix = high ? 'tower' : 'tower-lean';
    const color = tex(`${prefix}-color.webp`, true);
    const emissive = tex(`${prefix}-emissive.webp`, true);
    const orm = high ? tex('tower-orm.webp', false) : null;
    const steel = new MeshStandardMaterial({
      map: color, emissiveMap: emissive, emissive: '#ffffff', emissiveIntensity: 1.6,
      ...(orm ? { roughnessMap: orm, metalnessMap: orm, roughness: 1, metalness: 1 } : { roughness: 0.55, metalness: 0.45 }),
      envMapIntensity: 0.9,
    });
    steel.onBeforeCompile = (shader) => this.patchSteel(shader);
    steel.customProgramCacheKey = () => 'comm-tower-steel';
    const tubeMat = new MeshStandardMaterial({
      color: '#cdeff7', transparent: true, opacity: 0.2, roughness: 0.05, metalness: 0.15, depthWrite: false, side: DoubleSide,
      emissive: '#000000', envMapIntensity: 1.4,
    });
    tubeMat.onBeforeCompile = (shader) => this.patchTube(shader);
    tubeMat.customProgramCacheKey = () => 'comm-tower-tube';
    const hallMat = new MeshStandardMaterial({
      color: '#a9cbd6', transparent: true, opacity: 0.26, roughness: 0.04, metalness: 0.3, depthWrite: false, side: DoubleSide,
      emissive: '#3ff0d0', emissiveIntensity: 0, envMapIntensity: 1.2,
    });
    this.glassMat = hallMat;
    this.disposables.push(steel, tubeMat, hallMat, ...textures);

    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.loadAsync(asset(`/models/comm-tower/${high ? 'tower.glb' : 'tower-lean.glb'}`));
    const root = gltf.scene;
    root.updateMatrixWorld(true);
    const steelParts: BufferGeometry[] = [];
    const tubeParts: BufferGeometry[] = [];
    const hallParts: BufferGeometry[] = [];
    const tagged = (g: BufferGeometry, id: number): BufferGeometry => {
      g.setAttribute('aGroup', new BufferAttribute(new Float32Array(g.getAttribute('position')!.count).fill(id), 1));
      return g;
    };
    const centroid = new Vector3();
    root.traverse((o: Object3D) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) {
        const m = /^dish_(\d|main)$/.exec(o.name);
        if (m) this.pivot[m[1] === 'main' ? 7 : Number(m[1])]!.copy(o.getWorldPosition(new Vector3()));
        return;
      }
      const g = plain(mesh.geometry).applyMatrix4(mesh.matrixWorld);
      mesh.geometry.dispose();
      if (o.name === 'tube') {
        tubeParts.push(tagged(g, 0));
        return;
      }
      if (o.name === 'hall_glass') {
        // on LOW the hall's glass rides in the tube's draw: its uv.y is put far out of the streak's range
        if (!high) {
          const uv = g.getAttribute('uv') as BufferAttribute;
          for (let i = 0; i < uv.count; i++) uv.setY(i, -10);
          tubeParts.push(tagged(g, 0));
        } else hallParts.push(tagged(g, 0));
        return;
      }
      const id = GROUP[o.name] ?? 0;
      if (id >= 8 && id <= 10) {
        g.computeBoundingBox();
        this.cabinY[id - 8] = (g.boundingBox!.min.y + g.boundingBox!.max.y) / 2;
      }
      if (id >= 1 && id <= 6) {
        // which way the drum faces as modelled: from its pole to the middle of the drum
        const pos = g.getAttribute('position') as BufferAttribute;
        centroid.set(0, 0, 0);
        for (let i = 0; i < pos.count; i++) centroid.x += pos.getX(i), centroid.z += pos.getZ(i);
        centroid.multiplyScalar(1 / pos.count);
        this.yaw0[id] = Math.atan2(centroid.z - this.pivot[id]!.z, centroid.x - this.pivot[id]!.x);
      }
      steelParts.push(tagged(g, id));
    });
    const add = (parts: BufferGeometry[], mat: Material, name: string, shadow = false): Mesh | null => {
      if (!parts.length) return null;
      const merged = mergeGeometries(parts, false);
      for (const p of parts) p.dispose();
      if (!merged) return null;
      const m = new Mesh(merged, mat);
      m.name = name;
      m.castShadow = shadow;
      m.receiveShadow = high;
      this.group.add(m);
      this.disposables.push(merged);
      return m;
    };
    this.steel = add(steelParts, steel, 'comm-tower-steel', high);
    if (this.steel && high) {
      // the dishes turn in the shader: the shadow pass has to turn them too
      const depth = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
      depth.onBeforeCompile = (shader) => this.patchVertex(shader);
      depth.customProgramCacheKey = () => 'comm-tower-depth';
      this.steel.customDepthMaterial = depth;
      this.disposables.push(depth);
    }
    const tube = add(tubeParts, tubeMat, 'comm-tower-tube');
    if (tube) tube.renderOrder = 2;
    const hall = add(hallParts, hallMat, 'comm-tower-hall-glass');
    if (hall) hall.renderOrder = 1;
    requestCompile(this.group);
  }

  /** the dishes' turns and the parts' glow ids, shared by the colour and the shadow programs */
  private patchVertex(shader: WebGLProgramParametersWithUniforms): void {
    Object.assign(shader.uniforms, this.towerUniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float aGroup;
uniform float uAngle[${PIVOTS}];
uniform vec3 uPivot[${PIVOTS}];
uniform float uGlow[${GROUPS}];
varying float vGlow;
vec3 ctTurn(vec3 p, int g, bool isDir) {
  if (g < 1 || g > 7) return p;
  float a = uAngle[g];
  float c = cos(a), s = sin(a);
  vec3 q = isDir ? p : p - uPivot[g];
  // drums yaw about +y; the main dish nods about +z
  q = g <= 6 ? vec3(c * q.x - s * q.z, q.y, s * q.x + c * q.z) : vec3(c * q.x - s * q.y, s * q.x + c * q.y, q.z);
  return isDir ? q : q + uPivot[g];
}`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
int ctG = int(aGroup + 0.5);
transformed = ctTurn(transformed, ctG, false);
vGlow = uGlow[ctG];`,
      );
    if (shader.vertexShader.includes('#include <beginnormal_vertex>')) {
      shader.vertexShader = shader.vertexShader.replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
objectNormal = ctTurn(objectNormal, int(aGroup + 0.5), true);`,
      );
    }
  }

  private patchSteel(shader: WebGLProgramParametersWithUniforms): void {
    this.patchVertex(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGlow;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= vGlow;');
  }

  /** the light streak up the tube: a bright head where the dart is, a trail behind it, an afterglow once it is through */
  private patchTube(shader: WebGLProgramParametersWithUniforms): void {
    shader.uniforms.uHead = this.streak.head;
    shader.uniforms.uAfter = this.streak.after;
    shader.uniforms.uIdle = this.streak.idle;
    shader.uniforms.uTime = this.streak.time;
    shader.uniforms.uFlash = this.streak.flash;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vArc;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvArc = uv.y;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying float vArc;
uniform float uHead, uAfter, uIdle, uTime, uFlash;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
{
  float v = vArc;
  float on = step(-0.5, v);
  float d = v - uHead;
  float head = exp(-d * d / 0.0006);
  float trail = d < 0.0 ? exp(d * 3.2) : 0.0;
  // traffic: faint pulses running up the tube while it waits
  float pulse = pow(0.5 + 0.5 * sin((v * 9.0 - uTime * 0.9) * 6.2831), 6.0);
  float s = head * 10.0 + trail * 4.0 * step(0.0, uHead) * step(uHead, 1.25) + uAfter * (0.45 + 0.55 * v) + uIdle * (0.12 + 0.5 * pulse) + uFlash * (1.0 - v);
  vec3 streak = mix(vec3(0.16, 0.92, 0.80), vec3(0.85, 1.0, 0.97), clamp(head, 0.0, 1.0)) * s * on;
  totalEmissiveRadiance += streak;
  diffuseColor.a = max(diffuseColor.a, clamp(s * 0.25, 0.0, 0.85) * on);
}`,
      );
  }

  /**
   * `power` 0..1: the airfield's lights coming up out of the cloud (Landing). Pure in t apart from the beacons'
   * blink and the tube's idle traffic, which run on the clock.
   */
  update(t: number, time: number, power: number): void {
    if (!this.group.visible) return;
    const B = ENDING_BEATS;
    const head = tubeHead(t);
    // the intake: the hall flashes white-teal as the dart is swallowed
    const intake = Math.exp(-(((t - B.intake) / 0.0028) ** 2));
    // the pop: the feed flashes as the dart leaves the dish
    const pop = t > B.exit - 0.004 ? Math.exp(-(((t - B.exit) / 0.0035) ** 2)) : 0;
    const passed = MathUtils.smoothstep(t, B.intake, B.intake + 0.004);
    const through = MathUtils.smoothstep(t, B.exit, B.exit + 0.003);
    const after = through * Math.exp(-Math.max(0, t - B.exit) * 60);

    // parts' glow (emissive multipliers)
    const g = this.glow;
    g[0] = 1;
    const y = dartY(t);
    const inTube = t > B.tube - 0.002 && t < B.tubeTop + 0.004 ? 1 : 0;
    for (let i = 0; i < 3; i++) {
      const near = Math.exp(-(((y - this.cabinY[i]!) / 1.6) ** 2)) * inTube;
      const relayed = MathUtils.smoothstep(y, this.cabinY[i]! - 0.5, this.cabinY[i]! + 1.5) * passed;
      g[8 + i] = power * (0.55 + 6 * near + 0.9 * relayed);
    }
    for (let i = 0; i < 4; i++) {
      // aviation red: a soft on/off at about 1 Hz, each beacon a little out of step
      const ph = (time * 0.75 + i * 0.13) % 1;
      const blink = ph < 0.42 ? Math.sin((ph / 0.42) * Math.PI) : 0;
      g[11 + i] = power * (0.12 + 2.2 * blink);
    }
    g[15] = power * (0.8 + 4 * intake + 0.6 * passed);
    g[16] = power * (0.6 + 0.35 * Math.sin(time * 2.4)) * (1 - passed * 0.4) + 7 * intake + 0.8 * passed * power;
    g[7] = power * (0.7 + 9 * pop + 2.5 * after);
    for (let i = 1; i <= 6; i++) g[i] = power;

    // the six drums snap round to face +x one after another while the light climbs; the main dish lifts onto
    // its 35 degrees just before the dart reaches it
    for (let i = 1; i <= 6; i++) {
      const at = B.tube + ((i - 0.4) / 6.4) * (B.tubeTop - B.tube);
      const k = MathUtils.clamp((t - at) / 0.0018, 0, 1);
      this.angle[i] = -this.yaw0[i]! * (k > 0 ? easeOutBack(k) : 0);
    }
    this.angle[7] = -0.13 * (1 - MathUtils.smoothstep(t, B.tube, B.tubeTop - 0.001));

    // the tube's streak
    this.streak.head.value = t < B.intake - 0.01 ? -1 : head;
    this.streak.after.value = after * 2.5 + through * 0.35;
    this.streak.idle.value = power * (1 - passed);
    this.streak.time.value = time;
    this.streak.flash.value = intake * 3;
    if (this.glassMat) this.glassMat.emissiveIntensity = intake * 2.2 + passed * 0.06;

    // the pop: flecks out along the boresight, a flare at the feed
    const k = (t - B.exit) / 0.012;
    const show = k > -0.05 && k < 1;
    this.flecks.visible = show;
    this.flare.visible = show;
    if (show) {
      const kk = MathUtils.clamp(k, 0, 1);
      const travel = 1 - Math.pow(1 - kk, 2.2);
      const attr = this.flecks.geometry.getAttribute('position') as BufferAttribute;
      const arr = attr.array as Float32Array;
      const ox = this.exitWorld.x - this.group.position.x;
      const oy = this.exitWorld.y - this.group.position.y;
      const oz = this.exitWorld.z - this.group.position.z;
      for (let i = 0; i < arr.length; i += 3) {
        arr[i] = ox + this.fleckVel[i]! * travel;
        arr[i + 1] = oy + this.fleckVel[i + 1]! * travel - 3.5 * kk * kk;
        arr[i + 2] = oz + this.fleckVel[i + 2]! * travel;
      }
      attr.needsUpdate = true;
      (this.flecks.material as PointsMaterial).opacity = (1 - kk) * (1 - kk) * Math.min(1, k * 20 + 1);
      const fl = Math.exp(-((k / 0.25) ** 2));
      (this.flare.material as SpriteMaterial).opacity = fl;
      this.flare.scale.setScalar(4 + 10 * fl);
    }
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.steel?.geometry.dispose();
  }
}
