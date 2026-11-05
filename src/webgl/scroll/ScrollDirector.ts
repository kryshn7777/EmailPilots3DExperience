import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';

gsap.registerPlugin(ScrollTrigger);
// scroll feel: a phone's URL bar showing or hiding must not re-measure the timeline mid-scroll
ScrollTrigger.config({ ignoreMobileResize: true });

// --- scroll feel ---
/** what the visitor is scrolling with; it sets Lenis' coast and the scrub spring's frequency */
export type InputKind = 'notch' | 'trackpad' | 'touch' | 'key';
const FEEL: Record<InputKind, { lerp: number; omega: number }> = {
  // a wheel's notches arrive as steps: a long coast (lerp 0.075) and a softer spring smooth them out
  notch: { lerp: 0.075, omega: 9 },
  // a trackpad is already smooth and continuous: follow it closer, or it feels like dragging through syrup
  trackpad: { lerp: 0.14, omega: 13 },
  // touch scrolls natively (syncTouch stays off: iOS' own momentum is what a thumb expects)
  touch: { lerp: 0.075, omega: 12 },
  // a key (or a tick on the rail) is a jump: an eased scrollTo carries it, the spring stays close
  key: { lerp: 0.075, omega: 16 },
};
const easeInOutCubic = (x: number): number => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
// --- end scroll feel ---

interface ScrollDirectorOptions {
  reducedMotion: boolean;
  onProgress: (t: number) => void;
}

/**
 * Owns Lenis + the single master ScrollTrigger. Lenis scrolls the real
 * window (no scrollerProxy); gsap.ticker is the one clock driving it.
 * In Phase 2 the master trigger drives the chapter timeline from chapters.ts —
 * for Phase 1 it feeds raw progress to the debug scene.
 */
export class ScrollDirector {
  private lenis: Lenis | null = null;
  private trigger: ScrollTrigger;
  private tick: ((time: number) => void) | null = null;
  /** story position captured before a re-measure, re-applied after it */
  private heldProgress: number | null = null;
  private onRefreshInit: () => void;
  private onRefresh: () => void;
  /** the scrub spring's frequency for the input in use (Engine reads it every frame; spring.ts) */
  omega = 11;

  constructor(options: ScrollDirectorOptions) {
    history.scrollRestoration = 'manual';

    if (!options.reducedMotion) {
      /**
       * Weight, and a coast after you let go.
       *
       * lerp is the whole trick: Lenis eases its scroll toward a target the
       * wheel has already moved, so a LOWER lerp keeps easing for longer after
       * the last input — that carry-on is the "few frames forward" rather than
       * a hard stop the moment your finger leaves. 0.075 coasts; the old 0.14
       * arrived almost immediately.
       *
       * wheelMultiplier goes back up to 1: with the coast doing the work, a
       * damped notch just felt like resistance instead of mass.
       */
      this.lenis = new Lenis({ autoRaf: false, lerp: 0.075, wheelMultiplier: 1 });
      this.lenis.on('scroll', ScrollTrigger.update);
      // --- scroll feel ---
      this.lenis.on('virtual-scroll', this.onVirtualScroll);
      window.addEventListener('keydown', this.onKey);
      // --- end scroll feel ---
      this.tick = (time: number) => this.lenis?.raf(time * 1000);
      gsap.ticker.add(this.tick);
      gsap.ticker.lagSmoothing(0);
    }

    this.trigger = ScrollTrigger.create({
      start: 0,
      // The flight lasts as long as the experience stage (`#experience`, Experience.astro): from the
      // top of the page to the moment its last chapter has scrolled through. Content placed after
      // it (the landing section) does not stretch the story. On pages without a stage the whole
      // document is the timeline, as before.
      end: () => {
        const stage = document.getElementById('experience');
        if (!stage) return document.documentElement.scrollHeight - window.innerHeight;
        const bottom = stage.getBoundingClientRect().bottom + window.scrollY;
        return Math.max(bottom - window.innerHeight, 1);
      },
      scrub: true,
      onUpdate: (self) => options.onProgress(self.progress),
    });

    /**
     * Hold the STORY position across a re-measure, not the pixel offset.
     *
     * `end` is scrollHeight − innerHeight, so anything that changes the page
     * or viewport height changes it, and progress is scroll/end. ScrollTrigger
     * preserves the scroll offset across a refresh, which means the flight
     * teleports: measured at 1280×641 → 1280×900, scroll held at 4039px while
     * end went 8077 → 11340, and the story jumped 0.500 → 0.356 — a chapter
     * and a half backwards for a window resize. A phone rotating, or the
     * mobile URL bar collapsing, does the same thing.
     *
     * Re-anchoring is skipped when the correction is under 0.5% of the story,
     * so the constant few-pixel viewport churn on mobile can't start a
     * feedback loop with the bar it is caused by.
     */
    this.onRefreshInit = () => {
      this.heldProgress = this.trigger?.progress ?? null;
    };
    this.onRefresh = () => {
      const held = this.heldProgress;
      this.heldProgress = null;
      if (held === null || !this.trigger) return;
      const end = this.trigger.end;
      if (!(end > 0)) return;
      const target = held * end;
      const current = this.lenis ? this.lenis.scroll : window.scrollY;
      if (Math.abs(target - current) < end * 0.005) return;
      if (this.lenis) this.lenis.scrollTo(target, { immediate: true, force: true });
      else window.scrollTo(0, target);
    };
    ScrollTrigger.addEventListener('refreshInit', this.onRefreshInit);
    ScrollTrigger.addEventListener('refresh', this.onRefresh);
  }

