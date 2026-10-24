import { BufferAttribute, Color, Vector3 } from 'three';
import type { BufferGeometry, MeshStandardMaterial, WebGLProgramParametersWithUniforms } from 'three';

/**
 * Roofs that read from above. Every house type is one Blender module instanced across the town, so
 * the baked atlas can only give twelve roofs; seen from the plane at 15 to 60 units they were a
 * board of near-identical dark shingle. This turns each lot's roof into its own:
 *
 * - a roofing STYLE and colour per lot (asphalt shingle in nine blends, clay barrel tile, slate,
 *   standing-seam metal, cedar shake), drawn over the baked course pattern so the bake's relief and
 *   occlusion stay (`detail`: the texel read against the module's own roofing colour);
 * - its own procedural courses, barrels, seams or shakes in metres on the roof plane, with a bump
 *   that low sun rakes, faded out by screen-space frequency so nothing shimmers;
 * - weathering: algae streaks and moss/lichen on the shaded slopes of the older roofs, sun-bleach on
 *   the bright ones, macro mottling, ridge caps and drip edges that read;
 * - features: solar arrays (dark glass in silver or black frames, near-mirror so they glint and
 *   carry the sky) on the sunward slope of about one house in four, skylights, ridge vents, and rows
 *   of panels on some flat roofs.
 *
 * `roofAttributes` finds each module's roof planes once at load (up-facing faces above the ground
 * floor that sample a roof slot, not the flat-colour palette strip), and gives every vertex its
 * position on its plane in plane units, the plane's size and its kind. The hero tier's stepped
 * shingle courses fold onto the roof plane under them, so a close-up roof is the same roof.
 */

/** site units per metre (blender/bld/homes.py SCALE) */
const SCALE = 0.33;
/** the bottom strip of every homes atlas holds flat material colours (blender/bld/atlas.py) */
const PALETTE_V = 0.965;

const K_PITCHED = 1;
const K_FLAT = 2;
const K_PALETTE = 3;

interface Face { a: number; b: number; c: number; n: Vector3; d: number; centre: Vector3; area: number }
interface Plane { n: Vector3; d: number; faces: Face[]; area: number; centre: Vector3 }

/**
 * Tags a house module's roof: `aRoof` = (u from the plane's safe left edge, v up the slope from the
 * eave, safe width, slope length) in site units, `aRoofK` = kind + 4 * index of the module's roofing
 * colour in the material's table. The safe width is the span of the plane's top edge: the whole
 * width on a gable slope, the ridge on a hip trapezoid, nothing on a hip's triangle end.
 */
