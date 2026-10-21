import { Camera, Vector3 } from 'three';

export interface BatchHudState {
  visible: boolean;
  /** planes out of the laptop so far, of `total` */
  sent: number;
  delivered: number;
  chips: { anchor: Vector3; shown: boolean; mode: 'flying' | 'landed'; label: string }[];
}

const TOTAL = 42;

/**
 * The batch readout. A cyber card at the top of the screen reads "Email Pilots — Batch sending
 * 3/42" while the planes leave the laptop (the count ticks up as each one goes), then turns into
 * "Email delivered successfully" once the first two have landed. Each landing also gets a small
 * "delivered" tag pinned over its house. All of the look is in global.css (`.batch`); this only
 * owns the markup, the text and the pinning.
 */
export class BatchHud {
  private el: HTMLDivElement;
  private count: HTMLElement;
  private foot: HTMLElement;
  private meter: HTMLElement;
  private chips: HTMLDivElement[] = [];
  private projected = new Vector3();
  private shownCount = -1;
  private shownFoot = '';

  constructor(chipCount = 2) {
    this.el = document.createElement('div');
    this.el.className = 'batch';
    this.el.dataset.visible = 'false';
    this.el.dataset.phase = 'sending';
    this.el.setAttribute('role', 'status');
    this.el.setAttribute('aria-live', 'polite');
    this.el.innerHTML = `
      <div class="batch__bar"><span>Email Pilots</span><span class="batch__live">Live</span></div>
      <div class="batch__title">
        <span class="batch__sending">Batch sending <b class="batch__count">0/${TOTAL}</b></span>
        <span class="batch__done"><i class="batch__tick" aria-hidden="true"></i>Email delivered successfully</span>
      </div>
      <div class="batch__meter" aria-hidden="true"><i></i></div>
      <div class="batch__foot"></div>`;
    document.body.appendChild(this.el);
    this.count = this.el.querySelector('.batch__count')!;
    this.foot = this.el.querySelector('.batch__foot')!;
    this.meter = this.el.querySelector('.batch__meter i')!;
    for (let i = 0; i < chipCount; i++) {
      const chip = document.createElement('div');
      chip.className = 'batch-chip';
      chip.dataset.visible = 'false';
      chip.dataset.mode = 'flying';
      chip.innerHTML = '<i class="batch-chip__tick" aria-hidden="true"></i><span></span>';
      document.body.appendChild(chip);
      this.chips.push(chip);
    }
  }

  update(state: BatchHudState, camera: Camera, enabled: boolean): void {
    const show = enabled && state.visible;
    const next = show ? 'true' : 'false';
    if (this.el.dataset.visible !== next) this.el.dataset.visible = next;
    if (show) {
      const done = state.delivered >= 2;
      const phase = done ? 'done' : 'sending';
      if (this.el.dataset.phase !== phase) this.el.dataset.phase = phase;
      if (state.sent !== this.shownCount) {
        this.shownCount = state.sent;
        this.count.textContent = `${state.sent}/${TOTAL}`;
        this.meter.style.setProperty('--p', String(state.sent / TOTAL));
      }
      const foot = done
        ? 'Planes 1 + 2 landed · tracking plane 3'
        : state.delivered === 1
          ? 'First plane landed · tracking plane 3'
          : state.sent >= 3
            ? 'Planes 1 + 2 away · tracking plane 3'
            : state.sent === 0
              ? 'Queued'
              : `Plane ${state.sent} away`;
      if (foot !== this.shownFoot) {
        this.shownFoot = foot;
        this.foot.textContent = foot;
      }
    }
    this.chips.forEach((chip, i) => {
      const c = state.chips[i];
      const on = show && !!c && c.shown;
      const flag = on ? 'true' : 'false';
      if (chip.dataset.visible !== flag) chip.dataset.visible = flag;
      if (!on || !c) return;
      if (chip.dataset.mode !== c.mode) chip.dataset.mode = c.mode;
      const label = c.mode === 'landed' ? 'Delivered' : c.label;
      const text = chip.lastElementChild!;
      if (text.textContent !== label) text.textContent = label;
      this.projected.copy(c.anchor).project(camera);
      const behind = this.projected.z > 1;
      const x = (this.projected.x * 0.5 + 0.5) * innerWidth;
      const y = (-this.projected.y * 0.5 + 0.5) * innerHeight;
      const onScreen = !behind && x > 40 && x < innerWidth - 40 && y > 40 && y < innerHeight - 40;
      chip.style.opacity = onScreen ? '' : '0';
      chip.style.setProperty('--x', `${Math.round(x)}px`);
      chip.style.setProperty('--y', `${Math.round(y)}px`);
    });
  }

  dispose(): void {
    this.el.remove();
    for (const chip of this.chips) chip.remove();
  }
}
