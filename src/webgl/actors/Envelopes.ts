import {
  BoxGeometry,
  BufferGeometry,
  Camera,
  Float32BufferAttribute,
  Group,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Raycast } from '../interact/Raycast';
import type { Tooltip } from '../interact/Tooltip';

/** Envelope body + raised V-flap on top — reads as mail, not as a slab. */
function envelopeGeometry(): BufferGeometry {
  const body = new BoxGeometry(0.55, 0.05, 0.38).toNonIndexed();
  const flap = new BufferGeometry();
  // two triangles meeting at a slightly lifted center ridge
  const y = 0.026;
  const ridgeY = 0.085;
  flap.setAttribute(
    'position',
    new Float32BufferAttribute(
      [
        -0.275, y, -0.19, 0.275, y, -0.19, 0, ridgeY, 0.02,
        0.275, y, 0.19, -0.275, y, 0.19, 0, ridgeY, 0.02,
      ],
      3,
    ),
  );
  flap.setAttribute('uv', new Float32BufferAttribute(new Float32Array(12), 2));
  flap.computeVertexNormals();
  const merged = mergeGeometries([body, flap], false);
  body.dispose();
  flap.dispose();
  return merged ?? body;
}

const COUNT = 5;
const SHOW_FROM = 0.2;
const SHOW_TO = 0.46; // escort peels away before the beacon — CH6 is the plane alone

/**
 * CH4: the escort — five envelopes flying V-formation off the plane's wing,
 * one per sequence step. Hovering one raises it and shows the HUD tooltip
 * ("Step N · waits · cancels on reply").
 */
export class Envelopes {
  private static readonly FORWARD = new Vector3(0, 0, 1);
  readonly group = new Group();
  private meshes: Mesh[] = [];
  private materials: MeshStandardMaterial[] = [];
  private geometry = envelopeGeometry();
  private hoveredIndex = -1;
  private worldPos = new Vector3();

  constructor(raycast: Raycast, private tooltip: Tooltip) {
    for (let i = 0; i < COUNT; i++) {
      const material = new MeshStandardMaterial({
        color: '#f2ecdc',
        emissive: '#ffd9a0',
        emissiveIntensity: 0.55, // lit paper — at 0 they flew as backlit gray slabs
        roughness: 0.7,
      });
      const mesh = new Mesh(this.geometry, material);
      this.group.add(mesh);
      this.meshes.push(mesh);
      this.materials.push(material);
      raycast.register({
        object: mesh,
        onEnter: () => {
          this.hoveredIndex = i;
          this.tooltip.show(`STEP ${i + 1} · WAITS ${i + 2} DAYS · CANCELS ON REPLY`);
        },
        onLeave: () => {
          if (this.hoveredIndex === i) this.hoveredIndex = -1;
          this.tooltip.hide();
        },
      });
    }
  }

  update(planePos: Vector3, side: Vector3, tangent: Vector3, t: number, time: number, camera: Camera): void {
    const fadeIn = MathUtils.smoothstep(t, SHOW_FROM, SHOW_FROM + 0.06);
    const fadeOut = 1 - MathUtils.smoothstep(t, SHOW_TO - 0.03, SHOW_TO);
    this.group.visible = Math.min(fadeIn, fadeOut) > 0.01;
    if (!this.group.visible) return;

    for (let i = 0; i < COUNT; i++) {
      const mesh = this.meshes[i]!;
      const rank = i + 1;
      const lateral = (i % 2 === 0 ? 1 : -1) * Math.ceil(rank / 2) * 1.1;
      const back = Math.ceil(rank / 2) * 1.4;
      const bob = Math.sin(time * 1.3 + i * 1.9) * 0.12;
      const lift = this.hoveredIndex === i ? 0.35 : 0;
      // staggered join: each one climbs into its slot from the cloud deck
      // behind — no more slabs popping into existence beside the plane
      const join = MathUtils.smoothstep(t, SHOW_FROM + i * 0.01, SHOW_FROM + i * 0.01 + 0.05);

      mesh.position
        .copy(planePos)
        .addScaledVector(tangent, -back - (1 - join) * 7)
        .addScaledVector(side, lateral * (0.4 + 0.6 * join));
      mesh.position.y += -0.2 + bob + lift - (1 - join) * 3.4;
      mesh.quaternion.setFromUnitVectors(Envelopes.FORWARD, tangent);
      mesh.rotateZ((1 - join) * (i % 2 === 0 ? 0.7 : -0.7)); // banking in
      mesh.scale.setScalar(fadeOut * (0.35 + 0.65 * join));

      const target = this.hoveredIndex === i ? 1.6 : 0.55;
      const m = this.materials[i]!;
      m.emissiveIntensity += (target - m.emissiveIntensity) * 0.2;
    }

    // tooltip follows the hovered envelope in screen space
    if (this.hoveredIndex >= 0) {
      this.worldPos.setFromMatrixPosition(this.meshes[this.hoveredIndex]!.matrixWorld);
      this.tooltip.pin(this.worldPos, camera);
    }
  }

  dispose(): void {
    this.geometry.dispose();
    for (const m of this.materials) m.dispose();
  }
}
