import type { MeshStandardMaterial, Texture, WebGLProgramParametersWithUniforms } from 'three';
import { Vector2, Vector3, Vector4 } from 'three';
import { METRES_PER_UNIT, NOISE } from './glsl';
import { envBoxGlsl, mirrorGlsl, roadReflect } from './RoadReflect';

/**
 * The night city's streets are one painted canvas repeated along the canyon and a paving sheet under
 * everything else: clean, evenly wet, and nothing has ever happened on them. This is the mess a real
 * downtown street has, in world coordinates (metres), on top of the painted colour:
 *
 * - road: cracks and sealed seams (HIGH: ray-marched grooves that shift with the view), squared repair
 *   patches with a sealed edge, a utility trench or two, manhole covers, oil and rubber down the wheel
 *   tracks, photographed asphalt grain, and puddles in the ruts and gutters that mirror the lamps and neon;
 * - paving: stains, chewing gum, hairline cracks, photographed concrete grain, shallow puddles.
 *
 * Phones keep the stains, oil and puddles (a few noise calls); HIGH adds the cracks, grain and relief.
 * `origin` is the city group's position: the canyon road runs along x with its centre line at z = 0.
 *
 * The canyon road (kind 'road') also carries: wheel tracks polished dark by tyres, rubber laid down in them
 * before every stop line and the drip strip where the cars wait, tar snakes (sealed cracks that meander along
 * the lanes), sawn expansion joints across it, a concrete gutter pan with a drain channel at the kerb, and
 * lane paint worn through to the asphalt, its glass beads glinting in the lamplight (HIGH: the aggregate
 * glints too, and rain rings spread on the puddles). The crossings' bars are kind 'paint'. The painted words,
 * patches, stains, covers and litter are decals over it (actors/RoadDecals.ts), and what the wet surface
 * mirrors is materials/RoadReflect.ts: a box-projected cube of the canyon plus analytic neon, lamp and car
 * glows, sharp in the puddles and smeared into streaks on the damp asphalt.
 */
/**
 * The canyon's streetlamps as the road sees them: head positions (x, z in the city group), laid out in
 * columns on a regular pitch, two to a column (one a side), so a pixel only has to ask the three nearest
 * columns. City.ts fills it; Streetlights.setLevel dims it with the lamps.
 */
const MAX_LAMPS = 32;
export const lampField = {
  level: { value: 1 },
  heads: { value: Array.from({ length: MAX_LAMPS }, () => new Vector2(1e5, 1e5)) },
  /** x of the first column, pitch, columns, head height (city units) */
  info: { value: new Vector4(0, 6.4, 0, 1.4) },
};
export function setLampField(heads: [number, number][], x0: number, pitch: number, headY: number): void {
  heads.slice(0, MAX_LAMPS).forEach(([x, z], i) => lampField.heads.value[i]!.set(x, z));
  lampField.info.value.set(x0, pitch, Math.floor(Math.min(heads.length, MAX_LAMPS) / 2), headY);
}

export interface StreetOptions {
  /** road: the canyon's asphalt; paving: the ground sheet; paint: the crossings' thermoplastic bars */
  kind: 'road' | 'paving' | 'paint';
  origin: Vector3;
  fine: boolean;
  /** photographs of asphalt / pavement, variation about their mean (public/models/homes/detail-*.webp) */
  asphalt?: Texture;
  concrete?: Texture;
  /** light the surface from the streetlamps in `lampField` (strength; the lamps' colour is warm sodium) */
  lamps?: number;
  /** mirror the canyon: box-project the material's env map, and (road, paint) add the analytic glows */
  reflect?: boolean;
}

/** the canyon road's wheel tracks and wetness, shared with the decals so a puddle runs on under the paint */
export const ROAD_WET = /* glsl */ `
float roadTrack(float lz) { return exp(-pow(abs(abs(lz - 1.15) - 0.39) / 0.13, 2.0)) * (1.0 - step(2.35, lz)); }
float roadWet(vec2 pm, float lz) {
  float inC = 1.0 - step(2.35, lz);
  // water runs off the crown and the shoulder (dry by the edge line) into the ruts and the gutter pan
  float gut = smoothstep(2.12, 2.2, lz) * inC;
  float shoulder = smoothstep(1.7, 1.95, lz) * (1.0 - smoothstep(2.08, 2.13, lz)) * inC;
  return smoothstep(0.55, 0.7, nFbm(pm * 0.2 + 31.0) + roadTrack(lz) * 0.16 + gut * 0.16 - shoulder * 0.2);
}`;

