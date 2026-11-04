/**
 * Resolve a `public/` asset against the deploy base.
 *
 * GitHub Pages serves a project site from `/<repo>/`, not from the domain
 * root, so every hardcoded `/models/...` and `/hdri/...` 404s there — which on
 * this site means no city kit, no desk props and no environment map, i.e. a
 * blank flight. Astro sets BASE_URL to `/` in dev and to the configured base
 * in a Pages build, so this is a no-op locally.
 *
 * Files carry the build id as a query (`?v=`): models, atlases and data keep their names from deploy to
 * deploy, so without it a returning visitor can be shown last week's houses next to this week's code.
 * Bare directories (callers that append a file name) are left alone.
 */
declare const __BUILD_ID__: string;
const version = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : '';
export const asset = (path: string): string => {
  const url = `${import.meta.env.BASE_URL.replace(/\/$/, '')}${path}`;
  return version && /\.[a-z0-9]+$/i.test(path) ? `${url}?v=${version}` : url;
};
