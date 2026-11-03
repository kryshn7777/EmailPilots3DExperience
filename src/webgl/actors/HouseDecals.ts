import {
  CanvasTexture,
  Color,
  Group,
  InstancedMesh,
  LinearMipmapLinearFilter,
  Matrix4,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { mulberry32 } from '../util';
import type { KitLot, KitManifest } from './KitCity';

/**
 * Weathering decals on the houses the flight passes close to (the hero ring): the rain-streaks that run
 * down a wall from every sill, the grime along the foot of a garage door, the oil on the drive in front
 * of it. They are alpha-blended quads a few millimetres off the walls, so they read as the dirt of a
 * lived-in house over the baked paint instead of one more clean surface.
 *
 * Where the openings are comes from blender/make_anchors.py (anchors.json: windows and garage doors in
 * each module's own site units); the quads are posed by the same transform KitCity gives the house.
 */

/** [kind, x, y, z, nx, nz, ux, uz, width, height] */
type Anchor = [string, number, number, number, number, number, number, number, number, number];
export type DecalAnchors = Record<string, Anchor[]>;

const SCALE = 0.33; // site units per metre, as the models (blender/bld/homes.py)

function canvasTexture(size: number, draw: (ctx: CanvasRenderingContext2D, rnd: () => number) => void, seed: number): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  draw(ctx, mulberry32(seed));
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  t.minFilter = LinearMipmapLinearFilter;
  t.anisotropy = 4;
  return t;
}

/** vertical streaks running down from the top edge: strong where they start, gone toward the foot */
function streaks(variant: number): CanvasTexture {
  return canvasTexture(256, (ctx, rnd) => {
    ctx.filter = 'blur(2.5px)';
    const n = 3 + variant;
    // the water that ran off the sill: a soft stain right under it
    const stain = ctx.createLinearGradient(0, 0, 0, 70);
    stain.addColorStop(0, 'rgba(44, 36, 28, 0.55)');
    stain.addColorStop(1, 'rgba(44, 36, 28, 0)');
    ctx.fillStyle = stain;
    ctx.fillRect(14, 0, 228, 70);
    for (let i = 0; i < n; i++) {
      const x = 28 + ((i + 0.3 + rnd() * 0.4) / n) * 200;
      const w = 5 + rnd() * 12;
      const len = 120 + rnd() * 136;
      const g = ctx.createLinearGradient(0, 0, 0, len);
      const a = 0.28 + rnd() * 0.3;
      g.addColorStop(0, `rgba(40, 33, 26, ${a})`);
      g.addColorStop(0.6, `rgba(40, 33, 26, ${a * 0.45})`);
      g.addColorStop(1, 'rgba(40, 33, 26, 0)');
      ctx.fillStyle = g;
      // a wavering run, wider where it pooled
      ctx.beginPath();
      ctx.moveTo(x - w / 2, 0);
      for (let y = 0; y <= len; y += 16) ctx.lineTo(x - w / 2 + Math.sin(y * 0.05 + i) * 3 - y * 0.012, y);
      for (let y = len; y >= 0; y -= 16) ctx.lineTo(x + w / 2 + Math.sin(y * 0.05 + i) * 3 - y * 0.012, y);
      ctx.fill();
    }
  }, 7000 + variant * 31);
}

