import {
  BufferGeometry,
  CanvasTexture,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  Vector3,
} from 'three';
import type { FenceRun, FenceStyle } from '../bake/cityGen.mjs';

/** Site units: a house is ~3.6 across, so one unit is about three metres. */
const SPEC: Record<FenceStyle, { height: number; color: string; post: number }> = {
  picket: { height: 0.38, color: '#e9e5da', post: 0.8 },
  privacy: { height: 0.55, color: '#6b5236', post: 0.8 },
  rail: { height: 0.45, color: '#85673f', post: 0.8 },
};
/** pixels per site unit in the fence textures, and how many units one tile covers */
const PX = 320;
const TILE = 3.2;

/**
 * A fence texture tile: cut-out boards on a transparent ground, so a fence is a
 * single upright quad per run (two triangles) until the camera is close enough to
 * deserve real boards.
 */
function fenceTexture(style: FenceStyle): CanvasTexture {
  const { height } = SPEC[style];
  const W = Math.round(TILE * PX);
  const H = Math.round(height * PX);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  let seed = 7 + style.length * 31;
  const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  if (style === 'picket') {
    // two rails behind, then pointed pickets with a little weathering
    ctx.fillStyle = '#b9b3a4';
    ctx.fillRect(0, H * 0.3, W, H * 0.07);
    ctx.fillRect(0, H * 0.7, W, H * 0.07);
    const pitch = 15;
    const bw = 10;
    for (let x = 2; x < W; x += pitch) {
      const l = 215 + rnd() * 30;
      ctx.fillStyle = `rgb(${l},${l - 3},${l - 12})`;
      ctx.beginPath();
      ctx.moveTo(x, H);
      ctx.lineTo(x, H * 0.14);
      ctx.lineTo(x + bw / 2, 0);
      ctx.lineTo(x + bw, H * 0.14);
      ctx.lineTo(x + bw, H);
      ctx.closePath();
      ctx.fill();
    }
  } else if (style === 'privacy') {
    // tight vertical boards, each its own tone, over a cap rail and two posts
    const pitch = 15;
    for (let x = 0; x < W; x += pitch) {
      const l = 0.82 + rnd() * 0.3;
      ctx.fillStyle = `rgb(${107 * l},${82 * l},${54 * l})`;
      ctx.fillRect(x, 0, pitch - 1, H);
      ctx.fillStyle = 'rgba(30, 20, 10, 0.55)';
      ctx.fillRect(x + pitch - 1, 0, 1, H);
    }
    ctx.fillStyle = '#4c3a25';
    ctx.fillRect(0, 0, W, H * 0.08);
    ctx.fillStyle = 'rgba(25, 16, 8, 0.35)';
    ctx.fillRect(0, H * 0.3, W, 2);
    ctx.fillRect(0, H * 0.72, W, 2);
    for (const px of [0, W / 2]) {
      ctx.fillStyle = '#4a3823';
      ctx.fillRect(px, 0, 18, H);
    }
  } else {
    // post-and-rail: heavy posts every 1.6 units, three split rails between
    ctx.fillStyle = '#8c6c43';
    for (const f of [0.18, 0.5, 0.82]) ctx.fillRect(0, H * f - H * 0.045, W, H * 0.09);
    ctx.fillStyle = '#70532f';
    for (let px = 0; px < W; px += W / 2) ctx.fillRect(px, 0, 22, H);
    ctx.fillStyle = 'rgba(20, 12, 4, 0.25)';
    for (const f of [0.18, 0.5, 0.82]) ctx.fillRect(0, H * f + H * 0.03, W, 3);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}

/** Accumulates triangles with flat normals into one merged geometry. */
class MeshBuilder {
  private pos: number[] = [];
  private nor: number[] = [];
  /** inside of the solid being built: triangles are wound to face away from it */
  private centre = new Vector3();

  tri(a: Vector3, b: Vector3, c: Vector3): void {
    const n = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a)).normalize();
    const flip = n.dot(new Vector3().subVectors(a, this.centre)) < 0;
    if (flip) {
      n.negate();
      [b, c] = [c, b];
    }
    for (const v of [a, b, c]) {
      this.pos.push(v.x, v.y, v.z);
      this.nor.push(n.x, n.y, n.z);
    }
  }

  quad(a: Vector3, b: Vector3, c: Vector3, d: Vector3): void {
    this.tri(a, b, c);
    this.tri(a, c, d);
  }

  /** A box in a run's frame: u along the run, w out of it, y up. */
  box(o: Vector3, u: Vector3, w: Vector3, u0: number, u1: number, w0: number, w1: number, y0: number, y1: number): void {
    const P = (a: number, b: number, c: number): Vector3 =>
      new Vector3().copy(o).addScaledVector(u, a).addScaledVector(w, b).setY(o.y + c);
    const v = [
      P(u0, w0, y0), P(u1, w0, y0), P(u1, w1, y0), P(u0, w1, y0),
      P(u0, w0, y1), P(u1, w0, y1), P(u1, w1, y1), P(u0, w1, y1),
    ];
    this.centre.set(0, 0, 0);
    for (const p of v) this.centre.add(p);
    this.centre.divideScalar(8);
    this.quad(v[4]!, v[5]!, v[6]!, v[7]!); // top
    this.quad(v[0]!, v[4]!, v[7]!, v[3]!); // -u
    this.quad(v[1]!, v[2]!, v[6]!, v[5]!); // +u
    this.quad(v[0]!, v[1]!, v[5]!, v[4]!); // -w
    this.quad(v[3]!, v[7]!, v[6]!, v[2]!); // +w
  }

  /** A pointed picket: a pentagon extruded through the board's thickness. */
  picket(o: Vector3, u: Vector3, w: Vector3, u0: number, width: number, thick: number, y0: number, y1: number): void {
    const P = (a: number, b: number, c: number): Vector3 =>
      new Vector3().copy(o).addScaledVector(u, a).addScaledVector(w, b).setY(o.y + c);
    const shoulder = y1 - 0.045;
    const pts: [number, number][] = [
      [u0, y0], [u0 + width, y0], [u0 + width, shoulder], [u0 + width / 2, y1], [u0, shoulder],
    ];
    const front = pts.map(([a, c]) => P(a, thick, c));
    const back = pts.map(([a, c]) => P(a, 0, c));
    this.centre.set(0, 0, 0);
    for (const p of [...front, ...back]) this.centre.add(p);
    this.centre.divideScalar(10);
    this.tri(front[0]!, front[1]!, front[2]!);
    this.tri(front[0]!, front[2]!, front[4]!);
    this.tri(front[4]!, front[2]!, front[3]!);
    this.tri(back[0]!, back[2]!, back[1]!);
    this.tri(back[0]!, back[4]!, back[2]!);
    this.tri(back[4]!, back[3]!, back[2]!);
    for (let i = 0; i < 5; i++) {
      const j = (i + 1) % 5;
      this.quad(back[i]!, back[j]!, front[j]!, front[i]!);
    }
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new Float32BufferAttribute(this.nor, 3));
    return g;
  }

  get empty(): boolean {
    return this.pos.length === 0;
  }
}

