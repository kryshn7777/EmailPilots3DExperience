import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Quaternion,
  RepeatWrapping,
  RingGeometry,
  TextureLoader,
  Vector2,
  Vector3,
  type InterleavedBufferAttribute,
  type Material,
  type PointLight,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { asset } from '../asset';
import { bannerTexture, glowTexture } from '../bake/CanvasTextures';
import { detectQuality, type Quality } from '../quality';
import type { FlightPath } from '../rig/FlightPath';
import { requestCompile } from '../warm';

/** prop hub and tow hook in model space, as blender/make_biplane.py prints them (the GLB's `prop_hub` Empty wins) */
const HUB = new Vector3(0.878, 0, 0);
const TOW = new Vector3(-0.939, -0.024, 0);
const PROP_RADIUS = 1.22 * (2.3 / 9.8);
/** the banner's towed edge */
const BANNER_EDGE = new Vector3(-1.95, 0.05, 0);

/** Float copies of a quantized GLB geometry's attributes, so the node transform can be baked in. */
function dequantized(source: BufferGeometry): BufferGeometry {
  const geometry = source.clone();
  for (const [name, attr] of Object.entries(geometry.attributes)) {
    if (attr.array instanceof Float32Array && !attr.normalized && !(attr as InterleavedBufferAttribute).isInterleavedBufferAttribute) continue;
    const n = attr.itemSize;
    const out = new Float32Array(attr.count * n);
    const get = [attr.getX, attr.getY, attr.getZ, attr.getW];
    for (let i = 0; i < attr.count; i++) for (let k = 0; k < n; k++) out[i * n + k] = get[k]!.call(attr, i);
    geometry.setAttribute(name, new BufferAttribute(out, n));
  }
  return geometry;
}

/**
 * The vintage banner tow: a Stearman-style biplane dragging an "EMAIL PILOTS" cloth banner across
 * the storm approach, near the warning gates. Its position is a pure function of scroll-t moving
 * AGAINST the flight direction, so it crosses the paper plane head-on and scrubs perfectly in
 * reverse. Prop spin, bob, and the cloth ripple run on absolute time.
 *
 * The aircraft is modelled in Blender (blender/make_biplane.py, ~33k triangles, meshopt-packed):
 * a lofted fuselage with metal panels forward and doped fabric aft, a nine-cylinder radial in a
 * Townend ring, a twisted wooden prop, ribbed wings with ailerons, struts and rigging wires, a
 * striped rudder, wire wheels, and a pilot in helmet, goggles and scarf. It streams in after
 * construction; until then only the tow line and the banner fly.
 *
 * It flies through a night storm, so every lit surface carries a cool rim term (the sky caught on
 * its silhouette) that flares with the lightning, and it shows navigation lights (red to port,
 * green to starboard, white on the tail) and a flickering exhaust glow.
 */
export class Biplane {
  readonly group = new Group();

  private from = new Vector3();
  private to = new Vector3();
  private heading = 0;
  private banner: Mesh;
  private bannerGeometry: PlaneGeometry;
  private bannerBase: Float32Array;
  /** the model as loaded, in its own frame (forward = local +x) */
  private model = new Group();
  /** the propeller and its hub, spun about the model's x axis at the hub */
  private prop = new Group();
  private exhaustGlow: PointsMaterial | null = null;
  /** shared by every lit material's rim term */
  private rim = { value: new Color('#5f7aa8').multiplyScalar(0.55) };
  private flash = { value: 0 };
  private stormLight: PointLight | null | undefined;
  private disposables: { dispose(): void }[] = [];

