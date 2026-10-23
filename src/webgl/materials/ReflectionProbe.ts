import {
  CubeCamera,
  HalfFloatType,
  LinearFilter,
  WebGLCubeRenderTarget,
  type MeshStandardMaterial,
  type Object3D,
  type PerspectiveCamera,
  type Scene,
  type Texture,
  type Vector3,
  type WebGLRenderer,
} from 'three';

/**
 * A live reflection of the real surroundings, for the surfaces that are mirrors: car paint, chrome
 * and windscreens, and the close-up buildings' window glass. A cube camera stands near the viewer
 * (at about the height of a car roof, so the street is what a car's flank sees) and renders the
 * actual scene, the houses, trees, lamps, other cars and the graded sky, into a cube map, which
 * three prefilters for roughness (PMREM) the moment it is flagged. A static HDRI cannot show the
 * house across the street in a car door, or the neon of the canyon in a tower's glass; this can.
 *
 * Cost is spread out: one face of the cube is rendered per frame (at 256 px, without redrawing the
 * shadow maps), so the whole environment refreshes every six frames, and only in the chapters
 * that have something to reflect it. HIGH tier only; the Engine owns the one instance.
 */
export class ReflectionProbe {
  /** the live probe, or null (LOW tier, or before the Engine has made it) */
  static current: ReflectionProbe | null = null;
  private static waiting = new Map<MeshStandardMaterial, number>();

  /**
   * Hands a material the live environment (now, or as soon as the probe exists), at `intensity`.
   * The probe holds rendered radiance, so 1 is physically right; the materials that keep their
   * own static environment on phones simply never receive it.
   */
  static adopt(material: MeshStandardMaterial, intensity = 1): void {
    const probe = ReflectionProbe.current;
    if (probe) probe.apply(material, intensity);
    else ReflectionProbe.waiting.set(material, intensity);
  }

  static release(material: MeshStandardMaterial): void {
    ReflectionProbe.waiting.delete(material);
    ReflectionProbe.current?.materials.delete(material);
  }

  readonly target: WebGLCubeRenderTarget;
  private cube: CubeCamera;
  private faces: PerspectiveCamera[];
  private face = 0;
  private materials = new Map<MeshStandardMaterial, number>();

  constructor(size = 256) {
    this.target = new WebGLCubeRenderTarget(size, {
      type: HalfFloatType, generateMipmaps: false, minFilter: LinearFilter, magFilter: LinearFilter,
    });
    this.cube = new CubeCamera(0.05, 400, this.target);
    this.faces = this.cube.children as PerspectiveCamera[];
    ReflectionProbe.current = this;
    for (const [material, intensity] of ReflectionProbe.waiting) this.apply(material, intensity);
    ReflectionProbe.waiting.clear();
  }

  get texture(): Texture {
    return this.target.texture;
  }

  private apply(material: MeshStandardMaterial, intensity: number): void {
    this.materials.set(material, intensity);
    material.envMap = this.target.texture;
    material.envMapIntensity = intensity;
    material.needsUpdate = true;
  }

  /**
   * Renders the next face of the cube from `eye`, held at most `lift` above `ground` (null: the
   * chapter has nothing that reflects, skip). `hide` are objects to leave out of the reflection:
   * the paper plane and its trails hang right in front of the probe.
   */
  update(renderer: WebGLRenderer, scene: Scene, eye: Vector3, ground: number | null, hide: Object3D[], lift = 1.4): void {
    if (ground === null) return;
    this.cube.position.set(eye.x, Math.min(eye.y, ground + lift), eye.z);
    this.cube.updateMatrixWorld(true);
    const shown = hide.map((o) => o.visible);
    for (const o of hide) o.visible = false;
    const autoShadows = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    const previous = renderer.getRenderTarget();
    const previousFace = renderer.getActiveCubeFace();
    const previousLevel = renderer.getActiveMipmapLevel();
    renderer.setRenderTarget(this.target, this.face);
    renderer.render(scene, this.faces[this.face]!);
    renderer.setRenderTarget(previous, previousFace, previousLevel);
    renderer.shadowMap.autoUpdate = autoShadows;
    hide.forEach((o, i) => { o.visible = shown[i]!; });
    // a whole cube since the last flag: three re-filters it for every roughness on next use
    if (++this.face === 6) {
      this.face = 0;
      this.target.texture.needsPMREMUpdate = true;
    }
  }

  dispose(): void {
    if (ReflectionProbe.current === this) ReflectionProbe.current = null;
    this.target.dispose();
  }
}
