/**
 * Resolve an internal route against the deploy base.
 *
 * Astro rewrites the paths IT owns (bundled CSS/JS, `<Image>`), but a literal
 * `href="/features"` in markup is passed through untouched — and on a GitHub
 * Pages project site, served from `/<repo>/`, every one of those 404s. This is
 * the markup-side twin of `src/webgl/asset.ts`.
 *
 * `/` is special-cased: stripping the trailing slash off BASE_URL would leave
 * an empty href, which resolves to the current page rather than to home.
 */
const base = import.meta.env.BASE_URL.replace(/\/$/, '');

export const href = (path: string): string => (path === '/' ? `${base}/` : `${base}${path}`);
