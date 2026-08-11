import { Camera, Object3D, Raycaster, Vector2 } from 'three';

interface Target {
  object: Object3D;
  onEnter?: () => void;
  onLeave?: () => void;
}

/**
 * One raycaster for the whole scene. Canvas is pointer-events:none, so the
 * pointer is read from window and cast only when it moves.
 */
export class Raycast {
  private raycaster = new Raycaster();
  private pointer = new Vector2(2, 2); // offscreen until first move
  private targets: Target[] = [];
  private hovered: Target | null = null;
  private dirty = false;

  constructor() {
    window.addEventListener('pointermove', this.onPointerMove);
  }

  register(target: Target): void {
    this.targets.push(target);
  }

  private onPointerMove = (e: PointerEvent): void => {
    this.pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    this.dirty = true;
  };

  update(camera: Camera): void {
    if (!this.dirty || this.targets.length === 0) return;
    this.dirty = false;

    this.raycaster.setFromCamera(this.pointer, camera);
    const objects = this.targets.map((t) => t.object);
    const hits = this.raycaster.intersectObjects(objects, true);

    let hit: Target | null = null;
    if (hits.length > 0) {
      const first = hits[0]!.object;
      hit =
        this.targets.find((t) => t.object === first || isAncestor(t.object, first)) ?? null;
    }

    if (hit !== this.hovered) {
      this.hovered?.onLeave?.();
      hit?.onEnter?.();
      this.hovered = hit;
      document.body.style.cursor = hit ? 'pointer' : '';
    }
  }

  dispose(): void {
    window.removeEventListener('pointermove', this.onPointerMove);
    document.body.style.cursor = '';
  }
}

function isAncestor(candidate: Object3D, child: Object3D): boolean {
  let node: Object3D | null = child.parent;
  while (node) {
    if (node === candidate) return true;
    node = node.parent;
  }
  return false;
}
