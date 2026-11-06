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
import { PINNED_TITLES, type PinnedTitle } from '../../story/copy';
import { asset } from '../asset';
import { detectQuality } from '../quality';

/**
 * Chapter titles pinned into the world, the way a camera-tracked title is in a film: real geometry
 * standing in the scene, so a roof or a tower that passes in front of it hides it, and the haze
 * dims it with distance. Each is a plane carrying a canvas-drawn lockup that holds still in the world
 * while the camera goes by:
 *
 *   kicker   the feature the chapter shows, small tracked capitals in the beam colour, between two rules
 *   lines    heavy / thin / heavy condensed capitals, centred on one axis
 *   sub      one sentence (at most twelve words) in Inter, in the beam colour, at most two lines
 *            (pre-flight carries its big `note` and the Outlook mark instead)
 *
 * The camera is directed per chapter (it looks down at the formation, back at the towers, up at the
 * sky), so each title is placed from the frames the rig gives across its window (`from`..`to`): the spot
 * that stays nearest the middle of the lens through it, a little above centre. Upright titles face the
 * camera; where the camera looks steeply down the title lies flat over the scene instead, its top toward
 * the heading.
 *
 * A phone's lens is less than a third as wide as a desktop's, so every title has a `portrait` spot of its
 * own, fitted to the portrait camera (390 x 800) so the lettering stays inside a 16 px gutter and clear of
 * the fleet card at the top through the whole window, and the lockup is drawn with a bigger kicker and sub
 * there (`LAYOUT`), so they read at phone size. If a chapter's camera changes, re-sample it across the
 * window and refit the spot (README, "Pinned titles": `camsample.mjs` + `fitspots.mjs`).
 */
interface Placement {
  pos: [number, number, number];
  /** world units across a full-width (CANVAS_W) lockup: the scale of the lettering, whatever the title's own width */
  width: number;
  /** upright: the point it squares to (the camera, at its own height) */
  face?: [number, number, number];
  /** flat: the heading its top points along, as a yaw in radians */
  flat?: number;
  /**
   * Drawn over the scene (no depth test, no haze): for a phone's spot where the frame has no clear air for
   * it, so a house, a tree or the desk never takes a bite out of the words.
   */
  over?: boolean;
}

interface Spot extends Placement {
  /** the story times it stands between (the camera was sampled across them); title windows: direction §4.3 */
  from: number;
  to: number;
  /** false: stays crisp in thick weather (default: the haze dims it with distance) */
  fog?: boolean;
  /** the phone's spot (portrait), and its own window if it differs */
  portrait?: Placement & { from?: number; to?: number };
}

/**
 * One table, landscape and portrait. The landscape spots are fitted on 1280 x 720, the portrait ones on
 * 390 x 800: the camera is sampled at nine story times inside each window (camsample.mjs), and a spot is solved
 * for so the lettering (the lockup less its margin) stays inside a 16 px gutter at every one of them, clear of
 * the fleet card at the top and the cue at the foot, as big as that allows (fitspots.mjs; README, "Pinned
 * titles"). A portrait window may be shorter than the landscape one where the phone's narrow lens could not
 * hold a readable title through the whole of it (the camera pans at the desk, pitches down out of the window).
 * `over` spots are drawn over the scene: on a phone they stand where houses, trees or the desk would bite them.
 *
 * City and copilot are fitted on the final city-to-copilot line (WP-C), landing on the communications-tower
 * ending (WP-D).
 */
