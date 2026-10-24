import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Quaternion,
  RepeatWrapping,
  ShaderMaterial,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CITY_EXTENT, CROSS_STREET_X } from '../bake/cityGen.mjs';
import { glowTexture } from '../bake/CanvasTextures';
import { plazaMaps } from '../bake/RoomTextures';
import { mulberry32 } from '../util';
import type { Quality } from '../quality';

export interface Footprint {
  x: number;
  z: number;
  /** half extents on the ground, after the module's quarter turn */
  hx: number;
  hz: number;
}

/** the canyon road is 4.6 wide; a building face stands no nearer than 2.75 to its centre line */
export const ROAD_HALF = 2.3;
const FACE = 2.75;
export const CROSS_HALF = 1.3;

/**
 * The junctions' light cycle (14 s), shared by the signal heads and by the cars (StreetCars stops them at
 * the lines): the canyon has green 0-7, amber 7-8.2, red 8.2-14; the cross street runs opposite, with a
 * clearance gap each way. 0 green, 1 amber, 2 red.
 */
export const canyonPhase = (time: number): 0 | 1 | 2 => {
  const t = time % 14;
  return t < 7 ? 0 : t < 8.2 ? 1 : 2;
};
export const crossPhase = (time: number): 0 | 1 | 2 => {
  const t = time % 14;
  return t < 8.6 ? 2 : t < 12.6 ? 0 : t < 13.8 ? 1 : 2;
};

type Part = [BufferGeometry, string];

/** Merges coloured parts into one geometry with a `color` attribute (one draw call per prop kind). */
function prop(parts: Part[]): BufferGeometry {
  const geoms = parts.map(([g, hex]) => {
    const geo = g.index ? g.toNonIndexed() : g;
    const c = new Color(hex);
    const n = geo.attributes.position!.count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b; }
    geo.setAttribute('color', new Float32BufferAttribute(colors, 3));
    geo.deleteAttribute('uv');
    return geo;
  });
  const merged = mergeGeometries(geoms, false)!;
  geoms.forEach((g) => g.dispose());
  return merged;
}

const box = (w: number, h: number, d: number, x: number, y: number, z: number): BufferGeometry =>
  new BoxGeometry(w, h, d).translate(x, y, z);
const cyl = (r0: number, r1: number, h: number, x: number, y: number, z: number, seg = 8): BufferGeometry =>
  new CylinderGeometry(r0, r1, h, seg).translate(x, y, z);

/**
 * The night city's street level: paved plazas where a lot stands empty, street trees,
 * benches, planters, bollards, bins, hydrants, kiosks and bus shelters, curbs along the roads,
 * crosswalks and stop lines, working traffic signals at the cross streets, manhole covers with
 * rising steam. Everything is instanced (a dozen draw calls), seeded, and placed from the lots'
 * footprints, so it always sits in the gaps the buildings leave.
 */
export class CityStreet {
  readonly group = new Group();
  private steam: ShaderMaterial | null = null;
  private signalHeads: { x: number; z: number; face: 1 | -1 }[] = [];
  private signalGeometry = new BufferGeometry();
  private signalColor = new Float32Array(0);
  private disposables: { dispose(): void }[] = [];
  /** plaza rectangles (centre, size, side), exposed for the lights and the cars */
  readonly plazas: { x0: number; x1: number; z0: number; z1: number }[] = [];
  /**
   * Where the street trees stand. They are real trees from the homes set (branching trunks and
   * leaf cards, see City `buildTrees`), so this only decides where; `s` is a size factor.
   */
  readonly trees: { x: number; z: number; yaw: number; s: number }[] = [];

