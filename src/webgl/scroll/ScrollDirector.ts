import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';

gsap.registerPlugin(ScrollTrigger);

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
      this.tick = (time: number) => this.lenis?.raf(time * 1000);
      gsap.ticker.add(this.tick);
      gsap.ticker.lagSmoothing(0);
    }

    this.trigger = ScrollTrigger.create({
      start: 0,
      end: () => document.documentElement.scrollHeight - window.innerHeight,
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
    this.lenis?.destroy();
  }
}
