import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  Camera,
  Color,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Group,
  Material,
  MathUtils,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Object3D,
  PlaneGeometry,
  Points,
  PointsMaterial,
  RepeatWrapping,
  RingGeometry,
  ShaderMaterial,
  type PerspectiveCamera,
  type Scene,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  type Texture,
  TextureLoader,
  Vector2,
  Vector3,
  type WebGLRenderer,
} from 'three';
import type { Quality } from '../quality';
import type { SkyDome } from '../materials/SkyDome';
import { PlanarReflection, REFLECTED_LAYER } from '../materials/PlanarReflection';
import { asset } from '../asset';
import { fogHeight } from '../fog';
import type { Raycast } from '../interact/Raycast';
import type { Tooltip } from '../interact/Tooltip';
import { glowTexture } from '../bake/CanvasTextures';
import { requestCompile } from '../warm';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import beamVert from '../shaders/beam.vert.glsl';
import beamFrag from '../shaders/beam.frag.glsl';
import oceanVert from '../shaders/ocean.vert.glsl';
import oceanFrag from '../shaders/ocean.frag.glsl';
import { Rain, type RainLight } from './Rain';
import { ReflectionProbe } from '../materials/ReflectionProbe';

/**
 * CH6: the lighthouse in weather. A banded lighthouse on a rock islet in a
 * living night sea — Gerstner-style swells, foam surging against the rocks,
 * splash bursts on the beat, local rain — with the sweeping beam and radar
 * rings carrying the deliverability story through the storm.
 */
/**
 * The lighthouse and its islet are built at unit scale and then scaled as one
 * — the camera crosses this chapter at y≈20 and the old 12-unit tower ended
 * up BELOW the lens, which reads as a model on a table. At 1.75× the lantern
 * sits well above the flight line, so the shot looks UP at the light.
 * Anything anchored to the lantern (beam pivot, flare, tooltip) multiplies by
 * this, so keep those in sync when changing it.
 */
const TOWER_SCALE = 1.55;

/**
 * Where the freighter steams during the beacon chapter, in island-local
 * space. It is staged FAR and LARGE rather than near and cropped: the camera
 * flies 13 units above the water, so a close hull sits under the frame edge
 * (the old one left the shot entirely by t≈0.505). At this range it holds the
 * lower-right third through the whole sweep, and it is heading for the light —
 * a vessel being guided in, which is the chapter's whole point.
 */
/**
 * Riding height. The hull is 5 units deep at this scale, and at the old 0.5
 * it sat roughly 40% under — the ship read as half-sunk rather than loaded.
 */
// Rides higher than it used to. The swells in ocean.vert are 1.6x taller now
// and peak around 2 units above the plane at y=0.15, which at the old 2.15 put
// crests through the boot topping — the exact "half underwater" look this
// number was raised to fix in the first place.
const SHIP_Y = 2.85;
/**
 * The leg stays well out to seaward: the freighter is ~38 units long now, so
 * a track any closer swung its bow in over the islet's rocks.
 */
/** extra scroll the sea holds before it starts letting go — see `reveal` */
const SEA_FADE_DELAY = 0.012;
/** seconds for the lamp to come full circle */
const BEAM_PERIOD = 7;

/** the freighter's size and track, in the island's frame (see buildShip): it crosses ahead of the camera, left to right */
const SHIP_SCALE = 2.8;
const SHIP_FROM = new Vector3(34, SHIP_Y, -30);
const SHIP_TO = new Vector3(28, SHIP_Y, 34);

