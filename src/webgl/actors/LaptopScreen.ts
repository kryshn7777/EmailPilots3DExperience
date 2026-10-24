import { CanvasTexture, MathUtils, SRGBColorSpace } from 'three';
import { detectQuality } from '../quality';
import { RELEASE_T, STAGE, launchPulse, sentAt } from '../rig/launch';

/**
 * The laptop's display: the Email Pilots batch window, live. Three mails sit in the queue
 * ("QUEUED"); as each envelope leaves the screen its card sweeps, ripples and turns "SENT", and
 * one more cell of the 42-cell batch bar lights. Everything is drawn from story-t (a scrub
 * runs it backwards), and redrawn only when the quantised t changes, and not at all once the
 * three are away.
 */

const W = 768;
const H = 512;
const TOTAL = 42;
const RECIPIENTS = ['ada@northwind.io', 'grace@harbor.app', 'linus@brightside.co'];
const CARD_X = 40;
const CARD_W = 688;
const CARD_H = 72;
const CARD_Y = (i: number): number => 118 + i * 88;
/** the cards' sweep runs this long before the envelope appears */
const SWEEP = 0.006;
/** the redraw is idle past this story-t: all three are away */
const SETTLED_T = RELEASE_T[2] + 0.02;

const TEAL = '#7fe8d8';
const ICE = '#9be8ff';
const GREEN = '#5dffb0';
const DIM = '#5f7596';

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

  const envelopeIcon = (x: number, y: number, alpha: number): void => {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#eadfc6';
    ctx.beginPath();
    ctx.roundRect(x, y, 52, 34, 4);
    ctx.fill();
    ctx.strokeStyle = 'rgba(110, 86, 52, 0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + 2, y + 3);
    ctx.lineTo(x + 26, y + 20);
    ctx.lineTo(x + 50, y + 3);
    ctx.stroke();
    ctx.restore();
  };

  const draw = (t: number, calm: boolean): void => {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0a0f1c';
    ctx.fillRect(0, 0, W, H);
    // a faint horizon of light at the bottom, like a lit panel
    const sheen = ctx.createLinearGradient(0, 0, 0, H);
    sheen.addColorStop(0, 'rgba(60, 110, 170, 0.10)');
    sheen.addColorStop(1, 'rgba(10, 15, 28, 0)');
    ctx.fillStyle = sheen;
    ctx.fillRect(0, 0, W, H);

    // title bar
    ctx.fillStyle = '#131b30';
    ctx.fillRect(0, 0, W, 62);
    ctx.fillStyle = ICE;
    ctx.font = '700 30px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('EMAIL PILOTS', 30, 42);
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = 'rgba(155, 232, 255, 0.4)';
      ctx.beginPath();
      ctx.arc(676 + i * 28, 31, 7, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = DIM;
    ctx.font = '600 20px monospace';
    ctx.fillText(`BATCH #0427  /  ${TOTAL} RECIPIENTS`, CARD_X, 98);

    const { sent } = sentAt(t);

    // the three mails in the queue
    for (let i = 0; i < 3; i++) {
      const y = CARD_Y(i);
      const r = RELEASE_T[i]!;
      const sweep = MathUtils.clamp((t - (r - SWEEP)) / SWEEP, 0, 1);
      const away = t >= r;
      const flash = away ? 1 - MathUtils.smoothstep(t, r, r + 0.014) : 0;
      ctx.fillStyle = away ? `rgba(40, 120, 110, ${0.18 + flash * 0.18})` : '#101a2e';
      ctx.strokeStyle = away ? `rgba(93, 255, 176, ${0.22 + flash * 0.4})` : sweep > 0 ? 'rgba(127, 232, 216, 0.6)' : 'rgba(155, 232, 255, 0.14)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(CARD_X, y, CARD_W, CARD_H, 14);
      ctx.fill();
      ctx.stroke();
      envelopeIcon(CARD_X + 24, y + 19, away ? 0.45 : 1);
      ctx.fillStyle = away ? '#8fa7c2' : '#d6ecff';
      ctx.font = '700 26px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(RECIPIENTS[i]!, CARD_X + 100, y + 45);
      // the sweep along the foot of the card while it is being sent
      if (sweep > 0 && !away) {
        ctx.fillStyle = TEAL;
        ctx.fillRect(CARD_X + 14, y + CARD_H - 9, (CARD_W - 28) * sweep, 4);
      }
      // the chip
      ctx.textAlign = 'right';
      ctx.font = '700 22px monospace';
      if (away) {
        ctx.fillStyle = GREEN;
        ctx.fillText('SENT', CARD_X + CARD_W - 28, y + 44);
        ctx.strokeStyle = GREEN;
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(CARD_X + CARD_W - 110, y + 37);
        ctx.lineTo(CARD_X + CARD_W - 101, y + 46);
        ctx.lineTo(CARD_X + CARD_W - 86, y + 28);
        ctx.stroke();
      } else {
        ctx.fillStyle = sweep > 0 ? TEAL : DIM;
        ctx.fillText(sweep > 0 ? 'SENDING' : 'QUEUED', CARD_X + CARD_W - 28, y + 44);
      }
      // a ripple spreading out of the envelope as it leaves
      const ripple = (t - r) / (STAGE.openTo + 0.004);
      if (ripple > 0 && ripple < 1) {
        ctx.strokeStyle = `rgba(127, 232, 216, ${(calm ? 0.35 : 0.8) * (1 - ripple) * (1 - ripple)})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(CARD_X + 50, y + 36, 16 + ripple * 150, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // the batch bar: one cell per recipient, lit as each one goes
    const pitch = CARD_W / TOTAL;
    const done = sent >= 3 && t > SETTLED_T - 0.02;
    ctx.textAlign = 'left';
    ctx.fillStyle = TEAL;
    ctx.font = '700 30px monospace';
    ctx.fillText(done ? 'BATCH SENDING…' : 'FIRING EMAIL…', CARD_X, 410);
    ctx.textAlign = 'right';
    ctx.fillStyle = ICE;
    ctx.font = '900 46px monospace';
    ctx.fillText(`${sent} / ${TOTAL}`, CARD_X + CARD_W, 412);
    for (let k = 0; k < TOTAL; k++) {
      const x = CARD_X + k * pitch;
      const lit = k < 3 ? MathUtils.smoothstep(t, RELEASE_T[k]!, RELEASE_T[k]! + 0.006) : 0;
      ctx.fillStyle = 'rgba(127, 232, 216, 0.13)';
      ctx.fillRect(x, 440, pitch - 5, 30);
      if (lit > 0) {
        ctx.save();
        ctx.shadowColor = TEAL;
        ctx.shadowBlur = 16 * lit;
        ctx.fillStyle = `rgba(127, 232, 216, ${lit})`;
        ctx.fillRect(x, 440, pitch - 5, 30);
        ctx.restore();
      }
    }
    // the next cell waits, breathing no more than its own brightness
    if (sent >= 3) {
      ctx.fillStyle = 'rgba(127, 232, 216, 0.34)';
      ctx.fillRect(CARD_X + 3 * pitch, 440, pitch - 5, 30);
    }

    // the light of a launch: the whole display swells for a moment
    const pulse = launchPulse(t);
    if (pulse > 0.01) {
      const wash = ctx.createRadialGradient(W / 2, H * 0.42, 20, W / 2, H * 0.42, W * 0.7);
      const a = (calm ? 0.1 : 0.34) * pulse;
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
      // quantised: ~600 steps across the opening; a settled screen is not redrawn
      const q = t >= SETTLED_T ? 'done' : String(Math.round(Math.max(t, 0) * 700)) + (calm ? 'c' : '');
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
