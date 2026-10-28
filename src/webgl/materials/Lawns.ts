import type { MeshStandardMaterial, WebGLProgramParametersWithUniforms } from 'three';
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
 * - the asphalt and pavements get repairs and wear at the same scales.
 *
 * Coordinates are the town's (group-local x/z), from the plane's own vertex positions.
 */
export function applyLawns(material: MeshStandardMaterial, origin: Vector2): void {
  const { w, d, lotW, lots, lotD, street } = HOME_CELL;
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms, renderer) => {
    previous.call(material, shader, renderer);
    shader.uniforms.uLawnOrigin = { value: origin };
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
        float lawnBump = 0.0;
        float lawnMask = 0.0;`)
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
          // a height in town units: clumps a few centimetres high, the grain a few millimetres
          lawnBump = lawn * (near1 * 0.03 * (clump - 0.5) + near2 * 0.004 * (grain - 0.5));
          lawnMask = lawn * max(near1, near2);
          // hard surfaces: patched asphalt, stained and newer slabs
          vec3 hard = g * (0.9 + 0.2 * gFbm(vTown * 0.45 + 7.0)) * (0.94 + 0.12 * macro);
          // up close the paving and asphalt are speckled too, not one flat tone
          hard *= mix(1.0, 0.86 + 0.28 * gNoise(vTown * 55.0), near1);
          diffuseColor.rgb = mix(hard, c, lawn);
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