export class Beacon {
  readonly group = new Group();
  /** the island: tower, rocks, cottage — scaled as one by TOWER_SCALE */
  private tower = new Group();
  private beam: Mesh;
  private beamPivot = new Group();
  private beamMaterial: ShaderMaterial;
  private oceanMaterial: ShaderMaterial;
  private sea: Mesh;
  /** the picture of the lighthouse, the ship and the sky the water shows (HIGH tier only) */
  private reflection: PlanarReflection | null = null;
  private rain: Rain;
  private rainLight: RainLight = {
    lamp: new Vector3(), lampColor: new Color('#d6f7ef'), beamDir: new Vector3(1, 0, 0),
    beamColor: new Color('#bff6ee'), beamPower: 0,
  };
  private rainSky = new Color();
  private splash: Points;
  private splashGeometry = new BufferGeometry();
  private splashMaterial: PointsMaterial;
  private splashBase: { x: number; z: number; phase: number; h: number }[] = [];
  private rings: Mesh[] = [];
  private ringMaterials: MeshStandardMaterial[] = [];
  private hovered = false;
  private towerTop = new Vector3();
  private flareMaterial: SpriteMaterial;
  private flare!: Sprite;
  private ship = new Group();
  private wake!: Mesh;
  private radar: Mesh | null = null;
  /** the lamp's bearing: the wall clock, one turn every BEAM_PERIOD seconds */
  private beamYaw = 0;
  /**
   * The arrival, in order: the sea comes up under the storm first, then the lamp glows out of the
   * murk, then the tower and its islet come out of the mist. `uVeil` 1 is a tower still lost in it
   * (dissolved away), 0 is clear; `uVeilColor` is the mist it is lost in (the fog colour).
   */
  private veil = { uVeil: { value: 1 }, uVeilColor: { value: new Color('#0a1a21') } };
  /** the live sky's horizon colour (bindSky): the mist the tower stands in is lit like the sky behind it */
  private skyHorizon: Color | null = null;
  /** the sweep as a light: the freighter's materials take it (see beamLit) */
  private beamLight = {
    uLamp: { value: new Vector3() }, uBeamDir: { value: new Vector3(1, 0, 0) },
    uBeamColor: { value: new Color('#c8fff4') }, uBeamPower: { value: 0 },
  };
  private disposables: { dispose(): void }[] = [];

