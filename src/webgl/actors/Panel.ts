import { BoxGeometry, CircleGeometry, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { panelTexture } from '../bake/CanvasTextures';
import { CHAPTERS } from '../../story/chapters';

const GAUGES = 5;

/**
 * CH2: the pre-flight instrument panel. Five gauges flick green one by one
 * as the taxi progresses — the app's real dashboard audit, staged.
 */
export class Panel {
  readonly group = new Group();
  private gaugeMaterials: MeshStandardMaterial[] = [];
  private disposables: { dispose(): void }[] = [];

  constructor(anchor: Vector3) {
    this.group.position.set(anchor.x, anchor.y + 0.5, anchor.z - 2.2);
    this.group.rotation.y = -Math.PI / 2 + 0.35; // face the approaching camera

    const face = new MeshStandardMaterial({
      map: panelTexture(),
      emissiveMap: panelTexture(),
      emissive: '#ffffff',
      emissiveIntensity: 0.55,
      roughness: 0.6,
    });
    const board = new Mesh(new BoxGeometry(4.4, 4.4, 0.18), face);
    this.group.add(board);
    this.disposables.push(board.geometry, face);

    // rooftop billboard legs — the board stands over the taxi route
    const legMaterial = new MeshStandardMaterial({ color: '#232a3a', roughness: 0.6, metalness: 0.4 });
    const legGeometry = new BoxGeometry(0.14, 3, 0.14);
    for (const lx of [-1.7, 1.7]) {
      const leg = new Mesh(legGeometry, legMaterial);
      leg.position.set(lx, -3.6, 0);
      this.group.add(leg);
    }
    this.disposables.push(legGeometry, legMaterial);

    for (let i = 0; i < GAUGES; i++) {
      const m = new MeshStandardMaterial({
        color: '#0d2018',
        emissive: '#7fe8d8',
        emissiveIntensity: 0.1,
        roughness: 0.4,
      });
      const dot = new Mesh(new CircleGeometry(0.16, 20), m);
      dot.position.set(-1.75, 1.05 - i * 0.535, 0.1);
      this.group.add(dot);
      this.gaugeMaterials.push(m);
      this.disposables.push(dot.geometry, m);
    }
  }

  update(t: number): void {
    const ch = CHAPTERS[1]!;
    const local = (t - ch.t0) / (ch.t1 - ch.t0);
    for (let i = 0; i < GAUGES; i++) {
      const on = local > (i + 0.5) / GAUGES;
      const m = this.gaugeMaterials[i]!;
      m.emissiveIntensity += ((on ? 2.4 : 0.1) - m.emissiveIntensity) * 0.15;
    }
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
