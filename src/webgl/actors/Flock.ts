import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Camera,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  MathUtils,
  MeshStandardMaterial,
  Object3D,
  Vector3,
} from 'three';
import { CONTRAIL_FROM } from '../../story/chapters';
import { paperSheetTexture } from '../bake/CanvasTextures';
import { dartGeometry } from './PaperPlane';
import type { FlightPath } from '../rig/FlightPath';

const COUNT = 18;
const TRAIL_PTS = 14;
const TRAIL_STEP = 0.0016; // story-t between trail samples
/** never sample before the takeoff window — the airway must not reach into the room */
const T_MIN = CONTRAIL_FROM;
const T_MAX = 0.965;

interface Mate {
  /** story-t offset from the camera: the mate is always this far up or down the airway */
  dt: number;
  side: number;
  up: number;
  weave: number;
  phase: number;
  scale: number;
}

/**
 * Traffic on the airway: background paper planes riding the same flight line
 * at their own offsets, each dragging its own contrail. Like the hero trail,
 * everything is sampled straight off the path as a function of scroll — no
 * history buffers, so reverse scrub and jump-to-chapter can never smear.
 *
 * One InstancedMesh for every dart and one LineSegments for every trail, so
 * the whole flock is two draw calls. Trails brighten as the camera closes on
 * them; the far ones stay ghosts.
 */
export class Flock {
  readonly group = new Group();
  private mates: Mate[] = [];
  private darts: InstancedMesh;
  private dartGeo = dartGeometry();
  private dartMaterial = new MeshStandardMaterial({
    map: paperSheetTexture(),
    color: '#cdc8bf',
    roughness: 0.85,
    side: DoubleSide,
    emissive: '#585c6a',
    emissiveIntensity: 0.16,
  });
  private trails: LineSegments;
  private trailGeometry = new BufferGeometry();
  private trailPositions: Float32Array;
  private trailColors: Float32Array;
  private dummy = new Object3D();
  private p = new Vector3();
  private prev = new Vector3();
  private dir = new Vector3();
  private side = new Vector3();
  private up = new Vector3();
  private head = new Vector3();
  private worldUp = new Vector3(0, 1, 0);
  private samples: Vector3[] = [];

  constructor(rand: () => number) {
    for (let i = 0; i < COUNT; i++) {
      // spread up and down the airway so some are ahead, some falling behind
      const dt = (i / (COUNT - 1) - 0.5) * 0.11 + (rand() - 0.5) * 0.012;
      this.mates.push({
        dt,
        side: (rand() < 0.5 ? -1 : 1) * (5 + rand() * 26),
        up: (rand() - 0.5) * 14,
        weave: 0.5 + rand() * 1.4,
        phase: rand() * Math.PI * 2,
        scale: 0.55 + rand() * 0.7,
      });
    }

    this.darts = new InstancedMesh(this.dartGeo, this.dartMaterial, COUNT);
    this.darts.frustumCulled = false;
    this.group.add(this.darts);

    const segs = (TRAIL_PTS - 1) * 2 * COUNT;
    this.trailPositions = new Float32Array(segs * 3);
    this.trailColors = new Float32Array(segs * 3);
    this.trailGeometry.setAttribute(
      'position',
      new BufferAttribute(this.trailPositions, 3).setUsage(DynamicDrawUsage),
    );
    this.trailGeometry.setAttribute(
      'color',
      new BufferAttribute(this.trailColors, 3).setUsage(DynamicDrawUsage),
    );
    this.trails = new LineSegments(
      this.trailGeometry,
      new LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.trails.frustumCulled = false;
    this.group.add(this.trails);

    for (let i = 0; i < TRAIL_PTS; i++) this.samples.push(new Vector3());
  }

  update(t: number, time: number, path: FlightPath, camera: Camera): void {
    // out over the world only: inside the room and inside the arrival office
    // there is no airway to fly
    const show = MathUtils.smoothstep(t, 0.155, 0.195) * (1 - MathUtils.smoothstep(t, 0.94, 0.975));
    this.group.visible = show > 0.01;
    if (!this.group.visible) return;

    let v = 0; // write cursor into the trail buffers
    for (let i = 0; i < COUNT; i++) {
      const m = this.mates[i]!;
      const mt = MathUtils.clamp(t + m.dt, T_MIN, T_MAX);

      // walk the mate's own stretch of airway, newest sample first
      for (let s = 0; s < TRAIL_PTS; s++) {
        const st = Math.max(mt - s * TRAIL_STEP, T_MIN);
        path.pointAt(st, this.samples[s]!);
      }
      // path frame at the head, from the first two samples (free vs tangentAt)
      this.dir.copy(this.samples[0]!).sub(this.samples[1]!);
      if (this.dir.lengthSq() < 1e-8) this.dir.set(1, 0, 0);
      this.dir.normalize();
      this.side.crossVectors(this.dir, this.worldUp).normalize();
      this.up.crossVectors(this.side, this.dir).normalize();

      // a slow lateral weave so the flock never reads as rails
      const weaveX = Math.sin(time * m.weave * 0.35 + m.phase) * 2.4;
      const weaveY = Math.cos(time * m.weave * 0.28 + m.phase) * 1.2;
      this.head
        .copy(this.samples[0]!)
        .addScaledVector(this.side, m.side + weaveX)
        .addScaledVector(this.up, m.up + weaveY);

      // the dart flies its own line: +z is the nose
      this.dummy.position.copy(this.head);
      this.dummy.lookAt(this.p.copy(this.head).add(this.dir));
      this.dummy.rotateZ(Math.sin(time * m.weave * 0.35 + m.phase) * 0.45);
      this.dummy.scale.setScalar(m.scale * show);
      this.dummy.updateMatrix();
      this.darts.setMatrixAt(i, this.dummy.matrix);

      // trails fade in as the camera closes: distant traffic stays a ghost
      const near = 1 - MathUtils.smoothstep(this.head.distanceTo(camera.position), 22, 85);
      const bright = near * show * 0.7;

      this.prev.copy(this.head);
      for (let s = 1; s < TRAIL_PTS; s++) {
        // the same lateral offset all the way down, so the trail is the
        // mate's own airway rather than a string dragged toward the hero
        this.p
          .copy(this.samples[s]!)
          .addScaledVector(this.side, m.side + weaveX)
          .addScaledVector(this.up, m.up + weaveY);
        const fadeA = (1 - (s - 1) / (TRAIL_PTS - 1)) * bright;
        const fadeB = (1 - s / (TRAIL_PTS - 1)) * bright;
        this.writeVertex(v++, this.prev, fadeA);
        this.writeVertex(v++, this.p, fadeB);
        this.prev.copy(this.p);
      }
    }
    this.darts.instanceMatrix.needsUpdate = true;
    this.trailGeometry.attributes.position!.needsUpdate = true;
    this.trailGeometry.attributes.color!.needsUpdate = true;
  }

  private writeVertex(index: number, at: Vector3, fade: number): void {
    const o = index * 3;
    this.trailPositions[o] = at.x;
    this.trailPositions[o + 1] = at.y;
    this.trailPositions[o + 2] = at.z;
    this.trailColors[o] = fade;
    this.trailColors[o + 1] = fade;
    this.trailColors[o + 2] = fade;
  }

  dispose(): void {
    this.dartGeo.dispose();
    this.dartMaterial.dispose();
    this.darts.dispose();
    this.trailGeometry.dispose();
    (this.trails.material as LineBasicMaterial).dispose();
  }
}
