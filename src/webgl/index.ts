/**
 * WebGL boot: feature-gates the engine and loads it as a lazy chunk so the
 * initial page JS stays small. Runs once per browser session — the canvas
 * lives outside the Swup container and is never recreated.
 */

let booted = false;

export function boot(): void {
  if (booted) return;
  booted = true;

  const canvas = document.getElementById('webgl');
  if (!(canvas instanceof HTMLCanvasElement)) return;

  const testGl =
    canvas instanceof HTMLCanvasElement &&
    (document.createElement('canvas').getContext('webgl2') ??
      document.createElement('canvas').getContext('webgl'));
  if (!testGl) return; // no WebGL: DOM story remains fully readable

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  void import('./Engine').then(async ({ Engine }) => {
    const engine = new Engine(canvas, { reducedMotion });
    engine.start();
    engine.setRoute(location.pathname);

    const { initSwupChoreo } = await import('./transitions/SwupChoreo');
    initSwupChoreo(engine);

    if (import.meta.hot) {
      // Windows ANGLE kills the oldest GL context after ~16 live ones —
      // dispose on HMR so dev sessions don't leak contexts.
      import.meta.hot.dispose(() => engine.dispose());
    }
  });
}