  constructor(anchor: Vector3, raycast: Raycast, private tooltip: Tooltip, quality: Quality) {
    const baseY = anchor.y - 13;
    this.group.position.set(anchor.x + 8, baseY, anchor.z - 2.5);
    this.towerTop.copy(this.group.position).add(new Vector3(0, 12.4 * TOWER_SCALE, 0));
    this.tower.scale.setScalar(TOWER_SCALE);
    this.group.add(this.tower);

    // — the tower, its islet and the keeper's cottage: modelled in Blender
    // (blender/make_lighthouse.py) in the old tower's units, so the lantern is still
    // at y = 12.2 and every anchor below (beam pivot, flare, tooltip) still holds.
    // It arrives a moment after construction; the beacon chapter is a long way off.
    void this.loadLighthouse();

    // — the sea — oversized so the camera never looks past its far edge
    // into black void on the way out of the chapter. Scaled up with the
    // island: the freighter now stands well out to sea, and the water has to
    // read as open ocean behind it rather than a pond with a far edge.
    /**
     * 256, not 128. The mesh is 640 units across, so 128 segments meant 5-unit
     * quads against a shortest swell wavelength of 12 units — 2.4 samples per
     * wave, which is marginal. 2.5-unit quads take it to ~4.8. Costs 65k
     * triangles.
     *
     * Kept for its own sake, NOT as the fix for the fish-scale lattice this
     * was raised chasing: that turned out to be the rain shader shearing its
     * drop field by height (see rain.vert), and it survived this change
     * untouched.
     */
    const seg = quality.tier === 'high' ? 256 : 120;
    const seaGeometry = new PlaneGeometry(640, 420, seg, Math.floor(seg / 2));
    // Wave detail and foam come from two tileable maps generated by
    // blender/make_ocean.py, so they are mipmapped and filtered like any texture
    // instead of being sines of world position that alias into speckle.
    const maps = new TextureLoader();
    const mapOf = (file: string): ReturnType<TextureLoader['load']> => {
      const t = maps.load(asset(`/models/ocean/${file}`));
      t.wrapS = t.wrapT = RepeatWrapping;
      t.anisotropy = 8;
      return t;
    };
    const normalMap = mapOf('ocean-normal.webp');
    const foamMap = mapOf('ocean-foam.webp');
    this.disposables.push(normalMap, foamMap);
    if (quality.tier === 'high') {
      this.reflection = new PlanarReflection(REFLECTED_LAYER, 0.5);
      this.disposables.push(this.reflection);
    }
    this.oceanMaterial = new ShaderMaterial({
      vertexShader: oceanVert,
      fragmentShader: oceanFrag,
      uniforms: {
        uTime: { value: 0 },
        uNormalMap: { value: normalMap },
        uFoamMap: { value: foamMap },
        uDeep: { value: new Color('#031017') },
        uShallow: { value: new Color('#0b3a46') },
        uFoam: { value: new Color('#cfe6e2') },
        // the sky it reflects: bound to the live sky colours by bindSky()
        uZenith: { value: new Color('#060b12') },
        uHorizon: { value: new Color('#0e2530') },
        uMoonDir: { value: new Vector3(-0.2, 0.7, 0.4) },
        uMoonColor: { value: new Color('#9fe8da') },
        uFlash: { value: 0 },
        uLantern: { value: new Vector3() },
        uBeamDir: { value: new Vector2(1, 0) },
        uBeamColor: { value: new Color('#7fe8d8') },
        uBeamPower: { value: 0 },
        uTowerXZ: { value: new Vector2(this.group.position.x, this.group.position.z) },
        uFogColor: { value: new Color('#0a1d24') },
        uFogNear: { value: 20 },
        uFogFar: { value: 260 },
        uFogHeight: fogHeight,
        uCamPos: { value: new Vector3() },
        uReveal: { value: 0 },
        uReflection: { value: this.reflection?.texture ?? null },
        uReflMatrix: { value: this.reflection?.matrix ?? new Matrix4() },
        uReflect: { value: 0 },
        uPlaneY: { value: this.group.position.y + 0.15 },
        uRain: { value: 0 },
      },
      transparent: true,
    });
    this.sea = new Mesh(seaGeometry, this.oceanMaterial);
    this.sea.rotation.x = -Math.PI / 2;
    this.sea.position.y = 0.15;
    this.group.add(this.sea);
    this.disposables.push(seaGeometry, this.oceanMaterial);

    // — splash bursts where the surge meets the rocks —
    const SPLASHES = 70;
    const rand = (() => { let s = 4207; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
    const splashPos = new Float32Array(SPLASHES * 3);
    for (let i = 0; i < SPLASHES; i++) {
      const a = rand() * Math.PI * 2;
      // the surge ring follows the island's new footprint
      const r = (1.9 + rand() * 1.4) * TOWER_SCALE;
      this.splashBase.push({
        x: Math.cos(a) * r,
        z: Math.sin(a) * r,
        phase: rand(),
        h: (1.2 + rand() * 1.6) * TOWER_SCALE,
      });
      splashPos[i * 3] = this.splashBase[i]!.x;
      splashPos[i * 3 + 2] = this.splashBase[i]!.z;
    }
    const splashAttr = new Float32BufferAttribute(splashPos, 3);
    splashAttr.setUsage(DynamicDrawUsage);
    this.splashGeometry.setAttribute('position', splashAttr);
    this.splashMaterial = new PointsMaterial({
      map: glowTexture(),
      color: '#bfe6df',
      size: 0.34,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.splash = new Points(this.splashGeometry, this.splashMaterial);
    this.splash.frustumCulled = false;
    this.group.add(this.splash);
    this.disposables.push(this.splashGeometry, this.splashMaterial);

    // — the downpour: lit streaks around the camera, splash rings on the water (see Rain.ts) —
    this.rain = new Rain(
      Math.round(quality.rainCount * 3.5), quality.tier === 'high' ? 700 : 220, rand, this.group.position.y + 0.17,
    );
    this.group.add(this.rain.drops, this.rain.splashes);
    // the sea mirrors the falling rain as well (its planar reflection draws this layer)
    this.mirrored(this.rain.drops);
    this.disposables.push(this.rain);

    // — sweeping beam (unchanged core) —
    this.beamMaterial = new ShaderMaterial({
      vertexShader: beamVert,
      fragmentShader: beamFrag,
      uniforms: {
        uColor: { value: new Color('#7fe8d8') },
        uTime: { value: 0 },
        uIntensity: { value: 0.8 },
      },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
    });
    // The cone widens with the tower and reaches far enough to rake the
    // freighter standing off to seaward. It also tilts DOWN now: the lantern
    // sits ~8 units above the flight line at 1.75×, so a level beam would
    // sweep over the lens and the "light crosses the camera" beat would die.
    const beamGeometry = new CylinderGeometry(0.12 * TOWER_SCALE, 3.2 * TOWER_SCALE, 46, 24, 1, true);
    this.beam = new Mesh(beamGeometry, this.beamMaterial);
    this.beam.rotation.z = Math.PI / 2;
    this.beam.position.x = 23;
    this.beamPivot.position.y = 12.2 * TOWER_SCALE;
    this.beamPivot.rotation.z = -0.26;
    this.beamPivot.add(this.beam);
    this.group.add(this.beamPivot);
    this.mirrored(this.beamPivot);
    this.disposables.push(beamGeometry, this.beamMaterial);

    // — lantern flare: blooms only when the sweep points at the camera —
    this.flareMaterial = new SpriteMaterial({
      map: glowTexture(),
      color: '#bffbee',
      transparent: true,
      opacity: 0,
      blending: AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });
    this.flare = new Sprite(this.flareMaterial);
    this.flare.position.set(0, 12.2 * TOWER_SCALE, 0);
    this.flare.scale.setScalar(5 * TOWER_SCALE);
    this.group.add(this.flare);
    this.mirrored(this.flare);
    this.disposables.push(this.flareMaterial);

    this.buildShip();

    // — radar rings riding just above the swell —
    for (let i = 0; i < 3; i++) {
      const m = new MeshStandardMaterial({
        color: '#06211f',
        emissive: '#7fe8d8',
        emissiveIntensity: 1.2,
        transparent: true,
        opacity: 0,
        roughness: 0.5,
      });
      const ring = new Mesh(new RingGeometry(0.96, 1, 48), m);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 1.1 * TOWER_SCALE;
      this.group.add(ring);
      this.rings.push(ring);
      this.ringMaterials.push(m);
      this.disposables.push(ring.geometry, m);
    }

    raycast.register({
      object: this.group,
      onEnter: () => {
        this.hovered = true;
        this.tooltip.show('SPF ✓ DKIM ✓ DMARC ✓ · EXACT DNS VALUES HANDED TO YOU');
      },
      onLeave: () => {
        this.hovered = false;
        this.tooltip.hide();
      },
    });
  }

  /** One mesh per material, named for it: the material table lives in the model's manifest. */
  private async loadLighthouse(): Promise<void> {
    interface Spec {
      map?: string; color: string; roughness: number; metalness?: number;
      emissive?: string; emissiveIntensity?: number; vertexColors?: boolean;
    }
    const base = asset('/models/lighthouse');
    const manifest = (await fetch(`${base}/manifest.json`, { cache: 'no-cache' }).then((r) => r.json())) as {
      materials: Record<string, Spec>;
    };
    const loader = new TextureLoader();
    const maps = new Map<string, { color: Texture; normal: Texture }>();
    const mapSet = (name: string): { color: Texture; normal: Texture } => {
      let m = maps.get(name);
      if (!m) {
        const color = loader.load(`${base}/${name}-color.webp`);
        color.colorSpace = SRGBColorSpace;
        const normal = loader.load(`${base}/${name}-normal.webp`);
        for (const t of [color, normal]) {
          t.wrapS = t.wrapT = RepeatWrapping;
          t.anisotropy = 8;
        }
        m = { color, normal };
        maps.set(name, m);
        this.disposables.push(color, normal);
      }
      return m;
    };
    const materials = new Map<string, MeshStandardMaterial>();
    for (const [name, spec] of Object.entries(manifest.materials)) {
      const m = new MeshStandardMaterial({
        color: spec.color,
        roughness: spec.roughness,
        metalness: spec.metalness ?? 0,
        vertexColors: spec.vertexColors ?? false,
      });
      if (spec.map) {
        const set = mapSet(spec.map);
        m.map = set.color;
        m.normalMap = set.normal;
        m.normalScale.set(0.9, 0.9);
      }
      if (spec.emissive) {
        m.emissive = new Color(spec.emissive);
        m.emissiveIntensity = spec.emissiveIntensity ?? 1;
      } else if ((spec.metalness ?? 0) < 0.5) {
        // rain-soaked: stone, rock, slate and paint go darker and glossy, and mirror the live probe
        // (the lamp, the beam, the sea) where the screen-space trace cannot reach
        m.color.multiplyScalar(0.78);
        m.roughness = Math.max(0.14, spec.roughness * 0.42);
        ReflectionProbe.adopt(m, 0.9);
      }
      // the lantern's own glass and lens glow through the murk first; the keeper's lit windows
      // belong to the tower and come out of the mist with it
      this.veiled(m, name === 'glass_lantern' || name === 'lens');
      materials.set(name, m);
      this.disposables.push(m);
    }
    const gltf = await new GLTFLoader().loadAsync(`${base}/lighthouse.glb`);
    gltf.scene.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      const m = materials.get(mesh.name);
      if (m) mesh.material = m;
      this.disposables.push(mesh.geometry);
    });
    this.tower.add(gltf.scene);
    this.mirrored(gltf.scene);
  }

  /**
   * Lets a lighthouse material stand in the mist: shaded toward the mist's colour by `uVeil`, and,
   * when nearly lost, dissolved away with a fine per-pixel dither so the tower forms out of the
   * murk instead of popping in. The lamp's own glass and glow (`lamp`) are veiled half as much: a
   * light seen through fog before the tower under it.
   */
  private veiled(m: MeshStandardMaterial, lamp: boolean): void {
    const veil = this.veil;
    m.onBeforeCompile = (shader, renderer) => {
      // the shared fog hook (webgl/fog.ts) lives on the prototype; an own hook must call it
      Material.prototype.onBeforeCompile.call(m, shader, renderer);
      shader.uniforms.uVeil = veil.uVeil;
      shader.uniforms.uVeilColor = veil.uVeilColor;
      shader.fragmentShader = 'uniform float uVeil;\nuniform vec3 uVeilColor;\n' + shader.fragmentShader.replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
        float veil = uVeil * ${lamp ? '0.5' : '1.0'};
        if (veil > 0.0) {
          float n = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
          if (n < smoothstep(0.86, 1.0, veil)) discard;
          gl_FragColor.rgb = mix(gl_FragColor.rgb, uVeilColor, smoothstep(0.0, 0.85, veil));
        }`,
      );
    };
    m.customProgramCacheKey = () => (lamp ? 'veil-lamp' : 'veil');
  }

  /**
   * The lamp's sweep as a real light on the freighter: a narrow cone from the lantern along the
   * beam, with a faint halo round it, falling off with distance and shaded by the hull's own
   * normals. As the beam comes round, the ship stands out of the dark and sinks back into it.
   */
  private beamLit(m: MeshStandardMaterial): void {
    const u = this.beamLight;
    m.onBeforeCompile = (shader, renderer) => {
      Material.prototype.onBeforeCompile.call(m, shader, renderer);
      Object.assign(shader.uniforms, u);
      shader.vertexShader = 'varying vec3 vBeamWorld;\n' + shader.vertexShader.replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vBeamWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );
      shader.fragmentShader = `uniform vec3 uLamp;
uniform vec3 uBeamDir;
uniform vec3 uBeamColor;
uniform float uBeamPower;
varying vec3 vBeamWorld;
` + shader.fragmentShader.replace(
        '#include <opaque_fragment>',
        `if (uBeamPower > 0.0) {
          vec3 toP = vBeamWorld - uLamp;
          float d = length(toP);
          vec3 Ld = toP / max(d, 1e-3);
          float c = dot(Ld, uBeamDir);
          // the cone (about 6 degrees, soft-edged) and the halo the wet air makes round it
          float cone = smoothstep(0.9848, 0.9972, c) + 0.1 * smoothstep(0.93, 0.99, c);
          vec3 L = normalize((viewMatrix * vec4(-Ld, 0.0)).xyz);
          float ndl = max(dot(normal, L), 0.0) * 0.75 + 0.25;
          outgoingLight += diffuseColor.rgb * uBeamColor * (uBeamPower * cone * ndl * 7.0 / (1.0 + 0.0005 * d * d));
        }
        #include <opaque_fragment>`,
      );
    };
    m.customProgramCacheKey = () => 'beam-lit';
  }

  /** puts an object (and everything under it) in the picture the sea reflects */
  private mirrored(root: Object3D): void {
    if (this.reflection) root.traverse((o) => o.layers.enable(REFLECTED_LAYER));
  }

  /**
   * Draws what the sea reflects, as seen from under it. The engine calls this once a frame, just
   * before the main render, while the group is on screen.
   */
  renderReflection(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera): void {
    const on = !!this.reflection && this.group.visible && this.sea.visible;
    this.oceanMaterial.uniforms.uReflect!.value = on ? 1 : 0;
    if (!on) return;
    if (!renderer.autoClear) renderer.clear();
    this.reflection!.render(renderer, scene, camera, this.group.position.y + 0.15);
  }

  /**
   * The container freighter riding the swell off the islet, modelled in Blender
   * (blender/make_ship.py, ~7k triangles): a lofted hull with a flared bow and bulb, a steel deck
   * with hatch covers, stacks of corrugated containers in line colours, a five-deck
   * accommodation block with a wide bridge, funnel, radar mast, lifeboats, vents, handrails and
   * lit windows. It streams in after construction; the radar turns, the running lights glow and
   * a foam wake trails it.
   */
  private buildShip(): void {
    const mat = (extra: ConstructorParameters<typeof MeshStandardMaterial>[0]): MeshStandardMaterial => {
      const m = new MeshStandardMaterial({ vertexColors: true, ...extra });
      this.beamLit(m);
      this.disposables.push(m);
      return m;
    };
    const normal = new TextureLoader().load(asset('/models/ship/container-normal.webp'));
    normal.wrapS = normal.wrapT = RepeatWrapping;
    normal.flipY = false;
    normal.anisotropy = 4;
    this.disposables.push(normal);
    const materials: Record<string, Material> = {
      hull: mat({ roughness: 0.55, metalness: 0.3 }),
      deck: mat({ roughness: 0.85, metalness: 0.1 }),
      containers: mat({ roughness: 0.62, metalness: 0.2, normalMap: normal, normalScale: new Vector2(1, 1) }),
      upper: mat({ roughness: 0.55, metalness: 0.15 }),
      lit: (() => {
        const m = new MeshBasicMaterial({ vertexColors: true, toneMapped: false });
        this.disposables.push(m);
        return m;
      })(),
    };
    const glow = glowTexture();
    this.disposables.push(glow);
    const lampAt = (p: Vector3, color: string, size: number): void => {
      const g = new BufferGeometry();
      g.setAttribute('position', new Float32BufferAttribute([p.x, p.y, p.z], 3));
      const m = new PointsMaterial({
        map: glow, color, size, transparent: true, opacity: 0.95, depthWrite: false,
        blending: AdditiveBlending, sizeAttenuation: true,
      });
      const point = new Points(g, m);
      point.frustumCulled = false;
      this.ship.add(point);
      this.mirrored(point);
      this.disposables.push(g, m);
    };

    new GLTFLoader().load(asset('/models/ship/ship.glb'), (gltf) => {
      const root = gltf.scene;
      const marks: Record<string, Vector3> = {};
      root.traverse((o) => {
        const mesh = o as Mesh;
        if (mesh.isMesh) {
          mesh.material = materials[o.name] ?? materials.upper!;
          this.disposables.push(mesh.geometry);
        } else if (o.name.startsWith('nav_') || o.name === 'radar') {
          marks[o.name] = o.position.clone();
        }
      });
      // the nodes that only marked a place are no longer needed
      for (const name of Object.keys(marks)) root.getObjectByName(name)?.removeFromParent();
      this.ship.add(root);
      this.mirrored(root);
      lampAt(marks.nav_red!, '#ff5a5a', 0.55);
      lampAt(marks.nav_green!, '#6dff9a', 0.55);
      lampAt(marks.nav_mast!, '#eafcff', 0.6);
      lampAt(marks.nav_bow!, '#eafcff', 0.5);
      lampAt(marks.nav_stern!, '#eafcff', 0.4);
      // deck floodlights over the stacks, so the cargo reads in the dark
      for (const [x, z] of [[-1.6, 0], [0.4, 0], [2.4, 0]] as const) lampAt(new Vector3(x, 2.15, z), '#ffe7b8', 0.7);
      // the radar: a bar that turns on the mast
      const radar = new Mesh(new BoxGeometry(0.34, 0.03, 0.05), materials.upper!);
      radar.position.copy(marks.radar!);
      radar.position.y += 0.02;
      this.disposables.push(radar.geometry);
      this.ship.add(radar);
      this.mirrored(radar);
      this.radar = radar;
      requestCompile(root);
    });

    // Staged out in the sea ahead of the camera, crossing the shot from the left, bow toward the
    // light: close enough to read, far enough to sit beside the tower rather than block it. The
    // heading is baked from the SHIP_FROM→SHIP_TO leg so the bow always points where it is going.
    this.ship.position.copy(SHIP_FROM);
    const leg = SHIP_TO.clone().sub(SHIP_FROM);
    this.ship.rotation.y = Math.atan2(-leg.z, leg.x); // model's bow is +x
    this.ship.scale.setScalar(SHIP_SCALE);

    // wake: a long foam wedge lying flat on the water behind the hull, kept
    // in the island's frame (not the ship's) so the swell roll never tips it
    const wakeMaterial = new MeshStandardMaterial({
      color: '#0b2b30',
      emissive: '#9fd6cf',
      emissiveIntensity: 0.9,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      side: DoubleSide,
      map: glowTexture(),
    });
    const wakeGeometry = new PlaneGeometry(SHIP_SCALE * 12, SHIP_SCALE * 1.6);
    this.wake = new Mesh(wakeGeometry, wakeMaterial);
    this.wake.rotation.x = -Math.PI / 2;
    this.wake.renderOrder = 1;
    this.group.add(this.wake);
    this.disposables.push(wakeGeometry, wakeMaterial);
    this.group.add(this.ship);
  }

  /** Makes the sea reflect the sky the chapter is wearing, colour for colour. */
  /** world position of the lamp: where the dart is delivered */
  get lantern(): Vector3 {
    return this.towerTop;
  }

  bindSky(sky: SkyDome): void {
    this.skyHorizon = sky.horizon;
    const u = this.oceanMaterial.uniforms;
    u.uZenith!.value = sky.zenith;
    u.uHorizon!.value = sky.horizon;
  }

  update(
    time: number, camera: Camera, t: number, planePos: Vector3, flash = 0, fogColor?: Color, delivery = 0,
  ): number {
    if (!this.group.visible) return 0;
    // The lamp turns on the wall clock, once round every BEAM_PERIOD seconds, whether or not the
    // page is moving: no scroll keyframes, no beat staged for the lens. The beam crosses the plane
    // and the camera as often as the lamp comes round to them.
    this.beamYaw = (time / BEAM_PERIOD) * Math.PI * 2;
    this.beamPivot.rotation.y = this.beamYaw;
    this.beamMaterial.uniforms.uTime!.value = time;
    // the lamp comes on out of the murk once the sea is in (and stands down entering CH7 —
    // inside-the-cone frames wash teal); the tower forms out of the mist after it
    const lampOn = MathUtils.smoothstep(t, 0.44, 0.47);
    this.veil.uVeil.value = 1 - MathUtils.smoothstep(t, 0.448, 0.495);
    // the mist is the fog lit by the sky behind it, a shade lighter than the fog itself, so a
    // half-veiled tower is a pale shape in the murk rather than a dark cut-out against the horizon
    if (fogColor) {
      const mist = this.veil.uVeilColor.value.copy(fogColor);
      if (this.skyHorizon) mist.lerp(this.skyHorizon, 0.7);
      mist.multiplyScalar(1.15);
    }
    this.beamMaterial.uniforms.uIntensity!.value =
      0.8 * lampOn * (1 - MathUtils.smoothstep(t, 0.575, 0.61));
    this.oceanMaterial.uniforms.uTime!.value = time;
    (this.oceanMaterial.uniforms.uCamPos!.value as Vector3).copy(camera.position);
    // lightning lights the sea, the lamp's sweep rakes across it
    const ou = this.oceanMaterial.uniforms;
    ou.uFlash!.value = flash;
    if (fogColor) (ou.uFogColor!.value as Color).copy(fogColor);
    (ou.uLantern!.value as Vector3).copy(this.towerTop);
    (ou.uBeamDir!.value as Vector2).set(Math.cos(this.beamYaw), -Math.sin(this.beamYaw));
    ou.uBeamPower!.value = this.beamMaterial.uniforms.uIntensity!.value / 0.8;

    // weather intensity follows the chapter window
    const beaconness =
      MathUtils.smoothstep(t, 0.45, 0.5) * (1 - MathUtils.smoothstep(t, 0.57, 0.605));
    this.oceanMaterial.uniforms.uRain!.value = beaconness;
    // the beam's world direction: the pivot turns about y and tips the beam down by its z tilt
    const tilt = this.beamPivot.rotation.z;
    this.rainLight.beamDir.set(Math.cos(this.beamYaw) * Math.cos(tilt), Math.sin(tilt), -Math.sin(this.beamYaw) * Math.cos(tilt));
    this.rainLight.beamPower = this.beamMaterial.uniforms.uIntensity!.value / 0.8;
    this.beamLight.uLamp.value.copy(this.towerTop);
    this.beamLight.uBeamDir.value.copy(this.rainLight.beamDir);
    this.beamLight.uBeamPower.value = this.rainLight.beamPower;
    this.rainLight.lamp.copy(this.towerTop);
    this.rainSky.set(fogColor ?? '#0a1a21').multiplyScalar(2.2).addScalar(0.02);
    this.rain.update(time, camera, beaconness, this.rainLight, this.rainSky,
      innerHeight * Math.min(devicePixelRatio, 2));
    // The sea is gone before the no-fly map develops — overlapping them put
    // red exclusion circles on the water, and the sea plane is wide enough to
    // reach right over the CH7 map.
    //
    // SEA_FADE_DELAY holds the water at full strength for another ~90px of
    // scroll (about half a second at an unhurried pace on this 7.5k-pixel
    // story) and then fades quicker, so only the START moves. The END stays
    // pinned at 0.605 on purpose: red arrives at 0.59 and has to be gone
    // before the city at 0.65, so pushing the whole window would ripple
    // straight through two downstream chapters.
    // the water arrives first, under the storm's let-down, so the islet never hangs over nothing
    const reveal =
      MathUtils.smoothstep(t, 0.405, 0.445) *
      (1 - MathUtils.smoothstep(t, 0.575 + SEA_FADE_DELAY, 0.6));
    this.oceanMaterial.uniforms.uReveal!.value = reveal;
    // until it is fully in, the water must not write depth: the screen-space passes would take a
    // near-invisible plane for solid ground and trace blocky reflections and occlusion on it
    this.oceanMaterial.depthWrite = reveal > 0.97;
    // a fullscreen transparent plane at alpha≈0 still pays full fragment cost
    this.sea.visible = reveal > 0.003;
    // the freighter's additive nav/porthole points outlive the dark hull —
    // a lone red dot hung in the no-fly sky until the group cut at 0.615
    this.ship.visible = reveal > 0.05;

    // — beam hits: the sweep catching the plane, then the lens —
    const beamX = Math.cos(this.beamYaw);
    const beamZ = -Math.sin(this.beamYaw);
    const lampGlow = this.beamMaterial.uniforms.uIntensity!.value / 0.8;
    let dx = planePos.x - this.towerTop.x;
    let dz = planePos.z - this.towerTop.z;
    let len = Math.hypot(dx, dz) || 1;
    const planeHit = Math.pow(Math.max((beamX * dx + beamZ * dz) / len, 0), 40) * lampGlow;
    dx = camera.position.x - this.towerTop.x;
    dz = camera.position.z - this.towerTop.z;
    len = Math.hypot(dx, dz) || 1;
    const camHit = Math.pow(Math.max((beamX * dx + beamZ * dz) / len, 0), 30) * lampGlow;
    // the delivery: the lamp flares white as the dart goes in, whichever way the beam is turned
    this.flareMaterial.opacity = Math.max(camHit * 0.95, delivery * 0.32) * lampOn;
    this.flare.scale.setScalar(5 * TOWER_SCALE * (1 + delivery * 0.45));

    // — the freighter stands in toward the light —
    // The passage is STORY-T driven, not wall-clock: the ship has to cross
    // the same part of the frame on every scroll-through, or the shot is
    // whatever the page happened to be doing when you got there. Wall-clock
    // is left to the swell it rides on.
    const passage = MathUtils.smoothstep(t, 0.43, 0.6);
    this.ship.position.lerpVectors(SHIP_FROM, SHIP_TO, passage);
    // Works this sea harder than the last one — two beat frequencies so the
    // hull never settles into an obvious loop, and real pitch and roll. The
    // bob stays modest relative to the swell (±0.34 against ~2 units of wave)
    // because the failure mode here has always been the trough dipping the
    // boot topping under; it is the ROTATION that sells the weather.
    this.ship.position.y =
      SHIP_Y + Math.sin(time * 0.7) * 0.22 + Math.sin(time * 1.13 + 0.7) * 0.12;
    this.ship.rotation.z = Math.sin(time * 0.7 + 1.3) * 0.115 + Math.sin(time * 1.31) * 0.04;
    this.ship.rotation.x = Math.sin(time * 0.55) * 0.075;

    if (this.radar) this.radar.rotation.y = time * 2.4;

    // the wake lies flat astern, along the heading, fading with the sea
    this.wake.visible = this.ship.visible;
    if (this.wake.visible) {
      this.wake.position.set(
        this.ship.position.x - Math.cos(this.ship.rotation.y) * (SHIP_SCALE * 4.65 + 1),
        0.32,
        this.ship.position.z + Math.sin(this.ship.rotation.y) * (SHIP_SCALE * 4.65 + 1),
      );
      // a plane pitched flat by rotation.x maps its long axis to
      // (cos z, 0, −sin z), so this matches the hull's heading exactly
      this.wake.rotation.z = this.ship.rotation.y;
      (this.wake.material as MeshStandardMaterial).opacity = reveal * 0.3;
    }

    // splash bursts: parabolic arcs synced to the surge beat
    const attr = this.splashGeometry.attributes.position!;
    const arr = attr.array as Float32Array;
    for (let i = 0; i < this.splashBase.length; i++) {
      const s = this.splashBase[i]!;
      const u = (time * 0.55 + s.phase) % 1;
      const drift = 1 + u * 0.5;
      arr[i * 3] = s.x * drift;
      arr[i * 3 + 1] = 0.3 + 4 * u * (1 - u) * s.h;
      arr[i * 3 + 2] = s.z * drift;
    }
    attr.needsUpdate = true;
    this.splashMaterial.opacity = 0.5 + Math.sin(time * 1.15) * 0.3; // breathes with the surge

    // rings retire with the sea — pulsing at full strength until the group
    // cut, one read as a stray white circle in the no-fly sky mid-bend
    // (and arrive with the lamp: the group now opens in the storm, before the lighthouse is out)
    const ringFade = (1 - MathUtils.smoothstep(t, 0.575, 0.6)) * lampOn;
    // the rings open around the PLANE, not around the island — it flies
    // through their centre instead of across a set of circles beside it
    const ringX = planePos.x - this.group.position.x;
    const ringZ = planePos.z - this.group.position.z;
    for (let i = 0; i < this.rings.length; i++) {
      const phase = ((time * 0.35 + i / 3) % 1 + 1) % 1;
      const radius = 1 + phase * 16;
      this.rings[i]!.position.x = ringX;
      this.rings[i]!.position.z = ringZ;
      this.rings[i]!.scale.setScalar(radius);
      this.ringMaterials[i]!.opacity =
        MathUtils.smoothstep(phase, 0, 0.12) * (1 - phase) * 0.8 * ringFade;
    }

    if (this.hovered) this.tooltip.pin(this.towerTop, camera, 30);
    return planeHit;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
