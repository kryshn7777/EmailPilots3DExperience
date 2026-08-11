import { href } from '../../lib/href';
import { useEffect, useState } from 'react';

const LINKS = [
  { href: '/features', label: 'Flight manual' },
  { href: '/pricing', label: 'Pricing' },
];

export default function Nav() {
  const [open, setOpen] = useState(false);
  const [solid, setSolid] = useState(false);

  useEffect(() => {
    const onScroll = (): void => setSolid(window.scrollY > 40);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <nav aria-label="Main" className={`nav ${solid ? 'nav--solid' : ''}`}>
      <div className="nav__links">
        {LINKS.map((l) => (
          <a key={l.href} href={href(l.href)}>
            {l.label}
          </a>
        ))}
        <a className="nav__cta" href={href('/download')}>
          Download
        </a>
      </div>
      <button
        type="button"
        className="nav__burger"
        aria-expanded={open}
        aria-label="Menu"
        onClick={() => setOpen((v) => !v)}
      >
        Menu
      </button>
      {open && (
        <ul className="nav__sheet">
          {[...LINKS, { href: '/download', label: 'Download' }].map((l) => (
            <li key={l.href}>
              <a href={href(l.href)} onClick={() => setOpen(false)}>
                {l.label}
              </a>
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}
