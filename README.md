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
| Foliage | `actors/KitCity.ts` | Trees sway in a wind that travels across the town, cards flutter, and a low sun glows through the leaves. |

`?nogi` and `?nossr` leave the two screen-space passes out for an A/B; with `?probe`,
`__engine.ssr.debug = 1` shows the reflections alone (2 the reflectivity, 3 how far each ray went)
and `__engine.ssgi.debug = 1` the bounce light.

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
