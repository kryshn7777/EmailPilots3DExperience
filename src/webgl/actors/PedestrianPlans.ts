import type { Vector3 } from 'three';
import { CROSS_STREET_X, HOME_CELL, HOME_CELLS, ROOFTOP_BASE_Y } from '../bake/cityGen.mjs';
import { mulberry32 } from '../util';
import type { CrowdPlan, Stand, Walk } from './Pedestrians';
import type { Quality } from '../quality';

/**
 * Where the people of the town and the night city go. Kept apart from Pedestrians.ts (which only
 * knows walkways and spots) so the layouts' numbers stay next to the layouts they describe.
 */

/** the town's sidewalks, cell-local z: verge 0.7, then 1.1 of concrete (see blender/make_ground.py) */
const SIDEWALK_IN = 0.7 + 0.55;

/**
 * The town: both sidewalks of every street the flight passes near (densely on the street it flies
 * down, thinly on the ones seen from altitude), errands up and down front walks to the door, people
 * on the porch steps and by their parked cars, and neighbours chatting at the edge of the sidewalk.
 */
export function townCrowd(
  lots: { x: number; z: number; w: number; d: number; yaw: number; moduleId: string }[],
  kinds: Map<string, string>,
  parked: { x: number; z: number; yaw: number }[],
  path: Vector3[],
  quality: Quality,
): CrowdPlan {
  const high = quality.tier === 'high';
  const rand = mulberry32(31337);
  const { w: cellW, d: cellD, lotD, street } = HOME_CELL;
  const dist = (x: number, z: number): number => {
    let best = Infinity;
    for (const c of path) {
      const d = (c.x - x) ** 2 + (c.y - ROOFTOP_BASE_Y) ** 2 + (c.z - z) ** 2;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  };
  const walks: Walk[] = [];
  const stands: Stand[] = [];
  let group = 0;

  // ---- sidewalks -------------------------------------------------------------------------------
  // "Near" is measured on the ground from the low part of the flight (the descent, the street run
  // and the start of the climb): from higher up the town is a backdrop and its people are dots.
  const low = path.filter((c) => c.y - ROOFTOP_BASE_Y < 18);
  const flat = (x: number, z: number): number => {
    let best = Infinity;
    for (const c of low) best = Math.min(best, (c.x - x) ** 2 + (c.z - z) ** 2);
    return Math.sqrt(best);
  };
  const xMin = HOME_CELLS.x[0] * cellW;
  const xMax = HOME_CELLS.x[1] * cellW;
  const mainStreet: { z: number; x0: number; x1: number; toHouses: number }[] = [];
  for (let iz = HOME_CELLS.z[0]; iz < HOME_CELLS.z[1]; iz++) {
    for (const [zc, toHouses] of [[iz * cellD + lotD + SIDEWALK_IN, -1], [iz * cellD + lotD + street - SIDEWALK_IN, 1]] as const) {
      // the stretch the flight runs along (within 6), and the stretch it passes within 26 of
      let r0 = Infinity;
      let r1 = -Infinity;
      let n0 = Infinity;
      let n1 = -Infinity;
      for (let x = xMin; x <= xMax; x += 2) {
        const d = flat(x, zc);
        if (d < 6) { r0 = Math.min(r0, x); r1 = Math.max(r1, x); }
        if (d < 26) { n0 = Math.min(n0, x); n1 = Math.max(n1, x); }
      }
      const flown = r0 <= r1;
      if (!flown && (!high || n0 > n1)) continue;
      // down the street the flight runs along, as far as the eye goes (the far end is past uFar)
      const x0 = Math.max(xMin, flown ? r0 - 24 : n0 - 4);
      const x1 = Math.min(xMax, flown ? r1 + 62 : n1 + 4);
      walks.push({
        points: [[x0, zc], [x1, zc]], width: 1.0, ends: 'wrap',
        count: Math.round((x1 - x0) / (flown ? (high ? 2.8 : 6) : 9)),
        joggers: 0.07, dogs: 0.1, pairs: 0.16,
      });
      if (flown) mainStreet.push({ z: zc, x0, x1, toHouses });
    }
  }

  // ---- front walks, porches and driveways ------------------------------------------------------
  const errandReach = high ? 20 : 12;
  for (const lot of lots) {
    if (kinds.get(lot.moduleId) !== 'house') continue;
    const d = dist(lot.x, lot.z);
    if (d > errandReach + 6) continue;
    const toStreet = Math.cos(lot.yaw) > 0 ? 1 : -1;
    const iz = Math.floor(lot.z / cellD);
    const front = toStreet > 0 ? iz * cellD + lotD : iz * cellD + lotD + street;
    // the front of the house (its porch steps), and the end of the walk the ground cell paints
    const vF = (front - lot.z) * toStreet - lot.d / 2;
    const v = Math.min(Math.max(Math.min(2.6, vF) - 0.32, 0.4), 2.6);
    const zDoor = front - toStreet * v;
    const zSide = front + toStreet * SIDEWALK_IN;
    const roll = rand();
    if (d < errandReach && roll < (high ? 0.3 : 0.18)) {
      // along the sidewalk's house side, up the walk to the door, a while there, and back
      const side = rand() < 0.5 ? -1 : 1;
      const zLane = zSide - toStreet * 0.22;
      walks.push({
        points: [[lot.x + side * 2.6, zLane], [lot.x, zLane], [lot.x, zDoor]], width: 0.8, ends: 'turn',
        pause: [2, 9], count: 1, dogs: 0.18, round: 0.45,
      });
    } else if (d < errandReach + 2 && roll < (high ? 0.42 : 0.24)) {
      // on the porch steps: looking out at the street, on the phone, or two talking
      const out = toStreet > 0 ? -Math.PI / 2 : Math.PI / 2;
      if (rand() < 0.35) {
        group++;
        stands.push({ x: lot.x - 0.21, z: zDoor, yaw: 0, mood: 'chat', group });
        stands.push({ x: lot.x + 0.21, z: zDoor, yaw: Math.PI, mood: 'chat', group });
      } else {
        stands.push({ x: lot.x + (rand() - 0.5) * 0.3, z: zDoor, yaw: out + (rand() - 0.5) * 0.6, mood: rand() < 0.3 ? 'phone' : 'idle' });
      }
    }
  }
  const driveReach = high ? 24 : 0;
  for (const car of parked) {
    if (rand() > 0.22 || dist(car.x, car.z) > driveReach) continue;
    // the lot it is parked on decides which way is the street
    const lot = lots.find((l) => Math.abs(l.x - car.x) < 3.6 && Math.abs(l.z - car.z) < 4.5 && kinds.get(l.moduleId) === 'house');
    if (!lot) continue;
    const toStreet = Math.cos(lot.yaw) > 0 ? 1 : -1;
    const iz = Math.floor(lot.z / cellD);
    const front = toStreet > 0 ? iz * cellD + lotD : iz * cellD + lotD + street;
    const z = car.z + toStreet * 1.06;
    if ((front - z) * toStreet < 0.25) continue;     // no room between the car and the sidewalk
    // at the car's street end, facing it (just home, or about to leave)
    stands.push({ x: car.x + (rand() - 0.5) * 0.15, z, yaw: toStreet * Math.PI / 2 + (rand() - 0.5) * 0.5, mood: rand() < 0.4 ? 'phone' : 'idle' });
  }

  // ---- neighbours chatting at the house edge of the sidewalk on the flown street ------------------
  // (between two front walks, which sit on the lot centres, so nobody's way home is blocked)
  const { lotW } = HOME_CELL;
  for (const s of mainStreet) {
    const n = high ? 5 : 2;
    const taken: number[] = [];
    for (let i = 0; i < n; i++) {
      const x1 = 14 + rand() * 34;
      const cell = Math.floor(x1 / cellW) * cellW;
      const x = cell + Math.min(Math.round((x1 - cell) / lotW), 4) * lotW + (rand() - 0.5) * 1.2 - 0.21;
      if (x < s.x0 + 2 || x > s.x1 - 2 || taken.some((t) => Math.abs(t - x) < 1.6)) continue;
      taken.push(x);
      const z = s.z + s.toHouses * 0.33;
      group++;
      stands.push({ x, z, yaw: 0, mood: 'chat', group });
      stands.push({ x: x + 0.42, z, yaw: Math.PI, mood: 'chat', group });
      if (rand() < 0.35) {
        // a third, half a step back on the lawn
        stands.push({ x: x + 0.21, z: z + s.toHouses * 0.36, yaw: s.toHouses * Math.PI / 2, mood: 'chat', group });
      }
    }
  }
  return { walks, stands, look: 'day', far: high ? 75 : 45, seed: 2207 };
}

/** the canyon: road |z| < 2.3, building faces no nearer than 2.75 (see CityStreet) */
const CURB = 2.3;
const FACE = 2.75;
const CROSS_HALF = 1.3;
/** the two lanes of a canyon pavement: by the kerb, and by the buildings */
const KERB_LANE = CURB + 0.11;
const WALL_LANE = FACE - 0.15;
/** the signals' cycle (CityStreet.update): the canyon has green for the first 7 of every 14 s */
const canyonGreen = (time: number): boolean => time % 14 < 4.6;

/**
 * The night city. Its pavements are narrow (0.45 between the kerb and the nearest walls, a metre
 * at the city's scale), too narrow for people to pass each other head-on, so each is two one-way
 * lanes, everyone keeping right: on the north side (z > 0) eastbound walkers keep to the walls and
 * westbound ones to the kerb, mirrored on the south side. They wait at the kerb of every cross
 * street until the canyon has the green, then cross its mouth. Others come round the corners from
 * the cross streets and join the lane going their way, and the plazas have strollers and little
 * groups. Drawn at 1.35x, like the city's cars.
 */
export function cityCrowd(
  plazas: { x0: number; x1: number; z0: number; z1: number }[],
  quality: Quality,
): CrowdPlan {
  const high = quality.tier === 'high';
  const k = 1.35;
  const rand = mulberry32(7741);
  const walks: Walk[] = [];
  const stands: Stand[] = [];
  const x0 = -36;
  const x1 = 52;
  // keeping right: heading +x a walker's right is +z
  const lane = (side: number, dir: 1 | -1): number => side * (side * dir > 0 ? WALL_LANE : KERB_LANE);

  // the canyon pavements, end to end
  for (const side of [1, -1]) {
    for (const dir of [1, -1] as const) {
      const z = lane(side, dir);
      const gates = CROSS_STREET_X.filter((sx) => sx > x0 + 2 && sx < x1 - 2).map((sx) => ({
        s0: sx - CROSS_HALF - 0.05 - x0, s1: sx + CROSS_HALF + 0.05 - x0, open: canyonGreen,
      }));
      walks.push({
        points: [[x0, z], [x1, z]], width: 0.22, ends: 'wrap', dir, gates,
        count: Math.round((x1 - x0) / (high ? 4.4 : 10)),
      });
    }
  }
  // round the corners: down a cross street's pavement, along the block in the lane going that way,
  // up the next cross street (north side eastbound, south side westbound, so every cross-street
  // pavement is one-way too)
  const blocks = CROSS_STREET_X.filter((sx) => sx > -30 && sx < 30);
  for (const a of blocks) {
    const b = CROSS_STREET_X.find((sx) => sx > a);
    if (b === undefined) continue;
    const xa = a + CROSS_HALF + 0.16;
    const xb = b - CROSS_HALF - 0.16;
    const north = lane(1, 1);
    const south = lane(-1, -1);
    walks.push({
      points: [[xa, 11], [xa, north], [xb, north], [xb, 11]], width: 0.22, ends: 'wrap', dir: 1,
      count: high ? 3 : 1, round: 0.3,
    });
    walks.push({
      points: [[xb, -11], [xb, south], [xa, south], [xa, -11]], width: 0.22, ends: 'wrap', dir: 1,
      count: high ? 3 : 1, round: 0.3,
    });
  }
  // plazas: a stroll along the back, little groups between the trees
  let group = 100;
  for (const p of plazas) {
    const side = p.z0 + p.z1 > 0 ? 1 : -1;
    const depth = p.z1 - p.z0;
    const len = p.x1 - p.x0;
    if (p.x1 < x0 || p.x0 > x1) continue;
    const back = side * (FACE + depth - 0.42);
    const stroll = depth >= 2.3 && len >= 3;
    if (stroll) {
      const n = high ? Math.max(1, Math.floor(len / 3.5)) : len > 6 ? 1 : 0;
      if (n) walks.push({ points: [[p.x0 + 0.4, back], [p.x1 - 0.4, back]], width: 0.5, ends: 'turn', pause: [1, 6], count: n });
    }
    if (depth < 1.8 || (stroll && depth < 2.9)) continue;
    // CityStreet plants a row of trees down the middle; stand between them, a little behind the row
    const w = len - 0.3;
    const trees = Math.max(1, Math.floor(w / 2.1));
    const gz = side * (FACE + depth * 0.5 + 0.55);
    for (let i = 1; i < trees; i++) {
      if (rand() > (high ? 0.55 : 0.2)) continue;
      const gx = p.x0 + 0.15 + (i / trees) * w;
      const n = rand() < 0.6 ? 2 : 3;
      group++;
      for (let j = 0; j < n; j++) {
        const a = (j / n) * Math.PI * 2 + rand() * 0.4;
        const r = 0.24 * k;
        // face the middle of the group
        stands.push({
          x: gx + Math.cos(a) * r, z: gz + Math.sin(a) * r, yaw: Math.atan2(Math.sin(a), -Math.cos(a)),
          mood: rand() < 0.15 ? 'phone' : 'chat', group,
        });
      }
    }
  }
  return { walks, stands, look: 'night', scale: k, far: high ? 55 : 35, seed: 6151 };
}
