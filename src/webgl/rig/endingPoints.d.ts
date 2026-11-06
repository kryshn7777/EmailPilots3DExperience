type V3 = [number, number, number];

export const ENDING_POINTS: V3[];
export const LANDING_ANCHOR: V3;
/** the line's length from H to its last point (world units) */
export const ENDING_LENGTH: number;
/** the runway low pass's height, the main dish's boresight (radians), the desk top and the screen centre's height */
export const LOW_Y: number;
export const EXIT_PITCH: number;
export const DESK_TOP: number;
export const SCREEN_Y: number;
/** the ending's timetable (story-t), from the line's own arc lengths */
export const ENDING_BEATS: {
  lowPass: number;
  intake: number;
  tube: number;
  tubeTop: number;
  exit: number;
  crest: number;
  dive: number;
  flare: number;
  window: number;
  screen: number;
};
/** the relay tube's path through the tower (world): the bell-mouth's throat, the straight's foot and top, the feed */
export const TUBE: { mouth: V3; foot: V3; top: V3; exit: V3; radius: number; lean: number; exitPitch: number };
/** the communications tower's footprint centre (the tube's axis on the ground) */
export const TOWER: V3;
/** the recipient's house: the window wall's x, the laptop screen's centre, the line's height through the window */
export const HOUSE: { windowX: number; screen: V3; lineY: number };
