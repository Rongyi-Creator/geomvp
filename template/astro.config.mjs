// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  output: 'static',
  site: 'https://DOMAIN_PLACEHOLDER',
  integrations: [sitemap()],
  build: {
    format: 'directory',
  },
  image: {
    remotePatterns: [{ protocol: 'https' }],
  },
});
