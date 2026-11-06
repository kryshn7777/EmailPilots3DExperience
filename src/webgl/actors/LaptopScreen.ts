import { CanvasTexture, MathUtils, SRGBColorSpace } from 'three';
import { DESK_SCREEN, QUEUE_NAMES } from '../../story/copy';
import { CAMPAIGN, DESK_NAMES, FLEET } from '../../story/fleet';
import { detectQuality } from '../quality';
import { RELEASE_T, launchPulse } from '../rig/launch';

/**
 * The laptop's display: the Email Pilots composer, live: "the merge". One email is written once with
 * `{{Name}}` in it (the site's own mock: "Hi {{Name}}, I came across {{Company}}…", "Deck_{{Co}}.pdf · for
 * each recipient"). Just before each envelope leaves the screen the `{{Name}}` token spins like a slot
 * machine through the campaign's names and lands on that envelope's person (Amy, then Ben, then Cara:
 * fleet.ts DESK_NAMES), and the other fields resolve with it. Behind the composer a tunnel of envelopes
 * recedes into the display, each with a name tab: the whole campaign queued one behind another, and each one
 * that leaves pulls out of the front of it. Forty-two personal letters waiting their turn.
 *
 * Everything is drawn from story-t (a scrub runs it backwards), redrawn only when the quantised t changes
 * (finer while a name spins), and not at all once the three are away.
 */

const W = 768;
const H = 512;
/** how long the reel spins before each release, in story-t */
const SPIN = 0.0046;
/** the redraw is idle past this story-t: all three are away */
const SETTLED_T = RELEASE_T[2] + 0.02;

const TEAL = '#7fe8d8';
const ICE = '#9be8ff';
const GREEN = '#5dffb0';
const ORANGE = '#ff8a3d';
const DIM = '#5f7596';
const INK = '#e8f1ff';

/** the queue in departure order: the three that leave the desk, then the 39 still waiting */
const QUEUE = [...DESK_NAMES, ...QUEUE_NAMES];
/** each reel: a run of the campaign's names, ending on the one it lands on */
const REELS = DESK_NAMES.map((target, i) => {
  const names = FLEET.map((r) => r.name).filter((n) => n !== target);
  const reel: string[] = [];
  for (let k = 0; k < 13; k++) reel.push(names[(k * 7 + i * 11 + 3) % names.length]!);
  reel.push(target);
  return reel;
});

export interface LaptopScreen {
  texture: CanvasTexture;
  update(t: number, calm: boolean): void;
  dispose(): void;
}

let current: LaptopScreen | null = null;

/** The screen the Desk's laptop is showing, if it has been made yet (the Engine drives it). */
export function liveLaptopScreen(): LaptopScreen | null {
  return current;
}

/** 0..1 eased progress of the reel that lands at `r`, or -1 outside its spin */
function spinAt(t: number, r: number): number {
  if (t < r - SPIN || t >= r) return -1;
  const p = (t - (r - SPIN)) / SPIN;
  return 1 - Math.pow(1 - p, 3);
}

/** which of the three the composer shows at `t` (-1: still the bare template) and how far its reel has run */
function mergeAt(t: number): { i: number; reel: number } {
  for (let i = RELEASE_T.length - 1; i >= 0; i--) {
    const r = RELEASE_T[i]!;
    const s = spinAt(t, r);
    if (s >= 0) return { i, reel: s };
    if (t >= r) return { i, reel: 1 };
  }
  return { i: -1, reel: 0 };
}

/** how many of the queue have left, eased so the tunnel moves up one slot as each one goes */
function queueShift(t: number): number {
  let q = 0;
  for (const r of RELEASE_T) q += MathUtils.smoothstep(t, r - 0.0035, r + 0.0015);
  return q;
}

