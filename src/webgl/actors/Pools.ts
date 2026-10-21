import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  Color,
  DoubleSide,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  NoColorSpace,
  Path,
  PlaneGeometry,
  Quaternion,
  RepeatWrapping,
  Shape,
  ShapeGeometry,
  SRGBColorSpace,
  TorusGeometry,
  TubeGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { glowTexture } from '../bake/CanvasTextures';
import { mulberry32 } from '../util';

/** a pool's basin on the ground, world x/z, `w` along the pool's own x and `d` along its z; yaw as Yards' decals */
export interface PoolSite { x: number; z: number; w: number; d: number; yaw: number }

const RIM_H = 0.05; // coping height over the deck
const WATER_Y = 0.028; // the water stands a little under the coping
const FLOOR_Y = 0.004;
/** the whole pool is lifted a hair so it stands clear of the yard decals it is drawn over */
const LIFT = 0.02;

const UP = new Vector3(0, 1, 0);
const CUSHIONS = ['#2f7ad8', '#e8e4d8', '#d8402f', '#2faa5a', '#f2c230', '#d86aa8'];
const TOWELS = ['#f2f2ee', '#e84a3a', '#2f7ad8', '#f2c230', '#2fa86a'];
const FLOATS = ['#ff5a7a', '#ffd23a', '#fafafa', '#3ad0ff'];

// ---- textures -----------------------------------------------------------------------