  constructor(footprints: Footprint[], quality: Quality) {
    const rand = mulberry32(8855);
    const own = <T extends { dispose(): void }>(x: T): T => { this.disposables.push(x); return x; };
    const high = quality.tier === 'high';
    const [ex0, ex1] = CITY_EXTENT.x;
    const x0 = ex0 - 6;
    const x1 = ex1 + 6;

    // ---- where the buildings leave a gap on each side of the canyon ------------------------
    // the free depth in front of the buildings, in quarter-unit bins along x: the nearest face of any
    // lot over that bin, less the pavement; runs deep enough become plazas
    interface Gap { x0: number; x1: number; depth: number; side: 1 | -1 }
    const gaps: Gap[] = [];
    const BIN = 0.25;
    const MAX_DEPTH = 3.6;
    const bins = Math.ceil((x1 - x0) / BIN);
    for (const side of [1, -1] as const) {
      const depth = new Float32Array(bins).fill(MAX_DEPTH);
      for (const f of footprints) {
        if (Math.sign(f.z) !== side) continue;
        const free = Math.max(0, Math.abs(f.z) - f.hz - FACE);
        const a = Math.max(0, Math.floor((f.x - f.hx - x0) / BIN));
        const b = Math.min(bins - 1, Math.ceil((f.x + f.hx - x0) / BIN));
        for (let i = a; i <= b; i++) depth[i] = Math.min(depth[i]!, free);
      }
      // the cross streets are not plazas
      for (const sx of CROSS_STREET_X) {
        const a = Math.max(0, Math.floor((sx - CROSS_HALF - 0.4 - x0) / BIN));
        const b = Math.min(bins - 1, Math.ceil((sx + CROSS_HALF + 0.4 - x0) / BIN));
        for (let i = a; i <= b; i++) depth[i] = 0;
      }
      let i = 0;
      while (i < bins) {
        if (depth[i]! < 1.0) { i++; continue; }
        let j = i;
        let low = MAX_DEPTH;
        while (j < bins && depth[j]! >= 1.0) { low = Math.min(low, depth[j]!); j++; }
        const len = (j - i) * BIN;
        if (len >= 2.0) gaps.push({ x0: x0 + i * BIN, x1: x0 + j * BIN, depth: low, side });
        i = j;
      }
    }

    // ---- ground: plazas ----------------------------------------------------------------------
    const plaza = plazaMaps(931);
    for (const t of [plaza.map, plaza.normalMap, plaza.roughnessMap]) { t.wrapS = t.wrapT = RepeatWrapping; }
    own(plaza.map); own(plaza.normalMap); own(plaza.roughnessMap);
    const plazaMaterial = own(new MeshStandardMaterial({
      map: plaza.map,
      ...(high ? { normalMap: plaza.normalMap, roughnessMap: plaza.roughnessMap, roughness: 1 } : { roughness: 0.6 }),
      color: '#8f8a80',
    }));
    // trees, benches and the rest are collected as placements, then instanced per kind
    const place: Record<string, { x: number; z: number; yaw: number; s: number; color?: string }[]> = {
      tree: [], bench: [], planter: [], bollard: [], bin: [], hydrant: [], kiosk: [], shelter: [], signal: [], manhole: [],
    };
    const add = (kind: string, x: number, z: number, yaw = 0, s = 1, color?: string): void => {
      place[kind]!.push({ x, z, yaw, s, ...(color ? { color } : {}) });
    };

    for (const g of gaps) {
      const w = g.x1 - g.x0 - 0.3;
      if (g.depth < 0.5) {
        // an alley mouth: a bin, a hydrant
        add('bin', (g.x0 + g.x1) / 2, g.side * (FACE + 0.15), 0, 1);
        continue;
      }
      const depth = Math.min(g.depth, 3.6);
      const cx = (g.x0 + g.x1) / 2;
      const zc = g.side * (FACE + depth / 2 - 0.05);
      const slab = new Mesh(own(new PlaneGeometry(w, depth)), plazaMaterial);
      slab.rotation.x = -Math.PI / 2;
      slab.position.set(cx, 0.012, zc);
      // the paver pattern keeps a constant size however big the plaza is
      slab.geometry.attributes.uv!.array.forEach((_v, i, a) => { (a as Float32Array)[i] = (a as Float32Array)[i]! * (i % 2 ? depth / 2 : w / 2); });
      this.group.add(slab);
      this.plazas.push({ x0: g.x0, x1: g.x1, z0: Math.min(g.side * FACE, g.side * (FACE + depth)), z1: Math.max(g.side * FACE, g.side * (FACE + depth)) });

      // trees in a row down the middle of the plaza, planters under the first and last
      const nTrees = Math.max(1, Math.floor(w / 2.1));
      for (let i = 0; i < nTrees; i++) {
        const x = g.x0 + 0.15 + ((i + 0.5) / nTrees) * w + (rand() - 0.5) * 0.25;
        add('tree', x, g.side * (FACE + depth * (0.5 + (rand() - 0.5) * 0.15)), rand() * 6.28, 0.85 + rand() * 0.5);
      }
      // benches face the road, a pair per ~4 units
      const nBench = Math.max(1, Math.floor(w / 3.4));
      for (let i = 0; i < nBench; i++) {
        const x = g.x0 + 0.15 + ((i + 0.5) / nBench) * w + 0.5;
        add('bench', x, g.side * (FACE + 0.38), g.side > 0 ? Math.PI : 0, 1);
        if (rand() < 0.5) add('planter', x - 0.9, g.side * (FACE + 0.28), 0, 1);
      }
      // bollards along the road edge of the plaza
      for (let x = g.x0 + 0.3; x < g.x1 - 0.2; x += 0.9) add('bollard', x, g.side * (ROAD_HALF + 0.12), 0, 1);
      // a kiosk or a bus shelter on a deep plaza
      if (depth > 1.6 && w > 3.2) {
        if (rand() < 0.5) add('kiosk', g.x1 - 0.7, g.side * (FACE + depth * 0.62), g.side > 0 ? Math.PI : 0, 1);
        else add('shelter', g.x0 + 1.0, g.side * (FACE + 0.6), g.side > 0 ? Math.PI : 0, 1);
      }
      if (rand() < 0.7) add('bin', g.x0 + 0.35, g.side * (FACE + 0.3), 0, 1);
    }
    // hydrants and bins along the curbs, wherever there is room
    for (let x = x0 + 4; x < x1 - 4; x += 9 + rand() * 4) {
      if (CROSS_STREET_X.some((sx) => Math.abs(x - sx) < 3)) continue;
      add('hydrant', x, (rand() < 0.5 ? 1 : -1) * (ROAD_HALF + 0.18), 0, 1);
    }

    // ---- prop geometry -----------------------------------------------------------------------
    this.trees.push(...place.tree!);
    // a grate of iron in the paving at the foot of every street tree
    place.grate = place.tree!.map((t) => ({ x: t.x, z: t.z, yaw: 0, s: 1 }));
    const kinds: Record<string, BufferGeometry> = {
      grate: prop([
        [box(0.62, 0.012, 0.62, 0, 0.012, 0), '#2a2c30'],
        [box(0.5, 0.016, 0.5, 0, 0.014, 0), '#1b1c20'],
        [box(0.16, 0.02, 0.16, 0, 0.016, 0), '#3a3026'],
      ]),
      bench: prop([
        [box(0.6, 0.025, 0.17, 0, 0.17, 0), '#74502f'],
        [box(0.6, 0.15, 0.02, 0, 0.3, 0.085), '#74502f'],
        [box(0.03, 0.17, 0.17, -0.27, 0.085, 0), '#22262e'],
        [box(0.03, 0.17, 0.17, 0.27, 0.085, 0), '#22262e'],
      ]),
      planter: prop([
        [box(0.5, 0.14, 0.2, 0, 0.07, 0), '#4a4640'],
        [new IcosahedronGeometry(0.15, 1).scale(1.5, 0.8, 0.8).translate(0, 0.2, 0), '#356b3c'],
        [new IcosahedronGeometry(0.07, 0).translate(0.1, 0.27, 0.02), '#e6a23c'],
        [new IcosahedronGeometry(0.06, 0).translate(-0.12, 0.26, -0.03), '#d9566c'],
      ]),
      bollard: prop([[cyl(0.028, 0.032, 0.18, 0, 0.09, 0, 8), '#3a3f48'], [cyl(0.03, 0.03, 0.02, 0, 0.17, 0, 8), '#e9b44c']]),
      bin: prop([[cyl(0.06, 0.05, 0.17, 0, 0.085, 0, 10), '#24402f'], [cyl(0.065, 0.065, 0.015, 0, 0.18, 0, 10), '#1a1d24']]),
      hydrant: prop([
        [cyl(0.035, 0.04, 0.12, 0, 0.06, 0, 8), '#a5281f'],
        [cyl(0.04, 0.035, 0.02, 0, 0.13, 0, 8), '#a5281f'],
        [cyl(0.015, 0.015, 0.1, 0, 0.09, 0, 6).rotateZ(Math.PI / 2), '#8f2019'],
      ]),
      kiosk: prop([
        [box(0.7, 0.5, 0.45, 0, 0.25, 0), '#38404f'],
        [box(0.8, 0.04, 0.55, 0, 0.52, 0), '#1c2029'],
        [box(0.5, 0.2, 0.01, 0, 0.3, 0.226), '#ffd28a'],
        [box(0.16, 0.2, 0.012, -0.3, 0.3, -0.226), '#9fd8ff'],
      ]),
      shelter: prop([
        [box(1.1, 0.03, 0.4, 0, 0.62, 0), '#2a303c'],
        [box(0.03, 0.62, 0.03, -0.52, 0.31, -0.17), '#2a303c'],
        [box(0.03, 0.62, 0.03, 0.52, 0.31, -0.17), '#2a303c'],
        [box(1.04, 0.5, 0.02, 0, 0.32, -0.19), '#4f7fa8'],
        [box(0.6, 0.016, 0.16, 0.0, 0.2, -0.05), '#5a4430'],
        [box(0.4, 0.22, 0.012, 0.3, 0.38, -0.17), '#ff7ab8'],
      ]),
      signal: prop([
        [cyl(0.015, 0.02, 1.15, 0, 0.575, 0, 6), '#2a303c'],
        [box(0.5, 0.012, 0.012, 0.25, 1.1, 0), '#2a303c'],
        [box(0.07, 0.2, 0.07, 0.5, 1.02, 0), '#15171c'],
      ]),
      manhole: prop([[cyl(0.13, 0.13, 0.01, 0, 0.012, 0, 16), '#1a1c22'], [cyl(0.1, 0.1, 0.012, 0, 0.014, 0, 16), '#2c2f38']]),
    };
    const material = own(new MeshStandardMaterial({ vertexColors: true, roughness: 0.65, metalness: 0.25 }));
    const m4 = new Matrix4();
    const q = new Quaternion();
    const Y = new Vector3(0, 1, 0);
    const p = new Vector3();
    const sc = new Vector3();
    for (const [kind, list] of Object.entries(place)) {
      if (!list.length || !kinds[kind]) continue;
      const mesh = new InstancedMesh(own(kinds[kind]!), material, list.length);
      list.forEach((it, i) => {
        q.setFromAxisAngle(Y, it.yaw);
        mesh.setMatrixAt(i, m4.compose(p.set(it.x, 0, it.z), q, sc.set(it.s, it.s, it.s)));
      });
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      this.group.add(mesh);
      own(mesh);
    }

    // ---- curbs along the roads ---------------------------------------------------------------
    const curbMaterial = own(new MeshStandardMaterial({ color: '#4c4f58', roughness: 0.7 }));
    const unit = own(new BoxGeometry(1, 1, 1));
    const curbList: { x: number; z: number; sx: number; sz: number }[] = [];
    const xs = [x0, ...CROSS_STREET_X.flatMap((sx) => [sx - CROSS_HALF, sx + CROSS_HALF]), x1].sort((a, b) => a - b);
    for (let i = 0; i < xs.length; i += 2) {
      const a = xs[i]!;
      const b = xs[i + 1]!;
      for (const side of [1, -1]) curbList.push({ x: (a + b) / 2, z: side * ROAD_HALF, sx: b - a, sz: 0.11 });
    }
    for (const sx of CROSS_STREET_X) {
      const zEnd = CITY_EXTENT.z[1] + 3;
      for (const side of [1, -1]) {
        for (const e of [-1, 1]) {
          const len = zEnd - ROAD_HALF;
          curbList.push({ x: sx + e * CROSS_HALF, z: side * (ROAD_HALF + len / 2), sx: 0.11, sz: len });
        }
      }
    }
    const curbMesh = new InstancedMesh(unit, curbMaterial, curbList.length);
    curbList.forEach((c, i) => {
      curbMesh.setMatrixAt(i, m4.compose(p.set(c.x, 0.025, c.z), q.identity(), sc.set(c.sx, 0.05, c.sz)));
    });
    curbMesh.frustumCulled = false;
    this.group.add(curbMesh);
    own(curbMesh);

    // ---- crosswalks and stop lines ------------------------------------------------------------
    const paintMaterial = own(new MeshBasicMaterial({ color: '#8d897c' }));
    const bars: { x: number; z: number; sx: number; sz: number }[] = [];
    for (const sx of CROSS_STREET_X) {
      for (const e of [-1, 1]) {
        // the zebra across the canyon road, on either side of the intersection
        for (let z = -ROAD_HALF + 0.25; z <= ROAD_HALF - 0.2; z += 0.26) {
          bars.push({ x: sx + e * (CROSS_HALF + 0.55), z, sx: 0.5, sz: 0.11 });
        }
        // and the stop line before it
        bars.push({ x: sx + e * (CROSS_HALF + 1.05), z: e * -0.55, sx: 0.07, sz: 1.05 });
        // and the cross street's own stop line, across the lane that approaches from this side
        bars.push({ x: sx + e * 0.6, z: e * (ROAD_HALF + 0.55), sx: 1.0, sz: 0.07 });
      }
    }
    const barMesh = new InstancedMesh(unit, paintMaterial, bars.length);
    bars.forEach((b, i) => {
      barMesh.setMatrixAt(i, m4.compose(p.set(b.x, 0.016, b.z), q.identity(), sc.set(b.sx, 0.004, b.sz)));
    });
    barMesh.frustumCulled = false;
    this.group.add(barMesh);
    own(barMesh);

    // ---- traffic signals at the cross streets --------------------------------------------------
    // two poles per intersection on opposite corners, their heads facing along the canyon; each head
    // shows one lamp (green, amber or red) from a shared cycle in `update`
    const sigPlace: { x: number; z: number; yaw: number }[] = [];
    for (const sx of CROSS_STREET_X) {
      sigPlace.push({ x: sx - CROSS_HALF - 0.5, z: -(ROAD_HALF + 0.12), yaw: 0 });
      sigPlace.push({ x: sx + CROSS_HALF + 0.5, z: ROAD_HALF + 0.12, yaw: Math.PI });
    }
    const sigMesh = new InstancedMesh(own(kinds.signal!.clone()), material, sigPlace.length);
    sigPlace.forEach((s, i) => {
      q.setFromAxisAngle(Y, s.yaw);
      sigMesh.setMatrixAt(i, m4.compose(p.set(s.x, 0, s.z), q, sc.set(1, 1, 1)));
      // the head hangs 0.5 out along the arm, rotated with the pole
      const hx = s.x + Math.cos(s.yaw) * 0.5;
      const hz = s.z - Math.sin(s.yaw) * 0.5;
      this.signalHeads.push({ x: hx, z: hz, face: Math.cos(s.yaw) > 0 ? 1 : -1 });
    });
    sigMesh.frustumCulled = false;
    this.group.add(sigMesh);
    own(sigMesh);
    this.signalColor = new Float32Array(this.signalHeads.length * 3);
    const sigPos = new Float32Array(this.signalHeads.length * 3);
    this.signalGeometry.setAttribute('position', new Float32BufferAttribute(sigPos, 3));
    this.signalGeometry.setAttribute('color', new Float32BufferAttribute(this.signalColor, 3));
    const signals = new Points(this.signalGeometry, new PointsMaterial({
      map: own(glowTexture()), size: 0.26, vertexColors: true, transparent: true, depthWrite: false,
      blending: AdditiveBlending, sizeAttenuation: true,
    }));
    signals.frustumCulled = false;
    this.group.add(signals);
    own(this.signalGeometry); own(signals.material as PointsMaterial);

    // ---- manholes with steam -----------------------------------------------------------------------
    const vents: { x: number; z: number }[] = [];
    for (let x = x0 + 8; x < x1 - 8; x += 13 + rand() * 9) {
      if (CROSS_STREET_X.some((sx) => Math.abs(x - sx) < 3.2)) continue;
      vents.push({ x, z: (rand() < 0.5 ? -1 : 1) * (0.2 + rand() * 0.5) });
    }
    const holes = new InstancedMesh(own(kinds.manhole!.clone()), material, vents.length);
    vents.forEach((v, i) => holes.setMatrixAt(i, m4.compose(p.set(v.x, 0, v.z), q.identity(), sc.set(1, 1, 1))));
    holes.frustumCulled = false;
    this.group.add(holes);
    own(holes);
    const PUFFS = high ? 16 : 8;
    const steamPos = new Float32Array(vents.length * PUFFS * 3);
    const steamPhase = new Float32Array(vents.length * PUFFS);
    vents.forEach((v, i) => {
      for (let k = 0; k < PUFFS; k++) {
        const n = i * PUFFS + k;
        steamPos[n * 3] = v.x;
        steamPos[n * 3 + 1] = 0.02;
        steamPos[n * 3 + 2] = v.z;
        steamPhase[n] = (k + rand() * 0.8) / PUFFS;
      }
    });
    const steamGeometry = own(new BufferGeometry());
    steamGeometry.setAttribute('position', new Float32BufferAttribute(steamPos, 3));
    steamGeometry.setAttribute('aPhase', new Float32BufferAttribute(steamPhase, 1));
    this.steam = own(new ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uMap: { value: own(glowTexture()) } },
      vertexShader: /* glsl */ `
        attribute float aPhase;
        uniform float uTime;
        varying float vAge;
        void main() {
          float age = fract(aPhase + uTime * 0.085);
          vAge = age;
          vec3 p = position;
          // rises, leans with a slow breeze, and curls
          p.y += age * 1.5;
          p.x += age * age * 0.5 + sin(age * 6.0 + aPhase * 40.0) * 0.05 * age;
          p.z += sin(age * 5.0 + aPhase * 17.0) * 0.07 * age;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = (14.0 + age * 74.0) * (260.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        varying float vAge;
        void main() {
          float a = texture2D(uMap, gl_PointCoord).r * (1.0 - vAge) * smoothstep(0.0, 0.08, vAge) * 0.2;
          gl_FragColor = vec4(vec3(0.78, 0.72, 0.8) * a, a);
        }`,
      transparent: true, depthWrite: false, blending: AdditiveBlending,
    }));
    const steam = new Points(steamGeometry, this.steam);
    steam.frustumCulled = false;
    this.group.add(steam);

    // lit windows on the kiosks and shelters, and a glow where the plazas are
    // plaza lamps are the streetlights already along the road; a faint warm pool sells the paving
    const poolMaterial = own(new MeshBasicMaterial({
      map: own(glowTexture()), color: '#ffb468', transparent: true, opacity: 0.12, blending: AdditiveBlending,
      depthWrite: false, toneMapped: false,
    }));
    for (const pz of this.plazas) {
      const pool = new Mesh(own(new PlaneGeometry(pz.x1 - pz.x0 + 1.5, pz.z1 - pz.z0 + 1.5)), poolMaterial);
      pool.rotation.x = -Math.PI / 2;
      pool.position.set((pz.x0 + pz.x1) / 2, 0.02, (pz.z0 + pz.z1) / 2);
      this.group.add(pool);
    }
  }

  /** Signals cycle and steam rises; `time` in seconds. */
  update(time: number): void {
    if (this.steam) this.steam.uniforms.uTime!.value = time;
    const phase = canyonPhase(time);
    const pos = this.signalGeometry.attributes.position as Float32BufferAttribute;
    const col = this.signalGeometry.attributes.color as Float32BufferAttribute;
    this.signalHeads.forEach((h, i) => {
      // the two corners of a pair run the same phase; heads sit at the top (red), middle (amber), bottom (green)
      const y = phase === 2 ? 1.1 : phase === 1 ? 1.02 : 0.94;
      pos.setXYZ(i, h.x, y, h.z);
      if (phase === 0) col.setXYZ(i, 0.2, 1.0, 0.45);
      else if (phase === 1) col.setXYZ(i, 1.0, 0.7, 0.15);
      else col.setXYZ(i, 1.0, 0.18, 0.15);
    });
    pos.needsUpdate = true;
    col.needsUpdate = true;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