export function createLaptopScreen(): LaptopScreen {
  const canvas = document.createElement('canvas');
  // the lens comes in close on this screen: 1.5x on a desktop keeps the type crisp
  const scale = detectQuality('').tier === 'high' ? 1.5 : 1;
  canvas.width = W * scale;
  canvas.height = H * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  let lastKey = '';

  const pill = (x: number, y: number, w: number, h: number, r: number | number[]): void => {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
  };

  /** a field: the `{{token}}` in teal until it resolves, then its value in white on a soft teal underline */
  const field = (x: number, y: number, token: string, value: string | null, size: number, flash: number): number => {
    ctx.font = `700 ${size}px monospace`;
    const text = value ?? token;
    const w = ctx.measureText(text).width;
    ctx.save();
    ctx.fillStyle = value ? `rgba(127, 232, 216, ${0.16 + flash * 0.4})` : 'rgba(127, 232, 216, 0.14)';
    pill(x - 6, y - size * 0.86, w + 12, size * 1.12, 6);
    ctx.fill();
    ctx.shadowColor = TEAL;
    ctx.shadowBlur = value ? 6 + flash * 18 : 10;
    ctx.fillStyle = value ? INK : TEAL;
    ctx.fillText(text, x, y);
    ctx.restore();
    return w;
  };

  const plain = (x: number, y: number, text: string, size: number, color: string, weight = 500): number => {
    ctx.font = `${weight} ${size}px monospace`;
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
    return ctx.measureText(text).width;
  };

  /** a line of the template: plain text with `{{Field}}` tokens drawn as fields (resolved from `values`) */
  const rich = (x: number, y: number, text: string, size: number, color: string, values: Record<string, string> | null, flash: number, weight = 500): number => {
    let px = x;
    for (const part of text.split(/(\{\{\w+\}\})/)) {
      if (!part) continue;
      const m = /^\{\{(\w+)\}\}$/.exec(part);
      if (m) px += field(px + 4, y, part, values ? values[m[1]!] ?? null : null, size, flash) + 9;
      else px += plain(px, y, part, size, color, weight);
    }
    return px - x;
  };

  /** one queued envelope at depth `z` (0 = the front of the tunnel), with its name tab */
  const envelope = (z: number, name: string, calm: boolean): void => {
    const VX = 618;
    const VY = 96;
    const FX = 618;
    const FY = 362;
    const f = 1 / (1 + 0.3 * Math.max(z, -0.98));
    const cx = VX + (FX - VX) * f;
    const cy = VY + (FY - VY) * f;
    const w = 196 * f;
    const h = 124 * f;
    // the one leaving swells toward the glass and fades; the far ones fade into the dark
    const alpha = z < 0 ? Math.max(1 + z * 1.6, 0) : MathUtils.clamp(1.15 - z * 0.04, 0.12, 1);
    if (alpha <= 0.01) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#efe4c8';
    ctx.strokeStyle = 'rgba(70, 52, 30, 0.6)';
    ctx.lineWidth = Math.max(1, 2 * f);
    pill(cx - w / 2, cy - h / 2, w, h, 5 * f);
    ctx.fill();
    ctx.stroke();
    // the air-mail edge
    if (f > 0.25) {
      for (let k = 0; k < 9; k++) {
        ctx.fillStyle = k % 2 ? '#2457c9' : '#d3392f';
        ctx.fillRect(cx - w / 2 + (k / 9) * w, cy + h / 2 - 5 * f, (w / 9) * 0.55, 3 * f);
      }
    }
    ctx.strokeStyle = 'rgba(110, 86, 52, 0.55)';
    ctx.beginPath();
    ctx.moveTo(cx - w / 2 + 3, cy - h / 2 + 3);
    ctx.lineTo(cx, cy + h * 0.06);
    ctx.lineTo(cx + w / 2 - 3, cy - h / 2 + 3);
    ctx.stroke();
    // the name tab, standing up off the top edge like a file divider
    if (f > 0.16) {
      const size = Math.max(9, 30 * f);
      ctx.font = `700 ${size}px monospace`;
      const tw = ctx.measureText(name).width + size * 0.9;
      const tx = cx - w / 2 + w * 0.08;
      const ty = cy - h / 2 - size * 1.15;
      const lead = z < 0.5;
      ctx.fillStyle = lead ? TEAL : '#1d3b4a';
      pill(tx, ty, tw, size * 1.3, [size * 0.35, size * 0.35, 0, 0]);
      ctx.fill();
      ctx.fillStyle = lead ? '#062126' : ICE;
      ctx.fillText(name, tx + size * 0.45, ty + size * 1.0);
    }
    ctx.restore();
    void calm;
  };

  const draw = (t: number, calm: boolean): void => {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0a0f1c';
    ctx.fillRect(0, 0, W, H);
    const sheen = ctx.createLinearGradient(0, 0, 0, H);
    sheen.addColorStop(0, 'rgba(60, 110, 170, 0.12)');
    sheen.addColorStop(1, 'rgba(10, 15, 28, 0)');
    ctx.fillStyle = sheen;
    ctx.fillRect(0, 0, W, H);

    const merge = mergeAt(t);
    const landed = merge.i >= 0 && merge.reel >= 1;
    const flash = landed ? 1 - MathUtils.smoothstep(t, RELEASE_T[merge.i]!, RELEASE_T[merge.i]! + 0.006) : 0;
    const sent = RELEASE_T.filter((r) => t >= r).length;

    // ---- the envelope tunnel (right): the whole campaign, queued
    const q = queueShift(t);
    ctx.save();
    ctx.beginPath();
    ctx.rect(470, 62, W - 470, 384);
    ctx.clip();
    const glow = ctx.createRadialGradient(618, 140, 4, 618, 200, 260);
    glow.addColorStop(0, 'rgba(127, 232, 216, 0.22)');
    glow.addColorStop(1, 'rgba(127, 232, 216, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(470, 62, W - 470, 384);
    // the tunnel's perspective guides
    ctx.strokeStyle = 'rgba(127, 232, 216, 0.16)';
    ctx.lineWidth = 1.5;
    for (const [ex, ey] of [[490, 446], [746, 446], [490, 250], [746, 250]] as const) {
      ctx.beginPath();
      ctx.moveTo(618, 96);
      ctx.lineTo(ex, ey);
      ctx.stroke();
    }
    for (let i = QUEUE.length - 1; i >= 0; i--) {
      const z = i - q;
      if (z < -1 || z > 40) continue;
      envelope(z, QUEUE[i]!, calm);
    }
    ctx.restore();
    ctx.fillStyle = DIM;
    ctx.font = '700 15px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(DESK_SCREEN.queueTitle.toUpperCase(), 486, 86);
    ctx.textAlign = 'right';
    ctx.fillStyle = ICE;
    ctx.fillText(`${CAMPAIGN.total - sent} WAITING`, W - 18, 86);
    ctx.textAlign = 'left';

    // ---- title bar
    ctx.fillStyle = '#131b30';
    ctx.fillRect(0, 0, W, 56);
    plain(22, 37, DESK_SCREEN.app, 24, ICE, 800);
    ctx.font = '600 17px monospace';
    ctx.fillStyle = '#b9c9e2';
    ctx.fillText(`${DESK_SCREEN.campaign} · ${DESK_SCREEN.recipients}`, 196, 35);
    // the sample label, in the waiting orange
    ctx.font = '700 13px monospace';
    const lw = ctx.measureText(DESK_SCREEN.label).width + 18;
    ctx.strokeStyle = ORANGE;
    ctx.lineWidth = 1.5;
    pill(W - lw - 16, 17, lw, 24, 12);
    ctx.stroke();
    ctx.fillStyle = ORANGE;
    ctx.fillText(DESK_SCREEN.label, W - lw - 7, 34);

    // ---- the composer (left): one email, written once
    ctx.fillStyle = 'rgba(19, 30, 52, 0.92)';
    ctx.strokeStyle = 'rgba(155, 232, 255, 0.2)';
    ctx.lineWidth = 2;
    pill(18, 70, 444, 370, 14);
    ctx.fill();
    ctx.stroke();
    const company = landed ? DESK_SCREEN.companies[merge.i]! : null;
    const values = landed && company ? { Name: DESK_NAMES[merge.i]!, Company: company, Co: company } : null;
    rich(40, 106, DESK_SCREEN.subject, 17, '#c5d6ee', values, flash, 600);
    ctx.fillStyle = 'rgba(155, 232, 255, 0.12)';
    ctx.fillRect(40, 122, 400, 2);

    // the greeting, big: "Hi {{Name}}," with the reel in the token
    const gy = 196;
    let x = 40 + plain(40, gy, DESK_SCREEN.greeting.before, 50, INK, 800);
    ctx.font = '800 50px monospace';
    const slotW = 174;
    const slotH = 66;
    const sx = x + 2;
    const sy = gy - 50;
    ctx.save();
    ctx.shadowColor = TEAL;
    ctx.shadowBlur = 18 + flash * 34;
    ctx.fillStyle = landed ? `rgba(127, 232, 216, ${0.24 + flash * 0.5})` : 'rgba(127, 232, 216, 0.16)';
    pill(sx, sy, slotW, slotH, 12);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = TEAL;
    ctx.lineWidth = 2.5;
    pill(sx, sy, slotW, slotH, 12);
    ctx.stroke();
    ctx.save();
    pill(sx, sy, slotW, slotH, 12);
    ctx.clip();
    ctx.textAlign = 'center';
    if (merge.i < 0) {
      ctx.font = '800 30px monospace';
      ctx.fillStyle = TEAL;
      ctx.fillText(DESK_SCREEN.greeting.token, sx + slotW / 2, sy + 44);
    } else {
      const reel = REELS[merge.i]!;
      const pos = calm ? reel.length - 1 : merge.reel * (reel.length - 1);
      const speed = calm || merge.reel >= 1 ? 0 : 1 - merge.reel;
      ctx.font = '800 46px monospace';
      for (let k = Math.max(0, Math.floor(pos) - 1); k <= Math.min(reel.length - 1, Math.floor(pos) + 1); k++) {
        const dy = (k - pos) * slotH;
        const yy = sy + 49 + dy;
        // motion blur: ghosts above and below while it spins fast
        if (speed > 0.15) {
          ctx.fillStyle = `rgba(232, 241, 255, ${0.18 * speed})`;
          ctx.fillText(reel[k]!, sx + slotW / 2, yy - 14 * speed);
          ctx.fillText(reel[k]!, sx + slotW / 2, yy + 14 * speed);
        }
        ctx.fillStyle = k === reel.length - 1 && merge.reel >= 1 ? '#ffffff' : INK;
        ctx.fillText(reel[k]!, sx + slotW / 2, yy);
      }
    }
    ctx.restore();
    ctx.textAlign = 'left';
    plain(sx + slotW + 6, gy, DESK_SCREEN.greeting.after, 50, INK, 800);
    // the reel's frame shading, so it reads as a drum
    const drum = ctx.createLinearGradient(0, sy, 0, sy + slotH);
    drum.addColorStop(0, 'rgba(10, 15, 28, 0.55)');
    drum.addColorStop(0.28, 'rgba(10, 15, 28, 0)');
    drum.addColorStop(0.72, 'rgba(10, 15, 28, 0)');
    drum.addColorStop(1, 'rgba(10, 15, 28, 0.55)');
    ctx.fillStyle = drum;
    pill(sx, sy, slotW, slotH, 12);
    ctx.fill();

    // the body
    DESK_SCREEN.body.forEach((line, k) => rich(40, 250 + k * 30, line, 20, '#c5d6ee', values, flash));
    // ruled lines: the rest of the note
    ctx.fillStyle = 'rgba(155, 232, 255, 0.09)';
    for (const [ly, lw2] of [[330, 380], [352, 300]] as const) ctx.fillRect(40, ly, lw2, 8);

    // the attachment that follows the person
    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.strokeStyle = 'rgba(155, 232, 255, 0.25)';
    ctx.lineWidth = 1.5;
    pill(36, 382, 410, 40, 10);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = ICE;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(56, 412);
    ctx.lineTo(56, 395);
    ctx.arc(61, 395, 5, Math.PI, 0);
    ctx.lineTo(66, 410);
    ctx.stroke();
    x = 78 + rich(78, 408, DESK_SCREEN.attachment, 17, INK, values, flash, 700);
    plain(x + 4, 408, DESK_SCREEN.attachmentNote, 15, DIM, 600);

    // ---- the foot: what it is doing, and how many have gone
    ctx.fillStyle = '#0e1628';
    ctx.fillRect(0, 452, W, H - 452);
    ctx.textAlign = 'left';
    const who = merge.i >= 0 ? DESK_NAMES[merge.i]! : null;
    const spinning = merge.i >= 0 && merge.reel < 1;
    if (who && !spinning) {
      plain(22, 488, DESK_SCREEN.sent(who), 20, GREEN, 700);
    } else {
      plain(22, 488, `${DESK_SCREEN.merging} {{Name}} → ${spinning ? '…' : DESK_NAMES.join(', ')}`, 20, TEAL, 700);
    }
    ctx.textAlign = 'right';
    plain(W - 22, 490, `${sent} / ${CAMPAIGN.total}`, 30, ICE, 900);
    ctx.textAlign = 'left';

    // the light of a launch: the whole display swells for a moment
    const pulse = launchPulse(t);
    if (pulse > 0.01) {
      const wash = ctx.createRadialGradient(W / 2, H * 0.42, 20, W / 2, H * 0.42, W * 0.7);
      const a = (calm ? 0.1 : 0.3) * pulse;
      wash.addColorStop(0, `rgba(190, 245, 255, ${a})`);
      wash.addColorStop(1, `rgba(120, 200, 255, ${a * 0.25})`);
      ctx.fillStyle = wash;
      ctx.fillRect(0, 0, W, H);
    }
    texture.needsUpdate = true;
  };

  draw(0, false);
  lastKey = '0';

  const screen: LaptopScreen = {
    texture,
    update(t, calm) {
      // quantised: finer while a reel spins; a settled screen is not redrawn
      const spinning = RELEASE_T.some((r) => t >= r - SPIN && t < r);
      const q = t >= SETTLED_T ? 'done' : (spinning ? 's' + Math.round(t * 5000) : String(Math.round(Math.max(t, 0) * 700))) + (calm ? 'c' : '');
      if (q === lastKey) return;
      lastKey = q;
      draw(Math.max(t, 0), calm);
    },
    dispose() {
      texture.dispose();
      if (current === screen) current = null;
    },
  };
  current = screen;
  return screen;
}
