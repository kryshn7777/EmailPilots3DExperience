import {
  BufferAttribute,
  CanvasTexture,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  RepeatWrapping,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
} from 'three';
import { mulberry32 } from '../util';

const PANELS = 6;

/**
 * Canvas-woven cotton duck: the colour map has the weave in it and a darker double-stitched seam
 * between every panel (u = k / PANELS); the bump map is the same weave in grey, so the fabric
 * catches the lamp the way cloth does and not like painted plastic.
 */
function fabricTextures(base: string): { map: CanvasTexture; bump: CanvasTexture } {
  const W = 1024;
  const H = 512;
  const draw = (ground: string, thread: [string, string], seam: string): CanvasTexture => {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.fillStyle = ground;
    ctx.fillRect(0, 0, W, H);
    // plain weave: alternating warp and weft threads, each a touch lighter or darker
    const rand = mulberry32(7);
    for (let y = 0; y < H; y += 3) {
      for (let x = 0; x < W; x += 3) {
        const over = ((x + y) / 3) % 2 === 0;
        ctx.fillStyle = thread[over ? 0 : 1];
        ctx.globalAlpha = 0.07 + rand() * 0.09;
        if (over) ctx.fillRect(x, y, 3, 2);
        else ctx.fillRect(x, y, 2, 3);
      }
    }
    ctx.globalAlpha = 1;
    // double-stitched seams
    for (let k = 0; k < PANELS; k++) {
      const x = (k / PANELS) * W;
      ctx.fillStyle = seam;
      ctx.globalAlpha = 0.16;
      ctx.fillRect(x - 6, 0, 12, H);
      ctx.globalAlpha = 0.55;
      for (let y = 0; y < H; y += 9) {
        ctx.fillRect(x - 3.5, y, 2, 5);
        ctx.fillRect(x + 1.5, y + 4, 2, 5);
      }
    }
    ctx.globalAlpha = 1;
    const t = new CanvasTexture(canvas);
    t.wrapS = t.wrapT = RepeatWrapping;
    t.anisotropy = 8;
    return t;
  };
  const map = draw(base, ['#ffffff', '#000000'], 'rgba(70, 38, 12, 1)');
  map.colorSpace = SRGBColorSpace;
  const bump = draw('#808080', ['#d0d0d0', '#303030'], '#101010');
  return { map, bump };
}

/**
 * The beanbag's body: a sphere pressed into a slumped pear. The base is flattened where it
 * rests on the floor, the back sits taller than the front, the seat is dished where someone has
 * been sitting, each of the eight panels is puffed between its seams, and a little low-frequency
 * wrinkling keeps it from looking moulded. Authored in place on the vertices: no morph, no skin.
 */
function bodyGeometry(): SphereGeometry {
  const g = new SphereGeometry(1, 96, 64);
  const pos = g.attributes.position as BufferAttribute;
  const RX = 0.68;
  const RZ = 0.64;
  const RY = 0.46;
  const gauss = (v: number, s: number): number => Math.exp(-(v * v) / (s * s));
  for (let i = 0; i < pos.count; i++) {
    const nx = pos.getX(i);
    const ny = pos.getY(i);
    const nz = pos.getZ(i);
    const theta = Math.atan2(nz, nx);
    // panel profile: 0 at a seam, 1 mid-panel; the seams pinch in, the panels bulge out
    const pan = (1 - Math.cos(theta * PANELS)) / 2;
    const belly = 1 - Math.abs(ny) ** 5; // the poles stay round
    const puff = 1 + (0.03 * Math.pow(pan, 0.7) - 0.012) * belly;
    let x = nx * RX * puff;
    let z = nz * RZ * puff;
    // heavier low down, narrower at the top: a pear
    const taper = 1 + 0.22 * Math.max(0, -ny) - 0.16 * Math.max(0, ny) ** 1.4;
    x *= taper;
    z *= taper;
    let y = ny * RY;
    // flat where it sits on the floor
    if (y < -RY * 0.62) y = -RY * 0.62 + (y + RY * 0.62) * 0.18;
    // the back (-z) is slouched up, the front (+z) dished down: where the sitter went
    const seat = Math.max(0, ny);
    y += seat * 0.3 * gauss(z + 0.36, 0.4) * gauss(x, 0.62);
    y -= seat * 0.38 * gauss(z - 0.12, 0.34) * gauss(x, 0.4);
    // compression creases fanning out from the seat
    const rr = Math.hypot(x, z - 0.12);
    y += seat * 0.02 * Math.sin(Math.atan2(z - 0.12, x) * 11 + rr * 7) * gauss(rr, 0.6);
    // pushed-out sides under the weight, pulled-in top corners
    x *= 1 + 0.05 * gauss(ny + 0.3, 0.45);
    // slow wrinkles
    const w = 0.012 * Math.sin(x * 9 + z * 5) * Math.sin(y * 11 + x * 4) + 0.008 * Math.sin(z * 13 - y * 7);
    pos.setXYZ(i, x + nx * w, y + ny * w * 0.6, z + nz * w);
  }
  g.computeVertexNormals();
  // lift so the lowest vertex rests on y = 0
  g.computeBoundingBox();
  g.translate(0, -g.boundingBox!.min.y, 0);
  return g;
}

/**
 * A big slouchy beanbag in ochre canvas, with a carry handle at the back. Stands on y = 0; its
 * seat faces +z. The caller places and turns it.
 */
export class Beanbag {
  readonly group = new Group();
  private disposables: { dispose(): void }[] = [];

  constructor(colour = '#c8902c') {
    const { map, bump } = fabricTextures(colour);
    map.repeat.set(1, 1);
    const cloth = new MeshPhysicalMaterial({
      map,
      bumpMap: bump,
      bumpScale: 0.9,
      color: '#ffffff',
      roughness: 0.92,
      metalness: 0,
      // the soft edge-light of fabric: a sheen in a warmer tint than the cloth
      sheen: 0.9,
      sheenRoughness: 0.55,
      sheenColor: '#ffe2b0',
    });
    const body = new Mesh(bodyGeometry(), cloth);
    this.group.add(body);

    // the carry handle: a loop of webbing standing up behind the seat
    const strap = new Mesh(new TorusGeometry(0.1, 0.022, 10, 28, Math.PI), cloth);
    strap.position.set(0, 0.5, -0.4);
    strap.rotation.set(-0.35, 0, 0);
    strap.scale.set(1.2, 1, 0.7);
    this.group.add(strap);

    this.disposables.push(body.geometry, strap.geometry, cloth, map, bump);
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