/**
 * The streetlamps as fake point lights (declares its uniforms): `streetLamps(P, N, V, albedo, rough)`, and the
 * running sum of their irradiance in `streetLampI` (what glints in the paint's beads and the aggregate).
 */
export function streetLampGlsl(shader: WebGLProgramParametersWithUniforms, k: number): string {
  shader.uniforms.uLamps = lampField.heads;
  shader.uniforms.uLampInfo = lampField.info;
  shader.uniforms.uLampLevel = lampField.level;
  shader.uniforms.uLampK = { value: k };
  return /* glsl */ `
  uniform vec2 uLamps[${MAX_LAMPS}];
  uniform vec4 uLampInfo;
  uniform float uLampLevel;
  uniform float uLampK;
  float streetLampI = 0.0;
  /**
   * Light from the streetlamps on this surface: each head a downlight (cos^2 cone) with inverse-square
   * falloff, a diffuse pool on the albedo and, on wet or polished stretches, a glossy streak toward
   * the camera that lengthens as the roughness drops. Only the three nearest columns are asked.
   */
  vec3 streetLamps(vec3 P, vec3 N, vec3 V, vec3 albedo, float rough) {
    vec3 sum = vec3(0.0);
    float col = floor((P.x - uLampInfo.x) / uLampInfo.y);
    float shin = clamp(2.0 / (rough * rough + 1e-4) - 2.0, 3.0, 500.0);
    float norm = (shin + 2.0) / 25.0;
    for (int ci = -1; ci <= 1; ci++) {
      float cc = col + float(ci);
      if (cc < 0.0 || cc >= uLampInfo.z) continue;
      for (int sd = 0; sd < 2; sd++) {
        vec2 hp = uLamps[int(cc) * 2 + sd];
        vec3 L = vec3(hp.x, uLampInfo.w, hp.y) - P;
        float d2 = dot(L, L);
        vec3 Ln = L * inversesqrt(d2);
        float ndl = max(dot(N, Ln), 0.0);
        float cone = Ln.y * Ln.y;
        float I = uLampK * cone / (d2 + 0.3);
        vec3 H = normalize(Ln + V);
        float spec = pow(max(dot(N, H), 0.0), shin) * norm * 0.06;
        sum += (albedo * ndl + vec3(min(spec, 4.0)) * ndl) * I;
        streetLampI += I * ndl;
      }
    }
    streetLampI *= uLampLevel;
    return sum * vec3(1.0, 0.74, 0.44) * uLampLevel;
  }`;
}

