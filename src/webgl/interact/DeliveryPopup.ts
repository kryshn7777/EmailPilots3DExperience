import { Camera, Vector3 } from 'three';
import { AUTH_CARD } from '../../story/copy';

/**
 * The lighthouse clearance: a cyber-themed card that opens beside the lantern as the dart reaches the lamp
 * and closes as the flight leaves the beacon. It is a clearance, not a delivery: the domain check the beacon
 * stands for (SPF, DKIM and DMARC checked, with the exact fix if not; story/copy.ts AUTH_CARD), titled
 * CLEARED FOR DELIVERY. It is pinned to the lantern's projected position, so it keeps its place as the shot
 * moves, and global.css (`.delivery`) keeps the panel inside a 16 px gutter; on a portrait screen the panel
 * docks full width under the fleet card at the top and only the ring stays on the lamp.
 *
 * The card opens a little before the Engine's own window (0.545..0.586), from WINDOW_FROM, so it is up as
 * the lamp takes the dart: it follows the story-t the Engine reports (`flight:t`), on the home page only.
 */
const WINDOW_FROM = 0.528;
const WINDOW_TO = 0.586;

export class DeliveryPopup {
  private el: HTMLDivElement;
  private projected = new Vector3();
  private t = 0;
  private onT = (e: Event): void => {
    this.t = (e as CustomEvent<number>).detail;
  };

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'delivery delivery--auth';
    this.el.dataset.visible = 'false';
    this.el.setAttribute('role', 'status');
    this.el.setAttribute('aria-live', 'polite');
    const rows = AUTH_CARD.rows.map(([k, v]) => `<li><span>${k}</span><b>${v}</b></li>`).join('');
    this.el.innerHTML = `
      <span class="delivery__ring" aria-hidden="true"></span>
      <svg class="delivery__leader" width="56" height="44" viewBox="0 0 56 44" aria-hidden="true">
        <path d="M0 44 L26 10 L56 10" fill="none" stroke="currentColor" stroke-width="1.5" />
      </svg>
      <div class="delivery__panel">
        <div class="delivery__bar">
          <span>${AUTH_CARD.bar}</span>
          <span class="delivery__live">${AUTH_CARD.live}</span>
        </div>
        <div class="delivery__title" data-text="${AUTH_CARD.title}">${AUTH_CARD.title}</div>
        <ul class="delivery__log">${rows}</ul>
        <div class="delivery__meter" aria-hidden="true"><i></i></div>
        <div class="delivery__foot"><span>${AUTH_CARD.foot[0]}</span><span>${AUTH_CARD.foot[1]}</span></div>
      </div>`;
    document.body.appendChild(this.el);
    window.addEventListener('flight:t', this.onT);
  }

  /** Per-frame: show or hide, and pin the card to the lantern's position on screen. */
  update(visible: boolean, anchor: Vector3, camera: Camera): void {
    const home = document.body.dataset.route === '/';
    const on = visible || (home && this.t >= WINDOW_FROM && this.t < WINDOW_TO);
    const next = on ? 'true' : 'false';
    if (this.el.dataset.visible !== next) this.el.dataset.visible = next;
    if (!on) return;
    this.projected.copy(anchor).project(camera);
    const behind = this.projected.z > 1;
    const x = (this.projected.x * 0.5 + 0.5) * innerWidth;
    const y = (-this.projected.y * 0.5 + 0.5) * innerHeight;
    // keep the card on screen: flip it to the left of the lamp near the right edge, below it near the top
    // (the CSS clamps it inside the gutter whatever this picks, and docks it on a portrait screen)
    this.el.dataset.flip = String(x > innerWidth - 400);
    this.el.dataset.below = String(y < 250);
    this.el.style.setProperty('--x', `${Math.round(behind ? innerWidth / 2 : x)}px`);
    this.el.style.setProperty('--y', `${Math.round(behind ? innerHeight / 2 : y)}px`);
  }

  dispose(): void {
    window.removeEventListener('flight:t', this.onT);
    this.el.remove();
  }
}
