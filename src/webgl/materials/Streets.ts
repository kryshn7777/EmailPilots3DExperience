import type { MeshStandardMaterial, Texture, WebGLProgramParametersWithUniforms } from 'three';
import { Vector2, Vector3, Vector4 } from 'three';
import { METRES_PER_UNIT, NOISE } from './glsl';

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
  kind: 'road' | 'paving';
  origin: Vector3;
  fine: boolean;
  /** photographs of asphalt / pavement, variation about their mean (public/models/homes/detail-*.webp) */
  asphalt?: Texture;
  concrete?: Texture;
  /** light the surface from the streetlamps in `lampField` (strength; the lamps' colour is warm sodium) */
  lamps?: number;
}

export function applyStreets(material: MeshStandardMaterial, o: StreetOptions): void {
  const road = o.kind === 'road';
  const photo = o.fine && !!(road ? o.asphalt : o.concrete);
  const M = METRES_PER_UNIT.toFixed(2);
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms, renderer) => {
    previous.call(material, shader, renderer);
    shader.uniforms.uSOrigin = { value: o.origin };
    if (photo) shader.uniforms.uSPhoto = { value: road ? o.asphalt : o.concrete };
    if (o.lamps) {
      shader.uniforms.uLamps = lampField.heads;
      shader.uniforms.uLampInfo = lampField.info;
      shader.uniforms.uLampLevel = lampField.level;
      shader.uniforms.uLampK = { value: o.lamps };
    }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uSOrigin;\nvarying vec3 vSW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSW = (modelMatrix * vec4(position, 1.0)).xyz - uSOrigin;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', /* glsl */ `#include <common>
        varying vec3 vSW;
        uniform vec3 uSOrigin;
        ${photo ? 'uniform sampler2D uSPhoto;' : ''}
        ${NOISE}
        float streetWet = 0.0;
        float streetOil = 0.0;
        float streetBump = 0.0;
        float streetMask = 0.0;
        ${o.lamps ? /* glsl */ `
        uniform vec2 uLamps[${MAX_LAMPS}];
        uniform vec4 uLampInfo;
        uniform float uLampLevel;
        uniform float uLampK;
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
            }
          }
          return sum * vec3(1.0, 0.74, 0.44) * uLampLevel;
        }` : ''}`)
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
          // the two wheel tracks of each lane, 0.39 units either side of the lane's centre
          float trk = exp(-pow(abs(abs(lz - 1.15) - 0.39) / 0.13, 2.0)) * inCanyon;
          float worn = smoothstep(0.35, 0.7, nFbm(pm * 0.05 + 2.0));
          // oil and rubber, mostly down the tracks, in streaks along the lane
          float oilN = smoothstep(0.3, 0.7, nFbm(vec2(pm.x * 0.3, pm.y * 0.8) + 11.0));
          streetOil = (0.2 + trk * 0.8) * oilN;
          c *= 1.0 - 0.42 * streetOil;
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
          // manhole covers
          vec2 mc = floor(pm / 19.0);
          if (nHash(mc + 9.9) < 0.6) {
            vec2 mo = vec2(3.0 + 13.0 * nHash(mc + 1.7), 3.0 + 13.0 * nHash(mc + 6.1));
            float md = length(pm - mc * 19.0 - mo);
            float disc = 1.0 - smoothstep(0.4, 0.44, md);
            float rim = smoothstep(0.4, 0.44, md) * (1.0 - smoothstep(0.5, 0.56, md));
            float rib = 0.5 + 0.5 * sin((pm.x + pm.y) * 38.0);
            c = mix(c, vec3(0.1, 0.1, 0.105) * (0.8 + 0.4 * rib), disc);
            c = mix(c, c * 0.35, rim * 0.8);
            streetBump += (disc * 0.012 * rib - rim * 0.012) / ${M} * near1;
            streetMask = max(streetMask, (disc + rim) * near1);
          }
          // puddles stand in the ruts, the gutters and the low stretches
          float gut = smoothstep(1.85, 2.3, lz) * inCanyon;
          streetWet = smoothstep(0.55, 0.7, nFbm(pm * 0.2 + 31.0) + trk * 0.1 + gut * 0.12);
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
          ${o.fine ? /* glsl */ `
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
          // standing water is darker, and takes the sky
          c *= 1.0 - 0.45 * streetWet;
          diffuseColor.rgb = c;
        }`)
      .replace('#include <emissivemap_fragment>', /* glsl */ `#include <emissivemap_fragment>
        ${o.lamps ? /* glsl */ `
        {
          vec3 Pw = vSW;
          vec3 Vw2 = normalize(cameraPosition - (vSW + uSOrigin));
          vec3 Nw = inverseTransformDirection(normal, viewMatrix);
          totalEmissiveRadiance += streetLamps(Pw, Nw, Vw2, diffuseColor.rgb, roughnessFactor);
        }` : ''}`)
      .replace('#include <roughnessmap_fragment>', /* glsl */ `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor * (1.0 - 0.3 * streetOil), 0.035, streetWet);`)
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
        }`);
  };
  const key = material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey = () => `${key()}|streets-${o.kind}-${o.fine ? 'fine' : 'lean'}${photo ? '-photo' : ''}`;
}
