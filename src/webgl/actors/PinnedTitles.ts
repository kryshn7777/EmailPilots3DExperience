import {
  CanvasTexture,
  Group,
  LinearMipmapLinearFilter,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { HOME_CHAPTERS, PINNED_TITLES } from '../../story/copy';

/**
 * Chapter titles pinned into the world, the way a camera-tracked title is in a film: real geometry
 * standing in the scene, so a roof or a tower that passes in front of it hides it, and the haze
 * dims it with distance. Each is a plane carrying a canvas-drawn lockup (heavy / thin / heavy
 * condensed capitals, justified to one width) that holds still in the world while the camera goes by.
 *
 * The camera is directed per chapter (it looks down at the formation, back at the towers, up at the
 * sky), so each title is placed from the frames the rig gives across its window (`from`..`to`): the spot that
 * stays nearest the middle of the lens through it, a little above centre. Upright titles face the camera; where the camera looks steeply down the
 * title lies flat over the scene instead, its top toward the heading. If a chapter's rig changes,
 * re-sample the camera across its window and refit its spot.
 */
interface Spot {
  /** the story times it stands between (the camera was sampled across them) */
  from: number;
  to: number;
  pos: [number, number, number];
  /** world units across */
  width: number;
  /** upright: the point it squares to (the camera, at its own height) */
  face?: [number, number, number];
  /** flat: the heading its top points along, as a yaw in radians */
  flat?: number;
  /** false: stays crisp in thick weather (default: the haze dims it with distance) */
  fog?: boolean;
}

const SPOTS: Record<string, Spot> = {
  desk: { from: -0.007, to: 0.047, pos: [0.72, 2.0, 0.89], width: 1.21, face: [2.04, 2.0, 2.62] },
  preflight: { from: 0.098, to: 0.152, pos: [20.38, 0.9, 8.52], width: 7.21, face: [8.92, 0.9, 2.25] },
  takeoff: { from: 0.163, to: 0.217, pos: [44.47, 0.55, 14.21], width: 12.17, face: [28.47, 0.55, 12.93] },
  formation: { from: 0.288, to: 0.342, pos: [81.49, 24.34, 0.76], width: 9.94, face: [67.6, 24.34, 4.87] },
  storm: { from: 0.388, to: 0.442, pos: [128.18, -3.34, -14.97], width: 34.76, face: [98.48, -3.34, 0.05], fog: false },
  beacon: { from: 0.518, to: 0.572, pos: [109.91, 35.32, -33.71], width: 20.87, face: [147.6, 35.32, 0.9] },
  'no-fly': { from: 0.568, to: 0.622, pos: [152.88, -3.72, 11.0], width: 22.84, flat: -2.693 },
  city: { from: 0.688, to: 0.742, pos: [199.14, 1.78, 0.55], width: 10.5, face: [185.86, 1.78, 1.18] },
  copilot: { from: 0.788, to: 0.842, pos: [222.79, 22.6, 0.95], width: 6.25, face: [211.95, 22.6, -0.5] },
  landing: { from: 0.93, to: 0.968, pos: [273.4, 2.6, 8.6], width: 5.4, face: [263.5, 2.6, -4.0] },
};

const UP = new Vector3(0, 1, 0);
const TEXT_W = 1800;
const PAD = 124;
const CANVAS_W = TEXT_W + PAD * 2;

const FADE_IN = 0.014;
const FADE_OUT = 0.014;

interface Title {
  mesh: Mesh;
  material: MeshBasicMaterial;
  from: number;
  to: number;
}

export class PinnedTitles {
  readonly group = new Group();
  private titles: Title[] = [];
  private ready = false;
  private tmp = new Vector3();

  constructor() {
    this.group.name = 'pinned-titles';
    this.group.visible = false;
    PINNED_TITLES.forEach((copy) => {
      const spot = SPOTS[copy.id]!;
      const material = new MeshBasicMaterial({
        transparent: true,
        depthWrite: false,
        toneMapped: false,
        fog: spot.fog !== false,
        opacity: 0,
      });
      const mesh = new Mesh(new PlaneGeometry(1, 1), material);
      mesh.position.set(...spot.pos);
      if (spot.flat !== undefined) {
        // lying over the scene, top toward the heading
        mesh.rotation.x = -Math.PI / 2;
        mesh.rotateOnWorldAxis(UP, spot.flat);
      } else {
        mesh.lookAt(...spot.face!);
      }
      mesh.userData.width = spot.width;
      mesh.visible = false;
      mesh.renderOrder = 6;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.titles.push({ mesh, material, from: spot.from, to: spot.to });
    });
    void this.draw();
  }

  /** the lockups are drawn once the fonts are in: until then the titles simply are not there */
  private async draw(): Promise<void> {
    try {
      await Promise.all([
        document.fonts.load('700 100px Oswald'),
        document.fonts.load('400 100px Oswald'),
        document.fonts.load('500 40px "Inter Variable"'),
      ]);
    } catch {
      return;
    }
    PINNED_TITLES.forEach((copy, i) => {
      const kicker = HOME_CHAPTERS.find((c) => c.id === copy.id)?.kicker ?? '';
      const title = this.titles[i]!;
      const { canvas, aspect } = lockup(kicker, copy.lines);
      const map = new CanvasTexture(canvas);
      map.colorSpace = SRGBColorSpace;
      map.anisotropy = 8;
      map.minFilter = LinearMipmapLinearFilter;
      title.material.map = map;
      title.material.needsUpdate = true;
      const width = title.mesh.userData.width as number;
      title.mesh.scale.set(width, width * aspect, 1);
    });
    this.ready = true;
  }

  update(t: number, eye: Vector3, enabled: boolean): void {
    const on = enabled && this.ready;
    this.group.visible = on;
    if (!on) return;
    for (const { mesh, material, from, to } of this.titles) {
      const window = MathUtils.smoothstep(t, from, from + FADE_IN) * (1 - MathUtils.smoothstep(t, to - FADE_OUT, to));
      // it dissolves as the lens closes on it, instead of the camera slicing through it
      const width = mesh.userData.width as number;
      const near = MathUtils.smoothstep(this.tmp.copy(mesh.position).distanceTo(eye), width * 0.12, width * 0.45);
      material.opacity = window * near;
      mesh.visible = material.opacity > 0.003;
    }
  }

  dispose(): void {
    for (const { mesh, material } of this.titles) {
      mesh.geometry.dispose();
      material.map?.dispose();
      material.dispose();
    }
  }
}

/** Draws the lockup on a canvas and returns it with its height-to-width ratio. */
function lockup(kicker: string, lines: string[]): { canvas: HTMLCanvasElement; aspect: number } {
  const scratch = document.createElement('canvas').getContext('2d')!;
  const heavy = (px: number): string => `700 ${px}px Oswald`;
  const thin = (px: number): string => `400 ${px}px Oswald`;

  // heavy lines are fitted to the full width, the thin one is tracked out to it
  const rows = lines.map((raw, i) => {
    const text = raw.toUpperCase();
    if (i % 2 === 0) {
      scratch.font = heavy(100);
      const size = Math.min((TEXT_W / scratch.measureText(text).width) * 100, 330);
      scratch.font = heavy(size);
      const cap = scratch.measureText('H').actualBoundingBoxAscent;
      return { text, kind: 'heavy' as const, size, cap, width: scratch.measureText(text).width };
    }
    const size = 132;
    scratch.font = thin(size);
    const cap = scratch.measureText('H').actualBoundingBoxAscent;
    const glyphs = [...text].map((ch) => scratch.measureText(ch).width);
    const natural = glyphs.reduce((a, b) => a + b, 0);
    const tracking = Math.min((TEXT_W - natural) / Math.max(text.length - 1, 1), size * 1.1);
    return { text, kind: 'thin' as const, size, cap, width: natural + tracking * (text.length - 1), glyphs, tracking };
  });

  const kickerH = 46;
  const gap = 58;
  const height = Math.ceil(PAD + kickerH + gap + rows.reduce((h, r) => h + r.cap, 0) + gap * (rows.length - 1) + PAD);
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_W;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = 'rgba(2, 6, 18, 0.45)';
  ctx.shadowBlur = 28;

  // the chapter label, small and tracked, in the site's beam colour
  ctx.font = '500 40px "Inter Variable", Inter, sans-serif';
  ctx.fillStyle = '#7fe8d8';
  let x = PAD;
  const y0 = PAD + kickerH * 0.8;
  for (const ch of kicker.toUpperCase()) {
    ctx.fillText(ch, x, y0);
    x += ctx.measureText(ch).width + 14;
  }

  ctx.fillStyle = '#ffffff';
  let y = PAD + kickerH + gap;
  for (const r of rows) {
    y += r.cap;
    if (r.kind === 'heavy') {
      ctx.font = heavy(r.size);
      // the lines share one left and one right edge
      ctx.fillText(r.text, PAD + (TEXT_W - r.width) / 2, y);
    } else {
      ctx.font = thin(r.size);
      let px = PAD + (TEXT_W - r.width) / 2;
      r.text.split('').forEach((ch, k) => {
        ctx.fillText(ch, px, y);
        px += r.glyphs![k]! + r.tracking!;
      });
    }
    y += gap;
  }
  return { canvas, aspect: height / CANVAS_W };
}
