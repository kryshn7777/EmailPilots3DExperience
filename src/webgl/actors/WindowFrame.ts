import { BoxGeometry, BufferGeometry, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * CH3: the open window the plane threads on its way out — a simple frame
 * silhouette that wipes across the lens at takeoff.
 */
export class WindowFrame {
  readonly group = new Group();
  private material = new MeshStandardMaterial({ color: '#2c3348', roughness: 0.6 });
  private geometries: BufferGeometry[] = [];

  constructor(anchor: Vector3, size = 3.6) {
    this.group.position.copy(anchor);
    this.group.rotation.y = Math.PI / 2; // sits in the room's window wall

    const SIZE = size;
    const BAR = 0.16;
    const bars: [number, number, number, number, number][] = [
      // [w, h, x, y, z]
      [SIZE, BAR, 0, SIZE / 2, 0],
      [SIZE, BAR, 0, -SIZE / 2, 0],
      [BAR, SIZE, SIZE / 2, 0, 0],
      [BAR, SIZE, -SIZE / 2, 0, 0],
      [BAR * 0.6, SIZE, 0, 0, 0], // center mullion
    ];
    // one merged mesh: five identical-material bars had no reason to be five
    // draw calls in a scene that also has to fit a phone's call budget
    const parts = bars.map(([w, h, x, y, z]) =>
      new BoxGeometry(w, h, 0.25).translate(x, y, z),
    );
    const merged = mergeGeometries(parts, false);
    parts.forEach((g) => g.dispose());
    if (merged) {
      this.group.add(new Mesh(merged, this.material));
      this.geometries.push(merged);
    }
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    this.material.dispose();
  }
}
