import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  Group,
  InstancedMesh,
  MathUtils,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { HOME_CELL } from '../bake/cityGen.mjs';
import { mulberry32 } from '../util';
import { KitCity } from './KitCity';
import type { TownSite } from './Rooftops';

const UP = new Vector3(0, 1, 0);
const STREET_Z = HOME_CELL.lotD + HOME_CELL.street / 2;

/** a flat quad whose near edge sits on the origin and which runs out along +z: orient it by yaw alone */
function runway(): PlaneGeometry {
  const g = new PlaneGeometry(1, 1);
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0, 0.5);
  return g;
}

/** the reflection of a lamp in wet asphalt: a bright core at the lamp's foot, drawn out toward the viewer in broken ripples */
function streakTexture(): CanvasTexture {
  const W = 64;
  const H = 256;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const rand = mulberry32(9);
  const img = ctx.createImageData(W, H);
  // rows of ripple: each a little brighter or dimmer, so the streak breaks up like a reflection in moving water
  const rows: number[] = [];
  let r = 0.7;
  for (let y = 0; y < H; y++) {
    r = MathUtils.clamp(r + (rand() - 0.5) * 0.5, 0.25, 1);
    rows.push(r);
  }
  for (let y = 0; y < H; y++) {
    const v = 1 - y / (H - 1); // 1 at the lamp, 0 at the viewer's end
    const along = Math.pow(v, 0.7);
    for (let x = 0; x < W; x++) {
      const u = (x / (W - 1)) * 2 - 1;
      // narrower toward the lamp's end, wider and fainter toward the viewer
      const width = 0.18 + (1 - v) * 0.5;
      const across = Math.exp(-(u * u) / (width * width));
      const a = along * across * (0.55 + 0.45 * rows[y]!) * (v > 0.9 ? 1.3 : 1);
      const o = (y * W + x) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = 255;
      img.data[o + 3] = Math.min(255, a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** warm light thrown by a house's windows onto the ground in front of it: two bright panes fading outward */
function spillTexture(): CanvasTexture {
  const W = 128;
  const H = 64;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    const v = 1 - y / (H - 1); // 1 at the wall
    for (let x = 0; x < W; x++) {
      const u = x / (W - 1);
      // two window-shaped pools, spread as they leave the wall
      const spread = 0.13 + (1 - v) * 0.15;
      const pane = Math.exp(-((u - 0.3) ** 2) / (spread * spread)) + Math.exp(-((u - 0.72) ** 2) / (spread * spread));
      const a = Math.min(1, pane) * Math.pow(v, 1.6);
      const o = (y * W + x) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = 255;
      img.data[o + 3] = a * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** a soft-edged ellipse, for puddles */
function puddleMask(): CanvasTexture {
  const S = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d')!;
  // a blobby edge: a radial fall-off wobbled by a few harmonics
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = (x / (S - 1)) * 2 - 1;
      const dy = (y / (S - 1)) * 2 - 1;
      const ang = Math.atan2(dy, dx);
      const wobble = 1 + 0.1 * Math.sin(ang * 3 + 1) + 0.07 * Math.sin(ang * 5 + 2) + 0.04 * Math.sin(ang * 9);
      const d = Math.hypot(dx, dy) / wobble;
      const a = 1 - MathUtils.smoothstep(d, 0.72, 0.98);
      const o = (y * S + x) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = a * 255;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return new CanvasTexture(canvas);
}

/**
 * The town after rain, lit from within (HIGH tier). Three things the flat ground cannot do:
 *
 *  - lamp reflections: each streetlight near the flight draws a streak of itself in the wet road,
 *    running from its foot toward the camera, so the lamps are doubled in the asphalt the way they
 *    are on a wet night. Strongest at a low, grazing view and gone from straight overhead, where a
 *    mirror shows only what is directly above it;
 *  - puddles: mirror-bright patches in the gutters and the crossing that reflect the sky (the same
 *    baked cloud environment the houses' glass reflects);
 *  - window light: most houses throw a warm pool from their windows onto the lawn in front, a few
 *    the cold flicker of a television, the rest dark.
 *
 * Each is one InstancedMesh. The streaks turn to face the camera every frame; the rest are static.
 * Night level scales the lamps' and windows' light; the puddles reflect whatever the sky is doing.
 */
export class TownLight {
  readonly group = new Group();
  private streaks: InstancedMesh;
  private streakMaterial: MeshBasicMaterial;
  private spill: InstancedMesh;
  private spillMaterial: MeshBasicMaterial;
  private puddles: InstancedMesh;
  private puddleMaterial: MeshStandardMaterial;
  private tips: { x: number; z: number }[];
  private disposables: { dispose(): void }[] = [];
  private m4 = new Matrix4();
  private q = new Quaternion();
  private p = new Vector3();
  private s = new Vector3();
  private tint = new Color();

  constructor(tips: { x: number; z: number }[], houses: TownSite[], near: (x: number, z: number, reach: number) => boolean) {
    const rand = mulberry32(4407);
    const flat = runway();
    this.disposables.push(flat);

    // — lamp reflections
    this.tips = tips.filter((t) => near(t.x, t.z, 70));
    const streakMap = streakTexture();
    this.streakMaterial = new MeshBasicMaterial({
      map: streakMap, color: new Color('#ffbb70').multiplyScalar(2.0), transparent: true, opacity: 1,
      blending: AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    });
    this.streaks = new InstancedMesh(flat, this.streakMaterial, Math.max(this.tips.length, 1));
    this.streaks.frustumCulled = false;
    this.streaks.count = this.tips.length;
    this.streaks.renderOrder = 3;
    this.group.add(this.streaks);
    this.disposables.push(streakMap, this.streakMaterial);

    // — window light on the lawns
    const spillMap = spillTexture();
    this.spillMaterial = new MeshBasicMaterial({
      map: spillMap, color: '#ffffff', transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    const lit = houses.filter((h) => near(h.x, h.z, 55));
    this.spill = new InstancedMesh(flat, this.spillMaterial, Math.max(lit.length, 1));
    this.spill.frustumCulled = false;
    this.spill.count = lit.length;
    this.spill.renderOrder = 2;
    lit.forEach((h, i) => {
      const toStreet = Math.cos(h.yaw) > 0 ? 1 : -1;
      // one in three houses is dark, a few are watching television, the rest have a lamp on
      const roll = rand();
      const strength = roll < 0.33 ? 0 : 0.8 + rand() * 0.6;
      this.tint.set(roll > 0.9 ? '#7ea8ff' : roll > 0.55 ? '#ffc27a' : '#ffb35e').multiplyScalar(strength);
      this.q.setFromAxisAngle(UP, toStreet > 0 ? 0 : Math.PI);
      this.m4.compose(
        this.p.set(h.x, 0.018, h.z + toStreet * (h.d / 2 + 0.05)), this.q, this.s.set(h.w * 0.92, 1, 1.5 + rand() * 0.7),
      );
      this.spill.setMatrixAt(i, this.m4);
      this.spill.setColorAt(i, this.tint);
    });
    if (this.spill.instanceColor) this.spill.instanceColor.needsUpdate = true;
    this.group.add(this.spill);
    this.disposables.push(spillMap, this.spillMaterial);

    // — puddles, along the gutters of the street the flight runs down and across its crossings
    const spots: { x: number; z: number; len: number; wid: number; yaw: number }[] = [];
    for (let k = 0; k < 46; k++) {
      const x = 4 + rand() * 70;
      const side = rand() < 0.5 ? -1 : 1;
      // mostly in the lanes, some on the paving beside them
      const offset = rand() < 0.7 ? 0.35 + rand() * 0.7 : 1.45 + rand() * 0.9;
      spots.push({
        x, z: STREET_Z + side * offset,
        len: 0.3 + rand() * 0.6, wid: 0.15 + rand() * 0.25, yaw: (rand() - 0.5) * 0.35,
      });
    }
    for (let k = 0; k < 10; k++) {
      const cross = (Math.floor(rand() * 3)) * HOME_CELL.w + HOME_CELL.lots * HOME_CELL.lotW + HOME_CELL.cross / 2;
      spots.push({
        x: cross + (rand() - 0.5) * 1.6, z: STREET_Z + (rand() - 0.5) * 3,
        len: 0.3 + rand() * 0.5, wid: 0.18 + rand() * 0.25, yaw: rand() * Math.PI,
      });
    }
    const mask = puddleMask();
    this.puddleMaterial = new MeshStandardMaterial({
      color: '#697a8d', metalness: 1, roughness: 0.05, alphaMap: mask, transparent: true, opacity: 0.78, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    // the puddles mirror the same baked sky and cloud sea as the houses' glass
    KitCity.adopt(this.puddleMaterial, 0.8);
    const disc = new PlaneGeometry(1, 1);
    disc.rotateX(-Math.PI / 2);
    this.puddles = new InstancedMesh(disc, this.puddleMaterial, spots.length);
    this.puddles.renderOrder = 1;
    spots.forEach((sp, i) => {
      this.q.setFromAxisAngle(UP, sp.yaw);
      this.m4.compose(this.p.set(sp.x, 0.016, sp.z), this.q, this.s.set(sp.len, 1, sp.wid));
      this.puddles.setMatrixAt(i, this.m4);
    });
    this.group.add(this.puddles);
    this.disposables.push(mask, disc, this.puddleMaterial);
  }

  /** `night` 0 by day to 1 in the dark; `eye` is the camera's world position. */
  update(night: number, eye: Vector3): void {
    this.spillMaterial.opacity = Math.min(1, night * 1.6);
    this.streakMaterial.opacity = night;
    const horizon = Math.max(eye.y - this.group.position.y, 0.2);
    for (let i = 0; i < this.tips.length; i++) {
      const tip = this.tips[i]!;
      const dx = eye.x - tip.x;
      const dz = eye.z - tip.z;
      const dist = Math.hypot(dx, dz);
      // a mirror shows a lamp low in the view, and not at all straight down
      const elev = Math.atan2(horizon, Math.max(dist, 0.1));
      const strength = (1 - MathUtils.smoothstep(elev, 0.22, 0.95)) * (1 - MathUtils.smoothstep(dist, 28, 70)) * MathUtils.smoothstep(dist, 1.5, 4);
      const length = MathUtils.clamp(0.7 + dist * 0.1, 1, 3.2);
      this.q.setFromAxisAngle(UP, Math.atan2(dx, dz));
      this.m4.compose(this.p.set(tip.x, 0.02, tip.z), this.q, this.s.set(0.42, 1, strength > 0.01 ? length : 0.0001));
      this.streaks.setMatrixAt(i, this.m4);
      this.streaks.setColorAt(i, this.tint.setScalar(strength));
    }
    this.streaks.instanceMatrix.needsUpdate = true;
    if (this.streaks.instanceColor) this.streaks.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.streaks.dispose();
    this.spill.dispose();
    this.puddles.dispose();
  }
}
