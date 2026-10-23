import type { InterleavedBufferAttribute, Texture, WebGLProgramParametersWithUniforms } from 'three';
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  NoColorSpace,
  Quaternion,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { facadeTexture } from '../bake/CanvasTextures';
import { adoptGlassAttributes, windowGlassMaterial } from '../materials/WindowGlass';
import { ReflectionProbe } from '../materials/ReflectionProbe';
import { asset } from '../asset';
import { requestCompile } from '../warm';
import { applyRoofs, roofAttributes } from '../materials/Roofs';

export interface KitLot {
  x: number; z: number; w: number; d: number; h: number;
  yaw: number; tint: string; moduleId: string;
  /** woodland beyond the town: drawn as a stand-in, never a module */
  forest?: boolean;
  /** a small tree on the verge of a street */
  street?: boolean;
}
export interface KitRingSet {
  near: number[]; mid: number[]; far: number[];
  /**
   * lots inside `near` that swap to their hero (close-up) module; absent means all of `near`. The night
   * city keeps a wide `near` for its dressing (neon, billboards) but can only afford full-geometry
   * towers on the lots the canyon actually brushes past.
   */
  hero?: number[];
  /** lots inside `mid` that swap to their `detail` module (trees; HIGH and LOW) */
  detail?: number[];
  /** lots inside `mid`, beyond `detail`, that swap to their `lite` module (trees; HIGH and LOW) */
  lite?: number[];
}
export interface KitModule {
  id: string; kind: string; lod0: string; footprint: [number, number]; height: number;
  /** which atlas the module samples; absent means 'main' */
  sheet?: string;
  /** set on a hero/detail module: the lean module it replaces */
  lean?: string;
  /** 'hero' replaces `lean` in the near ring (HIGH), 'detail' in the detail ring, 'lite' in the lite ring */
  lod?: 'hero' | 'detail' | 'lite';
  /** a house's main roofing colour (sRGB hex), what the baked roof pattern is read against */
  roof?: string;
}
/** One atlas: what is present depends on the sheet (hero trees have no normals or glow). */
export interface SheetAtlas {
  color: string; orm: string; normal?: string; emissive?: string;
  /** leaf cards: the colour map's alpha is a cut-out */
  alpha?: boolean;
  low: { color: string; orm: string; emissive?: string };
}
/** public/models/<dir>/manifest.json, written by blender/make_buildings.py */
export interface KitManifest {
  /** folder under /models/ that holds this set's GLBs and atlases */
  dir: string;
  atlas: SheetAtlas;
  /** extra sheets (hero tiers), keyed by name; `atlas` above is the 'main' sheet */
  sheets?: Record<string, { atlas: SheetAtlas }>;
  modules: KitModule[];
}

/**
 * Float copies of a loaded geometry's attributes. The GLBs are quantized (scripts/compress-models.mjs):
 * positions are normalized 16-bit integers scaled back up by their node's transform, and baking that
 * transform into the vertices (as the loader callback below does) needs room the integers do not have.
 */
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

/** Gable roof of unit size, ridge along x: the far-ring stand-in for a house roof. */
function roofPrism(): BufferGeometry {
  const A = [-0.5, -0.5, -0.5], B = [-0.5, -0.5, 0.5], C = [-0.5, 0.5, 0];
  const at = (p: number[], x: number): number[] => [x, p[1]!, p[2]!];
  const tri = (a: number[], b: number[], c: number[]): number[] => [...a, ...b, ...c];
  const quad = (a: number[], b: number[], c: number[], d: number[]): number[] =>
    [...tri(a, b, c), ...tri(a, c, d)];
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute([
    ...tri(at(A, -0.5), at(B, -0.5), at(C, -0.5)),
    ...tri(at(A, 0.5), at(C, 0.5), at(B, 0.5)),
    ...quad(at(A, -0.5), at(C, -0.5), at(C, 0.5), at(A, 0.5)),
    ...quad(at(B, -0.5), at(B, 0.5), at(C, 0.5), at(C, -0.5)),
  ], 3));
  g.computeVertexNormals();
  return g;
}

interface KitMaps {
  color: Texture; orm: Texture; emissive: Texture | null; normal: Texture | null; alpha: boolean;
}

