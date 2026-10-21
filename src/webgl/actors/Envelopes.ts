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

/**
 * The two faces of an air-mail envelope, one canvas each: the front with the red-and-blue
 * border, a stamp, a postmark and the address lines; the back with the V of the flap and a wax
 * seal. They used to be flat cream slabs seen edge-on, which read as white plates.
 */
function envelopeTextures(): { front: CanvasTexture; back: CanvasTexture } {
  const W = 512;
  const H = 346;
  const make = (draw: (ctx: CanvasRenderingContext2D) => void): CanvasTexture => {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#f5edd9';
    ctx.fillRect(0, 0, W, H);
    // paper grain
    ctx.fillStyle = 'rgba(120, 96, 60, 0.05)';
    for (let i = 0; i < 700; i++) ctx.fillRect(Math.random() * W, Math.random() * H, 2, 1);
    // the air-mail border: slanted red and blue dashes
    const stripe = (y: number): void => {
      for (let x = -20; x < W + 20; x += 34) {
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
    stripe(H - 16);
    draw(ctx);
    const t = new CanvasTexture(canvas);
    t.colorSpace = SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  };
  const front = make((ctx) => {
    // stamp, with a dart on it, and a wavy postmark across its corner
    ctx.fillStyle = '#e8d9b5';
    ctx.fillRect(W - 112, 34, 78, 94);
    ctx.strokeStyle = '#b4452f';
    ctx.lineWidth = 4;
    ctx.strokeRect(W - 108, 38, 70, 86);
    ctx.fillStyle = '#2457c9';
    ctx.beginPath();
    ctx.moveTo(W - 98, 100);
    ctx.lineTo(W - 46, 66);
    ctx.lineTo(W - 70, 106);
    ctx.lineTo(W - 78, 86);
    ctx.fill();
    ctx.strokeStyle = 'rgba(40, 40, 50, 0.55)';
    ctx.lineWidth = 3;
    for (let k = 0; k < 4; k++) {
      ctx.beginPath();
      ctx.moveTo(W - 190, 60 + k * 12);
      ctx.bezierCurveTo(W - 160, 44 + k * 12, W - 140, 76 + k * 12, W - 100, 56 + k * 12);
      ctx.stroke();
    }
    // the address
    ctx.fillStyle = 'rgba(40, 46, 70, 0.7)';
    for (const [y, w] of [[170, 230], [204, 280], [238, 190]] as const) {
      ctx.beginPath();
      ctx.roundRect(70, y, w, 12, 6);
      ctx.fill();
    }
  });
  const back = make((ctx) => {
    // the flap: a V from the top corners to a point below the middle, with a wax seal there
    ctx.strokeStyle = 'rgba(110, 86, 52, 0.6)';
    ctx.lineWidth = 3;
    ctx.fillStyle = 'rgba(200, 180, 140, 0.35)';
    ctx.beginPath();
    ctx.moveTo(0, 18);
    ctx.lineTo(W / 2, H * 0.62);
    ctx.lineTo(W, 18);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#b3261e';
    ctx.beginPath();
    ctx.arc(W / 2, H * 0.62, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 220, 200, 0.5)';
    ctx.beginPath();
    ctx.moveTo(W / 2 - 10, H * 0.62 + 8);
    ctx.lineTo(W / 2 + 12, H * 0.62 - 8);
    ctx.lineTo(W / 2 + 2, H * 0.62 + 12);
    ctx.fill();
  });
  return { front, back };
}

/** A thin envelope: paper edges, the front on top and the back underneath. */
function envelopeGeometry(): BufferGeometry {
  return new BoxGeometry(0.78, 0.02, 0.527);
}

const COUNT = 5;
const SHOW_FROM = 0.2;
const SHOW_TO = 0.46; // escort peels away before the beacon — CH6 is the plane alone

/**
 * CH4: the escort — five envelopes flying V-formation off the plane's wing,
 * one per sequence step. Hovering one raises it and shows the HUD tooltip
 * ("Step N · waits · cancels on reply").
 */
export class Envelopes {
  private static readonly FORWARD = new Vector3(0, 0, 1);
  readonly group = new Group();
  private meshes: Mesh[] = [];
  private materials: MeshStandardMaterial[] = [];
  private faces = envelopeTextures();
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
      const front = paper(this.faces.front);
      const back = paper(this.faces.back);
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
          this.tooltip.show(`STEP ${i + 1} · WAITS ${i + 2} DAYS · CANCELS ON REPLY`);
        },
        onLeave: () => {
          if (this.hoveredIndex === i) this.hoveredIndex = -1;
          this.tooltip.hide();
        },
      });
    }
  }

  update(planePos: Vector3, side: Vector3, tangent: Vector3, t: number, time: number, camera: Camera): void {
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
    this.faces.front.dispose();
    this.faces.back.dispose();
    for (const m of [...this.materials, ...this.extra]) m.dispose();
  }
}
