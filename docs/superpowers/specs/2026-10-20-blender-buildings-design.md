# Blender-authored buildings: homes outside the window, towers in the night city

**Date:** 2026-10-20 · **Supersedes:** the Kenney City Kit source in
`2026-08-09-lowpoly-city-lod-design.md` (placement, rings and runtime structure
stand; the modules and their textures do not).

## What changed

| | before | now |
| --- | --- | --- |
| Window district (Rooftops, CH2-3) | Kenney skyscrapers in an overcast deck | a **neighbourhood of homes**: 12 houses, 4 trees, streets, lawns, lamps |
| Night city (City, CH8) | Kenney blocks | 8 towers + 4 mid-rise blocks modelled in Blender |
| Triangles per module | 1,200-3,000 | towers 36-136, houses 10-106, trees 36-92 |
| Texturing | one 11 KB colour palette, flat shaded | one baked PBR atlas per set (colour, occlusion/roughness/metalness, normal, lit windows) |
| Source of truth | downloaded GLBs | `blender/` (procedural, re-runnable) |

## Why the triangle count dropped and the realism rose

Detail is modelled once in a high-poly twin and baked onto a flat shell (see
`blender/README.md`). Windows, trim, shingles and brick are texture, so a house is
a handful of polygons that read as a house. That is also what let the real-geometry
rings reach out to the horizon on HIGH instead of handing most of the city to
12-triangle impostor boxes.

## Lighting

- The homes take image-based light and glass reflections from
  `public/hdri/cloud_env_1k.hdr`, a path-traced volumetric cloud sea and cumulus
  baked in Cycles with no sun disc. Per-chapter `envIntensity` is pushed into those
  materials by `KitCity.setEnvIntensity`, because a material with its own `envMap`
  ignores `scene.environmentIntensity`.
- The night city keeps the scene's night probe: it must not mirror a daytime sky.
- Sun shadows are real-time on HIGH (direction changes per chapter, modules are
  instanced at four rotations): a 2048 ortho shadow window of +-56 units follows the plane
  and is snapped to whole texels so shadows do not swim; houses, trees, yard props and
  lamp poles cast, the ground, houses and yard decals receive. Occlusion with bounces is
  baked into every module, so shadow only has to add the cast shade.
- A hemisphere light is tinted per chapter by the sky above and the sunlit ground below
  (sky/ground bounce), so shade is never a flat grey. The ground is PBR on HIGH: the
  generator writes a normal map (aggregate, slab joints, curbs, cracks) and a roughness map
  (worn tyre lanes, paint) beside the colour map.

## Layout in the scene

`ROOFTOP_BASE_Y` is -3.2: the neighbourhood lies just under the window sill so the
plane leaves the window over rooftops and climbs away. At -14 (the tower district's
ground) the 3-unit-tall houses were 17 units under a camera that looks along the
flight line and never entered the frame. Two thin cloud sheets drift between the
rooftops and the plane.

## Close-up tier

Trees and houses have a **hero** version for lots the camera passes close to
(`rings.near`, HIGH quality only), so the cheap shells stay what the mid and far
rings use. Triangles are spent where a close-up can see them:

| | lean (mid ring) | hero (near ring) |
| --- | --- | --- |
| trees | 36-92 tris, blob crown on a card cluster | hero 8.7-10k (branching trunk, 1.4-2k leaf cards in lobes, pine whorls) within 13 units of the path; detail 2-3.4k out to 28 |
| houses | 10-106 tris, detail in the normal map | 2-5k: boards, shingle courses, louvres, door panels, gutters, steps, balusters |

Hero houses reuse the lean bake's slot pixels and the palette strip, so a house keeps
its colours and lit windows whichever tier is on screen. Budget on HIGH (rooftops):
47 near lots (hero), 129 detail trees, roughly 0.25M hero-tree, 0.3M detail-tree and
0.07M hero-house triangles. The rings are static per lot, so no tier ever swaps while
flying.

Manifest v2 describes this: `dir`, `atlas` (main sheet), `sheets{name: {atlas}}`, and
per module `sheet`, `lean` (hero -> the module it replaces), `kind`, `footprint`,
`height`, `tris0`.

## Atmosphere and life

- **Fog** is distance fog only, tuned per chapter: clear streets under the window, the far
  town dissolving into the horizon. `webgl/fog.ts` patches three's shared fog chunks so a
  chapter can also give the fog a ground-hugging term (`mist` in the grade: strength, boost,
  scale height, base surface), which thickens far ground and sea but not rooftops or sky.
  Fog colours are matched to each chapter's horizon so the town meets the ranges without a band.
- **Mountains** are a sky layer (`Mountains.ts`, `mountains.frag.glsl`): four procedural
  ridgelines by azimuth with face relief, snow and aerial perspective, pinned to the far plane.
- **Beyond the town**: a meadow surface and ~2,600 woodland trees as 20-triangle far-ring
  stand-ins; ~750 verge trees and windbreaks come from a random stream of their own so no
  house moves, and never get the close-up tier.
- **Streetlights** (`Streetlights.ts`): a pole, raked arm and cobra-head luminaire at every
  lamp position, one instanced body, lens and (HIGH) soft light cone each, plus a halo
  layer; they burn at night and go out as the sun comes up (`lampLevel` in the Engine).
- **Life**: ~1,700 fence runs (cards, real boards near the flight), cars driving every street
  with car-following and parked in yards, and per-lot yards (`Yards.ts`) with decals, props,
  tufts and lights from a seeded stream.
- **Sea**: six Gerstner waves whose Jacobian drives foam, mipmapped normal/foam maps, Fresnel
  reflection of the live sky, and the beam raking across the swell.

## Known limits

- One cloud environment serves all chapters of the homes (graded by intensity, not
  by colour).
- Far-ring houses and trees are procedural stand-ins, not the modules.
