import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  PointLight,
  SphereGeometry,
  Vector3,
} from 'three';
import { arrivalScreenTexture, replyTexture, runwayTexture } from '../bake/CanvasTextures';

/**
 * CH10: a real dawn airfield. Marked runway with edge/threshold lights, an
 * approach-light "rabbit" strobing toward the threshold, PAPI bars, a
 * control tower, hangar, apron and windsock — and after touchdown the dart
 * unfolds back into the letter while the "Re:" reply slides out.
 */
/**
 * The arrival office, and the desk height its laptop sits at. These are
 * fixed world coordinates on purpose: the flight line's final control point
 * (pathPoints.mjs) is authored to end inside this screen, so the two must be
 * edited together.
 */
const OFFICE = { x: 278, z: 17 };
const DESK_TOP = 0.62;

export class Landing {
  readonly group = new Group();
  private edgeLightMaterial: MeshStandardMaterial;
  private rabbitMaterials: MeshStandardMaterial[] = [];
  private windsock: Mesh;
  private reply: Mesh;
  private replyHome = new Vector3();
  private screenMaterial!: MeshStandardMaterial;
  private screenLight!: PointLight;
  private disposables: { dispose(): void }[] = [];

  constructor(runwayEnd: Vector3) {
    const cx = runwayEnd.x;
    const cz = runwayEnd.z;
    const RUNWAY_LEN = 64;
    const RUNWAY_W = 9;
    const startX = cx - 48; // threshold the plane crosses first

    // apron of dark grass under everything
    const grass = new MeshStandardMaterial({ color: '#161b14', roughness: 1 });
    const field = new Mesh(new PlaneGeometry(190, 120), grass);
    field.rotation.x = -Math.PI / 2;
    field.position.set(cx - 14, -0.02, cz);
    this.group.add(field);
    this.disposables.push(field.geometry, grass);

    // runway strip (texture long-axis = V → rotate so V runs along X)
    const asphalt = new MeshStandardMaterial({ map: runwayTexture(), roughness: 0.92 });
    const strip = new Mesh(new PlaneGeometry(RUNWAY_W, RUNWAY_LEN), asphalt);
    strip.rotation.x = -Math.PI / 2;
    strip.rotation.z = Math.PI / 2;
    strip.position.set(startX + RUNWAY_LEN / 2 - 6, 0.01, cz);
    this.group.add(strip);
    this.disposables.push(strip.geometry, asphalt);

    // taxiway + apron slab by the hangar
    const taxi = new MeshStandardMaterial({ color: '#1d2028', roughness: 0.95 });
    const taxiway = new Mesh(new PlaneGeometry(3.4, 16), taxi);
    taxiway.rotation.x = -Math.PI / 2;
    taxiway.position.set(cx - 4, 0.008, cz + 11);
    const apron = new Mesh(new PlaneGeometry(16, 12), taxi);
    apron.rotation.x = -Math.PI / 2;
    apron.position.set(cx - 6, 0.006, cz + 21);
    this.group.add(taxiway, apron);
    this.disposables.push(taxiway.geometry, apron.geometry, taxi);

    // runway edge lights (warm) + threshold bars (green near / red far)
    this.edgeLightMaterial = new MeshStandardMaterial({
      color: '#4a2e10',
      emissive: '#ffc96b',
      emissiveIntensity: 1.6,
    });
    const bulb = new SphereGeometry(0.09, 8, 8);
    this.disposables.push(bulb, this.edgeLightMaterial);
    for (let i = 0; i <= 16; i++) {
      for (const sideZ of [-RUNWAY_W / 2 - 0.4, RUNWAY_W / 2 + 0.4]) {
        const light = new Mesh(bulb, this.edgeLightMaterial);
        light.position.set(startX + (i * RUNWAY_LEN) / 16 - 6, 0.1, cz + sideZ);
        this.group.add(light);
      }
    }
    const greenMat = new MeshStandardMaterial({ color: '#062a10', emissive: '#3ef58a', emissiveIntensity: 2 });
    const redMat = new MeshStandardMaterial({ color: '#2a0808', emissive: '#ff4b4b', emissiveIntensity: 2 });
    this.disposables.push(greenMat, redMat);
    for (let i = 0; i < 9; i++) {
      const z = cz - RUNWAY_W / 2 + 0.5 + (i * (RUNWAY_W - 1)) / 8;
      const g = new Mesh(bulb, greenMat);
      g.position.set(startX - 6.6, 0.1, z);
      const r = new Mesh(bulb, redMat);
      r.position.set(startX + RUNWAY_LEN - 5.4, 0.1, z);
      this.group.add(g, r);
    }

    // approach "rabbit": gantry strobes sweeping toward the threshold
    const strobeGeo = new SphereGeometry(0.12, 8, 8);
    this.disposables.push(strobeGeo);
    for (let i = 0; i < 10; i++) {
      const m = new MeshStandardMaterial({
        color: '#101318',
        emissive: '#eaf2ff',
        emissiveIntensity: 0,
      });
      const s = new Mesh(strobeGeo, m);
      s.position.set(startX - 10 - i * 3.4, 0.5 + i * 0.12, cz);
      this.group.add(s);
      this.rabbitMaterials.push(m);
      this.disposables.push(m);
    }

    // PAPI: four lights beside the touchdown zone, two white two red
    const papiWhite = new MeshStandardMaterial({ color: '#222', emissive: '#fff4e0', emissiveIntensity: 2.2 });
    const papiRed = new MeshStandardMaterial({ color: '#220808', emissive: '#ff4b4b', emissiveIntensity: 2.2 });
    this.disposables.push(papiWhite, papiRed);
    for (let i = 0; i < 4; i++) {
      const m = i < 2 ? papiWhite : papiRed;
      const p = new Mesh(bulb, m);
      p.position.set(startX + 10, 0.16, cz - RUNWAY_W / 2 - 2.2 - i * 0.9);
      this.group.add(p);
    }

    // control tower
    const towerMat = new MeshStandardMaterial({ color: '#242a34', roughness: 0.6 });
    const towerGlass = new MeshStandardMaterial({
      color: '#0d2028',
      emissive: '#ffc96b',
      emissiveIntensity: 1.1,
      roughness: 0.3,
    });
    const shaft = new Mesh(new CylinderGeometry(0.7, 1, 8, 10), towerMat);
    shaft.position.set(cx - 12, 4, cz + 24);
    const cab = new Mesh(new CylinderGeometry(1.5, 1.2, 1.6, 10), towerGlass);
    cab.position.set(cx - 12, 8.6, cz + 24);
    const cap = new Mesh(new ConeGeometry(1.5, 0.8, 10), towerMat);
    cap.position.set(cx - 12, 9.8, cz + 24);
    this.group.add(shaft, cab, cap);
    this.disposables.push(shaft.geometry, cab.geometry, cap.geometry, towerMat, towerGlass);

    // hangar: box + half-cylinder roof
    const hangarMat = new MeshStandardMaterial({ color: '#2a2f3a', roughness: 0.8 });
    const hangarBody = new Mesh(new BoxGeometry(10, 3.2, 8), hangarMat);
    hangarBody.position.set(cx - 2, 1.6, cz + 24);
    const roof = new Mesh(new CylinderGeometry(4, 4, 10, 14, 1, false, 0, Math.PI), hangarMat);
    roof.rotation.z = Math.PI / 2;
    roof.position.set(cx - 2, 3.2, cz + 24);
    this.group.add(hangarBody, roof);
    this.disposables.push(hangarBody.geometry, roof.geometry, hangarMat);

    // windsock
    const pole = new Mesh(new CylinderGeometry(0.04, 0.05, 2.6, 8), towerMat);
    pole.position.set(startX + 4, 1.3, cz + RUNWAY_W / 2 + 3);
    const sockMat = new MeshStandardMaterial({ color: '#d96a2b', roughness: 0.7 });
    this.windsock = new Mesh(new ConeGeometry(0.22, 1.1, 8, 1, true), sockMat);
    this.windsock.position.set(startX + 4, 2.5, cz + RUNWAY_W / 2 + 3);
    this.windsock.rotation.z = Math.PI / 2 - 0.25;
    this.group.add(pole, this.windsock);
    this.disposables.push(pole.geometry, this.windsock.geometry, sockMat);

    this.buildArrivalOffice();

    // the printed reply waits on the arrival desk, beside the laptop
    const paper = new MeshStandardMaterial({ map: replyTexture(), roughness: 0.9 });
    this.reply = new Mesh(new PlaneGeometry(0.5, 0.7), paper);
    this.reply.rotation.x = -Math.PI / 2;
    this.reply.rotation.z = -0.12;
    this.replyHome.set(OFFICE.x + 0.95, DESK_TOP + 0.01, OFFICE.z + 1.9);
    this.reply.position.copy(this.replyHome);
    this.group.add(this.reply);
    this.disposables.push(this.reply.geometry, paper);
  }

