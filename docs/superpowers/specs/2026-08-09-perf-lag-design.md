# Perf: lag fix — pixel budget + single-smoother scroll

**Date:** 2026-08-09 · **Status:** approved (options 1+2 of 3; adaptive governor deferred)

## Symptoms

User: "lags like hell" — (a) everywhere, constant; (b) scroll feels behind.
Hardware: Intel UHD (Comet Lake), tier `low`. Measured: real-scroll rAF p99 47ms,
worst 73ms; scroll latency by construction ≈ 850ms (Lenis lerp 0.1 ≈ 350ms
stacked under engine `renderT` damp λ6 ≈ 500ms).

## Fix 1 — pixel budget (fps floor)

The built post chain is RenderPass + EffectPass(Bloom mipmap + Vignette) on a
HalfFloat framebuffer; on an iGPU the cost is fill-bound — pixels, not passes.
Cut pixels on LOW, leave content untouched:

- `quality.ts`: new `renderScale` (LOW **0.75**, HIGH 1). LOW `maxDpr` 1.5 → **1.0**.
- `Engine.resize`: `dpr = min(devicePixelRatio, maxDpr) * renderScale`.
- On a 1920×1080 window at Windows 125% (dpr 1.25): 3.24MP → 1.17MP (−64%).
- Night grade + bloom hide the upscale; no scene detail removed.

## Fix 2 — single-smoother scroll (the "behind" feel)

Two smoothing layers stack today. Make the engine damp adaptive and tighten
Lenis so smoothing is paid ~once:

- Engine: `λ = lerp(6, 16, clamp(|target − renderT| / 0.01, 0, 1))` — tight
  chase while the world is >1% of the story behind, cinematic settle near rest.
  Continuous blend, no pop. Reduced-motion snap path untouched.
- Lenis: `lerp: 0.14` (default 0.1) — keeps wheel normalization, less lag.
- Expected end-to-end trail ≈ 150–250ms (from ≈ 850ms).

## Deferred (option 3)

Adaptive resolution governor (frame-time monitor stepping DPR 10% at a time,
floor 0.6). Revisit only if 1+2 measure insufficient on real hardware.

## Verification

- gl.finish-probed per-chapter medians before/after at forced dpr 1.25.
- renderT convergence time after a scroll burst (target < 300ms).
- Visual spot-checks: CH1 room, cloud sea, beacon, city dive at LOW.
