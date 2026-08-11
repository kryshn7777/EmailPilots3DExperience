import { bindPage } from '../../page';
import type { Engine } from '../Engine';

interface SwupLike {
  hooks?: {
    on?(name: string, handler: () => void): void;
  };
}

/**
 * Wires Swup navigation into the persistent engine: the plane banks during
 * the swap, the new route parks the world at its preset, reveals re-bind,
 * and ScrollTrigger re-measures the new page height. The canvas itself is
 * never touched — it lives outside the swap container.
 */
export function initSwupChoreo(engine: Engine): void {
  const tryHook = (attempts: number): void => {
    const hooks = (window as { swup?: SwupLike }).swup?.hooks;
    // the integration assigns window.swup before hooks are ready — wait for both
    if (!hooks?.on) {
      if (attempts > 0) setTimeout(() => tryHook(attempts - 1), 150);
      return; // no swup (e.g. integration disabled): plain page loads still work
    }

    hooks.on('visit:start', () => {
      engine.maneuver();
    });

    hooks.on('content:replace', () => {
      engine.scrollTopForSwap();
      engine.setRoute(location.pathname);
      bindPage();
      engine.refreshAfterSwap();
    });
  };
  tryHook(30);
}
