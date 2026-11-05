# Astro Starter Kit: Minimal

```sh
npm create astro@latest -- --template minimal
```

> 🧑‍🚀 **Seasoned astronaut?** Delete this file. Have fun!

## 🚀 Project Structure

Inside of your Astro project, you'll see the following folders and files:

```text
/
├── public/
├── src/
│   └── pages/
│       └── index.astro
└── package.json
```

Astro looks for `.astro` or `.md` files in the `src/pages/` directory. Each page is exposed as a route based on its file name.

There's nothing special about `src/components/`, but that's where we like to put any Astro/React/Vue/Svelte/Preact components.

Any static assets, like images, can be placed in the `public/` directory.

## The home page: experience, then landing

`src/pages/index.astro` is two components, one after the other:

- `src/components/Experience.astro`: the scroll-driven flight. It is the scroll *stage* (`#experience`) the fixed WebGL canvas plays along to. The canvas itself lives in `src/layouts/Base.astro`, outside the Swup container, so it survives navigation. The master ScrollTrigger (`src/webgl/scroll/ScrollDirector.ts`) measures from the top of the page to the bottom of `#experience`, so content placed after it never stretches the flight. Its copy is hidden by default (canvas only); `?copy=1` shows it.
- `src/components/Landing.astro`: the website. It is ordinary page content that scrolls up over the canvas once the experience has finished: the nav comes back (`body.is-landing`, set by `src/page.ts`), the engine pauses behind it, and a "Replay the flight" button returns to the start. All of its words come from `src/story/copy.ts`.

The landing reads top to bottom as a pitch: what it is (`INTRO`), the problem it solves (`PROBLEM`), how it works (`STEPS`), the deliverability safeguards (`SAFEGUARDS`), the last mile (`LAST_MILE`), the local AI (`LOCAL_AI`), the mailboxes (`MAILBOXES`), who it is for (`AUDIENCES`), why it is different (`WHY`), the ten stops (and the detour) in brief, the plan, FAQ, and a closing call to action. Every line is checked against `FEATURES.md` Appendix B; no placement guarantees, no tiers, no tracking claims.

To add landing content, edit `Landing.astro`; to change the flight, edit `src/webgl/` and `src/story/`.

## The office detour

Above the night city, early in the copilot climb, the dart flies into the glass of the tower beside it; the story cuts to an open-plan IT office on one of its floors, an envelope follows the dart in and is swallowed by the one laptop that is on ("Email delivered"), and the dart leaves through the facade, climbs into the night sky over the city, dives, and rejoins the flight toward the airliner.

It is a scroll detour, not a chapter: story-t stops at `T_S` = 0.79 while a sub-timeline `u` runs 0..1 over one extra 120vh spacer (`[data-detour]` in `Experience.astro`), then t continues, so every chapter keeps its numbers. `src/webgl/rig/detour.ts` maps scroll progress `p` to `(t, u)`: with `W` the spacer's share of the timeline (measured at runtime, 120/1220 = 0.098 on the home page) and `Ps = T_S (1 - W)` (0.712), `t = p / (1 - W)` before `Ps`, `t = T_S` and `u = (p - Ps) / W` inside, `t = (p - W) / (1 - W)` after. The Engine springs `p`, not t, and caps how fast a flick may run `u` so each cut always plays under its flare; `node --experimental-strip-types scripts/check-detour.mjs` tests the mapping. The HUD's progress bar follows `p` (`flight:progress`); its chapter readout says DETOUR while `u` runs.

