import { BoxGeometry, Color, DoubleSide, Group, MathUtils, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, Vector3 } from 'three';
import { HOME_CELL, ROOFTOP_BASE_Y } from '../bake/cityGen.mjs';
import { BOARD_H, BOARD_W, preflightBoard, type BoardFace } from '../bake/CanvasTextures';

/** the street the dart flies down (its centre line) */
const STREET_Z = HOME_CELL.lotD + HOME_CELL.street / 2;
/**
 * Where the board stands: across the street the dart dives into, like a departures board over a gate (or a
 * gantry over a road), facing back up the street at the study window. From the window the camera holds on it
 * (0.10 to 0.12) with the board in the top half of the frame (under the fleet card on a phone) and the dart
 * diving toward it; it fades out with its title (0.142 to 0.158) while the camera looks down into the street,
 * so the takeoff run has the street to itself. Sized and set so a phone's narrow lens has all of it both in the window
 * hold (0.112, GROUNDED) and as the camera leaves the window and zooms (0.13, READY FOR TAKEOFF).
 */
const GANTRY = { x: 31, z: STREET_Z + 0.5, bottom: 0.75, yaw: -Math.PI / 2 - 0.43 };
/** the board: the old 4.4 plate x 1.5 across, a departures board's proportions */
const BOARD = { w: 6.6, h: 6.6 * (BOARD_H / BOARD_W), d: 0.3 };
const POST = 0.26;

/**
 * When the checks flip (story-t): one row each, then the verdict as the dart dives past under the board's
 * middle and the camera leaves the window (GROUNDED at 0.112, READY FOR TAKEOFF from 0.1255).
 */
const ROW_T = [0.1035, 0.108, 0.1125, 0.117, 0.1215];
const READY_T = 0.1255;
/** how long one flap takes to fall */
const FLAP = 0.0028;
/** it fades out with the pre-flight title, before the takeoff run down the street */
const GONE_FROM = 0.142;
const GONE_TO = 0.158;

/**
 * CH2: the pre-flight check as an airport departures board standing over the town (its words: story/copy.ts
 * PREFLIGHT_BOARD, drawn by CanvasTextures.preflightBoard). Its five checks flip like a split-flap display, one at a time, and its verdict flips from
 * the app's red GROUNDED to a green READY FOR TAKEOFF with a green wash over the whole board. The face is a
 * live canvas redrawn once per state (seven in all); the falling flaps are one small mesh moved row to row.
 */
export class Panel {
  readonly group = new Group();
  private face: BoardFace;
  private faceMaterial: MeshStandardMaterial;
  private flap: Mesh;
  private flapMaterial: MeshBasicMaterial;
  private state = -1;
  private fading: MeshStandardMaterial[] = [];
  private disposables: { dispose(): void }[] = [];
  private white = new Color('#ffffff');
  private green = new Color('#9dffd0');
  private red = new Color('#ffd0c8');

