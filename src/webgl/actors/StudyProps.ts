import {
  AdditiveBlending,
  BoxGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  Group,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Sprite,
  SpriteMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { cremaTexture, mugTexture, phoneScreenTexture, ringStainTexture, steamTexture, ATLAS, type MugSpec } from '../bake/StudyPropTextures';
import { Kit, atlasBox, bevelBox, lathe, placement, rod, tube } from './StudyKit';
import type { Dispose, StudyMats } from './StudyMaterials';

/** the desk top, local y: props rest here */
export const TOP = -0.1;

/** a mug's outer wall from the foot up, [radius, y]: recessed foot ring, a slight belly and a thick rounded lip */
const MUG_OUT: [number, number][] = [
  [0, 0.012], [0.12, 0.012], [0.15, 0.004], [0.165, 0], [0.176, 0.006], [0.178, 0.02], [0.185, 0.05], [0.19, 0.11],
  [0.192, 0.22], [0.19, 0.33], [0.188, 0.395], [0.192, 0.412], [0.196, 0.424], [0.19, 0.432], [0.178, 0.434],
];
/** the glazed inside: lip down the wall to the floor */
const MUG_IN: [number, number][] = [[0.178, 0.434], [0.166, 0.43], [0.16, 0.39], [0.158, 0.2], [0.155, 0.07], [0.14, 0.046], [0, 0.042]];

export interface DeskProps {
  update(time: number): void;
}

/**
 * Everything small on the desk, scaled to the laptop (its display is 1.38 wide, so a mug is about a
 * quarter of that across): lathed mugs with a swept handle and a printed band, the pen pot, books,
 * glasses, a phone, a framed photo, a stapler, clips, a letter opener, notes, a coaster, a succulent
 * and a bell. All static geometry is baked into the Kit; only the steam moves.
 */
export function buildDeskProps(k: Kit, parent: Group, m: StudyMats, own: Dispose[], tier: 'high' | 'low'): DeskProps {
  const high = tier === 'high';
  const keep = <T extends Dispose>(x: T): T => { own.push(x); return x; };
  const seg = high ? 36 : 20;

  // ——— mugs ———
    const mugParts = (spec: MugSpec, x: number, z: number, yaw: number, level: number): void => {
    const map = keep(mugTexture(spec));
    const outer = keep(high
      ? new MeshPhysicalMaterial({ map, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.06 })
      : new MeshStandardMaterial({ map, roughness: 0.25 }));
    const inner = keep(new MeshStandardMaterial({ color: new Color(spec.glaze).lerp(new Color('#f2e8d4'), 0.55), roughness: 0.22 }));
    const o = k.at({ x, y: TOP, z, ry: yaw });
    o.add(lathe(MUG_OUT, seg, [0, 0.434]), outer);
    o.add(lathe(MUG_IN, seg), inner);
    // the handle: a swept oval section leaving the body at the shoulder and rejoining low
    o.add(tube([[0.17, 0.355, 0], [0.255, 0.372, 0], [0.322, 0.31, 0], [0.332, 0.205, 0], [0.285, 0.115, 0], [0.18, 0.088, 0]], 0.028, high ? 22 : 12, high ? 10 : 6, 1.3), outer);
    // coffee: a meniscus climbing the wall, and a crema surface with a ring of bubbles
    const cremaMap = keep(cremaTexture());
    const coffee = keep(new MeshPhysicalMaterial({ map: cremaMap, roughness: 0.14, clearcoat: high ? 0.6 : 0, clearcoatRoughness: 0.1, color: '#e8d6c6' }));
    const dark = keep(new MeshStandardMaterial({ color: '#2b160a', roughness: 0.16 }));
    const cy = 0.434 - level;
    o.add(lathe([[0.136, cy - 0.006], [0.152, cy - 0.004], [0.159, cy + 0.003], [0.161, cy + 0.014]], seg), dark);
    o.add(new CircleGeometry(0.1535, seg).rotateX(-Math.PI / 2), coffee, { y: cy - 0.003 });
  };
  const logo: MugSpec = { glaze: '#232f55', drip: '#e9dfc9', ink: '#f4ead2', band: 'logo', seed: 4 };
  mugParts(logo, -1.95, 0.95, 0.5, 0.075);
  mugParts({ glaze: '#a83c40', drip: null, ink: '#f1e4cc', band: 'stripes', seed: 12 }, 1.3, 1.3, -0.3, 0.19);

  // a teaspoon resting in the hot mug, a cork coaster under it
  {
    const o = k.at({ x: -1.95, y: TOP, z: 0.95 });
    o.add(rod(new Vector3(-0.1, 0.07, 0.04), new Vector3(0.12, 0.5, 0.08), 0.009, 6), m.steel);
    o.add(new SphereGeometry(0.035, 10, 8).scale(1, 0.4, 1.4), m.steel, { x: -0.1, y: 0.075, z: 0.04, rz: 0.4 });
    const cork = keep(new MeshStandardMaterial({ color: '#a9814f', roughness: 0.95 }));
    o.add(lathe([[0, 0], [0.23, 0], [0.245, 0.01], [0.245, 0.024], [0.232, 0.03], [0, 0.03]], seg), cork, { y: -0.002 });
  }
  // the ring a mug left, and a double ring beside the red one
  const stain = keep(new MeshStandardMaterial({ map: keep(ringStainTexture()), transparent: true, depthWrite: false, roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
  stain.userData.noShadow = true;
  k.add(new PlaneGeometry(0.5, 0.5).rotateX(-Math.PI / 2), stain, { x: 0.82, y: TOP + 0.002, z: 1.62, ry: 0.4 });
  k.add(new PlaneGeometry(0.46, 0.46).rotateX(-Math.PI / 2), stain, { x: 0.98, y: TOP + 0.0025, z: 1.52, ry: 2.3 });

  // ——— pen pot, pens and a ruler ———
  {
    const potMat = keep(new MeshPhysicalMaterial({ color: '#1d1f24', roughness: 0.3, metalness: 0.15, clearcoat: high ? 0.6 : 0 }));
    const o = k.at({ x: -2.3, y: TOP, z: 0.05 });
    o.add(lathe([[0, 0], [0.15, 0], [0.165, 0.012], [0.172, 0.1], [0.175, 0.3], [0.185, 0.335], [0.178, 0.345], [0.158, 0.34], [0.152, 0.3], [0.148, 0.04], [0, 0.04]], seg), potMat);
    o.add(new TorusGeometry(0.168, 0.005, 6, seg).rotateX(Math.PI / 2), m.brass, { y: 0.16 });
    const pens: [string, number, number, number, number][] = [
      ['#c0392b', 0.76, 0.2, 0.2, 0.0], ['#1e3a8a', 0.8, 0.14, 2.6, 0.04], ['#f1c40f', 0.7, 0.3, 4.1, 0.03], ['#2d6a4f', 0.74, 0.18, 5.4, 0.02], ['#2a2a30', 0.82, 0.1, 1.4, 0.0],
    ];
    pens.forEach(([col, len, tilt, phi, off]) => {
      const mat = keep(new MeshStandardMaterial({ color: col, roughness: 0.35, metalness: 0.15 }));
      const a = new Vector3(Math.cos(phi) * off, 0.07, Math.sin(phi) * off);
      const dir = new Vector3(Math.sin(tilt) * Math.cos(phi), Math.cos(tilt), Math.sin(tilt) * Math.sin(phi));
      const b = a.clone().addScaledVector(dir, len);
      o.add(rod(a, b, 0.012, 7), mat);
      o.add(rod(a.clone().addScaledVector(dir, len * 0.82), b, 0.0135, 7), m.darkMetal);
      o.add(rod(a, a.clone().addScaledVector(dir, -0.03), 0.004, 5), m.steel);
    });
    const ruler = keep(new MeshStandardMaterial({ color: '#d9b36a', roughness: 0.5 }));
    o.add(new BoxGeometry(0.1, 0.95, 0.01), ruler, { x: 0.05, y: 0.53, z: 0.05, rz: -0.12, ry: 0.5 });
    // a few engraved ticks along the ruler
    if (high) for (let i = 0; i < 12; i++) o.add(new BoxGeometry(i % 5 ? 0.03 : 0.055, 0.004, 0.012), m.ink, { x: 0.0 + 0.0, y: 0.18 + i * 0.065, z: 0.052, rz: -0.12, ry: 0.5 });
  }

  // ——— a hardback, two notebooks and the glasses on top ———
  {
    const o = k.at({ x: -2.75, y: TOP, z: 1.5, ry: 0.35 });
    const pages = ATLAS.bookPages;
    // hardback: cover boards stand proud of a cream page block; spine toward +z once yawed
    o.add(atlasBox(new BoxGeometry(0.68, 0.14, 0.95), [pages, ATLAS.bookSpine, ATLAS.bookFront, ATLAS.bookFront, pages, pages]), m.printed, { y: 0.07 });
    const nb = (cover: [number, number, number, number], y: number, yaw: number, w: number, d: number): void => {
      o.add(atlasBox(new BoxGeometry(w, 0.065, d), [pages, cover, cover, cover, pages, pages]), m.printed, { y, ry: yaw, x: 0.0 });
    };
    nb(ATLAS.nb1, 0.14 + 0.0325, 0.12, 0.62, 0.86);
    nb(ATLAS.nb0, 0.14 + 0.065 + 0.0325, -0.1, 0.6, 0.84);
    // reading glasses, folded open on the top cover
    if (high) {
      const g = k.at(placement({ y: 0.14 + 0.13 + 0.01, z: 0.05, ry: 0.5 }).premultiply(o.origin));
      const frame = keep(new MeshStandardMaterial({ color: '#1c1a1a', roughness: 0.3, metalness: 0.4 }));
      for (const s of [-1, 1]) {
        g.add(new TorusGeometry(0.085, 0.0095, 8, 26).rotateX(Math.PI / 2), frame, { x: s * 0.125 });
        g.add(new CircleGeometry(0.081, 20).rotateX(-Math.PI / 2), m.glass, { x: s * 0.125, y: 0.001 });
        g.add(tube([[s * 0.21, 0, 0], [s * 0.225, 0, -0.1], [s * 0.225, 0, -0.38], [s * 0.2, 0.012, -0.5]], 0.0065, 10, 5), frame);
      }
      g.add(new TorusGeometry(0.03, 0.0065, 6, 10, Math.PI).rotateX(Math.PI / 2), frame, { y: 0.0, z: -0.0 });
    }
  }

  // ——— phone, face up, its screen lit ———
  {
    const screenTex = keep(phoneScreenTexture());
    const screen = keep(new MeshStandardMaterial({ map: screenTex, emissiveMap: screenTex, emissive: '#ffffff', emissiveIntensity: 0.85, roughness: 0.15 }));
    const o = k.at({ x: 2.1, y: TOP, z: 1.6, ry: 0.55 });
    o.add(bevelBox(0.3, 0.032, 0.62, 0.011), m.darkMetal, { y: 0.016 });
    o.add(new PlaneGeometry(0.272, 0.585).rotateX(-Math.PI / 2), screen, { y: 0.0335 });
  }

  // ——— photograph in a walnut frame on an easel back ———
  {
    const o = k.at({ x: -0.35, y: TOP, z: -1.62, ry: 0.75, rx: -0.2 });
    const w = 0.7; const h = 0.5;
    for (const s of [-1, 1]) {
      o.add(new BoxGeometry(0.055, h, 0.04), m.walnutLacquer, { x: s * (w / 2 - 0.0275), y: h / 2 });
      o.add(new BoxGeometry(w, 0.055, 0.04), m.walnutLacquer, { y: h / 2 + s * (h / 2 - 0.0275) });
    }
    o.add(new BoxGeometry(w - 0.1, h - 0.1, 0.01), m.paper, { y: h / 2, z: -0.012 });
    const photo = new PlaneGeometry(w - 0.14, h - 0.14);
    const uv = photo.attributes.uv!;
    const r = ATLAS.photo;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, r[0] + uv.getX(i) * (r[2] - r[0]), r[1] + uv.getY(i) * (r[3] - r[1]));
    o.add(photo, m.printed, { y: h / 2, z: 0.0 });
    o.add(rod(new Vector3(0, h * 0.9, -0.02), new Vector3(0, 0.0, -0.3), 0.012, 5), m.walnut, { rx: 0.2 });
  }

  // ——— stapler ———
  if (high) {
    const o = k.at({ x: -0.95, y: TOP, z: -1.5, ry: -0.5 });
    const red = keep(new MeshStandardMaterial({ color: '#8f2f2a', roughness: 0.35, metalness: 0.1 }));
    o.add(bevelBox(0.62, 0.06, 0.17, 0.02), m.black, { y: 0.03 });
    o.add(bevelBox(0.6, 0.075, 0.15, 0.025), red, { y: 0.1, x: 0.0, rz: 0.04 });
    o.add(new CylinderGeometry(0.025, 0.025, 0.18, 10).rotateX(Math.PI / 2), m.steel, { x: -0.3, y: 0.085 });
    o.add(new BoxGeometry(0.1, 0.012, 0.14), m.steel, { x: 0.24, y: 0.062 });
  }

  // ——— paper clips in a brass dish, two strays on the desk ———
  if (high) {
    const o = k.at({ x: 0.45, y: TOP, z: -1.5 });
    o.add(lathe([[0, 0], [0.12, 0], [0.18, 0.04], [0.19, 0.075], [0.182, 0.075], [0.172, 0.045], [0.11, 0.012], [0, 0.012]], seg), m.brass);
    const clip = new TorusGeometry(0.036, 0.0035, 5, 12).scale(0.5, 1.5, 1);
    for (let i = 0; i < 9; i++) {
      const a = i * 2.4;
      o.add(clip.clone(), m.steel, { x: Math.cos(a) * 0.07 * (0.3 + (i % 3) * 0.3), y: 0.035 + (i % 3) * 0.012, z: Math.sin(a) * 0.07 * (0.3 + (i % 3) * 0.3), ry: a * 1.7, rx: 1.2 + (i % 2) * 0.4, rz: a });
    }
    clip.dispose();
    o.add(new TorusGeometry(0.036, 0.0035, 5, 12).scale(0.5, 1.5, 1), m.steel, { x: 0.34, y: 0.004, z: 0.12, rx: Math.PI / 2, rz: 0.7 });
    o.add(new TorusGeometry(0.036, 0.0035, 5, 12).scale(0.5, 1.5, 1), m.steel, { x: 0.46, y: 0.004, z: -0.02, rx: Math.PI / 2, rz: 2.1 });
  }

  // ——— letter opener lying on the letter ———
  if (high) {
    const o = k.at({ x: 2.7, y: TOP + 0.012, z: -1.35, ry: 0.9 });
    o.add(new CylinderGeometry(0.012, 0.045, 0.62, 4).rotateZ(Math.PI / 2).scale(1, 0.18, 1), m.brass, { x: 0.18, y: 0.01 });
    o.add(new CylinderGeometry(0.03, 0.026, 0.3, 8).rotateZ(Math.PI / 2), m.brassAged, { x: -0.28, y: 0.03 });
    o.add(new SphereGeometry(0.036, 10, 8), m.brass, { x: -0.44, y: 0.03 });
    o.add(new BoxGeometry(0.04, 0.03, 0.12), m.brass, { x: -0.12, y: 0.03 });
  }

  // ——— sticky notes, scribbled on, and a pad ———
  {
    const notes: [keyof typeof ATLAS, number, number, number, number][] = [
      ['note0', 0.18, 1.5, 0.35, 0], ['note1', 0.42, 1.28, -0.5, 1], ['note2', 0.48, 1.64, 0.9, 2], ['note3', -0.12, 1.2, 2.2, 3],
    ];
    for (const [id, x, z, yaw, n] of notes) {
      const g = new BoxGeometry(0.32, 0.004, 0.32);
      atlasBox(g, [ATLAS[id], ATLAS[id], ATLAS[id], ATLAS.cream, ATLAS[id], ATLAS[id]]);
      k.add(g, m.printed, { x, y: TOP + 0.0035 + n * 0.0016, z, ry: yaw });
    }
    const pad = new BoxGeometry(0.32, 0.07, 0.32);
    atlasBox(pad, [ATLAS.cream, ATLAS.cream, ATLAS.note0, ATLAS.cream, ATLAS.cream, ATLAS.cream]);
    k.add(pad, m.printed, { x: 0.85, y: TOP + 0.035, z: 1.9, ry: 0.15 });
  }

  // ——— flip calendar ———
  if (high) {
    const o = k.at({ x: -3.0, y: TOP, z: -0.75, ry: 0.9 });
    const h = 0.46; const w = 0.66;
    for (const s of [-1, 1]) {
      const leaf = new BoxGeometry(w, h, 0.012);
      atlasBox(leaf, [ATLAS.cream, ATLAS.cream, ATLAS.cream, ATLAS.cream, ATLAS.calendar, ATLAS.cream]);
      o.add(leaf, m.printed, { y: h / 2, z: s * 0.07, rx: s * 0.22 });
    }
    for (let i = 0; i < 10; i++) o.add(new TorusGeometry(0.02, 0.0035, 5, 10).rotateY(Math.PI / 2), m.steel, { x: -w / 2 + 0.06 + i * ((w - 0.12) / 9), y: h - 0.015, z: 0.0 });
  }

  // ——— succulent in a terracotta pot ———
  {
    const clay = keep(new MeshStandardMaterial({ color: '#b3593a', roughness: 0.85 }));
    const o = k.at({ x: 3.1, y: TOP, z: 1.7 });
    o.add(lathe([[0, 0], [0.1, 0], [0.16, 0.2], [0.185, 0.24], [0.19, 0.275], [0.17, 0.28], [0.16, 0.255], [0.155, 0.23], [0, 0.23]], seg), clay);
    o.add(new CircleGeometry(0.155, seg).rotateX(-Math.PI / 2), m.ink, { y: 0.235 });
    const leafMat = keep(new MeshStandardMaterial({ color: '#7fa68a', roughness: 0.55, emissive: '#1e3a2a', emissiveIntensity: 0.15 }));
    const rings: [number, number, number, number][] = [[7, 0.15, 1.0, 0.12], [6, 0.11, 0.75, 0.16], [5, 0.075, 0.5, 0.2], [3, 0.03, 0.2, 0.26]];
    rings.forEach(([n, rad, tilt, y], ri) => {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + ri * 0.5;
        const len = 0.17 - ri * 0.025;
        o.add(new SphereGeometry(1, 8, 6).scale(0.045, 0.012, len / 1.6), leafMat, {
          x: Math.cos(a) * rad, y: 0.24 + y, z: Math.sin(a) * rad, ry: -a + Math.PI / 2, rx: -tilt,
        });
      }
    });
  }

  // ——— brass desk bell ———
  if (high) {
    const o = k.at({ x: -1.1, y: TOP, z: 1.78 });
    o.add(lathe([[0, 0.05], [0.12, 0.05], [0.15, 0.03], [0.17, 0.0], [0.168, 0.012], [0.15, 0.06], [0.1, 0.16], [0.06, 0.24], [0.03, 0.27], [0, 0.275]], seg), m.brass);
    o.add(new CylinderGeometry(0.02, 0.026, 0.1, 8), m.brassAged, { y: 0.31 });
    o.add(new SphereGeometry(0.032, 10, 8), m.brass, { y: 0.37 });
  }

  // ——— steam: five soft wisps that rise from the hot mug, a pure function of time ———
  const steamMap = keep(steamTexture());
  const wisps: { sprite: Sprite; mat: SpriteMaterial; phase: number; sway: number }[] = [];
  const n = high ? 5 : 3;
  for (let i = 0; i < n; i++) {
    const mat = keep(new SpriteMaterial({ map: steamMap, color: '#ffe9d2', transparent: true, depthWrite: false, blending: AdditiveBlending, opacity: 0 }));
    const sprite = new Sprite(mat);
    sprite.userData.glow = true;
    parent.add(sprite);
    wisps.push({ sprite, mat, phase: i / n, sway: 0.7 + i * 1.3 });
  }
  const MUG = new Vector3(-1.95, TOP + 0.38, 0.95);
  return {
    update(time: number): void {
      for (const w of wisps) {
        const t = (time * 0.13 + w.phase) % 1;
        w.sprite.position.set(
          MUG.x - 0.03 + Math.sin(time * 0.6 + w.sway) * 0.05 * (0.3 + t) + t * 0.04,
          MUG.y + 0.05 + t * 0.85,
          MUG.z + Math.cos(time * 0.5 + w.sway) * 0.04 * (0.3 + t),
        );
        const s = 0.16 + t * 0.34;
        w.sprite.scale.set(s, s * 1.7, 1);
        w.mat.opacity = Math.sin(Math.PI * t) ** 1.3 * 0.42;
        w.mat.rotation = Math.sin(time * 0.3 + w.sway) * 0.2;
      }
    },
  };
}
