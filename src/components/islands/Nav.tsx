import { href } from '../../lib/href';
import { useEffect, useState } from 'react';

/**
 * The nav is one call to action: Download. Everything else the site has to say is said by the flight
 * (and the flight manual, /features, is linked from the footer).
 */
export default function Nav() {
  const [solid, setSolid] = useState(false);

  useEffect(() => {
    const onScroll = (): void => setSolid(window.scrollY > 40);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <nav aria-label="Main" className={`nav ${solid ? 'nav--solid' : ''}`}>
      <a className="nav__cta" href={href('/download')}>
        Download
      </a>
    </nav>
  );
}
