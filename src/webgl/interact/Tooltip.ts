import { Camera, Vector3 } from 'three';

/**
 * The one HUD tooltip. Actors show/hide it on raycast hover and pin it to a
 * world position each frame.
 */
export class Tooltip {
  private el: HTMLDivElement;
  private projected = new Vector3();

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'hud-tooltip';
    this.el.dataset.visible = 'false';
    document.body.appendChild(this.el);
  }

  show(text: string): void {
    this.el.textContent = text;
    this.el.dataset.visible = 'true';
  }

  hide(): void {
    this.el.dataset.visible = 'false';
  }

  /** Pin above a world position (call per frame while visible). */
  pin(worldPos: Vector3, camera: Camera, yOffsetPx = 42): void {
    this.projected.copy(worldPos).project(camera);
    const x = (this.projected.x * 0.5 + 0.5) * innerWidth;
    const y = (-this.projected.y * 0.5 + 0.5) * innerHeight;
    this.el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y - yOffsetPx)}px)`;
  }

  dispose(): void {
    this.el.remove();
  }
}
