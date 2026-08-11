import {
  BackSide,
  Box3,
  Color,
  InstancedBufferAttribute,
  InstancedMesh,
  MathUtils,
  Matrix4,
  Mesh,
  BoxGeometry,
  OrthographicCamera,
  PlaneGeometry,
  Quaternion,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  type WebGLRenderer,
} from 'three';
import type { Quality } from '../quality';
import { mulberry32 } from '../util';
import spriteVert from '../shaders/cloudSprite.vert.glsl';
import spriteFrag from '../shaders/cloudSprite.frag.glsl';
import atlasVert from '../shaders/cloudAtlas.vert.glsl';
import atlasFrag from '../shaders/cloudAtlas.frag.glsl';
import volumeVert from '../shaders/cloudVolume.vert.glsl';
import volumeFrag from '../shaders/cloudVolume.frag.glsl';

/**
 * One-time GPU bake: 8 sprite density variants (the domain-warped fbm) into
 * a 4×2 atlas. Costs a few ms at boot; saves ~6 simplex calls per fragment
 * on the single most overdraw-heavy element in the scene, with no visual
 * change (the live shader keeps rotation, lighting, rim, and fog).
 */
function bakeDensityAtlas(renderer: WebGLRenderer): WebGLRenderTarget {
  // 512 px per variant, not 256: once the deck straddles the flight line a
  // single puff can fill most of the frame, and at the old tile size that
  // magnified the fbm into blurry marble instead of cloud
  const rt = new WebGLRenderTarget(2048, 1024, { depthBuffer: false });
  const scene = new Scene();
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const material = new ShaderMaterial({
    vertexShader: atlasVert,
    fragmentShader: atlasFrag,
    uniforms: { uSeed: { value: 0 } },
    depthTest: false,
    depthWrite: false,
  });
  const quad = new Mesh(new PlaneGeometry(2, 2), material);
  scene.add(quad);

  const prevAutoClear = renderer.autoClear;
  renderer.setRenderTarget(rt);
  renderer.clear();
  renderer.autoClear = false;
  for (let v = 0; v < 8; v++) {
    material.uniforms.uSeed!.value = v * 0.137 + 0.05;
    renderer.setViewport((v % 4) * 512, Math.floor(v / 4) * 512, 512, 512);
    renderer.render(scene, camera);
  }
  renderer.autoClear = prevAutoClear;
  renderer.setRenderTarget(null);
  // Engine.resize() runs right after construction and restores the viewport
  quad.geometry.dispose();
  material.dispose();
  return rt;
}

/**
 * The cloud sea. Three layers:
 *  - `sprites`: the golden formation deck (CH3–5), every tier
 *  - `night`: the overnight deck (CH7–8) — a ceiling over the city
 *  - `volume`: raymarched slab straddling the formation line, HIGH tier's hero
 * All are lit from the chapter grade (sun/shadow/fog uniforms updated per
 * frame by the engine), so the same material reads gold at dawn and dim blue
 * over the night city without a second shader.
 */
export class Clouds {
  readonly sprites: InstancedMesh;
  readonly night: InstancedMesh;
  readonly volume: Mesh | null = null;

  private spriteMaterial: ShaderMaterial;
  private nightMaterial: ShaderMaterial;
  private shared: Record<string, { value: unknown }>;
  private volumeMaterial: ShaderMaterial | null = null;
  private geometries: PlaneGeometry[] = [];
  private volumeGeometry: BoxGeometry | null = null;

  readonly sunColor = new Color('#ffd9a0');
  readonly shadowColor = new Color('#b8c7e0');
  readonly fogColor = new Color('#b8c7e0');
  readonly sunDir = new Vector3(0.6, 0.25, 0.1);

  /**
   * The overnight deck's own light. The grade hands the city chapter an amber
   * "sun" (#ffc96b — the glow off the streets), and taking it straight turned
   * the deck into brown smoke. These pull most of the way to moonlight and
   * keep a little of the city underneath.
   */
  private nightSun = new Color();
  private nightShadow = new Color();
  private moon = new Color('#8ea6cc');
  private deepNight = new Color('#141a2c');

  private atlas: WebGLRenderTarget;

