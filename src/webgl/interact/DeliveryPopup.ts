import { Camera, Vector3 } from 'three';

/**
 * The lighthouse delivery readout: a cyber-themed card that opens beside the lantern the
 * moment the dart is absorbed by the lamp, and closes as the flight leaves the beacon. It is
 * pinned to the lantern's projected position, so it keeps its place as the shot moves. All of
 * the look is in global.css (`.delivery`); this only owns the markup and the pinning.
 */
export class DeliveryPopup {
  private el: HTMLDivElement;
  private projected = new Vector3();

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'delivery';
    this.el.dataset.visible = 'false';
    this.el.setAttribute('role', 'status');
    this.el.setAttribute('aria-live', 'polite');
    this.el.innerHTML = `
      <span class="delivery__ring" aria-hidden="true"></span>
      <svg class="delivery__leader" width="56" height="44" viewBox="0 0 56 44" aria-hidden="true">
        <path d="M0 44 L26 10 L56 10" fill="none" stroke="currentColor" stroke-width="1.5" />
      </svg>
      <div class="delivery__panel">
        <div class="delivery__bar">
          <span>RELAY // LIGHTHOUSE-01</span>
          <span class="delivery__live">LIVE</span>
        </div>
        <div class="delivery__title" data-text="EMAIL DELIVERED">EMAIL DELIVERED</div>
        <ul class="delivery__log">
          <li><span>SPF</span><b>PASS</b></li>
          <li><span>DKIM</span><b>PASS</b></li>
          <li><span>DMARC</span><b>ALIGNED</b></li>
          <li><span>INBOX</span><b>PRIMARY</b></li>
        </ul>
        <div class="delivery__meter" aria-hidden="true"><i></i></div>
        <div class="delivery__foot"><span>SIGNAL 100%</span><span>0.84 s</span></div>
      </div>`;
    document.body.appendChild(this.el);
  }

  /** Per-frame: show or hide, and pin the card to the lantern's position on screen. */
  update(visible: boolean, anchor: Vector3, camera: Camera): void {
    const next = visible ? 'true' : 'false';
    if (this.el.dataset.visible !== next) this.el.dataset.visible = next;
    if (!visible) return;
    this.projected.copy(anchor).project(camera);
    const behind = this.projected.z > 1;
    const x = (this.projected.x * 0.5 + 0.5) * innerWidth;
    const y = (-this.projected.y * 0.5 + 0.5) * innerHeight;
    // keep the card on screen: flip it to the left of the lamp near the right edge, below it near the top
    this.el.dataset.flip = String(x > innerWidth - 400);
    this.el.dataset.below = String(y < 250);
    this.el.style.setProperty('--x', `${Math.round(behind ? innerWidth / 2 : x)}px`);
    this.el.style.setProperty('--y', `${Math.round(behind ? innerHeight / 2 : y)}px`);
  }

  dispose(): void {
    this.el.remove();
  }
}