  // --- scroll feel ---
  /** the input in use, and since when a trackpad-like event was last seen (it holds the class for a while) */
  kind: InputKind = 'notch';
  private trackpadAt = -1e9;
  private jumping = false;

  private setKind(kind: InputKind): void {
    if (!this.jumping) this.omega = FEEL[kind].omega;
    if (kind === this.kind) return;
    this.kind = kind;
    if (this.lenis && kind !== 'key') this.lenis.options.lerp = FEEL[kind].lerp;
    window.dispatchEvent(new CustomEvent('flight:input', { detail: kind }));
  }

  /**
   * Which device is scrolling, from each wheel/touch event Lenis sees (before it acts on it, so the
   * new lerp applies to this very event). A notch: line mode, or a whole number of 50 px or more; a
   * trackpad: fractional or small deltas, and it keeps that class for 300 ms (a flick's tail is small).
   */
  private onVirtualScroll = ({ event }: { deltaX: number; deltaY: number; event: Event }): void => {
    if (this.jumping) {
      // a wheel or a touch takes over from a jump
      this.jumping = false;
    }
    if (event.type.includes('touch')) {
      this.setKind('touch');
      return;
    }
    if (!(event instanceof WheelEvent)) return;
    const dy = event.deltaY;
    const now = performance.now();
    const notchLike = event.deltaMode === 1 || (Math.abs(dy) >= 50 && Number.isInteger(dy));
    if (!notchLike) this.trackpadAt = now;
    this.setKind(notchLike && now - this.trackpadAt > 300 ? 'notch' : 'trackpad');
    window.dispatchEvent(new CustomEvent('flight:activity'));
  };

  /**
   * Keys scroll the story in eased jumps (0.9 of the viewport for Space and Page Up/Down, 0.15 for the
   * arrows, Home and End to the ends), not the browser's instant jump the spring then had to chase. A
   * key aimed at a focused field, button or link, or with a modifier, is left alone.
   */
  private onKey = (e: KeyboardEvent): void => {
    if (!this.lenis || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    const el = e.target as HTMLElement | null;
    if (el && el !== document.body && el.closest?.('input, textarea, select, button, a, summary, [contenteditable], [role="slider"], [role="textbox"], [role="button"], [tabindex]')) return;
    const vh = window.innerHeight;
    let delta: number | null = null;
    let to: number | null = null;
    switch (e.key) {
      case ' ':
        delta = (e.shiftKey ? -0.9 : 0.9) * vh;
        break;
      case 'PageDown':
        delta = 0.9 * vh;
        break;
      case 'PageUp':
        delta = -0.9 * vh;
        break;
      case 'ArrowDown':
        delta = 0.15 * vh;
        break;
      case 'ArrowUp':
        delta = -0.15 * vh;
        break;
      case 'Home':
        to = 0;
        break;
      case 'End':
        to = this.lenis.limit;
        break;
      default:
        return;
    }
    e.preventDefault();
    // repeated presses add up from where the last jump was going, not from where the frame is
    const from = this.jumping ? this.lenis.targetScroll : this.lenis.animatedScroll;
    this.jumpTo(to ?? from + (delta ?? 0));
  };

  /** An eased jump to a scroll offset (px): the keys, and the rail's ticks. */
  private jumpTo(px: number): void {
    window.dispatchEvent(new CustomEvent('flight:activity'));
    if (!this.lenis) {
      window.scrollTo(0, px);
      return;
    }
    const target = Math.min(Math.max(px, 0), this.lenis.limit);
    const end = this.trigger.end > 0 ? this.trigger.end : this.lenis.limit;
    const dp = Math.abs(target - this.lenis.animatedScroll) / Math.max(end, 1);
    this.setKind('key');
    this.jumping = true;
    this.omega = FEEL.key.omega;
    this.lenis.scrollTo(target, {
      duration: Math.min(Math.max(0.6 + 2.4 * dp, 0.6), 1.8),
      easing: easeInOutCubic,
      onComplete: () => {
        this.jumping = false;
        this.omega = FEEL[this.kind].omega;
      },
    });
  }

  /** the timeline's length in px (the master trigger's end) */
  get endPx(): number {
    return this.trigger.end;
  }

  /** An eased jump to a share of the timeline (0..1 scroll progress): the progress rail's ticks. */
  jumpToProgress(p: number): void {
    const end = this.trigger.end;
    if (!(end > 0)) return;
    this.jumpTo(Math.min(Math.max(p, 0), 1) * end);
  }
  // --- end scroll feel ---

  /** Instant scroll-to-top for page swaps (Lenis-aware). */
  scrollTop(): void {
    if (this.lenis) this.lenis.scrollTo(0, { immediate: true });
    else window.scrollTo(0, 0);
  }

  /** Re-measure after a Swup container swap changed the page height. */
  refresh(): void {
    ScrollTrigger.refresh();
  }

  dispose(): void {
    ScrollTrigger.removeEventListener('refreshInit', this.onRefreshInit);
    ScrollTrigger.removeEventListener('refresh', this.onRefresh);
    this.trigger.kill();
    if (this.tick) gsap.ticker.remove(this.tick);
    window.removeEventListener('keydown', this.onKey);
    this.lenis?.destroy();
  }
}