export interface KitOptions {
  tier?: 'high' | 'low';
  /** strength of the baked lit windows, so a city can survive its chapter's fog */
  glow?: number;
  /**
   * Take image-based light and glass reflections from the baked daylight cloud
   * environment instead of the scene probe. The window district stands in a
   * cloud sea and wants it; the night city must not mirror a daytime sky.
   */
  cloudEnv?: boolean;
  /** real modules cast and receive the sun's shadows (HIGH, where the engine has a shadow map) */
  shadows?: boolean;
  /**
   * Give every house its own roof (materials/Roofs.ts): a roofing style and colour per lot,
   * weathering, solar arrays and skylights. The neighbourhood seen from above wants it.
   */
  roofs?: boolean;
}

/**
 * Kit-instanced city block shared by City (CH8) and Rooftops (window city).
 *
 * Every module is a few-dozen-triangle shell from blender/make_buildings.py,
 * and all of them sample ONE texture atlas (colour, occlusion/roughness/
 * metalness, lit-window glow, normals) baked from a detailed high-poly twin,
 * so the whole city is one material and one draw call per module type.
 *
 * At ~60 triangles a module the old near/mid/far split has nothing left to
 * save for the HIGH tier: the district is real buildings out to the horizon
 * and the FAR impostor box only exists for the phone tier's outer ring.
 */
export class KitCity {
  readonly group = new Group();
  private disposables: { dispose(): void }[] = [];

  /** atlas textures are shared by every city and never disposed with one */
  private static maps = new Map<string, KitMaps>();
  /** only the materials that opted into the cloud environment */
  private static materials = new Set<MeshStandardMaterial>();
  private static environment: Texture | null = null;
  private static envIntensity = 1;

  /**
   * The baked cloud-and-sky environment (blender/make_cloud_env.py). Buildings
   * take their image-based light and their glass reflections from it instead
   * of the night-sky probe the rest of the scene uses: a facade standing in a
   * cloud sea is lit from below by the deck and mirrors the clouds in its
   * glass, and the night probe has neither. Pass the PMREM-filtered texture.
   */
  static setEnvironment(texture: Texture): void {
    KitCity.environment = texture;
    for (const m of KitCity.materials) {
      m.envMap = texture;
      m.envMapIntensity = KitCity.envIntensity * (KitCity.envScale.get(m) ?? 1);
      m.needsUpdate = true;
    }
  }

  /** per-material multipliers on the shared environment intensity (see `adopt`) */
  private static envScale = new WeakMap<MeshStandardMaterial, number>();

  /**
   * Opts another material (puddles, wet ground) into the cloud environment, as the buildings' are,
   * at `scale` times the shared intensity.
   */
  static adopt(material: MeshStandardMaterial, scale = 1): void {
    KitCity.materials.add(material);
    KitCity.envScale.set(material, scale);
    if (!KitCity.environment) return;
    material.envMap = KitCity.environment;
    material.envMapIntensity = KitCity.envIntensity * scale;
    material.needsUpdate = true;
  }

  /**
   * An explicit envMap opts a material OUT of `scene.environmentIntensity`, so
   * the engine's per-chapter grade has to be pushed in by hand or the district
   * would stay at one brightness from dusk to the storm.
   */
  static setEnvIntensity(value: number): void {
    KitCity.envIntensity = value;
    for (const m of KitCity.materials) m.envMapIntensity = value * (KitCity.envScale.get(m) ?? 1);
  }

  private static loadMaps(manifest: KitManifest, sheet: string, tier: 'high' | 'low'): KitMaps {
    const cacheKey = `${manifest.dir}/${sheet}/${tier}`;
    const cached = KitCity.maps.get(cacheKey);
    if (cached) return cached;
    const atlas = sheet === 'main' ? manifest.atlas : manifest.sheets![sheet]!.atlas;
    const files = tier === 'low' ? atlas.low : atlas;
    const loader = new TextureLoader();
    const load = (file: string, srgb: boolean): Texture => {
      const texture = loader.load(asset(`/models/${manifest.dir}/${file}`));
      texture.flipY = false; // glTF UV convention
      texture.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
      texture.anisotropy = 8;
      return texture;
    };
    const maps: KitMaps = {
      color: load(files.color, true),
      orm: load(files.orm, false),
      emissive: files.emissive ? load(files.emissive, true) : null,
      // phones skip normals: the baked occlusion carries most of the depth and
      // the normal map costs a fourth texture fetch on every fragment
      normal: tier === 'high' && atlas.normal ? load(atlas.normal, false) : null,
      alpha: !!atlas.alpha,
    };
    KitCity.maps.set(cacheKey, maps);
    return maps;
  }

