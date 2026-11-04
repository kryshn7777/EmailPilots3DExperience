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

/** algae and moss collecting in a corner: clustered olive blotches, densest at the bottom-left */
function moss(): CanvasTexture {
  return canvasTexture(256, (ctx, rnd) => {
    ctx.filter = 'blur(3px)';
    for (let i = 0; i < 46; i++) {
      const k = Math.pow(rnd(), 1.7);
      const x = 30 + k * 150 + (rnd() - 0.5) * 50;
      const y = 226 - k * 150 - (rnd() - 0.5) * 50;
      const r = 6 + rnd() * 20;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const dark = rnd() < 0.5;
      g.addColorStop(0, dark ? `rgba(46, 58, 28, ${0.45 + rnd() * 0.3})` : `rgba(78, 92, 44, ${0.3 + rnd() * 0.25})`);
      g.addColorStop(1, 'rgba(60, 74, 34, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 256, 256);
    }
  }, 5151);
}

/** flaking paint: an irregular bare patch of grey primer with chips, edges lifted and dark */
function peel(): CanvasTexture {
  return canvasTexture(256, (ctx, rnd) => {
    ctx.filter = 'blur(1.2px)';
    for (let b = 0; b < 5; b++) {
      const cx = 80 + rnd() * 96, cy = 60 + rnd() * 136;
      ctx.beginPath();
      const n = 9;
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * Math.PI * 2;
        const r = 18 + rnd() * 34;
        const px = cx + Math.cos(a) * r * 0.8, py = cy + Math.sin(a) * r * 1.3;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = `rgba(${108 + rnd() * 30}, ${100 + rnd() * 26}, ${88 + rnd() * 22}, ${0.55 + rnd() * 0.3})`;
      ctx.fill();
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = 'rgba(28, 24, 20, 0.5)';
      ctx.stroke();
    }
    for (let i = 0; i < 70; i++) {
      ctx.fillStyle = `rgba(${200 + rnd() * 40}, ${196 + rnd() * 40}, ${186 + rnd() * 40}, ${0.4 + rnd() * 0.4})`;
      ctx.beginPath();
      ctx.arc(60 + rnd() * 136, 40 + rnd() * 176, 1 + rnd() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }, 6262);
}

/** two bands of rubber laid out of a garage: dark and broken, fading toward the street */
function tyres(): CanvasTexture {
  return canvasTexture(256, (ctx, rnd) => {
    ctx.filter = 'blur(2px)';
    for (const x0 of [92, 158]) {
      for (let y = 0; y < 256; y += 4) {
        const fade = Math.sin((y / 256) * Math.PI) * (0.4 + 0.6 * (1 - y / 256));
        const sway = Math.sin(y * 0.03 + x0) * 5;
        ctx.fillStyle = `rgba(14, 12, 11, ${fade * (0.12 + rnd() * 0.2)})`;
        ctx.fillRect(x0 + sway - 9 + rnd() * 3, y, 18 - rnd() * 4, 5);
      }
    }
  }, 7373);
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
    const lichen: Spec = { texture: moss(), opacity: 0.85, items: [] };
    const flake: Spec = { texture: peel(), opacity: 0.8, items: [] };
    const rubber: Spec = { texture: tyres(), opacity: 0.7, items: [] };

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
      // every house its own upkeep: a scrubbed one is nearly clean, a neglected one stained, mossy, flaking
      const dirt = rand();
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
          if (rand() < 0.25 + 0.75 * dirt) {
            const len = (0.6 + rand() * (0.5 + 1.2 * dirt)) * SCALE * fit;
            const top = new Vector3(at.x, at.y - 0.1 * SCALE * fit - len / 2, at.z);
            const v = Math.floor(rand() * 4);
            streak[v]!.items.push(quad(top, u, n, w * fit * (1.1 + rand() * 0.4), len, 0.004));
          }
          const side = rand() < 0.5 ? -1 : 1;
          if (dirt > 0.4 && rand() < dirt - 0.2) {
            // algae in the lower corner of the sill
            const m = (0.45 + rand() * 0.4) * SCALE * fit;
            const p = new Vector3(at.x + u.x * side * w * fit * 0.38, at.y - m * 0.45, at.z + u.z * side * w * fit * 0.38);
            lichen.items.push(quad(p, u.clone().multiplyScalar(-side), n, m * 1.6, m * 1.3, 0.005));
          }
          if (dirt > 0.55 && rand() < 0.4) {
            // paint lifting off the wall beside the window
            const m = (0.5 + rand() * 0.4) * SCALE * fit;
            const off = w * fit * 0.5 + 0.28 * SCALE * fit;
            const p = new Vector3(at.x + u.x * -side * off, at.y + h * fit * 0.45, at.z + u.z * -side * off);
            flake.items.push(quad(p, u, n, m * 0.9, m * 1.5, 0.003));
          }
        } else if (kind === 'gar') {
          const hgt = 0.7 * SCALE * fit;
          foot.items.push(quad(new Vector3(at.x, at.y + hgt / 2, at.z), u, n, w * fit * 1.04, hgt, -0.045 * SCALE * fit));
          // the oil on the drive in front of the door, lying flat
          const ahead = 1.9 * SCALE * fit;
          const flat = new Matrix4().makeBasis(u.clone(), n.clone().multiplyScalar(-1), new Vector3().crossVectors(u, n.clone().multiplyScalar(-1)));
          flat.setPosition(at.x + n.x * ahead, 0.004, at.z + n.z * ahead);
          flat.multiply(scale.makeScale(2.4 * SCALE * fit * (0.9 + rand() * 0.3), 2.8 * SCALE * fit, 1));
          if (dirt > 0.3) drip.items.push(flat);
          if (dirt > 0.2 && rand() < 0.8) {
            const tyreAt = 3.4 * SCALE * fit;
            const lay = new Matrix4().makeBasis(u.clone(), n.clone().multiplyScalar(-1), new Vector3().crossVectors(u, n.clone().multiplyScalar(-1)));
            lay.setPosition(at.x + n.x * tyreAt, 0.0045, at.z + n.z * tyreAt);
            lay.multiply(scale.makeScale(w * fit * 0.95, 6.4 * SCALE * fit, 1));
            rubber.items.push(lay);
          }
        }
      }
    }

    const geometry = new PlaneGeometry(1, 1);
    this.disposables.push(geometry);
    for (const spec of [...streak, foot, drip, lichen, flake, rubber]) {
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