| u | What happens | Where |
|---|---|---|
| 0 - 0.08 | off the main line at P(0.79) on its tangent, into the tower nearest it that stands 3+ above the dart (picked from the city's lots at runtime, the entry put on the real glass by a ray) | city |
| 0.08 | white flare, cut | |
| 0.08 - 0.66 | establishing shot from the window; the envelope after the dart into the live laptop; the screen flips idle to received and the card comes up; the dart circles and heads back out | office |
| 0.66 | flare, cut | |
| 0.66 - 1 | the dart bursts out of the facade (glass shards), climbs to about y 40, turns, dives and joins the line on its tangent: at u = 1 camera and dart are the main rig's | city |

The camera and dart come from `rig/officeShot.ts` (keyframes like `studyShot.ts`, pure in `u`), laid over the chase camera last by `CameraRig.detour`, whose weight is 0 at both ends. The office (`src/webgl/actors/Office.ts`) is its own stage 200 below the world, drawn at twice life size (props in metres, `ROOM_K` = 2) so the dart at 0.45 scale is in proportion; while the camera is in it the Engine hides every other group and lays `OFFICE_GRADE` over the chapter grade. Its window shows the real city, rendered once from the tower's facade into a texture when the city has streamed in. The furniture (`OfficeProps.ts`) is batched by material: the models from `public/models/office/` (`manifest.json`: `{ file, nodes: [{ name, size, emissive }] }`, one root node per prop, origin at the floor centre, Y up, metres) wherever a node of that name exists, primitive stand-ins of the same names otherwise. Light: a desk-lamp spot (shadowed on HIGH), the live screen's spill, glowing monitors, panels and rack LEDs, and the scene's sun and sky light turned into a soft ceiling light.

## Sky, clouds, sun and sea

All of it lives in `src/webgl/` and is drawn per frame; nothing is pre-rendered.

| piece | where | what it does |
| :-- | :-- | :-- |
| Cloud noise | `bake/cloudNoiseGen.ts`, `bake/CloudNoise.ts` | Two tileable 3D noise volumes (Perlin-Worley shape, Worley detail), baked in a worker a moment after boot. Every cloud shader reads them with a filtered fetch instead of evaluating noise. |
| Sky layer | `shaders/sky.frag.glsl` | The dome's gradient, the sun, and a high cloud layer shaded like a thin volume (a few fetches a pixel). Cover per chapter is `cloud` in `story/chapters.ts`. |
| Cloud slab | `shaders/cloudVolume.frag.glsl`, `actors/Clouds.ts` | The raymarched cumulus the flight climbs into (HIGH tier): multiple scattering, a hard forward lobe for the silver lining, empty space skipped at a coarse mip. Cheaper per step than the simplex version it replaced. |
| God rays | `post/GodRays.ts`, `shaders/godrays.frag.glsl` | A quarter-resolution radial march toward the sun, composited additively. Depth and the colour buffer's alpha (the share of sun still reaching each pixel, see `materials/skyVisibility.ts`) decide what blocks it, so shafts fall through real gaps in the clouds. |
| Sea | `shaders/ocean.*.glsl`, `materials/PlanarReflection.ts`, `actors/Beacon.ts` | Gerstner swell, four scales of normal map, rain ripples, GGX glints for the moon and the lamp, and (HIGH tier) a mirrored-camera reflection of the lighthouse, ship, beam and sky. |

Inspecting them: open the page with `?probe` to expose `window.__engine`; `?norays` leaves the god rays out
for an A/B; `?q=low` forces the phone tier. `__engine.godRays.debug = 1` shows the shafts alone and `2` shows the
sun-visibility alpha.

## Lighting, reflections and shadows (HIGH tier)

| piece | where | what it does |
| :-- | :-- | :-- |
| Global illumination | `post/SSGI.ts` | One diffuse bounce gathered from the lit frame (20 samples on a spiral sized in world units, half resolution, depth-aware blur): lawns green the walls above them, brick warms the pavement, neon and lit windows spill onto the street. Strength per chapter is `bounce` in `story/chapters.ts`. |
| Traced reflections | `post/SSR.ts` | Screen-space ray march (48 growing steps, binary refinement) against the depth buffer. Upward, unsaturated surfaces are wet in patches (`wet` per chapter: the night city's asphalt is near a mirror), everything else reflects by Fresnel. |
| Normals for both | `post/viewSpace.ts` | Rebuilt from depth once a frame: the NormalPass buffer also holds the transparent light cones, which would tilt the ground under every lamp. |
| Live reflection probe | `materials/ReflectionProbe.ts` | A cube camera near the viewer renders the real street, one face a frame, and three prefilters it: car paint, chrome and windscreens and the close-up window glass mirror the houses, trees, lamps and neon that are actually there. |
| Window glass | `materials/WindowGlass.ts` | Interior-mapped rooms behind a Fresnel near-mirror on every close-up pane (see `blender/README.md`). |
| Lamp shadows | `actors/Streetlights.ts`, `layers.ts` | Three of each street's lent lamp lights are shadow-casting spots that only draw `LAMP_CASTER_LAYER` (cars, people, street furniture, posts), so the things passing under a lamp throw moving shadows without redrawing the buildings. |
| Rain at the lighthouse | `actors/Rain.ts`, `actors/Beacon.ts` | Wind-driven streaks a pixel wide around the camera, each lit where it falls: by the lamp, by the sweeping beam (brightest looking up the beam), with a forward glint toward the light; splash rings on the water; the sea's planar reflection mirrors the rain, and the tower, rocks and roofs are rain-soaked (darker, glossy, mirroring the live probe; `wet` 0.95 for the traced reflections). |
| Lighthouse arrival | `actors/Beacon.ts` | In order: the sea comes up under the storm's let-down, the lamp and its beam glow out of the murk, then the tower and islet form out of the mist (shaded toward the mist's colour, the last of it dissolved away), so the islet never hangs over empty sky. The sweep is a light on the freighter too: a soft-edged cone from the lantern along the beam lights the hull and the containers as it comes round. |
| Foliage | `actors/KitCity.ts` | Trees sway in a wind that travels across the town, cards flutter, and a low sun glows through the leaves. |
| Volumetric fog | `post/VolumetricFog.ts` | The air over the town lit by the sun with the sun's shadows in it: every pixel of a half-resolution buffer marches 32 steps through an exponential height fog broken into drifting banks, asks the sun's shadow map at each step whether the sun reaches it, and scatters sunlight toward the eye (a forward Henyey-Greenstein lobe) where it does. That draws the shafts between houses and through trees, and the golden depth of a hazy evening. Depth-aware blur and a joint-bilateral upsample keep roof edges clean. Per chapter: `volume` in `story/chapters.ts`. |
| Sun in the haze (every tier) | `fog.ts` | The fog every material shares takes on the sun's colour when looking toward it (`inscatter` per chapter), a broad glow and a tight core: the directional inscattering of an engine's height fog. |
| Key light | `story/chapters.ts` (`key`) | Scales the sun's direct light alone, so the town gets a low, raking sun and long shadows while the street lamps are already on. |
| Lens flare | `post/GodRays.ts` | While the sun's disc is in frame: glare, a starburst, an anamorphic streak and aperture ghosts along the sun-to-centre axis, hidden by whatever stands in front of the sun (depth) or the clouds over it (sky alpha). |

`?nogi`, `?nossr` and `?novol` leave the screen-space passes out for an A/B; with `?probe`,
`__engine.ssr.debug = 1` shows the reflections alone (2 the reflectivity, 3 how far each ray went),
`__engine.ssgi.debug = 1` the bounce light and `__engine.volume.debug = 1` the light scattered by the air.

## Transitions

Chapters hand over inside weather, not by cutting: whatever leaves is veiled before it goes and whatever
arrives forms out of the veil (all keyed to story-t, so a scrub replays them exactly).

| seam (t) | what happens |
| :-- | :-- |
| formation to storm (0.335 to 0.38) | the town is swallowed by the closing fog, and the storm's first bolts strike as it goes |
| storm to lighthouse (0.40 to 0.54) | the sea rises under the storm first, then the tower and islet come out of the sea fog, then the freighter beyond them. The fog is an extinction by distance (`Beacon.ts`, `MIST_FRAG`): each fragment is kept with probability exp(-density x its range to the lens) and the rest goes to what lies behind it in the murk (pale sky above the horizon, dark sea below), so the base and the top of the tower, and the bow and the funnel of the ship, come out together; the density eases to exactly 0 (tower 0.452 to 0.515, ship 0.462 to 0.54). Neither model is drawn until it has loaded completely, geometry and every texture, and one that arrives late eases up over 1.5 s instead of appearing. The mist banks stand on the lens's side of what they veil (never through it), fade out to the water at their lower edge and thin with the same fog; the sweep lights the ship |
| lighthouse to city (0.59 to 0.71) | fog draws in as the sea goes and the night cloud deck thickens into a bank across the gap; the city is switched on inside it and powers up in a wave (street lamps first, then windows, glass and neon) while a mist stands on its streets and thins as the flight dives in; the lightning carries across and lands on the roofs |
| copilot to the airfield (0.82 to 0.9) | the descent goes through cloud: fog closes while the starfield is left behind, the airfield is switched on inside it, and the edge lights, the threshold bars and PAPI, then the approach rabbit come up as the runway appears |

The seams are also continuous in SPEED now: the flight line is linear per chapter in story-t, so the world
used to change speed at every seam (2.3x at desk to preflight, 2x at preflight to takeoff); the pace warp
(see Scroll feel) gives each stretch of story-t the pixels that make the world's speed per pixel continuous
across them (worst seam 1.06x). Beats keyed to story-t (holds, titles, the delivery, the cuts) are untouched:
only how much scroll each stretch of t gets has changed.

## Loading and frame cost

| What | How |
|---|---|
| Chapter seams | `Engine.warmSeams` links each distinct visibility state's lit programs (three keys them on the visible light count) against the composer's own buffer, in story order, off the render thread. Town seam: 59 programs linked on the spot before, about 10 now (the rest are shadow-depth variants) |
| Late arrivals | the town, city and lighthouse ask for a warm pass as they stream in (`warm.ts`), coalesced into one |
| Normals | SSAO reads the same depth-rebuilt normals as SSGI/SSR; the full-resolution `NormalPass` (a second draw of the whole scene) is gone |
| Shadows, probe | the sun's shadow map and the reflection probe refresh every other frame |
| Town trees | the rings of the flight line say which tree model a lot MAY use (ultra ~50k triangles, hero ~15k, detail ~2.4k, lite ~700, lean ~90), and `KitCity.updateTrees` picks the model by camera distance each frame (ultra within 10 units, hero 24, detail 50, lite 90, lean beyond; phones 24/50), and a tree beyond 28 units that the lens cannot see is not drawn at all (repacked on a 2-unit move or a 3-degree turn), so only the trees near the lens are dense. Triangles in the town frame at the window exit: trees about 3.4M before, about 0.95M now |
| Resolution | the frame-time governor runs on every tier (high: 0.6–1× of the device ratio, steps down above 21 ms and back up after 8 s of headroom) |
| Loading | meshopt decoding on two workers; the sky HDRI is preloaded; the nav island hydrates on idle |
| Load readiness | `load/Readiness.ts` puts every model and texture request (three's DefaultLoadingManager) on a gate at the story-t where it is first needed (town 0.09, biplane 0.32, sea and lighthouse 0.46, city 0.6, office T_S, airliner 0.83). The scrub spring's target is held short of the first closed gate (never behind the frame, released after 12 s whatever happens) and a small "loading the next leg" cue shows. Nothing registered means open |
| One clock | the engine renders from `gsap.ticker`, registered after Lenis' tick: each frame is Lenis, ScrollTrigger, the progress, then the render (it had its own requestAnimationFrame, in no fixed order with Lenis). A hidden tab resets the frame clock. Under reduced motion it draws only while the spring moves |
| ?perf | `debug/Perf.ts`: p50/p95/p99 frame time over 600 frames, frames over 33 ms by the seam they fell near, the governor's scale and tier, world units per 100 px, v/h, the spring's error and the input kind; `window.__perf.snapshot()` |

## Scroll feel

How a pixel of scroll becomes motion (`scroll/ScrollDirector.ts`, `scroll/spring.ts`, `rig/pace.ts`).

**Pace warp.** Scroll progress -> `detourMap` (linear t, as before) -> `paceT` -> story-t; the inverse is
`progressOf(paceLin(t), W)` (sub-page presets, the rail's ticks, jumps). The warp asks for a world speed per
pixel of `h^0.6 / dwell`, h the camera's height over what is under it (desk top, the town's ground at -3.2,
the formation deck at 21, the sea at 7, the city at 0, the airfield at 0.5; at most 5 in the canyon),
clamped 0.8..14; blended 65/35 with today's authored balance in log space; clamped to 0.5..2x of today's
pixels and never faster than today where the camera already accelerates hard (above today's 95th
percentile); Gaussian-smoothed (0.012 in t); normalised separately on [0, T_S] and [T_S, 1] so 0, T_S and
1 stay put and the total length is unchanged. Dwell (x the pixels): each pinned title +0.35 over its
middle, the delivery +0.3, touchdown +0.3, the launch +0.2. The office clock has its own (`paceU`): slope 1
within 0.03 of both cuts (MAX_U_RATE and the flares are unchanged), 0.65 over the received card.
The flight line's arc-length table went from three's default 200 divisions to 4096: the dart's speed
rippled +-10% every ~1.6 units and dipped/spiked at seams (positions move by at most 0.4 units, along the
same line).

`node --experimental-transform-types scripts/check-pace.mjs` (900 px viewport, 10980 px stage; `--baseline`
for the linear map; `scripts/pace-baseline.json` is the measurement before any of this):

| chapter | px before -> after | world / 100 px | v/h | cam acc p95 (1e-4/px^2) |
| :-- | --: | --: | --: | --: |
| desk | 892 -> 837 | 1.02 -> 1.06 | 1.15 -> 1.20 | 0.53 -> 1.98 |
| preflight | 791 -> 705 | 2.58 -> 2.95 | 0.42 -> 0.48 | 6.67 -> 7.26 |
| takeoff | 892 -> 1337 | 5.59 -> 3.69 | 1.53 -> 1.01 | 8.54 -> 4.18 |
| formation | 990 -> 821 | 2.88 -> 3.53 | 0.41 -> 0.50 | 5.15 -> 6.49 |
| storm | 1188 -> 968 | 2.99 -> 3.61 | 0.45 -> 0.54 | 3.67 -> 6.20 |
| beacon | 990 -> 861 | 3.53 -> 4.12 | 0.27 -> 0.32 | 6.87 -> 7.93 |
| no-fly | 791 -> 624 | 3.90 -> 4.88 | 0.28 -> 0.35 | 8.67 -> 7.69 |
| city | 1188 -> 1548 | 3.54 -> 2.75 | 1.44 -> 1.11 | 5.14 -> 3.15 |
| copilot | 993 -> 740 | 4.19 -> 5.53 | 0.40 -> 0.52 | 17.44 -> 28.76 |
| landing | 1188 -> 1460 | 4.72 -> 3.86 | 3.47 -> 2.83 | 6.08 -> 2.09 |

Worst seam speed ratio 2.34 -> 1.06; spread of v/h^0.6 across chapters 198% -> 150%; of world speed
131% -> 124%; camera acceleration p95 over the whole flight 7.21 -> 6.95 (the single worst spike, in the
formation climb, 120 -> 173). A spread of world speed under 35% is not reachable with a height-aware
target and 35% of today's balance kept; the script asserts that the spreads shrink and the p95 does not grow.

**Spring.** `spring.ts`: exact critically damped (zeta 1, up to 1.4 above 0.4 progress/s) solution in
fixed 1/120 s substeps; on crossing the target it lands and stops (no swing back); snap only under 1.5e-5
of the story (~0.16 px) and nearly still. Replaced K 120 / C 17.5 (zeta 0.80, one Euler step a frame),
which came back after a key jump and snapped the last 0.0004 (4.4 px) in one frame. The detour's speed
cap runs after the step. `node --experimental-strip-types scripts/check-spring.mjs [--old]` replays input
through a model of Lenis at 60 Hz, 144 Hz and a jittered clock: overshoot 0.07-0.33% with a reversal on
every key jump before, 0 and none now; settle within 0.36 s of the scroll stopping (0.8 s when the move
crosses the detour, which the cap holds back on purpose); last frame's move under 0.25 px (2.4 px before).

**Input.** Lenis' `virtual-scroll` classifies the device: a wheel notch (line mode, or a whole number >= 50
px) gets lerp 0.075 and spring w 9; a trackpad (fractional or small deltas, held for 300 ms) lerp 0.14 and
w 13; touch stays native (syncTouch off) with w 12. Space, Page Up/Down, the arrows, Home and End are eased
`lenis.scrollTo` jumps (0.9 or 0.15 of the viewport, 0.6 + 2.4 x the share of the story, 0.6..1.8 s,
easeInOutCubic) with w 16; keys aimed at a field, button or link are left alone.

**Camera at speed.** vp = |d dart| / dt / h, smoothed; s = smoothstep(vp, 4, 18) x (1 - detour weight):
the lens opens up to 3.5 degrees, turbulence x(1 + 0.6 s), the contrail reaches 0.8..1.6x as far back, and
on HIGH a zoom blur of up to 0.12 above vp 8..25. The look target damps at 10/s (was 6), the dart's bank
is low-passed at 12/s. At rest (1.2 s, eased in over 1.5 s) the camera drifts 0.04 units on a 7 s noise
and the lens breathes +-0.3 degrees. None of it under reduced motion, where the spring is a stiff w 20.

**Chrome.** A first-load "scroll" cue (gone after 40 px), the progress rail's chapter ticks (placed through
the pace warp; click or Enter jumps there), the sound toggle; in the canvas-only mode too, faded out 2.5 s
after the last input. With `?copy=1` the copy reveals shorten from 600 to 250 ms with speed.
Phones: the canvas is `100lvh` (the URL bar no longer resizes it), `overscroll-behavior: none`,
`ignoreMobileResize`, height-only resizes under 120 px on touch screens are ignored; the HUD, rail and
toggle keep to the safe area.

