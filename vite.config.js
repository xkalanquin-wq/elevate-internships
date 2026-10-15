import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, 'client');

/**
 * Social crawlers do not resolve relative image paths, so og:image and friends
 * have to be absolute. The real origin is only known at deploy time, so it is
 * substituted here from SITE_URL.
 */
const PRODUCTION_SITE_URL = 'https://elevateinternships.com';

function siteUrlPlugin() {
  // A build is for deployment, so it defaults to the real domain. Only the dev
  // server falls back to localhost, where absolute tags do not matter anyway.
  const raw = process.env.SITE_URL || PRODUCTION_SITE_URL;
  const siteUrl = raw.replace(/\/+$/, '');

  return {
    name: 'site-url',
    // Must run before Vite's own HTML pass. Otherwise Vite sees
    // href="__SITE_URL__/" as a relative asset path and prefixes the base,
    // producing "/https://elevateinternships.com/" once the token is replaced.
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        return html.replaceAll('__SITE_URL__', siteUrl);
      },
    },
    configResolved(cfg) {
      if (cfg.command === 'build') {
        cfg.logger.info(`\n[site-url] social tags point at ${siteUrl}\n`);
      }
    },

    // robots.txt and sitemap.xml both need the absolute origin, so they are
    // emitted here rather than sitting as static files that would go stale.
    generateBundle() {
      const today = new Date().toISOString().slice(0, 10);

      // Keep in step with KNOWN_PATHS in client/src/App.jsx and CLIENT_ROUTES
      // in server/index.js. /home is the landing page; it is listed below /
      // because / is the app itself and the thing worth ranking.
      const pages = [
        { loc: '/', priority: '1.0', changefreq: 'daily' },
        { loc: '/home', priority: '0.8', changefreq: 'weekly' },
        { loc: '/privacy', priority: '0.4', changefreq: 'yearly' },
        { loc: '/terms', priority: '0.4', changefreq: 'yearly' },
        // One page per major, served with its content in the HTML by
        // server/majors.js. The list comes from the same tracks file.
        { loc: '/internships', priority: '0.9', changefreq: 'daily' },
        ...Object.keys(JSON.parse(fs.readFileSync(path.join(here, 'server', 'data', 'tracks.json'), 'utf8')))
          .filter((id) => !id.startsWith('_'))
          .map((id) => ({ loc: `/internships/${id}`, priority: '0.8', changefreq: 'daily' })),
        { loc: '/career-guides', priority: '0.6', changefreq: 'weekly' },
        ...JSON.parse(fs.readFileSync(path.join(here, 'server', 'data', 'guides.json'), 'utf8')).guides.map((g) => ({
          loc: `/career-guides/${g.slug}`,
          priority: '0.6',
          changefreq: 'monthly',
          lastmod: g.updated,
        })),
        { loc: '/interview-questions', priority: '0.6', changefreq: 'monthly' },
        ...JSON.parse(fs.readFileSync(path.join(here, 'server', 'data', 'interview-questions.json'), 'utf8')).categories.map((c) => ({
          loc: `/interview-questions/${c.slug}`,
          priority: '0.6',
          changefreq: 'monthly',
        })),
        // Premium can be switched off (server/data/features.json); then it has no page.
        ...(JSON.parse(fs.readFileSync(path.join(here, 'server', 'data', 'features.json'), 'utf8')).premium === true
          ? [{ loc: '/premium', priority: '0.4', changefreq: 'monthly' }]
          : []),
        { loc: '/how-it-works', priority: '0.3', changefreq: 'yearly' },
        { loc: '/accessibility', priority: '0.2', changefreq: 'yearly' },
        { loc: '/sponsor', priority: '0.2', changefreq: 'yearly' },
        { loc: '/certifications', priority: '0.8', changefreq: 'monthly' },
        ...Object.keys(JSON.parse(fs.readFileSync(path.join(here, 'server', 'data', 'tracks.json'), 'utf8')))
          .filter((id) => !id.startsWith('_'))
          .map((id) => ({ loc: `/certifications/${id}`, priority: '0.7', changefreq: 'monthly' })),
      ];

      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        source:
          '<?xml version="1.0" encoding="UTF-8"?>\n' +
          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
          pages
            .map(
              (p) =>
                `  <url>\n    <loc>${siteUrl}${p.loc}</loc>\n` +
                `    <lastmod>${p.lastmod || today}</lastmod>\n` +
                `    <changefreq>${p.changefreq}</changefreq>\n` +
                `    <priority>${p.priority}</priority>\n  </url>`,
            )
            .join('\n') +
          '\n</urlset>\n',
      });

      this.emitFile({
        type: 'asset',
        fileName: 'robots.txt',
        source: [
          '# Elevate Internships',
          '',
          'User-agent: *',
          'Allow: /',
          '',
          '# Nothing useful to index, and the stats endpoint is owner-only.',
          'Disallow: /api/',
          'Disallow: /owner',
          'Disallow: /account',
          '# Sponsored-listing redirects: counted clicks, not pages.',
          'Disallow: /go/',
          '',
          '# Link previews need the card images, so keep the big crawlers out of',
          '# the way of nothing else.',
          'User-agent: Twitterbot',
          'Allow: /',
          '',
          'User-agent: facebookexternalhit',
          'Allow: /',
          '',
          '# AI search and assistants are welcome to read and cite every public page.',
          '# A named group replaces the * group for that crawler, so each repeats',
          '# the two private areas. A plain-text map is at /llms.txt.',
          ...[
            'GPTBot', 'OAI-SearchBot', 'ChatGPT-User',
            'ClaudeBot', 'Claude-SearchBot', 'Claude-User',
            'PerplexityBot', 'Perplexity-User',
            'Google-Extended', 'Applebot', 'Applebot-Extended',
            'Bingbot', 'DuckAssistBot', 'CCBot', 'meta-externalagent', 'Amazonbot', 'MistralAI-User',
          ].flatMap((bot) => [`User-agent: ${bot}`, 'Allow: /', 'Disallow: /api/', 'Disallow: /owner', 'Disallow: /account', 'Disallow: /go/', '']),
          `Sitemap: ${siteUrl}/sitemap.xml`,
          '',
        ].join('\n'),
      });
    },
  };
}

export default defineConfig({
  root,
  // Windows Store builds of the desktop app expose this folder through a
  // redirected path, so Vite's realpath lands somewhere its fs guard does not
  // recognise. Keep the literal path and let it serve from there.
  resolve: { preserveSymlinks: true },
  plugins: [react(), siteUrlPlugin()],
  server: {
    port: 5173,
    // Bind on all interfaces so the app answers to a branded hostname as well
    // as localhost. Browsers resolve any *.localhost name to 127.0.0.1 with no
    // hosts-file entry and no administrator rights, which is why
    // elevateinternships.localhost works out of the box.
    host: true,
    open: '/',
    allowedHosts: ['localhost', '127.0.0.1', 'elevateinternships.localhost', '.elevateinternships.com'],
    fs: { strict: false, allow: [here] },
    // Relative target so the proxy follows whatever host the page was loaded
    // from; a hardcoded localhost here would break the branded hostname.
    proxy: { '/api': { target: 'http://127.0.0.1:3001', changeOrigin: true } },
  },
  build: { outDir: path.join(here, 'dist'), emptyOutDir: true },
});
