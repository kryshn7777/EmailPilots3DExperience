import { DefaultLoadingManager } from 'three';
import { T_S } from '../rig/detour';

/**
 * Load readiness: the story does not fly into a chapter whose models have not arrived.
 *
 * Each streamed piece of the world is a gate at the story-t where it is first needed. A gate is open
 * once everything registered on it has loaded. `readyT` is the earliest gate still closed; the scrub
 * spring's target is held a little short of it (Engine: progressForT(readyT - 0.004)) and the HUD
 * shows a small loading cue, so a fast scroll on a slow connection waits at the edge of the town or
 * the city for a moment instead of flying through empty ground.
 *
 * Safe by construction:
 *  - nothing registered on a gate means it is open (an actor that registers nothing never blocks);
 *  - the cap never pulls the frame back: it is at least where the frame already is;
 *  - a gate that has held the visitor for 12 s is released whatever its state (a stalled request,
 *    a model that 404s and never reports);
 *  - gates before t 0.05 are ignored: the preloader covers the opening.
 *
 * What registers: the actors' own loaders all go through three's DefaultLoadingManager (GLTFLoader,
 * TextureLoader), so the manager's item start/end is tracked here and each URL is put on a gate by
 * its folder (GATES below), without touching the actors. `register(t, promise)` takes anything else.
 */
interface Gate {
  t: number;
  pending: number;
  released: boolean;
}

/** which folder of public/ is needed from which story-t */
const GATES: [RegExp, number][] = [
  [/\/models\/(homes|yard-props)\//, 0.09], // the town under the window
  [/\/models\/biplane\//, 0.32],
  [/\/models\/(ocean|lighthouse|ship)/, 0.46], // the run in to the lighthouse
  [/\/models\/(city-kit|city-props|city-rings|cars|people)/, 0.6], // the city below the no-fly zones
  [/\/models\/office\//, T_S], // the office detour
  [/\/models\/(airliner|comm-tower|recipient-room)\//, 0.83],
];

const HOLD_LIMIT_MS = 12000;

export class Readiness {
  private gates = new Map<number, Gate>();
  private heldGate: Gate | null = null;
  private heldSince = 0;
  private loading = false;
  private totalStarted = 0;
  private totalDone = 0;
  private totalPending = 0;
  private listeners = new Set<() => void>();

  constructor() {
    const m = DefaultLoadingManager;
    const start = m.itemStart.bind(m);
    const end = m.itemEnd.bind(m);
    // a URL can be started more than once (GLTFLoader and the FileLoader inside it both report the
    // .glb), and three ends every start (itemError is followed by itemEnd), so count per URL and
    // close on itemEnd only
    m.itemStart = (url: string): void => {
      start(url);
      this.totalStarted++;
      this.totalPending++;
      const t = gateFor(url);
      if (t !== null) this.gate(t).pending++;
      this.notify();
    };
    m.itemEnd = (url: string): void => {
      end(url);
      this.totalDone++;
      this.totalPending = Math.max(0, this.totalPending - 1);
      const t = gateFor(url);
      if (t !== null) {
        const g = this.gate(t);
        g.pending = Math.max(0, g.pending - 1);
      }
      this.notify();
    };
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }

  /** Something the story needs from story-t `t` on. */
  register(t: number, promise: Promise<unknown>): void {
    const g = this.gate(t);
    g.pending++;
    this.totalStarted++;
    this.totalPending++;
    this.notify();
    void promise.catch(() => undefined).finally(() => {
      g.pending = Math.max(0, g.pending - 1);
      this.totalDone++;
      this.totalPending = Math.max(0, this.totalPending - 1);
      this.notify();
    });
  }

  /**
   * Resolves once every registered promise and every DefaultLoadingManager request (including nested
   * GLB/texture loads kicked off after JSON manifests resolve) has settled.
   */
  whenAllReady(onProgress?: (loaded: number, total: number) => void, timeoutMs = 20000): Promise<void> {
    return new Promise<void>((resolve) => {
      let settledTimer = 0;
      let done = false;
      const finish = (): void => {
        if (done) return;
        done = true;
        clearTimeout(settledTimer);
        clearTimeout(safetyTimer);
        this.listeners.delete(check);
        resolve();
      };
      const check = (): void => {
        onProgress?.(this.totalDone, this.totalStarted);
        clearTimeout(settledTimer);
        if (this.totalPending === 0 && this.totalStarted > 0) {
          settledTimer = window.setTimeout(() => {
            if (this.totalPending === 0) finish();
          }, 120);
        }
      };
      const safetyTimer = window.setTimeout(finish, timeoutMs);
      this.listeners.add(check);
      check();
    });
  }

  private gate(t: number): Gate {
    let g = this.gates.get(t);
    if (!g) {
      g = { t, pending: 0, released: false };
      this.gates.set(t, g);
    }
    return g;
  }

  /** the earliest story-t still waiting on a load (1 when nothing is) */
  get readyT(): number {
    let first: Gate | null = null;
    for (const g of this.gates.values()) {
      if (g.pending > 0 && !g.released && g.t >= 0.05 && (!first || g.t < first.t)) first = g;
    }
    return first ? first.t : 1;
  }

  /**
   * The spring's target, held short of the first closed gate. `current` is where the frame is (the cap
   * never goes behind it), `progressForT` maps story-t to scroll progress (through the pace warp).
   */
  capTarget(target: number, current: number, now: number, progressForT: (t: number) => number): number {
    let first: Gate | null = null;
    for (const g of this.gates.values()) {
      if (g.pending > 0 && !g.released && g.t >= 0.05 && (!first || g.t < first.t)) first = g;
    }
    let out = target;
    let holding = false;
    if (first) {
      const cap = Math.max(progressForT(first.t - 0.004), current);
      if (target > cap) {
        out = cap;
        holding = true;
        if (this.heldGate !== first) {
          this.heldGate = first;
          this.heldSince = now;
        } else if (now - this.heldSince > HOLD_LIMIT_MS) {
          first.released = true; // never trap anyone on a chapter
          this.heldGate = null;
        }
      }
    }
    if (!holding) this.heldGate = null;
    if (holding !== this.loading) {
      this.loading = holding;
      window.dispatchEvent(new CustomEvent('flight:loading', { detail: holding }));
    }
    return out;
  }
}

function gateFor(url: string): number | null {
  for (const [re, t] of GATES) if (re.test(url)) return t;
  return null;
}
