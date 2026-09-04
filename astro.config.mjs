// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import site from './site.config.json' with { type: 'json' };

const CURATE_PORT = Number(process.env.CURATE_PORT || 4331);

// GitHub Pages serves a project repo from a subdirectory, so the deployed site
// lives at percymmg.github.io/regulated-watches/ and every internal link needs
// that prefix. `site` is the origin only; `base` is the subdirectory.
const REPO_BASE = '/regulated-watches';

export default defineConfig({
  site: 'https://percymmg.github.io',
  base: REPO_BASE,
  trailingSlash: 'ignore',
  build: { format: 'directory' },
  devToolbar: { enabled: false },

  // robots.txt has always advertised /sitemap.xml; now one actually exists.
  integrations: [sitemap()],

  vite: {
    server: {
      proxy: {
        /**
         * Dev only. Puts the curation dashboard on the same origin as the site
         * so there is one URL and one port to think about:
         *
         *   /curate           -> the dashboard UI
         *   /curate/api/...   -> its JSON API
         *
         * This exists only in the dev server. The dashboard is never built
         * into dist/ and cannot reach production, which matters because it
         * writes directly to your working tree.
         */
        '/curate': {
          target: `http://127.0.0.1:${CURATE_PORT}`,
          // Rewrites the Host header to the target, which the dashboard's
          // anti-DNS-rebinding check requires.
          changeOrigin: true,
          // Forwards the real client IP as X-Forwarded-For. The dashboard
          // refuses non-loopback clients, so running `astro dev --host`
          // cannot expose a filesystem-writing admin to the network.
          xfwd: true,
          rewrite: (path) => path.replace(/^\/curate/, '') || '/',
        },
      },
    },
  },
});
