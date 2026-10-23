# Close-up detail and life: hero towers, window glass, denser trees, a populated town and city

**Date:** 2026-10-23 · **Builds on:** `2026-10-20-blender-buildings-design.md` (sets, sheets, rings,
the lean/hero split stand; this adds tiers and content).

## What changed

| | before | now |
| --- | --- | --- |
| Night-city buildings near the canyon | 36-136-triangle shells with a baked normal map, flat at grazing angles | a `hero-towers` sheet: the high-poly twins (shopfronts, awnings, lit signs, lobbies, fire escapes, AC units, mullions, sills, cornices) on the ~70 lots within 12 units of the dive |
| Hero houses | 2-5k triangles, panes baked into the atlas | 2-8k: muntins, flower boxes, door lanterns, mailbox and number, frieze, foundation vents, condenser, roof stacks and vents, porch light; panes are a separate glass mesh |
| Windows (hero tier) | a baked colour and glow | interior-mapped rooms behind a Fresnel near-mirror: depth and parallax, curtains, blinds, lamps that follow the hour |
| Hero trees | 8.7-10k, 1.4-2k cards, no bark normals, static | denser and finer (2.3-3.3k smaller cards, a twig level, rounder trunks, bark normal map), hero ring 12 -> 15 units; wind sway and back-lit translucency in the shader |
| City street trees | five-icosahedron blobs | the homes set's trees (hero beside the dive on HIGH, detail elsewhere), with tree grates |
| Town street furniture | none | hydrants, stop signs with street-name blades, bins out for collection, bus shelters with a bench and a newspaper box, dropped bikes |

Cars (supercars and more close-up detail) and pedestrians are documented in `blender/README.md`.
Screen-space global illumination, traced reflections, the live reflection probe and the lamp shadows
are listed in the top-level `README.md` ("Lighting, reflections and shadows").

## Budget (HIGH)

Hero towers are 17k (curtain walls) to 165k (the stone cross-plan tower) triangles, so the night
city's `near` ring (18 units, 163 lots, which also places neon and billboards) is not the hero ring:
`rings.city.high.hero` (12 units) is, ~70 lots and ~1.9M triangles in 12 instanced draws, most of them
blocks (20-35k). The ring is static per lot, so nothing swaps in flight. Phones never load the hero
sheets.

## Lighting

- Window glass is a `MeshStandardMaterial` (roughness 0.035, metalness 0) so the sun and the
  environment are reflected by the same PBR the rest of the scene uses; the room is added as emission
  scaled by (1 - Fresnel). `windowLight.day` and `windowLight.lamp` are set from the grade's sun level,
  so rooms are dim daylight boxes at noon and lamp-lit at dusk; the night city's towers are always in
  lamp mode.
- Homes' glass mirrors the baked cloud environment at 1.25x the walls' strength; the night city's
  glass mirrors the scene's night probe.
- Leaf cards take extra light from the sun when it is behind them (a forward-scattering lobe plus a
  wrap term), the look of a canopy against a low sun.

## Known limits

- The glass's room tangent frame assumes vertical windows (every pane in the sets is).
- Foliage sway is not applied to the shadow-map pass, so shadows do not move with the leaves (the
  sway is a few centimetres).
- The lean city sheet was re-baked from the same twins, so its shopfronts, signs and fire escapes are
  painted (not modelled) on the mid-ring buildings.