/**
 * The neighbourhood's fences. Every run is a textured, alpha-cut upright quad;
 * runs within `nearRadius` of the flight path are replaced by real posts, rails
 * and boards (HIGH only), because a card shows its flatness once it is close.
 */
export class Fences {
  readonly group = new Group();
  private disposables: { dispose(): void }[] = [];

  constructor(runs: FenceRun[], isNear: (run: FenceRun) => boolean) {
    const cards = new Map<FenceStyle, { pos: number[]; uv: number[]; nor: number[]; idx: number[] }>();
    const solids = new Map<FenceStyle, MeshBuilder>();
    for (const style of Object.keys(SPEC) as FenceStyle[]) {
      cards.set(style, { pos: [], uv: [], nor: [], idx: [] });
      solids.set(style, new MeshBuilder());
    }

    for (const run of runs) {
      const spec = SPEC[run.style];
      const a = new Vector3(run.x0, 0, run.z0);
      const b = new Vector3(run.x1, 0, run.z1);
      const len = a.distanceTo(b);
      if (len < 0.2) continue;
      const u = new Vector3().subVectors(b, a).divideScalar(len);
      const out = new Vector3(u.z, 0, -u.x);
      if (isNear(run)) {
        this.solid(solids.get(run.style)!, run.style, a, u, out, len);
        continue;
      }
      const c = cards.get(run.style)!;
      const base = c.pos.length / 3;
      c.pos.push(a.x, 0, a.z, b.x, 0, b.z, b.x, spec.height, b.z, a.x, spec.height, a.z);
      c.uv.push(0, 0, len / TILE, 0, len / TILE, 1, 0, 1);
      for (let i = 0; i < 4; i++) c.nor.push(out.x, 0, out.z);
      c.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }

    for (const style of Object.keys(SPEC) as FenceStyle[]) {
      const c = cards.get(style)!;
      if (c.idx.length) {
        const g = new BufferGeometry();
        g.setAttribute('position', new Float32BufferAttribute(c.pos, 3));
        g.setAttribute('normal', new Float32BufferAttribute(c.nor, 3));
        g.setAttribute('uv', new Float32BufferAttribute(c.uv, 2));
        g.setIndex(c.idx);
        const map = fenceTexture(style);
        const material = new MeshStandardMaterial({
          map, alphaTest: 0.5, side: DoubleSide, roughness: 0.85, metalness: 0,
        });
        const mesh = new Mesh(g, material);
        mesh.matrixAutoUpdate = false;
        this.group.add(mesh);
        this.disposables.push(g, material, map);
      }
      const s = solids.get(style)!;
      if (!s.empty) {
        const g = s.build();
        const material = new MeshStandardMaterial({ color: SPEC[style].color, roughness: 0.8, metalness: 0 });
        const mesh = new Mesh(g, material);
        mesh.matrixAutoUpdate = false;
        this.group.add(mesh);
        this.disposables.push(g, material);
      }
    }
  }