  constructor(path: FlightPath, quality: Quality = detectQuality('')) {
    // crossing line anchored to the middle storm gate: enters high ahead-right
    // of the flight line, exits low behind-left — always a near miss, never a hit
    const mid = path.storyPoint(0.415);
    this.from.copy(mid).add(new Vector3(24, 3.2, 10));
    this.to.copy(mid).add(new Vector3(-26, 1.4, -9));
    const dir = this.to.clone().sub(this.from);
    this.heading = Math.atan2(-dir.z, dir.x);

    this.group.add(this.model);
    this.prop.position.copy(HUB);
    this.model.add(this.prop);

    // the spinning prop reads as a faint disc with a brass ring where the tips blur
    const disc = new CircleGeometry(PROP_RADIUS, 40).rotateY(Math.PI / 2);
    const discMat = new MeshBasicMaterial({
      color: '#c9b08a', transparent: true, opacity: 0.06, depthWrite: false, side: DoubleSide,
    });
    const tips = new RingGeometry(PROP_RADIUS * 0.9, PROP_RADIUS, 48).rotateY(Math.PI / 2);
    const tipsMat = new MeshBasicMaterial({
      color: '#d8b25a', transparent: true, opacity: 0.12, depthWrite: false, side: DoubleSide,
    });
    const blur = new Group();
    blur.add(new Mesh(disc, discMat), new Mesh(tips, tipsMat));
    blur.position.copy(HUB);
    blur.position.x -= 0.004; // just ahead of the blades' plane
    blur.renderOrder = 2;
    this.model.add(blur);
    this.disposables.push(disc, discMat, tips, tipsMat);

    // tow line from the hook under the tail to the banner's leading edge
    // (thick enough to stay a continuous line at a distance; thinner, it broke into pixel crumbs)
    const ropeMat = new MeshStandardMaterial({ color: '#6b5d48', roughness: 0.8 });
    const span = BANNER_EDGE.clone().sub(TOW);
    const rope = new Mesh(new CylinderGeometry(0.01, 0.01, span.length(), 6), ropeMat);
    rope.position.copy(TOW).addScaledVector(span, 0.5);
    rope.quaternion.copy(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), span.normalize()));
    this.group.add(rope);
    this.disposables.push(rope.geometry, ropeMat);

    const map = bannerTexture();
    const cloth = new MeshStandardMaterial({
      map,
      roughness: 0.8,
      side: DoubleSide,
      emissive: '#efe5cf',
      emissiveMap: map,
      emissiveIntensity: 0.32, // readable inside the storm's gloom
    });
    this.bannerGeometry = new PlaneGeometry(3.6, 0.8, 28, 5);
    this.banner = new Mesh(this.bannerGeometry, cloth);
    this.banner.position.set(-3.75, 0.05, 0);
    // printed face toward the flight line: the crossing puts the camera on
    // the -z local side, so flip the cloth to read correctly from there
    this.banner.rotation.y = Math.PI;
    this.group.add(this.banner);
    this.bannerBase = (this.bannerGeometry.attributes.position!.array as Float32Array).slice();
    this.disposables.push(this.bannerGeometry, cloth, map);

    this.load(quality.tier === 'high');
  }

  /** the rim: a cool fresnel glow on every lit part, lifted by the lightning */
  private rimHook = (shader: WebGLProgramParametersWithUniforms): void => {
    shader.uniforms.uRim = this.rim;
    shader.uniforms.uFlash = this.flash;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRim;\nuniform float uFlash;')
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
        {
          float facing = saturate(dot(normal, normalize(vViewPosition)));
          float rimF = pow(1.0 - facing, 3.0);
          vec3 tint = 0.35 + 0.65 * diffuseColor.rgb;
          totalEmissiveRadiance += uRim * (1.0 + 5.0 * uFlash) * rimF * tint;
          totalEmissiveRadiance += diffuseColor.rgb * uFlash * 0.18;
        }`,
      );
  };

  private load(high: boolean): void {
    const lit = (params: ConstructorParameters<typeof MeshStandardMaterial>[0]): MeshStandardMaterial => {
      const m = new MeshStandardMaterial({ vertexColors: true, ...params });
      m.onBeforeCompile = this.rimHook;
      this.disposables.push(m);
      return m;
    };
    // doped fabric: rib tapes, stitching and the weave in a tiling normal map (HIGH tier)
    let weave = null;
    if (high) {
      weave = new TextureLoader().load(asset('/models/biplane/fabric-normal.webp'));
      weave.wrapS = weave.wrapT = RepeatWrapping;
      weave.flipY = false;
      weave.anisotropy = 4;
      this.disposables.push(weave);
    }
    const glass = new MeshStandardMaterial({
      color: '#a9c4d6', roughness: 0.05, metalness: 0.4, transparent: true, opacity: 0.35,
      depthWrite: false, side: DoubleSide,
    });
    const lamp = new MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    this.disposables.push(glass, lamp);
    const materials: Record<string, Material> = {
      fabric: lit({ roughness: 0.62, normalMap: weave, normalScale: new Vector2(0.9, 0.9) }),
      paint: lit({ roughness: 0.3, metalness: 0.25 }),
      metal: lit({ roughness: 0.32, metalness: 0.85 }),
      leather: lit({ roughness: 0.72 }),
      prop: lit({ roughness: 0.28, metalness: 0.05 }),
      spinner: lit({ roughness: 0.18, metalness: 1 }),
      glass,
      lamp,
    };

    new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).load(asset('/models/biplane/biplane.glb'), (gltf) => {
      const root = gltf.scene;
      root.updateMatrixWorld(true);
      const marks: Record<string, Vector3> = {};
      const sources: Mesh[] = [];
      root.traverse((o) => {
        if ((o as Mesh).isMesh) sources.push(o as Mesh);
        else if (o !== root) marks[o.name] = o.getWorldPosition(new Vector3());
      });
      const hub = marks.prop_hub ?? HUB;
      this.prop.position.copy(hub);
      for (const src of sources) {
        const geometry = dequantized(src.geometry).applyMatrix4(src.matrixWorld);
        src.geometry.dispose();
        const spins = src.name === 'prop' || src.name === 'spinner';
        if (spins) geometry.translate(-hub.x, -hub.y, -hub.z);
        const mesh = new Mesh(geometry, materials[src.name] ?? materials.paint!);
        mesh.name = `biplane-${src.name}`;
        (spins ? this.prop : this.model).add(mesh);
        this.disposables.push(geometry);
      }

      // navigation lights and the exhaust, as soft additive glows
      const glow = glowTexture();
      const navAt: [string, string][] = [['nav_port', '#ff3b30'], ['nav_star', '#3dff7a'], ['nav_tail', '#fff3dc']];
      const pos: number[] = [];
      const col: number[] = [];
      const c = new Color();
      for (const [name, hex] of navAt) {
        const p = marks[name];
        if (!p) continue;
        pos.push(p.x, p.y, p.z);
        c.set(hex);
        col.push(c.r, c.g, c.b);
      }
      const navGeometry = new BufferGeometry();
      navGeometry.setAttribute('position', new Float32BufferAttribute(pos, 3));
      navGeometry.setAttribute('color', new Float32BufferAttribute(col, 3));
      const navMaterial = new PointsMaterial({
        map: glow, vertexColors: true, size: 0.2, transparent: true, depthWrite: false,
        blending: AdditiveBlending, sizeAttenuation: true,
      });
      const nav = new Points(navGeometry, navMaterial);
      nav.frustumCulled = false;
      this.model.add(nav);
      this.disposables.push(glow, navGeometry, navMaterial);
      if (marks.exhaust) {
        const exGeometry = new BufferGeometry();
        exGeometry.setAttribute('position', new Float32BufferAttribute(marks.exhaust.toArray(), 3));
        this.exhaustGlow = new PointsMaterial({
          map: glow, color: '#ff8a3a', size: 0.12, transparent: true, depthWrite: false,
          blending: AdditiveBlending, sizeAttenuation: true,
        });
        const ex = new Points(exGeometry, this.exhaustGlow);
        ex.frustumCulled = false;
        this.model.add(ex);
        this.disposables.push(exGeometry, this.exhaustGlow);
      }
      requestCompile(this.model);
    });
  }

  /** the storm's lightning, read off its light (Storm drives it at 900 × flash) */
  private stormFlash(): number {
    if (this.stormLight === undefined && this.group.parent) {
      this.stormLight = null;
      this.group.parent.traverse((o) => {
        const l = o as PointLight;
        if (l.isPointLight && l.distance === 90) this.stormLight = l;
      });
    }
    return this.stormLight ? MathUtils.clamp(this.stormLight.intensity / 900, 0, 1) : 0;
  }

  /** `flash` is the storm's lightning (0..1); without it the biplane reads it off the storm's light */
  update(t: number, time: number, flash?: number): void {
    if (!this.group.visible) return;
    const u = MathUtils.clamp((t - 0.335) / (0.47 - 0.335), 0, 1);
    this.group.position.lerpVectors(this.from, this.to, u);
    this.group.position.y += Math.sin(time * 1.3) * 0.3;
    this.group.rotation.set(
      Math.sin(time * 0.9) * 0.06,
      this.heading,
      Math.sin(time * 1.1) * 0.08,
      'YXZ',
    );
    this.prop.rotation.x = time * 40;
    this.flash.value = flash ?? this.stormFlash();
    if (this.exhaustGlow) {
      this.exhaustGlow.opacity = 0.7 + 0.3 * Math.sin(time * 37) * Math.sin(time * 23.7);
    }

    // cloth ripple: grows toward the free end, with a lazy droop
    const attr = this.bannerGeometry.attributes.position!;
    const arr = attr.array as Float32Array;
    for (let i = 0; i < arr.length; i += 3) {
      const bx = this.bannerBase[i]!;
      const s = 0.5 - bx / 3.6; // 0 at the towed edge → 1 at the free end
      arr[i + 2] = this.bannerBase[i + 2]! +
        Math.sin(bx * 2.4 - time * 6.5) * 0.1 * s +
        Math.sin(bx * 5.1 - time * 9.7) * 0.035 * s;
      arr[i + 1] = this.bannerBase[i + 1]! - s * s * 0.16;
    }
    attr.needsUpdate = true;
    this.bannerGeometry.computeVertexNormals();
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
