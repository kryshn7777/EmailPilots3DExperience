import {
  Group,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  SRGBColorSpace,
  TextureLoader,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { asset } from '../asset';
import { requestCompile } from '../warm';
import type { Tier } from '../quality';

export interface LaptopOptions {
  /** the display's own material (the live screen) */
  screen: Material;
  /** how far the lid leans back from vertical, radians */
  tilt?: number;
  tier: Tier;
}

export interface Laptop {
  /** hinge at the origin, base along +x, lid standing up and leaning back, display facing +x */
  group: Group;
  /** the lid, for animating it open or shut */
  readonly lid: Object3D | null;
  dispose(): void;
}

/**
 * The laptop modelled in Blender (blender/make_laptop.py, ~2k triangles): an aluminium unibody
 * with rounded edges, an 85-key keyboard with legends and a backlight glowing between the keys,
 * a glass trackpad, hinge barrel, speaker slots, ports, feet, a bezel with a camera and a charge
 * LED, and a glowing dart on the lid. The model is in the desk's units (the display is 1.38 x
 * 0.93); scale the returned group for anything else. It streams in after construction, so the
 * returned group is empty for a moment.
 */
export function createLaptop(opts: LaptopOptions): Laptop {
  const group = new Group();
  const owned: { dispose(): void }[] = [];
  const own = <T extends { dispose(): void }>(x: T): T => { owned.push(x); return x; };
  let lid: Object3D | null = null;

  const high = opts.tier === 'high';
  const alu = own(new MeshPhysicalMaterial({
    color: '#aeb2ba', metalness: 1, roughness: 0.34, clearcoat: high ? 0.25 : 0, clearcoatRoughness: 0.4,
    envMapIntensity: 1.3,
  }));
  const black = own(new MeshStandardMaterial({ color: '#0c0e13', roughness: 0.35, metalness: 0.2 }));
  const glass = own(new MeshPhysicalMaterial({
    color: '#1c2029', roughness: 0.18, metalness: 0.2, clearcoat: high ? 0.6 : 0, clearcoatRoughness: 0.15,
  }));
  const rubber = own(new MeshStandardMaterial({ color: '#17181b', roughness: 0.9 }));
  const wellMaterial = own(new MeshStandardMaterial({ color: '#15181f', roughness: 0.6, metalness: 0.3 }));
  const backlight = own(new MeshBasicMaterial({ color: '#4f8fe0', toneMapped: false, transparent: true, opacity: 0.22 }));
  const led = own(new MeshBasicMaterial({ color: '#5fff9f', toneMapped: false }));
  const emblem = own(new MeshStandardMaterial({ color: '#1a2030', emissive: '#7fb4ff', emissiveIntensity: 1.1, side: 2 }));
  const keysTexture = new TextureLoader().load(asset('/models/laptop/laptop-keys.webp'));
  keysTexture.flipY = false;
  keysTexture.colorSpace = SRGBColorSpace;
  keysTexture.anisotropy = 8;
  own(keysTexture);
  const keys = own(new MeshStandardMaterial({ map: keysTexture, roughness: 0.55, metalness: 0.1 }));

  const byName: Record<string, Material> = {
    base: alu, lid_shell: alu, bezel: black, black, camera: black, trackpad: glass, rubber,
    keys, well: wellMaterial, backlight, led, cam_led: led, emblem, screen: opts.screen,
  };

  new GLTFLoader().load(asset('/models/laptop/laptop.glb'), (gltf) => {
    const root = gltf.scene;
    root.traverse((o) => {
      const mesh = o as Mesh;
      if (o.name === 'lid') lid = o;
      if (!mesh.isMesh) return;
      if (o.name === 'screen') {
        // glTF uvs run top-down; the live screens are canvas textures drawn top-down with flipY
        const uv = mesh.geometry.attributes.uv!;
        for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
        uv.needsUpdate = true;
      }
      mesh.material = byName[o.name] ?? black;
      mesh.castShadow = o.name !== 'backlight' && o.name !== 'screen';
      mesh.receiveShadow = true;
      own(mesh.geometry);
    });
    if (lid) lid.rotation.z = opts.tilt ?? 0.24;
    group.add(root);
    requestCompile(root);
  });

  return {
    group,
    get lid() { return lid; },
    dispose: () => owned.forEach((d) => d.dispose()),
  };
}
