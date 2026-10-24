import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  SphereGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ROOM } from './StudyRoom';

/** the study's origin in world space: the Desk is built here, and the window's geometry is in the same local frame */
export const STUDY_ORIGIN = new Vector3(0.4, 1.29, 0);

/**
 * CH3: the window the plane threads on its way out. A casement window set in the study's wall
 * opening: a fixed transom with mullions above, and two casements thrown wide into the room with
 * glazing bars, hinges and cremone bolts. The opening between the open sashes is clear from sill
 * to transom (the dart's line runs through the middle of it), and nothing stands within the
 * camera's hold at the opening (world 6.5, 2.85, 0.9).
 *
 * The constructor's anchor is the old wall-centre reference; the opening itself comes from the
 * study's ROOM constants so the frame, the casing and the wall can never disagree.
 */
export class WindowFrame {
  readonly group = new Group();
  private paint = new MeshStandardMaterial({ color: '#eae3d0', roughness: 0.34, envMapIntensity: 1 });
  private brass = new MeshStandardMaterial({ color: '#c09a5e', roughness: 0.3, metalness: 1, envMapIntensity: 1.2 });
  private glass = new MeshStandardMaterial({
    color: '#cfe3ee', transparent: true, opacity: 0.1, roughness: 0.04, envMapIntensity: 1.6, depthWrite: false, side: DoubleSide,
  });
  private geometries: BufferGeometry[] = [];

  constructor(_anchor: Vector3) {
    this.group.position.copy(STUDY_ORIGIN);
    const { winZ0, winZ1, winY0, winY1 } = ROOM;
    const X = ROOM.x1 + 0.1; // the frame sits in the middle of the wall's thickness
    const sashL = (winZ1 - winZ0) / 2 - 0.03;
    const transomY = 2.95;
    const sashH = transomY - winY0 - 0.06;

    const parts = new Map<MeshStandardMaterial, BufferGeometry[]>();
    const add = (g: BufferGeometry, m: MeshStandardMaterial, mat: Matrix4): void => {
      g.applyMatrix4(mat);
      const list = parts.get(m);
      if (list) list.push(g);
      else parts.set(m, [g]);
    };
    const T = (x: number, y: number, z: number): Matrix4 => new Matrix4().makeTranslation(x, y, z);

    /** one casement in its own frame: hinge on the y axis at the origin, running along `dir` * z, standing on y = 0 */
    const sash = (dir: 1 | -1, add2: (g: BufferGeometry, m: MeshStandardMaterial, mat: Matrix4) => void): void => {
      const d = 0.07;
      const stile = 0.075;
      const rail = 0.09;
      const Z = (z: number): number => dir * z;
      for (const z of [stile / 2, sashL - stile / 2]) add2(new BoxGeometry(d, sashH, stile), this.paint, T(0, sashH / 2, Z(z)));
      for (const y of [rail / 2, sashH - rail / 2]) add2(new BoxGeometry(d, rail, sashL), this.paint, T(0, y, Z(sashL / 2)));
      // glazing bars dividing the lights into small panes
      const bars = 0.026;
      for (let i = 1; i < 3; i++) add2(new BoxGeometry(0.04, sashH - 2 * rail, bars), this.paint, T(0, sashH / 2, Z((sashL / 3) * i)));
      for (let i = 1; i < 5; i++) add2(new BoxGeometry(0.04, bars, sashL - 2 * stile), this.paint, T(0, rail + ((sashH - 2 * rail) / 5) * i, Z(sashL / 2)));
      add2(new PlaneGeometry(sashL - 2 * stile, sashH - 2 * rail).rotateY(Math.PI / 2), this.glass, T(0, sashH / 2, Z(sashL / 2)));
      // hinges on the hung stile, a cremone bolt and knob on the free one
      for (const y of [0.3, sashH - 0.3]) add2(new BoxGeometry(0.085, 0.12, 0.018), this.brass, T(0, y, 0.0));
      add2(new CylinderGeometry(0.008, 0.008, sashH * 0.55, 6), this.brass, T(-d / 2 - 0.012, sashH * 0.5, Z(sashL - stile / 2)));
      add2(new SphereGeometry(0.024, 8, 6), this.brass, T(-d / 2 - 0.03, sashH * 0.5, Z(sashL - stile / 2)));
      add2(new BoxGeometry(0.012, 0.1, 0.03), this.brass, T(-d / 2 - 0.01, sashH * 0.5, Z(sashL - stile / 2)));
    };

    // the casements, thrown open into the room (the free edges swing away from the opening's centre)
    const open = (Math.PI * 115) / 180;
    for (const side of [-1, 1] as const) {
      const hingeZ = side < 0 ? winZ0 + 0.03 : winZ1 - 0.03;
      const place = T(X, winY0 + 0.04, hingeZ).multiply(new Matrix4().makeRotationY(side < 0 ? -open : open));
      sash(side < 0 ? 1 : -1, (g, m, mat) => add(g, m, mat.premultiply(place)));
    }

    // the fixed transom: a rail, mullions and small lights above it
    add(new BoxGeometry(0.1, 0.1, winZ1 - winZ0), this.paint, T(X, transomY + 0.05, (winZ0 + winZ1) / 2));
    add(new BoxGeometry(0.07, 0.03, winZ1 - winZ0), this.paint, T(X, winY0 + 0.015, (winZ0 + winZ1) / 2));
    const mullions = 3;
    for (let i = 1; i <= mullions; i++) {
      const z = winZ0 + ((winZ1 - winZ0) / (mullions + 1)) * i;
      add(new BoxGeometry(0.075, winY1 - transomY - 0.1, 0.06), this.paint, T(X, (transomY + 0.1 + winY1) / 2, z));
    }
    add(new BoxGeometry(0.04, 0.026, winZ1 - winZ0), this.paint, T(X, (transomY + 0.1 + winY1) / 2, (winZ0 + winZ1) / 2));
    add(new PlaneGeometry(winZ1 - winZ0, winY1 - transomY - 0.1).rotateY(Math.PI / 2), this.glass, T(X, (transomY + 0.1 + winY1) / 2, (winZ0 + winZ1) / 2));
    // a brass stay on the sill for each sash
    for (const z of [winZ0 + 0.5, winZ1 - 0.5]) add(new BoxGeometry(0.1, 0.012, 0.03), this.brass, T(X - 0.08, winY0 + 0.01, z));

    // one merged mesh per material: the whole window is three draws
    for (const [material, list] of parts) {
      const merged = mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)), false);
      list.forEach((g) => g.dispose());
      if (!merged) continue;
      const mesh = new Mesh(merged, material);
      mesh.castShadow = material !== this.glass;
      this.group.add(mesh);
      this.geometries.push(merged);
    }
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    this.paint.dispose();
    this.brass.dispose();
    this.glass.dispose();
  }
}