**Wind** (`audio/Wind.ts`, off by default, remembered): brown noise through a band-pass at 300 + 1500 s Hz
at gain 0.02 + 0.10 s, a 250 ms whoosh on a sharp gain in speed, rain hiss in the storm, a 0.1 Hz swell at
sea, a low hum over the city. No files; the AudioContext is made on the first switch-on; suspended in a
hidden tab; never under reduced motion.

Needs a real device to judge: the feel itself (wheel, trackpad, touch momentum, 120 Hz screens), whether
the input classifier guesses right on a given mouse, the lvh/URL bar behaviour on iOS and Android, and the
wind's mix.

## Pinned titles

Each chapter's title stands in the world (`src/webgl/actors/PinnedTitles.ts`): a canvas-drawn lockup (heavy / thin / heavy condensed capitals, Oswald) on a plane with the depth test on, so towers, trees and the lighthouse pass in front of it and the haze dims it, the way a camera-tracked title is made in a film. The words come from `PINNED_TITLES` in `src/story/copy.ts`.

A spot can carry a `portrait` alternative for phones, whose lens is less than a third as wide: the ocean title ("Send mail to anyone, anywhere in the world", 0.452 to 0.512) stands on the water to the left of the lighthouse on a landscape screen, and straight ahead behind it on a phone, where it is read while the tower is still in the fog and goes as the tower comes out in front of it.

