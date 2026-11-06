import { Camera, Vector3 } from 'three';
import '../../styles/fleet.css';
import { CAMPAIGN, CARD, REPORT, type CardState } from '../../story/fleet';

/** how a chip reads: flying `→ name`, a formation timetable slot, landed `✓ name`, and the special beats */
export type ChipMode = 'flying' | 'slot' | 'landed' | 'ghost' | 'cancel' | 'reply' | 'bad' | 'auth';

export interface FleetChip {
  anchor: Vector3;
  shown: boolean;
  mode: ChipMode;
  label: string;
}

/** a red stamp slammed over a point in the scene: `bcc` (550 on the bomber) or `dns` (do-not-send) */
export interface FleetStamp {
  anchor: Vector3;
  shown: boolean;
  kind: 'bcc' | 'dns';
}

export interface BatchHudState {
  card: CardState;
  chips: FleetChip[];
  stamps: FleetStamp[];
}

/** a chip's height plus a gap, for stacking */
const CHIP_H = 27;
const STAMP_TEXT: Record<FleetStamp['kind'], string> = { bcc: '550 — Spam flagged', dns: 'Do-not-send' };

/**
 * The fleet's HUD: the card (`.fleet-card`), the name chips pinned over the 3D landings
 * (`.fleet-chip`), the red stamps (`.fleet-stamp`) and the flight report (`.fleet-report`). Every
 * word comes from src/story/fleet.ts (`cardAt` and the chips BatchFleet builds); the look is
 * src/styles/fleet.css. This owns only the markup, the text and the pinning, and writes the DOM
 * only when something it shows changes.
 */
export class BatchHud {
  private el: HTMLDivElement;
  private countEl: HTMLElement;
  private countNum: HTMLElement;
  private longEl: HTMLElement;
  private shortEl: HTMLElement;
  private badgeEl: HTMLElement;
  private meterEl: HTMLElement;
  private report: HTMLDivElement;
  private reportRows: HTMLElement[] = [];
  private chips: HTMLDivElement[] = [];
  private stamps: HTMLDivElement[] = [];
  private projected = new Vector3();
  private shown = { visible: '', tone: '', count: -1, long: '', short: '', badge: '', meter: -1, meterKind: '', report: -1 };
  private tickTimer = 0;
  /** the chips' layout this frame: x, y, half width, chip index (reused) */
  private lay: Float32Array;

  constructor(chipCount = 18) {
    this.lay = new Float32Array(chipCount * 4);
    this.el = document.createElement('div');
    this.el.className = 'fleet-card';
    this.el.dataset.visible = 'false';
    this.el.dataset.tone = 'info';
    this.el.dataset.meter = 'delivered';
    this.el.setAttribute('role', 'status');
    this.el.setAttribute('aria-live', 'polite');
    this.el.innerHTML = `
      <div class="fleet-card__bar">
        <span class="fleet-card__brand">${CARD.brand}</span>
        <span class="fleet-card__head">${CAMPAIGN.name}</span>
        <span class="fleet-card__badge"></span>
      </div>
      <div class="fleet-card__main">
        <span class="fleet-card__count"><span class="fleet-card__sample">Sample</span><b>0</b><small>/${CAMPAIGN.total}</small></span>
        <span class="fleet-card__word">${CARD.countWord}</span>
        <span class="fleet-card__tag">${CAMPAIGN.label}</span>
        <span class="fleet-card__foot fleet-card__short"></span>
      </div>
      <div class="fleet-card__meter" aria-hidden="true"><i></i></div>
      <div class="fleet-card__foot fleet-card__long"></div>`;
    document.body.appendChild(this.el);
    this.countEl = this.el.querySelector('.fleet-card__count')!;
    this.countNum = this.countEl.querySelector('b')!;
    this.longEl = this.el.querySelector('.fleet-card__long')!;
    this.shortEl = this.el.querySelector('.fleet-card__short')!;
    this.badgeEl = this.el.querySelector('.fleet-card__badge')!;
    this.meterEl = this.el.querySelector('.fleet-card__meter')!;

    this.report = document.createElement('div');
    this.report.className = 'fleet-report';
    this.report.dataset.visible = 'false';
    this.report.setAttribute('aria-hidden', 'true');
    for (const [a, b] of REPORT.rows) {
      const row = document.createElement('div');
      row.className = 'fleet-report__row';
      row.dataset.on = 'false';
      const l = document.createElement('span');
      l.textContent = a;
      const r = document.createElement('span');
      r.textContent = b;
      row.append(l, r);
      this.report.appendChild(row);
      this.reportRows.push(row);
    }
    document.body.appendChild(this.report);

    for (let i = 0; i < chipCount; i++) {
      const chip = document.createElement('div');
      chip.className = 'fleet-chip';
      chip.dataset.visible = 'false';
      chip.dataset.mode = 'flying';
      chip.setAttribute('aria-hidden', 'true');
      document.body.appendChild(chip);
      this.chips.push(chip);
    }
    for (let i = 0; i < 2; i++) {
      const stamp = document.createElement('div');
      stamp.className = 'fleet-stamp';
      stamp.dataset.on = 'false';
      stamp.setAttribute('aria-hidden', 'true');
      document.body.appendChild(stamp);
      this.stamps.push(stamp);
    }
  }

