# The fleet: one sample campaign, counted the whole way

The flight tells one sample campaign, **"Q3 Outreach"**: 42 personal emails, each to a named person,
delivered one at a time on a campaign clock (09:00 → 12:25). A 43rd import is refused by the do-not-send
list. The hero dart is **#42, Cara**: the camera's plane, the last to land, and her reply ends the story.
On screen it is always labelled **SAMPLE CAMPAIGN**: the names, roles, clock times and "0 bounces" are the
site's own hero mock-up (direction v2 §0).

The rule: **every count is something seen landing, and everything seen landing is counted.** No "Plane N"
anywhere; the tally never jumps (it used to go 11 → 42 in one frame at 0.79).

## One table, one truth: `src/story/fleet.ts`

Pure (no three, no DOM), so the HUD, the actors, the checks and the copy all read the same rows.

| export | what |
|---|---|
| `FLEET` | the 42 rows in landing order: `{ n, name, role, kind, land, clock, where, window? }` |
| `SKIPPED` | the 43rd: `old@defunct.co`, on your do-not-send list, refused at story-t 0.600 |
| `CAMPAIGN` | `{ name: 'Q3 Outreach', from: 'you@yourdomain.com', start: '09:00', cap: 50, total: 42, label: 'SAMPLE CAMPAIGN' }` |
| `HERO`, `OFFICE_ROW`, `DESK_NAMES` | Cara (#42), Lena (#32, the office), and the three names that leave the desk laptop (Amy, Ben, Cara) |
| `BOMBER`, `REPLY` | the storm's BCC bomber (0.39–0.44, strike 0.415, its stencil lines and the 550 stamp) and Hugo's reply (rise 0.326, cancel 0.329) |
| `HERO_RECEIVED_T` = 0.990 | must equal `RECEIVED_T` in `src/story/chapters.ts` (WP-C); `check-fleet` compares them once it exists |
| `delivered(t, u, landings?)` | how many have landed: **pure and monotonic** in t (and in u inside the office) |
| `clockAt`, `nextIn`, `countdown` | the campaign clock, piecewise-linear through the rows' (land, clock); the minutes to the next row |
| `CARD`, `cardAt(t, u, out, landings?)` | every word on the card, and what it shows at (t, u), written into a reused object |
| `REPORT` | the flight report's seven rows (the gap row is computed from the clocks: "3 to 9 minutes apart") |
| `CHIP_*` | the chips' labels, built once: `→ Amy`, `✓ Amy`, `Gail · 09:29`, `✓ Noor · 10:03`, `✓ Marco · café owner` |

**Runtime-chosen landings.** The scouts' lawns (#1, #2) and the phones (#24, #27) are picked at runtime
from what the camera sees; each row carries a `window` it must land inside (Amy 0.186–0.2005, Ben
0.2035–0.216, Xin 0.7175–0.7255, Arjun 0.735–0.7465), so neighbours never land within 0.0025 of each
other. The visuals pass the times they chose (`landings`, index n − 1) and the tally steps exactly on the
touchdown.

**The office row (#32, Lena)** is keyed on the detour's clock: inside the detour (`0 < u < 1`) she is
delivered from `u = 0.45`; outside it (`u = 0`) once `t > T_S`. That holds for both detour mappings (t held
at `T_S` while u runs, or t running `T_S → T_E` with `u = (t − T_S)/D_T`). The Engine passes `detourU` as
`fleet.state(t, base, aspect, u)`'s last argument (WP-C); without it Lena counts from just past `T_S`.

## The timeline

| # | t | what is seen | who draws it |
|---|---|---|---|
| 1–2 | ~0.196, ~0.206 | the scouts land on lawns in the street | `BatchSend` |
| 3–5 | 0.285, 0.292, 0.299 | the three wing mates dive off one by one; a column rises from each house | `WingPlanes` + `BatchFleet` columns |
| 6–12 | 0.312 – 0.344 | the V (risen one plane at a time, 0.262–0.302, first in first out) peels off into the town, a column per house; Hugo (#7) and Jude (#9) land on lawns | `BatchFleet` |
| — | 0.309–0.347 | Hugo's two ghost follow-ups ride his empty place; a gold "Re:" dart rises from his lawn (0.3215) and as it passes (0.329) they unfold and flutter down | `BatchFleet` (3 instances) |
| — | 0.39–0.44 | the BCC bomber lumbers out of the storm, is struck at the red gate (0.415): `550 — SPAM FLAGGED`, ~100 scraps fall into the sea | `BatchFleet` (bomber, bolt, burst) + HUD stamp |
| 13–16 | 0.462 – 0.504 | four columns on the sea horizon at an even beat; the card meter becomes `Today n/50 · daily cap` | `BatchFleet` columns |
| — | 0.518–0.574 | the beam locks onto the hero; three auth rings stamp out of the lamp: SPF ✓, DKIM ✓, DMARC ✓ | `Beacon.lockOn` + `BatchFleet` rings |
| 17–18 | 0.548, 0.561 | two darts glide onto the freighter | `BatchFleet` |
| ✕ | 0.588–0.62 | a red dart slides in, is stamped DO-NOT-SEND, unfolds and drops away | `BatchFleet` + HUD stamp |
| 19–20 | 0.630, 0.648 | columns on the skyline's roofs ahead | `BatchFleet` columns |
| 21–31 | 0.697 – 0.772 | envelopes and darts into canyon windows (each window lit teal, and left lit), the terrace, two phones | `City`, `CafeTerrace`, `BatchFleet` |
| 32 | detour u 0.45 | the envelope into the live laptop | `Office` (WP-C) |
| 33–41 | 0.806 – 0.853 | two more window darts and the skyline's window wave (a teal flare, left lit), each with a name chip; rows City cannot show (after the Engine hides the city at 0.83, or no window in frame) rise as far columns instead | `City` / `BatchFleet` |
| — | 0.855–0.885 | the flight report (41/42) | HUD |
| 42 | 0.990 | the hero: EMAIL RECEIVED; Cara replies at 0.995 | `Landing` (WP-D) |

## The card (`src/webgl/interact/BatchHud.ts`, `src/styles/fleet.css`)

Up from 0.006 to the end (storm, ocean and no-fly zone included). Desktop: `EMAIL PILOTS · Q3 OUTREACH ·
SAMPLE CAMPAIGN` and the campaign clock (then `42 cleared · 1 skipped`), the big `17/42 delivered`, a
meter with one notch per email, and the foot line. Phones: one line, `SAMPLE 17/42` and the short foot,
a hairline meter. State colours are the site's: **orange** waiting / human pace (`Waiting 4m 30s… · natural
human pacing`, `Today 13/50 · daily cap`), **green** a delivery (`✓ Amy · hiring manager · 09:02`),
**red** 550 and the skip, **gold** a reply; teal is the flight's own. Priority: a special beat (reply,
storm, beacon, skip, copilot, report, tower, end) > a fresh toast (held 0.005, a newer landing replaces it)
> the ambient line. The count pops on each step. `body.is-landing` hides the HUD under the site.

Chips (`.fleet-chip`) are pinned over the 3D: `→ name` while flying, the timetable slot `Gail · 09:29` in
the V (the next three to leave), `✓ name` for a moment after landing; ghost/cancelled, reply, bad and auth
modes for the beats. Stamps (`.fleet-stamp`) slam over the bomber (550) and the 43rd (DO-NOT-SEND).

## Cost

All of it is in `BatchFleet.group` (no Engine edit outside its fences, except that `BatchFleet` is handed
`WingPlanes`). One InstancedMesh for every dart (16 instances: the V, freighter, terrace, phones, two
ghosts, the reply, the skip; unfolding, screen-door ghosting and the gold/red glow are a per-instance
attribute in one patched material), one for the 42 light columns, one for the rings; the bomber, its bolt
and its burst only between 0.39 and 0.44; on HIGH one LineSegments of contrails, and the columns join the
sea's planar reflection. City's five envelopes and five window darts are two InstancedMeshes now (they were
ten meshes). No real-time lights, no shadow casters, no per-frame allocation in the paths that run every
frame (labels are built once, the HUD writes the DOM only when what it shows changes).

## Checks

`node --experimental-strip-types scripts/check-fleet.mjs`: 42 rows; `delivered` monotonic at 1e-4 over
[0, 1] (nominal, and with the runtime windows at their edges); across the office under both mappings; the
direction's values (0.19 → 0, 0.21 → 2, 0.35 → 12, 0.51 → 16, 0.57 → 18, 0.66 → 20, 0.78 → 31, after the
office → 32, 0.86 → 41, 0.995 → 42); never +2 within 0.002; every row's kind is drawn by something; the
clock runs forward; a frame-by-frame card scrub 0.18 → 1.0 never goes back or jumps; the phone foot fits
one line; the honesty greps (SAMPLE CAMPAIGN on the report, no "Plane N", none of the banned phrases).
