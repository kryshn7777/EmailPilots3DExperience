/**
 * DOM-side behaviors that must re-bind after every Swup container swap:
 * scroll reveals and the magnetic CTA. Deliberately dependency-free — this
 * ships in the initial bundle, before the lazy engine chunk.
 */

let observer: IntersectionObserver | null = null;
const magnetCleanups: (() => void)[] = [];
let chromeBound = false;

const CHAPTER_NAMES = ['THE DESK', 'PREFLIGHT', 'TAKEOFF', 'FORMATION', 'THE STORM', 'THE BEACON', 'THE NO-FLY LIST', 'CITY OF INBOXES', 'THE COPILOT', 'THE LANDING'];
const CHAPTER_T = [0, 0.09, 0.17, 0.26, 0.36, 0.48, 0.58, 0.66, 0.78, 0.88, 1];

let stageObserver: IntersectionObserver | null = null;
let stageScroll: (() => void) | null = null;

export function bindPage(): void {
  document.body.dataset.route = location.pathname.replace(/\/+$/, '') || '/';
  bindStage();
  /**
   * Canvas-only by default: every DOM overlay — copy, HUD, nav, footer,
   * progress bar — is hidden so the flight is seen unobstructed. `?copy=1`
   * brings the words back.
   *
   * This was the ?clean art-review switch; it is simply the default now. The
   * markup still renders and still occupies its full height, because the
   * document's scroll height is what drives the flight — the CSS hides it with
   * `visibility`, never `display`, and that distinction is load-bearing.
   */
  if (!new URLSearchParams(location.search).has('copy')) {
    document.body.classList.add('is-clean');
  }
  bindReveals();
  bindMagnets();
  bindChromeOnce();
}

/**
 * The experience stage (`#experience`, Experience.astro) and what comes after it. The engine only
 * needs to render while the stage is on screen: once it has scrolled out of view the landing
 * content covers the canvas completely, so rendering behind it is wasted battery. Pages without a
 * stage (the sub-pages) keep the engine running for their idle orbit. The replay button sends the
 * visitor back to the start of the flight.
 */
function bindStage(): void {
  stageObserver?.disconnect();
  stageObserver = null;
  if (stageScroll) window.removeEventListener('scroll', stageScroll);
  stageScroll = null;
  const stage = document.getElementById('experience');
  if (!stage) {
    document.body.classList.remove('is-landing');
    window.dispatchEvent(new CustomEvent('experience:visible', { detail: true }));
    return;
  }
  stageObserver = new IntersectionObserver(
    ([entry]) => {
      window.dispatchEvent(new CustomEvent('experience:visible', { detail: entry?.isIntersecting ?? true }));
    },
    { threshold: 0 },
  );
  stageObserver.observe(stage);
  // The experience is finished when the bottom of its stage has come up into view: that is the end of
  // the story (ScrollDirector ends the timeline at exactly that scroll position). The site's own
  // chrome (the nav) comes back then. Read off the scroll position, not the eased story value: the
  // engine stops updating once it has paused behind the landing.
  const update = (): void => {
    const finished = stage.getBoundingClientRect().bottom <= window.innerHeight + 2;
    if (finished !== document.body.classList.contains('is-landing')) document.body.classList.toggle('is-landing', finished);
  };
  update();
  window.addEventListener('scroll', update, { passive: true });
  stageScroll = update;
  for (const button of document.querySelectorAll('[data-replay]')) {
    button.addEventListener('click', () => window.dispatchEvent(new CustomEvent('flight:replay')));
  }
}

