import type { MeshStandardMaterial, Texture, WebGLProgramParametersWithUniforms } from 'three';
import { METRES_PER_UNIT, NOISE } from './glsl';

/**
 * The night city's towers and blocks come out of one baked atlas, so every tower that shares a module is the
 * same clean shell. This is what a real facade does to itself, in world coordinates (metres), on the wall
 * texels only (picked by the baked roughness: glass and metal are glossy, concrete and brick are not):
 *
 * - every building its own upkeep (`dirtK` from the instance's position): scrubbed, lived-in or neglected;
 * - soot and road grime up the first storeys, in blotches along the wall rather than a line;
 * - rain streaks running down the wall, longer on the dirtier buildings;
 * - panels and sections a shade off the rest, a slow mottle over the whole face;
 * - HIGH: a photographed concrete grain, offset by its own height (parallax) and lit as relief.
 *
 * Phones keep the grime, streaks and mottle (a few noise calls) and skip the photograph.
 */
export function applyFacades(material: MeshStandardMaterial, fine: boolean, wall?: Texture): void {
  const photo = fine && !!wall;
  const M = METRES_PER_UNIT.toFixed(2);
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms, renderer) => {
    previous.call(material, shader, renderer);
    if (photo) shader.uniforms.uFWall = { value: wall };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFP;\nvarying vec3 vFN;\nvarying vec2 vFL;')
      .replace('#include <begin_vertex>', /* glsl */ `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vFP = (instanceMatrix * vec4(position, 1.0)).xyz;
          vFL = instanceMatrix[3].xz;
          vFN = mat3(instanceMatrix) * normal;
        #else
          vFP = position;
          vFL = vec2(0.0);
          vFN = normal;
        #endif`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', /* glsl */ `#include <common>
        varying vec3 vFP;
        varying vec3 vFN;
        varying vec2 vFL;
        ${photo ? 'uniform sampler2D uFWall;' : ''}
        ${NOISE}
        vec2 facadeGrad = vec2(0.0);`)
      .replace('#include <metalnessmap_fragment>', /* glsl */ `#include <metalnessmap_fragment>
        {
          vec3 fn = normalize(vFN);
          float wallK = (1.0 - smoothstep(0.35, 0.6, abs(fn.y))) * smoothstep(0.55, 0.8, roughnessFactor) * (1.0 - metalnessFactor);
          if (wallK > 0.0) {
            // walls run along x or z: x + z is the way along any of them
            vec2 w = vec2((vFP.x + vFP.z) * ${M}, vFP.y * ${M});
            vec2 lot = floor(vFL * 0.5 + 0.5);
            float dirtK = 0.25 + 1.55 * nHash(lot * 0.37 + 2.1);
            vec3 c = diffuseColor.rgb;
            // a slow mottle and a tint of its own per building
            c *= 0.86 + 0.28 * nFbm(w * 0.09 + lot);
            c *= mix(vec3(1.0), vec3(1.05, 1.0, 0.93), nHash(lot + 3.0));
            // soot and road grime up the first storeys, thickest in the worn stretches
            float soot = (1.0 - smoothstep(1.0, 9.0, w.y)) * (0.45 + 0.55 * nFbm(vec2(w.x * 0.7, w.y * 0.25) + lot));
            c *= 1.0 - 0.4 * soot * (0.4 + 0.6 * dirtK);
            c = mix(c, c * vec3(0.92, 0.88, 0.8), soot * 0.4);
            // rain streaks running down the wall, longer where it is dirtier
            float st = nNoise(vec2(w.x * 2.2, w.y * (0.05 + 0.04 * (1.0 - dirtK * 0.4))) + lot * 1.3);
            float streak = smoothstep(0.62, 0.92, st) * (0.5 + 0.5 * nNoise(vec2(w.x * 0.4, w.y * 0.03) + lot));
            c *= 1.0 - (0.06 + 0.2 * dirtK) * streak;
            // a repainted or patched section, squared off, a shade off the rest
            vec2 pc = floor(w / vec2(6.0, 5.0) + lot * 2.3);
            if (nHash(pc + 9.7) < 0.1) {
              vec2 pf = fract(w / vec2(6.0, 5.0) + lot * 2.3);
              vec2 po = vec2(0.1 + 0.2 * nHash(pc + 1.3), 0.1 + 0.25 * nHash(pc + 2.9));
              vec2 pe = vec2(0.4 + 0.45 * nHash(pc + 4.1), 0.4 + 0.45 * nHash(pc + 5.3));
              float inP = step(po.x, pf.x) * step(po.y, pf.y) * step(pf.x, po.x + pe.x) * step(pf.y, po.y + pe.y);
              c *= mix(1.0, 0.88 + 0.22 * nHash(pc + 6.1), inP);
            }
            ${photo ? /* glsl */ `
            // photographed grain, offset by its own height so it holds depth as the camera moves
            float px = max(fwidth(w.x), fwidth(w.y));
            float vis = 1.0 - smoothstep(0.06, 0.2, px);
            if (vis > 0.0) {
              vec3 Nv = normalize((viewMatrix * vec4(fn, 0.0)).xyz);
              vec2 pdw = nParaDir(w, Nv);
              float hh = dot(texture2D(uFWall, w / 1.3).rgb, vec3(0.3333));
              vec2 wp = w + pdw * (1.0 - hh) * 0.03;
              vec3 p1 = texture2D(uFWall, wp / 1.3).rgb;
              vec3 p2 = texture2D(uFWall, vec2(wp.y, -wp.x) / 1.3 * 0.43 + 0.21).rgb;
              c *= mix(vec3(1.0), mix(p1, p2, 0.4) * 2.0, 0.5 * vis);
              float h0 = dot(p1, vec3(0.3333));
              float hx = dot(texture2D(uFWall, wp / 1.3 + vec2(0.006, 0.0)).rgb, vec3(0.3333));
              float hy = dot(texture2D(uFWall, wp / 1.3 + vec2(0.0, 0.006)).rgb, vec3(0.3333));
              facadeGrad = vec2(hx - h0, hy - h0) * 5.0 * vis * wallK;
            }` : ''}
            diffuseColor.rgb = mix(diffuseColor.rgb, c, wallK);
          }
        }`)
      .replace('#include <normal_fragment_maps>', /* glsl */ `#include <normal_fragment_maps>
        ${photo ? /* glsl */ `
        if (dot(facadeGrad, facadeGrad) > 0.0) {
          vec3 upV = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
          vec3 alongV = normalize(cross(upV, normal));
          normal = normalize(normal - alongV * facadeGrad.x - upV * facadeGrad.y);
        }` : ''}`);
  };
  const key = material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey = () => `${key()}|facades-${fine ? 'fine' : 'lean'}${photo ? '-photo' : ''}`;
}