  private screen = { x: 0, y: 0 };
  /** screen position of a world point (one reused object), or null when behind the lens */
  private toScreen(at: Vector3, camera: Camera): { x: number; y: number } | null {
    this.projected.copy(at).project(camera);
    if (this.projected.z > 1) return null;
    this.screen.x = (this.projected.x * 0.5 + 0.5) * innerWidth;
    this.screen.y = (-this.projected.y * 0.5 + 0.5) * innerHeight;
    return this.screen;
  }

  update(state: BatchHudState, camera: Camera, enabled: boolean): void {
    const c = state.card;
    const s = this.shown;
    const show = enabled && c.visible;
    const vis = show ? 'true' : 'false';
    if (s.visible !== vis) this.el.dataset.visible = s.visible = vis;
    if (show) {
      if (s.tone !== c.tone) this.el.dataset.tone = s.tone = c.tone;
      if (s.count !== c.delivered) {
        // a step up pops the number (a scrub back just sets it)
        const up = s.count >= 0 && c.delivered > s.count;
        s.count = c.delivered;
        this.countNum.textContent = String(c.delivered);
        if (up) {
          this.countEl.dataset.tick = 'false';
          void this.countEl.offsetWidth;
          this.countEl.dataset.tick = 'true';
          clearTimeout(this.tickTimer);
          this.tickTimer = window.setTimeout(() => { this.countEl.dataset.tick = 'false'; }, 450);
        }
      }
      if (s.long !== c.foot) this.longEl.textContent = s.long = c.foot;
      if (s.short !== c.footShort) this.shortEl.textContent = s.short = c.footShort;
      if (s.badge !== c.badge) this.badgeEl.textContent = s.badge = c.badge;
      if (s.meterKind !== c.meterKind) {
        this.el.dataset.meter = s.meterKind = c.meterKind;
        this.meterEl.style.setProperty('--notches', String(c.meterKind === 'cap' ? CAMPAIGN.cap : CAMPAIGN.total));
      }
      const m = Math.round(c.meter * 1000);
      if (s.meter !== m) {
        s.meter = m;
        this.meterEl.style.setProperty('--p', String(Math.min(c.meter, 1)));
      }
    }
    const rows = show ? c.report : 0;
    if (s.report !== rows) {
      s.report = rows;
      this.report.dataset.visible = rows > 0 ? 'true' : 'false';
      this.reportRows.forEach((r, i) => { r.dataset.on = i < rows ? 'true' : 'false'; });
    }

    // where each shown chip goes: projected, held inside the frame's gutter, then stacked clear of each other
    let n = 0;
    for (let i = 0; i < this.chips.length; i++) {
      const chip = this.chips[i]!;
      const ch = state.chips[i];
      const on = show && !!ch && ch.shown;
      const flag = on ? 'true' : 'false';
      if (chip.dataset.visible !== flag) chip.dataset.visible = flag;
      if (!on || !ch) continue;
      if (chip.dataset.mode !== ch.mode) chip.dataset.mode = ch.mode;
      if (chip.textContent !== ch.label) chip.textContent = ch.label;
      const p = this.toScreen(ch.anchor, camera);
      // a landing just past the frame's edge keeps its chip, held inside the 8 px gutter (its leader
      // still points down at the spot); one well out of frame, or behind the lens, hides it
      const half = (ch.label.length * 6.8 + 26) / 2;
      const lo = half + 8;
      const hi = innerWidth - half - 8;
      const over = p ? Math.max(lo - p.x, p.x - hi, 0) : Infinity;
      const onScreen = !!p && over < innerWidth * 0.18 && p.y > 40 && p.y < innerHeight - 30;
      chip.style.opacity = onScreen ? '' : '0';
      if (!p || !onScreen) continue;
      this.lay[n * 4] = Math.min(Math.max(p.x, lo), Math.max(hi, lo));
      this.lay[n * 4 + 1] = p.y;
      this.lay[n * 4 + 2] = half;
      this.lay[n * 4 + 3] = i;
      n++;
    }
    // nudge any chip that sits on another one up by a chip's height (a few passes settle it)
    for (let pass = 0; pass < 3; pass++) {
      for (let a = 0; a < n; a++) {
        for (let b = a + 1; b < n; b++) {
          const dx = Math.abs(this.lay[a * 4]! - this.lay[b * 4]!);
          const dy = this.lay[a * 4 + 1]! - this.lay[b * 4 + 1]!;
          if (dx >= this.lay[a * 4 + 2]! + this.lay[b * 4 + 2]! + 4 || Math.abs(dy) >= CHIP_H) continue;
          // the lower one keeps its place, the upper one moves up
          if (dy <= 0) this.lay[a * 4 + 1] = this.lay[b * 4 + 1]! - CHIP_H;
          else this.lay[b * 4 + 1] = this.lay[a * 4 + 1]! - CHIP_H;
        }
      }
    }
    for (let k = 0; k < n; k++) {
      const chip = this.chips[this.lay[k * 4 + 3]!]!;
      chip.style.setProperty('--x', `${Math.round(this.lay[k * 4]!)}px`);
      chip.style.setProperty('--y', `${Math.round(Math.max(this.lay[k * 4 + 1]!, 70))}px`);
    }

    for (let i = 0; i < this.stamps.length; i++) {
      const el = this.stamps[i]!;
      const st = state.stamps[i];
      const p = st && show && st.shown ? this.toScreen(st.anchor, camera) : null;
      const on = p ? 'true' : 'false';
      if (st && el.dataset.kind !== st.kind) {
        el.dataset.kind = st.kind;
        el.textContent = STAMP_TEXT[st.kind];
      }
      if (el.dataset.on !== on) el.dataset.on = on;
      if (p) {
        // kept inside the frame's gutter (the stamp is wide on a phone)
        const half = Math.min(el.offsetWidth / 2, innerWidth / 2 - 16);
        el.style.setProperty('--x', `${Math.round(Math.min(Math.max(p.x, 16 + half), innerWidth - 16 - half))}px`);
        el.style.setProperty('--y', `${Math.round(Math.min(Math.max(p.y, 90), innerHeight - 90))}px`);
      }
    }
  }

  dispose(): void {
    clearTimeout(this.tickTimer);
    this.el.remove();
    this.report.remove();
    for (const chip of this.chips) chip.remove();
    for (const stamp of this.stamps) stamp.remove();
  }
}
