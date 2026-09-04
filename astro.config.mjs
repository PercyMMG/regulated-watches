// @ts-check
import { defineConfig } from 'astro/config';
import site from './site.config.json' with { type: 'json' };

export default defineConfig({
  site: site.url,
  trailingSlash: 'ignore',
  build: { format: 'directory' },
  devToolbar: { enabled: false },
});