const SPOTS: Record<string, Spot> = {
  desk: {
    from: -0.007, to: 0.047, pos: [0.78, 1.74, 0.83], width: 0.98, face: [2.04, 1.74, 2.62],
    // over the desk under the laptop; gone before the camera turns to the window
    portrait: { from: -0.007, to: 0.03, pos: [0.62, 1.08, 1.19], width: 1.097, face: [2.03, 1.08, 2.55], over: true },
  },
  preflight: {
    // under the departures board (Panel.ts), which stands over the street behind it
    from: 0.098, to: 0.152, pos: [20.38, -0.1, 8.52], width: 6.6, face: [8.92, -0.1, 2.25],
    // under the departures board (Panel.ts), which has the top of the frame
    portrait: { to: 0.142, pos: [27.5, -5.87, 12.14], width: 8.273, face: [7, -5.87, 1.15], over: true },
  },
  takeoff: {
    // crisp and over the street: the sunlit haze would wash it out and the street trees cut its sub
    from: 0.163, to: 0.217, pos: [44.47, 0.55, 14.21], width: 12.17, face: [28.47, 0.55, 12.93], fog: false, over: true,
    portrait: { to: 0.207, pos: [54.24, -6.23, 13.07], width: 13.511, face: [25.4, -6.23, 12.71], over: true },
  },
  formation: {
    from: 0.288, to: 0.342, pos: [81.49, 24.34, 0.76], width: 9.94, face: [67.6, 24.34, 4.87],
    portrait: { to: 0.334, pos: [88.88, 22.4, -2.32], width: 10.731, face: [65.96, 22.4, 5.19] },
  },
  storm: {
    // right of the frame's middle: the biplane towing ONE BY ONE crosses on the left
    from: 0.388, to: 0.442, pos: [156.28, -5.78, 26], width: 44, face: [98.45, -5.78, 0.05], fog: false,
    // over the biplane's banner (ONE BY ONE), which sweeps across a phone's frame right here
    portrait: { pos: [158.51, -0.82, -0.34], width: 33.673, face: [98.48, -0.82, 0.05], over: true },
  },
  // Out over the open sea on the run in to the lighthouse (the camera flies +x at about y 18, turning
  // left onto the tower). Fitted to the frames of 0.466 to 0.5 to stand on the water out to sea LEFT of the
  // tower, 62 to 68 units out (twice the tower's range, so the tower passes in front of it, never it in front
  // of the tower) and clear of the tower's screen box the whole way: the tower comes out of the fog beside
  // it. Crisp (no haze), as the sea mist lying on the water would otherwise swallow its bottom line.
  // On a phone the lens is too narrow for anything beside the tower, so it stands straight ahead, short of the
  // tower, while the tower is still lost in the fog, and goes as the camera's turn carries it off the frame.
  ocean: {
    from: 0.452, to: 0.512, pos: [169, 13.6, -45], width: 25, face: [114.94, 13.6, 1.42], fog: false,
    // (fitted 8 px inside the right gutter: the sub's last word ran off the frame at 0.48)
    portrait: { from: 0.452, to: 0.492, pos: [126.5, 18.77, -1.13], width: 6.278, face: [111.89, 18.77, 0.91] },
  },
  beacon: {
    // drawn over the tower, whose lantern railing would otherwise cut through DELIVERY
    from: 0.518, to: 0.572, pos: [109.91, 35.32, -33.71], width: 20.87, face: [147.6, 35.32, 0.9], over: true,
    // under the clearance card, which docks at the top of a phone's frame (DeliveryPopup.ts), over the tower
    portrait: { pos: [121.64, 30.27, -41.21], width: 18.812, face: [147.6, 30.27, 0.9], over: true },
  },
  'no-fly': {
    from: 0.568, to: 0.622, pos: [177.49, -3.72, -0.23], width: 28, flat: -2.693,
    portrait: { to: 0.612, pos: [161.58, -3.72, 7.39], width: 14.536, flat: -2.693 },
  },
  city: {
    // over the street: the canyon's traffic and lamps would take bites out of it
    from: 0.688, to: 0.742, pos: [199.14, 1.78, 0.55], width: 10.5, face: [185.86, 1.78, 1.18], over: true,
    // down the canyon, toward the IT-office tower the line climbs into (refitted on WP-C's line)
    portrait: { to: 0.732, pos: [217.88, 0.75, -0.49], width: 21.134, face: [182.57, 0.75, 1.06], over: true },
  },
  // in the sky ahead of the climb out of the tower's east face, toward the crest (fitted on WP-C's line: the
  // camera holds off the tower for the burst, then chases the dart up the 24 degree climb)
  copilot: {
    from: 0.8, to: 0.85, pos: [243.23, 24.45, -4.45], width: 22.427, face: [215.46, 24.45, 1.7],
    // over the skyline: on a phone the towers below the climb stand in front of its lower half
    // (refitted when the copilot's line went back to one speed into H: it no longer slows to a crawl at 0.83)
    portrait: { to: 0.838, pos: [255.52, 25.76, -11.58], width: 20.566, face: [212.39, 25.76, 2.19], over: true },
  },
  // in the dawn sky beyond the small house, as the dart dives out of its arc over the tower toward the one lit
  // window (fitted on WP-D's ending: the camera chases the dive at about -22 degrees), above the roof; crisp in the
  // dawn haze and drawn over it, so the roof's peak never bites the sub
  landing: {
    from: 0.958, to: 0.985, pos: [404.94, 6.08, -0.35], width: 33, face: [354.27, 6.08, -0.85], fog: false, over: true,
    portrait: { pos: [426, 5.16, -10.03], width: 49, face: [354.27, 5.16, -0.85], over: true },
  },
};

