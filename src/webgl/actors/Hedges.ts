import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from 'three';
import type { WebGLProgramParametersWithUniforms } from 'three';
import { CITY_SEED, HOME_CELL, HOME_CELLS, fenceRuns } from '../bake/cityGen.mjs';
import { mulberry32 } from '../util';
import { requestCompile } from '../warm';

/** clipped greens: box, privet, laurel, yew */
const GREENS = ['#2f5a2a', '#3a6a2e', '#2a4e2c', '#456f34', '#355f3a', '#4d7a35', '#24432a', '#3f6440'];

/**
 * A clipped hedge: a box with a rounded crown, a metre-ish wide in site units of one, lying along x
 * from -0.5 to 0.5, standing on y = 0. Instances stretch it to their run.
 */
function hedgeGeometry(): BufferGeometry {
  // profile across the hedge (z, y), base to crown to base
  const prof: [number, number][] = [
    [-0.5, 0], [-0.5, 0.62], [-0.46, 0.84], [-0.33, 0.96], [-0.12, 1.0],
    [0.12, 1.0], [0.33, 0.96], [0.46, 0.84], [0.5, 0.62], [0.5, 0],
  ];
  const pos: number[] = [];
  const nrm: number[] = [];
  // smooth normals round the crown, from the profile's neighbours
  const pn = prof.map((_, i) => {
    const a = prof[Math.max(i - 1, 0)]!, b = prof[Math.min(i + 1, prof.length - 1)]!;
    const dz = b[0] - a[0], dy = b[1] - a[1];
    const l = Math.hypot(dz, dy) || 1;
    return [-dy / l, dz / l] as [number, number]; // outward (z, y)
  });
  for (let i = 0; i < prof.length - 1; i++) {
    const [z0, y0] = prof[i]!, [z1, y1] = prof[i + 1]!;
    const [nz0, ny0] = pn[i]!, [nz1, ny1] = pn[i + 1]!;
    const quad: [number, number, number, number, number, number][] = [
      [-0.5, y0, z0, 0, ny0, nz0], [0.5, y0, z0, 0, ny0, nz0], [0.5, y1, z1, 0, ny1, nz1],
      [-0.5, y0, z0, 0, ny0, nz0], [0.5, y1, z1, 0, ny1, nz1], [-0.5, y1, z1, 0, ny1, nz1],
    ];
    // wound so the outside faces out (profile runs -z to +z over the top)
    for (const k of [0, 2, 1, 3, 5, 4]) {
      const v = quad[k]!;
      pos.push(v[0], v[1], v[2]);
      nrm.push(v[3], v[4], v[5]);
    }
  }
  // end caps: a fan from the profile's centre
  for (const x of [-0.5, 0.5]) {
    const s = Math.sign(x);
    for (let i = 0; i < prof.length - 1; i++) {
      const [z0, y0] = prof[i]!, [z1, y1] = prof[i + 1]!;
      const tri = s > 0 ? [[0, 0.5], [z0, y0], [z1, y1]] : [[0, 0.5], [z1, y1], [z0, y0]];
      for (const [z, y] of tri) {
        pos.push(x, y!, z!);
        nrm.push(s, 0, 0);
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(nrm, 3));
  return g;
}

/**
 * Hedges along the lot lines that have no fence, all over town: from the plane they draw the
 * property lines in dark green, the structure a real suburb has from the air and a lawn board
 * lacks. One instanced mesh (a few hundred hedges, 60 triangles each); the leafy surface is shader
 * noise in town coordinates, so a long hedge is not one stretched texture. Fences and hedges come
 * from streams of their own, so no house or tree moves.
 */
export class Hedges {
  readonly group = new Group();
  private disposables: { dispose(): void }[] = [];

  constructor(tier: 'high' | 'low') {
    const { w, d, lotW, lots: perRow, lotD, street } = HOME_CELL;
    const rand = mulberry32(CITY_SEED + 4409);
    const fenced = new Set(fenceRuns().map((r) => `${r.x0.toFixed(2)},${r.z0.toFixed(2)},${r.x1.toFixed(2)},${r.z1.toFixed(2)}`));
    const hedges: { x: number; z: number; len: number; yaw: number; h: number; t: number; color: string }[] = [];
    const add = (x0: number, z0: number, x1: number, z1: number, h: number, t: number): void => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      if (len < 0.8) return;
      hedges.push({
        x: (x0 + x1) / 2, z: (z0 + z1) / 2, len, yaw: Math.atan2(-(z1 - z0), x1 - x0), h, t,
        color: GREENS[Math.floor(rand() * GREENS.length)]!,
      });
    };
    for (let iz = HOME_CELLS.z[0]; iz < HOME_CELLS.z[1]; iz++) {
      for (let ix = HOME_CELLS.x[0]; ix < HOME_CELLS.x[1]; ix++) {
        for (const row of [0, 1]) {
          const zRow = iz * d + (row === 0 ? 0 : lotD + street);
          const front = row === 0 ? zRow + lotD : zRow;
          const toStreet = row === 0 ? 1 : -1;
          const rear = front - toStreet * lotD;
          const sideEnd = front - toStreet * 3.4;
          for (let k = 0; k <= perRow; k++) {
            const x = ix * w + k * lotW;
            const key = `${x.toFixed(2)},${rear.toFixed(2)},${x.toFixed(2)},${sideEnd.toFixed(2)}`;
            const roll = rand();
            if (fenced.has(key) || roll > 0.55) continue;
            // down the line from the back fence, sometimes stopping short, now and then all the way
            const reach = roll < 0.12 ? lotD - 0.6 : (lotD - 3.4) * (0.55 + rand() * 0.45);
            add(x, rear + toStreet * 0.15, x, rear + toStreet * reach, 0.42 + rand() * 0.25, 0.32 + rand() * 0.12);
          }
          for (let k = 0; k < perRow; k++) {
            const x0 = ix * w + k * lotW;
            const key = `${x0.toFixed(2)},${rear.toFixed(2)},${(x0 + lotW).toFixed(2)},${rear.toFixed(2)}`;
            const roll = rand();
            if (!fenced.has(key) && roll < 0.6) {
              add(x0 + 0.15, rear + toStreet * 0.2, x0 + lotW - 0.15, rear + toStreet * 0.2, 0.5 + rand() * 0.3, 0.36 + rand() * 0.14);
            }
            // a low clipped hedge along part of the front lawn, clear of the walk
            if (rand() < 0.14) {
              const zf = front - toStreet * 0.3;
              const side = rand() < 0.5 ? -1 : 1;
              const cx = x0 + lotW / 2;
              add(cx + side * 0.75, zf, cx + side * (lotW / 2 - 0.2), zf, 0.2 + rand() * 0.08, 0.22);
            }
          }
        }
      }
    }

    const geometry = hedgeGeometry();
    const material = new MeshStandardMaterial({ color: '#ffffff', roughness: 0.92, metalness: 0 });
    material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vHedge;\nvarying float vHedgeY;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vHedgeY = position.y;
          {
            #ifdef USE_INSTANCING
              vHedge = (instanceMatrix * vec4(position, 1.0)).xyz;
            #else
              vHedge = position;
            #endif
            // a hedge is never ruler-straight: the crown and sides bulge a little along the run
            float bulge = sin(vHedge.x * 3.1 + vHedge.z * 2.3) * 0.5 + sin(vHedge.x * 7.7 - vHedge.z * 6.1) * 0.25;
            transformed.z *= 1.0 + 0.12 * bulge * step(0.01, position.y);
            transformed.y *= 1.0 + 0.06 * bulge * step(0.5, position.y);
          }`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 vHedge;
          varying float vHedgeY;
          float hHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
          float hNoise(vec3 x) {
            vec3 i = floor(x), f = fract(x);
            f = f * f * (3.0 - 2.0 * f);
            return mix(mix(mix(hHash(i), hHash(i + vec3(1, 0, 0)), f.x), mix(hHash(i + vec3(0, 1, 0)), hHash(i + vec3(1, 1, 0)), f.x), f.y),
                       mix(mix(hHash(i + vec3(0, 0, 1)), hHash(i + vec3(1, 0, 1)), f.x), mix(hHash(i + vec3(0, 1, 1)), hHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
          }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          {
            float leaf = hNoise(vHedge * 14.0) * 0.6 + hNoise(vHedge * 37.0) * 0.4;
            float clump = hNoise(vHedge * 3.2);
            // dense shadowed foot, sunlit fresh growth on the crown
            float foot = 0.45 + 0.55 * smoothstep(0.0, 0.7, vHedgeY);
            diffuseColor.rgb *= foot * (0.7 + 0.55 * leaf) * (0.85 + 0.3 * clump);
            diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.25, 1.3, 0.85), smoothstep(0.85, 1.0, vHedgeY) * 0.5);
          }`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          {
            vec3 q = vHedge * 22.0;
            float e = 0.35;
            vec3 gr = vec3(hNoise(q + vec3(e, 0, 0)) - hNoise(q - vec3(e, 0, 0)),
                           hNoise(q + vec3(0, e, 0)) - hNoise(q - vec3(0, e, 0)),
                           hNoise(q + vec3(0, 0, e)) - hNoise(q - vec3(0, 0, e)));
            normal = normalize(normal - (viewMatrix * vec4(gr, 0.0)).xyz * 0.9);
          }`);
    };
    material.customProgramCacheKey = () => 'town-hedges';

    const inst = new InstancedMesh(geometry, material, hedges.length);
    const m4 = new Matrix4(), q = new Quaternion(), p = new Vector3(), s = new Vector3(), Y = new Vector3(0, 1, 0);
    const c = new Color();
    hedges.forEach((hd, i) => {
      q.setFromAxisAngle(Y, hd.yaw);
      inst.setMatrixAt(i, m4.compose(p.set(hd.x, 0, hd.z), q, s.set(hd.len, hd.h, hd.t)));
      inst.setColorAt(i, c.set(hd.color));
    });
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    inst.castShadow = inst.receiveShadow = tier === 'high';
    this.group.add(inst);
    this.disposables.push(geometry, material, inst);
    requestCompile(inst);
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
