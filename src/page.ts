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

export function bindPage(): void {
  document.body.dataset.route = location.pathname.replace(/\/+$/, '') || '/';
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

/** One-time chrome: HUD/progress feed, preloader dismissal, custom cursor. */
function bindChromeOnce(): void {
  if (chromeBound) return;
  chromeBound = true;

  const hudChapter = document.getElementById('hud-chapter');
  const hudAlt = document.getElementById('hud-alt');
  const bar = document.querySelector<HTMLElement>('#scroll-progress i');
  let lastChapter = -1;
  let lastAlt = -1;
  window.addEventListener('flight:t', (e) => {
    const t = (e as CustomEvent<number>).detail;
    if (bar) bar.style.transform = `scaleX(${t.toFixed(4)})`;
    if (hudChapter && hudAlt) {
      let i = 0;
      while (i < 9 && t >= CHAPTER_T[i + 1]!) i++;
      // textContent writes force style/layout work — only touch on change
      if (i !== lastChapter) {
        lastChapter = i;
        hudChapter.textContent = `CH ${String(i + 1).padStart(2, '0')} / 10 · ${CHAPTER_NAMES[i]}`;
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
