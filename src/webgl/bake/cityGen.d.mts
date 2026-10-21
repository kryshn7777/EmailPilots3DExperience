export const CITY_SEED: number;
export const COLS: number;
export const ROWS: number;
export const CROSS_STREET_X: number[];
export const CITY_EXTENT: { x: [number, number]; z: [number, number] };
export const ROOFTOP_BASE_Y: number;
export const ROOFTOP_DECK_Y: number;
export const HOME_CELL: {
  w: number; d: number; lotW: number; lots: number; lotD: number; street: number; cross: number;
};
export const HOME_CELLS: { x: [number, number]; z: [number, number] };

export interface Building {
  x: number;
  z: number;
  w: number;
  h: number;
  d: number;
}

export interface KitModuleRef {
  id: string;
  kind?: string;
  /** set on a hero/detail replacement: the lean module it stands in for (never a lot's own module) */
  lean?: string;
  footprint: [number, number];
  height: number;
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
  /** a verge tree: never given the close-up tier */
  street?: boolean;
  /** a woodland tree beyond the town: a far-ring stand-in only */
  forest?: boolean;
}

export function cityLayout(canyonZ?: number): Building[];
export function cityRecipes(modules: KitModuleRef[], canyonZ?: number): { lots: CityLot[] };
export function homeLots(modules: KitModuleRef[]): { lots: CityLot[] };

export type FenceStyle = 'picket' | 'privacy' | 'rail';
export interface FenceRun {
  x0: number; z0: number; x1: number; z1: number;
  style: FenceStyle; kind: 'side' | 'rear' | 'front';
}
export const FENCE_STYLES: FenceStyle[];
export function fenceRuns(): FenceRun[];