  constructor(center: Vector3, quality: Quality, rand: () => number, renderer: WebGLRenderer) {
    this.atlas = bakeDensityAtlas(renderer);
    // shared uniform OBJECTS: the night deck's material spreads these same
    // references, so one grade/fog write per frame lands on both decks. Only
    // uOpacity is per-material.
    this.shared = {
      uTime: { value: 0 },
      uAtlas: { value: this.atlas.texture },
      uSunColor: { value: this.sunColor },
      uShadowColor: { value: this.shadowColor },
      uSunScreenDir: { value: new Vector2(0.7, 0.3) },
      uFogColor: { value: this.fogColor },
      uFogNear: { value: 30 },
      uFogFar: { value: 220 },
    };
    this.spriteMaterial = new ShaderMaterial({
      vertexShader: spriteVert,
      fragmentShader: spriteFrag,
      // per-sprite alpha is LOW on purpose: density is meant to come from
      // many overlapping puffs, not from each one being nearly solid
      uniforms: { ...this.shared, uOpacity: { value: 0.42 } },
      transparent: true,
      depthWrite: false,
    });

    this.sprites = this.field(quality.cloudSprites, rand, (p, r) => {
      const spread = 108;
      // the deck now STRADDLES the flight line — the climb out of the city
      // ends inside weather, so puffs pass the lens instead of scrolling by
      // underneath. Biased low (pow > 1) so most of the mass is still below
      // and there is open sky overhead to climb toward.
      p.set(
        center.x - spread * 0.56 + r() * spread,
        center.y - 12 + Math.pow(r(), 1.4) * 15.5,
        center.z - 50 + r() * 100,
      );
      // smaller puffs than before: the deck is twice as populous now, and
      // 19-unit sprites at deck altitude read as marbled slabs rather than
      // cloud. More, smaller elements carry the same mass with real detail.
      return 4 + r() * 8.5;
    });

    /**
     * The overnight deck — CH7 into CH8.
     *
     * World-space, not anchor-relative, because it has to span two chapters —
     * and it is two BANDS at different heights, because the flight crosses
     * them going opposite ways:
     *
     *  - floor, x 136–184 at y 6–11: the camera comes down y 22→14 over this
     *    stretch, so it is always looking DOWN onto it. This is the ground the
     *    no-fly map used to provide, which is why nothing below the plane is
     *    ever empty fog.
     *  - ceiling, x 168–220 at y 25–31: the dive bottoms out at y≈2 between
     *    towers that top out at 21.9, so a lid has to clear them. One flat
     *    deck could not do both jobs: at y 8–13 it hung between the buildings
     *    and read as orange smoke in the streets rather than weather overhead.
     *
     * Puff scale matters as much as band height: at 5–14 units across, a
     * "thin" 11→16.5 band was really 20 units deep and the camera spent the
     * whole chapter inside it.
     *
     * Its own PRNG: the constructor's `rand` is the scene-wide stream that
     * Storm, Birds and Flock draw from after this, and consuming extra values
     * here would re-roll three already-tuned chapters.
     */
    const nightRand = mulberry32(4127);
    this.nightMaterial = new ShaderMaterial({
      vertexShader: spriteVert,
      fragmentShader: spriteFrag,
      // thinner than the formation deck: this one is looked THROUGH, down at
      // the city, not flown along. At 0.42 it closed the frame to milk.
      // Driven per-frame by the story envelope in update().
      uniforms: {
        ...this.shared,
        uSunColor: { value: this.nightSun },
        uShadowColor: { value: this.nightShadow },
        uOpacity: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
    });
    this.night = this.field(
      quality.cloudSprites,
      nightRand,
      (p, r) => {
        // the ceiling takes the larger share and a tighter z spread: it is
        // seen from 25 units below, where a field spread as wide as the floor
        // thins out to a few stray wisps against the starfield. Its x reach
        // grew with the district — the city runs to world x≈259 now, and a
        // lid that stopped at 220 left the far half of the dive open sky.
        if (r() < 0.66) {
          p.set(166 + r() * 88, 24 + Math.pow(r(), 1.3) * 7, -48 + r() * 96);
          return 4 + r() * 7;
        }
        // tight z too — CH7 flies a near-straight line at z≈2, so spreading
        // the floor 110 units wide just put most of it out of frame
        p.set(136 + r() * 48, 6 + Math.pow(r(), 1.3) * 5, -34 + r() * 68);
        return 3 + r() * 5.5;
      },
      this.nightMaterial,
    );

    if (quality.volumetricClouds) {
      // the slab straddles the line too, so the raymarch is what the camera
      // is actually inside during the formation chapter
      const box = new Box3(
        new Vector3(center.x - 52, center.y - 9, center.z - 30),
        new Vector3(center.x + 46, center.y + 3.5, center.z + 30),
      );
      this.volumeGeometry = new BoxGeometry(
        box.max.x - box.min.x,
        box.max.y - box.min.y,
        box.max.z - box.min.z,
      );
      this.volumeMaterial = new ShaderMaterial({
        vertexShader: volumeVert,
        fragmentShader: volumeFrag,
        uniforms: {
          uBoxMin: { value: box.min },
          uBoxMax: { value: box.max },
          uSunDir: { value: this.sunDir },
          uSunColor: { value: this.sunColor },
          uShadowColor: { value: this.shadowColor },
          uFogColor: { value: this.fogColor },
          uFogNear: { value: 30 },
          uFogFar: { value: 220 },
          uTime: { value: 0 },
          uSteps: { value: quality.cloudSteps },
          uCoverage: { value: 0.62 },
        },
        transparent: true,
        depthWrite: false,
        side: BackSide,
      });
      this.volume = new Mesh(this.volumeGeometry, this.volumeMaterial);
      // the slab is no longer symmetric about the anchor, so the shell must
      // sit on the BOX centre or the geometry and the raymarch bounds part
      box.getCenter(this.volume.position);
      this.volume.renderOrder = 3;
      this.volume.frustumCulled = false;
    }
  }

  /**
   * One billboard field. Own geometry (the per-instance seeds live on it),
   * shared material — both decks are the same cloud lit by the same grade.
   * `place` writes the instance position and returns its scale.
   */
  private field(
    count: number,
    rand: () => number,
    place: (p: Vector3, rand: () => number) => number,
    material: ShaderMaterial = this.spriteMaterial,
  ): InstancedMesh {
    const geometry = new PlaneGeometry(1, 1);
    const mesh = new InstancedMesh(geometry, material, count);
    const seeds = new Float32Array(count);
    const m = new Matrix4();
    const q = new Quaternion();
    const s = new Vector3();
    const p = new Vector3();
    for (let i = 0; i < count; i++) {
      seeds[i] = rand();
      s.setScalar(place(p, rand));
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
    }
    geometry.setAttribute('aSeed', new InstancedBufferAttribute(seeds, 1));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    this.geometries.push(geometry);
    return mesh;
  }

  update(time: number, sunScreenDir: Vector2, fogNear: number, fogFar: number, t: number): void {
    this.spriteMaterial.uniforms.uTime!.value = time;
    (this.spriteMaterial.uniforms.uSunScreenDir!.value as Vector2).copy(sunScreenDir);
    this.spriteMaterial.uniforms.uFogNear!.value = fogNear;
    this.spriteMaterial.uniforms.uFogFar!.value = fogFar;

    /**
     * The overnight deck fades rather than switching on — a whole cloud layer
     * appearing between two frames pops hard.
     *
     * It waits for the lighthouse to be gone (the beacon group cuts at 0.605).
     * Faded up any earlier and the beam cone had cloud behind it, which turned
     * a soft volumetric shaft into a hard-edged teal slab.
     */
    const night =
      0.16 *
      MathUtils.smoothstep(t, 0.604, 0.638) *
      (1 - MathUtils.smoothstep(t, 0.8, 0.84));
    this.nightMaterial.uniforms.uOpacity!.value = night;
    this.night.visible = night > 0.002;
    if (this.night.visible) {
      this.nightSun.copy(this.sunColor).lerp(this.moon, 0.7);
      this.nightShadow.copy(this.shadowColor).lerp(this.deepNight, 0.55);
    }

    /**
     * The formation deck fades on the same principle. It used to be a plain
     * visibility switch at t=0.2 and t=0.58, so 640 puffs arrived and left in
     * a single frame — the most visible pop in the flight, right where the
     * climb is supposed to be entering weather.
     *
     * The ramps are long on the way in (0.17→0.26, most of the takeoff) and
     * short on the way out, because leaving is motivated: the storm takes the
     * sky over at 0.36 and the beacon's own weather owns everything past 0.5.
     */
    const day =
      0.42 *
      MathUtils.smoothstep(t, 0.17, 0.26) *
      (1 - MathUtils.smoothstep(t, 0.53, 0.585));
    this.spriteMaterial.uniforms.uOpacity!.value = day;
    this.sprites.visible = day > 0.002;

    if (this.volumeMaterial) {
      this.volumeMaterial.uniforms.uTime!.value = time;
      this.volumeMaterial.uniforms.uFogNear!.value = fogNear;
      this.volumeMaterial.uniforms.uFogFar!.value = fogFar;
      // the raymarch has no opacity — coverage IS its density, so thinning it
      // to nothing is how the slab arrives and leaves without a hard edge
      const slab =
        MathUtils.smoothstep(t, 0.2, 0.28) * (1 - MathUtils.smoothstep(t, 0.4, 0.47));
      this.volumeMaterial.uniforms.uCoverage!.value = 0.14 + 0.48 * slab;
      this.volume!.visible = slab > 0.004;
    }
  }

  dispose(): void {
    this.atlas.dispose();
    for (const g of this.geometries) g.dispose();
    this.spriteMaterial.dispose();
    this.nightMaterial.dispose();
    this.volumeGeometry?.dispose();
    this.volumeMaterial?.dispose();
    this.sprites.dispose();
    this.night.dispose();
  }
}
