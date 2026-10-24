import {
  Color,
  DoubleSide,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Texture,
  Vector2,
} from 'three';
import { leatherMaps, plasterMaps, woodMaps, type SurfaceMaps } from '../bake/RoomTextures';
import { herringboneMaps, studyBookAtlas, studyRugMaps, drapeMaps } from '../bake/StudyTextures';
import { propAtlas } from '../bake/StudyPropTextures';

export type Dispose = { dispose(): void };
export type StudyTier = 'high' | 'low';

/**
 * Every material the study's furniture, architecture and props share, so that however many hundred
 * parts the Kit bakes, a material is one draw. Textures are drawn here, once.
 */
export function studyMaterials(tier: StudyTier, own: Dispose[]) {
  const high = tier === 'high';
  const keep = <T extends Dispose>(x: T): T => { own.push(x); return x; };
  const keepMaps = (m: SurfaceMaps): void => { own.push(m.map, m.normalMap); if (m.roughnessMap) own.push(m.roughnessMap); };

  // walnut: carcass wood and a lacquered top border (the same drawing, different finish)
  const walnutMaps = woodMaps({ boards: 3, base: [128, 82, 52], seed: 21, joints: 1, gap: 0.8, roughness: 0.4, normal: 1.4 });
  keepMaps(walnutMaps);
  const walnut = keep(new MeshStandardMaterial({
    map: walnutMaps.map, normalMap: walnutMaps.normalMap, roughnessMap: walnutMaps.roughnessMap, roughness: 1, color: '#c4a88c', envMapIntensity: 0.9,
  }));
  const walnutLacquer = keep(new MeshPhysicalMaterial({
    map: walnutMaps.map, normalMap: walnutMaps.normalMap, roughnessMap: walnutMaps.roughnessMap, roughness: 1,
    clearcoat: high ? 0.6 : 0, clearcoatRoughness: 0.2, envMapIntensity: 1.1,
  }));
  // a lighter, redder wood for drawer fronts and shelves, so the carcass reads as joinery
  const shelfMaps = woodMaps({ boards: 2, base: [122, 84, 56], seed: 33, roughness: 0.46, normal: 1.6 });
  keepMaps(shelfMaps);
  const shelfWood = keep(new MeshStandardMaterial({
    map: shelfMaps.map, normalMap: shelfMaps.normalMap, roughnessMap: shelfMaps.roughnessMap, roughness: 1, color: '#a8927c',
  }));

  const leatherSet = leatherMaps([34, 74, 54], 41, 512);
  keepMaps(leatherSet);
  const leather = keep(new MeshStandardMaterial({
    map: leatherSet.map, normalMap: leatherSet.normalMap, roughnessMap: leatherSet.roughnessMap, roughness: 1,
    normalScale: new Vector2(0.9, 0.9), envMapIntensity: 0.9,
  }));
  const chairLeatherSet = leatherMaps([104, 62, 38], 31);
  keepMaps(chairLeatherSet);
  const chairLeather = keep(new MeshStandardMaterial({
    map: chairLeatherSet.map, normalMap: chairLeatherSet.normalMap, roughnessMap: chairLeatherSet.roughnessMap, roughness: 1,
    normalScale: new Vector2(0.9, 0.9),
  }));

  const brass = keep(new MeshStandardMaterial({ color: '#c09a5e', roughness: 0.3, metalness: 1, envMapIntensity: 1.2 }));
  const brassAged = keep(new MeshStandardMaterial({ color: '#8e6c3c', roughness: 0.48, metalness: 1, envMapIntensity: 1 }));
  const steel = keep(new MeshStandardMaterial({ color: '#aeb4c0', roughness: 0.22, metalness: 0.95, envMapIntensity: 1.5 }));
  const darkMetal = keep(new MeshStandardMaterial({ color: '#25272d', roughness: 0.38, metalness: 0.8, envMapIntensity: 1.2 }));
  const black = keep(new MeshStandardMaterial({ color: '#17171a', roughness: 0.34, metalness: 0.2 }));
  const rubber = keep(new MeshStandardMaterial({ color: '#1b1a19', roughness: 0.7 }));
  const ink = keep(new MeshStandardMaterial({ color: '#2a2622', roughness: 0.5 }));

  // painted woodwork: the wainscot, rails and casings (eggshell) and the window's gloss
  const paint = keep(new MeshStandardMaterial({ color: '#d9ceb4', roughness: 0.52 }));
  const gloss = keep(new MeshStandardMaterial({ color: '#e9e2cf', roughness: 0.34, envMapIntensity: 1 }));
  const plasterSet = plasterMaps([172, 184, 158], 11);
  keepMaps(plasterSet);
  const wallTile = 3.4;
  const plaster = keep(new MeshStandardMaterial({
    map: plasterSet.map, normalMap: plasterSet.normalMap, roughness: 0.93, normalScale: new Vector2(0.55, 0.55),
  }));
  const ceiling = keep(new MeshStandardMaterial({ color: '#e9e1d0', roughness: 0.95 }));

  const floorSet = herringboneMaps(3);
  keepMaps(floorSet);
  // laid on the diagonal so the zigzag runs down the room
  for (const t of [floorSet.map, floorSet.normalMap, floorSet.roughnessMap]) { t.center.set(0.5, 0.5); t.rotation = Math.PI / 4; }
  const floor = keep(new MeshStandardMaterial({
    map: floorSet.map, normalMap: floorSet.normalMap, roughnessMap: floorSet.roughnessMap, roughness: 1,
    normalScale: new Vector2(1, 1), envMapIntensity: 0.9,
  }));

  const rugSet = studyRugMaps(8);
  own.push(rugSet.map, rugSet.normalMap);
  const rug = keep(new MeshStandardMaterial({ map: rugSet.map, normalMap: rugSet.normalMap, normalScale: new Vector2(0.8, 0.8), roughness: 1 }));

  const drape = drapeMaps();
  keepMaps(drape);
  const curtain = keep(new MeshPhysicalMaterial({
    map: drape.map, normalMap: drape.normalMap, roughness: 0.9, side: DoubleSide,
    sheen: high ? 1 : 0, sheenColor: new Color('#e4a68c'), sheenRoughness: 0.45,
  }));

  const bookAtlas = studyBookAtlas();
  own.push(bookAtlas);
  const books = keep(new MeshStandardMaterial({ map: bookAtlas, roughness: 0.78 }));
  const props = propAtlas();
  own.push(props);
  const printed = keep(new MeshStandardMaterial({ map: props, roughness: 0.7 }));

  const glass = keep(new MeshStandardMaterial({
    color: '#cfe3ee', transparent: true, opacity: 0.1, roughness: 0.04, envMapIntensity: 1.6, depthWrite: false,
  }));
  glass.userData.noShadow = true;
  const enamel = keep(new MeshStandardMaterial({ color: '#27503f', roughness: 0.32, metalness: 0.35, side: DoubleSide, envMapIntensity: 1.2 }));
  const enamelInner = keep(new MeshStandardMaterial({
    color: '#f2e6c8', emissive: '#ffb865', emissiveIntensity: 0.55, roughness: 0.5, side: DoubleSide,
  }));
  const bulb = keep(new MeshStandardMaterial({ color: '#fff1d6', emissive: '#ffd49a', emissiveIntensity: 1.6 }));
  const paper = keep(new MeshStandardMaterial({ color: '#ece5d2', roughness: 0.9 }));

  return {
    high, walnut, walnutLacquer, shelfWood, leather, chairLeather, brass, brassAged, steel, darkMetal, black, rubber, ink,
    paint, gloss, plaster, ceiling, floor, rug, curtain, books, printed, glass, enamel, enamelInner, bulb, paper,
    plasterTile: wallTile,
    /** a texture handle kept for callers that want to share the walnut drawing */
    walnutMap: walnutMaps.map as Texture,
  };
}

export type StudyMats = ReturnType<typeof studyMaterials>;
