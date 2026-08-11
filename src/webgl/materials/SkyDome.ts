import { BackSide, Color, Mesh, ShaderMaterial, SphereGeometry, Vector3 } from 'three';
import skyVert from '../shaders/sky.vert.glsl';
import skyFrag from '../shaders/sky.frag.glsl';

/**
 * Far-plane-pinned gradient dome. Follows the camera; uniforms are lerped
 * every frame from the chapter grade blend.
 */
export class SkyDome {
  readonly mesh: Mesh;
  private material: ShaderMaterial;
  private geometry = new SphereGeometry(1, 32, 16);

  readonly zenith = new Color();
  readonly horizon = new Color();
  readonly sunColor = new Color();
  readonly sunDir = new Vector3(0, 1, 0);

  constructor() {
    this.material = new ShaderMaterial({
      vertexShader: skyVert,
      fragmentShader: skyFrag,
      uniforms: {
        uZenith: { value: this.zenith },
        uHorizon: { value: this.horizon },
        uSunColor: { value: this.sunColor },
        uSunDir: { value: this.sunDir },
        uSunIntensity: { value: 1 },
        uFlash: { value: 0 },
      },
      side: BackSide,
      depthWrite: false,
    });
    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
  }

  set sunIntensity(v: number) {
    this.material.uniforms.uSunIntensity!.value = v;
  }

  set flash(v: number) {
    this.material.uniforms.uFlash!.value = v;
  }

  followCamera(cameraPosition: Vector3): void {
    this.mesh.position.copy(cameraPosition);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
