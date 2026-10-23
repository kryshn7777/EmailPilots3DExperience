import {
  HalfFloatType,
  LinearFilter,
  Matrix4,
  PerspectiveCamera,
  Plane,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderTarget,
  type Scene,
  type Texture,
  type WebGLRenderer,
} from 'three';

/** the layer of everything the sea can mirror: the camera that draws the reflection sees only this one */
export const REFLECTED_LAYER = 2;

const UP = new Vector3(0, 1, 0);

/**
 * A mirror for a horizontal plane: the scene as the water would show it.
 *
 * The camera is reflected through the plane and the scene is drawn from there into a small
 * render target; the water shader looks that picture up with the projective `matrix`, nudged by its
 * own wave normals. Only objects on `layer` are drawn, so the cost is the lighthouse, the ship, the
 * beam and the sky and nothing else of the world, at a fraction of the frame's pixels.
 *
 * The reflected camera sits under the water, so the plane is also made its near clip plane
 * (Lengyel's oblique frustum, the same trick three's Reflector uses): anything below the surface,
 * such as the foot of the islet, is cut instead of being drawn in front of the reflection.
 */
export class PlanarReflection {
  readonly matrix = new Matrix4();
  private target: WebGLRenderTarget;
  private camera = new PerspectiveCamera();
  private plane = new Plane(new Vector3(0, 1, 0), 0);
  private clip = new Vector4();
  private q = new Vector4();
  private size = new Vector2();
  private forward = new Vector3();
  private up = new Vector3();

  constructor(
    layer: number,
    private fraction = 0.5,
  ) {
    this.target = new WebGLRenderTarget(2, 2, {
      type: HalfFloatType,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
    });
    this.camera.layers.set(layer);
  }

  get texture(): Texture {
    return this.target.texture;
  }

  /** draws the reflection of `scene` in the plane y = `y`, as `source` sees it */
  render(renderer: WebGLRenderer, scene: Scene, source: PerspectiveCamera, y: number): void {
    renderer.getDrawingBufferSize(this.size);
    const w = Math.max(2, Math.round(this.size.x * this.fraction));
    const h = Math.max(2, Math.round(this.size.y * this.fraction));
    if (w !== this.target.width || h !== this.target.height) this.target.setSize(w, h);

    const cam = this.camera;
    // the camera, mirrored through the plane: same place above/below, same way ahead, flipped in height
    cam.position.set(source.position.x, 2 * y - source.position.y, source.position.z);
    source.getWorldDirection(this.forward);
    this.forward.y = -this.forward.y;
    this.up.set(0, 1, 0).applyQuaternion(source.quaternion);
    this.up.y = -this.up.y;
    cam.up.copy(this.up);
    cam.lookAt(this.forward.add(cam.position));
    cam.updateMatrixWorld();
    cam.near = source.near;
    cam.far = source.far;
    cam.projectionMatrix.copy(source.projectionMatrix);
    cam.projectionMatrixInverse.copy(source.projectionMatrixInverse);

    // world position -> uv in the reflection (taken before the clip plane bends the depth row)
    this.matrix
      .set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
      .multiply(cam.projectionMatrix)
      .multiply(cam.matrixWorldInverse);

    // the plane as the near clip plane
    this.plane.set(UP, -y).applyMatrix4(cam.matrixWorldInverse);
    const clip = this.clip.set(this.plane.normal.x, this.plane.normal.y, this.plane.normal.z, this.plane.constant);
    const p = cam.projectionMatrix.elements;
    const q = this.q;
    q.x = (Math.sign(clip.x) + p[8]!) / p[0]!;
    q.y = (Math.sign(clip.y) + p[9]!) / p[5]!;
    q.z = -1;
    q.w = (1 + p[10]!) / p[14]!;
    clip.multiplyScalar(2 / clip.dot(q));
    p[2] = clip.x;
    p[6] = clip.y;
    p[10] = clip.z + 1;
    p[14] = clip.w;

    const previous = renderer.getRenderTarget();
    // this view has no shadows of its own: keep the sun's shadow map from being redrawn for it
    const shadows = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(this.target);
    renderer.render(scene, cam);
    renderer.setRenderTarget(previous);
    renderer.shadowMap.autoUpdate = shadows;
  }

  dispose(): void {
    this.target.dispose();
  }
}