  /** `anchor` is the old checklist plate's spot (pathPoints PANEL_ANCHOR): the board now stands over the street */
  constructor(anchor: Vector3) {
    void anchor;
    this.group.position.set(GANTRY.x, 0, GANTRY.z);
    // facing back up the street, square to the window it is seen from
    this.group.rotation.y = GANTRY.yaw;

    this.face = preflightBoard();
    this.faceMaterial = new MeshStandardMaterial({
      map: this.face.texture,
      emissiveMap: this.face.texture,
      emissive: '#ffffff',
      emissiveIntensity: 0.9,
      roughness: 0.55,
    });
    const frame = new MeshStandardMaterial({ color: '#1b1f29', roughness: 0.5, metalness: 0.5 });
    this.fading = [this.faceMaterial, frame];
    // BoxGeometry's groups: +x, -x, +y, -y, +z (the face), -z
    const boardY = GANTRY.bottom + BOARD.h / 2;
    const board = new Mesh(new BoxGeometry(BOARD.w, BOARD.h, BOARD.d), [frame, frame, frame, frame, this.faceMaterial, frame]);
    board.position.y = boardY;
    this.group.add(board);
    this.disposables.push(board.geometry, this.faceMaterial, frame, this.face.texture);

    // the posts, standing in the front yards either side of the street, and a beam over the board
    const postLength = boardY + BOARD.h / 2 + 0.4 - ROOFTOP_BASE_Y;
    const postGeometry = new BoxGeometry(POST, postLength, POST);
    for (const lx of [-1, 1]) {
      const post = new Mesh(postGeometry, frame);
      post.position.set(lx * (BOARD.w / 2 + POST / 2 + 0.05), ROOFTOP_BASE_Y + postLength / 2, 0);
      this.group.add(post);
    }
    const beam = new Mesh(new BoxGeometry(BOARD.w + 2 * POST + 0.4, 0.3, 0.42), frame);
    beam.position.y = boardY + BOARD.h / 2 + 0.25;
    this.group.add(beam);
    this.disposables.push(postGeometry, beam.geometry);

    // the falling flap: a dark half-cell strip hinged on a row's split line, laid over its status cells
    this.flapMaterial = new MeshBasicMaterial({ color: '#15171d', side: DoubleSide, transparent: true, opacity: 0 });
    const flapGeometry = new PlaneGeometry(1, 1);
    flapGeometry.translate(0, 0.5, 0); // hinged on its bottom edge
    this.flap = new Mesh(flapGeometry, this.flapMaterial);
    this.flap.visible = false;
    board.add(this.flap);
    this.disposables.push(flapGeometry, this.flapMaterial);

    // the face is drawn in Oswald: once it is in, draw the current state again
    void document.fonts?.load("600 40px Oswald").then(() => {
      const s = this.state;
      this.state = -1;
      this.setState(Math.max(s, 0));
    }).catch(() => undefined);
  }

  private setState(s: number): void {
    if (s === this.state) return;
    this.state = s;
    this.face.draw(s);
  }

  update(t: number): void {
    // its chapter over, the board goes with its title, while the camera looks down into the street (it would
    // otherwise hang over the takeoff run and the takeoff title)
    const gone = MathUtils.smoothstep(t, GONE_FROM, GONE_TO);
    this.group.visible &&= gone < 0.999;
    const fade = gone > 0.001;
    for (const m of this.fading) {
      if (m.transparent !== fade) {
        m.transparent = fade;
        m.needsUpdate = true;
      }
      m.opacity = 1 - gone;
    }
    if (!this.group.visible) return;
    let s = 0;
    for (const at of ROW_T) if (t >= at) s++;
    if (t >= READY_T) s = ROW_T.length + 1;
    this.setState(s);

    // the flap falling over the row (or the verdict) that is changing
    let active = -1;
    let p = 0;
    for (let i = 0; i <= ROW_T.length; i++) {
      const at = i < ROW_T.length ? ROW_T[i]! : READY_T;
      if (t >= at && t < at + FLAP) {
        active = i;
        p = (t - at) / FLAP;
      }
    }
    this.flap.visible = active >= 0;
    if (active >= 0) {
      const [x, y, w, h] = active < ROW_T.length ? this.face.statusRect(active) : this.face.verdictRect();
      // layout px -> board-local units (the face is the box's +z side)
      const kx = BOARD.w / BOARD_W;
      const ky = BOARD.h / BOARD_H;
      this.flap.position.set((x + w / 2) * kx - BOARD.w / 2, BOARD.h / 2 - (y + h / 2) * ky, BOARD.d / 2 + 0.02);
      this.flap.scale.set(w * kx, (h / 2) * ky, 1);
      // the top half falls forward and down over the split, 0 -> 180 degrees
      this.flap.rotation.x = p * Math.PI;
      this.flapMaterial.opacity = Math.sin(p * Math.PI) * 0.9 + 0.1;
    }

    // the verdict: the red board breathes while GROUNDED, then a green wash as it flips READY
    const wash = MathUtils.smoothstep(t, READY_T, READY_T + 0.002) * (1 - 0.6 * MathUtils.smoothstep(t, READY_T + 0.004, READY_T + 0.014));
    const ready = t >= READY_T;
    this.faceMaterial.emissive.copy(this.white).lerp(ready ? this.green : this.red, ready ? 0.35 + wash * 0.65 : 0.25);
    this.faceMaterial.emissiveIntensity = 0.95 + wash * 1.1;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}