const UP = new Vector3(0, 1, 0);
/** the widest the lettering may run, and the margin around it (canvas px) */
const TEXT_W = 1800;
const PAD = 124;
/** the canvas width a spot's `width` is measured against: a lockup is cropped to its own width, at that scale */
const CANVAS_W = TEXT_W + PAD * 2;
const TEAL = '#7fe8d8';

/**
 * Type sizes on the 1800 px text block. On a phone the whole lockup is about 360 px across (a fifth of the
 * canvas), so the kicker and the sub are drawn bigger there to stay readable (about 12 and 18 px on screen).
 */
const LAYOUT = {
  landscape: { kicker: 46, kickerTrack: 12, sub: 64, subLead: 1.22, heavyMax: 330, thin: 132 },
  portrait: { kicker: 66, kickerTrack: 12, sub: 100, subLead: 1.18, heavyMax: 330, thin: 140 },
} as const;
type Layout = (typeof LAYOUT)[keyof typeof LAYOUT];

const FADE_IN = 0.014;
const FADE_OUT = 0.014;
/** the landing: how much bigger it starts, and how long it takes to settle */
const LAND = 0.09;
const LAND_T = 0.02;

interface Title {
  copy: PinnedTitle;
  mesh: Mesh;
  material: MeshBasicMaterial;
  spot: Spot;
  from: number;
  to: number;
  /** the drawn lockup's size in layout px (0 until it is drawn) */
  cw: number;
  ch: number;
  /** world units per layout px for the current spot */
  k: number;
}

export class PinnedTitles {
  readonly group = new Group();
  private titles: Title[] = [];
  private ready = false;
  private tmp = new Vector3();
  /** which frame the spots are placed and the lockups drawn for (null: not yet) */
  private portrait: boolean | null = null;
  private drawing: Promise<void> | null = null;
  private outlook: HTMLImageElement | null = null;
  /** texture resolution: phones do not need the full 2048 px canvas for a title a fifth of that wide */
  private res = detectQuality('').tier === 'high' ? 1 : 0.6;

  constructor() {
    this.group.name = 'pinned-titles';
    this.group.visible = false;
    for (const copy of PINNED_TITLES) {
      const spot = SPOTS[copy.id]!;
      const material = new MeshBasicMaterial({
        transparent: true,
        depthWrite: false,
        toneMapped: false,
        fog: spot.fog !== false,
        opacity: 0,
      });
      const mesh = new Mesh(new PlaneGeometry(1, 1), material);
      mesh.visible = false;
      mesh.renderOrder = 6;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.titles.push({ copy, mesh, material, spot, from: spot.from, to: spot.to, cw: 0, ch: 0, k: 0 });
    }
  }

