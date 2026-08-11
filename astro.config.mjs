// @ts-check
import { defineConfig } from 'astro/config';

import react from '@astrojs/react';
import swup from '@swup/astro';
import glsl from 'vite-plugin-glsl';

/**
 * GitHub Pages serves a project site from `/<repo>/`, so the deploy workflow
 * passes the base in rather than hardcoding a repo name here — rename the repo
 * and the build follows. Empty locally, so dev and `astro preview` stay at `/`.
 *
 * Anything in `public/` that runtime code fetches by absolute path must go
 * through `src/webgl/asset.ts`, which prefixes this same base.
 */
const base = process.env.PAGES_BASE || undefined;
const site = process.env.PAGES_SITE || undefined;

// https://astro.build/config
export default defineConfig({
  ...(base ? { base } : {}),
  ...(site ? { site } : {}),
  integrations: [
    react(),
    // Swup is the ONLY router (Astro <ClientRouter/> must stay off). It swaps
    // #swup only — the WebGL canvas lives outside it and survives navigation.
    swup({
      containers: ['#swup'],
      theme: false,
      smoothScrolling: false, // Lenis owns scrolling
      progress: false,
      accessibility: true,
      globalInstance: true, // SwupChoreo hooks in via window.swup
    }),
  ],
  vite: {
    plugins: [glsl({ minify: false })],
  },
});