/** One-time chrome: HUD/progress feed, preloader dismissal, custom cursor. */
function bindChromeOnce(): void {
  if (chromeBound) return;
  chromeBound = true;

  const hudChapter = document.getElementById('hud-chapter');
  const hudAlt = document.getElementById('hud-alt');
  const bar = document.querySelector<HTMLElement>('#scroll-progress i');
  let lastChapter = -1;
  let lastAlt = -1;
  // the bar follows the scroll's own progress, which keeps moving through the office detour while
  // story-t holds still (rig/detour.ts); the chapter readout says where the flight is
  let detourU = 0;
  let revealDur = -1;
  window.addEventListener('flight:progress', (e) => {
    const { p, u, s } = (e as CustomEvent<{ p: number; u: number; s?: number }>).detail;
    if (bar) bar.style.transform = `scaleX(${p.toFixed(4)})`;
    detourU = u;
    // scroll feel: with the copy on, its reveals are quicker while the scroll is quick (600 -> 250 ms)
    if (!document.body.classList.contains('is-clean') && s !== undefined) {
      const ms = Math.round((600 - 350 * s) / 25) * 25;
      if (ms !== revealDur) {
        revealDur = ms;
        document.documentElement.style.setProperty('--reveal-dur', `${ms}ms`);
      }
    }
  });
  bindFlightChrome();
  window.addEventListener('flight:t', (e) => {
    const t = (e as CustomEvent<number>).detail;

    if (hudChapter && hudAlt) {
      let i = 0;
      while (i < 9 && t >= CHAPTER_T[i + 1]!) i++;
      // textContent writes force style/layout work — only touch on change
      const key = detourU > 0 ? -2 : i;
      if (key !== lastChapter) {
        lastChapter = key;
        hudChapter.textContent = `CH ${String(i + 1).padStart(2, '0')} / 10 · ${detourU > 0 ? 'DETOUR · IT OFFICE' : CHAPTER_NAMES[i]}`;
      }
      const alt = Math.round(120 + Math.sin(t * Math.PI) * 2280);
      if (alt !== lastAlt) {
        lastAlt = alt;
        hudAlt.textContent = `ALT ${String(alt).padStart(4, '0')}`;
      }
    }
  });

  const preloader = document.getElementById('preloader');
  const dismiss = (): void => preloader?.classList.add('is-done');
  window.addEventListener('flight:ready', dismiss, { once: true });
  // Failsafe so nobody is ever trapped. With WebGL present the engine WILL
  // fire flight:ready — slow iGPUs take seconds to compile the opening frame,
  // and dismissing early would reveal a black canvas — so give it long rope.
  // Without WebGL there is nothing to wait for: drop the curtain fast.
  let hasWebgl = false;
  try {
    hasWebgl = !!document.createElement('canvas').getContext('webgl2');
  } catch {
    hasWebgl = false;
  }
  setTimeout(dismiss, hasWebgl ? 15000 : 1200);

  // custom cursor, fine pointers only
  if (matchMedia('(pointer: fine)').matches && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const cursor = document.getElementById('cursor');
    if (cursor) {
      document.body.classList.add('has-cursor');
      window.addEventListener(
        'pointermove',
        (e) => {
          cursor.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
          const interactive = (e.target as Element | null)?.closest('a, button, summary, [data-magnetic]');
          cursor.classList.toggle('is-active', !!interactive);
        },
        { passive: true },
      );
    }
  }
}

/**
 * Scroll feel: the controls over the flight (in the canvas-only mode too).
 *  - the rail's ticks: one per chapter, placed where the chapter starts on the scroll (the engine sends
 *    their positions, `flight:rail`, as the pace warp moves them), a click or Enter jumps there;
 *  - the first-load "scroll" cue, gone after 40 px;
 *  - the sound toggle (webgl/audio/Wind.ts): off by default, remembered, never under reduced motion;
 *  - the loading cue, while the story waits on a chapter that has not loaded (`flight:loading`);
 *  - all of it fades out 2.5 s after the last input and comes back on a pointer move, a scroll or a key.
 */
function bindFlightChrome(): void {
  const rail = document.querySelector<HTMLElement>('#scroll-progress .rail');
  const ticks: HTMLButtonElement[] = [];
  if (rail) {
    CHAPTER_NAMES.forEach((name, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'rail__tick';
      b.setAttribute('aria-label', `Chapter ${i + 1}: ${name.toLowerCase()}`);
      const label = document.createElement('span');
      label.textContent = `${String(i + 1).padStart(2, '0')} ${name}`;
      label.setAttribute('aria-hidden', 'true');
      b.appendChild(label);
      b.style.setProperty('--at', `${(CHAPTER_T[i]! * 100).toFixed(2)}%`);
      b.addEventListener('click', () => {
        window.dispatchEvent(new CustomEvent('flight:jump', { detail: CHAPTER_T[i]! }));
        b.blur();
      });
      rail.appendChild(b);
      ticks.push(b);
    });
  }
  window.addEventListener('flight:rail', (e) => {
    const at = (e as CustomEvent<number[]>).detail;
    at.forEach((p, i) => ticks[i]?.style.setProperty('--at', `${(p * 100).toFixed(2)}%`));
  });
  let current = -1;
  window.addEventListener('flight:t', (e) => {
    const t = (e as CustomEvent<number>).detail;
    let i = 0;
    while (i < 9 && t >= CHAPTER_T[i + 1]!) i++;
    if (i === current) return;
    ticks[current]?.removeAttribute('aria-current');
    ticks[i]?.setAttribute('aria-current', 'step');
    current = i;
  });

  // the cue: only until the visitor has scrolled a little
  const cue = document.getElementById('scroll-cue');
  const onCueScroll = (): void => {
    if (window.scrollY > 40) {
      cue?.classList.add('is-gone');
      window.removeEventListener('scroll', onCueScroll);
    }
  };
  window.addEventListener('scroll', onCueScroll, { passive: true });
  onCueScroll();

  // the loading cue
  const loadCue = document.getElementById('load-cue');
  window.addEventListener('flight:loading', (e) => {
    const on = (e as CustomEvent<boolean>).detail;
    if (!loadCue) return;
    loadCue.dataset.on = String(on);
    loadCue.textContent = on ? 'Loading the next leg…' : '';
  });

  // the sound toggle
  const sound = document.getElementById('sound-toggle');
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (sound && !calm) {
    const label = sound.querySelector<HTMLElement>('[data-label]');
    const set = (on: boolean, save: boolean): void => {
      sound.setAttribute('aria-pressed', String(on));
      if (label) label.textContent = on ? 'Sound on' : 'Sound off';
      if (save) {
        try {
          localStorage.setItem('flight-sound', on ? '1' : '0');
        } catch {
          /* storage blocked: the choice lasts this visit */
        }
      }
      window.dispatchEvent(new CustomEvent('flight:sound', { detail: on }));
    };
    let saved = false;
    try {
      saved = localStorage.getItem('flight-sound') === '1';
    } catch {
      saved = false;
    }
    // a remembered "on" still needs a gesture before audio may start: the first pointer or key press
    sound.setAttribute('aria-pressed', 'false');
    if (saved) {
      const resume = (ev: Event): void => {
        // a press on the toggle itself is the toggle's own business (its click follows)
        if ((ev.target as Element | null)?.closest?.('#sound-toggle')) return;
        set(true, false);
        window.removeEventListener('pointerdown', resume);
        window.removeEventListener('keydown', resume);
      };
      window.addEventListener('pointerdown', resume);
      window.addEventListener('keydown', resume);
    }
    sound.addEventListener('click', () => set(sound.getAttribute('aria-pressed') !== 'true', true));
  }

  // idle fade: 2.5 s after the last input
  let idleTimer = 0;
  const wake = (): void => {
    if (document.body.classList.contains('chrome-idle')) document.body.classList.remove('chrome-idle');
    clearTimeout(idleTimer);
    idleTimer = window.setTimeout(() => document.body.classList.add('chrome-idle'), 2500);
  };
  for (const type of ['pointermove', 'pointerdown', 'keydown', 'scroll', 'wheel', 'touchstart']) {
    window.addEventListener(type, wake, { passive: true });
  }
  window.addEventListener('flight:activity', wake);
  wake();
}

