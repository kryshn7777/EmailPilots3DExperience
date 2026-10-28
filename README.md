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

The landing reads top to bottom as a pitch: what it is (`INTRO`), the problem it solves (`PROBLEM`), how it works (`STEPS`), the deliverability safeguards (`SAFEGUARDS`), the last mile (`LAST_MILE`), the local AI (`LOCAL_AI`), the mailboxes (`MAILBOXES`), who it is for (`AUDIENCES`), why it is different (`WHY`), the ten stops in brief, the plan, FAQ, and a closing call to action. Every line is checked against `FEATURES.md` Appendix B; no placement guarantees, no tiers, no tracking claims.

To add landing content, edit `Landing.astro`; to change the flight, edit `src/webgl/` and `src/story/`.

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
| storm to lighthouse (0.40 to 0.5) | the sea rises under the storm first, then the lamp glows out of the murk, then the tower and islet form out of the mist; the sweep lights the ship |
| lighthouse to city (0.59 to 0.71) | fog draws in as the sea goes and the night cloud deck thickens into a bank across the gap; the city is switched on inside it and powers up in a wave (street lamps first, then windows, glass and neon) while a mist stands on its streets and thins as the flight dives in; the lightning carries across and lands on the roofs |
| copilot to the airfield (0.82 to 0.9) | the descent goes through cloud: fog closes while the starfield is left behind, the airfield is switched on inside it, and the edge lights, the threshold bars and PAPI, then the approach rabbit come up as the runway appears |

## Loading and frame cost

| What | How |
|---|---|
| Chapter seams | `Engine.warmSeams` links each distinct visibility state's lit programs (three keys them on the visible light count) against the composer's own buffer, in story order, off the render thread. Town seam: 59 programs linked on the spot before, about 10 now (the rest are shadow-depth variants) |
| Late arrivals | the town, city and lighthouse ask for a warm pass as they stream in (`warm.ts`), coalesced into one |
| Normals | SSAO reads the same depth-rebuilt normals as SSGI/SSR; the full-resolution `NormalPass` (a second draw of the whole scene) is gone |
| Shadows, probe | the sun's shadow map and the reflection probe refresh every other frame |
| Town trees | the rings of the flight line say which tree model a lot MAY use (ultra ~50k triangles, hero ~15k, detail ~2.4k, lite ~700, lean ~90), and `KitCity.updateTrees` picks the model by camera distance each frame (ultra within 20 units, hero 34, detail 56, lite 90, lean beyond; phones 24/50), so only the trees near the lens are dense. Triangles in the town frame at the window exit: trees about 3.4M before, about 0.95M now |
| Resolution | the frame-time governor runs on every tier (high: 0.6–1× of the device ratio, steps down above 21 ms and back up after 8 s of headroom) |
| Loading | meshopt decoding on two workers; the sky HDRI is preloaded; the nav island hydrates on idle |

## Pinned titles

Each chapter's title stands in the world (`src/webgl/actors/PinnedTitles.ts`): a canvas-drawn lockup (heavy / thin / heavy condensed capitals, Oswald) on a plane with the depth test on, so towers, trees and the lighthouse pass in front of it and the haze dims it, the way a camera-tracked title is made in a film. The words come from `PINNED_TITLES` in `src/story/copy.ts`.

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
