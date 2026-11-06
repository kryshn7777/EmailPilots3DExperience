export const PATH_POINTS: [number, number, number][];
export const CH_START_INDEX: number[];
/** [control-point index, story-t, smooth mode?] */
export const PATH_KNOTS: [number, number, ('left' | 'right' | 'mean')?][];
export const DETOUR_TIMING: { T_S: number; D_T: number; cutIn: number; cutOut: number };
export const DETOUR_TOWER: { x: number; z: number; hx: number; hz: number; h: number; entryY: number };
export const HANDOFF: { t: number; p: [number, number, number]; tangent: [number, number, number] };
export const LINE: Record<string, number>;
export const CITY_LINE: {
  points: [number, number, number][];
  canyonEnd: number;
  canyonEndT: number;
  west: number;
  east: number;
  handoff: number;
  climbPitch: number;
  towerYaw: number;
  straightFrom: number;
  straightTo: number;
  crest: [number, number];
};
export const BEACON_ANCHOR: [number, number, number];
export const LANTERN: [number, number, number];
export const PANEL_ANCHOR: [number, number, number];
export const CITY_ANCHOR: [number, number, number];
export const COPILOT_ANCHOR: [number, number, number];
