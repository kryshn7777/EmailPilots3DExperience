# The ending: the communications tower, then the laptop

CH10 (story-t 0.88 to 1.0). The dart comes down out of the cloud onto a dawn runway that points straight at a
communications tower, runs low along it with the approach lights racing ahead, dives into the relay hall at the
tower's foot, rides a glass relay tube up the tower's core as a streak of light (the cabins flash as it passes and
the six drum dishes snap round one by one), bursts out of the main dish into the sunrise, arcs over and dives through
the one open window of a small house, into the recipient's laptop: EMAIL RECEIVED, the message opens, and Cara's
reply is typed and sent. One smooth line: every bend is in the vertical plane and the heading never changes.

There is no shed, hangar, apron, taxi or door in it any more.

## The line (`src/webgl/rig/endingPoints.mjs`)

`pathPoints.mjs` appends `ENDING_POINTS` after the copilot chapter's points; `CH_START_INDEX[9]` is its first point,
the hand-off H = (250, 19, -3.5) on the tangent (0.883, -0.469, 0) (direction §4.2). The line is authored as straight
runs and circular arcs in the plane z = -3.5 (the runway's centreline), then sampled into control points for the
centripetal Catmull-Rom (a point every 2.5 degrees on the radius-12/14 arcs, every 2 degrees on the radius-3 tube
bends, straights ramping 1.3x from the arcs' step up to 2 units), so the spline holds the arcs to 1% and eases into
each over half a unit.

| piece | geometry | story-t |
| :-- | :-- | :-- |
| descent | on the copilot's -28 degree line from H | 0.880 |
| round-out | one arc, radius 14, onto the runway low pass at y 1.6 | 0.900 |
| low pass | 47.5 straight along the runway, the rabbit strobing ahead toward the tower | 0.906 |
| intake | the bell-mouth's throat in the relay hall; one quarter arc, radius 3, up | 0.937 |
| tube | straight up the glass relay tube (leaning 1 degree forward, so the heading is defined) to y 21.6 | 0.940 to 0.951 |
| feed | one arc, radius 3, into the main dish's feed: out along its boresight, +35 degrees | 0.9525 |
| crest | one arc, radius 12, over the top (pitch 0 at 0.958) and into the dive | 0.953 to 0.965 |
| dive | straight, -52 degrees, at the house | 0.965 to 0.979 |
| flare | one arc, radius 12, to level at the screen's height (1.233) | 0.979 to 0.986 |
| window | through the open window (x 378.6) | 0.987 |
| screen | into the laptop's screen (382.0, 1.233, -3.5) | 0.9895 |
| tail | straight on behind the screen to t = 1 (the dart is in the laptop) | |

`ENDING_BEATS` exports that timetable (computed from the same arc lengths), `TUBE` the tube's path, `TOWER` the
tower's footprint centre (336.67, 0, -3.5), `HOUSE` the window wall and the screen, `LANDING_ANCHOR` (270, 0.5, -3.5).

**Why the tower stands at x 336.7 and the house at 378.6, not the direction's 286 and 306.** Inside a chapter the
dart's speed is constant (FlightPath maps story-t linearly to arc length), so the beats' times are fixed by lengths.
The shot list wants the dart in the tube at 0.945, out of the dish by 0.962 and in the screen by 0.990; the tube is
about 25 long and the way down from the crest to the window, with radius-12 arcs, at least about 50. That only fits if
the approach (H to the intake) is about 90 long: a 47-unit runway low pass. With the tower at 286 the dart would be
out of the dish by 0.941 and the house would have to be 25 units further on anyway (a radius-12 dive cannot drop 27 in
the 11 units between 293 and 304). The line is 186 units over 0.12 of story-t (1552 per unit t; the old ending was 56,
about 470). See "Integration" for what the pace warp needs.

## Checks (`scripts/check-ending.mjs`)

`node --experimental-transform-types scripts/check-ending.mjs` builds the real spline (pathPoints; if the copilot's
last point is not on H's tangent yet it says so and uses a stand-in on the tangent) and asserts: H and its tangent;
yaw 0 +-2 degrees and z = -3.5 throughout (every bend vertical); exactly five bends, each one sign and one constant
radius (radius >= 3 at the tube, >= 12 elsewhere; 10% tolerance for the C1 spline's ease at the joints); x never
decreasing until the window; the dart's body (0.75 either side, 0.3 down) never inside the tower or the house except
in the tube and through the window opening (solids from the two models' manifests: legs and braces as capsules,
cabins, hall, gallery, drums, the main dish, the walls, the flower box, the shutters, the desk, the pendants); the
ending camera (16:9 and 390x800, every 1e-4 of t) never through a lattice member, a cabin, the hall, the gallery, a
dish or a wall (into the house only through the window) and never below y 0.4; and the beats (in the tube's straight
at 0.945, just out of the dish at 0.962, in the screen at 0.9895, `ENDING_BEATS` within 0.35 of the spline).

## The models

`blender/make_comm_tower.py` (procedural; the tube's path is read from `endingPoints.mjs`, so model and line cannot
drift apart) writes `public/models/comm-tower/`: `tower.glb` (HIGH), `tower-lean.glb` (LOW), the atlas
(`tower-color/-emissive/-orm.webp` 2048 for HIGH, `tower-lean-color/-emissive.webp` 1024 for LOW, painted in the
script: zinc spangle and white-rust runs, chalky aviation paint, concrete, ribbed cladding, lit windows, rack LEDs,
radome fabric, dish panels), `manifest.json` (parts and their triangles, pivots, the line's tower-local path, the
solids check-ending tests) and `CREDITS.md`. `--render DIR` writes a Cycles preview sheet of both tiers.

The tower: a 4-leg tapered lattice, 9 wide at the foot and 3 at the top of the steel (24), round legs with bolted
flanges and angle-iron X-bracing with gussets and redundant members (HIGH), plan bracing, red/white aviation banding
on the top third, concrete footings on a gravel pad; the glass relay hall at the foot (mullions, a steel infill with a
round hole for the bell, two rows of racks with LED fronts, overhead trays); three equipment cabins (8.4, 15.3, 20.7)
with lit window bands, louvres and AC units and a catwalk round the lowest; the gallery (21.4) with grating, railings
and six drum dishes on yaw pivots; the main dish (radius 2.35) on top, its vertex at the tube's feed, aimed +x and 35
degrees up, on a yoke with a strut ring round a collar; a red/white mast to 30.6 behind it with a lightning rod; panel
antennas; a caged ladder up the south face and a cable ladder-tray with three cables up the north face; four red
beacons. Down the core, the glass relay tube (radius 1) from a bell-mouth (lip radius 1.42, flaring 2.3 west of the
throat) at the dart's height through one radius-3 bend, up the core and through one radius-3 bend into the dish.

| tier | triangles | draws in the engine |
| :-- | --: | :-- |
| HIGH `tower.glb` | 30.5k | 3: steel (atlas), tube, hall glass |
| LOW `tower-lean.glb` | 5.6k | 2: steel (atlas), glass (tube and hall) |

Named nodes: `tower_root`, `lattice`, `cabin_glow_1..3`, `rack_glow`, `intake_glow`, `beacon_1..4`, `dish_main` and
`dish_1..6` (pivot Empties, each with a `<name>_mesh` child), `tube` (uv.y = arc fraction, throat 0 to feed 1),
`hall_glass`, `intake` and `tube_top` (Empties). `CommTower.ts` merges them by material and keeps each part's id per
vertex (`aGroup`): the vertex shader turns the drums about their poles and nods the main dish about its feed, the
fragment shader scales each part's emissive (cabins, beacons, racks, intake, feed). The shadow pass gets the same
vertex patch (HIGH: the steel is the one new shadow caster).

`blender/make_recipient_room.py` writes `public/models/recipient-room/`: the house shell only (the room inside is
the engine's): a gabled house, its gable to the tower, lap siding (stepped boards on HIGH), white trim and corner
boards, a fieldstone band, a shingle roof with a ridge cap, barge boards, gutters and a downpipe, a brick chimney, a
lit attic window, lit windows in both side walls, shrubs, and in the gable wall the one tall OPEN window (no glass;
sill 0.9, 2.4 x 1.6, centred on the line) with its shutters folded back, a flower box under it and a porch lantern
beside it. No door. HIGH 4.6k triangles, LOW 0.6k, one draw each (`house-color/-emissive.webp` 1024, LOW 512).

`npm run compress:models` (the two folders are in `scripts/compress-models.mjs`, 14-bit UVs, 10-bit normals).

## The actors

- `actors/Landing.ts`: the meadow (out to the haze), the runway (70 long, 262 to 332) with its edge lights,
  threshold bars, PAPI and the rabbit (all instanced: three draws), the parallel taxiway with an airliner holding
  short (a scale cue, 15 off the line), the windsock, tree lines along the field's edges, copses and a garden round
  the house (one instanced draw, no shadows, none in the line's corridor or on the camera's paths); mounts
  `CommTower` and `RecipientRoom` as children. No real-time lights. The departing jet, the control tower, the hangar,
  the apron and the arrival office's shell are gone.
- `actors/CommTower.ts`: the tower (see above); everything keyed to `ENDING_BEATS`: the intake flash (hall glass,
  racks, the bell's throat ring), the streak (a bright head where the dart is, a trail, an afterglow; idle traffic
  pulses before), the cabins flashing as the light passes and staying lit, the drums snapping round to +x one by one
  (ease-out-back), the main dish lifting onto its 35 degrees just before the dart arrives, the beacons blinking, the
  pop (flecks out along the boresight and a flare at the feed, pure in t).
- `actors/RecipientRoom.ts`: the house shell and the old arrival office's interior, re-laid (the desk stands in the
  room facing the window, the chair pulled back and turned aside, the bookcase on the north wall, pictures and the
  clock on the back wall, the beanbag in the corner, the plant) and batched by material. The laptop's screen waits,
  wakes as the dart comes through the window, reads EMAIL RECEIVED at `RECEIVED_T` (0.990), opens the message
  (0.9935) and types Cara's reply (0.995 to 0.9985), then shows it sent. HIGH: a desk lamp, a ceiling bounce and the
  screen's spill (point lights, made at construction so the light count never changes mid-flight); LOW: no lights,
  the warmth is emissive. The room is drawn only from the dive on (`ENDING_BEATS.dive`); before that a warm card
  just inside the open window stands in for it (from the runway the window is a few pixels, and the room is about
  20 draws). The potted plant (8.7k triangles) is HIGH only.
- `bake/RoomTextures.arrivalScreens(opts?)`: with no options, the original two states (the office detour's default,
  unchanged). With `{ name, subject, snippet, reply?, from?, time?, label? }`: one recipient's inbox in large type
  (it has to read on a phone): `idle`, `received` (a big EMAIL RECEIVED banner), `open`, and `reply` (typed by
  progress). Cara's copy is `CARA` in RecipientRoom.ts, from the fleet table (`story/fleet.ts`: her name and clock,
  the sender, the campaign's SAMPLE label) and §3 CH10's lines: `Hi Cara, saw you just…`, `Re: Yes, Thursday works.`,
  from `you@yourdomain.com` at 12:25, labelled `Q3 OUTREACH · SAMPLE CAMPAIGN`. Nothing else on it is text.

## The camera (`src/webgl/rig/endingShot.ts`)

`endingPose(t, aspect, out)` is pure in t (it flies the same `FlightPath` the Engine flies) and is meant to be laid
over the chase last, blended by `weight` (0 at 0.88, 1 from 0.889). Shots: a chase down the descent; the low pass,
0.6 over the dart, looking ahead and up at the tower; the camera runs on and stops short of the hall (it never moves
back) while the dart dives into the bell-mouth; then it rises with the light up the tower's north-west side, an
elevator alongside the streak that watches it climb (portrait: a tall frame, the lens at about 70 degrees), and
arrives at the main dish as the dart bursts out past its rim (the dart only ever moves away from the lens or left to
right); a wide chase
over the crest and down at the house with sky above it (the pinned title's spot) and the lit window below; down to
the window and through it behind the dart; the push into the screen, the bars opening. Phones keep a minimum
horizontal field, and the final push stands further back so the message spans the frame. Each hand-over runs over
several hundredths of a percent of t (the largest camera move per 1e-4 of t is 0.36 units); check-pace's camera
acceleration for CH10 is p95 51e-4 / max 145e-4 per px^2, high against the flight's 6.95e-4 because the line covers
12 world units per 100 px (see Integration, pace).

## Integration (other owners' files)

Already in (WP-C, merged): `CameraRig` lays `endingPose` over everything last (and `mainPose` includes it, so the
pace warp sees this camera); `chapters.ts` exports `RECEIVED_T = 0.99` (the confetti) and `UNFOLD_WINDOW = { start:
0.976, end: 0.986 }`; the copilot's line ends at H on its tangent and `CH_START_INDEX[9]` is `ENDING_POINTS[0]`.

Still wanted:

- `Engine.ts` (C): swallow the dart in the screen it reaches at 0.9895: `absorbed = smoothstep(t, 0.9855, 0.9895)`
  (today 0.982 to 0.998). Hide the contrail and the air trail once it is in (`t < RECEIVED_T` on the trail's
  condition; `airTrail.mesh.visible = false` from `RECEIVED_T`): the last stretch of the line runs straight at the
  final camera, and the trails seen end-on are a bright dot in the middle of the message on HIGH.
- `actors/Office.ts` (C's office): Lena's screen, one line: `private screens = arrivalScreens({ name: OFFICE_ROW.name,
  subject: '', snippet: 'Hi Lena, saw your team just shipped…', from: CAMPAIGN.from, time: OFFICE_ROW.clock, label:
  CAMPAIGN.name.toUpperCase() + ' · ' + CAMPAIGN.label })` (imports from `story/fleet`; the snippet is direction
  §3's office line, A may move it into `DETOUR_COPY`); the office's `idle` and `received` keys are unchanged.
- `load/Readiness.ts` (C): gate the two new model folders with the airliner's: `[/\/models\/(airliner|comm-tower|
  recipient-room)\//, 0.83]`.
- `rig/pace.ts` (C), and why `scripts/check-line.mjs` now fails two rows: the ending's line is 186 units (the stub's
  56) because the beat timetable needs it (see "Why the tower stands at x 336.7"); the warp asks pixels for it by
  its speed and normalises 0.80 to 1.0 as one block, so the copilot chapter pays: 993 px with the stub, 654 with this
  line (check-pace: landing 1546 px, about 12 world units per 100 px; the seams stay smooth, 1.02). Camera
  acceleration over 0.74 to 0.90 then fails: as shot p95 19.5e-4 (stub 6.1), the chase alone 17.9e-4 (stub 5.0).
  With this camera off it is 16.9 / 8.8, and the shortest line this geometry allows (no low pass, about 140 units)
  still fails (16.3 / 7.9), so no line meeting the beats can pass while the copilot pays for the ending's pixels.
  The fix is in the warp: give 0.88 to 1.0 its own pixels rather than the copilot's (e.g. a spacer of scroll for
  CH10 like the detour's, or a fixed normalisation point at 0.88 with the seam smoothed), or let the ending run
  faster per pixel by capping its ratio (`RATIO_MAX` about 1 for t > 0.88). The direction's dwells (the rise 0.940
  to 0.955, received 0.986 to 0.998) match this line's beats.
- `Engine.ts` (C), the fog, an observation rather than a request: the town's `leave` override (`fog.near/far`
  lerped to 12 / 70 by `smoothstep(t, 0.3, 0.335)`) never switches off, so every later chapter, the ending included,
  is held at 12..70 instead of its grade's (landing 25..200). Over the tower's crest that makes the country below one
  flat beige haze and the house at 40 units half fog. Lifting it after 0.88 (tried locally, not committed) brings the
  ground, the tree lines and the house back, but the dawn sky then washes out to cream (the haze volume seems to key
  on the same distances), so the two want tuning together in the landing grade. The ending ships, and was shot, with
  today's 12..70.