  /** stands a title at its spot (or its portrait spot), sized to its lockup */
  private place(title: Title, portrait: boolean): void {
    const spot = title.spot;
    const at: Placement & { from?: number; to?: number } = (portrait && spot.portrait) || spot;
    const { mesh } = title;
    mesh.position.set(...at.pos);
    mesh.rotation.set(0, 0, 0);
    if (at.flat !== undefined) {
      // lying over the scene, top toward the heading
      mesh.rotation.x = -Math.PI / 2;
      mesh.rotateOnWorldAxis(UP, at.flat);
    } else {
      mesh.lookAt(...at.face!);
    }
    const over = !!at.over;
    if (title.material.depthTest === over) {
      title.material.depthTest = !over;
      title.material.fog = !over && spot.fog !== false;
      title.material.needsUpdate = true;
    }
    title.k = at.width / CANVAS_W;
    mesh.userData.width = at.width;
    if (title.cw) mesh.scale.set(title.cw * title.k, title.ch * title.k, 1);
    title.from = at.from ?? spot.from;
    title.to = at.to ?? spot.to;
  }

  /** the lockups are drawn once the fonts are in (and again if the screen turns): until then the titles are not there */
  private async draw(portrait: boolean): Promise<void> {
    try {
      await Promise.all([
        document.fonts.load('700 100px Oswald'),
        document.fonts.load('400 100px Oswald'),
        document.fonts.load('500 40px "Inter Variable"'),
        document.fonts.load('600 40px "Inter Variable"'),
      ]);
    } catch {
      return;
    }
    // the Outlook mark beside the claim, drawn unaltered (public/images/outlook.svg); without it the text stands alone
    this.outlook ??= await new Promise<HTMLImageElement | null>((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = asset('/images/outlook.svg');
    });
    const layout = portrait ? LAYOUT.portrait : LAYOUT.landscape;
    for (const title of this.titles) {
      const { canvas, w, h } = lockup(title.copy, layout, this.res, title.copy.logo === 'outlook' ? this.outlook : null);
      const map = new CanvasTexture(canvas);
      map.colorSpace = SRGBColorSpace;
      map.anisotropy = 8;
      map.minFilter = LinearMipmapLinearFilter;
      title.material.map?.dispose();
      title.material.map = map;
      title.material.needsUpdate = true;
      title.cw = w;
      title.ch = h;
      this.place(title, portrait);
    }
    this.ready = true;
  }