/** dirt and splashed mud along a foot: dark at the bottom edge, fading upward, broken by speckle */
function grime(): CanvasTexture {
  return canvasTexture(256, (ctx, rnd) => {
    const g = ctx.createLinearGradient(0, 256, 0, 60);
    g.addColorStop(0, 'rgba(36, 30, 24, 0.7)');
    g.addColorStop(0.5, 'rgba(36, 30, 24, 0.22)');
    g.addColorStop(1, 'rgba(36, 30, 24, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
    ctx.filter = 'blur(1.5px)';
    for (let i = 0; i < 260; i++) {
      ctx.fillStyle = `rgba(30, 24, 18, ${0.05 + rnd() * 0.12})`;
      const y = 256 - Math.pow(rnd(), 2.2) * 190;
      ctx.beginPath();
      ctx.arc(rnd() * 256, y, 1 + rnd() * 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }, 9101);
}

/** an oil stain on a drive: overlapping soft ovals, darkest where the engine sits */
function oil(): CanvasTexture {
  return canvasTexture(256, (ctx, rnd) => {
    ctx.filter = 'blur(6px)';
    for (let i = 0; i < 9; i++) {
      const x = 128 + (rnd() - 0.5) * 80;
      const y = 128 + (rnd() - 0.5) * 70;
      const r = 20 + rnd() * 34;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(18, 16, 14, ${0.28 + rnd() * 0.22})`);
      g.addColorStop(1, 'rgba(18, 16, 14, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 256, 256);
    }
  }, 4242);
}

interface Spec {
  texture: CanvasTexture;
  opacity: number;
  items: Matrix4[];
}

export class HouseDecals {
  readonly group = new Group();
  private disposables: { dispose(): void }[] = [];

  constructor(lots: KitLot[], modules: KitManifest['modules'], hero: number[], anchors: DecalAnchors) {
    const byId = new Map(modules.map((m) => [m.id, m]));
    const rand = mulberry32(31337);
    const streak = [0, 1, 2, 3].map((v) => ({ texture: streaks(v), opacity: 0.72 + v * 0.05, items: [] as Matrix4[] }));
    const foot: Spec = { texture: grime(), opacity: 0.72, items: [] };
    const drip: Spec = { texture: oil(), opacity: 0.55, items: [] };

    const tmpPos = new Vector3();
    const x = new Vector3();
    const y = new Vector3(0, 1, 0);
    const z = new Vector3();
    const basis = new Matrix4();
    const scale = new Matrix4();
    /** a quad `w` x `h` (site units) standing at `p`, facing `n`, its x along `u` */
    const quad = (p: Vector3, u: Vector3, n: Vector3, w: number, h: number, lift: number): Matrix4 => {
      x.copy(u);
      z.copy(n);
      basis.makeBasis(x, y, z).setPosition(tmpPos.copy(p).addScaledVector(n, lift));
      return basis.clone().multiply(scale.makeScale(w, h, 1));
    };

    for (const i of hero) {
      const lot = lots[i];
      if (!lot) continue;
      const mod = byId.get(lot.moduleId);
      const list = anchors[lot.moduleId];
      if (!mod || mod.kind !== 'house' || !list) continue;
      const fit = Math.min(lot.w / mod.footprint[0], lot.d / mod.footprint[1], lot.h / (lot.rise ?? 1) / mod.height);
      const c = Math.cos(lot.yaw);
      const s = Math.sin(lot.yaw);
      // Y rotation by `yaw`, as the house itself is placed
      const turn = (vx: number, vz: number, out: Vector3): Vector3 => out.set(vx * c + vz * s, 0, -vx * s + vz * c);
      for (const [kind, ax, ay, az, nx, nz, ux, uz, w, h] of list) {
        const at = turn(ax * fit, az * fit, new Vector3());
        at.set(at.x + lot.x, ay * fit, at.z + lot.z);
        const n = turn(nx, nz, new Vector3());
        const u = turn(ux, uz, new Vector3());
        if (kind === 'win') {
          // from just under the sill down the wall
          const len = (0.8 + rand() * 0.9) * SCALE * fit;
          const top = new Vector3(at.x, at.y - 0.1 * SCALE * fit - len / 2, at.z);
          const v = Math.floor(rand() * 4);
          streak[v]!.items.push(quad(top, u, n, w * fit * (1.15 + rand() * 0.3), len, 0.004));
        } else if (kind === 'gar') {
          const hgt = 0.7 * SCALE * fit;
          foot.items.push(quad(new Vector3(at.x, at.y + hgt / 2, at.z), u, n, w * fit * 1.04, hgt, -0.045 * SCALE * fit));
          // the oil on the drive in front of the door, lying flat
          const ahead = 1.9 * SCALE * fit;
          const flat = new Matrix4().makeBasis(u.clone(), n.clone().multiplyScalar(-1), new Vector3().crossVectors(u, n.clone().multiplyScalar(-1)));
          flat.setPosition(at.x + n.x * ahead, 0.004, at.z + n.z * ahead);
          flat.multiply(scale.makeScale(2.4 * SCALE * fit * (0.9 + rand() * 0.3), 2.8 * SCALE * fit, 1));
          drip.items.push(flat);
        }
      }
    }

    const geometry = new PlaneGeometry(1, 1);
    this.disposables.push(geometry);
    for (const spec of [...streak, foot, drip]) {
      if (!spec.items.length) {
        spec.texture.dispose();
        continue;
      }
      const material = new MeshBasicMaterial({
        map: spec.texture, color: new Color('#ffffff'), transparent: true, opacity: spec.opacity, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
      });
      const mesh = new InstancedMesh(geometry, material, spec.items.length);
      spec.items.forEach((m, k) => mesh.setMatrixAt(k, m));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.frustumCulled = false;
      mesh.renderOrder = 2;
      this.group.add(mesh);
      this.disposables.push(material, spec.texture, mesh);
    }
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
