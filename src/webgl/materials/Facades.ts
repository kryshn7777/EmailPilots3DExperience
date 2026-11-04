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
 * - lit windows get a room behind them (interior mapping) on any wall that carries the kit's window-cell grid
 *   (`uv1`, exported by blender/bld/model.py: whole numbers are the floor slabs and piers, so each room lines up
 *   with the window the facade generator placed): ceiling lamp, floor, side and back walls, and on HIGH furniture,
 *   shelves, pictures and the odd person or television, each room its own; the baked colour of the window
 *   (warm, cool, white) tints it, so the skyline keeps its mix of light.
 *
 * Phones keep the grime, streaks, mottle and the plain rooms, and skip the photograph and the furniture.
 */
export function applyFacades(material: MeshStandardMaterial, fine: boolean, wall?: Texture): void {
  const photo = fine && !!wall;
  const M = METRES_PER_UNIT.toFixed(2);
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms, renderer) => {
    previous.call(material, shader, renderer);
    if (photo) shader.uniforms.uFWall = { value: wall };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vFP;
        varying vec3 vFN;
        varying vec2 vFL;
        varying vec2 vGrid;
        #ifndef USE_UV1
        attribute vec2 uv1;
        #endif`)
      .replace('#include <begin_vertex>', /* glsl */ `#include <begin_vertex>
        vGrid = uv1;
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
        varying vec2 vGrid;
        ${photo ? 'uniform sampler2D uFWall;' : ''}
        ${NOISE}
        vec2 facadeGrad = vec2(0.0);
        /**
         * The room behind a lit window cell, as radiance relative to the window's baked brightness (about 1 on average).
         * p0: position in the cell (x across the bay, y up the storey); s: cells moved per full room depth along the
         * view ray; id: this room's identity. The room is a box: lamp on the ceiling, floor, two side walls, back wall.
         */
        vec3 roomShade(vec2 p0, vec2 s, vec2 id, float vis) {
          float h0 = nHash(id + 0.31), h1 = nHash(id + 5.77), h2 = nHash(id + 11.13), h3 = nHash(id + 19.7), h4 = nHash(id + 27.1);
          float tx = s.x > 1e-4 ? (1.0 - p0.x) / s.x : s.x < -1e-4 ? -p0.x / s.x : 1e9;
          float ty = s.y > 1e-4 ? (1.0 - p0.y) / s.y : s.y < -1e-4 ? -p0.y / s.y : 1e9;
          float zt = min(1.0, min(tx, ty));
          vec2 hp = p0 + s * zt;                       // where the ray lands, in cell coordinates
          vec3 P = vec3(hp, zt);                       // x across, y up, z into the room
          // what it lands on
          float back = step(1.0, zt + 1e-4);
          float side = (1.0 - back) * step(tx, ty);
          float floorOrCeil = (1.0 - back) * (1.0 - side);
          vec3 wall = mix(vec3(0.86, 0.8, 0.7), vec3(0.62, 0.7, 0.78), h0);
          wall = mix(wall, vec3(0.78, 0.62, 0.55), step(0.78, h1) * 0.8);
          vec3 col = wall;
          if (floorOrCeil > 0.5) col = hp.y < 0.5 ? mix(vec3(0.34, 0.22, 0.13), vec3(0.28, 0.28, 0.3), step(0.5, h2)) : vec3(0.9, 0.9, 0.88);
          else if (side > 0.5) col *= 0.72;
          ${fine ? /* glsl */ `
          if (back > 0.5 && vis > 0.0) {
            // furniture on the back wall: a cabinet or bed, a shelf, a picture, now and then someone standing
            float fx = 0.1 + 0.45 * h2;
            float cab = step(fx, hp.x) * step(hp.x, fx + 0.34 + 0.12 * h3) * step(hp.y, 0.22 + 0.2 * h4);
            col = mix(col, vec3(0.25, 0.17, 0.11) * (0.7 + 0.6 * h3), cab * vis);
            float shelf = step(0.46 + 0.1 * h1, hp.y) * step(hp.y, 0.49 + 0.1 * h1) * step(0.12, hp.x) * step(hp.x, 0.88);
            col = mix(col, vec3(0.3, 0.2, 0.12), shelf * step(0.4, h3) * vis);
            float pic = step(0.55, hp.x) * step(hp.x, 0.78) * step(0.55, hp.y) * step(hp.y, 0.82) * step(0.5, h4);
            col = mix(col, mix(vec3(0.7, 0.3, 0.25), vec3(0.2, 0.4, 0.6), h0), pic * 0.8 * vis);
            vec2 q = (hp - vec2(0.2 + 0.6 * h4, 0.3)) * vec2(1.0, 0.8);
            float person = step(0.82, h0) * (1.0 - smoothstep(0.1, 0.14, length(q * vec2(1.9, 1.0)))) ;
            float head = step(0.82, h0) * (1.0 - smoothstep(0.045, 0.06, length(hp - vec2(0.2 + 0.6 * h4, 0.58))));
            col = mix(col, vec3(0.06, 0.05, 0.05), max(person, head) * vis);
          }` : ''}
          // light: a lamp in the ceiling, falling off with the square of the distance
          vec3 lamp = vec3(0.5 + 0.3 * (h1 - 0.5), 1.0, 0.5);
          vec3 d = lamp - P;
          float lit = 1.6 / (0.55 + dot(d, d) * 2.4);
          // some rooms run on a television or a desk lamp instead
          vec3 tintRoom = h4 < 0.1 ? vec3(0.55, 0.7, 1.0) : h3 > 0.9 ? vec3(1.0, 0.82, 0.6) : vec3(1.0);
          return col * lit * tintRoom * 1.25;
        }`)
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
      .replace('#include <emissivemap_fragment>', /* glsl */ `#include <emissivemap_fragment>
        {
          // a lit window on a wall that carries the window-cell grid: draw the room behind it
          float eL = dot(totalEmissiveRadiance, vec3(0.2126, 0.7152, 0.0722));
          float gw = fwidth(vGrid.x) + fwidth(vGrid.y);
          if (eL > 0.08 && vGrid.x > -0.5 && gw > 1e-6) {
            // a room a few pixels wide is only an average of itself: fade to it
            float vis = 1.0 - smoothstep(0.03, 0.12, max(fwidth(vGrid.x), fwidth(vGrid.y)));
            vec3 ps = nParaCell(vGrid, normalize(nonPerturbedNormal));
            if (ps.z > 0.0) {
              vec2 p0 = fract(vGrid);
              vec2 id = floor(vGrid) + floor(vFL * 0.5 + 0.5) * 0.37;
              // 1.15 cells deep, and the ray may not leave the cell sideways more than it can see
              vec3 rad = roomShade(p0, clamp(ps.xy * ps.z * 1.15, vec2(-3.0), vec2(3.0)), id, vis);
              float sh = dot(rad, vec3(0.3333));
              vec3 room = totalEmissiveRadiance * sh * mix(vec3(1.0), rad / max(sh, 1e-3), 0.4);
              totalEmissiveRadiance = mix(totalEmissiveRadiance, room, vis);
            }
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