  update(t: number, eye: Vector3, enabled: boolean): void {
    const portrait = innerWidth < innerHeight;
    if (portrait !== this.portrait && !this.drawing) {
      this.portrait = portrait;
      for (const title of this.titles) this.place(title, portrait);
      this.drawing = this.draw(portrait).finally(() => {
        this.drawing = null;
      });
    }
    const on = enabled && this.ready;
    this.group.visible = on;
    if (!on) return;
    for (const title of this.titles) {
      const { mesh, material, from, to } = title;
      const window = MathUtils.smoothstep(t, from, from + FADE_IN) * (1 - MathUtils.smoothstep(t, to - FADE_OUT, to));
      // it dissolves as the lens closes on it, instead of the camera slicing through it
      const width = mesh.userData.width as number;
      const near = MathUtils.smoothstep(this.tmp.copy(mesh.position).distanceTo(eye), width * 0.12, width * 0.45);
      material.opacity = window * near;
      mesh.visible = material.opacity > 0.003;
      // it lands: a touch big as it fades in, settling to its size (pure in t, so a scrub plays it both ways)
      if (mesh.visible && title.cw) {
        const land = 1 + LAND * (1 - MathUtils.smoothstep(t, from, from + LAND_T));
        mesh.scale.set(title.cw * title.k * land, title.ch * title.k * land, 1);
      }
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

const heavy = (px: number): string => `700 ${px}px Oswald`;
const thin = (px: number): string => `400 ${px}px Oswald`;
const inter = (weight: number, px: number): string => `${weight} ${px}px "Inter Variable", Inter, sans-serif`;

/** Splits `text` into lines no wider than `max` in the context's current font. */
function wrap(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > max) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** the narrowest width at which `text` still wraps into `lines` lines or fewer (binary search) */
function balance(ctx: CanvasRenderingContext2D, text: string, lines: number, max: number): number {
  let lo = 0;
  let hi = max;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    if (wrap(ctx, text, mid).length <= lines) hi = mid;
    else lo = mid;
  }
  return hi;
}

/**
 * Draws a title's lockup and returns the canvas with its size in layout px (the canvas itself is `res`
 * times that). The lettering's scale does not depend on the title: a spot's `width` is the world width of a
 * full CANVAS_W lockup, and the canvas is cropped to the title's own width around it.
 */
function lockup(copy: PinnedTitle, L: Layout, res: number, logo: HTMLImageElement | null): { canvas: HTMLCanvasElement; w: number; h: number } {
  const ctx0 = document.createElement('canvas').getContext('2d')!;

  // the three lines: heavy ones fitted to the full width (up to a size), the thin one tracked out under them
  const rows = copy.lines.map((raw, i) => {
    const text = raw.toUpperCase();
    if (i % 2 === 0) {
      ctx0.font = heavy(100);
      const size = Math.min((TEXT_W / ctx0.measureText(text).width) * 100, L.heavyMax);
      ctx0.font = heavy(size);
      const cap = ctx0.measureText('H').actualBoundingBoxAscent;
      return { text, kind: 'heavy' as const, size, cap, width: ctx0.measureText(text).width, glyphs: [] as number[], tracking: 0 };
    }
    ctx0.font = thin(L.thin);
    const cap = ctx0.measureText('H').actualBoundingBoxAscent;
    const glyphs = [...text].map((ch) => ctx0.measureText(ch).width);
    const natural = glyphs.reduce((a, b) => a + b, 0);
    return { text, kind: 'thin' as const, size: L.thin, cap, width: natural, glyphs, tracking: 0 };
  });

  // the kicker, tracked
  const kicker = copy.kicker.toUpperCase();
  ctx0.font = inter(600, L.kicker);
  const kickerGlyphs = [...kicker].map((ch) => ctx0.measureText(ch).width);
  const kickerW = kickerGlyphs.reduce((a, b) => a + b, 0) + L.kickerTrack * (kicker.length - 1);
  const kickerCap = ctx0.measureText('H').actualBoundingBoxAscent;
  const rule = 70;

  // the block is as wide as the widest line (or the kicker with its rules), and at least wide enough for the
  // sub to sit on two lines
  let block = Math.max(...rows.map((r) => (r.kind === 'heavy' ? r.width : r.width * 1.5)), kickerW + 2 * (rule + 30));
  let subSize: number = L.sub;
  let subLines: string[] = [];
  if (copy.sub) {
    for (;;) {
      ctx0.font = inter(500, subSize);
      const need = balance(ctx0, copy.sub, 2, TEXT_W);
      if (wrap(ctx0, copy.sub, TEXT_W).length <= 2 || subSize < 30) {
        block = Math.min(Math.max(block, need), TEXT_W);
        // one line if it fits the block, else two balanced ones (never a word left alone on the second)
        subLines = ctx0.measureText(copy.sub).width <= block ? [copy.sub] : wrap(ctx0, copy.sub, need);
        break;
      }
      subSize *= 0.92;
    }
  }
  block = Math.min(block, TEXT_W);
  // the thin line is tracked out to the block (within reason)
  for (const r of rows) {
    if (r.kind !== 'thin') continue;
    r.tracking = Math.min((block - r.width) / Math.max(r.text.length - 1, 1), r.size * 1.1);
    r.width += r.tracking * (r.text.length - 1);
  }

  // the note (pre-flight): the claim a visitor should leave with, set big in the beam colour
  // (as big as the kicker x 1.9, but never wider than the text block: it shrinks to fit, mark and all)
  const note = copy.note?.toUpperCase() ?? '';
  const noteTrack = 14;
  let notePx = Math.round(L.kicker * 1.9);
  let noteFont = '';
  let noteCap = 0;
  let noteGlyphs: number[] = [];
  let markH = 0;
  let markW = 0;
  let noteW = 0;
  const markGap = logo ? 40 : 0;
  for (let i = 0; i < 12 && note; i++) {
    noteFont = `700 ${notePx}px Oswald`;
    ctx0.font = noteFont;
    noteCap = ctx0.measureText('H').actualBoundingBoxAscent;
    noteGlyphs = [...note].map((ch) => ctx0.measureText(ch).width);
    markH = logo ? noteCap * 1.6 : 0;
    markW = markH * (570.02 / 539.67);
    noteW = noteGlyphs.reduce((a, b) => a + b, 0) + noteTrack * (note.length - 1) + (logo ? markW + markGap : 0);
    if (noteW <= TEXT_W) break;
    notePx = Math.floor((notePx * TEXT_W) / noteW);
  }
  block = Math.min(Math.max(block, noteW), TEXT_W);

  const gap = 58;
  const subLead = subSize * L.subLead;
  const subH = subLines.length ? gap * 1.15 + subLead * (subLines.length - 1) + subSize * 0.74 : 0;
  const noteH = note ? gap * 1.15 + Math.max(noteCap, markH * 0.8) : 0;
  const w = Math.ceil(block + PAD * 2);
  const h = Math.ceil(PAD + kickerCap + gap + rows.reduce((s, r) => s + r.cap, 0) + gap * (rows.length - 1) + subH + noteH + PAD);
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(w * res);
  canvas.height = Math.ceil(h * res);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(res, res);
  ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = 'rgba(2, 6, 18, 0.5)';
  ctx.shadowBlur = 26;
  // the small type (kicker, sub, note) is outlined in the night colour too, so it reads over a lit lantern, a sunlit
  // street or a white flare as well as over the dark
  ctx.strokeStyle = 'rgba(2, 6, 18, 0.62)';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 7;
  const cx = w / 2;

  // the kicker: centred, between two short rules, in the beam colour
  ctx.font = inter(600, L.kicker);
  ctx.fillStyle = TEAL;
  let y = PAD + kickerCap;
  let x = cx - kickerW / 2;
  [...kicker].forEach((ch, k) => {
    ctx.strokeText(ch, x, y);
    ctx.fillText(ch, x, y);
    x += kickerGlyphs[k]! + L.kickerTrack;
  });
  ctx.fillRect(cx - kickerW / 2 - 30 - rule, y - kickerCap / 2 - 2, rule, 4);
  ctx.fillRect(cx + kickerW / 2 + 30, y - kickerCap / 2 - 2, rule, 4);
  y += gap;

  ctx.fillStyle = '#ffffff';
  for (const r of rows) {
    y += r.cap;
    if (r.kind === 'heavy') {
      ctx.font = heavy(r.size);
      ctx.fillText(r.text, cx - r.width / 2, y);
    } else {
      ctx.font = thin(r.size);
      let px = cx - r.width / 2;
      [...r.text].forEach((ch, k) => {
        ctx.fillText(ch, px, y);
        px += r.glyphs[k]! + r.tracking;
      });
    }
    y += gap;
  }
  y -= gap;

  if (subLines.length) {
    ctx.font = inter(500, subSize);
    ctx.fillStyle = TEAL;
    ctx.textAlign = 'center';
    y += gap * 1.15 + subSize * 0.74;
    for (const line of subLines) {
      ctx.strokeText(line, cx, y);
      ctx.fillText(line, cx, y);
      y += subLead;
    }
    ctx.textAlign = 'left';
  }
  if (note) {
    ctx.font = noteFont;
    ctx.fillStyle = TEAL;
    const base = y + gap * 1.15 + noteCap;
    let px = cx - noteW / 2;
    if (logo) {
      ctx.drawImage(logo, px, base - noteCap / 2 - markH / 2, markW, markH);
      px += markW + markGap;
    }
    [...note].forEach((ch, k) => {
      ctx.strokeText(ch, px, base);
      ctx.fillText(ch, px, base);
      px += noteGlyphs[k]! + noteTrack;
    });
  }
  return { canvas, w, h };
}
