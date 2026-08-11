/**
 * Resolve a `public/` asset against the deploy base.
 *
 * GitHub Pages serves a project site from `/<repo>/`, not from the domain
 * root, so every hardcoded `/models/...` and `/hdri/...` 404s there — which on
 * this site means no city kit, no desk props and no environment map, i.e. a
 * blank flight. Astro sets BASE_URL to `/` in dev and to the configured base
 * in a Pages build, so this is a no-op locally.
 */
export const asset = (path: string): string =>
  `${import.meta.env.BASE_URL.replace(/\/$/, '')}${path}`;
