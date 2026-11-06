# The flight line: the city canyon, the IT-office tower, the copilot climb (WP-C)

From the city canyon (story-t about 0.69) to the hand-off to the ending (H, t 0.88), the dart flies ONE line:
the canyon at one height and one side, one climb out of the street, one straight through the IT-office tower (in
by its west face, out by its east face), one crest and one straight descent. It never turns back, never circles a
building and never goes round the city. The office detour is part of that line now, not a loop off it.

What it replaced: a pull-up that jinked 40 degrees left and right around the tower, and an office detour that
froze story-t, flew the dart into the tower, circled it inside the room, flew it back out of the SAME facade (a
U-turn), climbed it to y 40 over the city, swung it north, dived and joined the line where it had left it (a
360-degree loop).

## Where it is authored

| piece | file | what |
| :-- | :-- | :-- |
| the line | `src/webgl/rig/pathPoints.mjs` (`LINE`, `cityLine()`) | built from numbers that mean something: the canyon's z (0.7), where the climb leaves the street (x 197.2), its two bends (radius 6 up, 8 down), the tower straight's pitch (24 deg) and how far before the west face it starts (5), its z on the west face (-2.35), the crest's radius (25) and the straight descent into H. Height is arcs and straights in x; the sideways move toward the tower is one smooth heading ramp in x (`driftX`..`driftFull`..`driftEase`); x only grows. It is sampled into control points densely enough that the Catmull-Rom through them is that line. |
| the tower | `pathPoints.mjs` `DETOUR_TOWER` | the city lot at (217.11, -2.72), 2.9 deep, 1.94 wide, 22.9 tall; fixed offline (it used to be picked at runtime) |
| the hand-off | `pathPoints.mjs` `HANDOFF` | H = (250, 19, -3.5) at t 0.88, flying (0.883, -0.469, 0). The ending's points (`endingPoints.mjs`, docs/ending.md) start at H (the shim that led from H onto the day-0 stub is inert now) |
| the timing | `pathPoints.mjs` `PATH_KNOTS`, `rig/FlightPath.ts` | story-t at control points. Between plain knots the speed is constant (as every chapter always was); across a knot with a mode it eases (cubic Hermite in arc length). The chapter starts are knots, except the copilot's: from the end of the canyon run (x 194, t 0.72238, the old line's pace kept) the line is timed by the tower, so the dart is ON the west face at T_S + cutIn D_T and on the east face at T_S + cutOut D_T exactly, and at H at 0.88. H is a plain knot (see "The ending's scroll") |
| the detour's clock | `rig/detour.ts` | story-t runs T_S -> T_E = T_S + D_T across the detour's spacer (T_S 0.79, D_T 0.012), u = (t - T_S) / D_T |
| the office | `rig/officeShot.ts`, `actors/Office.ts`, `OfficeProps.ts`, `OfficeWalls.ts` | between the cuts: one straight, level, constant-speed crossing over the live laptop; a side-tracking dolly |
| the camera | `rig/CameraRig.ts` (`BEATS`), `story/chapters.ts` | the push to the glass, the burst watched from beside the tower, the copilot chase; the ending's own camera (`endingShot.ts`) laid on last |
| the pace | `rig/pace.ts` | one warp of scroll -> story-t over the whole flight; the office clock's pace matches the line's speed per pixel either side of the detour; the ending's own spacer goes to the ending |
| the stage | `components/Experience.astro`, `pace.ts` `HOME_STAGE` | ten chapters of 120vh, the detour's spacer (120vh) after the copilot's chapter, the ending's (240vh) after the last: 1560vh, a 1460vh scroll |

## The beats, in order

| story-t / u | what you see | camera |
| :-- | :-- | :-- |
| 0.69 - 0.73 | the canyon run at lamp height, z 0.7; from x 194 (t 0.722) the line starts drifting toward the tower side | the city chase, low, `canyon` dutch |
| 0.733 - 0.78 | one climb out of the street (up to 61 deg), the heading easing onto the tower's line (about -12 deg at most, then -3), levelling to 24 deg about 5 units before the west face, over the low block in front of the tower (roof 13.8, the line 1.5 above it) | the chase, closing in (`glass`: lag x0.82, lens x0.88, light bars) |
| 0.78 - 0.791 (u 0 - 0.08) | straight at the lit west face; the dart hits the glass at speed | the chase; white flare, cut |
| u 0.08 - 0.66 | the office: every monitor flickers red on the same `Dear all, BCC: +231` (u 0.10 - 0.135) and dies; the dart crosses the room in one straight level line at one speed (x -0.7, y 1.55 m, z 0 -> 10 m), over the one live laptop; the envelope drops out of its belly at u 0.33 and goes into the screen by 0.45; the screen flips to received at 0.47; the card `DELIVERED · Lena` 0.48 - 0.64 | a dolly beside the dart (1.05 m to its right, 1.85 m up, 1.55 m behind), looking ahead and, over the laptop, down at the screen |
| u 0.66 | the dart reaches the far window: flare, cut | |
| u 0.66 - 1 (t 0.798 - 0.802) | the dart and the glass shards burst out of the EAST face, slow at first, picking up to the line's speed by u 0.99 | `burst`: held off the tower's north side over the canyon (x 210.1, y 20.3, z 2.35), looking under 30 deg off the flight; the shards and then the dart come out past the tower's far corner |
| 0.802 - 0.866 | the same climb carries on (24 deg), the copilot docks on the far wing (from 0.806) | the held camera sets off after the dart at its speed (eased in over 0.025 t), then settles into the chase (0.814 - 0.866), which is well clear of the tower by then |
| 0.82 - 0.88 | the copilot chase | close (lag 0.011), a little high and to the canyon side (offsetSide 1.0), so a phone keeps the dart in frame |
| 0.82 - 0.86 | one crest, radius 25, top (234.4, 24.0) | |
| 0.86 - 0.88 | one straight descent at -28 deg into H | |

