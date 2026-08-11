import {
  AdditiveBlending,
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
} from 'three';
import { ROOFTOP_BASE_Y, ROOFTOP_DECK_Y, rooftopLots } from '../bake/cityGen.mjs';
import { cityGridTexture, cloudDeckTexture, glowTexture } from '../bake/CanvasTextures';
import { KitCity, type KitLot, type KitRingSet } from './KitCity';
import { asset } from '../asset';
import type { Quality } from '../quality';

/**
 * CH2–3: the district outside the study window. The study is a high floor of
 * an office tower, so this is neighbouring towers seen at altitude, standing
 * in an overcast deck that hides every base — there is no ground in this
 * chapter, only weather. Buildings are kit-instanced on the shared baked LOD
 * rings (near field = real modules, far district = emissive impostors).
 */
export class Rooftops {
  readonly group = new Group();
  private kitCity: KitCity | null = null;
  private deck: Mesh[] = [];
  private disposables: { dispose(): void }[] = [];

  constructor(rand: () => number, quality: Quality) {
    // the city floor: streets, blocks and traffic, far below the window
    const gridMap = cityGridTexture();
    gridMap.repeat.set(22, 18);
    const groundMaterial = new MeshStandardMaterial({
      map: gridMap,
      roughness: 0.82,
      metalness: 0.05,
      emissive: '#20293f',
      emissiveMap: gridMap,
      emissiveIntensity: 0.55, // street light and traffic read at altitude
    });
    const ground = new Mesh(new PlaneGeometry(900, 700), groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(60, ROOFTOP_BASE_Y + 0.05, 0);
    this.group.add(ground);
    this.disposables.push(ground.geometry, groundMaterial, gridMap);

    // two offset cloud sheets drifting over it — broken, not a lid, so the
    // grid below stays readable through the gaps
    const deckMap = cloudDeckTexture();
    this.disposables.push(deckMap);
    // repeat counts are high on purpose: the sheets are 900 units across, and
    // at the old 4.5–7 a single cloud tile smeared over most of the frame as
    // soon as the flight climbed — giant marbled slabs, not weather
    for (const [y, repeat, opacity, scale] of [
      [ROOFTOP_DECK_Y - 3.5, 20, 0.62, 1],
      [ROOFTOP_DECK_Y, 13, 0.5, 0.82],
    ] as const) {
      const material = new MeshBasicMaterial({
        map: deckMap,
        transparent: true,
        opacity,
        depthWrite: false,
        side: DoubleSide,
        fog: true,
      });
      material.map = deckMap.clone();
      material.map.needsUpdate = true;
      material.map.repeat.set(repeat, repeat);
      const sheet = new Mesh(new PlaneGeometry(900 * scale, 760 * scale), material);
      sheet.rotation.x = -Math.PI / 2;
      sheet.position.set(60, y, 0);
      sheet.renderOrder = -2; // always behind the towers standing in it
      this.group.add(sheet);
      this.deck.push(sheet);
      this.disposables.push(sheet.geometry, material, material.map);
    }

    // aircraft-warning reds and lit crowns scattered across the district
    const warm: number[] = [];
    for (let i = 0; i < 130; i++) {
      warm.push(11 + rand() * 70, ROOFTOP_BASE_Y + 12 + rand() * 26, -40 + rand() * 80);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(warm, 3));
    const lights = new Points(
      g,
      new PointsMaterial({
        map: glowTexture(),
        color: '#ffc98a',
        size: 0.5,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        blending: AdditiveBlending,
        sizeAttenuation: true,
      }),
    );
    lights.frustumCulled = false;
    this.group.add(lights);
    this.disposables.push(g, lights.material as PointsMaterial);

    void this.init(quality);
  }

  /** Drifts the two sheets against each other — the deck is never static. */
  update(time: number): void {
    if (!this.group.visible) return;
    for (let i = 0; i < this.deck.length; i++) {
      const map = (this.deck[i]!.material as MeshBasicMaterial).map;
      if (map) map.offset.x = time * (i === 0 ? 0.0016 : 0.0029);
    }
  }

  private async init(quality: Quality): Promise<void> {
    // no-cache: lots and rings MUST come from the same bake — a stale cached
    // rings file indexes past the end of a freshly generated lot list
    const [manifest, allRings] = await Promise.all([
      fetch(asset('/models/city-kit/manifest.json'), { cache: 'no-cache' }).then((r) => r.json()),
      fetch(asset('/models/city-rings.json'), { cache: 'no-cache' }).then((r) => r.json()),
    ]);
    const rings = allRings.rooftops[quality.tier] as KitRingSet;
    const { lots } = rooftopLots(manifest.modules);
    // dressWindows: unlike City this actor has no dressing pass of its own,
    // so its blocks read as unlit massing through the study window
    // glow 1.5: this district sits 20–100 units out in a chapter whose fog is
    // tuned for a dark room, which crushed every tower to a black cut-out
    this.kitCity = new KitCity(lots as KitLot[], rings, manifest.modules, quality.tier, true, 1.5);
    // the district stands far below the window; only its top third clears
    // the deck, so no tower ever shows a base
    this.kitCity.group.position.y = ROOFTOP_BASE_Y;
    this.group.add(this.kitCity.group);
  }

  dispose(): void {
    this.kitCity?.dispose();
    for (const d of this.disposables) d.dispose();
  }
}
