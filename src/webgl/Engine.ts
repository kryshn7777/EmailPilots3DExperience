import {
  Color,
  DirectionalLight,
  Fog,
  HalfFloatType,
  HemisphereLight,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PCFShadowMap,
  PMREMGenerator,
  PerspectiveCamera,
  PointLight,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import {
  BlendFunction,
  BloomEffect,
  type Effect,
  EffectComposer,
  EffectPass,
  NormalPass,
  RenderPass,
  SSAOEffect,
  VignetteEffect,
} from 'postprocessing';
import { GodRaysEffect } from './post/GodRays';
import { ZoomBlurEffect } from './post/ZoomBlur';
import { CinemaEffect } from './post/Cinema';
import { Lightning } from './actors/Lightning';
import { SSREffect } from './post/SSR';
import { SSGIEffect } from './post/SSGI';
import { VolumetricFogEffect } from './post/VolumetricFog';
import { DepthNormals } from './post/viewSpace';
import { ReflectionProbe } from './materials/ReflectionProbe';
import {
  CONTRAIL_FROM,
  FOLD_WINDOW,
  TOUCHDOWN_T,
  UNFOLD_WINDOW,
  gradeBlendAt,
  type GradeParams,
} from '../story/chapters';
import { Beacon } from './actors/Beacon';
import { Biplane } from './actors/Biplane';
import { PinnedTitles } from './actors/PinnedTitles';
import { Birds } from './actors/Birds';
import { City } from './actors/City';
import { Clouds } from './actors/Clouds';
import { Copilot } from './actors/Copilot';
import { Desk } from './actors/Desk';
import { Envelopes } from './actors/Envelopes';
import { Landing } from './actors/Landing';
import { LaunchString } from './actors/LaunchString';
import { Panel } from './actors/Panel';
import { PaperBurst } from './actors/PaperBurst';
import { PaperPlane } from './actors/PaperPlane';
import { KitCity } from './actors/KitCity';
import { fogHeight, fogSun, fogSunColor } from './fog';
import { ROOFTOP_BASE_Y } from './bake/cityGen.mjs';
import { Rooftops } from './actors/Rooftops';
import { Mountains } from './actors/Mountains';
import { Storm } from './actors/Storm';
import { Traffic } from './actors/Traffic';
import { Trail } from './actors/Trail';
import { AirTrail } from './actors/AirTrail';
import { Flock } from './actors/Flock';
import { WindowFrame } from './actors/WindowFrame';
import { WingPlanes } from './actors/WingPlanes';
import { BatchSend } from './actors/BatchSend';
import { liveLaptopScreen } from './actors/LaptopScreen';
import { HERO_RELEASE, STAGE, launchPulse, planeScale } from './rig/launch';
import { CameraRig } from './rig/CameraRig';
import { FlightPath } from './rig/FlightPath';
import { BEACON_ANCHOR, CITY_ANCHOR, COPILOT_ANCHOR, LANTERN, PANEL_ANCHOR } from './rig/pathPoints.mjs';
import { setCompiler } from './warm';
import { Raycast } from './interact/Raycast';
import { Tooltip } from './interact/Tooltip';
import { DeliveryPopup } from './interact/DeliveryPopup';
import { BatchHud } from './interact/BatchHud';
import { SkyDome } from './materials/SkyDome';
import { REFLECTED_LAYER } from './materials/PlanarReflection';
import { windowLight } from './materials/WindowGlass';
import { CloudNoise } from './bake/CloudNoise';
import { ScrollDirector } from './scroll/ScrollDirector';
import { UNLIT, detectQuality, gpuRendererString } from './quality';
import { asset } from './asset';
import { mulberry32 } from './util';

interface EngineOptions {
  reducedMotion: boolean;
}

interface IdlePreset {
  t: number;
  orbitRadius: number;
  orbitHeight: number;
  orbitSpeed: number;
}

/** Non-home routes park the world at a story moment and orbit it slowly. */
const ROUTE_PRESETS: Record<string, IdlePreset> = {
  '/features': { t: 0.3, orbitRadius: 7, orbitHeight: 1.6, orbitSpeed: 0.12 },
  '/pricing': { t: 0.53, orbitRadius: 9, orbitHeight: 2.6, orbitSpeed: 0.08 },
  '/download': { t: 0.985, orbitRadius: 4.5, orbitHeight: 1.3, orbitSpeed: 0.05 },
};

/**
 * Phase-3 engine: CH1–5 art-complete (desk, panel, takeoff window, volumetric
 * cloud sea, storm) over the chapter grade system; CH6–10 remain blockout.
 */
/** half-width of the sun's shadow window around the plane (site units) and its map size */
const SUN_SHADOW_HALF = 56;
const SUN_SHADOW_MAP = 2048;
/** the room (desk, panel, window frame) is left behind past this story time */
const DESK_UNTIL = 0.2;

export class Engine {
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera: PerspectiveCamera;
  private composer: EffectComposer;
  private quality!: ReturnType<typeof detectQuality>;

  private path = new FlightPath();
  private plane = new PaperPlane();
  private trail = new Trail();
  private airTrail = new AirTrail();
  private flock!: Flock;
  private launchString = new LaunchString();
  private rig: CameraRig;
  /** the 3D noise the sky layer and the cloud slab both read; filled by a worker a moment after boot */
  private noise = new CloudNoise();
  private sky = new SkyDome(this.noise);
  private sun = new DirectionalLight('#ffd9a0', 1);
  private hemi = new HemisphereLight('#8fa8cc', '#1a1e2e', 0.35);
  private desk: Desk;
  /** the cool light the laptop screen throws on the desk, found in the Desk's lights (null if there is none) */
  private screenSpill: PointLight | null = null;
  private panel: Panel;
  private windowFrame: WindowFrame;
  private rooftops!: Rooftops;
  private mountains!: Mountains;
  private clouds: Clouds;
  private envelopes: Envelopes;
  private storm: Storm;
  private biplane: Biplane;
  private birds: Birds;
  private pinned: PinnedTitles;
  private beacon: Beacon;
  private wingPlanes = new WingPlanes();
  private batch: BatchSend;
  private traffic!: Traffic;
  private zoomBlur = new ZoomBlurEffect();
  /** forked bolts that descend through the storm and the lighthouse's sky (none under reduced motion) */
  private lightning!: Lightning;
  /** letterbox, grain, film curve; DoF + chromatic aberration on HIGH (post/Cinema.ts). Null under ?nocine */
  private cinema: CinemaEffect | null = null;
  private godRays: GodRaysEffect | null = null;
  private ssr: SSREffect | null = null;
  private ssgi: SSGIEffect | null = null;
  /** sunlit haze with the sun's shadows in it (post/VolumetricFog.ts). HIGH only; null under ?novol */
  private volume: VolumetricFogEffect | null = null;
  private depthNormals: DepthNormals | null = null;
  /** the live reflection of the surroundings that car paint and window glass mirror (HIGH) */
  private envProbe: ReflectionProbe | null = null;
  /** the grade's sun level this frame (0 dark .. ~1.6 noon): god rays follow it */
  private sunLevel = 0;
  private blurLevel = 0;
  private scrubVel = 0;
  private city: City;
  private copilot: Copilot;
  private landing: Landing;
  private burst: PaperBurst;
  private confetti: PaperBurst;
  private raycast = new Raycast();
  private tooltip = new Tooltip();
  private deliveryPopup = new DeliveryPopup();
  private batchHud = new BatchHud();
  /** the lantern room's centre, where the dart is delivered (see pathPoints.mjs) */
  private lanternCentre = new Vector3(...LANTERN);
  /** 0 away from the lamp, 1 with the dart inside it: drives the flare and the dart's size */
  private delivered = 0;
  private director: ScrollDirector | null = null;

  private fog: Fog;
  private scrollT = 0;
  /**
   * What the frame actually renders: scrollT chased with a frame-rate-
   * independent damp. Wheel detents, scrollbar drags, PageDown, and anchor
   * jumps all arrive as steps — the camera glides through them instead of
   * snapping, and seam beats still fire because renderT passes through
   * every value on the way.
   */
  private renderT = 0;
  private prevT = 0;
  private idlePreset: IdlePreset | null = null;
  private maneuverPulse = 0;
  /** 1 at night, 0 in daylight: how brightly the town's lamps burn */
  private lampLevel = 1;
  private rafId = 0;
  private startTime = performance.now();
  private lastTime = this.startTime;
  private disposed = false;

  // scratch for grade lerps
  private colorA = new Color();
  private colorB = new Color();
  private sunDirWorld = new Vector3(0.6, 0.25, 0.1);
  private sunScreenDir = new Vector2(0.7, 0.3);
  private tmpV = new Vector3();
  private tmpV2 = new Vector3();

  constructor(
    private canvas: HTMLCanvasElement,
    private options: EngineOptions,
  ) {
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: false, // post chain handles AA later (SMAA); MSAA fights the composer
      powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(new Color('#05070f'));
    // shader-error introspection synchronously stalls every program link;
    // keep it for dev, drop it in production builds
    if (import.meta.env.PROD) this.renderer.debug.checkShaderErrors = false;
    this.quality = detectQuality(gpuRendererString(this.renderer.getContext()));
    if (this.quality.tier === 'low') this.resolution = 0.75;
    // every model is meshopt-compressed: decode them on two workers instead of the render thread
    MeshoptDecoder.useWorkers(2);
    // real-time shadows: the desk lamp in the study, the sun over the town (HIGH only)
    if (this.quality.tier === 'high') {
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = PCFShadowMap;
    }

    if (this.quality.tier === 'high') {
      // the sun's shadows over the town: an ortho window that follows the plane
      const shadow = this.sun.shadow;
      this.sun.castShadow = true;
      shadow.mapSize.set(SUN_SHADOW_MAP, SUN_SHADOW_MAP);
      shadow.camera.left = shadow.camera.bottom = -SUN_SHADOW_HALF;
      shadow.camera.right = shadow.camera.top = SUN_SHADOW_HALF;
      shadow.camera.near = 1;
      shadow.camera.far = 150;
      shadow.bias = -0.0006;
      shadow.normalBias = 0.05;
      shadow.radius = 2.5;
      // refreshed every other frame from renderFrame (a whole-scene depth pass); the first frame draws it
      shadow.autoUpdate = false;
      shadow.needsUpdate = true;
    }

    if (this.quality.tier === 'high' && !UNLIT) this.envProbe = new ReflectionProbe(256);

    this.fog = new Fog('#05070f', 10, 90);
    this.scene.fog = this.fog;
    this.camera = new PerspectiveCamera(45, 1, 0.1, 400);

    // instant fallback env, upgraded to the real night-sky HDRI when it
    // streams in — first frame never waits on the network.
    // (A live probe baked from the chapter's own sky was tried here: it made
    // the night chapters self-lit by near-black, so the HDRI stays.)
    const pmrem = new PMREMGenerator(this.renderer);
    const roomEnv = pmrem.fromScene(new RoomEnvironment());
    this.scene.environment = roomEnv.texture;
    this.scene.environmentIntensity = 0.3;
    // two probes load, so the generator is released when BOTH have settled
    let probesLeft = 2;
    const probeSettled = (): void => {
      if (--probesLeft === 0) pmrem.dispose();
    };
    new HDRLoader().load(
      asset('/hdri/sky_1k.hdr'),
      (hdr) => {
        this.scene.environment = pmrem.fromEquirectangular(hdr).texture;
        hdr.dispose();
        roomEnv.dispose();
        probeSettled();
      },
      undefined,
      probeSettled, // offline: keep the RoomEnvironment look
    );
    // the buildings' own sky: a path-traced cloud sea and cumulus baked in
    // Blender (blender/make_cloud_env.py). Light and reflections for the city
    // only; the night probe above still serves everything else.
    new HDRLoader().load(
      asset('/hdri/cloud_env_1k.hdr'),
      (hdr) => {
        KitCity.setEnvironment(pmrem.fromEquirectangular(hdr).texture);
        hdr.dispose();
        probeSettled();
      },
      undefined,
      probeSettled, // missing file: buildings fall back to the scene probe
    );

    const rand = mulberry32(919);
    this.desk = new Desk(new Vector3(0.4, 1.29, 0), this.quality.dustCount, rand, this.quality.tier === 'high');
    this.desk.group.traverse((o) => {
      const light = o as PointLight;
      if (!this.screenSpill && light.isPointLight && light.color.getHexString() === '9fc4ff') this.screenSpill = light;
    });
    this.panel = new Panel(new Vector3(...PANEL_ANCHOR));
    this.windowFrame = new WindowFrame(new Vector3(7, 2, 0.8));
    this.rooftops = new Rooftops(rand, this.quality);
    this.mountains = new Mountains(this.sky);
    this.clouds = new Clouds(this.path.chapterAnchor(3), this.quality, rand, this.renderer, this.noise);
    this.envelopes = new Envelopes(this.raycast, this.tooltip);
    this.storm = new Storm(this.path, this.quality.rainCount, rand);
    this.lightning = new Lightning({ light: this.quality.tier === 'high', reflect: this.quality.tier === 'high' });
    this.biplane = new Biplane(this.path);
    this.birds = new Birds(rand);
    this.pinned = new PinnedTitles();
    this.beacon = new Beacon(new Vector3(...BEACON_ANCHOR), this.raycast, this.tooltip, this.quality);
    this.beacon.bindSky(this.sky);
    // what the sea mirrors: the sky, and the lights that light the lighthouse and the ship in it
    for (const o of [this.sky.mesh, this.sun, this.hemi]) o.layers.enable(REFLECTED_LAYER);
    this.city = new City(new Vector3(...CITY_ANCHOR), this.path, this.quality);
    this.copilot = new Copilot(new Vector3(...COPILOT_ANCHOR));
    // fixed roll-out point, not a story-t sample: the flight now turns off
    // the runway into the arrival office, so sampling near t=1 would drag the
    // whole airfield along with the turn
    this.landing = new Landing(new Vector3(270, 0.5, 0), this.quality);
    this.burst = new PaperBurst(rand);
    this.confetti = new PaperBurst(rand);
    this.traffic = new Traffic(this.path);
    this.batch = new BatchSend(this.path, { low: this.quality.tier === 'low', calm: this.options.reducedMotion });
    this.flock = new Flock(rand);

    this.scene.add(
      this.plane.group,
      this.trail.line,
      this.airTrail.mesh,
      this.flock.group,
      this.launchString.line,
      this.sky.mesh,
      this.mountains.mesh,
      this.sun,
      this.sun.target,
      this.hemi,
      this.desk.group,
      this.panel.group,
      this.windowFrame.group,
      this.rooftops.group,
      this.clouds.sprites,
      this.clouds.night,
      this.envelopes.group,
      this.storm.group,
      this.lightning.group,
      this.biplane.group,
      this.birds.group,
      this.pinned.group,
      this.beacon.group,
      this.wingPlanes.group,
      this.batch.group,
      this.traffic.group,
      this.city.group,
      this.copilot.group,
      this.landing.group,
      this.burst.points,
      this.confetti.points,
    );
    if (this.clouds.volume) this.scene.add(this.clouds.volume);

    this.rig = new CameraRig(this.path, this.camera, this.plane, { reducedMotion: this.options.reducedMotion });

    this.composer = new EffectComposer(this.renderer, { frameBufferType: HalfFloatType });
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    // Ambient occlusion: the other half of "global illumination" — light
    // that CANNOT reach a crease. The probe supplies the bounce; this takes
    // it away again where geometry occludes itself, which is what makes
    // objects sit in a room instead of floating in front of it. HIGH only:
    // it costs a normal buffer plus a screen pass.
    const effects: Effect[] = [];
    if (this.quality.tier === 'high' && !UNLIT) {
      // Light the frame can see bounces off what it lands on (SSGI, before the occlusion takes its
      // share back), and reflections are traced through the depth buffer (SSR, after it): the
      // screen-space versions of what Lumen and hardware ray tracing do, built on the same normal
      // buffer the ambient occlusion reads. ?nogi / ?nossr leave them out for an A/B.
      const params = new URLSearchParams(location.search);
      // all three read normals rebuilt from depth (post/viewSpace.ts), shared and made once a frame:
      // a separate normal pass would draw the whole scene a second time at full resolution
      this.depthNormals = new DepthNormals();
      // (with the bounce left out nothing else asks for them, so the occlusion keeps its own pass)
      let normalTexture = this.depthNormals.texture;
      if (params.has('nogi') && params.has('nossr')) {
        const normalPass = new NormalPass(this.scene, this.camera);
        this.composer.addPass(normalPass);
        normalTexture = normalPass.texture;
      }
      if (!params.has('nogi')) {
        this.ssgi = new SSGIEffect(this.camera, this.depthNormals);
        effects.push(this.ssgi);
      }
      this.ssr = params.has('nossr') ? null : new SSREffect(this.camera, this.depthNormals);
      effects.push(
        new SSAOEffect(this.camera, normalTexture, {
          blendFunction: BlendFunction.MULTIPLY,
          worldDistanceThreshold: 60,
          worldDistanceFalloff: 20,
          worldProximityThreshold: 0.4,
          worldProximityFalloff: 0.1,
          luminanceInfluence: 0.55,
          samples: 16,
          rings: 5,
          radius: 0.06,
          intensity: 2.1,
          resolutionScale: 0.5,
          fade: 0.02,
        }),
      );
      if (this.ssr) effects.push(this.ssr);
      // the air itself, lit by the sun and shadowed by what stands in it: laid over the shaded
      // frame and before the bloom, so the brightest shafts glow. ?novol leaves it out.
      if (!params.has('novol')) {
        this.volume = new VolumetricFogEffect(this.camera, this.sun);
        effects.push(this.volume);
      }
    }
    // bloom is a mip chain over the whole frame and it exists to sell light —
    // blockout mode keeps only the scroll blur and the vignette
    if (!UNLIT) {
      effects.push(new BloomEffect({ luminanceThreshold: 0.85, intensity: 1.1, mipmapBlur: true }));
    }
    // sun shafts go in before the zoom blur, so a fast scrub streaks them with everything else
    if (this.quality.godRays && !new URLSearchParams(location.search).has('norays')) {
      this.godRays = new GodRaysEffect(this.quality.godRays);
      effects.push(this.godRays);
    }
    effects.push(this.zoomBlur, new VignetteEffect({ darkness: 0.55 }));
    // the lens and the film stock (post/Cinema.ts), last in the chain: letterbox, grain and a highlight
    // shoulder on every tier, merged into this pass for free; HIGH adds depth of field and chromatic
    // aberration, which read neighbouring pixels and so take one more pass. ?nocine leaves it out.
    if (!UNLIT && !new URLSearchParams(location.search).has('nocine')) {
      this.cinema = new CinemaEffect({ optics: this.quality.tier === 'high' });
      if (!this.cinema.optics) effects.push(this.cinema);
    }
    this.composer.addPass(new EffectPass(this.camera, ...effects));
    if (this.cinema?.optics) this.composer.addPass(new EffectPass(this.camera, this.cinema));

    this.resize();
    window.addEventListener('resize', this.resize);
    this.canvas.addEventListener('webglcontextlost', this.onContextLost);

    if (UNLIT) this.flatten(this.scene);

    // streamed-in content (city GLB, desk props) is linked off the scroll path, with the rest of its chapter
    setCompiler((subtree) => {
      if (UNLIT) this.flatten(subtree);
      this.scheduleWarm();
    });

    if (new URLSearchParams(location.search).has('probe')) {
      // dev-only scene handle for automated inspection
      Object.assign(window as object, { __scene: this.scene, __camera: this.camera, __engine: this });
    }
  }

  /** Route change: home scrubs; other pages park at a preset and orbit. */
  setRoute(path: string): void {
    const clean = path.replace(/\/+$/, '') || '/';
    this.idlePreset = ROUTE_PRESETS[clean] ?? null;
    const t = this.idlePreset ? this.idlePreset.t : this.scrollT;
    // jumping t across chapters must not fire seam beats or drag the trail
    this.prevT = t;
    this.trail.reset();
    if (this.options.reducedMotion) this.renderFrame();
  }

  /** Page-transition flourish: the plane banks hard while the DOM swaps. */
  maneuver(): void {
    this.maneuverPulse = 1;
  }

  scrollTopForSwap(): void {
    this.director?.scrollTop();
  }

  refreshAfterSwap(): void {
    this.director?.refresh();
  }

  start(): void {
    this.director = new ScrollDirector({
      reducedMotion: this.options.reducedMotion,
      onProgress: (t) => {
        this.scrollT = t;
        if (this.options.reducedMotion) this.renderFrame();
      },
    });

    // first paint compiles the opening chapter synchronously and gives the
    // preloader a real frame to reveal
    this.renderFrame();
    this.warming = false;

    if (this.options.reducedMotion) {
      this.renderFrame();
    } else {
      this.loop();
    }

    this.scheduleWarm();
  }

  private warmTimer = 0;
  private warmRunning = false;
  private warmAgain = false;

  /** Coalesces the requests of a burst of late arrivals into one warm-up pass, run once they have settled. */
  private scheduleWarm(): void {
    clearTimeout(this.warmTimer);
    this.warmTimer = window.setTimeout(async () => {
      if (this.disposed) return;
      if (this.warming) {
        this.scheduleWarm(); // the first frame is still compiling the opening
        return;
      }
      if (this.warmRunning) {
        this.warmAgain = true;
        return;
      }
      this.warmRunning = true;
      do {
        this.warmAgain = false;
        await this.warmSeams();
      } while (this.warmAgain);
      this.warmRunning = false;
    }, 400);
  }

  /**
   * Link every chapter's shader programs before the scroll gets there.
   *
   * three keys each lit program on the number of lights that are visible, and that number changes at
   * most chapter seams (the room's lamps, the town's streetlights, the storm, the city, the airfield),
   * so entering a chapter used to link dozens of programs on the render thread: 59 at the town, 12 at
   * the city. Warming them under the opening's lights (what this used to do) links variants nothing
   * ever draws, and a compile against the screen is not the program the composer's buffer needs
   * either (that one writes linear colour, with no tone map). So each distinct visibility state
   * along the story is compiled once, in story order, with the composer's own target bound, and the
   * scene shown to the compiler holding only what that state shows. KHR_parallel_shader_compile
   * keeps the links off the render thread, and each state is one idle-sized step.
   */
  private async warmSeams(): Promise<void> {
    const { scene, renderer, camera, plane, trail } = this;
    const target = this.composer.inputBuffer;
    // the probe's cube is prefiltered (PMREM) the first time a material asks for it, and the lit programs
    // that read it are different programs from then on: so prefilter it now, before they are linked
    if (this.envProbe) this.envProbe.texture.needsPMREMUpdate = true;
    const seen = new Set<string>();
    const shown = new Set<Object3D>();
    const states: number[] = [];
    for (let t = 0; t <= 1; t += 0.0025) {
      this.applyVisibility(t);
      for (const o of scene.children) if (o.visible) shown.add(o);
      const key = scene.children.map((o) => (o.visible ? 1 : 0)).join('');
      if (seen.has(key)) continue;
      seen.add(key);
      states.push(t);
    }
    for (const t of states) {
      if (this.disposed) return;
      // the sub-step below is synchronous end to end, so no frame can interleave with the borrowed state
      this.applyVisibility(t);
      const planeShown = plane.group.visible;
      const trailShown = trail.visible;
      plane.group.visible = t > 0.01;
      trail.visible = t > CONTRAIL_FROM;
      const all = scene.children;
      scene.children = all.filter((o) => o.visible);
      renderer.setRenderTarget(target);
      let linked: Promise<unknown>;
      try {
        linked = renderer.compileAsync(scene, camera);
      } finally {
        renderer.setRenderTarget(null);
        scene.children = all;
        plane.group.visible = planeShown;
        trail.visible = trailShown;
        this.applyVisibility(this.renderT);
      }
      try {
        await linked;
      } catch {
        // a failed link must never break the wave
      }
    }
    // what the chapters show only once an actor switches it on (bursts, confetti): unlit, so any state will do
    for (const o of scene.children.filter((c) => !shown.has(c))) {
      renderer.setRenderTarget(target);
      const linked = renderer.compileAsync(o, camera, scene);
      renderer.setRenderTarget(null);
      await linked.catch(() => undefined);
    }
  }

  /**
   * Which chapter groups exist at story time `t`. One place, so the frame and the shader warm-up
   * (warmSeams) agree on what is in view, and so on how many lights are.
   */
  private applyVisibility(t: number): void {
    // Chapter actors only exist near their window. "Fully fogged" is NOT
    // invisible — fog-colored silhouettes still read against the brighter
    // sky gradient — so distant chapters are hidden outright.
    // the raymarched slab hands weather over to the beacon's own sea/rain at
    // CH6 — overlapping them stacked two fullscreen shaders on iGPUs
    // weather starts ABOVE the city, not over it: the deck used to open at
    // 0.14 while the flight was still crossing rooftops
    // the deck opens DURING the climb now, so the first puffs arrive while the
    // nose is still coming up out of the city and the camera flies into them
    // (both cloud decks and the raymarched slab gate themselves — Clouds.update
    // ramps their opacity/coverage on t so nothing pops on or off)
    // storm rain is fully faded by 0.52 (stormness ends there) — the group
    // lingering to 0.58 double-paid rain over the beacon's local shower
    this.storm.group.visible = t > 0.3 && t < 0.52;
    this.biplane.group.visible = t > 0.32 && t < 0.49;
    this.birds.group.visible = t > 0.055 && t < 0.3;
    // ends with the sea reveal (0.605) — the extra tail let the camera catch
    // radar rings and ship lights hanging in the no-fly sky during the bend
    // from 0.4: the sea comes up under the storm before the lighthouse forms out of the mist
    this.beacon.group.visible = t > 0.4 && t < 0.605;
    // (the overnight deck gates itself — Clouds.update fades it in on t)
    // city arrives while the camera is still short of the first lots (it
    // crosses x≈170 near t 0.66) so it builds at a distance instead of
    // materializing around the lens.
    // Earlier than it used to be: the no-fly map that used to floor this gap
    // is gone, and the overnight deck's lower band stops at x≈184, so between
    // 0.635 and 0.65 there was nothing under the flight at all. The city's own
    // ground sheet is what fills it — 30+ units out and deep in fog.
    // switched on inside the weather (the fog has closed in around the lens by then), not out in the open
    this.city.group.visible = t > 0.622 && t < 0.83;
    this.copilot.group.visible = t > 0.75 && t < 0.9;
    // up through the weather as the flight comes down out of it (the fog and the deck cover the arrival)
    this.landing.group.visible = t > 0.83;
    // The room is measurably off-screen from t=0.17 — an AABB-vs-frustum test
    // on the desk, the panel and the window frame returns false at 0.17, 0.19,
    // 0.21, 0.24, 0.28 and 0.31 — but it was kept "visible" until 0.32.
    //
    // The saving is CPU, not GPU: three already frustum-culls the geometry, so
    // draw calls barely move (21 to 23 across the old boundary). What stops is
    // the per-frame work that visibility gates — the 250-mote dust loop below,
    // and the matrix/traverse cost of the room's object tree — for the ~15% of
    // the story between leaving the window and the old cut. 0.20 keeps a
    // margin past the window exit.
    const nearDesk = t < DESK_UNTIL;
    this.desk.group.visible = nearDesk;
    this.panel.group.visible = nearDesk;
    this.windowFrame.group.visible = nearDesk;
    // gone before the cloud sea: at t≈0.2+ the tallest roofs poked through
    // the cloud floor as floating slabs
    this.rooftops.group.visible = t > 0.06 && t < 0.335;
  }

  private warming = true;
  private frameNo = 0;

  private hslA = { h: 0, s: 0, l: 0 };
  private hslB = { h: 0, s: 0, l: 0 };

  /**
   * Cross-fade two chapter colours into `colorA`, taking hue the SHORT way.
   *
   * A channel-wise lerp walks a straight line through colour space, and when
   * the ends sit opposite in hue and far apart in luminance that line runs
   * through mud. The copilot→landing seam is the flight's worst case: near
   * black night blue (#05070f) to dawn peach (#c9a58f) gave a flat brick brown
   * for the whole 0.83–0.88 band — measured #766054 fog, #985d4a horizon at
   * t=0.85, which is neither night nor dawn.
   *
   * three's own lerpHSL does not help: it lerps hue linearly with no wrap, so
   * the same pair ran DOWNWARD through cyan and yellow instead (horizon
   * #e8ef3c at 0.865 — a green sunrise). Wrapping at ±0.5 takes the arc a real
   * sunrise takes: indigo, violet, rose, peach.
   *
   * Saturation is pulled DOWN in the middle of the crossing. Interpolating it
   * straight lands on a fully saturated mid-tone — the same seam went neon
   * purple (#81439e horizon, a flat magenta field). Skies desaturate as they
   * turn; the sine dips to 0.5 at the midpoint and is exactly 1 at both ends,
   * so no chapter's own grade is altered.
   */
  private blend(a: string, b: string, u: number): void {
    this.colorA.set(a).getHSL(this.hslA);
    this.colorB.set(b).getHSL(this.hslB);
    let dh = this.hslB.h - this.hslA.h;
    if (dh > 0.5) dh -= 1;
    else if (dh < -0.5) dh += 1;
    this.colorA.setHSL(
      (this.hslA.h + dh * u + 1) % 1,
      MathUtils.lerp(this.hslA.s, this.hslB.s, u) * (1 - 0.5 * Math.sin(Math.PI * u)),
      MathUtils.lerp(this.hslA.l, this.hslB.l, u),
    );
  }

  private applyGrade(t: number): void {
    const { from, to, u } = gradeBlendAt(t);
    const num = (pick: (g: GradeParams) => number): number =>
      MathUtils.lerp(pick(from), pick(to), u);

    this.blend(from.zenith, to.zenith, u);
    this.sky.zenith.copy(this.colorA);
    this.blend(from.horizon, to.horizon, u);
    this.sky.horizon.copy(this.colorA);

    const sunLevel = num((g) => g.sunIntensity);
    this.sunLevel = sunLevel;
    this.sky.cloud = num((g) => g.cloud ?? 0);
    // clouds dim with the sun so the storm reads dark, not milky
    const cloudBrightness = MathUtils.clamp(0.3 + (sunLevel / 1.6) * 0.7, 0.3, 1);

    this.blend(from.sunColor, to.sunColor, u);
    this.sky.sunColor.copy(this.colorA);
    this.sun.color.copy(this.colorA);
    this.clouds.sunColor.copy(this.colorA).multiplyScalar(cloudBrightness);

    this.clouds.skyColor.copy(this.sky.zenith).lerp(this.sky.horizon, 0.3);
    // the land bounces the low sun up into the cloud bases: warm, and only worth anything by day
    this.clouds.groundColor.copy(this.sky.sunColor).lerp(this.sky.horizon, 0.35)
      .multiplyScalar(0.14 * MathUtils.smoothstep(sunLevel, 0.5, 1.6));

    this.blend(from.fogColor, to.fogColor, u);
    this.fog.color.copy(this.colorA);
    this.clouds.fogColor.copy(this.colorA);
    this.renderer.setClearColor(this.colorA);

    // cloud shadow side follows the fog/ambient mood
    this.clouds.shadowColor
      .copy(this.colorA)
      .lerp(this.colorB.set('#ffffff'), 0.3 * cloudBrightness)
      .multiplyScalar(0.55 + 0.45 * cloudBrightness);

    this.sunDirWorld
      .set(
        num((g) => g.sunDir[0]),
        num((g) => g.sunDir[1]),
        num((g) => g.sunDir[2]),
      )
      .normalize();
    this.sky.sunDir.copy(this.sunDirWorld);
    this.sky.sunIntensity = sunLevel;
    this.mountains.setSunIntensity(sunLevel);
    this.sun.intensity = sunLevel * 2.2 * num((g) => g.key ?? 1);
    // sky-and-ground bounce: shadowed surfaces take the colour of the sky from above and of
    // the sunlit ground from below, so shade is never a flat grey and rooftops pick up warmth
    this.hemi.color.copy(this.sky.horizon).lerp(this.sky.zenith, 0.35);
    this.hemi.groundColor.copy(this.fog.color).lerp(this.sun.color, 0.3).multiplyScalar(0.55);
    this.hemi.intensity = 0.3 + 0.3 * MathUtils.clamp(sunLevel / 1.6, 0, 1);
    // lamps are lit under the window at night and go out as the sun comes up
    this.lampLevel = 1 - MathUtils.smoothstep(sunLevel, 0.5, 1.3);
    this.fog.near = num((g) => g.fogNear);
    this.fog.far = num((g) => g.fogFar);
    // mist standing on the ground or the sea: blends between chapters, with the base
    // height following whichever surface each chapter's mist stands on
    const mistOf = (g: GradeParams): { strength: number; boost: number; scale: number; base: number } => {
      const m = g.mist;
      if (!m) return { strength: 0, boost: 1, scale: 8, base: 0 };
      return {
        strength: m.strength, boost: m.boost, scale: m.scale,
        base: m.base === 'sea' ? this.beacon.group.position.y + 0.15 : ROOFTOP_BASE_Y,
      };
    };
    const m0 = mistOf(from);
    const m1 = mistOf(to);
    // a chapter with no mist borrows its neighbour's shape, so only the strength fades
    const lo = m0.strength > 0 ? m0 : { ...m1, strength: 0 };
    const hi = m1.strength > 0 ? m1 : { ...m0, strength: 0 };
    fogHeight.value.set(
      MathUtils.lerp(lo.strength, hi.strength, u),
      MathUtils.lerp(lo.base, hi.base, u),
      MathUtils.lerp(lo.scale, hi.scale, u),
      MathUtils.lerp(lo.boost, hi.boost, u),
    );
    // the haze glows toward the sun (every tier: it is a few ALU in the fog every material shares)
    fogSun.value.set(this.sunDirWorld.x, this.sunDirWorld.y, this.sunDirWorld.z, num((g) => g.inscatter ?? 0));
    fogSunColor.value.copy(this.sun.color);
    if (this.volume) {
      // like the mist: a chapter without a volume borrows its neighbour's shape and fades its density
      type Vol = { density: number; scale: number; noise: number; aniso: number; sun: number; ambient: number; base: number };
      const volOf = (g: GradeParams): Vol | null => {
        const v = g.volume;
        if (!v) return null;
        return {
          density: v.density, scale: v.scale, noise: v.noise ?? 0.5, aniso: v.aniso ?? 0.75,
          sun: v.sun ?? 1, ambient: v.ambient ?? 0.5,
          base: v.base === 'sea' ? this.beacon.group.position.y + 0.15 : ROOFTOP_BASE_Y,
        };
      };
      const a = volOf(from);
      const b = volOf(to);
      const v0 = a ?? (b ? { ...b, density: 0 } : null);
      const v1 = b ?? (a ? { ...a, density: 0 } : null);
      const p = this.volume.params;
      if (!v0 || !v1) {
        p.density = 0;
      } else {
        const mix = (k: keyof Vol): number => MathUtils.lerp(v0[k], v1[k], u);
        p.density = mix('density');
        p.scale = mix('scale');
        p.noise = mix('noise');
        p.aniso = mix('aniso');
        p.sun = mix('sun');
        p.base = mix('base');
        p.ambient.copy(this.fog.color).lerp(this.sky.zenith, 0.4).multiplyScalar(mix('ambient'));
      }
    }
    // arriving over the city: a sea of mist stands on its streets, so the skyline rises out of it and the
    // streets come up as the flight goes down into them (it thins and goes by 0.76)
    const cityMist = MathUtils.smoothstep(t, 0.628, 0.66) * (1 - MathUtils.smoothstep(t, 0.7, 0.76));
    if (cityMist > 0) {
      const v = fogHeight.value;
      v.set(
        Math.max(v.x, cityMist), MathUtils.lerp(v.y, this.city.group.position.y, cityMist),
        MathUtils.lerp(v.z, 10, cityMist), MathUtils.lerp(v.w, 4.2, cityMist),
      );
    }
    if (this.ssr) this.ssr.wet = num((g) => g.wet ?? 0.25);
    if (this.ssgi) this.ssgi.intensity = num((g) => g.bounce ?? 0.8);
    this.scene.environmentIntensity = num((g) => g.envIntensity);
    // materials with their own envMap ignore the line above
    KitCity.setEnvIntensity(this.scene.environmentIntensity);
    // the rooms behind the close-up windows: daylight through the glass, and their lamps, which
    // are only worth seeing once the day has gone (by day a lit room is a faint warmth)
    windowLight.day.value = MathUtils.smoothstep(sunLevel, 0.4, 1.4);
    // the city's glass comes on with the city (City.update)
    const cityLit = t > 0.62 && t < 0.8 ? 0.25 + 0.75 * MathUtils.smoothstep(t, 0.64, 0.71) : 1;
    windowLight.lamp.value = (0.3 + 0.7 * this.lampLevel) * cityLit;
  }

  /**
   * Blockout mode: swap every lit material for a flat one. Emissive is folded
   * into the base colour so anything that was glowing (screens, lit windows,
   * beacons) still reads, and the cache keys off the source material so
   * instanced meshes keep sharing one material — and one draw call.
   */
  private flatten(root: Object3D): void {
    root.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh || Array.isArray(mesh.material)) return;
      const src = mesh.material as MeshStandardMaterial;
      if (!src?.isMeshStandardMaterial) return;
      let flat = this.flatCache.get(src);
      if (!flat) {
        const color = src.color.clone();
        // Only fold FLAT emissive into the colour. When there is an emissive
        // MAP the texture already says where the light is, and adding the
        // tint on top washed whole buildings to solid glow — the facades
        // vanished and the district read as floating windows.
        if (src.emissiveIntensity > 0 && !src.emissiveMap) {
          color.add(src.emissive.clone().multiplyScalar(Math.min(src.emissiveIntensity, 1.4)));
        }
        flat = new MeshBasicMaterial({
          color,
          map: src.map ?? src.emissiveMap,
          transparent: src.transparent,
          opacity: src.opacity,
          side: src.side,
          depthWrite: src.depthWrite,
          fog: src.fog,
        });
        this.flatCache.set(src, flat);
        this.flatMaterials.push(flat);
      }
      mesh.material = flat;
    });
  }

  private flatCache = new Map<MeshStandardMaterial, MeshBasicMaterial>();
  private flatMaterials: MeshBasicMaterial[] = [];

  private renderFrame(): void {
    const now = performance.now();
    const rawMs = now - this.lastTime;
    const dt = Math.min(rawMs / 1000, 0.1);
    this.lastTime = now;
    this.govern(rawMs, now);
    const time = (now - this.startTime) / 1000;
    const target = this.idlePreset ? this.idlePreset.t : this.scrollT;
    // mass-spring scrub: the world has WEIGHT — it leans into motion,
    // carries momentum, and settles with a breath of overshoot (ζ≈0.85).
    // A plain exponential chase tracked fine but felt weightless.
    const err = Math.abs(target - this.renderT);
    if (this.options.reducedMotion) {
      this.renderT = target;
      this.scrubVel = 0;
    } else {
      // Softer and less damped than before: K 170/C 25 sat at ζ≈0.96, which
      // is a spring that stops dead on arrival. ζ≈0.80 lets the world lean
      // past the target and settle back, so the flight carries its own
      // momentum a few frames beyond the scroll instead of being pinned to it.
      const K = 120; // stiffness: response ≈ quarter of a second
      const C = 17.5; // damping: ζ≈0.80 — weight, with a breath of overshoot
      this.scrubVel += (target - this.renderT) * K * dt;
      this.scrubVel *= Math.exp(-C * dt);
      this.renderT = MathUtils.clamp(this.renderT + this.scrubVel * dt, 0, 1);
    }
    if (err < 0.0004 && Math.abs(this.scrubVel) < 0.004) {
      this.renderT = target;
      this.scrubVel = 0;
    }

    // speed blur: fast scrubbing streaks the frame along the flight line,
    // easing off as the world catches up (never under reduced motion)
    const blurTarget = this.options.reducedMotion
      ? 0
      : MathUtils.smoothstep(err, 0.006, 0.05) * 0.17;
    this.blurLevel = MathUtils.damp(this.blurLevel, blurTarget, 9, dt);
    this.zoomBlur.strength = this.blurLevel < 0.004 ? 0 : this.blurLevel;
    const t = this.renderT;

    this.applyGrade(t);

    // fold beat: letter → dart in CH1; dart → letter again after touchdown
    const foldIn = MathUtils.smoothstep(t, FOLD_WINDOW.start, FOLD_WINDOW.end);
    const unfold = MathUtils.smoothstep(t, UNFOLD_WINDOW.start, UNFOLD_WINDOW.end);
    this.plane.setFold(foldIn * (1 - unfold));
    // (the fold's puff of flecks is BatchSend's: pure in t, so it scrubs)
    if (this.prevT < TOUCHDOWN_T && t >= TOUCHDOWN_T) {
      this.confetti.trigger(this.rig.planeWorldPos, time);
    }
    this.prevT = t;

    // the lighthouse delivery: for the beat where the dart flies into the lantern the camera
    // holds outside it, south-east of the tower, instead of trailing the dart through the glass
    const shot = this.rig.shot;
    shot.weight = this.idlePreset ? 0 : MathUtils.smoothstep(t, 0.512, 0.526) * (1 - MathUtils.smoothstep(t, 0.566, 0.58));
    shot.position.set(147.6, 24.2, 0.9);
    shot.look.copy(this.lanternCentre);

    // the storm's lightning reaches the lens as a short jolt (last frame's flash: the storm updates later)
    this.rig.jolt = this.idlePreset ? 0 : Math.max(this.storm.flash, this.lightning.flash);
    this.rig.update(t, time, dt);
    // the plane "comes out of the screen": hidden until the launch thread
    // has drawn a little way out of the laptop (sub-pages always show it)
    // (it is the third plane of the batch: two scouts have left the laptop ahead of it, and it
    // leaves the screen as an envelope (BatchSend's) that opens into this letter)
    const heroOpen = this.idlePreset ? 1 : MathUtils.smoothstep(t - HERO_RELEASE, STAGE.openFrom, STAGE.openTo);
    this.plane.group.visible = this.idlePreset !== null || t > HERO_RELEASE + STAGE.openFrom;
    // the dart is swallowed by the arrival screen it flies into
    const absorbed = this.idlePreset ? 0 : MathUtils.smoothstep(t, 0.982, 0.998);
    // the dart dissolves into the lamp as it reaches the lantern, and re-forms on the far side
    const intoLamp = this.idlePreset ? 1 : MathUtils.smoothstep(this.rig.planeWorldPos.distanceTo(this.lanternCentre), 0.5, 4.2);
    this.delivered = 1 - intoLamp;
    // small beside the laptop, full size once the flight opens up over the town
    const size = this.idlePreset ? 1 : planeScale(t) * (0.45 + 0.55 * heroOpen);
    this.plane.group.scale.setScalar(Math.max((1 - absorbed) * intoLamp * size, 1e-4));
    if (intoLamp < 0.02) this.plane.group.visible = false;
    this.launchString.update(this.idlePreset ? 1 : t, this.path);
    this.plane.flex(time, t > CONTRAIL_FROM || this.idlePreset ? 1 : 0);

    // idle orbit for sub-pages: slow crane shot around the parked plane
    if (this.idlePreset) {
      const { orbitRadius, orbitHeight, orbitSpeed } = this.idlePreset;
      const angle = time * orbitSpeed;
      this.plane.group.position.y += Math.sin(time * 0.9) * 0.15;
      this.camera.position.set(
        this.rig.planeWorldPos.x + Math.cos(angle) * orbitRadius,
        this.rig.planeWorldPos.y + orbitHeight,
        this.rig.planeWorldPos.z + Math.sin(angle) * orbitRadius,
      );
      this.camera.lookAt(this.plane.group.position);
    }

    // maneuver flourish: hard bank + camera slide while the DOM swaps
    if (this.maneuverPulse > 0.01) {
      const pulse = this.maneuverPulse;
      this.plane.group.rotateZ(Math.sin((1 - pulse) * Math.PI) * 1.1 * pulse);
      this.camera.position.addScaledVector(this.rig.currentSide, Math.sin((1 - pulse) * Math.PI) * 1.6);
      this.maneuverPulse *= Math.exp(-3.5 * dt);
    } else {
      this.maneuverPulse = 0;
    }

    // the lens: bars and focus come from the rig's shot list (none on the sub-page orbits); the
    // corners split a little more while a fast scrub streaks the frame
    if (this.cinema) {
      const idle = this.idlePreset !== null;
      this.cinema.letterbox = idle ? 0 : this.rig.cine.bars;
      const focus = idle ? this.camera.position.distanceTo(this.plane.group.position) : this.rig.cine.focus;
      this.cinema.frame(focus, idle ? 1.2 : this.rig.cine.bokeh, 1.4 + this.blurLevel * 14);
    }

    // sun follows the plane so the directional light never runs out of range
    this.sun.target.position.copy(this.rig.planeWorldPos);
    if (this.sun.castShadow) {
      // snap the shadow window to whole shadow-map texels along the light's own axes,
      // so shadows hold still on the ground as the plane flies instead of swimming
      const texel = (2 * SUN_SHADOW_HALF) / SUN_SHADOW_MAP;
      const right = this.tmpV.set(0, 1, 0).cross(this.sunDirWorld).normalize();
      const up = this.tmpV2.copy(this.sunDirWorld).cross(right);
      const at = this.sun.target.position;
      const snap = (v: number): number => ((v % texel) + texel) % texel;
      at.addScaledVector(right, -snap(at.dot(right))).addScaledVector(up, -snap(at.dot(up)));
    }
    this.sun.position.copy(this.sun.target.position).addScaledVector(this.sunDirWorld, 60);

    this.sky.followCamera(this.camera.position);
    // each bolt's return stroke lights the sky and the sea as the storm's own flashes do (last frame's value)
    const flash = Math.max(this.storm.flash, this.lightning.flash * 0.5);
    this.sky.flash = flash;
    this.sky.time = time;

    // sun direction in view space for the sprite lighting gradient
    this.tmpV.copy(this.sunDirWorld).transformDirection(this.camera.matrixWorldInverse);
    if (Math.abs(this.tmpV.x) + Math.abs(this.tmpV.y) > 1e-4) {
      this.sunScreenDir.set(this.tmpV.x, this.tmpV.y).normalize();
    }

    this.applyVisibility(t);
    const nearDesk = t < DESK_UNTIL;
    /**
     * Climb-out: the deck closes underneath you.
     *
     * Driven by ALTITUDE, not by t, so the district is lost to weather at the
     * height where that reads as true rather than at a scroll position that
     * happens to be near it. Fog pulls in hard as the camera passes ~14 up to
     * ~24, which is also what thickens the cloud sprites — they take their
     * fog from these same two numbers on the next line.
     *
     * The district is only CUT once that fog has already swallowed it, so the
     * removal cannot pop: at full closure fogFar is 34 while the nearest roof
     * is tens of units off, leaving it milk before it goes. Bounded to the
     * climb (out by t=0.42) so CH9's starfield keeps its own long fog.
     */
    const deckClose =
      MathUtils.smoothstep(this.camera.position.y, 17, 26) *
      (1 - MathUtils.smoothstep(t, 0.36, 0.42));
    if (deckClose > 0) {
      // eased back from 2/34: at that thickness the climb went to flat milk
      // and took the formation chapter's staging with it. 8/78 still loses
      // the ground and still reads as cloud, without closing the whole frame.
      // 16/115 now (it was 8/78): the same cloud floor, with the sky above and
      // the weather in it readable instead of one flat tan fog
      this.fog.near = MathUtils.lerp(this.fog.near, 40, deckClose);
      this.fog.far = MathUtils.lerp(this.fog.far, 240, deckClose);
    }
    // the district leaves the frame by thickening into the storm's weather, not by
    // vanishing: fog closes over it between 0.30 and 0.335, then it is cut
    // the sea-to-city handover happens inside weather: fog draws in around the lens while the sea is gone and the
    // city is switched on, then opens as the city comes up, so nothing pops in at its far edge
    const closing = MathUtils.smoothstep(t, 0.592, 0.615) * (1 - MathUtils.smoothstep(t, 0.632, 0.7));
    if (closing > 0) {
      this.fog.near = MathUtils.lerp(this.fog.near, 5, closing);
      this.fog.far = MathUtils.lerp(this.fog.far, 42, closing);
    }
    // the descent to the airfield goes through cloud too: fog closes while the starfield is left behind,
    // the airfield is switched on inside it, and it opens as the runway lights come up
    const descent = MathUtils.smoothstep(t, 0.815, 0.838) * (1 - MathUtils.smoothstep(t, 0.852, 0.896));
    if (descent > 0) {
      this.fog.near = MathUtils.lerp(this.fog.near, 4, descent);
      this.fog.far = MathUtils.lerp(this.fog.far, 62, descent);
    }
    const leave = MathUtils.smoothstep(t, 0.3, 0.335);
    // the town's haze leaves with it (the grade alone would keep it lit over an empty frame until 0.385)
    if (this.volume) this.volume.intensity = t < 0.45 ? 1 - leave : 1;
    if (leave > 0) {
      this.fog.near = MathUtils.lerp(this.fog.near, 12, leave);
      this.fog.far = MathUtils.lerp(this.fog.far, 70, leave);
    }
    this.rooftops.update(time, this.lampLevel, this.rig.planeWorldPos, this.camera.position);
    this.batch.update(this.idlePreset ? 1 : t, time, this.rooftops.sites, this.camera.aspect);
    this.mountains.update(t, this.camera.position, this.fog.color, 0);

    if (nearDesk) {
      this.desk.update(time); // 250-mote dust loop, pointless offscreen
      // the live laptop display, and the screen's spill on the desk swelling with each launch
      const launchT = this.idlePreset ? 1 : t;
      liveLaptopScreen()?.update(launchT, this.options.reducedMotion);
      if (this.screenSpill) this.screenSpill.intensity += launchPulse(launchT) * (this.options.reducedMotion ? 0.4 : 1.0);
    }
    this.panel.update(t);
    this.clouds.update(time, this.sunScreenDir, this.fog.near, this.fog.far, t);
    this.envelopes.update(
      this.rig.planeWorldPos,
      this.rig.currentSide,
      this.rig.currentTangent,
      t,
      time,
      this.camera,
    );
    const stormness =
      MathUtils.smoothstep(t, 0.34, 0.38) * (1 - MathUtils.smoothstep(t, 0.46, 0.52));
    this.storm.update(time, dt, stormness, Math.random, t);
    // bolts through the storm and the lighthouse's sky: the storm's let-down to the end of the beacon,
    // landing on the sea (the water's height from the first beacon frame, a fixed one before it);
    // never under reduced motion or on the sub-page orbits
    const bolts =
      this.options.reducedMotion || this.idlePreset ? 0
        : MathUtils.smoothstep(t, 0.345, 0.375) * (1 - MathUtils.smoothstep(t, 0.63, 0.665));
    // the bolts land on the sea, then on the city's roofs as the flight crosses over to it
    // (and the storm's first strikes, where the town fades into the weather, land on the town's ground)
    const stormGround = MathUtils.lerp(ROOFTOP_BASE_Y, this.beacon.group.position.y + 0.15, MathUtils.smoothstep(t, 0.39, 0.42));
    const seaY = MathUtils.lerp(stormGround, this.city.group.position.y, MathUtils.smoothstep(t, 0.6, 0.625));
    this.lightning.update(
      time, dt, bolts, this.camera, seaY, Math.max(this.camera.position.y + 55, seaY + 70),
      innerHeight * Math.min(devicePixelRatio, 2),
    );
    this.biplane.update(t, time, this.storm.flash);
    this.birds.update(time, t);
    this.wingPlanes.update(
      this.rig.planeWorldPos,
      this.rig.currentSide,
      this.rig.currentTangent,
      this.plane.group.quaternion,
      t,
      time,
    );
    this.traffic.update(t, time);
    this.plane.setBeamHit(
      this.beacon.update(time, this.camera, t, this.rig.planeWorldPos, Math.max(this.storm.flash, this.lightning.flash * 0.6), this.fog.color, this.delivered),
    );
    // dev hook for automated inspection: `window.__cam = { p: [x,y,z], l: [x,y,z] }` takes the camera
    const hook = this.probe ? (window as unknown as { __cam?: { p: number[]; l: number[] } }).__cam : undefined;
    if (hook) {
      this.camera.position.set(hook.p[0]!, hook.p[1]!, hook.p[2]!);
      this.camera.lookAt(hook.l[0]!, hook.l[1]!, hook.l[2]!);
      this.sky.followCamera(this.camera.position);
    }
    // the delivery readout, pinned to the lamp
    this.camera.updateMatrixWorld();
    this.updateGodRays();
    this.deliveryPopup.update(!this.idlePreset && t > 0.545 && t < 0.586, this.beacon.lantern, this.camera);
    this.batchHud.update(this.batch.state(t), this.camera, !this.idlePreset && !this.warming);
    this.city.update(t, time, this.rig.planeWorldPos);
    this.copilot.update(
      this.rig.planeWorldPos,
      this.plane.group.quaternion,
      this.rig.currentSide,
      t,
      time,
    );
    this.landing.update(t, time);
    this.burst.update(time);
    this.confetti.update(time);
    this.raycast.update(this.camera);

    this.flock.update(t, time, this.path, this.camera);

    if (t > CONTRAIL_FROM) {
      this.trail.visible = true;
      this.trail.update(t, this.path, this.plane.group.position);
    } else {
      this.trail.visible = false;
    }
    this.airTrail.update(t, time, this.path, this.plane.group.position);

    // The sun's shadow map and the reflection probe are whole-scene passes, and neither shows a change
    // from one frame to the next: shadows trail the plane by one frame, reflections refresh at half rate.
    const refresh = this.options.reducedMotion || (this.frameNo++ & 1) === 0;
    if (this.sun.castShadow) this.sun.shadow.needsUpdate = refresh;
    this.pinned.update(t, this.camera.position, this.idlePreset === null);
    this.beacon.renderReflection(this.renderer, this.scene, this.camera);
    this.depthNormals?.invalidate();
    this.composer.render();
    // The probe works where there is something wet or glossy to mirror it: the town, the city, and the
    // rain-soaked lighthouse.
    // It draws after the frame, when every light that just came into view has its shadow map (the
    // probe's own renders do not redraw them).
    const ground = t > 0.09 && t < 0.3 ? ROOFTOP_BASE_Y : t > 0.62 && t < 0.82 ? 0
      : t > 0.46 && t < 0.6 ? this.beacon.group.position.y + 1.5 : null;
    if (refresh) this.envProbe?.update(this.renderer, this.scene, this.camera.position, ground, this.probeHidden);

    if (this.warming) return; // silent warm-up frames: no chrome events
    if (!this.firstFrameDone) {
      this.firstFrameDone = true;
      window.dispatchEvent(new CustomEvent('flight:ready'));
    }
    window.dispatchEvent(new CustomEvent('flight:t', { detail: t }));
  }

  private firstFrameDone = false;

  /** what hangs in front of the probe and must stay out of the reflections it gives */
  private get probeHidden(): Object3D[] {
    return [
      this.plane.group, this.trail.line, this.airTrail.mesh, this.flock.group, this.launchString.line,
      this.wingPlanes.group, this.batch.group, this.burst.points, this.confetti.points,
    ];
  }

  private sunNdc = new Vector3();
  private sunUv = new Vector2();

  /**
   * Points the shaft pass at the sun. Strength is how much of the sun there is to see: it needs a bright
   * grade (night chapters have a moon, not a sun), it must be in front of the lens, and it fades out as it
   * slips off the edge of the frame — shafts reach well past the edge, so it is a long fade.
   */
  private updateGodRays(): void {
    if (!this.godRays) return;
    const camera = this.camera;
    this.tmpV.copy(camera.position).addScaledVector(this.sunDirWorld, 200).project(camera);
    const ndc = this.sunNdc.copy(this.tmpV);
    camera.getWorldDirection(this.tmpV2);
    const facing = this.tmpV2.dot(this.sunDirWorld);
    const offscreen = Math.max(Math.abs(ndc.x), Math.abs(ndc.y));
    const strength =
      MathUtils.smoothstep(this.sunLevel, 0.55, 1.1) *
      MathUtils.smoothstep(facing, 0.05, 0.4) *
      (1 - MathUtils.smoothstep(offscreen, 1.2, 2.2));
    this.sunUv.set(ndc.x * 0.5 + 0.5, ndc.y * 0.5 + 0.5);
    // the lens flare only while the sun's disc itself is in the frame
    const flare = MathUtils.smoothstep(this.sunLevel, 0.6, 1.2) * MathUtils.smoothstep(facing, 0.3, 0.6) *
      (1 - MathUtils.smoothstep(offscreen, 0.85, 1.0));
    this.godRays.set(this.sunUv, this.idlePreset ? strength * 0.6 : strength, this.sun.color, 1.5, this.idlePreset ? 0 : flare);
  }

  private loop = (): void => {
    if (this.disposed) return;
    if (this.active) this.renderFrame();
    this.rafId = requestAnimationFrame(this.loop);
  };

  private active = true;

  /**
   * Stops and starts rendering without tearing anything down. The page pauses the engine once the
   * experience has scrolled out of view and the landing content covers the canvas completely.
   */
  setActive(active: boolean): void {
    if (active === this.active) return;
    this.active = active;
    // the first frame back must not read the whole pause as one slow frame (the resolution governor)
    if (active) this.lastTime = performance.now();
  }

  /** Back to the start of the flight (the landing page's replay button). */
  replay(): void {
    this.director?.scrollTop();
  }

  /**
   * Dynamic resolution (LOW only): the pixel ratio is scaled by `resolution`, which a frame-time
   * governor moves between 0.5 and 1. A phone that holds ~60 fps climbs to full density; one that
   * cannot backs off a step at a time instead of stuttering at native resolution.
   */
  private resolution = 1;
  private stepDownAt = 0;
  private frameEma = 16;
  private govAt = 0;

  private govern(dtMs: number, now: number): void {
    if (this.probe || this.options.reducedMotion || dtMs > 250) return;
    const high = this.quality.tier === 'high';
    // a compile or upload hitch is not a slow scene: count it as at most a 50 ms frame
    this.frameEma += (Math.min(dtMs, 50) - this.frameEma) * 0.06;
    if (now - this.govAt < 1400 || now - this.startTime < 2500) return;
    this.govAt = now;
    let next = this.resolution;
    // a step changes the pixel count by its square: 0.9 takes a 22 ms frame to about 18, and steps
    // up are held off for a while after a step down so a heavy chapter does not make it flutter
    const floor = high ? 0.6 : 0.5;
    if (this.frameEma > (high ? 21 : 27) && next > floor) {
      next = Math.max(floor, next * (high ? 0.9 : 0.85));
      this.stepDownAt = now;
    } else if (this.frameEma < 17.5 && next < 1 && (!high || now - this.stepDownAt > 8000)) {
      next = Math.min(1, next * 1.1);
    }
    if (Math.abs(next - this.resolution) > 0.01) {
      this.resolution = next;
      this.resize();
    }
  }
  private probe = new URLSearchParams(location.search).has('probe');

  private resize = (): void => {
    const dpr =
      Math.min(window.devicePixelRatio, this.quality.maxDpr) * this.quality.renderScale * this.resolution;
    const { clientWidth, clientHeight } = this.canvas;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(clientWidth, clientHeight, false);
    this.composer.setSize(clientWidth, clientHeight);
    if (this.cinema) this.cinema.pixelRatio = dpr;
    this.camera.aspect = clientWidth / clientHeight;
    this.camera.updateProjectionMatrix();
    if (this.options.reducedMotion) this.composer.render();
  };

  private onContextLost = (event: Event): void => {
    event.preventDefault();
    // Recovery lands with the poster overlay in the polish phase.
    console.warn('[engine] WebGL context lost');
  };

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.warmTimer);
    cancelAnimationFrame(this.rafId);
    window.removeEventListener('resize', this.resize);
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.director?.dispose();
    this.raycast.dispose();
    this.tooltip.dispose();
    this.deliveryPopup.dispose();
    this.batchHud.dispose();
    this.composer.dispose();
    this.envProbe?.dispose();
    this.depthNormals?.dispose();
    this.noise.dispose();
    this.plane.dispose();
    this.trail.dispose();
    this.airTrail.dispose();
    this.flock.dispose();
    this.launchString.dispose();
    this.sky.dispose();
    this.desk.dispose();
    liveLaptopScreen()?.dispose();
    this.panel.dispose();
    this.windowFrame.dispose();
    this.rooftops.dispose();
    this.mountains.dispose();
    this.clouds.dispose();
    this.envelopes.dispose();
    this.storm.dispose();
    this.biplane.dispose();
    this.birds.dispose();
    this.pinned.dispose();
    this.beacon.dispose();
    this.wingPlanes.dispose();
    this.batch.dispose();
    this.traffic.dispose();
    this.city.dispose();
    this.copilot.dispose();
    this.landing.dispose();
    this.burst.dispose();
    this.confetti.dispose();
    this.renderer.dispose();
  }
}
