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
  PMREMGenerator,
  PerspectiveCamera,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
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
import { ZoomBlurEffect } from './post/ZoomBlur';
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
import { Rooftops } from './actors/Rooftops';
import { Storm } from './actors/Storm';
import { Traffic } from './actors/Traffic';
import { Trail } from './actors/Trail';
import { AirTrail } from './actors/AirTrail';
import { Flock } from './actors/Flock';
import { WindowFrame } from './actors/WindowFrame';
import { WingPlanes } from './actors/WingPlanes';
import { CameraRig } from './rig/CameraRig';
import { FlightPath } from './rig/FlightPath';
import { setCompiler } from './warm';
import { Raycast } from './interact/Raycast';
import { Tooltip } from './interact/Tooltip';
import { SkyDome } from './materials/SkyDome';
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
  private sky = new SkyDome();
  private sun = new DirectionalLight('#ffd9a0', 1);
  private hemi = new HemisphereLight('#8fa8cc', '#1a1e2e', 0.35);
  private desk: Desk;
  private panel: Panel;
  private windowFrame: WindowFrame;
  private rooftops!: Rooftops;
  private clouds: Clouds;
  private envelopes: Envelopes;
  private storm: Storm;
  private biplane: Biplane;
  private birds: Birds;
  private beacon: Beacon;
  private wingPlanes = new WingPlanes();
  private traffic!: Traffic;
  private zoomBlur = new ZoomBlurEffect();
  private blurLevel = 0;
  private scrubVel = 0;
  private city: City;
  private copilot: Copilot;
  private landing: Landing;
  private burst: PaperBurst;
  private confetti: PaperBurst;
  private raycast = new Raycast();
  private tooltip = new Tooltip();
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
    new HDRLoader().load(
      asset('/hdri/sky_1k.hdr'),
      (hdr) => {
        this.scene.environment = pmrem.fromEquirectangular(hdr).texture;
        hdr.dispose();
        roomEnv.dispose();
        pmrem.dispose();
      },
      undefined,
      () => pmrem.dispose(), // offline: keep the RoomEnvironment look
    );

    const rand = mulberry32(919);
    this.desk = new Desk(new Vector3(0.4, 1.29, 0), this.quality.dustCount, rand);
    this.panel = new Panel(this.path.chapterAnchor(1));
    this.windowFrame = new WindowFrame(new Vector3(7, 2, 0.8));
    this.rooftops = new Rooftops(rand, this.quality);
    this.clouds = new Clouds(this.path.chapterAnchor(3), this.quality, rand, this.renderer);
    this.envelopes = new Envelopes(this.raycast, this.tooltip);
    this.storm = new Storm(this.path, this.quality.rainCount, rand);
    this.biplane = new Biplane(this.path);
    this.birds = new Birds(rand);
    this.beacon = new Beacon(this.path.chapterAnchor(5), this.raycast, this.tooltip, this.quality);
    this.city = new City(this.path.chapterAnchor(7), this.path, this.quality);
    this.copilot = new Copilot(this.path.chapterAnchor(8));
    // fixed roll-out point, not a story-t sample: the flight now turns off
    // the runway into the arrival office, so sampling near t=1 would drag the
    // whole airfield along with the turn
    this.landing = new Landing(new Vector3(270, 0.5, 0));
    this.burst = new PaperBurst(rand);
    this.confetti = new PaperBurst(rand);
    this.traffic = new Traffic(this.path);
    this.flock = new Flock(rand);

    this.scene.add(
      this.plane.group,
      this.trail.line,
      this.airTrail.mesh,
      this.flock.group,
      this.launchString.line,
      this.sky.mesh,
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
      this.biplane.group,
      this.birds.group,
      this.beacon.group,
      this.wingPlanes.group,
      this.traffic.group,
      this.city.group,
      this.copilot.group,
      this.landing.group,
      this.burst.points,
      this.confetti.points,
    );
    if (this.clouds.volume) this.scene.add(this.clouds.volume);

    this.rig = new CameraRig(this.path, this.camera, this.plane);

    this.composer = new EffectComposer(this.renderer, { frameBufferType: HalfFloatType });
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    // Ambient occlusion: the other half of "global illumination" — light
    // that CANNOT reach a crease. The probe supplies the bounce; this takes
    // it away again where geometry occludes itself, which is what makes
    // objects sit in a room instead of floating in front of it. HIGH only:
    // it costs a normal buffer plus a screen pass.
    const effects: Effect[] = [];
    if (this.quality.tier === 'high' && !UNLIT) {
      const normalPass = new NormalPass(this.scene, this.camera);
      this.composer.addPass(normalPass);
      effects.push(
        new SSAOEffect(this.camera, normalPass.texture, {
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
    }
    // bloom is a mip chain over the whole frame and it exists to sell light —
    // blockout mode keeps only the scroll blur and the vignette
    if (!UNLIT) {
      effects.push(new BloomEffect({ luminanceThreshold: 0.85, intensity: 1.1, mipmapBlur: true }));
    }
    effects.push(this.zoomBlur, new VignetteEffect({ darkness: 0.55 }));
    this.composer.addPass(new EffectPass(this.camera, ...effects));

    this.resize();
    window.addEventListener('resize', this.resize);
    this.canvas.addEventListener('webglcontextlost', this.onContextLost);

    if (UNLIT) this.flatten(this.scene);

    // streamed-in content (city GLB, desk props) compiles off the scroll path
    setCompiler((subtree) => {
      if (UNLIT) this.flatten(subtree);
      void this.renderer.compileAsync(subtree, this.camera, this.scene).catch(() => {});
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

    // link every other chapter's programs in the background, in STORY ORDER,
    // so a user scrolling the flight stays behind the compile wave. compile()
    // gathers materials with a plain traverse (visibility ignored), and
    // KHR_parallel_shader_compile keeps links off the render thread. Without
    // this, the first frame entering each chapter stalls 0.6–2.2s.
    const wave = [
      this.rooftops.group,
      this.clouds.sprites,
      ...(this.clouds.volume ? [this.clouds.volume] : []),
      this.envelopes.group,
      this.storm.group,
      this.biplane.group,
      this.birds.group,
      this.beacon.group,
      this.clouds.night,
      this.city.group,
      this.copilot.group,
      this.landing.group,
      this.burst.points,
      this.confetti.points,
    ];
    void (async () => {
      for (const subtree of wave) {
        try {
          await this.renderer.compileAsync(subtree, this.camera, this.scene);
        } catch {
          // a failed link must never break the wave
        }
      }
    })();
  }

  private warming = true;

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
    // clouds dim with the sun so the storm reads dark, not milky
    const cloudBrightness = MathUtils.clamp(0.3 + (sunLevel / 1.6) * 0.7, 0.3, 1);

    this.blend(from.sunColor, to.sunColor, u);
    this.sky.sunColor.copy(this.colorA);
    this.sun.color.copy(this.colorA);
    this.clouds.sunColor.copy(this.colorA).multiplyScalar(cloudBrightness);

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
    this.sun.intensity = sunLevel * 2.2;
    this.fog.near = num((g) => g.fogNear);
    this.fog.far = num((g) => g.fogFar);
    this.scene.environmentIntensity = num((g) => g.envIntensity);
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
    const dt = Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;
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
    if (this.prevT < FOLD_WINDOW.end && t >= FOLD_WINDOW.end) {
      this.burst.trigger(this.rig.planeWorldPos, time);
    }
    if (this.prevT < TOUCHDOWN_T && t >= TOUCHDOWN_T) {
      this.confetti.trigger(this.rig.planeWorldPos, time);
    }
    this.prevT = t;

    this.rig.update(t, time, dt);
    // the plane "comes out of the screen": hidden until the launch thread
    // has drawn a little way out of the laptop (sub-pages always show it)
    this.plane.group.visible = this.idlePreset !== null || t > 0.012;
    // the dart is swallowed by the arrival screen it flies into
    const absorbed = this.idlePreset ? 0 : MathUtils.smoothstep(t, 0.982, 0.998);
    this.plane.group.scale.setScalar(1 - absorbed);
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

    // sun follows the plane so the directional light never runs out of range
    this.sun.position.copy(this.rig.planeWorldPos).addScaledVector(this.sunDirWorld, 60);
    this.sun.target.position.copy(this.rig.planeWorldPos);

    this.sky.followCamera(this.camera.position);
    this.sky.flash = this.storm.flash;

    // sun direction in view space for the sprite lighting gradient
    this.tmpV.copy(this.sunDirWorld).transformDirection(this.camera.matrixWorldInverse);
    if (Math.abs(this.tmpV.x) + Math.abs(this.tmpV.y) > 1e-4) {
      this.sunScreenDir.set(this.tmpV.x, this.tmpV.y).normalize();
    }

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
    this.beacon.group.visible = t > 0.44 && t < 0.605;
    // (the overnight deck gates itself — Clouds.update fades it in on t)
    // city arrives while the camera is still short of the first lots (it
    // crosses x≈170 near t 0.66) so it builds at a distance instead of
    // materializing around the lens.
    // Earlier than it used to be: the no-fly map that used to floor this gap
    // is gone, and the overnight deck's lower band stops at x≈184, so between
    // 0.635 and 0.65 there was nothing under the flight at all. The city's own
    // ground sheet is what fills it — 30+ units out and deep in fog.
    this.city.group.visible = t > 0.635 && t < 0.83;
    this.copilot.group.visible = t > 0.75 && t < 0.9;
    this.landing.group.visible = t > 0.85;
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
    const nearDesk = t < 0.2;
    this.desk.group.visible = nearDesk;
    this.panel.group.visible = nearDesk;
    this.windowFrame.group.visible = nearDesk;
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
      this.fog.near = MathUtils.lerp(this.fog.near, 8, deckClose);
      this.fog.far = MathUtils.lerp(this.fog.far, 78, deckClose);
    }
    // gone before the cloud sea: at t≈0.2+ the tallest roofs poked through
    // the cloud floor as floating slabs
    this.rooftops.group.visible = t > 0.06 && t < 0.33 && deckClose < 0.99;
    this.rooftops.update(time);

    if (nearDesk) this.desk.update(time); // 250-mote dust loop, pointless offscreen
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
    this.biplane.update(t, time);
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
    this.plane.setBeamHit(this.beacon.update(time, this.camera, t, this.rig.planeWorldPos));
    this.city.update(t, time);
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

    this.composer.render();

    if (this.warming) return; // silent warm-up frames: no chrome events
    if (!this.firstFrameDone) {
      this.firstFrameDone = true;
      window.dispatchEvent(new CustomEvent('flight:ready'));
    }
    window.dispatchEvent(new CustomEvent('flight:t', { detail: t }));
  }

  private firstFrameDone = false;

  private loop = (): void => {
    if (this.disposed) return;
    this.renderFrame();
    this.rafId = requestAnimationFrame(this.loop);
  };

  private resize = (): void => {
    const dpr =
      Math.min(window.devicePixelRatio, this.quality.maxDpr) * this.quality.renderScale;
    const { clientWidth, clientHeight } = this.canvas;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(clientWidth, clientHeight, false);
    this.composer.setSize(clientWidth, clientHeight);
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
    cancelAnimationFrame(this.rafId);
    window.removeEventListener('resize', this.resize);
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.director?.dispose();
    this.raycast.dispose();
    this.tooltip.dispose();
    this.composer.dispose();
    this.plane.dispose();
    this.trail.dispose();
    this.airTrail.dispose();
    this.flock.dispose();
    this.launchString.dispose();
    this.sky.dispose();
    this.desk.dispose();
    this.panel.dispose();
    this.windowFrame.dispose();
    this.rooftops.dispose();
    this.clouds.dispose();
    this.envelopes.dispose();
    this.storm.dispose();
    this.biplane.dispose();
    this.birds.dispose();
    this.beacon.dispose();
    this.wingPlanes.dispose();
    this.traffic.dispose();
    this.city.dispose();
    this.copilot.dispose();
    this.landing.dispose();
    this.burst.dispose();
    this.confetti.dispose();
    this.renderer.dispose();
  }
}