  /**
   * The delivery itself: an office off the apron with its door open to the
   * taxiway, a desk, and the laptop the flight ends inside. The flight line's
   * last control point IS this screen, so the dart flies into it head-on.
   */
  private buildArrivalOffice(): void {
    const { x, z } = OFFICE;
    const shell = new MeshStandardMaterial({ color: '#2b3244', roughness: 0.8 });
    const trim = new MeshStandardMaterial({ color: '#e6eaf2', roughness: 0.5 });
    const deskMat = new MeshStandardMaterial({ color: '#262b38', roughness: 0.4 });
    const steel = new MeshStandardMaterial({ color: '#9aa1b0', roughness: 0.3, metalness: 0.8 });
    this.disposables.push(shell, trim, deskMat, steel);
    const box = (
      m: MeshStandardMaterial,
      w: number, h: number, d: number,
      px: number, py: number, pz: number,
    ): void => {
      const mesh = new Mesh(new BoxGeometry(w, h, d), m);
      mesh.position.set(px, py, pz);
      this.group.add(mesh);
      this.disposables.push(mesh.geometry);
    };
    // floor slab, back and side walls, ceiling. The −z face stays open: that
    // is the doorway the dart comes through.
    box(deskMat, 11, 0.08, 11, x, 0.04, z);
    box(shell, 11, 3.6, 0.16, x, 1.8, z + 5.5);
    box(shell, 0.16, 3.6, 11, x - 5.5, 1.8, z);
    box(shell, 0.16, 3.6, 11, x + 5.5, 1.8, z);
    box(shell, 11, 0.16, 11, x, 3.66, z);
    // doorway reveal — a lit frame so the opening reads as a door
    box(trim, 0.3, 3.6, 0.3, x - 2.6, 1.8, z - 5.4);
    box(trim, 0.3, 3.6, 0.3, x + 2.6, 1.8, z - 5.4);
    box(trim, 5.5, 0.3, 0.3, x, 3.45, z - 5.4);

    // ceiling panel: the only light in here, so the screen reads as the hero
    const panelFace = new MeshStandardMaterial({
      color: '#eef2fa',
      emissive: '#e8eefb',
      emissiveIntensity: 1.5,
    });
    this.disposables.push(panelFace);
    box(panelFace, 3.2, 0.04, 1.4, x, 3.5, z + 0.4);
    const roomLight = new PointLight('#eef3ff', 7, 14, 1.7);
    roomLight.position.set(x, 2.9, z + 0.6);
    this.group.add(roomLight);

    // desk facing the door, laptop open toward the incoming flight
    box(deskMat, 4.2, 0.09, 2.2, x, DESK_TOP, z + 2.1);
    box(steel, 0.08, 0.85, 1.9, x - 1.95, DESK_TOP - 0.5, z + 2.1);
    box(steel, 0.08, 0.85, 1.9, x + 1.95, DESK_TOP - 0.5, z + 2.1);
    box(deskMat, 1.7, 0.05, 1.15, x - 0.5, DESK_TOP + 0.06, z + 1.55); // deck
    box(deskMat, 1.5, 1.25, 0.06, x - 0.5, DESK_TOP + 0.68, z + 2.24); // lid

    const screenMaterial = new MeshStandardMaterial({
      map: arrivalScreenTexture(),
      emissiveMap: arrivalScreenTexture(),
      emissive: '#ffffff',
      emissiveIntensity: 0.12, // dark until the mail actually lands
      roughness: 0.25,
    });
    this.screenMaterial = screenMaterial;
    const screen = new Mesh(new PlaneGeometry(1.34, 1.06), screenMaterial);
    screen.position.set(x - 0.5, DESK_TOP + 0.68, z + 2.2);
    screen.rotation.y = Math.PI; // faces −z, into the approach
    this.group.add(screen);
    this.screenLight = new PointLight('#9be8ff', 0, 6, 2);
    this.screenLight.position.set(x - 0.5, DESK_TOP + 0.7, z + 1.4);
    this.group.add(this.screenLight);
    this.disposables.push(screen.geometry, screenMaterial);
  }