The rig directs a different camera in every chapter, so each title's spot (`SPOTS`) was fitted to the camera across its window: the position that stays nearest the middle of the lens while the chapter plays. Where the camera looks steeply down, the title lies flat over the scene. If a chapter's camera changes, sample the camera across its window and refit that spot.

## Town realism

The town read as a game for a handful of reasons, each one fixed where it lives:

| Cause | Fix |
|---|---|
| Light clipped to flat colour (no tone curve, hot sun, bloom from 0.85) | A neutral, hue-keeping tone curve (`filmic`, `exposure` in a chapter's grade, `post/Cinema.ts`), a lower sun key, bloom from 1.0 at 0.45 strength |
| Primary-coloured lawns, shirts, umbrellas, play sets, flowers | `sat` in the grade (0.85 for the town), `Lawns.ts` pulled toward luminance, `muted()` on the prop and clothing palettes |
| No anti-aliasing (the composer has no MSAA) | An SMAA pass last in the chain on HIGH |
| Blocky roof moss and lichen, lawn patches | Wider, rotated noise octaves and softer thresholds in `Roofs.ts` and `Lawns.ts` |
| Ground cell drawn at the wrong scale (4.5 m slabs, 4.5 m by 42 cm dashes, 2.7 m front walks) | `blender/make_ground.py`: 1.5 m slabs, 3 m by 12 cm dashes at a 12 m period, 1.2 m walks; re-baked (numpy only) |
| Lamps half-lit and fog dark navy under a low sun | `lampLevel` goes out as the sun rises, the town's fog starts at 20 and is warm grey |
| Blue metal puddle blobs | Dark dielectric water, mirroring the live probe |
| Warm cast, flat light, washed shafts | `balance` (white balance), `rays` and a lighter sun colour in the town grades; shafts are tinted halfway to white; fog is a cool grey from 40 units |
| Toy props and crowding | Faceted icosphere canopies are welded lumpy foliage masses; about a third of the people; lighter contact shadows; SSAO 1.6; duller car paint |
| Procedural toy props (icosphere shrubs, cone evergreens, ball canopies) | `blender/make_buildings.py` `YARD_PLANTS`: the tree generator at hedge scale (`hero_trees.PARAMS` shrub, shrub-red, arborvitae, ornamental), borrowing the town's leaf cards and bark so the atlas is unchanged (`--reuse-maps`); `Yards.loadModels` swaps them in on the lots the flight passes close by (about 0.5M triangles), the procedural plants staying elsewhere and until they load |
| Miniature look from the lens | Background blur, chromatic aberration and lens flare cut back |

## Birds at the window

The flock that leaves the study window (t 0.055 to 0.3) is rock pigeons with a few starlings, and a black-headed gull in the squad that crosses the lens as the plane clears the window (`src/webgl/actors/Birds.ts`). They are modelled and baked in Blender (`blender/make_birds.py`, see `blender/README.md`, "Birds"; nothing external, see `public/models/birds/CREDITS.md`): a body with its eye, beak and tucked feet, and wings and tail of layered feathers (primaries, secondaries, coverts, alula, scapulars, rectrices) as alpha-tested cards on one baked atlas, lit by the scene's sun, sky and environment like everything else.

- *Flight.* A shader rig: per bird the CPU writes elevation, fold, twist and load; the vertex shader turns each wing about its shoulder, elbow and wrist (weights blended across each joint, so the membrane and coverts stretch). The downstroke is extended and pronated with the primaries bending under the load, the upstroke flexes elbow and wrist. Birds glide now and then (pigeons in a raised V), bob with the stroke, point along their velocity and bank into turns (lift balances gravity plus the turn), fanning the tail. Pigeons beat at about 6 Hz, starlings 10, the gull 3.
- *Shading.* The neck's green-purple sheen turns with the view (a mask in the ORM's B), feather undersides are paler, the low sun glows through thin feathers, and tucked feather roots carry their own occlusion.
- *Cost.* Three instanced draws (one per species) on both tiers; 13 birds are about 22k triangles on HIGH and 3.5k on phones (the lean set: one card per wing surface). The update writes 13 matrices and 26 vec4s a frame. The paths and timing are the paper-plane birds' (the stream on absolute time, the squad keyed to t); `?probe` with `window.__birdTime` freezes their clock for inspection.

