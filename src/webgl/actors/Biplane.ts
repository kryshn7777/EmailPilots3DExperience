import {
  BoxGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Vector3,
} from 'three';
import { bannerTexture } from '../bake/CanvasTextures';
import type { FlightPath } from '../rig/FlightPath';

/**
 * The vintage banner tow: a little biplane dragging an "EMAIL PILOTS" cloth
 * banner across the storm approach, near the warning gates. Its position is a
 * pure function of scroll-t moving AGAINST the flight direction, so it crosses
 * the paper plane head-on and scrubs perfectly in reverse. Prop spin, bob, and
 * the cloth ripple run on absolute time.
 */
export class Biplane {
  readonly group = new Group();

  private from = new Vector3();
  private to = new Vector3();
  private heading = 0;
  private banner: Mesh;
  private bannerGeometry: PlaneGeometry;
  private bannerBase: Float32Array;
  private prop: Mesh;
  private disposables: { dispose(): void }[] = [];

  constructor(path: FlightPath) {
    // crossing line anchored to the middle storm gate: enters high ahead-right
    // of the flight line, exits low behind-left — always a near miss, never a hit
    const mid = path.storyPoint(0.415);
    this.from.copy(mid).add(new Vector3(24, 3.2, 10));
    this.to.copy(mid).add(new Vector3(-26, 1.4, -9));
    const dir = this.to.clone().sub(this.from);
    this.heading = Math.atan2(-dir.z, dir.x);

    const cream = new MeshStandardMaterial({ color: '#ded2b2', roughness: 0.55 });
    const red = new MeshStandardMaterial({ color: '#a5352f', roughness: 0.5 });
    const dark = new MeshStandardMaterial({ color: '#2a2622', roughness: 0.4, metalness: 0.5 });
    this.disposables.push(cream, red, dark);

    // fuselage, model forward = local +x
    const body = new Mesh(new CylinderGeometry(0.09, 0.16, 1.5, 10), cream);
    body.rotation.z = Math.PI / 2;
    const cowl = new Mesh(new CylinderGeometry(0.17, 0.17, 0.16, 10), dark);
    cowl.rotation.z = Math.PI / 2;
    cowl.position.x = 0.8;
    this.group.add(body, cowl);
    this.disposables.push(body.geometry, cowl.geometry);

    // stacked wings + struts
    const wingG = new BoxGeometry(0.5, 0.04, 2.3);
    const upper = new Mesh(wingG, red);
    upper.position.set(0.22, 0.5, 0);
    const lower = new Mesh(wingG, red);
    lower.position.set(0.14, -0.12, 0);
    this.group.add(upper, lower);
    this.disposables.push(wingG);
    const strutG = new CylinderGeometry(0.018, 0.018, 0.62, 6);
    for (const [sx, sz] of [[0.22, 0.95], [0.22, -0.95], [0.1, 0.3], [0.1, -0.3]] as const) {
      const strut = new Mesh(strutG, dark);
      strut.position.set(sx, 0.19, sz);
      this.group.add(strut);
    }
    this.disposables.push(strutG);

    // tail
    const hStab = new Mesh(new BoxGeometry(0.34, 0.03, 0.8), red);
    hStab.position.set(-0.68, 0.06, 0);
    const vFin = new Mesh(new BoxGeometry(0.3, 0.4, 0.03), red);
    vFin.position.set(-0.7, 0.22, 0);
    this.group.add(hStab, vFin);
    this.disposables.push(hStab.geometry, vFin.geometry);

    // wheels
    const wheelG = new CylinderGeometry(0.09, 0.09, 0.05, 10);
    for (const wz of [0.22, -0.22]) {
      const wheel = new Mesh(wheelG, dark);
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(0.28, -0.4, wz);
      this.group.add(wheel);
    }
    this.disposables.push(wheelG);

    // prop: two crossed blades, spun in update
    this.prop = new Mesh(new BoxGeometry(0.02, 1.0, 0.07), dark);
    this.prop.position.x = 0.92;
    const blade2 = new Mesh(new BoxGeometry(0.02, 0.07, 1.0), dark);
    this.prop.add(blade2);
    this.group.add(this.prop);
    this.disposables.push(this.prop.geometry, blade2.geometry);

    // tow rope + cloth banner
    const rope = new Mesh(new CylinderGeometry(0.012, 0.012, 1.1, 4), dark);
    rope.rotation.z = Math.PI / 2;
    rope.position.set(-1.35, 0.05, 0);
    this.group.add(rope);
    this.disposables.push(rope.geometry);

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
  }

  update(t: number, time: number): void {
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