  /**
   * One material per city, sharing the single atlas upload. `glow` scales the
   * baked lit windows only: the window district hangs in dawn haze where the
   * chapter's fog would otherwise sink every house, while the night canyon
   * wants its own darkness.
   */
  private kitMaterial(
    manifest: KitManifest, sheet: string, tier: 'high' | 'low', glow: number, cloudEnv: boolean,
  ): MeshStandardMaterial {
    const maps = KitCity.loadMaps(manifest, sheet, tier);
    const material = new MeshStandardMaterial({
      map: maps.color,
      // glTF packs occlusion/roughness/metalness into one texture's R/G/B
      aoMap: maps.orm,
      roughnessMap: maps.orm,
      metalnessMap: maps.orm,
      roughness: 1,
      metalness: 1,
      ...(maps.emissive ? { emissive: '#ffffff', emissiveMap: maps.emissive, emissiveIntensity: glow } : {}),
      ...(maps.normal ? { normalMap: maps.normal } : {}),
      // leaf cards are cut-outs: no blending, so no sorting and no wrong draw order
      ...(maps.alpha ? { alphaTest: 0.42 } : {}),
    });
    if (cloudEnv) {
      if (KitCity.environment) {
        material.envMap = KitCity.environment;
        material.envMapIntensity = KitCity.envIntensity;
      }
      KitCity.materials.add(material);
    }
    if (maps.alpha) KitCity.foliage(material);
    this.disposables.push({ dispose: () => { KitCity.materials.delete(material); material.dispose(); } });
    return material;
  }

  /** seconds, for the wind in the trees; every city's foliage reads the one clock */
  static readonly windTime = { value: 0 };

  static tick(time: number): void {
    KitCity.windTime.value = time;
  }