/** Pool mosaic: little glazed tiles in blues and whites with pale grout, bright at the waterline. */
function mosaicTexture(): CanvasTexture {
  const S = 256;
  const N = 16;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d')!;
  const rand = mulberry32(21);
  ctx.fillStyle = '#d8e8ee';
  ctx.fillRect(0, 0, S, S);
  const T = S / N;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const l = 0.86 + rand() * 0.2;
      ctx.fillStyle = `rgb(${Math.round(120 * l)},${Math.round(206 * l)},${Math.round(226 * l)})`;
      ctx.fillRect(x * T + 1, y * T + 1, T - 2, T - 2);
      // a soft sheen across the glaze
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      ctx.fillRect(x * T + 1, y * T + 1, T - 2, (T - 2) * 0.4);
    }
  }
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/** Tileable ripples: a sum of sine waves with whole-number frequencies, baked as a normal map. */
function rippleNormals(): CanvasTexture {
  const S = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(S, S);
  const rand = mulberry32(5);
  const waves = Array.from({ length: 7 }, () => ({
    fx: Math.floor(rand() * 6) - 3 || 2, fy: Math.floor(rand() * 6) - 3 || 3, a: 0.5 + rand() * 0.5, p: rand() * 6.28,
  }));
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let dx = 0;
      let dy = 0;
      for (const w of waves) {
        const c = Math.cos(((w.fx * x + w.fy * y) / S) * 6.28318 + w.p) * w.a * 6.28318;
        dx += c * w.fx;
        dy += c * w.fy;
      }
      const k = 0.06;
      const nx = -dx * k;
      const ny = -dy * k;
      const inv = 1 / Math.hypot(nx, ny, 1);
      const o = (y * S + x) * 4;
      img.data[o] = (nx * inv * 0.5 + 0.5) * 255;
      img.data[o + 1] = (ny * inv * 0.5 + 0.5) * 255;
      img.data[o + 2] = (inv * 0.5 + 0.5) * 255;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new CanvasTexture(canvas);
  t.colorSpace = NoColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** The bright web light makes on a pool floor: tileable, drawn from the classic folded-sine caustic. */
function causticTexture(): CanvasTexture {
  const S = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(S, S);
  const TAU = 6.28318530718;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const px = ((x / S) * TAU) % TAU - 250;
      const py = ((y / S) * TAU) % TAU - 250;
      let ix = px;
      let iy = py;
      let c = 1;
      const inten = 0.005;
      for (let n = 0; n < 5; n++) {
        const t = 1.7 * (1 - 3.5 / (n + 1));
        ix = px + Math.cos(t - ix) + Math.sin(t + iy);
        iy = py + Math.sin(t - iy) + Math.cos(t + ix);
        c += 1 / Math.hypot(px / (Math.sin(ix + t) / inten), py / (Math.cos(iy + t) / inten));
      }
      c /= 5;
      c = 1.17 - Math.pow(c, 1.4);
      const v = Math.min(255, Math.pow(Math.abs(c), 8) * 255);
      const o = (y * S + x) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = v;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

// ---- geometry helpers ---------------------------------------------------------------

/** a rounded rectangle centred on the origin, drawn into `target` */
function roundedRect<T extends Path>(target: T, w: number, d: number, r: number): T {
  const x0 = -w / 2, x1 = w / 2, y0 = -d / 2, y1 = d / 2;
  target.moveTo(x0 + r, y0);
  target.lineTo(x1 - r, y0);
  target.quadraticCurveTo(x1, y0, x1, y0 + r);
  target.lineTo(x1, y1 - r);
  target.quadraticCurveTo(x1, y1, x1 - r, y1);
  target.lineTo(x0 + r, y1);
  target.quadraticCurveTo(x0, y1, x0, y1 - r);
  target.lineTo(x0, y0 + r);
  target.quadraticCurveTo(x0, y0, x0 + r, y0);
  return target;
}

function ring(outerW: number, outerD: number, outerR: number, innerW: number, innerD: number, innerR: number, height: number, bevel = 0): BufferGeometry {
  const shape = roundedRect(new Shape(), outerW, outerD, outerR);
  shape.holes.push(roundedRect(new Path(), innerW, innerD, innerR));
  const g = new ExtrudeGeometry(shape, {
    depth: height, curveSegments: 5, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1,
  });
  g.rotateX(-Math.PI / 2);
  return g;
}

/** every part merged below must carry the same attributes, indexed the same way */
function prep(g: BufferGeometry, colour: Color | null, uvScale = 0): BufferGeometry {
  const flat = g.index ? g.toNonIndexed() : g;
  if (flat !== g) g.dispose();
  for (const name of Object.keys(flat.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(name)) flat.deleteAttribute(name);
  if (uvScale) {
    // world-sized UVs (x and z, in units): a mosaic tile or a caustic cell keeps its size whatever the pool's
    const p = flat.attributes.position!;
    const uv: number[] = [];
    for (let i = 0; i < p.count; i++) uv.push(p.getX(i) * uvScale, p.getZ(i) * uvScale);
    flat.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  }
  if (!flat.attributes.uv) flat.setAttribute('uv', new Float32BufferAttribute(new Float32Array(flat.attributes.position!.count * 2), 2));
  if (colour && !flat.attributes.color) {
    const n = flat.attributes.position!.count;
    const c: number[] = [];
    for (let i = 0; i < n; i++) c.push(colour.r, colour.g, colour.b);
    flat.setAttribute('color', new Float32BufferAttribute(c, 3));
  }
  return flat;
}

function placed(g: BufferGeometry, m: Matrix4): BufferGeometry {
  g.applyMatrix4(m);
  return g;
}

/**
 * The town's swimming pools. They used to be a blue rectangle painted on the lawn; each is now a
 * pool: a raised coping of pale stone round a tiled basin (tiled waterline, shallow-to-deep floor,
 * corner steps), moving water with ripples, sky reflection and a drifting web of caustics on the
 * floor, an underwater lamp that comes on with the street lights, a chrome ladder, sometimes a
 * diving board, a pair of loungers with towels, and a pool ring bobbing on the surface.
 *
 * Every pool is merged by material into a handful of meshes, so all of them cost about ten draw
 * calls together. HIGH tier only; the phone tier keeps the painted decal.
 */
export class Pools {
  readonly group = new Group();
  private disposables: { dispose(): void }[] = [];
  private ripples: CanvasTexture;
  private causticA: CanvasTexture;
  private causticB: CanvasTexture;
  private water: MeshPhysicalMaterial;
  private causticMaterials: MeshBasicMaterial[] = [];
  private glow: MeshBasicMaterial;
  private floats: InstancedMesh | null = null;
  private floatBase: { x: number; z: number; spin: number; phase: number }[] = [];

  constructor(sites: PoolSite[]) {
    const rand = mulberry32(8812);
    const mosaic = mosaicTexture();
    mosaic.repeat.set(1.25, 1.25);
    this.ripples = rippleNormals();
    this.ripples.repeat.set(2.6, 2.6);
    this.causticA = causticTexture();
    this.causticB = this.causticA.clone();
    this.causticB.needsUpdate = true;
    const glowMap = glowTexture();
    this.disposables.push(mosaic, this.ripples, this.causticA, this.causticB);

    const stone: BufferGeometry[] = [];
    const tile: BufferGeometry[] = [];
    const chrome: BufferGeometry[] = [];
    const fiber: BufferGeometry[] = [];
    const lounger: BufferGeometry[] = [];
    const water: BufferGeometry[] = [];
    const causticsA: BufferGeometry[] = [];
    const causticsB: BufferGeometry[] = [];
    const lamps: BufferGeometry[] = [];

    const white = new Color('#f4f8fa');
    const m4 = new Matrix4();
    const q = new Quaternion();
    const tmp = new Vector3();

    for (const site of sites) {
      const { w, d } = site;
      const at = new Matrix4().makeRotationY(-site.yaw).setPosition(site.x, LIFT, site.z);
      const local = (x: number, y: number, z: number, qy = 0): Matrix4 =>
        new Matrix4().multiplyMatrices(at, m4.compose(tmp.set(x, y, z), q.setFromAxisAngle(UP, qy), new Vector3(1, 1, 1)));

      // coping: a pale stone ring with a soft bevel, a touch different from pool to pool
      const tint = new Color().setHSL(0.1 + rand() * 0.03, 0.14 + rand() * 0.1, 0.78 + rand() * 0.1);
      stone.push(placed(prep(ring(w + 0.24, d + 0.24, 0.1, w, d, 0.05, RIM_H, 0.006), tint), at));
      // the tiled lining just inside it, which is the waterline band
      tile.push(placed(prep(ring(w - 0.002, d - 0.002, 0.049, w - 0.02, d - 0.02, 0.04, RIM_H - 0.002), white), at));

      // the floor: shallow at one end, deep at the other, drawn as vertex colour over the mosaic
      const floor = new PlaneGeometry(w - 0.02, d - 0.02, 8, 3);
      floor.rotateX(-Math.PI / 2);
      floor.translate(0, FLOOR_Y, 0);
      const fp = floor.attributes.position!;
      const fc: number[] = [];
      const shallow = new Color('#bff0f6');
      const deep = new Color('#1b6a9a');
      const c = new Color();
      for (let i = 0; i < fp.count; i++) {
        const u = (fp.getX(i) + w / 2) / w;
        c.copy(shallow).lerp(deep, Math.pow(u, 0.9));
        fc.push(c.r, c.g, c.b);
      }
      floor.setAttribute('color', new Float32BufferAttribute(fc, 3));
      tile.push(placed(prep(floor, null, 1), at));

      // steps down into the shallow end, in a corner: three treads, white tile
      for (let i = 0; i < 3; i++) {
        const h = [0.034, 0.024, 0.014][i]!;
        const step = new BoxGeometry(0.065, h, 0.22);
        step.translate(-w / 2 + 0.05 + i * 0.066, FLOOR_Y + h / 2, -d / 2 + 0.13);
        tile.push(placed(prep(step, white), at));
      }

      // water: ripples, a sky reflection, and a faint glow from the lamp below at night
      const surface = new ShapeGeometry(roundedRect(new Shape(), w - 0.016, d - 0.016, 0.044), 6);
      surface.rotateX(-Math.PI / 2);
      surface.translate(0, WATER_Y, 0);
      water.push(placed(prep(surface, null), at));

      // caustics, two layers that drift against each other over the floor
      for (const [list, y] of [[causticsA, FLOOR_Y + 0.0006], [causticsB, FLOOR_Y + 0.0012]] as const) {
        const cg = new PlaneGeometry(w - 0.024, d - 0.024);
        cg.rotateX(-Math.PI / 2);
        cg.translate(0, y, 0);
        list.push(placed(prep(cg, null, 1 / 0.85), at));
      }

      // the underwater lamp, set in the deep end's wall
      const lamp = new PlaneGeometry(0.6, 0.6);
      lamp.rotateX(-Math.PI / 2);
      lamp.translate(w * 0.34, FLOOR_Y + 0.002, 0);
      lamps.push(placed(prep(lamp, null), at));

      // a chrome ladder over the coping at the deep end's corner: two rails, each a loop
      const lz = d / 2 - 0.13;
      for (const s of [-1, 1]) {
        const curve = new CatmullRomCurve3([
          new Vector3(w / 2 + 0.1, RIM_H, lz + s * 0.05),
          new Vector3(w / 2 + 0.1, 0.17, lz + s * 0.05),
          new Vector3(w / 2 + 0.07, 0.205, lz + s * 0.05),
          new Vector3(w / 2 + 0.02, 0.19, lz + s * 0.05),
          new Vector3(w / 2 - 0.025, 0.14, lz + s * 0.05),
          new Vector3(w / 2 - 0.025, 0.03, lz + s * 0.05),
        ]);
        chrome.push(placed(prep(new TubeGeometry(curve, 14, 0.0075, 7), null), at));
      }

      // a diving board off the deep end of the longer pools
      if (w >= 1.5) {
        const base = new BoxGeometry(0.1, 0.034, 0.13);
        base.translate(w / 2 + 0.15, RIM_H + 0.017, -0.1);
        fiber.push(placed(prep(base, null), at));
        const board = new BoxGeometry(0.4, 0.01, 0.085);
        board.rotateZ(0.045);
        board.translate(w / 2 - 0.02, RIM_H + 0.045, -0.1);
        fiber.push(placed(prep(board, null), at));
      }

      // loungers on the deck, along one long side, with a towel on one
      const sideSign = rand() < 0.5 ? 1 : -1;
      const count = rand() < 0.35 ? 1 : 2;
      const flip = rand() < 0.5 ? 0 : Math.PI;
      for (let k = 0; k < count; k++) {
        const x = (k - (count - 1) / 2) * 0.46 + (rand() - 0.5) * 0.08;
        const z = sideSign * (d / 2 + 0.3);
        const frame = new Color('#f2f2ee');
        const cushion = new Color(CUSHIONS[Math.floor(rand() * CUSHIONS.length)]!);
        const parts: BufferGeometry[] = [];
        const box = (bw: number, bh: number, bd: number, px: number, py: number, pz: number, col: Color, rotZ = 0): void => {
          const b = new BoxGeometry(bw, bh, bd);
          if (rotZ) b.rotateZ(rotZ);
          b.translate(px, py, pz);
          parts.push(prep(b, col));
        };
        box(0.3, 0.014, 0.12, 0, 0.044, 0, frame); // the base
        for (const lx of [-0.13, 0.13]) for (const lzz of [-0.05, 0.05]) box(0.016, 0.04, 0.016, lx, 0.02, lzz, frame); // legs
        box(0.3, 0.012, 0.11, 0, 0.056, 0, cushion); // the cushion
        box(0.15, 0.014, 0.12, -0.2, 0.09, 0, frame, 0.62); // the raised back
        box(0.15, 0.012, 0.11, -0.2, 0.1, 0, cushion, 0.62);
        if (k === 0 && rand() < 0.7) box(0.09, 0.008, 0.1, 0.1, 0.066, 0, new Color(TOWELS[Math.floor(rand() * TOWELS.length)]!));
        const merged = mergeGeometries(parts, false)!;
        parts.forEach((p) => p.dispose());
        lounger.push(placed(merged, local(x, 0, z, flip)));
      }

      if (rand() < 0.6) {
        // a spot on the water, turned into world x/z the way the pool itself is
        const lx = (rand() - 0.5) * (w - 0.3) * 0.7;
        const lz = (rand() - 0.5) * (d - 0.3) * 0.7;
        this.floatBase.push({
          x: site.x + lx * Math.cos(site.yaw) - lz * Math.sin(site.yaw),
          z: site.z + lx * Math.sin(site.yaw) + lz * Math.cos(site.yaw),
          spin: rand() * 6.28, phase: rand() * 6.28,
        });
      }
    }

    const done = (parts: BufferGeometry[]): BufferGeometry | null => {
      if (!parts.length) return null;
      const g = mergeGeometries(parts, false);
      parts.forEach((p) => p.dispose());
      return g;
    };
    const add = (geometry: BufferGeometry | null, material: MeshStandardMaterial | MeshPhysicalMaterial | MeshBasicMaterial, opts: { shadow?: boolean; order?: number } = {}): void => {
      if (!geometry) return;
      const mesh = new Mesh(geometry, material);
      mesh.castShadow = !!opts.shadow;
      mesh.receiveShadow = !!opts.shadow;
      if (opts.order) mesh.renderOrder = opts.order;
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh);
      this.disposables.push(geometry, material);
    };

    add(done(stone), new MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0 }), { shadow: true });
    add(done(tile), new MeshStandardMaterial({
      map: mosaic, vertexColors: true, roughness: 0.32, metalness: 0, envMapIntensity: 0.7,
    }));
    add(done(chrome), new MeshStandardMaterial({ color: '#dfe6ec', roughness: 0.14, metalness: 1, envMapIntensity: 1.4 }), { shadow: true });
    add(done(fiber), new MeshStandardMaterial({ color: '#eef3f6', roughness: 0.3, metalness: 0.05 }), { shadow: true });
    add(done(lounger), new MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.02 }), { shadow: true });

    // the caustics lie just over the floor, under the water; additive, so the floor lights up
    for (const [list, map] of [[causticsA, this.causticA], [causticsB, this.causticB]] as const) {
      const mat = new MeshBasicMaterial({
        map, color: '#bff4ff', transparent: true, opacity: 0.5, blending: AdditiveBlending, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
      });
      this.causticMaterials.push(mat);
      add(done(list), mat, { order: 1 });
    }
    this.glow = new MeshBasicMaterial({
      map: glowMap, color: '#58d6ff', transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    });
    add(done(lamps), this.glow, { order: 1 });

    this.water = new MeshPhysicalMaterial({
      color: '#2db4d4', roughness: 0.03, metalness: 0, ior: 1.333, specularIntensity: 1,
      transparent: true, opacity: 0.55, depthWrite: false, normalMap: this.ripples,
      emissive: '#2aa6d0', emissiveIntensity: 0, envMapIntensity: 1.5,
    });
    this.water.normalScale.set(0.45, 0.45);
    add(done(water), this.water, { order: 2 });

    // pool rings on the water: one InstancedMesh, bobbing
    if (this.floatBase.length) {
      const ringGeometry = new TorusGeometry(0.055, 0.022, 10, 22);
      ringGeometry.rotateX(Math.PI / 2);
      const material = new MeshStandardMaterial({ roughness: 0.45, metalness: 0 });
      this.floats = new InstancedMesh(ringGeometry, material, this.floatBase.length);
      this.floatBase.forEach((_, i) => this.floats!.setColorAt(i, new Color(FLOATS[i % FLOATS.length]!)));
      this.floats.frustumCulled = false;
      this.floats.castShadow = true;
      this.group.add(this.floats);
      this.disposables.push(ringGeometry, material, this.floats);
    }
  }

  /** `night` is 0 by day and 1 in the dark: the underwater lamp and the water's glow follow it. */
  update(time: number, night: number): void {
    if (!this.group.visible) return;
    this.ripples.offset.set(time * 0.022, time * 0.014);
    this.causticA.offset.set(time * 0.05, time * 0.032);
    this.causticB.offset.set(-time * 0.038, time * 0.056 + 0.37);
    // the sun's web fades as it sets; the lamp's takes over
    const web = 0.5 * (1 - 0.55 * night) + 0.12 * night;
    for (const m of this.causticMaterials) m.opacity = web;
    this.glow.opacity = night * 0.85;
    this.water.emissiveIntensity = night * 0.55;
    if (this.floats) {
      const m4 = new Matrix4();
      const q = new Quaternion();
      this.floatBase.forEach((f, i) => {
        q.setFromAxisAngle(UP, f.spin + time * 0.1);
        m4.compose(
          new Vector3(
            f.x + Math.sin(time * 0.21 + f.phase) * 0.03,
            LIFT + WATER_Y + 0.016 + Math.sin(time * 1.3 + f.phase) * 0.004,
            f.z + Math.cos(time * 0.17 + f.phase) * 0.025,
          ),
          q, new Vector3(1, 1, 1),
        );
        this.floats!.setMatrixAt(i, m4);
      });
      this.floats.instanceMatrix.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