## Lived-in yards

A neighbourhood where every lawn is clean reads as a model. `actors/YardClutter.ts` adds what households leave lying around, on the lots `Yards` already dresses:

- *Kerb and front yard.* Paper leaf bags at the kerb or on the lawn, sometimes one fallen over. A trash bag. Green utility pedestals in front corners. Three kinds of mailbox (replacing Yards' stand-in). Pumpkins on the steps. Gnomes in the beds. Bikes, kid bikes and scooters dropped on their sides, balls and a toy truck. A portable basketball hoop at the end of the drive. A covered car on an empty drive. A mower stopped mid-lawn. A hose snaking out from the side of the house.
- *Back yard.* Rotary washing lines with laundry. Hot tubs, picnic tables, and stone fire pits with odd chairs round them (monobloc, patio, rocker). Chairs, tables and pots on the patio. A slide and toys. A kayak by the fence. Kettle or gas grills (replacing Yards' stand-in) with a spare propane tank. Junk round the shed: a wheelbarrow, tyres, compost bags, a barrel, crates, pots, a stepladder.
- *Walls (HIGH).* Satellite dishes, a ladder up to a window, rain barrels, hose reels and bins. Each sits beside a window on the real wall plane, taken from `anchors.json`, never over a window, and never on the street front.
- *Lines (HIGH).* Distribution poles down the rear lot lines with three sagging conductors and a slacker cable line. They keep 6 units off the low part of the flight, off trees and off sheds.
- *People.* Kids on the lawn and under the hoop, someone at the grill with a neighbour, a gardener by the barrow, someone on the phone by the mower, a dog out in the back. These are extra `Stand`s for the town crowd (`Stand.variant` picks a child or a dog). A person is about 2.4k triangles, so the yards add at most 36 on HIGH and 4 on phones.

Each lot draws its household from a stream seeded by its own position, independent of `homeLots` and of every other generator: whether there are kids, a decorator, a gardener or a tinkerer, and how untidy they are. Every piece gets a random yaw and a little tilt, and is set down on its lowest point. Each piece keeps off what `Yards` placed (now recorded per lot as `Yards.lots`), the house and its front bed, the walk, the drive and the parked car, the fence runs, the trees, and the verge's street furniture and lamps.

**Models.** `blender/make_yard_props.py` makes 50 props. 27 are Poly Haven CC0 models (see `public/models/yard-props/CREDITS.md`), decimated to 120 to 2,200 triangles. The rest are modelled procedurally. Cycles bakes everything from its full source into one 2048 atlas: albedo with AO folded in, ORM, and a tangent normal map (phones get a 1024 colour map only). Each prop ships a full mesh and a lean one in `props.glb`, meshopt-packed by `npm run compress:models`.

**Cost.** Every kind and every instance is ONE `BatchedMesh` (one draw call, plus one for the lines on HIGH). Each piece draws only within a reach that suits its size (24 / 40 / 66 units, poles 110) and switches to its lean mesh past 42% of that reach. Phones draw a shorter list of kinds, lean only, at 85% of the reach, on lots within 40 units of the flight. `?noclutter` leaves the whole layer out, for an A/B. Measured at the street pass (t 0.185), the additions draw:
- HIGH: 92 pieces in view, 28k triangles, plus 15k for the lines and up to 36 yard people (about 86k if all of them are in view), in 2 draw calls.
- Phone: 15 pieces in view, 1.7k triangles, plus up to 4 people, in 1 draw call.

## Photo detail on the ground and walls

The ground and the house atlases are baked at a few centimetres a texel, so the grain of real materials is tiled over them at runtime from photographs: `public/models/homes/detail-{asphalt,concrete,plaster}.webp` (HIGH tier only). Each holds only the variation of its photograph about its mean, so a surface keeps the colour the bake gives it (`scripts/make-detail-maps.py`). The ground shader (`materials/Lawns.ts`) multiplies them over the asphalt and pavement, with relief while a pixel is smaller than a grain; the wall shader (`materials/Roofs.ts`) tiles the plaster over every house wall.

**Weathering decals (HIGH tier).** On the houses the flight passes closest to (`rings.hero`), `actors/HouseDecals.ts` lays alpha-blended quads a few millimetres off the walls: rain streaks under every window sill, grime at the foot of each garage door and an oil stain on the drive. Where the windows and garages sit comes from the house DSL itself: `blender/make_anchors.py` rebuilds every home and writes `public/models/homes/anchors.json` (`[kind, x, y, z, nx, nz, ux, uz, w, h]` per row, in site units), and the decals place them with the same transform `KitCity` uses for the house. Rerun it whenever a house in `blender/bld/homes.py` changes.

**Parallax and entropy (HIGH tier).** A tidy cell reads as a model, so the town is deliberately a little broken, and the broken parts are parallax-mapped so they hold depth as the camera moves:

- *Parallax.* `materials/Lawns.ts` ray-marches the asphalt cracks (6 steps against a 5 cm groove depth, from the view ray in town units) and offsets the photo grain by its own height; `materials/Roofs.ts` offsets every roof course by its rise (the tab edges slide against the weathering) and the wall grain and stucco by theirs. The roof and wall frames come from screen-space derivatives (`rParaDir`), so no tangents are needed on instanced, rotated modules.
- *Ground entropy.* Cracks in worn zones, squared repair patches with a sealed edge, oil and rubber stains, drifts of fallen leaves with single leaves up close, bare worn lawn and dead spots.
- *House entropy.* Each house gets its own upkeep (`dirtK` in the wall shader, `dirt` in `HouseDecals.ts`): scrubbed ones stay clean; neglected ones get longer sill streaks, mildew at the foot of the wall, algae in sill corners, flaking paint beside windows, rubber and oil on the drive. Squared repainted patches sit a shade off the wall.
- *Layout entropy.* `homeLots` nudges each house a few centimetres off its mark and a few tenths of a degree off true (a seventh visibly crooked) from a stream of its own, so no other house moves; `npm run bake:rings` after changing it.

**City realism (the night canyon).** The same ideas, in world metres, for the downtown (`materials/glsl.ts` holds the shared noise, crack and parallax GLSL):

- *Roads and pavement* (`materials/Streets.ts`, applied in `City.ts`): cracks and sealed seams with parallax-occluded grooves (HIGH), squared repair patches, a utility trench or two, manhole covers, oil and rubber down the wheel tracks, photographed asphalt and concrete grain, chewing gum and stains on the pavement, and puddles in the ruts and gutters that lower roughness and flatten the normal, so the lamps and neon mirror in them. Phones keep the stains, oil and puddles.
- *Facades* (`materials/Facades.ts`, applied by `KitCity` to the `tower` and `block` modules): upkeep per building (`dirtK`), soot up the first storeys, rain streaks, a slow mottle, repainted sections, and on HIGH a photographed concrete grain with parallax and relief. Only the wall texels (rough, non-metal) are touched, so lit windows and glass are as baked.
- *Skyline and grade*: tower and block heights vary about 12% from a stream of their own (`cityGen.mjs`, rings rebaked); the `city` grade now has the town's tone curve, a little less saturation and a cooler white balance.
- *Lit-window rooms* (`Facades.ts`, `blender/bld/model.py`): the kit's wall faces carry a window-cell grid as a second UV layer (`Grid`, `TEXCOORD_1`; whole numbers are floor slabs and piers, -1 off walls; see blender/README.md). The facade shader reads it (`uv1`) and, behind every lit window texel, ray-marches a box room (ceiling lamp, floor, side and back walls; on HIGH furniture, shelves, pictures, the odd person or television), tinted by the window's baked colour. The grid adds about 2.7 MB to the city kit (float UVs).
- *Outlook mark*: `public/images/outlook.svg` (from the community dashboard-icons set, not Microsoft's own asset) sits beside "Works with Outlook" in the 3D lockup and the landing proof chips, with Microsoft's trademark notice in the footer.
- *Streetlamps*: the road and pavement light themselves from the lamps (`lampField` in `Streets.ts`; inverse-square downlights, glossy streaks on wet asphalt), not painted discs; `Streetlights` has a `soft` mode with physical falloff for the real lights.
- Still to do: decals from Blender anchors (shopfronts, signs, AC units: grime, rust, posters, litter) and lamp and street-furniture irregularity.

**Cars:** all nine vehicles are generated (`blender/make_cars.py`): a high-poly build is baked into a hero tier (21 to 25k triangles, occlusion, road-grime and normal maps) for cars within 12 units on HIGH, a mid tier (the old close-up model with baked occlusion) out to 28 units, and the lean shells beyond and on LOW (see blender/README.md). No downloaded vehicle was realistic and licensed for this use; the survey is in `public/models/cars/CREDITS.md`.

**IT office props:** the night office level's furniture and kit are generated (`blender/make_it_office.py`, see "IT office props" in blender/README.md): thirteen props in `public/models/office/office-props.glb`, each a root node named in `manifest.json` (size in metres, the emissive materials the engine drives, triangle counts), all on one baked 2048 px atlas. Every prop is modelled procedurally and built twice, a high-poly twin with real bevels, procedural PBR materials and wear, and the lean mesh that ships with the twin baked onto it. No downloaded model is used; the survey is in `public/models/office/CREDITS.md`.

**Street pass through the city.** The flight now runs at street level down the canyon road, as it does through the town: the dive (`pathPoints.mjs`, six points in the city zone) drops to about lamp height at x 185, keeps 1.1-1.4 units over the lanes for some sixteen units, between the lamps (their arms reach 0.5 out from z -2.05 and 2.05), through the traffic and the crowd, then pulls up into the copilot climb. The city zone has more points, so `CH_START_INDEX` moved for the last two chapters and `npm run bake:rings` was rerun. The detour's tower is still picked at runtime.

**Shafts over the town.** `actors/LightShafts.ts`: long additive ribbons that turn about their own axis to face the lens (a beam billboard), laid along the sun's direction over the town from the study window to the end of the street pass (t 0.082-0.235): a soft profile across the width, streaks that drift, fades at the cloud end, into the rooftop haze and close to the lens; 12 on HIGH, 6 on phones, one draw call. They are in the world, so the houses and trees cut them, unlike the screen-space rays (`post/GodRays.ts`) that smear toward the sun's pixel.

**Credits:** the photographs are ambientCG textures (https://ambientcg.com), released under CC0 1.0, taken from the public repository github.com/itz019/tls-textures.

## City life (the night city's clutter)

The canyon read "too neat to be true", so `actors/CityLife.ts` dresses it with what a real downtown street collects, all from one shared atlas (`public/models/city-props/`, one material):

- **Models.** `blender/fetch_city_props.py` downloads 18 Poly Haven models (all **CC0**: hydrants, metal bins, bin bags, AC units, utility cabinets, a jersey barrier, a barrel, crates, a cardboard box, a tyre, a chalkboard, a wet-floor A-frame, a coffee cart, a planter, a propane tank, a plastic chair); `blender/bld/city_props.py` models the rest procedurally (roof water tanks on steel stands, rooftop air handlers, dishes, TV antennas, mushroom vents, newspaper boxes, a mailbox, bike racks and three bicycles, cones, fly-posted hoardings, a tube scaffold bay, a pallet, litter, a cable). `blender/make_city_props.py` splits the scans into their variants, decimates them to a site budget, packs every prop into one 1k atlas and bakes the scans' colour, roughness and normals across (selected-to-active), the procedural props' noise-grimed materials, and Cycles occlusion over a ground plane, then writes `props.glb` (HIGH, 228 to 3.2k triangles a prop) and `props-lean.glb` (phones and distance), the webp maps, `props.json` and `CREDITS.md`. Then `npm run compress:models`.
- **Roofs.** `scripts/bake-city-roofs.mjs` rasterises the hero block modules' upward faces into a 40x40 height grid and keeps the flat cells near the top (`roofs.json`), so tanks, plant, vents, dishes and antennas only stand on flat, clear roof, never on a parapet, a pitched loft roof or the baked plant. Rerun it when a block module changes.
- **Scatter.** Seeded and deliberately untidy (random yaw, offsets, scale and tilt; bags thrown on bags, a lid leaning on its can, a cone knocked over), on a 5 cm occupancy grid of what is already there: the buildings, both walkers' lanes of every pavement and cross street, the plazas' strolls and groups, CityStreet's furniture, trees, lamps, signals, the parked cars and the moving lanes. Bag piles, deliveries, roadworks and bikes in the parking lane's empty bays; shopfront dressing where a frontage is set back; bikes, newspaper boxes and planters in the plazas; hoardings where a plaza backs onto an empty lot; a sidewalk shed (scaffold the walkers pass under) on one or two blocks; window AC units above head height (HIGH); litter in the gutters; wires across the cross streets (HIGH, never across the canyon); a coffee cart with steam and a queue; people waiting at the bus shelters and a smoke by a door (they join `cityCrowd` as stands). CityStreet's primitive hydrants and bins are replaced by the scanned ones on the same spots. Nothing stands nearer the canyon's centre line than the parking lane.
- **Draws.** Props are merged per 16-unit run of street (and per run of roofs), each run one draw with a near and a lean geometry picked by camera distance (near within 24 on HIGH); a run past 70 (roofs 105; phones 34 and 51) is not drawn. Steam is one more draw and the blowing paper (HIGH) one more. No prop casts a shadow, and the live reflection probe leaves them out. The props take the street lamps' light from `lampField` the way the road does. `__engine.city.life.stats` (with `?probe`) reports the draws and triangles of the last frame.

**Credits:** Poly Haven (https://polyhaven.com, CC0): Fire Hydrant (Gonçalo Felício), Metal Trash Can (GurJas Studios), Trashbag (Benny Weimer), Exterior Aircon Unit (Monsta3D), Utility Box 01 and 02, Planter Box 01 (James Ray Cock), Wooden Crate 02 (James Ray Cock, Jurita Burger), Concrete Road Barrier 02 (Amal Kumar), Barrel 03 (Serhii Khromov), Plastic Crate 02 (Fabi_G), Cardboard Box 01 (Rahul Chaudhary), Old Tyre (MP), Standing Chalkboard 01 (ParzivalCG), Wet Floor Sign 01 (Fran Calvente), Coffee Cart 01 (Joe Seabuhr), Propane Tank (Slinc), Plastic Monobloc Chair 01 (Kuutti Siitonen). Per-prop table in `public/models/city-props/CREDITS.md`.

## Camera direction and the lens

The camera is directed per chapter and per beat, all keyed to story-t so a scrub always lands on the same frame.

| piece | where | what it does |
| :-- | :-- | :-- |
| Chapter lens | `story/chapters.ts` (`rig`) | Lag, offsets, fov, plus `dutch` (a fixed tilt), `bank` (how far the horizon leans into the flight line's turns) and `lookUp` (a raised look target for low hero angles: the street and the city canyon). |
| Shot list | `webgl/rig/CameraRig.ts` (`BEATS`) | Directed moments laid over the chase cam: the matted title opening and the push-in on the laptop, the camera stopping in the window while the dart drops into the town, the low hold in the street as it climbs away, the cloud-deck breath, the storm, the lighthouse wide and delivery, the tilted dive into the city, the held touchdown, the push into the screen. A beat can push or widen the lens, hold the camera (at a world point or where the chase cam stood at some t), tilt it, mat the frame and soften the background. |
| Lightning jolt | `CameraRig.jolt` | Each storm strike gives the lens a short shake and a small focal kick. |
| The lens | `webgl/post/Cinema.ts` | Letterbox bars (eased in by the beats, ~2.2:1 on 16:9, thinner on portrait phones), film grain in CSS pixels that also dithers the sky gradients, and a highlight shoulder with a gentle S-curve (there is no tone mapping, so lamps and neon clipped hard before). HIGH adds a depth-of-field gather focused on the dart (or the lantern during the delivery; the sky stays sharp) and chromatic aberration in the frame's corners that grows while a fast scrub streaks the frame. |

Cost: on LOW the lens merges into the existing effect pass (a few ALU ops, no texture reads). On HIGH it is one extra
fullscreen pass of about 18 texture reads a pixel, and only background pixels pay for the defocus. Reduced motion keeps
the holds and the bars but drops the rolls, the jolts and the focal pushes. `?nocine` leaves the lens out for an A/B.

## 🧞 Commands

All commands are run from the root of the project, from a terminal:

| Command                   | Action                                           |
| :------------------------ | :----------------------------------------------- |
| `npm install`             | Installs dependencies                            |
| `npm run dev`             | Starts local dev server at `localhost:4321`      |
| `npm run build`           | Build your production site to `./dist/`          |
| `npm run preview`         | Preview your build locally, before deploying     |
| `npm run astro ...`       | Run CLI commands like `astro add`, `astro check` |
| `npm run astro -- --help` | Get help using the Astro CLI                     |

## 👀 Want to learn more?

Feel free to check [our documentation](https://docs.astro.build) or jump into our [Discord server](https://astro.build/chat).
