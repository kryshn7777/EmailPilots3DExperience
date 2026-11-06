import {
  BoxGeometry,
  BufferGeometry,
  Camera,
  CanvasTexture,
  Group,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  SRGBColorSpace,
  Vector3,
} from 'three';
import type { Raycast } from '../interact/Raycast';
import type { Tooltip } from '../interact/Tooltip';
import { DESK_NAMES, FLEET, chipLabel } from '../../story/fleet';
import { RELEASE_T, STAGE } from '../rig/launch';

const ENV_W = 512;
const ENV_H = 346;

/** the face of a letter written by hand: whatever cursive the device has, slanted a little */
const HAND = 'italic 600 92px "Segoe Script", "Bradley Hand", "Snell Roundhand", "Dancing Script", "Brush Script MT", cursive';

function paperCanvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = ENV_W;
  canvas.height = ENV_H;
  return [canvas, canvas.getContext('2d')!];
}

/** the paper, its grain and the air-mail border (slanted red and blue dashes), top and bottom */
function paperBase(ctx: CanvasRenderingContext2D, seed: number): void {
  ctx.fillStyle = '#f5edd9';
  ctx.fillRect(0, 0, ENV_W, ENV_H);
  ctx.fillStyle = 'rgba(120, 96, 60, 0.05)';
  let r = seed;
  const rand = (): number => ((r = (r * 16807) % 2147483647) - 1) / 2147483646;
  for (let i = 0; i < 700; i++) ctx.fillRect(rand() * ENV_W, rand() * ENV_H, 2, 1);
  const stripe = (y: number): void => {
    for (let x = -20; x < ENV_W + 20; x += 34) {
      ctx.fillStyle = (x / 34) % 2 === 0 ? '#d3392f' : '#2457c9';
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 20, y);
      ctx.lineTo(x + 8, y + 16);
      ctx.lineTo(x - 12, y + 16);
      ctx.fill();
    }
  };
  stripe(0);
  stripe(ENV_H - 16);
}

/**
 * The front: a stamp with a dart on it, a wavy postmark, and the address. With a name, the name is written
 * across it by hand (one personal letter to one person); without one, the address is three ruled lines.
 */