  /**
   * The leaf-card sheets come alive: the whole tree leans in the wind from the root (more the
   * higher up, in world space so a street of trees sways together, a gust travelling across the
   * town), the cards flutter on top of that, and sunlight coming from behind a leaf glows through
   * it the way a canopy lights up against a low sun. Bark is the bottom half of the sheet
   * (atlas.py HERO_TREES), cards the top half, so the UV says which is which.
   */
  private static foliage(material: MeshStandardMaterial): void {
    material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
      shader.uniforms.uWindTime = KitCity.windTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uWindTime;\nvarying float vLeaf;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          {
            #ifdef USE_INSTANCING
              vec3 iPos = instanceMatrix[3].xyz;
              mat3 iRot = mat3(instanceMatrix);
            #else
              vec3 iPos = vec3(0.0);
              mat3 iRot = mat3(1.0);
            #endif
            vLeaf = step(uv.y, 0.5);
            float hgt = max(transformed.y, 0.0);
            float ph = dot(iPos.xz, vec2(0.13, 0.09));
            float gust = sin(uWindTime * 0.8 - ph) * 0.6 + sin(uWindTime * 1.9 - ph * 1.6) * 0.25 + 0.3;
            vec3 windW = vec3(0.8, 0.0, 0.6) * gust * hgt * hgt * 0.0045;
            vec3 windO = transpose(iRot) * windW / max(dot(iRot[0], iRot[0]), 1e-4);
            vec3 flutter = vec3(sin(uWindTime * 6.3 + transformed.x * 7.0 + ph),
                                sin(uWindTime * 5.1 + transformed.z * 6.0),
                                sin(uWindTime * 7.7 + transformed.y * 5.0 + ph));
            transformed += windO + flutter * vLeaf * 0.01 * min(hgt, 3.0);
          }`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vLeaf;')
        .replace(
          '#include <lights_fragment_end>',
          `#include <lights_fragment_end>
          #if NUM_DIR_LIGHTS > 0
            if (vLeaf > 0.5) {
              vec3 toLight = directionalLights[0].direction;
              vec3 toEye = normalize(vViewPosition);
              float back = pow(clamp(dot(toLight, -toEye), 0.0, 1.0), 3.0);
              float wrap = clamp(0.5 - 0.5 * dot(normal, toLight), 0.0, 1.0);
              reflectedLight.indirectDiffuse += diffuseColor.rgb * directionalLights[0].color
                * (back * 0.5 + wrap * 0.14) * vec3(1.0, 1.06, 0.7);
            }
          #endif`,
        );
    };
    material.customProgramCacheKey = () => 'kit-foliage';
  }

  constructor(
    lots: KitLot[],
    rings: KitRingSet,
    manifest: KitManifest,
    { tier = 'high', glow = 1, cloudEnv = false, shadows = false, roofs = false }: KitOptions = {},
    private color = new Color(),
  ) {
    const modules = manifest.modules;
    // guard against a rings file from a different bake than the lot list
    const valid = (indices: number[]): number[] => indices.filter((i) => lots[i] !== undefined);

    // real modules for NEAR and MID, impostor box for FAR (phones only, in
    // practice; see the class comment). The LOD decision was baked into the
    // ring lists, so there is zero per-frame LOD work here.
    const modelled = valid([...rings.near, ...rings.mid]);
    const far = valid(rings.far);
    const kindOf = (i: number): string | undefined =>
      modules.find((m) => m.id === lots[i]!.moduleId)?.kind;
    const farHomes = far.filter((i) => kindOf(i) === 'house' || kindOf(i) === 'tree');
    const farTowers = far.filter((i) => !farHomes.includes(i));
    if (farTowers.length) {
      const facade = facadeTexture();
      const impostorMaterial = new MeshStandardMaterial({
        color: '#7c869f',
        roughness: 0.85,
        emissive: '#e8b878',
        emissiveMap: facade,
        emissiveIntensity: 0.85,
      });
      this.disposables.push(facade, impostorMaterial);
      this.buildImpostors(lots, farTowers, impostorMaterial, tier);
    }
    if (farHomes.length) this.buildHomeImpostors(lots, farHomes, kindOf);

    // real kit modules, streamed in, one draw per module type. A lot in the NEAR
    // ring swaps to its hero (close-up) module when the set has one and the tier
    // can afford it; everything else, and every phone, gets the lean module.
    // the hero tier is for HIGH; detail and lite trees serve both tiers (phones read the half-size
    // atlases), so a phone's trees are real branches and leaves, not 40-triangle blobs
    const swaps = { hero: new Map<string, string>(), detail: new Map<string, string>(), lite: new Map<string, string>() };
    for (const m of modules) if (m.lean && (tier === 'high' || m.lod !== 'hero')) swaps[m.lod ?? 'hero'].set(m.lean, m.id);
    const nearSet = new Set(rings.hero ?? rings.near);
    const detailSet = new Set(rings.detail ?? []);
    const liteSet = new Set(rings.lite ?? []);
    const byModule = new Map<string, number[]>();
    for (const i of modelled) {
      const lean = lots[i]!.moduleId;
      const id = nearSet.has(i) ? swaps.hero.get(lean) ?? swaps.detail.get(lean) ?? lean
        : detailSet.has(i) ? swaps.detail.get(lean) ?? lean
        : liteSet.has(i) ? swaps.lite.get(lean) ?? lean : lean;
      const arr = byModule.get(id) ?? [];
      arr.push(i);
      byModule.set(id, arr);
    }
    const materials = new Map<string, MeshStandardMaterial>();
    // houses whose roofs the town dresses: one table of the modules' roofing colours, indexed per vertex
    const roofBases = [...new Set(modules.filter((m) => m.kind === 'house' && m.roof).map((m) => m.roof!))];
    const dressed = (mod: KitModule): boolean => roofs && mod.kind === 'house' && !!mod.roof;
    const materialFor = (mod: KitModule): MeshStandardMaterial => {
      const sheet = mod.sheet ?? 'main';
      const key = dressed(mod) ? `${sheet}:roofs` : sheet;
      let m = materials.get(key);
      if (!m) {
        m = this.kitMaterial(manifest, sheet, tier, glow, cloudEnv);
        if (dressed(mod)) applyRoofs(m, roofBases, tier === 'high');
        materials.set(key, m);
      }
      return m;
    };
    // the GLBs are welded, quantized and meshopt-packed (scripts/compress-models.mjs)
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    for (const [moduleId, indices] of byModule) {
      const mod = modules.find((m) => m.id === moduleId);
      if (!mod) continue;
      const material = materialFor(mod);
      loader.load(asset(`/models/${manifest.dir}/${mod.lod0}`), (gltf) => {
        let found: Mesh | null = null;
        let glassFound: Mesh | null = null;
        gltf.scene.updateMatrixWorld(true);
        gltf.scene.traverse((o) => {
          const mesh = o as Mesh;
          if (!mesh.isMesh) return;
          // a hero building carries its window panes as a second mesh, `glass` (Blender numbers a
          // repeated name, `glass.001`, and the loader drops the dot)
          if (mesh.name.startsWith('glass')) glassFound ??= mesh;
          else found ??= mesh;
        });
        // TS can't track the closure assignment — hold it in a plain const
        const source = found as Mesh | null;
        const glassSource = glassFound as Mesh | null;
        if (!source) return;
        // bake any node transform into the geometry before measuring it, so the
        // fit below is made against what is actually drawn
        const geometry = dequantized(source.geometry).applyMatrix4(source.matrixWorld);
        if (dressed(mod)) roofAttributes(geometry, roofBases.indexOf(mod.roof!));
        this.disposables.push(geometry);
        geometry.computeBoundingBox();
        const bounds = geometry.boundingBox!;
        // A hero building is the lean shell's own high-poly twin, and its awnings, cornices, gutters
        // and fire escapes stand proud of the shell: fitted by its own bounds it would come out a
        // size smaller than the lean module and off its plot. It is fitted by the shell's size (the
        // manifest records it for both), standing on the same ground plane. Trees are different
        // models per tier and keep fitting their own bounds.
        const shell = mod.lean && mod.kind !== 'tree';
        const baseY = shell ? 0 : bounds.min.y;
        const geomHeight = shell ? mod.height : bounds.max.y - bounds.min.y;
        const geomW = shell ? mod.footprint[0] : bounds.max.x - bounds.min.x;
        const geomD = shell ? mod.footprint[1] : bounds.max.z - bounds.min.z;
        const inst = new InstancedMesh(geometry, material, indices.length);
        const m4 = new Matrix4();
        const q = new Quaternion();
        const p = new Vector3();
        const s = new Vector3();
        const Y = new Vector3(0, 1, 0);
        indices.forEach((lotIndex, k) => {
          const lot = lots[lotIndex]!;
          q.setFromAxisAngle(Y, lot.yaw);
          // Fit the module INSIDE the lot box on all three axes, uniformly.
          // Lots are derived from the module (cityGen.mjs), so all three
          // ratios agree and the module lands at its own proportions; taking
          // the smallest keeps it undistorted and inside its plot if they
          // ever drift. Measured off the GEOMETRY (a hero off its shell, above).
          const fit = Math.min(lot.w / geomW, lot.d / geomD, lot.h / geomHeight);
          s.set(fit, fit, fit);
          p.set(lot.x, -baseY * fit, lot.z);
          inst.setMatrixAt(k, m4.compose(p, q, s));
          inst.setColorAt(k, this.color.set(lot.tint));
        });
        if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
        inst.castShadow = inst.receiveShadow = shadows;
        this.group.add(inst);
        this.disposables.push(inst);
        requestCompile(inst);
        if (glassSource) {
          // the panes, 4 mm proud of the baked ones, posed by the building's own instance matrices
          const glassGeometry = dequantized(glassSource.geometry).applyMatrix4(glassSource.matrixWorld);
          adoptGlassAttributes(glassGeometry);
          const glass = new InstancedMesh(glassGeometry, this.glassMaterial(cloudEnv), indices.length);
          glass.instanceMatrix = inst.instanceMatrix;
          glass.receiveShadow = shadows;
          this.group.add(glass);
          this.disposables.push(glassGeometry, glass);
          requestCompile(glass);
        }
      });
    }
  }

  private glass: MeshStandardMaterial | null = null;

  /**
   * One window material per city: homes look into living rooms and mirror the baked cloud sky; the
   * night city's towers look into offices and mirror the scene's own night probe.
   */
  private glassMaterial(cloudEnv: boolean): MeshStandardMaterial {
    if (this.glass) return this.glass;
    const material = windowGlassMaterial(cloudEnv ? KitCity.environment : null, !cloudEnv);
    if (ReflectionProbe.current) {
      // the live probe: the panes mirror the street they actually face (the houses opposite, the
      // trees, the lamps; the neon in the canyon), not a sky photographed somewhere else
      ReflectionProbe.adopt(material, 1);
    } else if (cloudEnv) {
      KitCity.materials.add(material);
      // the panes are a near-mirror: they carry the sky at full strength where a wall is matte
      KitCity.envScale.set(material, 1.25);
      material.envMapIntensity = KitCity.envIntensity * 1.25;
    }
    this.disposables.push({
      dispose: () => { KitCity.materials.delete(material); ReflectionProbe.release(material); material.dispose(); },
    });
    this.glass = material;
    return material;
  }

  private buildImpostors(
    lots: KitLot[],
    indices: number[],
    material: MeshStandardMaterial,
    tier: 'high' | 'low',
  ): void {
    const box = new BoxGeometry(1, 1, 1);
    // on HIGH, tall impostors read as two-tier setback towers — same single
    // draw call, one extra instance per tall lot, silhouettes stop being slabs
    const stacked = tier === 'high' ? indices.filter((i) => lots[i]!.h > 5) : [];
    const inst = new InstancedMesh(box, material, indices.length + stacked.length);
    const m4 = new Matrix4();
    const q = new Quaternion();
    const p = new Vector3();
    const s = new Vector3();
    const Y = new Vector3(0, 1, 0);
    let k = 0;
    const place = (lot: KitLot, cy: number, sw: number, sh: number, sd: number): void => {
      q.setFromAxisAngle(Y, lot.yaw);
      p.set(lot.x, cy, lot.z);
      s.set(sw, sh, sd);
      inst.setMatrixAt(k, m4.compose(p, q, s));
      inst.setColorAt(k, this.color.set(lot.tint));
      k++;
    };
    for (const lotIndex of indices) {
      const lot = lots[lotIndex]!;
      if (tier === 'high' && lot.h > 5) {
        place(lot, lot.h * 0.31, lot.w, lot.h * 0.62, lot.d);
      } else {
        place(lot, lot.h / 2, lot.w, lot.h, lot.d);
      }
    }
    for (const lotIndex of stacked) {
      const lot = lots[lotIndex]!;
      place(lot, lot.h * 0.62 + lot.h * 0.19, lot.w * 0.68, lot.h * 0.38, lot.d * 0.68);
    }
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    this.group.add(inst);
    this.disposables.push(box, inst);
    // MUST go through the engine hook like every other streamed mesh: this
    // one is built after the engine's first pass over the scene, so without
    // it the far city missed the blockout material swap and rendered black
    requestCompile(inst);
  }

  /**
   * Far ring of a neighbourhood: a box and a gable roof per house, a lumpy
   * ball per tree. At that distance a house is a few pixels, and its shape
   * against the lawn is all that is left to read.
   */
  private buildHomeImpostors(
    lots: KitLot[],
    indices: number[],
    kindOf: (i: number) => string | undefined,
  ): void {
    const houses = indices.filter((i) => kindOf(i) === 'house');
    const trees = indices.filter((i) => kindOf(i) === 'tree');
    const m4 = new Matrix4();
    const q = new Quaternion();
    const p = new Vector3();
    const s = new Vector3();
    const Y = new Vector3(0, 1, 0);
    const make = (
      geometry: BufferGeometry, material: MeshStandardMaterial, list: number[],
      place: (lot: KitLot) => [number, number, number, number, number, number],
      tinted: boolean,
    ): void => {
      const inst = new InstancedMesh(geometry, material, list.length);
      list.forEach((lotIndex, k) => {
        const lot = lots[lotIndex]!;
        const [x, y, z, sx, sy, sz] = place(lot);
        q.setFromAxisAngle(Y, lot.yaw);
        inst.setMatrixAt(k, m4.compose(p.set(x, y, z), q, s.set(sx, sy, sz)));
        if (tinted) inst.setColorAt(k, this.color.set(lot.tint));
      });
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
      this.group.add(inst);
      this.disposables.push(geometry, material, inst);
      requestCompile(inst);
    };
    if (houses.length) {
      make(new BoxGeometry(1, 1, 1), new MeshStandardMaterial({ color: '#d6cdbb', roughness: 0.9 }),
        houses, (l) => [l.x, l.h * 0.28, l.z, l.w, l.h * 0.56, l.d], true);
      make(roofPrism(), new MeshStandardMaterial({ color: '#4a4b52', roughness: 0.95, side: DoubleSide }),
        houses, (l) => [l.x, l.h * 0.56 + l.h * 0.22, l.z, l.w * 1.06, l.h * 0.44, l.d * 1.06], false);
    }
    if (trees.length) {
      // a woodland of thousands: 20-triangle blobs, the 80-triangle ones only for a few
      make(new IcosahedronGeometry(1, trees.length > 600 ? 0 : 1), new MeshStandardMaterial({ color: '#4d6c3a', roughness: 1 }),
        trees, (l) => [l.x, l.h * 0.62, l.z, l.w * 0.5, l.h * 0.4, l.d * 0.5], true);
    }
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