export function applyStreets(material: MeshStandardMaterial, o: StreetOptions): void {
  const road = o.kind === 'road';
  const paint = o.kind === 'paint';
  const photo = o.fine && !paint && !!(road ? o.asphalt : o.concrete);
  const mirror = !!o.reflect && (road || paint);
  const M = METRES_PER_UNIT.toFixed(2);
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms, renderer) => {
    previous.call(material, shader, renderer);
    shader.uniforms.uSOrigin = { value: o.origin };
    if (photo) shader.uniforms.uSPhoto = { value: road ? o.asphalt : o.concrete };
    if (o.fine && road) shader.uniforms.uRTime = roadReflect.time;
    const lampPars = o.lamps ? streetLampGlsl(shader, o.lamps) : '';
    const mirrorPars = mirror ? mirrorGlsl(shader, !!o.lamps) : '';
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uSOrigin;\nvarying vec3 vSW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSW = (modelMatrix * vec4(position, 1.0)).xyz - uSOrigin;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', /* glsl */ `#include <common>
        varying vec3 vSW;
        uniform vec3 uSOrigin;
        ${photo ? 'uniform sampler2D uSPhoto;' : ''}
        ${o.fine && road ? 'uniform float uRTime;' : ''}
        ${NOISE}
        ${ROAD_WET}
        float streetWet = 0.0;
        float streetOil = 0.0;
        float streetBump = 0.0;
        float streetMask = 0.0;
        float streetSpark = 0.0;
        float streetPolish = 0.0;
        vec2 streetRipple = vec2(0.0);
        ${lampPars}
        ${mirrorPars}`)
      .replace('#include <map_fragment>', /* glsl */ `#include <map_fragment>
        {
          vec2 pm = vSW.xz * ${M};
          float px = max(fwidth(pm.x), fwidth(pm.y));
          float near1 = 1.0 - smoothstep(0.09, 0.27, px);
          float near2 = 1.0 - smoothstep(0.035, 0.1, px);
          float nearC = 1.0 - smoothstep(0.04, 0.13, px);
          vec3 Vw = transpose(mat3(viewMatrix)) * normalize(vViewPosition);
          vec2 pd = -Vw.xz / max(Vw.y, 0.22);
          vec3 c = diffuseColor.rgb;
          ${road ? /* glsl */ `
          float lz = abs(vSW.z);
          float inCanyon = 1.0 - step(2.35, lz);
          float worn = smoothstep(0.35, 0.7, nFbm(pm * 0.05 + 2.0));
          float trk = roadTrack(lz);
          // the lane paint in the canvas (its bright texels): thermoplastic worn through to the asphalt, most
          // where the tyres run over it, its glass beads glinting in the lamplight
          float paintM = smoothstep(0.03, 0.12, dot(c, vec3(0.3333))) * inCanyon;
          float pw = nNoise(pm * 2.3 + 5.0) * 0.6 + worn * 0.4 + trk * 0.3;
          float gone = smoothstep(0.6, 0.78, pw) * paintM;
          c = mix(c, vec3(0.0097, 0.011, 0.0185) * 1.1, gone);
          c *= 1.0 - 0.18 * paintM * smoothstep(0.3, 0.6, pw);
          streetSpark = step(0.965, nHash(floor(pm * 70.0))) * paintM * (1.0 - gone) * near2;
          // the two wheel tracks of each lane, polished smooth and darker by the tyres
          streetPolish = trk * (0.55 + 0.45 * worn);
          c *= 1.0 - 0.2 * streetPolish;
          // oil and rubber, mostly down the tracks, in streaks along the lane
          float oilN = smoothstep(0.3, 0.7, nFbm(vec2(pm.x * 0.3, pm.y * 0.8) + 11.0));
          streetOil = (0.2 + trk * 0.8) * oilN;
          c *= 1.0 - 0.42 * streetOil;
          // the stop lines: rubber laid down in the tracks as cars brake for them, and the drip strip in the
          // middle of the lane where they wait (cross streets every 21 units from x = -47; a lane brakes on
          // its own approach side: +z drives +x)
          float rel = mod(vSW.x + 57.5, 21.0) - 10.5;
          float before = -rel * sign(vSW.z);
          float brk = smoothstep(2.3, 2.6, before) * (1.0 - smoothstep(5.0, 9.0, before)) * inCanyon;
          float rubber = brk * trk * smoothstep(0.3, 0.75, nNoise(vec2(pm.x * 0.5, pm.y * 7.0) + 70.0));
          float drip = smoothstep(2.4, 2.8, before) * (1.0 - smoothstep(3.4, 4.6, before)) * exp(-pow((lz - 1.15) / 0.17, 2.0)) * inCanyon;
          c *= 1.0 - 0.5 * rubber - 0.4 * drip * (0.4 + 0.6 * oilN);
          streetOil = max(streetOil, max(drip * 0.9, rubber * 0.6));
          // tar snakes: crack sealer poured along the cracks, meandering mostly down the lanes
          float sn = nNoise(vec2(pm.x * 0.07, pm.y * 0.32) + 40.0);
          float aw = fwidth(sn) * 1.3 + 1e-4;
          float snake = (1.0 - smoothstep(0.004, 0.004 + aw, abs(sn - 0.5))) * smoothstep(0.42, 0.62, nNoise(pm * 0.045 + 13.0)) * inCanyon;
          snake *= 1.0 - 0.5 * smoothstep(0.1, 0.4, px);
          c = mix(c, vec3(0.011, 0.011, 0.013), snake * 0.9);
          streetOil = max(streetOil, snake * 0.7);
          streetBump += snake * 0.0015 / ${M} * near1;
          streetMask = max(streetMask, snake * near1);
          // sawn joints across the road, sealed, every 21 m, a little off square
          float jc = floor(pm.x / 21.0 + 0.37);
          float jd = abs(fract(pm.x / 21.0 + 0.37 + pm.y * 0.0015 * (nHash(vec2(jc, 3.0)) - 0.5) + 0.5) - 0.5) * 21.0;
          float joint = (1.0 - smoothstep(0.012, 0.012 + px, jd)) * inCanyon;
          float jband = (1.0 - smoothstep(0.035, 0.05 + px, jd)) * inCanyon;
          c = mix(c, c * 0.55, jband * 0.6);
          c = mix(c, vec3(0.008), joint * 0.85);
          streetBump -= joint * 0.004 / ${M} * near1;
          streetMask = max(streetMask, jband * near1);
          // squared repair patches of newer asphalt with a sealed edge
          vec2 rc = floor(pm / 7.0);
          if (nHash(rc + 3.3) < 0.22) {
            vec2 ro = vec2(0.5 + 3.0 * nHash(rc + 1.1), 0.5 + 3.0 * nHash(rc + 2.2));
            vec2 rs = vec2(1.0 + 2.6 * nHash(rc + 4.4), 0.9 + 1.8 * nHash(rc + 5.5));
            vec2 rq = pm - rc * 7.0 - ro;
            float inR = step(0.0, rq.x) * step(0.0, rq.y) * step(rq.x, rs.x) * step(rq.y, rs.y);
            float edgeR = inR * (1.0 - step(0.08, min(min(rq.x, rs.x - rq.x), min(rq.y, rs.y - rq.y))));
            c *= mix(1.0, 0.72 + 0.12 * nHash(rc + 7.7), inR);
            c = mix(c, c * 0.35, edgeR * 0.85);
            streetBump += (inR * 0.004 + edgeR * 0.006) / ${M};
            streetMask = max(streetMask, inR * near1);
          }
          // a utility trench along the road
          vec2 tc = floor(pm / vec2(34.0, 14.0));
          if (nHash(tc + 5.5) < 0.3) {
            float ty = 2.0 + 10.0 * nHash(tc + 8.8);
            float tx0 = 4.0 + 10.0 * nHash(tc + 2.2), tl = 8.0 + 14.0 * nHash(tc + 3.3);
            vec2 tq = pm - tc * vec2(34.0, 14.0) - vec2(tx0, ty);
            float inT = step(0.0, tq.x) * step(tq.x, tl) * step(abs(tq.y), 0.55);
            float seam = inT * (1.0 - step(0.07, min(abs(abs(tq.y) - 0.55), min(tq.x, tl - tq.x))));
            c *= mix(1.0, 0.8, inT);
            c = mix(c, c * 0.3, seam * 0.9);
            streetMask = max(streetMask, inT * near1);
          }
          // the gutter: a concrete pan between the edge line and the kerb, jointed every 1.2 m, with a drain
          // channel along the kerb's foot
          float pan = smoothstep(2.118, 2.13, lz) * inCanyon;
          float panJ = 1.0 - smoothstep(0.006, 0.006 + px, (0.5 - abs(fract(pm.x / 1.2) - 0.5)) * 1.2);
          float chan = smoothstep(2.2, 2.215, lz) * inCanyon;
          vec3 conc = vec3(0.105, 0.102, 0.095) * (0.7 + 0.45 * worn) * (1.0 - 0.35 * oilN);
          c = mix(c, conc, pan);
          c *= 1.0 - pan * (0.5 * panJ + 0.55 * chan);
          streetOil *= 1.0 - pan * 0.7;
          streetPolish *= 1.0 - pan;
          streetBump += pan * (0.006 - panJ * 0.003 - chan * 0.008) / ${M} * near1;
          streetMask = max(streetMask, pan * near1);
          // puddles stand in the ruts, the gutters and the low stretches; the crown and the shoulder run dry
          streetWet = roadWet(pm, lz);
          ` : paint ? /* glsl */ `
          // thermoplastic: worn through to the asphalt where the tyres cross it, grit in its pores, beads that
          // glint in the lamplight
          float lz = abs(vSW.z);
          float worn = smoothstep(0.35, 0.7, nFbm(pm * 0.05 + 2.0));
          float pw = nNoise(pm * 3.1 + 9.0) * 0.55 + worn * 0.3 + roadTrack(lz) * 0.45;
          float gone = smoothstep(0.58, 0.74, pw);
          c *= 0.82 + 0.18 * nNoise(pm * 9.0);
          c = mix(c, vec3(0.011, 0.012, 0.018), gone);
          streetSpark = step(0.96, nHash(floor(pm * 70.0))) * (1.0 - gone) * near2;
          streetWet = roadWet(pm, lz);
          ` : /* glsl */ `
          float worn = smoothstep(0.35, 0.7, nFbm(pm * 0.07 + 6.0));
          // stains: grease, spilled drinks, old rain, in blotches a few metres across
          float stain = smoothstep(0.5, 0.78, nFbm(pm * 0.45 + 17.0)) * (0.4 + 0.6 * worn);
          c *= 1.0 - 0.34 * stain;
          c = mix(c, c * vec3(1.06, 0.98, 0.88), stain * 0.4);
          streetOil = stain * 0.5;
          // chewing gum, dark flat discs, thickest in the worn stretches
          vec2 gc = floor(pm / 0.32);
          if (nHash(gc + 12.0) < 0.012 + 0.07 * worn) {
            vec2 go = vec2(0.08 + 0.16 * nHash(gc + 1.3), 0.08 + 0.16 * nHash(gc + 2.6));
            float gd = length(pm - gc * 0.32 - go);
            float gum = (1.0 - smoothstep(0.022, 0.03, gd)) * near2;
            c = mix(c, vec3(0.09, 0.085, 0.08), gum * 0.9);
            streetBump += gum * 0.002 / ${M};
            streetMask = max(streetMask, gum);
          }
          // low spots hold water after rain
          streetWet = smoothstep(0.62, 0.74, nFbm(pm * 0.16 + 31.0)) * 0.8;
          `}
          ${o.fine && !paint ? /* glsl */ `
          // cracks: the grooves ray-marched against their own depth (7 cm), so they shift with the view
          float crack = 0.0;
          if (nearC > 0.0) {
            vec2 cp = pm;
            if (nCrack(pm) < 0.999) {
              for (int i = 1; i <= 6; i++) {
                float l = float(i) / 6.0;
                cp = pm + pd * (0.07 * l);
                if (l >= nCrack(cp)) break;
              }
            }
            crack = nCrack(cp) * nearC * (1.0 - streetWet) * ${road ? '1.0' : '0.6'};
            c = mix(c, vec3(0.022, 0.024, 0.028), crack * ${road ? '0.85' : '0.6'});
            streetBump -= crack * 0.05 / ${M};
            streetMask = max(streetMask, crack);
          }` : ''}
          ${photo ? /* glsl */ `
          // photographed grain, offset by its own height so it holds depth as the camera moves
          vec2 tp = pm + pd * (1.0 - dot(texture2D(uSPhoto, pm / 1.6).rgb, vec3(0.3333))) * 0.012 * near1;
          vec3 ph = mix(texture2D(uSPhoto, tp / 1.6).rgb, texture2D(uSPhoto, vec2(tp.y, -tp.x) / 1.6 * 0.41 + 0.27).rgb, 0.4) * 2.0;
          c *= mix(vec3(1.0), ph, 0.7);
          streetBump += (dot(ph, vec3(0.3333)) - 1.0) * 0.004 / ${M} * near1;
          streetMask = max(streetMask, near1);` : ''}
          ${o.fine && road ? /* glsl */ `
          // the aggregate's quartz catches the lamps too, a fleck in every few hundred
          streetSpark += step(0.996, nHash(floor(pm * 55.0) + 3.1)) * near2 * 0.3 * (1.0 - streetWet);
          // rain rings spreading on the standing water, one drop per 60 cm cell on its own clock
          if (streetWet > 0.2 && near1 > 0.0) {
            vec2 rp = pm * 1.7;
            vec2 ci = floor(rp);
            vec2 f = fract(rp) - 0.5 - (vec2(nHash(ci), nHash(ci + 1.7)) - 0.5) * 0.5;
            float rph = fract(uRTime * 0.55 + nHash(ci + 4.2));
            float r = length(f);
            float front = r - rph * 0.5;
            float renv = (1.0 - rph) * exp(-abs(front) * 14.0);
            streetRipple = f / max(r, 1e-3) * cos(front * 70.0) * renv * streetWet * near1;
          }` : ''}
          // standing water is darker, and takes the sky
          c *= 1.0 - 0.45 * streetWet;
          diffuseColor.rgb = c;
        }`)
      .replace('#include <emissivemap_fragment>', /* glsl */ `#include <emissivemap_fragment>
        ${o.lamps || mirror ? /* glsl */ `
        {
          vec3 Pw = vSW;
          vec3 Vw2 = normalize(cameraPosition - (vSW + uSOrigin));
          vec3 Nw = inverseTransformDirection(normal, viewMatrix);
          ${o.lamps ? /* glsl */ `
          totalEmissiveRadiance += streetLamps(Pw, Nw, Vw2, diffuseColor.rgb, roughnessFactor);
          totalEmissiveRadiance += streetSpark * min(streetLampI, 0.5) * vec3(1.0, 0.8, 0.55) * 1.6;` : ''}
          ${mirror ? /* glsl */ `
          // the wet street's mirror: a puddle like glass, damp asphalt only at a glance (Fresnel, water's F0)
          float fr = 0.02 + 0.98 * pow(1.0 - max(dot(Nw, Vw2), 0.0), 5.0);
          float wetK = mix(0.1 + 0.25 * streetPolish, 1.0, streetWet);
          totalEmissiveRadiance += roadMirror(Pw, reflect(-Vw2, Nw), roughnessFactor) * fr * wetK;` : ''}
        }` : ''}`)
      .replace('#include <roughnessmap_fragment>', /* glsl */ `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor * (1.0 - 0.3 * streetOil) * (1.0 - 0.4 * streetPolish), 0.035, streetWet);`)
      .replace('#include <normal_fragment_maps>', /* glsl */ `#include <normal_fragment_maps>
        normal = normalize(mix(normal, nonPerturbedNormal, streetWet * 0.9));
        if (streetMask > 0.01) {
          vec3 bx = dFdx(vec3(vSW.x, streetBump, vSW.z));
          vec3 by = dFdy(vec3(vSW.x, streetBump, vSW.z));
          float det = bx.x * by.z - bx.z * by.x;
          if (abs(det) > 1e-9) {
            float gx = (bx.y * by.z - bx.z * by.y) / det;
            float gz = (bx.x * by.y - bx.y * by.x) / det;
            vec3 tx = (viewMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz;
            vec3 tz = (viewMatrix * vec4(0.0, 0.0, 1.0, 0.0)).xyz;
            normal = normalize(normal - (tx * gx + tz * gz) * 0.8 * streetMask * (1.0 - streetWet));
          }
        }
        ${o.fine && road ? /* glsl */ `
        if (dot(streetRipple, streetRipple) > 0.0) {
          vec3 rtx = (viewMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz;
          vec3 rtz = (viewMatrix * vec4(0.0, 0.0, 1.0, 0.0)).xyz;
          normal = normalize(normal - (rtx * streetRipple.x + rtz * streetRipple.y) * 0.06);
        }` : ''}`);
    if (o.reflect) envBoxGlsl(shader);
  };
  const key = material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey = () =>
    `${key()}|streets-${o.kind}-${o.fine ? 'fine' : 'lean'}${photo ? '-photo' : ''}${o.reflect ? '-mirror' : ''}`;
}
