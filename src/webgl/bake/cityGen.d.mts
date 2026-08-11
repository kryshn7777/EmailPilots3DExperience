export const CITY_SEED: number;
export const COLS: number;
export const ROWS: number;
export const CROSS_STREET_X: number[];
export const CITY_EXTENT: { x: [number, number]; z: [number, number] };
export const ROOFTOP_BASE_Y: number;
export const ROOFTOP_DECK_Y: number;

export interface Building {
  x: number;
  z: number;
  w: number;
  h: number;
  d: number;
}

export interface KitModuleRef {
  id: string;
  [key: string]: unknown;
}

export interface CityLot {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  yaw: number;
  tint: string;
  moduleId: string;
}

export function cityLayout(canyonZ?: number): Building[];
export function cityRecipes(modules: KitModuleRef[], canyonZ?: number): { lots: CityLot[] };
export function rooftopLots(modules: KitModuleRef[]): { lots: CityLot[] };
