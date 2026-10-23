import {
  BackSide,
  Color,
  CylinderGeometry,
  MathUtils,
  Mesh,
  ShaderMaterial,
  Vector3,
} from 'three';
import type { SkyDome } from '../materials/SkyDome';
import { erodesSkyVisibility } from '../materials/skyVisibility';
import mountainsVert from '../shaders/mountains.vert.glsl';
import mountainsFrag from '../shaders/mountains.frag.glsl';

/**
 * The ranges standing behind the neighbourhood. A sky layer, not scenery: four
 * ridgelines are found per pixel from the view azimuth (see mountains.frag), the
 * mesh is a cylinder pinned to the far plane that follows the camera, and it is
 * drawn behind everything that has depth, so the foggy end of the ground simply
 * covers its foot. It takes the sky's own colours and sun every frame, so it is
 * lit and hazed by whichever chapter's grade is on.
 */
export class Mountains {
  readonly mesh: Mesh;
  private material: ShaderMaterial;
  private geometry = new CylinderGeometry(1, 1, 2, 48, 1, true);
  private fog = new Color();

  constructor(sky: SkyDome) {
    this.material = new ShaderMaterial({
      vertexShader: mountainsVert,
      fragmentShader: mountainsFrag,
      uniforms: {
        uZenith: { value: sky.zenith },
        uHorizon: { value: sky.horizon },
        uFog: { value: this.fog },
        uSunColor: { value: sky.sunColor },
        uSunDir: { value: sky.sunDir },
        uSunIntensity: { value: 1 },
        uOpacity: { value: 0 },
        // the flight heads down +x through the neighbourhood: the tallest massif waits there
        uFacing: { value: 0.15 },
      },
      side: BackSide,
      transparent: true,
      depthWrite: false,
    });
    // a ridge in front of the sun blocks its light as well as its disc
    erodesSkyVisibility(this.material);
    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    // after the sky dome (-1), before everything with depth
    this.mesh.renderOrder = -0.5;
    this.mesh.visible = false;
    // tall enough to cover every view angle from the horizon up to the peaks
    this.mesh.scale.set(300, 300, 300);
  }

  /** `t` is story time; the range is in view only while the flight crosses the district. */
  update(t: number, camera: Vector3, fogColor: Color, deckClose: number): void {
    const opacity =
      MathUtils.smoothstep(t, 0.06, 0.11) *
      (1 - MathUtils.smoothstep(t, 0.3, 0.335)) *
      (1 - MathUtils.smoothstep(deckClose, 0.0, 0.6));
    this.mesh.visible = opacity > 0.003;
    if (!this.mesh.visible) return;
    this.mesh.position.copy(camera);
    this.fog.copy(fogColor);
    this.material.uniforms.uOpacity!.value = opacity;
  }

  /** the chapter grade's sun level, so a dim dusk does not light the snow like noon */
  setSunIntensity(v: number): void {
    this.material.uniforms.uSunIntensity!.value = v;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