## The office detour's mapping

Story-t no longer stops. Across the spacer (`[data-detour]`, W of the scroll):

    p <  Ps          t = p (1 - D_T) / (1 - W)
    Ps <= p <= Pe    t = T_S + D_T u,  u = (p - Ps) / W
    p >  Pe          t = T_E + (p - Pe) (1 - D_T) / (1 - W)

with Ps = T_S (1 - W) / (1 - D_T), Pe = Ps + W. `progressOf` is its exact inverse. `scripts/check-detour.mjs`.
That is the plain map (no pace). With the pace (`rig/pace.ts`) the same map runs on the warp's linear story-t, and
the spacer sits where the warp reaches T_S, at linear story-t `gap` (`detourMap(p, W, pace.gap)`,
`pace.spacerStart(W)`): outside the detour the warp of story-t, normalised once over the whole flight but the
detour; inside it the office clock's own pace, `paceU`. Its density (pixels per unit u) is the main warp's at T_S
before the cut (so the dart keeps the line's speed per pixel right up to the glass: the run-in is a few pixels of
scroll and the cut is a hard flash), one even density through the office (about 1.33: the room is crossed at one
speed per pixel, and u never runs faster than the scroll there, so `MAX_U_RATE` keeps both flares on screen: 16
and 25 ms at the cap), and out of the far face an ease from the office's speed up to the line's at an even
acceleration per pixel (the speed's square on a smoothstep in u), so the burst is slow and then picks up.
`__engine.progressFor({ t })` and `__engine.progressFor({ u })` give the scroll for any frame (the screenshot
tools address office frames by u).

## The ending's scroll (WP-D's ending merged)

The ending's line (docs/ending.md) is 186 world units from H to the screen, against 297 for the whole flight
before it (the day-0 stub was 56), at one constant speed per unit t (its beats are keyed to that). Three things
changed here for it:

- **H is a plain timing knot.** It was `'right'` (the copilot's line arrived at H at the ending's speed per unit
  t). With the stub that was about the copilot's own speed; with this ending it is 1552 per unit t against the
  copilot's 405, and the Hermite that matches it made the dart all but stop at 0.83 (32 per unit t) and then race
  into H: the copilot chapter got 20 px for 0.01 of t, camera acceleration 122e-4 per px^2. Now the copilot flies
  at one speed and the speed per unit t steps up at H; the pace keeps the speed per pixel smooth across the step,
  and the chase measures its lag and look-ahead across H in distance at the copilot's speed
  (`CameraRig.along`), so it stays the same distance behind the dart instead of dropping back four times as far in
  a few pixels.
- **The pace is normalised over the whole flight**, not on [0, T_S] and [T_E, 1] apart (which made the ending
  take all its pixels from the copilot's chapter: 993 px with the stub, 654 with this line, and about 12 world
  units per 100 px in the ending). Centred on the flight before the ending; the ending's density may run to 4x
  today's before the clamp. The office clock is unchanged; the detour's spacer moved to `gap`.
- **The ending has its own scroll** (`[data-ending]`, 240vh, after the last chapter, inside `#experience` so the
  landing content after the flight follows straight on). The Engine measures its share like the detour's
  (`pace.setEndingShare`); the flight before 0.88 keeps the pixels it would have with the ending at its linear
  share, and the ending gets that share plus the spacer: its density times one factor, the step at 0.88 smoothed
  like the rest of the warp. No page length works without it: the ending needs about 3,300 px at a 900 px viewport
  to sit inside the flight's spread of world speed per pixel, and taking those from the chapters before it raises
  the flight's camera acceleration p95 from 6.2 to 10.7e-4 per px^2 (its limit is 7.6). Why 240vh and not 200:
  at 200 the ending runs at 6.2 world units per 100 px and the spread across chapters is 142% (limit 131%).
  Without the spacer (another page, or `check-pace --no-ending-spacer`) the pace falls back to taking the ending's
  pixels from every chapter alike.

The town's fog (12/70, held since the town left at 0.335 and under which every later chapter was shot) now opens
out to the landing grade's own (25/200) over t 0.884 - 0.93 (`DAWN_FOG` in Engine.ts), so the country, the tree
lines and the house read in the dawn instead of one flat beige haze; the sky keeps its gradient.

## The checks

`node --experimental-transform-types scripts/check-line.mjs` measures every row of the scene direction's table
(§4.2) on the line, the office shot, the camera rig and the pace, without rendering, and prints each with the
direction's limit, the limit this line is held to, and the measurement. `check-detour`, `check-pace`,
`check-spring`, `check-citygen` and `check-ending` run alongside. `check-pace` holds the flight's camera
acceleration (to 0.889) to the pre-pace baseline and reports the ending's own camera (rig/endingShot.ts, which has
the frame to itself from 0.889 and is checked by `check-ending`) apart: p95 15.3e-4, max 72.9e-4 per px^2 at the
hand-overs (0.90, 0.95, 0.96, 0.97, 0.98), well above the chase's; that is WP-D's to widen if the moves read
abrupt.