function drawFront(ctx: CanvasRenderingContext2D, name: string | null): void {
  paperBase(ctx, 11);
  ctx.fillStyle = '#e8d9b5';
  ctx.fillRect(ENV_W - 112, 34, 78, 94);
  ctx.strokeStyle = '#b4452f';
  ctx.lineWidth = 4;
  ctx.strokeRect(ENV_W - 108, 38, 70, 86);
  ctx.fillStyle = '#2457c9';
  ctx.beginPath();
  ctx.moveTo(ENV_W - 98, 100);
  ctx.lineTo(ENV_W - 46, 66);
  ctx.lineTo(ENV_W - 70, 106);
  ctx.lineTo(ENV_W - 78, 86);
  ctx.fill();
  ctx.strokeStyle = 'rgba(40, 40, 50, 0.55)';
  ctx.lineWidth = 3;
  for (let k = 0; k < 4; k++) {
    ctx.beginPath();
    ctx.moveTo(ENV_W - 190, 60 + k * 12);
    ctx.bezierCurveTo(ENV_W - 160, 44 + k * 12, ENV_W - 140, 76 + k * 12, ENV_W - 100, 56 + k * 12);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(40, 46, 70, 0.7)';
  if (!name) {
    for (const [y, w] of [[170, 230], [204, 280], [238, 190]] as const) {
      ctx.beginPath();
      ctx.roundRect(70, y, w, 12, 6);
      ctx.fill();
    }
    return;
  }
  // the name, in ink, by hand: big enough to read from across the room
  ctx.save();
  ctx.translate(64, 222);
  ctx.rotate(-0.06);
  ctx.font = HAND;
  ctx.fillStyle = '#1d2f8f';
  ctx.fillText(name, 0, 0, 330);
  const w = Math.min(ctx.measureText(name).width, 330);
  // and a quick underline swash
  ctx.strokeStyle = 'rgba(29, 47, 143, 0.8)';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(4, 22);
  ctx.bezierCurveTo(w * 0.35, 34, w * 0.7, 12, w + 26, 18);
  ctx.stroke();
  ctx.restore();
  for (const [y, w2] of [[262, 210], [290, 150]] as const) {
    ctx.beginPath();
    ctx.roundRect(72, y, w2, 10, 5);
    ctx.fill();
  }
}

function drawBack(ctx: CanvasRenderingContext2D): void {
  paperBase(ctx, 23);
  // the flap: a V from the top corners to a point below the middle, with a wax seal there
  ctx.strokeStyle = 'rgba(110, 86, 52, 0.6)';
  ctx.lineWidth = 3;
  ctx.fillStyle = 'rgba(200, 180, 140, 0.35)';
  ctx.beginPath();
  ctx.moveTo(0, 18);
  ctx.lineTo(ENV_W / 2, ENV_H * 0.62);
  ctx.lineTo(ENV_W, 18);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#b3261e';
  ctx.beginPath();
  ctx.arc(ENV_W / 2, ENV_H * 0.62, 26, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255, 220, 200, 0.5)';
  ctx.beginPath();
  ctx.moveTo(ENV_W / 2 - 10, ENV_H * 0.62 + 8);
  ctx.lineTo(ENV_W / 2 + 12, ENV_H * 0.62 - 8);
  ctx.lineTo(ENV_W / 2 + 2, ENV_H * 0.62 + 12);
  ctx.fill();
}

function texture(canvas: HTMLCanvasElement): CanvasTexture {
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** the desk's envelopes: their fronts carry the name of whoever's envelope is leaving the laptop */
const LIVE = new Set<{ ctx: CanvasRenderingContext2D; tex: CanvasTexture }>();
let stamped: string | null | undefined;
/** past this story-t the three desk envelopes have folded into darts (RELEASE_T[2] + STAGE.foldTo) */
const DESK_STAMP_UNTIL = RELEASE_T[2] + STAGE.foldTo + 0.002;

/**
 * Writes the name of the envelope now leaving the laptop (Amy, Ben, then Cara: fleet.ts DESK_NAMES) on every
 * desk envelope, and clears it once all three are darts. Cheap: a redraw only when the name changes. The
 * envelopes are shown one at a time, so one face serves all three (BatchSend shares one material).
 */
export function stampDeskEnvelopes(t: number): void {
  const sent = RELEASE_T.filter((r) => t >= r).length;
  const name = t < DESK_STAMP_UNTIL ? DESK_NAMES[Math.max(sent - 1, 0)]! : null;
  if (name === stamped) return;
  stamped = name;
  for (const e of LIVE) {
    drawFront(e.ctx, name);
    e.tex.needsUpdate = true;
  }
}

/**
 * The two faces of an air-mail envelope, one canvas each: the front with the red-and-blue border, a stamp,
 * a postmark and the address (a name written by hand, or ruled lines); the back with the V of the flap and a
 * wax seal. With no argument the front is a desk envelope's, which `stampDeskEnvelopes` writes the leaving
 * person's name on; with a name (or null for none) it is fixed.
 */
export function envelopeTextures(name?: string | null): { front: CanvasTexture; back: CanvasTexture } {
  const [fc, fctx] = paperCanvas();
  const [bc, bctx] = paperCanvas();
  const live = name === undefined;
  drawFront(fctx, live ? stamped ?? DESK_NAMES[0] : name);
  drawBack(bctx);
  const front = texture(fc);
  const back = texture(bc);
  if (live) {
    const entry = { ctx: fctx, tex: front };
    LIVE.add(entry);
    front.addEventListener('dispose', () => LIVE.delete(entry));
  }
  return { front, back };
}

/** A thin envelope: paper edges, the front on top and the back underneath. */
function envelopeGeometry(): BufferGeometry {
  return new BoxGeometry(0.78, 0.02, 0.527);
}

const SHOW_FROM = 0.2;
const SHOW_TO = 0.31; // the escort stays over the town only: the cloud sea beyond it is the plane alone
/** the escort: the next five in the campaign's queue after the two scouts (fleet.ts rows #3 to #7) */
const ESCORT = FLEET.slice(2, 7);
const COUNT = ESCORT.length;

/**
 * The escort — five envelopes flying V-formation off the plane's wing over the town: the next five
 * people in the queue, each one's name written on its envelope by hand, each waiting its turn. Hovering
 * one raises it and shows the HUD tooltip ("→ Dev · investor · 09:15 · waits its turn").
 */
export class Envelopes {
  private static readonly FORWARD = new Vector3(0, 0, 1);
  readonly group = new Group();
  private meshes: Mesh[] = [];
  private materials: MeshStandardMaterial[] = [];
  private faces = ESCORT.map((r) => envelopeTextures(r.name));
  private geometry = envelopeGeometry();
  private extra: MeshStandardMaterial[] = [];
  private hoveredIndex = -1;
  private worldPos = new Vector3();

  constructor(raycast: Raycast, private tooltip: Tooltip) {
    for (let i = 0; i < COUNT; i++) {
      const paper = (map?: CanvasTexture): MeshStandardMaterial => new MeshStandardMaterial({
        ...(map ? { map, emissiveMap: map } : { color: '#efe6cf' }),
        emissive: '#ffd9a0',
        emissiveIntensity: 0.55, // lit paper — at 0 they flew as backlit gray slabs
        roughness: 0.75,
      });
      // BoxGeometry's groups: +x, -x, +y (the front), -y (the back), +z, -z
      const edge = paper();
      const front = paper(this.faces[i]!.front);
      const back = paper(this.faces[i]!.back);
      const material = front;
      const mesh = new Mesh(this.geometry, [edge, edge, front, back, edge, edge]);
      this.extra.push(edge, back);
      this.group.add(mesh);
      this.meshes.push(mesh);
      this.materials.push(material);
      raycast.register({
        object: mesh,
        onEnter: () => {
          this.hoveredIndex = i;
          this.tooltip.show(`${chipLabel(ESCORT[i]!, false)} · ${ESCORT[i]!.role} · ${ESCORT[i]!.clock} · waits its turn`);
        },
        onLeave: () => {
          if (this.hoveredIndex === i) this.hoveredIndex = -1;
          this.tooltip.hide();
        },
      });
    }
  }

  update(planePos: Vector3, side: Vector3, tangent: Vector3, t: number, time: number, camera: Camera): void {
    // the desk's envelopes carry the name of whoever is leaving the laptop (called every frame: cheap)
    stampDeskEnvelopes(t);
    const fadeIn = MathUtils.smoothstep(t, SHOW_FROM, SHOW_FROM + 0.06);
    const fadeOut = 1 - MathUtils.smoothstep(t, SHOW_TO - 0.03, SHOW_TO);
    this.group.visible = Math.min(fadeIn, fadeOut) > 0.01;
    if (!this.group.visible) return;

    for (let i = 0; i < COUNT; i++) {
      const mesh = this.meshes[i]!;
      const rank = i + 1;
      const lateral = (i % 2 === 0 ? 1 : -1) * Math.ceil(rank / 2) * 1.1;
      const back = Math.ceil(rank / 2) * 1.4;
      const bob = Math.sin(time * 1.3 + i * 1.9) * 0.12;
      const lift = this.hoveredIndex === i ? 0.35 : 0;
      // staggered join: each one climbs into its slot from the cloud deck
      // behind — no more slabs popping into existence beside the plane
      const join = MathUtils.smoothstep(t, SHOW_FROM + i * 0.01, SHOW_FROM + i * 0.01 + 0.05);

      mesh.position
        .copy(planePos)
        .addScaledVector(tangent, -back - (1 - join) * 7)
        .addScaledVector(side, lateral * (0.4 + 0.6 * join));
      mesh.position.y += -0.2 + bob + lift - (1 - join) * 3.4;
      mesh.quaternion.setFromUnitVectors(Envelopes.FORWARD, tangent);
      // stood up toward the camera that trails the plane, so the face with the stamp and the
      // address is what is seen, not the paper's edge
      mesh.rotateX(-0.95);
      mesh.rotateY(Math.sin(time * 0.9 + i * 2.1) * 0.12);
      mesh.rotateZ((1 - join) * (i % 2 === 0 ? 0.7 : -0.7)); // banking in
      mesh.scale.setScalar(fadeOut * (0.35 + 0.65 * join));

      const target = this.hoveredIndex === i ? 1.6 : 0.55;
      const m = this.materials[i]!;
      m.emissiveIntensity += (target - m.emissiveIntensity) * 0.2;
      for (const x of [this.extra[i * 2]!, this.extra[i * 2 + 1]!]) x.emissiveIntensity = m.emissiveIntensity;
    }

    // tooltip follows the hovered envelope in screen space
    if (this.hoveredIndex >= 0) {
      this.worldPos.setFromMatrixPosition(this.meshes[this.hoveredIndex]!.matrixWorld);
      this.tooltip.pin(this.worldPos, camera);
    }
  }

  dispose(): void {
    this.geometry.dispose();
    for (const f of this.faces) {
      f.front.dispose();
      f.back.dispose();
    }
    for (const m of [...this.materials, ...this.extra]) m.dispose();
  }
}
