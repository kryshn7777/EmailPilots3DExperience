# Low-poly building system: kit-instanced cities with baked LODs

**Date:** 2026-08-09 · **Status:** approved (Approach 1 of 3) · **Applies to:** Rooftops (window city) + City (CH8 dive)

## Goal

Replace box-extruded massing with real hand-modeled low-poly buildings,
procedurally placed, LOD-optimized, inside a hard mobile budget. The flight
must run smoothly on mid-range Android (~2020+, Adreno 6xx / Mali-G7x).

**Budget (mobile tier):** ≤150k triangles on screen, ≤80 draw calls total
scene, no volumetrics, half-res effects (existing LOW tier), far buildings
always impostors. Desktop keeps full detail.

## Source: Kenney City Kit Commercial (CC0)

- Direct-download scrape verified working today (pirate kit came down the
  same `kenney.nl/media/pages/assets/<slug>/<hash>/<file>.zip` pipe).
- `scripts/fetch-models.mjs` gains a Kenney zip path: download, unzip, pick
  the module GLBs, `gltf-transform optimize --compress quantize`.
- Committed to `public/models/city-kit/` (license CC0, no attribution
  needed). Asset weight target ≤2.5MB total.
- Module set (~12–18): small/medium/large building segments — base, mid,
  top — plus 2–3 skyscraper variants and 1–2 low commercial blocks.

## Procedural placement (ours, unchanged philosophy)

`cityGen.mjs` keeps the seeded layout: lots, canyon clearance, cross
streets, height ramp toward the canyon. Each lot now resolves to:

- module id (weighted by lot size + height class),
- stack recipe for towers: base + N×mid + top (procedural height stays),
- yaw (0/90/180/270), per-instance tint (small palette around `#39415a`).

Footprint fitting: modules normalized to 1×1 lot units at bake time, scaled
per lot w/h/d — plain box-ish kit modules tolerate non-uniform scale (same
rule that made WoodenTable_02 work).

## LOD: baked, chunked, zero per-frame CPU

Three levels per module, generated at build time by `scripts/bake-city.mjs`:

- **LOD0** kit mesh, ~300–800 tris — near ring only.
- **LOD1** `gltf-transform simplify` to ~25% — mid ring.
- **LOD2** impostor: 12-tri box with the existing emissive `facadeTexture`
  (windows live in the texture) — far ring, and the ONLY level mobile's far
  field ever renders.

The camera rides a known spline, so rings are baked per chapter: the bake
script samples camera positions along each city's visibility window,
partitions lots into NEAR / MID / FAR chunks by worst-case distance, and
emits one instanced buffer per (module × LOD × chunk). Runtime does zero
LOD math — chunks toggle with the same t-window logic every actor already
uses. Pops are deterministic → tunable by moving ring radii in the bake.

Output format: one GLB per city containing the chunked instanced buffers
(EXT_mesh_gpu_instancing), loaded like the current massing GLB; the
procedural fallback path stays for offline dev.

## Runtime

- One `InstancedMesh` per (module × LOD) alive at a time; expected draw
  calls: ~15–20 buildings + existing dressing. Instance tints via
  `instanceColor` (NEVER geometry vertexColors — ANGLE/D3D black-frame rule).
- Emissive windows: existing instanced quads survive but only spawn on
  NEAR+MID chunk buildings; FAR windows are texture-only.
- Roof clutter/parapets/billboards: NEAR chunks only.
- Existing massing GLB + gray-box path deleted once parity verified.

## Mobile tier wiring

`quality.ts` gains `cityRings: { near: number; mid: number }` distances —
LOW pulls both one step closer (NEAR shrinks ~40%, MID becomes impostors).
Phone detection: existing coarse-pointer + small-screen check routes to LOW
(HIGH stays desktop default per the max-settings decision).

## Verification

- `renderer.info` (calls, triangles) sampled at t 0.125 and 0.72 on both
  tiers — must meet budget numbers above.
- Finished-frame medians per chapter (existing probe protocol) before/after.
- Visual parity strips at the same t values; banned-phrase grep untouched
  (kit assets carry no text).
- Mobile proxy: `?q=low` + DevTools mid-tier Android emulation + CPU 4×
  throttle; real-device check when available.

## Risks

- Kenney URL/hash rot → GLBs committed, fetch script is bootstrap-only.
- Kit module pivots/scales inconsistent → normalize at bake, not runtime.
- Canyon clearance with kit footprints → clearance check runs against the
  scaled module bbox, rebake required (documented in cityGen).
- EXT_mesh_gpu_instancing support → three GLTFLoader handles it natively;
  fallback = expand to InstancedMesh manually at load.