  update(t: number, time: number): void {
    if (!this.group.visible) return;
    this.edgeLightMaterial.emissiveIntensity = 1.4 + Math.sin(time * 1.6) * 0.4;

    // the rabbit: one bright pulse racing toward the threshold, looping
    const sweep = (time * 1.4) % 1;
    for (let i = 0; i < this.rabbitMaterials.length; i++) {
      const pos = 1 - i / this.rabbitMaterials.length; // far → near
      const d = Math.abs(sweep - pos);
      this.rabbitMaterials[i]!.emissiveIntensity = Math.max(0, 1 - d * 9) * 5;
    }

    this.windsock.rotation.y = Math.sin(time * 0.7) * 0.4;

    // the mail lands: the screen wakes as the dart reaches it, then holds
    const arrive = MathUtils.smoothstep(t, 0.978, 0.995);
    const ping = arrive * (1 + Math.sin(time * 3.4) * 0.14);
    this.screenMaterial.emissiveIntensity = 0.12 + ping * 2.3;
    this.screenLight.intensity = ping * 3.5;

    // the printed reply slides out of the tray once the mail is in
    const slide = MathUtils.smoothstep(t, 0.985, 0.999);
    this.reply.position
      .copy(this.replyHome)
      .add(new Vector3(0.1 * slide, 0, -0.75 * slide));
    this.reply.rotation.z = -0.12 - slide * 0.22;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