### What the direction asked and what is possible

Five of the direction's numbers cannot all hold with this tower and this H; the line takes the closest it can and
the check says so:

- **The climb (direction: <= 50 deg).** The low block in front of the tower's west face has its roof at 13.8, so
  the line must be at 15.3 or more from x 210.7. The street is at y 1.15 and the canyon run (B's deliveries pick
  their spots from it) lasts to about x 197. That is 14 up in 13.5 along, with a bend out of the street and a bend
  onto the tower's pitch: it peaks at 61 deg (bends of radius 6 and 8). Starting the climb sooner would move the
  canyon run; a lower entry would hit the block.
- **The straight (+-6 units of the tower).** It starts 5 before the west face (the climb needs the rest) and runs
  5.6 past the east face, where the crest (radius 25, worked back from H) begins; the Catmull-Rom rounds the last
  unit at each end, so it is held to < 1 deg from 4.4 before to 4.1 after.
- **The heading in the pull-up (one sign).** The canyon is at z 0.7, the tower's face spans z -3.69..-1.75 and H
  is at z -3.5: the move toward the tower has to end on the tower's line, so the heading goes out (to -12 deg) and
  back (to -3) once: one change of the turn's direction in all, total 24 deg (<= 25 holds).
- **The canyon run within 0.5 of today's to 0.745.** It is to 0.73; the climb leaves the street at t 0.733.
- **The crest at y 25-27 near x 240.** With radius 25 and H at (250, 19) flying -28 deg, the crest tops out at
  (234.4, 24.0); a higher crest would need a steeper climb into the tower.

### Numbers (before -> after)

"Before" is the line and the detour as they were (the scene direction's audit, `scratchpad/direction/tools`, and
`check-pace` on the commit before this work); "after" is `check-line` / `check-pace` on this one.

| row | before | after |
| :-- | --: | --: |
| x reversal, city -> H | the detour reversed x 215 -> 195 and looped back | none |
| the dart's heading in the office | a full circle (106 -> 177 -> -12 -> -177 -> -77 deg) | constant, 0.0 deg spread |
| the dart's speed across the office | stop, circle, turn | constant per u and per pixel (0.0%) |
| the dart off the flight line outside the office | up to about 25 units | 0 (the office owns no frame outside its cuts) |
| largest yaw rate outside the pull-up, t 0.745-0.88 | 7.1 deg/unit | 0.40 deg/unit |
| yaw rate inside the pull-up | an S-jink, up to 8.3 deg/unit, both ways twice | 5.1 deg/unit, out and back once |
| total yaw variation, the drift's start -> H | 40 deg (the jink), +86 after | 24.2 deg, one change of direction |
| pitch rate after the pull-up (the crest) | 8.6 deg/unit (86 deg pushover in 10 units) | 3.97 deg/unit (radius 25) |
| the straight through the tower | none | yaw 0.04 deg, pitch 0.21 deg over 4.4 before to 4.1 after |
| camera look heading in the city across the detour | 180 deg swings | 26 deg range, never reversed |
| copilot camera acceleration (check-pace, p95 / max) | 28.8e-4 / 136.6e-4 /px^2 | 7.3e-4 / 13.1e-4 |
| camera acceleration t 0.74-0.90, as shot (p95 / max) | - | 4.5e-4 / 11.0e-4 |
| world speed per px across city -> copilot, copilot -> landing | 1.04, 1.014 | 1.025, 1.032 |
| world speed per px across the detour's edges | (story-t stopped) | 1.002, 1.002 |

With the ending merged (`check-pace`, 900 px viewport): "WP-D's merge" is the tree as merged, "after" this work.

| | WP-D's merge | after |
| :-- | --: | --: |
| copilot chapter, px | 654 | 872 |
| ending (0.88 - 1), px / world units per 100 px (mean, max) | 1546 / about 12 | 3361 / 5.54, 7.23 |
| world speed spread across chapters (limit 131%) | 246% | 126% |
| v/h^0.6 spread (limit 158%) | - | 125% |
| flight camera acceleration p95, to 0.889 (limit 7.57e-4) | - | 7.03e-4 |
| camera acceleration t 0.74-0.90, as shot / the chase (p95, limit 6.95e-4) | 19.5e-4 / 17.3e-4 | 4.5e-4 / 4.7e-4 |
