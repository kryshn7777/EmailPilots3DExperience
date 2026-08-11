import type { Texture } from 'three';
import {
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { facadeTexture } from '../bake/CanvasTextures';
import { asset } from '../asset';
import { requestCompile } from '../warm';

export interface KitLot {
  x: number; z: number; w: number; d: number; h: number;
  yaw: number; tint: string; moduleId: string;
}
export interface KitRingSet { near: number[]; mid: number[]; far: number[] }
interface KitModule { id: string; lod0: string; footprint: [number, number]; height: number }

/**
 * Kit-instanced city block shared by City (CH8) and Rooftops (window city).
 * NEAR ring renders real kit modules (one InstancedMesh per module, one
 * shared colormap material); MID and FAR render the emissive-facade
 * impostor box — the LOD decision was baked into the ring lists, so there
 * is zero per-frame LOD work here.
 */
export class KitCity {
  readonly group = new Group();
  private disposables: { dispose(): void }[] = [];
  private static sharedColormap: Texture | null = null;
  private kitMaterialInstance: MeshStandardMaterial | null = null;

  /**
   * One material per city, sharing the single colormap upload. They differ
   * only in self-lit strength: the window district hangs in dawn haze where
   * the chapter's fog would otherwise crush every tower to a black cut-out,
   * while the night canyon wants its own darkness.
   */
  private kitMaterial(glow: number): MeshStandardMaterial {
    if (!KitCity.sharedColormap) {
      const colormap = new TextureLoader().load(asset('/models/city-kit/colormap.png'));
      colormap.colorSpace = SRGBColorSpace;
      colormap.flipY = false; // glTF UV convention
      KitCity.sharedColormap = colormap;
    }
    if (!this.kitMaterialInstance) {
      this.kitMaterialInstance = new MeshStandardMaterial({
        map: KitCity.sharedColormap,
        // light multiplier: #7d86a3 crushed the palette to flat navy — the
        // night mood comes from the scene grade, not from killing the map
        color: '#c6ccdd',
        // glass-and-steel towers catch the sky probe: at 0.85 rough with no
        // env weight they were matte cardboard under any lighting
        roughness: 0.55,
        metalness: 0.25,
        envMapIntensity: 1.35,
        emissive: '#26314c',
        emissiveIntensity: glow,
      });
      this.disposables.push(this.kitMaterialInstance);
    }
    return this.kitMaterialInstance;
  }

  constructor(
    lots: KitLot[],
    rings: KitRingSet,
    modules: KitModule[],
    tier: 'high' | 'low' = 'high',
    /** lit window quads on all four walls — for cities without their own
     * dressing pass (City runs a canyon-tuned builder of its own) */
    dressWindows = false,
    /** self-lit strength, so a city can survive its chapter's fog */
    glow = 0.5,
    private color = new Color(),
  ) {
    // guard against a rings file from a different bake than the lot list
    const valid = (indices: number[]): number[] => indices.filter((i) => lots[i] !== undefined);

    /**
     * LOD split: real kit modules for NEAR **and MID**, impostor box for FAR.
     *
     * Decimated mesh LODs were generated and measured, and they do not work
     * on this kit — meshopt returns 6-35% off even when asked for 15%,
     * because flat shading splits a normal at every hard edge and there is
     * no interior detail to collapse (see scripts/bake-kit-lods.mjs). The
     * real LOD for a blocky building is a box: the impostor is 12 triangles
     * against ~1800.
     *
     * So the balance is drawn by distance instead of by decimation. MID was
     * on the impostor before and is promoted to real geometry now that
     * modules render at their true lot size — it is the band the camera can
     * still resolve. FAR stays impostors, which is where the ~100x saving
     * lives and where nothing is resolvable anyway. Draw calls do not scale
     * with lot count either way: modules instance per type.
     */
    const modelled = valid([...rings.near, ...rings.mid]);
    // FAR: emissive facade impostors (windows live in the texture)
    const facade = facadeTexture();
    const impostorMaterial = new MeshStandardMaterial({
      // lifted toward the kit material's own tone: with the mid boundary
      // pulled in to 45 the impostors start mid-frame, and at #39415a the
      // swap from real module to box read as a tide line across the district
      color: '#7c869f',
      roughness: 0.85,
      emissive: '#e8b878',
      emissiveMap: facade,
      emissiveIntensity: 0.85,
    });
    this.disposables.push(facade, impostorMaterial);
    this.buildImpostors(lots, valid(rings.far), impostorMaterial, tier);
    // roof clutter stays a NEAR-ring treat. Spread over every lot in the
    // district it stops reading as detail and becomes a carpet of specks and
    // masts across the whole horizon.
    if (tier === 'high') this.buildRoofDressing(lots, valid(rings.near), modules);
    // the impostors used to carry the district's lit windows in their facade
    // texture; with them gone the band pass has to reach every lot or the
    // city goes dark past the near ring
    if (dressWindows) this.buildWindowBands(lots, modelled, modules, tier);

    // real kit modules, streamed in, one draw per module type
    const byModule = new Map<string, number[]>();
    for (const i of modelled) {
      const arr = byModule.get(lots[i]!.moduleId) ?? [];
      arr.push(i);
      byModule.set(lots[i]!.moduleId, arr);
    }
    const loader = new GLTFLoader();
    for (const [moduleId, indices] of byModule) {
      const mod = modules.find((m) => m.id === moduleId);
      if (!mod) continue;
      loader.load(`/models/city-kit/${mod.lod0}`, (gltf) => {
        let found: Mesh | null = null;
        gltf.scene.updateMatrixWorld(true);
        gltf.scene.traverse((o) => {
          const mesh = o as Mesh;
          if (mesh.isMesh && !found) found = mesh;
        });
        // TS can't track the closure assignment — hold it in a plain const
        const source = found as Mesh | null;
        if (!source) return;
        /**
         * Bake the node transform into the geometry before measuring it.
         *
         * scripts/bake-kit-lods.mjs records footprint/height BEFORE running
         * gltf-transform's quantize(), and quantize normalises the POSITION
         * accessor into a unit range and puts the real size back on the NODE
         * as a scale. Reading mesh.geometry alone therefore threw that scale
         * away: every lod0 arrived with its largest dimension exactly 2, so
         * `lot.h / mod.height` sized towers by a manifest that no longer
         * described them — modules rendered at 37%–184% of their lot height
         * while the window bands, roof clutter and neighbouring impostors all
         * sat at the full lot.h. That is the district where the lights float
         * clear of the buildings.
         */
        const geometry = source.geometry.clone().applyMatrix4(source.matrixWorld);
        this.disposables.push(geometry);
        // module pivots are not exactly ground-zero; a few cm of offset
        // scaled ×7 on a tower floats the roof dressing above the mesh
        geometry.computeBoundingBox();
        const bounds = geometry.boundingBox!;
        const baseY = bounds.min.y;
        const geomHeight = bounds.max.y - bounds.min.y;
        const geomW = bounds.max.x - bounds.min.x;
        const geomD = bounds.max.z - bounds.min.z;
        const inst = new InstancedMesh(geometry, this.kitMaterial(glow), indices.length);
        const m4 = new Matrix4();
        const q = new Quaternion();
        const p = new Vector3();
        const s = new Vector3();
        const Y = new Vector3(0, 1, 0);
        indices.forEach((lotIndex, k) => {
          const lot = lots[lotIndex]!;
          q.setFromAxisAngle(Y, lot.yaw);
          // UNIFORM fit measured off the GEOMETRY, never off the manifest.
          // The lod0 files are each uniformly rescaled so their largest
          // dimension is 2, while manifest.footprint/height still describe
          // the pre-bake source — so `lot.h / mod.height` sized every tower
          // by a factor of 2/maxSourceDim, between 0.37× and 1.84×. The
          // buildings came out short or tall while the window bands, roof
          // clutter and impostor neighbours all sat at the full lot.h, which
          // is the district reading as lights floating clear of buildings.
          //
          // Proportions survive the rescale, so one factor off the height is
          // both uniform (no facade stretch) and exact: the footprint lands
          // on lot.w/lot.d of its own accord.
          // Fit the module INSIDE the lot box on all three axes, uniformly.
          //
          // Height alone is not enough: the kit has squat modules (one is
          // 0.88 wide by 0.89 tall), and scaling those to a 6-unit lot height
          // made them 11 units wide on a 4.2-unit street grid — every
          // building growing through its neighbours. Taking the smallest of
          // the three ratios keeps the module undistorted AND inside its plot.
          //
          // Rooftop lots derive w/d/h from this same module, so all three
          // ratios are equal there and the height still lands exactly on
          // lot.h — which is what the window bands and roof clutter are
          // placed against.
          const fit = Math.min(lot.w / geomW, lot.d / geomD, lot.h / geomHeight);
          s.set(fit, fit, fit);
          p.set(lot.x, -baseY * fit, lot.z);
          inst.setMatrixAt(k, m4.compose(p, q, s));
          inst.setColorAt(k, this.color.set(lot.tint));
        });
        if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
        this.group.add(inst);
        this.disposables.push(inst);
        requestCompile(inst);
      });
    }
  }

  private buildImpostors(
    lots: KitLot[],
    indices: number[],
    material: MeshStandardMaterial,
    tier: 'high' | 'low',
  ): void {
    if (!indices.length) return;
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
    // it the whole far city missed the blockout material swap and rendered
    // black — a lit-window swarm with no buildings behind it
    requestCompile(inst);
  }

  /** module half-extents after the uniform footprint fit, in lot-local axes */
  private fit(lot: KitLot, modules: KitModule[]): { hx: number; hz: number } | null {
    const mod = modules.find((m) => m.id === lot.moduleId);
    if (!mod) return null;
    const sxz = Math.min(lot.w / mod.footprint[0], lot.d / mod.footprint[1]);
    return { hx: (mod.footprint[0] * sxz) / 2, hz: (mod.footprint[1] * sxz) / 2 };
  }

  /**
   * Lit window quads banded up all four walls of every NEAR lot. One
   * InstancedMesh, one draw, ~2 tris per window — the "someone is awake in
   * there" read that turns kit massing into a night city, at a cost the
   * budget cannot notice. Offsets are lot-local and rotated by the lot yaw,
   * so they land on real walls whatever way the module faces.
   */
  private buildWindowBands(
    lots: KitLot[],
    near: number[],
    modules: KitModule[],
    tier: 'high' | 'low',
  ): void {
    const hash = (n: number, salt: number): number => {
      const x = Math.sin(n * 127.1 + salt * 311.7) * 43758.5453;
      return x - Math.floor(x);
    };
    // sparser and smaller than before: at 0.62 with spacing-sized quads the
    // windows out-read the buildings and the district became a light swarm
    const density = tier === 'high' ? 0.42 : 0.3;
    const Y = new Vector3(0, 1, 0);
    const FACES: [number, number, number][] = [
      // [normal x, normal z, extra yaw for the quad]
      [0, 1, 0],
      [0, -1, Math.PI],
      [1, 0, Math.PI / 2],
      [-1, 0, -Math.PI / 2],
    ];
    const mats: Matrix4[] = [];
    const lit: number[] = [];
    const q = new Quaternion();
    const fq = new Quaternion();
    let salt = 0;
    for (const i of near) {
      const lot = lots[i]!;
      const e = this.fit(lot, modules);
      if (!e) continue;
      q.setFromAxisAngle(Y, lot.yaw);
      // bands are a FRACTION of the lot height, never a fixed pitch: these
      // lots run from 2-unit shopfronts to 9-unit towers, and a fixed pitch
      // put every window on one ground-floor band hidden behind the block
      // quads are sized from their own spacing, never a fixed clamp: on a
      // 22-unit tower a 0.5-unit window is a speck, and hundreds of specks
      // read as noise floating where the facade should be
      const bands = Math.min(5, Math.max(2, Math.round(lot.h / 3.2)));
      const wy = Math.max(0.24, ((lot.h * 0.6) / bands) * 0.3);
      for (let f = 0; f < bands; f++) {
        const y = lot.h * (0.2 + ((f + 0.5) / bands) * 0.6);
        for (const [nx, nz, faceYaw] of FACES) {
          const span = nx ? e.hz : e.hx;
          const cols = Math.min(5, Math.max(2, Math.round(span * 1.1)));
          const wx = Math.max(0.24, ((span * 2) / cols) * 0.36);
          for (let c = 0; c < cols; c++) {
            salt++;
            if (hash(i, salt) > density) continue;
            const u = -span + ((c + 0.5) / cols) * span * 2;
            const local = new Vector3(
              nx ? nx * (e.hx + 0.03) : u,
              y,
              nz ? nz * (e.hz + 0.03) : u,
            ).applyQuaternion(q);
            fq.setFromAxisAngle(Y, lot.yaw + faceYaw);
            mats.push(
              new Matrix4().compose(
                new Vector3(lot.x + local.x, y, lot.z + local.z),
                fq,
                new Vector3(wx, wy, 1),
              ),
            );
            lit.push(hash(i, salt + 977) < 0.7 ? 0.7 + hash(i, salt + 31) * 0.9 : 0.09);
          }
        }
      }
    }
    if (!mats.length) return;
    const geometry = new PlaneGeometry(1, 1);
    const material = new MeshBasicMaterial({ color: '#ffffff' });
    const inst = new InstancedMesh(geometry, material, mats.length);
    const amber = new Color('#ffc96b');
    mats.forEach((m, k) => {
      inst.setMatrixAt(k, m);
      inst.setColorAt(k, this.color.copy(amber).multiplyScalar(lit[k]!));
    });
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    this.group.add(inst);
    this.disposables.push(geometry, material, inst);
    requestCompile(inst);
  }

  /**
   * NEAR-ring roof clutter, HIGH tier only: AC units, antenna masts, and
   * water tanks scattered deterministically per lot. Three InstancedMeshes
   * total — perceived detail scales with zero per-frame cost and +3 draws.
   * Placement uses the same uniform-fit footprint the module instancing
   * uses, so clutter sits on real roof area, never on alley air.
   */
  private buildRoofDressing(lots: KitLot[], near: number[], modules: KitModule[]): void {
    if (!near.length) return;
    const hash = (n: number, salt: number): number => {
      const x = Math.sin(n * 127.1 + salt * 311.7) * 43758.5453;
      return x - Math.floor(x);
    };
    const metal = new MeshStandardMaterial({
      color: '#39404f',
      roughness: 0.65,
      metalness: 0.35,
      emissive: '#0b0e16',
      emissiveIntensity: 0.4,
    });
    const acGeometry = new BoxGeometry(0.55, 0.3, 0.55);
    const mastGeometry = new CylinderGeometry(0.025, 0.035, 1, 5);
    const tankGeometry = new CylinderGeometry(0.34, 0.34, 0.6, 10);
    this.disposables.push(metal, acGeometry, mastGeometry, tankGeometry);

    const ac: Matrix4[] = [];
    const masts: Matrix4[] = [];
    const tanks: Matrix4[] = [];
    const q = new Quaternion();
    const Y = new Vector3(0, 1, 0);
    for (const i of near) {
      const lot = lots[i]!;
      const e = this.fit(lot, modules);
      if (!e) continue;
      // usable roof half-extents, pulled in from the parapet
      const hx = e.hx - 0.45;
      const hz = e.hz - 0.45;
      if (hx < 0.3 || hz < 0.3) continue;
      q.setFromAxisAngle(Y, lot.yaw);
      const at = (ox: number, oz: number, y: number, sy: number, list: Matrix4[]): void => {
        const local = new Vector3(ox, 0, oz).applyQuaternion(q);
        list.push(
          new Matrix4().compose(
            new Vector3(lot.x + local.x, y, lot.z + local.z),
            q,
            new Vector3(1, sy, 1),
          ),
        );
      };
      const acCount = 1 + Math.floor(hash(i, 1) * 2.6);
      for (let a = 0; a < acCount; a++) {
        at(
          (hash(i, 2 + a) * 2 - 1) * hx,
          (hash(i, 5 + a) * 2 - 1) * hz,
          lot.h + 0.15,
          1,
          ac,
        );
      }
      if (hash(i, 9) < 0.55) {
        const mastH = lot.h > 6.5 ? 2.6 : 1.1 + hash(i, 10) * 0.8;
        at((hash(i, 11) * 2 - 1) * hx * 0.7, (hash(i, 12) * 2 - 1) * hz * 0.7,
          lot.h + mastH / 2, mastH, masts);
      }
      if (lot.h > 3.2 && lot.h < 6.8 && Math.min(hx, hz) > 0.9 && hash(i, 13) < 0.5) {
        at((hash(i, 14) * 2 - 1) * hx * 0.5, (hash(i, 15) * 2 - 1) * hz * 0.5,
          lot.h + 0.3, 1, tanks);
      }
    }
    for (const [geometry, list] of [
      [acGeometry, ac],
      [mastGeometry, masts],
      [tankGeometry, tanks],
    ] as const) {
      if (!list.length) continue;
      const inst = new InstancedMesh(geometry, metal, list.length);
      list.forEach((m, k) => inst.setMatrixAt(k, m));
      this.group.add(inst);
      this.disposables.push(inst);
      requestCompile(inst);
    }
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