  /** Real fence along one run: posts every 0.8 units and boards, pickets or rails between. */
  private solid(mb: MeshBuilder, style: FenceStyle, a: Vector3, u: Vector3, w: Vector3, len: number): void {
    const { height, post } = SPEC[style];
    const n = Math.max(1, Math.round(len / post));
    const seg = len / n;
    const o = a;
    for (let i = 0; i <= n; i++) {
      const x = i * seg;
      mb.box(o, u, w, x - 0.022, x + 0.022, -0.022, 0.022, 0, height + (style === 'picket' ? 0.03 : 0.0));
    }
    for (let i = 0; i < n; i++) {
      const s0 = i * seg + 0.022;
      const s1 = (i + 1) * seg - 0.022;
      if (style === 'picket') {
        mb.box(o, u, w, s0, s1, -0.03, -0.012, height * 0.26, height * 0.26 + 0.026);
        mb.box(o, u, w, s0, s1, -0.03, -0.012, height * 0.68, height * 0.68 + 0.026);
        const count = Math.floor((s1 - s0) / 0.047);
        for (let k = 0; k < count; k++) {
          mb.picket(o, u, w, s0 + 0.005 + k * ((s1 - s0 - 0.03) / Math.max(count - 1, 1)), 0.03, 0.012, 0.0, height);
        }
      } else if (style === 'privacy') {
        const count = Math.floor((s1 - s0) / 0.047);
        for (let k = 0; k < count; k++) {
          const hh = height - (k % 3 === 0 ? 0.006 : 0);
          const x = s0 + k * ((s1 - s0) / count);
          mb.box(o, u, w, x, x + (s1 - s0) / count - 0.002, -0.012, 0.012, 0, hh);
        }
        mb.box(o, u, w, s0, s1, -0.02, 0.02, height, height + 0.02);
      } else {
        for (const f of [0.2, 0.5, 0.8]) {
          mb.box(o, u, w, s0, s1, -0.012, 0.012, height * f - 0.02, height * f + 0.02);
        }
      }
    }
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
