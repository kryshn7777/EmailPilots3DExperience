import type { MeshStandardMaterial, Texture, WebGLProgramParametersWithUniforms } from 'three';
import { Vector2 } from 'three';
import { HOME_CELL } from '../bake/cityGen.mjs';

/**
 * The town's ground is one painted cell repeated 9 x 10 times, so from the plane every lawn was the
 * same green with the same paths. This breaks it up in town coordinates, on the lawn texels only
 * (picked by colour: grass is the only green in the cell):
 *
 * - every lot its own grass: lush, blue-green, bright, yellowing, a few gone to straw;
 * - mowing stripes on most lots, along or across, with the strip by the fences left unmown;
 * - patches of drier and lusher grass at two scales, so the green has weather in it;
 * - the asphalt and pavements get repairs and wear at the same scales;
 * - and the mess a tidy cell lacks (HIGH): cracked asphalt with parallax-occluded grooves, patched repairs, oil,
 *   drifts of fallen leaves, bare worn lawn and dead spots, so no two lots read as stamped from one mould.
 *
 * Coordinates are the town's (group-local x/z), from the plane's own vertex positions.
 */
export function applyLawns(
  material: MeshStandardMaterial,
  origin: Vector2,
  /** tiling photo detail for the hard surfaces (public/models/homes/detail-*.webp, see scripts/make-detail-maps.py) */
  detail?: { asphalt: Texture; concrete: Texture },
): void {
  const { w, d, lotW, lots, lotD, street } = HOME_CELL;
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms, renderer) => {
    previous.call(material, shader, renderer);
    shader.uniforms.uLawnOrigin = { value: origin };
    if (detail) {
      shader.uniforms.uAsphalt = { value: detail.asphalt };
      shader.uniforms.uConcrete = { value: detail.concrete };
    }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform vec2 uLawnOrigin;\nvarying vec2 vTown;')
      // the plane lies in x/y and is turned flat by -90 degrees about x: plane +y is town -z
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTown = vec2(position.x, -position.y) + uLawnOrigin;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', /* glsl */ `#include <common>
        varying vec2 vTown;
        float gHash(vec2 p) { p = fract(p * vec2(127.13, 311.71)); p += dot(p, p + 34.53); return fract(p.x * p.y); }
        float gNoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(gHash(i), gHash(i + vec2(1.0, 0.0)), f.x), mix(gHash(i + vec2(0.0, 1.0)), gHash(i + 1.0), f.x), f.y);
        }
        const mat2 gRot = mat2(1.6, 1.2, -1.2, 1.6);
        float gFbm(vec2 p) { return gNoise(p) * 0.55 + gNoise(gRot * p + 5.3) * 0.3 + gNoise(gRot * gRot * p * 1.075 + 1.7) * 0.15; }
        // crack network: contour lines of two noise fields, thick in the worn zones; 0 on sound surface, 1 at the groove
        float gCrack(vec2 p) {
          float zone = smoothstep(0.42, 0.72, gNoise(p * 0.11 + 9.0));
          float n = gNoise(p * 0.85) * 0.62 + gNoise(gRot * p * 0.85 + 3.7) * 0.38;
          float line = 1.0 - smoothstep(0.0, 0.03, abs(n - 0.5));
          float fine = 1.0 - smoothstep(0.0, 0.02, abs(gNoise(p * 3.1 + 2.0) * 0.7 + gNoise(gRot * p * 3.1) * 0.3 - 0.5));
          return clamp(line * (0.3 + 0.7 * zone) + fine * zone * 0.85, 0.0, 1.0);
        }
        float lawnBump = 0.0;
        float lawnMask = 0.0;
        ${detail ? 'uniform sampler2D uAsphalt;\nuniform sampler2D uConcrete;' : ''}`)
      .replace('#include <map_fragment>', /* glsl */ `#include <map_fragment>
        {
          vec3 g = diffuseColor.rgb;
          float lawn = smoothstep(0.012, 0.04, g.g - max(g.r, g.b));
          vec2 cellSize = vec2(${w.toFixed(1)}, ${d.toFixed(1)});
          vec2 cell = floor(vTown / cellSize);
          vec2 loc = vTown - cell * cellSize;
          float row = step(${(lotD + street / 2).toFixed(2)}, loc.y);
          float k = min(floor(loc.x / ${lotW.toFixed(1)}), ${lots.toFixed(1)});
          vec2 id = cell * 10.0 + vec2(k, row * 5.0);
          float h0 = gHash(id + 0.31), h1 = gHash(id + 5.77), h2 = gHash(id + 11.13), h3 = gHash(id + 19.7);
          // each lot's grass
          vec3 tint = h0 < 0.22 ? vec3(0.86, 1.0, 0.8)      // deep, well watered
                    : h0 < 0.4 ? vec3(1.06, 1.08, 0.86)     // bright spring green
                    : h0 < 0.56 ? vec3(0.8, 0.96, 0.98)     // blue-green fescue
                    : h0 < 0.72 ? vec3(1.18, 1.06, 0.72)    // yellowing
                    : h0 < 0.8 ? vec3(1.2, 1.04, 0.75)      // gone to straw
                    : vec3(0.95, 1.0, 0.9);
          float lum = dot(g, vec3(0.2126, 0.7152, 0.0722));
          vec3 c = g * tint;
          // real lawns are far less green than a painted one: pull the colour toward its luminance, a touch warm
          c = mix(vec3(dot(c, vec3(0.2126, 0.7152, 0.0722))), c, 0.75) * vec3(1.04, 1.0, 0.9);
          // weather at two scales: a field of a few lots, and patches a couple of metres across
          float macro = gFbm(vTown * 0.035 + 3.0);
          float mid = gFbm(vTown * 0.31 + id * 0.7);
          c *= 0.84 + 0.32 * macro;
          float dry = smoothstep(0.6, 0.82, mid + (h2 - 0.5) * 0.36);
          c = mix(c, vec3(lum) * vec3(1.35, 1.22, 0.78), dry * (0.15 + 0.2 * h3));
          float lush = smoothstep(0.66, 0.85, 1.0 - mid);
          c = mix(c, c * vec3(0.8, 0.95, 0.75), lush * 0.6);
          // mowing stripes inside the lot, lighter one way, darker the other
          float inLot = k < ${(lots - 0.5).toFixed(1)} ? (row < 0.5 ? step(loc.y, ${(lotD - 0.05).toFixed(2)}) : step(${(lotD + street + 0.05).toFixed(2)}, loc.y)) : 0.0;
          if (h1 < 0.62 && inLot > 0.5) {
            float along = h2 < 0.5 ? loc.x : loc.y;
            float period = 0.5 + 0.25 * h3;
            float fw = fwidth(along) / period;
            float s = sin(along / period * 3.14159);
            float band = smoothstep(-fw * 3.0, fw * 3.0, s) * 2.0 - 1.0;
            float vis = 1.0 - smoothstep(0.15, 0.4, fw);
            c *= 1.0 + band * 0.075 * vis;
          }
          // the strip along the fences the mower misses: longer, seedier grass
          float lx = loc.x - k * ${lotW.toFixed(1)};
          float edge = min(min(lx, ${lotW.toFixed(1)} - lx), row < 0.5 ? loc.y : ${d.toFixed(1)} - loc.y);
          c = mix(c, c * vec3(1.08, 0.95, 0.7), (1.0 - smoothstep(0.08, 0.3, edge)) * inLot * 0.6);
          // up close, grass: clumps a few centimetres to a metre across, clover drifts with their
          // white heads, the blades' grain; each fades out before it would shimmer
          float px = max(fwidth(vTown.x), fwidth(vTown.y));
          float near1 = 1.0 - smoothstep(0.03, 0.09, px);
          float near2 = 1.0 - smoothstep(0.012, 0.035, px);
          float clump = gNoise(vTown * 3.1 + id) * 0.6 + gNoise(vTown * 7.3) * 0.4;
          c *= mix(1.0, 0.72 + 0.56 * clump, near1);
          // thatch: small straw-coloured patches where the grass has thinned
          c = mix(c, vec3(lum) * vec3(1.3, 1.2, 0.8), smoothstep(0.78, 0.9, gNoise(vTown * 5.7 + id * 2.0)) * 0.3 * near1);
          float clover = smoothstep(0.66, 0.8, gNoise(vTown * 0.9 + id * 1.3 + 4.0)) * step(h3, 0.7);
          c = mix(c, c * vec3(0.86, 1.04, 1.02), clover * 0.7 * near1);
          float heads = step(0.94, gHash(floor(vTown * 24.0))) * clover;
          c = mix(c, vec3(0.62, 0.62, 0.56), heads * near2 * 0.7);
          float grain = gNoise(vTown * vec2(41.0, 37.0)) * 0.55 + gNoise(vTown * 83.0) * 0.45;
          c *= mix(1.0, 0.82 + 0.36 * grain, near2);
          // bare earth where feet and wheels have worn the grass, dead spots, and a few dandelions
          float bare = smoothstep(0.68, 0.8, gFbm(vTown * 0.26 + id * 1.3)) * step(h1, 0.55) * inLot;
          c = mix(c, vec3(0.2, 0.15, 0.1) * (0.8 + 0.4 * gNoise(vTown * 9.0)), bare * 0.85);
          vec2 sc = floor(vTown / 1.6);
          if (gHash(sc + id) < 0.18) {
            vec2 so = vec2(0.4 + 0.8 * gHash(sc + 3.1), 0.4 + 0.8 * gHash(sc + 6.2));
            float sd = length(vTown - sc * 1.6 - so);
            float spot = (1.0 - smoothstep(0.12, 0.26, sd + (gNoise(vTown * 14.0) - 0.5) * 0.08)) * inLot;
            c = mix(c, vec3(lum) * vec3(1.35, 1.22, 0.82), spot * 0.55);
          }
          // a height in town units: clumps a few centimetres high, the grain a few millimetres
          lawnBump = lawn * (near1 * 0.03 * (clump - 0.5) + near2 * 0.004 * (grain - 0.5));
          lawnMask = lawn * max(near1, near2);
          // hard surfaces: patched asphalt, stained and newer slabs
          vec3 hard = g * (0.9 + 0.2 * gFbm(vTown * 0.45 + 7.0)) * (0.94 + 0.12 * macro);
          // up close the paving and asphalt are speckled too, not one flat tone
          hard *= mix(1.0, 0.86 + 0.28 * gNoise(vTown * 55.0), near1);
          ${detail ? `
          // the view ray in town units: where the texel under a point at depth d is, per metre of d
          vec3 gVw = transpose(mat3(viewMatrix)) * normalize(vViewPosition);
          vec2 gPd = -gVw.xz / max(gVw.y, 0.22);
          float nearC = 1.0 - smoothstep(0.04, 0.13, px);
          float asphalt = (1.0 - lawn) * (1.0 - smoothstep(0.16, 0.30, dot(g, vec3(0.2126, 0.7152, 0.0722))));
          // repairs: squared patches of newer, darker asphalt with a sealed edge
          vec2 rc = floor(vTown / 6.5);
          float rh = gHash(rc + 3.3);
          if (rh < 0.16 && asphalt > 0.0) {
            vec2 ro = vec2(0.6 + 3.0 * gHash(rc + 1.1), 0.6 + 3.2 * gHash(rc + 2.2));
            vec2 rs = vec2(0.8 + 1.7 * gHash(rc + 4.4), 0.7 + 1.1 * gHash(rc + 5.5));
            vec2 rq = vTown - rc * 6.5 - ro;
            float inR = step(0.0, rq.x) * step(0.0, rq.y) * step(rq.x, rs.x) * step(rq.y, rs.y);
            float edgeR = inR * (1.0 - step(0.07, min(min(rq.x, rs.x - rq.x), min(rq.y, rs.y - rq.y))));
            hard *= mix(1.0, 0.8 + 0.1 * gHash(rc + 7.7), inR * asphalt);
            hard = mix(hard, hard * 0.4, edgeR * asphalt * 0.8);
          }
          // oil and tyre rubber: broad dark stains where the traffic stops and turns
          float oil = smoothstep(0.58, 0.76, gFbm(vTown * 0.8 + 21.0)) * smoothstep(0.5, 0.8, gNoise(vTown * 0.12 + 4.0));
          hard *= 1.0 - 0.28 * oil * asphalt;
          // cracks, the grooves ray-marched against their own depth so they shift with the view (5 cm deep)
          float crack = 0.0;
          if (asphalt > 0.0 && nearC > 0.0) {
            vec2 cp = vTown;
            if (gCrack(vTown) < 0.999) {
              for (int i = 1; i <= 6; i++) {
                float l = float(i) / 6.0;
                cp = vTown + gPd * (0.05 * l);
                if (l >= gCrack(cp)) break;
              }
            }
            crack = gCrack(cp) * nearC * asphalt;
            hard = mix(hard, vec3(0.022, 0.024, 0.028), crack * 0.85);
            lawnBump -= crack * 0.012;
            lawnMask = max(lawnMask, crack);
          }
          // photographs of asphalt and of pavement tiled over the bake: the grain a centimetre-a-pixel
          // bake cannot hold. Each map is only variation about its mean (scripts/make-detail-maps.py), so
          // the colour of the surface stays what the bake says; two scales and a turn hide the repeat.
          float hlum = dot(g, vec3(0.2126, 0.7152, 0.0722));
          float onRoad = 1.0 - smoothstep(0.16, 0.30, hlum);
          vec2 tp = vTown + gPd * (1.0 - dot(texture2D(uAsphalt, vTown / 0.55).rgb, vec3(0.3333))) * 0.008 * near1;
          vec2 qa = tp / 0.55;
          vec3 pa = mix(texture2D(uAsphalt, qa).rgb, texture2D(uAsphalt, vec2(qa.y, -qa.x) * 0.41 + 0.27).rgb, 0.4) * 2.0;
          vec2 qc = tp / 0.6;
          vec3 pc = mix(texture2D(uConcrete, qc).rgb, texture2D(uConcrete, vec2(qc.y, -qc.x) * 0.43 + 0.19).rgb, 0.4) * 2.0;
          vec3 photo = mix(pc, pa, onRoad);
          hard *= mix(vec3(1.0), photo, 0.8 * (1.0 - lawn));
          // and its relief, while a pixel is still smaller than a grain
          float nearP = 1.0 - smoothstep(0.02, 0.07, px);
          lawnBump += (1.0 - lawn) * (dot(photo, vec3(0.3333)) - 1.0) * 0.0035 * nearP;
          lawnMask = max(lawnMask, (1.0 - lawn) * nearP);` : ''}
          vec3 outC = mix(hard, c, lawn);
          // fallen leaves: drifts where the wind drops them (and under the trees), each a few centimetres of ochre
          float drift = smoothstep(0.52, 0.8, gFbm(vTown * 0.24 + 13.0));
          outC *= 1.0 - 0.05 * drift;
          outC = mix(outC, outC * vec3(1.12, 0.96, 0.76), drift * 0.16);
          if (near1 > 0.0 && drift > 0.05) {
            vec2 lc = vTown / 0.15;
            vec2 li = floor(lc);
            float lh = gHash(li + 41.0);
            if (lh < 0.06 + 0.4 * drift) {
              vec2 lf = fract(lc) - 0.5;
              float a = gHash(li + 7.0) * 6.2832;
              lf = vec2(lf.x * cos(a) - lf.y * sin(a), lf.x * sin(a) + lf.y * cos(a));
              float leaf = 1.0 - smoothstep(0.55, 0.9, length(lf * vec2(1.0, 2.2)) * (1.7 + 1.6 * gHash(li + 3.0)));
              float pick = gHash(li + 17.0);
              vec3 lcol = pick < 0.3 ? vec3(0.33, 0.17, 0.07) : pick < 0.6 ? vec3(0.3, 0.23, 0.09) : pick < 0.85 ? vec3(0.2, 0.15, 0.08) : vec3(0.24, 0.24, 0.08);
              outC = mix(outC, lcol, leaf * near1 * 0.75);
            }
          }
          diffuseColor.rgb = outC;
        }`)
      // the clumps and grain as relief, so the low sun rakes the lawn
      .replace('#include <normal_fragment_maps>', /* glsl */ `#include <normal_fragment_maps>
        if (lawnMask > 0.01) {
          vec3 bx = dFdx(vec3(vTown.x, lawnBump, vTown.y));
          vec3 by = dFdy(vec3(vTown.x, lawnBump, vTown.y));
          // the bump's slope along town x and z, from its screen-space derivatives
          float det = bx.x * by.z - bx.z * by.x;
          if (abs(det) > 1e-9) {
            float gx = (bx.y * by.z - bx.z * by.y) / det;
            float gz = (bx.x * by.y - bx.y * by.x) / det;
            vec3 tx = (viewMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz;
            vec3 tz = (viewMatrix * vec4(0.0, 0.0, 1.0, 0.0)).xyz;
            normal = normalize(normal - (tx * gx + tz * gz) * 0.8 * lawnMask);
          }
        }`);
  };
  const key = material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey = () => `${key()}|lawns`;
}
