import { CHAPTERS } from '../../story/chapters';

/**
 * `?perf`: a small overlay of how the scroll is running, for tuning on a real device.
 *
 * A ring buffer of the last 600 frames gives p50/p95/p99 frame time; frames over 33 ms are counted by
 * the chapter seam they fell near (+-0.01 of story-t around each chapter start), since that is where
 * streaming and shader links land. Live: the resolution governor's scale and the tier, the world's
 * speed per 100 px of scroll, perceived speed (v/h), the scrub spring's error and the input in use.
 * Redrawn 4 times a second; `window.__perf.snapshot()` returns the same numbers. Off unless ?perf.
 */
export interface PerfSample {
  dtMs: number;
  t: number;
  /** world units the dart moves per 100 px of scroll (0 when the scroll is still) */
  worldPer100: number;
  /** perceived speed: world speed over the camera's height above what is under it, 1/s */
  vh: number;
  /** spring error, in px */
  errPx: number;
  kind: string;
  resolution: number;
  tier: string;
}

const N = 600;

export class Perf {
  private frames = new Float32Array(N);
  private count = 0;
  private head = 0;
  private slowBySeam = new Map<string, number>();
  private last: PerfSample | null = null;
  private el: HTMLElement;
  private drawnAt = 0;

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'perf-overlay';
    this.el.setAttribute('aria-hidden', 'true');
    Object.assign(this.el.style, {
      position: 'fixed', top: '8px', left: '8px', zIndex: '100', padding: '6px 8px', whiteSpace: 'pre',
      font: '11px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace', color: '#cfe',
      background: 'rgba(5,7,15,0.72)', borderRadius: '4px', pointerEvents: 'none',
    } satisfies Partial<CSSStyleDeclaration>);
    document.body.appendChild(this.el);
    Object.assign(window as object, { __perf: { snapshot: () => this.snapshot() } });
  }

  frame(s: PerfSample, now: number): void {
    this.frames[this.head] = s.dtMs;
    this.head = (this.head + 1) % N;
    this.count = Math.min(this.count + 1, N);
    if (s.dtMs > 33) {
      for (const c of CHAPTERS) {
        if (c.t0 > 0 && Math.abs(s.t - c.t0) < 0.01) {
          this.slowBySeam.set(c.id, (this.slowBySeam.get(c.id) ?? 0) + 1);
        }
      }
    }
    this.last = s;
    if (now - this.drawnAt > 250) {
      this.drawnAt = now;
      this.draw();
    }
  }

  snapshot(): Record<string, unknown> {
    const sorted = Array.from(this.frames.subarray(0, this.count)).sort((a, b) => a - b);
    const q = (k: number): number => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * k))] ?? 0;
    return {
      p50: q(0.5), p95: q(0.95), p99: q(0.99), frames: this.count,
      slowBySeam: Object.fromEntries(this.slowBySeam),
      ...this.last,
    };
  }

  private draw(): void {
    const s = this.snapshot() as Record<string, number | string | Record<string, number>>;
    const n = (v: unknown, d = 1): string => (typeof v === 'number' ? v.toFixed(d) : '-');
    const seams = Object.entries(s.slowBySeam as Record<string, number>).map(([k, v]) => `${k} ${v}`).join(', ') || 'none';
    this.el.textContent =
      `frame p50 ${n(s.p50)}  p95 ${n(s.p95)}  p99 ${n(s.p99)} ms\n` +
      `>33ms at seams: ${seams}\n` +
      `tier ${s.tier}  res ${n(s.resolution, 2)}\n` +
      `t ${n(s.t, 4)}  world/100px ${n(s.worldPer100, 2)}  v/h ${n(s.vh, 2)}\n` +
      `spring err ${n(s.errPx, 1)} px  input ${s.kind}`;
  }

  dispose(): void {
    this.el.remove();
  }
}