function bindReveals(): void {
  observer?.disconnect();
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        // Two-way, and deliberately so. This used to add `is-in` once and then
        // unobserve, which on a sticky scrollytelling section meant the copy
        // faded in at 25% and then sat perfectly still for the rest of a
        // chapter — the reveal was real but you almost never saw it play.
        // Toggling lets each chapter's copy arrive and leave with its own
        // stretch of flight, and replay on the way back up.
        entry.target.classList.toggle('is-in', entry.isIntersecting);
      }
    },
    // a shade earlier than 0.25 and trimmed at the bottom, so the copy is
    // already settling as its chapter takes the frame rather than catching up
    { threshold: 0.15, rootMargin: '0px 0px -12% 0px' },
  );
  for (const el of document.querySelectorAll('[data-reveal]')) {
    splitWords(el);
    if (!el.classList.contains('is-in')) observer.observe(el);
  }
}

/** Headlines cascade in word by word; chips stagger after them. */
function splitWords(container: Element): void {
  for (const heading of container.querySelectorAll('h1, h2')) {
    if ((heading as HTMLElement).dataset.split) continue;
    (heading as HTMLElement).dataset.split = '1';
    const words = (heading.textContent ?? '').trim().split(/\s+/);
    heading.textContent = '';
    words.forEach((word, i) => {
      const span = document.createElement('span');
      span.className = 'w';
      span.style.setProperty('--wi', String(i));
      span.textContent = word;
      heading.appendChild(span);
      if (i < words.length - 1) heading.appendChild(document.createTextNode(' '));
    });
  }
  const staggered = container.querySelectorAll('.chips li, .manual-item');
  staggered.forEach((el, i) => {
    (el as HTMLElement).style.transitionDelay = `${240 + i * 70}ms`;
  });
}

function bindMagnets(): void {
  for (const cleanup of magnetCleanups.splice(0)) cleanup();
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  for (const el of document.querySelectorAll<HTMLElement>('[data-magnetic]')) {
    let targetX = 0;
    let targetY = 0;
    let x = 0;
    let y = 0;
    let raf = 0;

    const tick = (): void => {
      x += (targetX - x) * 0.18;
      y += (targetY - y) * 0.18;
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      if (Math.abs(targetX - x) + Math.abs(targetY - y) > 0.2) {
        raf = requestAnimationFrame(tick);
      } else {
        raf = 0;
      }
    };

    const onMove = (e: PointerEvent): void => {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      const dist = Math.hypot(dx, dy);
      const radius = 130;
      if (dist < radius) {
        const pull = 1 - dist / radius;
        targetX = dx * pull * 0.4;
        targetY = dy * pull * 0.4;
      } else {
        targetX = 0;
        targetY = 0;
      }
      if (!raf) raf = requestAnimationFrame(tick);
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    magnetCleanups.push(() => {
      window.removeEventListener('pointermove', onMove);
      cancelAnimationFrame(raf);
      el.style.transform = '';
    });
  }
}