export function roofAttributes(geometry: BufferGeometry, baseIndex: number): void {
  const pos = geometry.attributes.position!;
  const uv = geometry.attributes.uv;
  const nrm = geometry.attributes.normal;
  const index = geometry.index;
  const count = pos.count;
  const tris = (index ? index.count : count) / 3;
  const vid = (t: number, k: number): number => (index ? index.getX(t * 3 + k) : t * 3 + k);
  let minY = Infinity;
  for (let i = 0; i < count; i++) minY = Math.min(minY, pos.getY(i));

  const roof = new Float32Array(count * 4);
  const kind = new Float32Array(count).fill(baseIndex * 4);
  const pa = new Vector3(), pb = new Vector3(), pc = new Vector3(), e1 = new Vector3(), e2 = new Vector3();
  const vn = new Vector3();
  const pitched: Face[] = [];
  // the ground floor's porch decks, steps and sills face up too: a roof starts above two metres
  const floor = 2.0 * SCALE;
  for (let t = 0; t < tris; t++) {
    const a = vid(t, 0), b = vid(t, 1), c = vid(t, 2);
    pa.fromBufferAttribute(pos, a);
    pb.fromBufferAttribute(pos, b);
    pc.fromBufferAttribute(pos, c);
    const n = new Vector3().crossVectors(e1.subVectors(pb, pa), e2.subVectors(pc, pa));
    const area = n.length() / 2;
    if (area < 1e-7) continue;
    n.normalize();
    if (nrm && n.dot(vn.fromBufferAttribute(nrm, a)) < 0) n.negate();
    if (n.y < 0.25) continue;
    const centre = new Vector3().add(pa).add(pb).add(pc).divideScalar(3);
    if (centre.y - minY < floor) continue;
    const palette = !!uv && uv.getY(a) > PALETTE_V && uv.getY(b) > PALETTE_V && uv.getY(c) > PALETTE_V;
    if (palette) {
      // the close-up tier's ridge boards and caps are flat-colour faces: the shader keeps only the
      // ones in the roofing colour (chimney caps, vents and sills are other materials)
      if (n.y > 0.9) for (const v of [a, b, c]) kind[v] = baseIndex * 4 + K_PALETTE;
      continue;
    }
    pitched.push({ a, b, c, n, d: n.dot(pa), centre, area });
  }

  // planes: faces with one normal and one offset; then the close-up tier's course treads (tilted
  // ~10 degrees and a few centimetres proud) fold onto the big plane they lie on
  const groups = new Map<string, Plane>();
  for (const f of pitched) {
    const key = `${Math.round(f.n.x * 60)},${Math.round(f.n.y * 60)},${Math.round(f.n.z * 60)},${Math.round(f.d / 0.02)}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { n: f.n.clone(), d: f.d, faces: [], area: 0, centre: new Vector3() }));
    g.faces.push(f);
    g.area += f.area;
    g.centre.addScaledVector(f.centre, f.area);
  }
  const planes = [...groups.values()].sort((x, y) => y.area - x.area);
  for (const g of planes) g.centre.divideScalar(g.area);
  const basis = (n: Vector3): [Vector3, Vector3] => {
    const t = Math.abs(n.y) > 0.995 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0).cross(n).normalize();
    return [t, new Vector3().crossVectors(n, t)];
  };
  const bounds = (g: Plane, t: Vector3, b: Vector3): number[] => {
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const f of g.faces) {
      for (const v of [f.a, f.b, f.c]) {
        pa.fromBufferAttribute(pos, v);
        const u = pa.dot(t), w = pa.dot(b);
        u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, w); v1 = Math.max(v1, w);
      }
    }
    return [u0, u1, v0, v1];
  };
  const kept: { g: Plane; t: Vector3; b: Vector3; box: number[] }[] = [];
  for (const g of planes) {
    let home: (typeof kept)[number] | null = null;
    for (const k of kept) {
      if (k.g.n.dot(g.n) < 0.96) continue;
      if (Math.abs(k.g.n.dot(g.centre) - k.g.d) > 0.06) continue;
      const u = g.centre.dot(k.t), w = g.centre.dot(k.b);
      if (u < k.box[0]! - 0.05 || u > k.box[1]! + 0.05 || w < k.box[2]! - 0.05 || w > k.box[3]! + 0.05) continue;
      home = k;
      break;
    }
    if (home) {
      home.g.faces.push(...g.faces);
      continue;
    }
    const [t, b] = basis(g.n);
    kept.push({ g, t, b, box: bounds(g, t, b) });
  }
  for (const { g, t, b } of kept) {
    const [, , v0, v1] = bounds(g, t, b);
    const flat = g.n.y > 0.995;
    // the safe span: where the plane's top edge runs (a hip's ridge, a gable's whole width)
    let s0 = Infinity, s1 = -Infinity;
    for (const f of g.faces) {
      for (const v of [f.a, f.b, f.c]) {
        pa.fromBufferAttribute(pos, v);
        if (flat || pa.dot(b) > v1! - 0.03) {
          const u = pa.dot(t);
          s0 = Math.min(s0, u); s1 = Math.max(s1, u);
        }
      }
    }
    if (!(s1 > s0)) { s0 = 0; s1 = 0; }
    for (const f of g.faces) {
      for (const v of [f.a, f.b, f.c]) {
        pa.fromBufferAttribute(pos, v);
        roof[v * 4] = pa.dot(t) - s0;
        roof[v * 4 + 1] = pa.dot(b) - v0!;
        roof[v * 4 + 2] = s1 - s0;
        roof[v * 4 + 3] = v1! - v0!;
        kind[v] = baseIndex * 4 + (flat ? K_FLAT : K_PITCHED);
      }
    }
  }
  geometry.setAttribute('aRoof', new BufferAttribute(roof, 4));
  geometry.setAttribute('aRoofK', new BufferAttribute(kind, 1));
}

// ---- styles ---------------------------------------------------------------------------------

/** roofing families, their share of the town, and the colours each comes in (sRGB) */
const STYLES: { weight: number; colors: string[] }[] = [
  // 0 asphalt shingle: charcoal, weathered wood, driftwood, autumn brown, colonial slate, brick red,
  // hunter green, harbour blue, desert tan
  { weight: 0.38, colors: ['#3e4045', '#5d554d', '#7a766c', '#6e4636', '#4f5966', '#82392b', '#45604c', '#3f5470', '#8c7c62'] },
  // 1 clay barrel tile
  { weight: 0.17, colors: ['#b8593a', '#c8744a', '#a04530', '#cf9160', '#ae5e45'] },
  // 2 slate
  { weight: 0.11, colors: ['#4c5666', '#5a5462', '#4f5e5b', '#434a55'] },
  // 3 standing-seam metal: forest, barn red, charcoal, galvalume, navy, copper patina, bronze
  { weight: 0.2, colors: ['#2f5e47', '#93322a', '#383c42', '#a3abb0', '#2f4568', '#5f9988', '#6e5139'] },
  // 4 cedar shake
  { weight: 0.14, colors: ['#9a6a42', '#8d806e', '#7e6850', '#a88058'] },
];

function glslColors(): string {
  const c = new Color();
  const lines: string[] = [];
  STYLES.forEach((s, i) => {
    const list = s.colors.map((hex) => {
      c.set(hex);
      return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;
    });
    lines.push(`const vec3 RPAL${i}[${list.length}] = vec3[${list.length}](${list.join(', ')});`);
  });
  let acc = 0;
  const total = STYLES.reduce((a, s) => a + s.weight, 0);
  const cuts = STYLES.map((s) => (acc += s.weight / total));
  lines.push(`const vec4 RCUT = vec4(${cuts.slice(0, 4).map((v) => v.toFixed(4)).join(', ')});`);
  lines.push(`vec3 roofPalette(int style, float h) {
    if (style == 0) return RPAL0[int(h * ${STYLES[0]!.colors.length}.0) % ${STYLES[0]!.colors.length}];
    if (style == 1) return RPAL1[int(h * ${STYLES[1]!.colors.length}.0) % ${STYLES[1]!.colors.length}];
    if (style == 2) return RPAL2[int(h * ${STYLES[2]!.colors.length}.0) % ${STYLES[2]!.colors.length}];
    if (style == 3) return RPAL3[int(h * ${STYLES[3]!.colors.length}.0) % ${STYLES[3]!.colors.length}];
    return RPAL4[int(h * ${STYLES[4]!.colors.length}.0) % ${STYLES[4]!.colors.length}];
  }`);
  return lines.join('\n');
}

const VERT_PARS = /* glsl */ `
attribute vec4 aRoof;
attribute float aRoofK;
varying vec4 vRoof;
varying vec3 vRoofL;
varying vec3 vRoofWN;
varying vec3 vRoofP;
`;

const VERT_MAIN = /* glsl */ `
  vRoof = aRoof;
  vRoofP = transformed;
  {
    // few varyings: this rides on an instanced standard material that already carries many
    #ifdef USE_INSTANCING
      vRoofL = vec3(instanceMatrix[3].xz, aRoofK);
      mat3 iR = mat3(instanceMatrix);
    #else
      vRoofL = vec3(0.0, 0.0, aRoofK);
      mat3 iR = mat3(1.0);
    #endif
    vRoofWN = normalize(mat3(modelMatrix) * (iR * normalize(objectNormal)));
  }
`;

const FRAG_PARS = (fine: boolean): string => /* glsl */ `
${fine ? '#define ROOF_FINE' : ''}
uniform vec3 uRoofBase[16];
varying vec4 vRoof;
varying vec3 vRoofL;
varying vec3 vRoofWN;
varying vec3 vRoofP;
${glslColors()}
// the town's late sun comes from +x, a little +z: solar faces it, moss hides from it
const vec2 ROOF_SUN = vec2(0.875, 0.484);
float rHash(vec2 p) { p = fract(p * vec2(127.13, 311.71)); p += dot(p, p + 34.53); return fract(p.x * p.y); }
float rNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(rHash(i), rHash(i + vec2(1.0, 0.0)), f.x), mix(rHash(i + vec2(0.0, 1.0)), rHash(i + 1.0), f.x), f.y);
}
float rFbm(vec2 p) { return rNoise(p) * 0.6 + rNoise(p * 2.13 + 7.1) * 0.28 + rNoise(p * 4.7 + 3.3) * 0.12; }
/** 1 where a pattern of this period is resolved on screen, 0 where it would alias */
float rVis(float period, float fw) { return 1.0 - smoothstep(0.22, 0.5, fw / period); }
/** soft-edged line at the start of each period, width w (all in metres) */
float rLine(float x, float period, float w, float fw) {
  float d = abs(fract(x / period + 0.5) - 0.5) * period;
  return 1.0 - smoothstep(w * 0.5, w * 0.5 + fw, d);
}
float rLum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
// what the roof shader decided for this fragment, read again after the lighting inputs are set up
float roofOn = 0.0;
vec3 roofAlbedo = vec3(0.0);
float roofRough = 1.0;
float roofMetal = 0.0;
vec2 roofGrad = vec2(0.0);
float roofFlatten = 0.0;
vec2 wallGrad = vec2(0.0);
`;

const FRAG_COLOR = /* glsl */ `
{
  float rk = floor(vRoofL.z + 0.5);
  float kind = mod(rk, 4.0);
  int baseI = int(rk / 4.0);
  vec3 base = uRoofBase[baseI];
  vec3 texel = sampledDiffuseColor.rgb;
  bool isRoof = kind > 0.5 && kind < 2.5;
  if (kind > 2.5) {
    // a flat-colour ridge board or cap: only the ones in the module's roofing colour are roof
    vec3 dd = abs(texel - base);
    isRoof = dd.r + dd.g + dd.b < 0.03;
  }
  if (isRoof) {
    roofOn = 1.0;
    vec2 lot = floor(vRoofL.xy * 4.0 + 0.5) * 0.25;
    float h0 = rHash(lot + 0.37), h1 = rHash(lot + 3.71), h2 = rHash(lot + 9.13), h3 = rHash(lot + 17.9);
    float h4 = rHash(lot + 23.3), h5 = rHash(lot + 31.7);
    bool flatRoof = kind > 1.5 && kind < 2.5;
    int style = h0 < RCUT.x ? 0 : h0 < RCUT.y ? 1 : h0 < RCUT.z ? 2 : h0 < RCUT.w ? 3 : 4;
    vec3 col = roofPalette(style, h1);
    // the baked course relief and occlusion, read against the module's own roofing colour
    float detail = clamp(rLum(texel) / max(rLum(base) * 0.82, 1e-4), 0.3, 1.7);
    float detailK = style == 0 ? 1.0 : style == 4 ? 0.75 : style == 2 ? 0.55 : style == 1 ? 0.4 : 0.18;
    // metres on the plane (a lot's module is fitted within a few percent of its own size)
    vec2 m = vRoof.xy / ${SCALE.toFixed(2)};
    float W = vRoof.z / ${SCALE.toFixed(2)}, H = vRoof.w / ${SCALE.toFixed(2)};
    float fw = max(fwidth(m.x), fwidth(m.y));
    vec3 wn = normalize(vRoofWN);
    float sunward = length(wn.xz) > 0.05 ? dot(normalize(wn.xz), ROOF_SUN) : 0.0;
    float rough = 0.9, metal = 0.0;
    float shade = 1.0;
    vec2 grad = vec2(0.0);
    float age = h2;
    float mossK = style == 4 ? 1.3 : style == 0 ? 1.0 : style == 1 ? 0.7 : style == 2 ? 0.6 : 0.0;

    if (flatRoof) {
      // flat roofs keep their baked membrane, vents and units; the town varies them in tone
      col = texel * mix(vec3(1.0), vec3(1.12, 1.08, 1.0), h1) * (0.82 + 0.36 * h3);
      detailK = 0.0;
      mossK = 0.4;
      rough = 0.85;
    } else {
      #ifdef ROOF_FINE
      if (style == 0) {
        // architectural shingle: tabs of 34 x 14 cm, half-staggered, each its own blend of granules
        float row = floor(m.y / 0.142);
        vec2 cell = vec2(floor(m.x / 0.34 + 0.5 * mod(row, 2.0) + rHash(vec2(row, h1)) * 0.3), row);
        float t = rHash(cell + lot);
        shade *= mix(1.0, 0.84 + 0.3 * t, rVis(0.34, fw));
      } else if (style == 1) {
        // barrel tile: round-backed tiles 24 cm across, courses of 32 cm, every tile its own fire
        float s = fract(m.x / 0.24);
        float vis = rVis(0.24, fw);
        float cr = rVis(0.32, fw);
        float course = fract(m.y / 0.32);
        float barrel = sin(3.14159 * s);
        shade *= mix(1.0, 0.62 + 0.45 * sqrt(max(barrel, 0.0)), vis);
        shade *= mix(1.0, 0.72 + 0.28 * smoothstep(0.0, 0.16, course), cr);
        grad.x += cos(3.14159 * s) * 3.14159 / 0.24 * 0.045 * vis;
        grad.y -= (1.0 - smoothstep(0.0, 0.12, course)) * 0.5 * cr;
        float t = rHash(floor(vec2(m.x / 0.24, m.y / 0.32)) + lot);
        col = mix(col, roofPalette(1, t), 0.35 * vis) * (0.86 + 0.26 * rHash(floor(vec2(m.x / 0.24, m.y / 0.32)) + 5.1));
      } else if (style == 2) {
        // slate: 30 x 18 cm, staggered, cool tones that shift slate to slate
        float row = floor(m.y / 0.18);
        float u = m.x / 0.3 + 0.5 * mod(row, 2.0);
        vec2 cell = vec2(floor(u), row);
        float vis = rVis(0.18, fw);
        float t = rHash(cell + lot);
        col = mix(col, col * vec3(0.92 + 0.16 * t, 0.95, 1.0 + 0.12 * (1.0 - t)), vis);
        shade *= mix(1.0, (0.82 + 0.28 * t) * (1.0 - 0.35 * rLine(m.y, 0.18, 0.02, fw)) * (1.0 - 0.3 * rLine(u * 0.3, 0.3, 0.012, fw)), vis);
        grad.y -= (1.0 - smoothstep(0.0, 0.1, fract(m.y / 0.18))) * 0.35 * vis;
      } else if (style == 3) {
        // standing seam: panels 45 cm wide, a seam standing 4 cm proud between them
        float vis = rVis(0.45, fw);
        float x = fract(m.x / 0.45 + 0.5) - 0.5;
        float seam = 1.0 - smoothstep(0.012, 0.012 + fw, abs(x * 0.45));
        float side = (1.0 - smoothstep(0.0, 0.05 + fw, abs(x * 0.45) - 0.012)) * (1.0 - seam);
        shade *= mix(1.0, (1.0 + 0.35 * seam) * (1.0 - 0.18 * side) * (0.95 + 0.1 * rHash(vec2(floor(m.x / 0.45 + 0.5), h1))), vis);
        grad.x += sign(x) * side * 0.6 * vis;
        // oil-canning: a slow ripple in each pan
        shade *= 0.97 + 0.05 * rNoise(vec2(m.x * 2.2, m.y * 0.7) + lot);
      } else {
        // cedar shake: random widths in 25 cm courses, each split shake its own weathering
        float row = floor(m.y / 0.25);
        float u = m.x / 0.2 + rHash(vec2(row, 3.0) + lot) * 3.0;
        float k = floor(u + rNoise(vec2(u * 0.7, row)) * 0.8);
        float vis = rVis(0.2, fw);
        float t = rHash(vec2(k, row) + lot);
        col = mix(col, mix(col, vec3(0.32, 0.30, 0.28), t * 0.6), vis);
        shade *= mix(1.0, (0.78 + 0.38 * t) * (1.0 - 0.4 * (1.0 - smoothstep(0.0, 0.18, fract(m.y / 0.25)))), vis);
        grad.y -= (1.0 - smoothstep(0.0, 0.15, fract(m.y / 0.25))) * 0.5 * vis;
      }
      #endif
      if (style == 3) { rough = 0.36; metal = h1 > 0.42 && h1 < 0.58 ? 0.75 : 0.45; }
      else if (style == 2) rough = 0.62;
      else if (style == 1) rough = 0.72;
      else if (style == 4) rough = 0.95;
      else rough = 0.88;
    }

    // weathering ----------------------------------------------------------------------------
    float mottle = rFbm(m * 0.45 + lot * 1.7);
    shade *= 0.9 + 0.2 * mottle;
    float shady = 0.5 - 0.5 * sunward;
    if (!flatRoof) {
      // algae streaks down the shaded slopes of the old roofs, heaviest near the eaves
      float streak = smoothstep(0.55, 0.9, rNoise(vec2(m.x * 2.6, m.y * 0.22) + lot * 3.0));
      shade *= 1.0 - streak * (0.08 + 0.3 * age * age) * (0.4 + shady) * (style == 3 ? 0.4 : 1.0) * (1.0 - 0.5 * m.y / max(H, 0.5));
      // sun-bleach on the bright side
      col = mix(col, vec3(rLum(col)) * 1.18, 0.16 * max(sunward, 0.0) * (0.4 + age));
    }
    float mossA = mossK * age * age * (0.3 + 0.9 * shady) * 1.3;
    if (mossA > 0.02) {
      float n = rFbm(m * 0.9 + lot * 5.0) + (1.0 - clamp(m.y / max(H, 0.5), 0.0, 1.0)) * 0.22;
      float moss = smoothstep(0.92 - mossA * 0.5, 1.08 - mossA * 0.5, n);
      vec3 mossC = mix(vec3(0.075, 0.1, 0.026), vec3(0.17, 0.2, 0.06), rNoise(m * 3.0));
      col = mix(col, mossC / max(shade, 0.4), moss * 0.85);
      // pale lichen rosettes on the open parts
      float lich = step(0.86 - 0.12 * age, rHash(floor(m * 7.0) + lot)) * rVis(0.14, fw) * (1.0 - moss);
      col = mix(col, vec3(0.42, 0.44, 0.36), lich * 0.5 * age);
    }

    // ridge cap and drip edge -----------------------------------------------------------------
    vec3 albedo = col * mix(1.0, detail, detailK) * shade;
    // the close-up tier's ridge boards: the cap colour the lean roofs paint at their ridge
    if (kind > 2.5) albedo = (style == 1 ? col * 0.9 : style == 3 ? col * 1.08 : col * 0.72) * shade;
    if (!flatRoof && kind < 2.5) {
      float capW = style == 1 ? 0.3 : 0.22;
      float cap = smoothstep(H - capW - fw, H - capW, m.y);
      vec3 capC = style == 1 ? col * 0.9 : style == 3 ? col * 1.08 : col * 0.72;
      #ifdef ROOF_FINE
      if (style == 1) capC *= 0.75 + 0.3 * sqrt(max(sin(3.14159 * fract(m.x / 0.42)), 0.0));
      else capC *= 1.0 - 0.25 * rLine(m.x, 0.3, 0.02, fw) * rVis(0.3, fw);
      #endif
      // a ridge vent: a dark slatted strip under the cap on a third of the houses
      if (h5 < 0.33 && style != 1) {
        float vent = smoothstep(H - 0.5, H - 0.46, m.y) * (1.0 - cap) * step(0.6, m.x) * step(m.x, W - 0.6);
        albedo = mix(albedo, vec3(0.03, 0.03, 0.035), vent * 0.8);
      }
      albedo = mix(albedo, capC * mix(1.0, detail, 0.3), cap);
      albedo *= 1.0 - 0.35 * (1.0 - smoothstep(capW, capW + 0.08, H - m.y)) * (1.0 - cap);
      albedo *= 1.0 - 0.3 * (1.0 - smoothstep(0.0, 0.06 + fw, m.y));
    }

    // features ------------------------------------------------------------------------------
    float hasSolar = 0.0;
    if (kind < 2.5 && W > 2.6 && H > 2.0) {
      vec2 pane = vec2(1.02, 1.7);
      vec2 n0 = vec2(0.0), n1 = vec2(0.0);
      bool solar = false;
      if (!flatRoof && h3 < 0.3 && sunward > 0.3 && H > 3.0) {
        float cols = clamp(floor((W - 0.8) / pane.x) - floor(h4 * 2.5), 2.0, 9.0);
        float rows = clamp(floor((H - 0.9) / pane.y) - (h4 > 0.6 ? 1.0 : 0.0), 1.0, 3.0);
        vec2 size = vec2(cols, rows) * pane;
        n0 = vec2((W - size.x) * (0.5 + (h1 - 0.5) * 0.4), max(0.4, (H - size.y) * (0.25 + 0.3 * h2)));
        n1 = n0 + size;
        solar = true;
      } else if (flatRoof && h3 < 0.4) {
        // rows of panels across a flat roof, clear of its edges
        n0 = vec2(1.0); n1 = vec2(W, H) - 1.0;
        solar = true;
      }
      if (solar) {
        vec2 q = m - n0;
        vec2 sz = n1 - n0;
        float inside = step(0.0, q.x) * step(0.0, q.y) * step(q.x, sz.x) * step(q.y, sz.y);
        if (flatRoof) inside *= step(fract(q.y / 1.6), 0.62);
        // the array stands off the roof: a soft contact shadow round it
        vec2 out2 = max(max(-q, q - sz), 0.0);
        float edge = length(out2);
        albedo *= 1.0 - 0.45 * (1.0 - smoothstep(0.0, 0.14, edge)) * (1.0 - inside);
        if (inside > 0.5) {
          hasSolar = 1.0;
          vec2 p = flatRoof ? vec2(q.x / pane.x, fract(q.y / 1.6) / 0.62) : q / pane;
          vec2 f = fract(p) * pane;
          float frameW = 0.035;
          float frame = 1.0 - step(frameW, f.x) * step(frameW, f.y) * step(f.x, pane.x - frameW) * step(f.y, pane.y - frameW);
          frame = max(frame, 0.0);
          vec3 glass = mix(vec3(0.006, 0.014, 0.04), vec3(0.012, 0.03, 0.075), rHash(floor(p) + lot));
          #ifdef ROOF_FINE
          // cell grid: 6 x 10 cells a panel, faint silver lines
          vec2 c = f / (pane / vec2(6.0, 10.0));
          float grid = max(rLine(c.x, 1.0, 0.06, fwidth(c.x)), rLine(c.y, 1.0, 0.06, fwidth(c.y))) * rVis(0.17, fw);
          glass = mix(glass, vec3(0.08, 0.1, 0.14), grid * 0.6);
          #endif
          vec3 frameC = h4 > 0.45 ? vec3(0.55, 0.57, 0.6) : vec3(0.02, 0.02, 0.025);
          float fvis = rVis(0.5, fw);
          albedo = mix(glass, frameC, frame * fvis);
          rough = mix(0.09, 0.4, frame);
          metal = mix(0.2, 0.8, frame);
          detailK = 0.0;
          grad = vec2(0.0);
        }
      }
    }
    if (hasSolar < 0.5 && kind < 2.5 && W > 1.6 && H > 1.8) {
      // skylights: one or two per plane on about a fifth of the planes
      float hp = rHash(lot + floor(wn.xz * 3.0 + 0.5) * 1.3 + 41.0);
      if (hp < 0.2 + (flatRoof ? 0.15 : 0.0)) {
        vec2 sk = flatRoof ? vec2(1.1, 1.1) : vec2(0.78, 1.18);
        float nsk = hp < 0.08 && W > 3.5 ? 2.0 : 1.0;
        for (float i = 0.0; i < 2.0; i++) {
          if (i >= nsk) break;
          vec2 o = vec2(W * (nsk > 1.5 ? 0.3 + 0.4 * i : 0.25 + 0.5 * rHash(lot + 3.3 + i)), H * (0.35 + 0.25 * rHash(lot + 7.7 + i))) - sk * 0.5;
          vec2 q = m - o;
          float inside = step(0.0, q.x) * step(0.0, q.y) * step(q.x, sk.x) * step(q.y, sk.y);
          vec2 out2 = max(max(-q, q - sk), 0.0);
          albedo *= 1.0 - 0.4 * (1.0 - smoothstep(0.0, 0.1, length(out2))) * (1.0 - inside);
          if (inside > 0.5) {
            float fr = 1.0 - step(0.08, q.x) * step(0.08, q.y) * step(q.x, sk.x - 0.08) * step(q.y, sk.y - 0.08);
            vec3 frameC = rHash(lot + 2.2) > 0.5 ? vec3(0.62, 0.6, 0.56) : vec3(0.05, 0.05, 0.055);
            albedo = mix(vec3(0.01, 0.016, 0.026), frameC, fr);
            rough = mix(0.05, 0.5, fr);
            metal = mix(0.35, 0.2, fr);
            detailK = 0.0;
            grad = vec2(0.0);
            hasSolar = 1.0;
          }
        }
      }
    }
    roofAlbedo = albedo;
    roofRough = rough;
    roofMetal = metal;
    roofGrad = grad;
    // metal, glass and the flat ones ignore the baked shingle normals
    roofFlatten = hasSolar > 0.5 ? 1.0 : style == 3 ? 0.85 : style == 1 ? 0.6 : 0.0;
    diffuseColor.rgb = albedo;
  }
}
`;

/**
 * The walls, every house and both tiers: dirt splashed up the foundations, faint weathering
 * streaks, and on stucco (the roughest cladding in the bake, 0.95) a trowelled grain with its own
 * relief, which the bake's flat plaster lacked. Runs after the roughness is read.
 */
const WALLS = /* glsl */ `
if (roofOn < 0.5) {
  vec3 wn = normalize(vRoofWN);
  if (abs(wn.y) < 0.5) {
    vec3 pm = vRoofP / ${SCALE.toFixed(2)};
    // walls stand on the module's axes, so x + z runs along any of them
    vec2 w = vec2(pm.x + pm.z, pm.y);
    float px = max(fwidth(w.x), fwidth(w.y));
    vec2 lot = floor(vRoofL.xy * 4.0 + 0.5) * 0.25;
    float grime = (1.0 - smoothstep(0.0, 0.5, w.y)) * (0.55 + 0.45 * rNoise(vec2(w.x * 2.3, 0.0) + lot));
    diffuseColor.rgb *= 1.0 - 0.24 * grime;
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.96, 0.92, 0.82), grime * 0.5);
    float streak = smoothstep(0.62, 0.92, rNoise(vec2(w.x * 3.1, w.y * 0.35) + lot * 2.0));
    diffuseColor.rgb *= 1.0 - 0.07 * streak;
    float stucco = smoothstep(0.925, 0.945, roughnessFactor) * step(0.6, w.y);
    if (stucco > 0.0) {
      float patchy = rNoise(w * 2.2 + lot) * 0.6 + rNoise(w * 5.3) * 0.4;
      diffuseColor.rgb *= mix(1.0, 0.84 + 0.32 * patchy, stucco);
      #ifdef ROOF_FINE
      float vis = 1.0 - smoothstep(0.012, 0.035, px);
      if (vis > 0.0) {
        vec2 q = w * 14.0;
        float e = 0.3;
        float h0 = rNoise(q);
        wallGrad = vec2(rNoise(q + vec2(e, 0.0)) - h0, rNoise(q + vec2(0.0, e)) - h0) * 0.9 * vis * stucco;
        diffuseColor.rgb *= 1.0 - 0.1 * (h0 - 0.5) * vis * stucco;
      }
      #endif
    }
  }
}
`;

/**
 * Turns a house material's roofs into the town's roofs (see the file comment). `bases` are the
 * modules' roofing colours (sRGB), in the order `roofAttributes` indexed them. `fine` adds the
 * procedural courses and their bump (HIGH); phones keep the colours, weathering and features.
 */
export function applyRoofs(material: MeshStandardMaterial, bases: string[], fine: boolean): void {
  const c = new Color();
  const table = Array.from({ length: 16 }, (_, i) => {
    c.set(bases[i] ?? '#4d5056');
    return new Vector3(c.r, c.g, c.b);
  });
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms, renderer) => {
    previous.call(material, shader, renderer);
    shader.uniforms.uRoofBase = { value: table };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${VERT_MAIN}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_PARS(fine)}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAG_COLOR}`)
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
        if (roofOn > 0.5) { roughnessFactor = roofRough; metalnessFactor = roofMetal; }
        ${WALLS}`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        if (roofOn > 0.5) {
          normal = normalize(mix(normal, nonPerturbedNormal, roofFlatten));
          #ifdef ROOF_FINE
            // the roof plane's frame: across the slope and up it (world, then view)
            vec3 rwn = normalize(vRoofWN);
            vec3 rtw = abs(rwn.y) > 0.995 ? vec3(1.0, 0.0, 0.0) : normalize(cross(vec3(0.0, 1.0, 0.0), rwn));
            vec3 rtv = normalize((viewMatrix * vec4(rtw, 0.0)).xyz);
            vec3 rbv = normalize((viewMatrix * vec4(cross(rwn, rtw), 0.0)).xyz);
            normal = normalize(normal - rtv * roofGrad.x - rbv * roofGrad.y);
          #endif
        }
        #ifdef ROOF_FINE
        if (roofOn < 0.5 && dot(wallGrad, wallGrad) > 0.0) {
          vec3 upV = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
          vec3 alongV = normalize(cross(upV, normal));
          normal = normalize(normal - alongV * wallGrad.x - upV * wallGrad.y);
        }
        #endif`,
      );
  };
  const key = material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey = () => `${key()}|roofs-${fine ? 'fine' : 'lean'}`;
}
