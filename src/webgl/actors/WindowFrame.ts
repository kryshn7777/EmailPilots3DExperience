import { BoxGeometry, BufferGeometry, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * CH3: the open window the plane threads on its way out. The frame is four bars and, hung
 * on the side jambs, two casement sashes swung open to the outside. There is NO bar down the
 * middle: the flight line goes through the centre of the opening, and the old centre mullion
 * (a "hinge" post) stood exactly on it, so the dart flew into a dark pole.
 */
export class WindowFrame {
  readonly group = new Group();
  private material = new MeshStandardMaterial({ color: '#2c3348', roughness: 0.6 });
  private glass = new MeshStandardMaterial({
    color: '#9fb8d8', roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.16, depthWrite: false,
  });
  private geometries: BufferGeometry[] = [];

  constructor(anchor: Vector3, size = 3.6) {
    this.group.position.copy(anchor);
    this.group.rotation.y = Math.PI / 2; // sits in the room's window wall

    const SIZE = size;
    const BAR = 0.16;
    const frame: [number, number, number, number, number][] = [
      // [w, h, x, y, z]
      [SIZE, BAR, 0, SIZE / 2, 0],
      [SIZE, BAR, 0, -SIZE / 2, 0],
      [BAR, SIZE, SIZE / 2, 0, 0],
      [BAR, SIZE, -SIZE / 2, 0, 0],
    ];
    // one merged mesh: identical-material bars had no reason to be separate draw calls in a
    // scene that also has to fit a phone's call budget
    const parts = frame.map(([w, h, x, y, z]) => new BoxGeometry(w, h, 0.25).translate(x, y, z));
    const merged = mergeGeometries(parts, false);
    parts.forEach((g) => g.dispose());
    if (merged) {
      this.group.add(new Mesh(merged, this.material));
      this.geometries.push(merged);
    }

    // casement sashes: a thin frame with a glazing bar and a pane, hinged at each jamb and
    // swung out through the opening's plane, clear of the line the dart flies
    const sashW = SIZE / 2 - BAR * 0.9;
    const sashH = SIZE - BAR * 2;
    const T = 0.06;
    const rail = 0.07;
    const sashBars: BufferGeometry[] = [
      new BoxGeometry(sashW, rail, T).translate(-sashW / 2, sashH / 2 - rail / 2, 0),
      new BoxGeometry(sashW, rail, T).translate(-sashW / 2, -sashH / 2 + rail / 2, 0),
      new BoxGeometry(rail, sashH, T).translate(-rail / 2, 0, 0),
      new BoxGeometry(rail, sashH, T).translate(-sashW + rail / 2, 0, 0),
      new BoxGeometry(sashW, rail * 0.7, T * 0.8).translate(-sashW / 2, 0, 0),
      new BoxGeometry(rail * 0.7, sashH, T * 0.8).translate(-sashW / 2, 0, 0),
    ];
    const sashFrame = mergeGeometries(sashBars, false)!;
    sashBars.forEach((g) => g.dispose());
    const pane = new BoxGeometry(sashW - rail, sashH - rail, 0.01).translate(-sashW / 2, 0, 0);
    this.geometries.push(sashFrame, pane);
    for (const side of [1, -1]) {
      const hinge = new Group();
      hinge.position.set(side * (SIZE / 2 - BAR / 2), 0, 0.06);
      // closed, the sash runs from the hinge toward the middle (-x for side 1); open it points out (+z)
      hinge.rotation.y = side * Math.PI * 0.47;
      hinge.scale.x = side; // mirror the sash for the other jamb
      hinge.add(new Mesh(sashFrame, this.material), new Mesh(pane, this.glass));
      this.group.add(hinge);
    }
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    this.material.dispose();
    this.glass.dispose();
  }
}
