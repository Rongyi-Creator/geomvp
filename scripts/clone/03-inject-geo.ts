/**
 * Clone Pipeline Step 3: Inject GEO layer into cloned HTML
 * Usage: pnpm clone:inject <client-name>
 *
 * Takes raw cloned HTML + extracted business data, and produces
 * a deploy-ready static site with full GEO optimizations:
 * - JSON-LD schemas (LocalBusiness, Service, FAQPage)
 * - Optimized meta tags (title, description, canonical, OG)
 * - llms.txt, sitemap.xml, robots.txt
 * - Client-side JS stripped (AI crawlers don't render JS)
 * - lang attribute set
 *
 * The visible HTML/CSS is NOT modified — zero visual change.
 */

import { mkdirSync, writeFileSync, readFileSync, readdirSync, cpSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import * as cheerio from 'cheerio';
import { getCloneDir } from '../config.js';

const [clientName] = process.argv.slice(2);
if (!clientName) {
  console.error('Usage: pnpm clone:inject <client-name>');
  process.exit(1);
}

const dirs = getCloneDir(clientName);
const distDir = dirs.dist;

// ── Load data ────────────────────────────────────────────────────────────────

const business = JSON.parse(readFileSync(resolve(dirs.geoData, 'business.json'), 'utf8'));
const faq = JSON.parse(readFileSync(resolve(dirs.geoData, 'faq.json'), 'utf8'));
const services: Array<{ name: string; slug: string; description: string }> =
  JSON.parse(readFileSync(resolve(dirs.geoData, 'services.json'), 'utf8'));
const pagesMeta: Array<{
  slug: string; path: string; pageType: string;
  isEmpty: boolean; metaTitle: string; metaDescription: string;
}> = JSON.parse(readFileSync(resolve(dirs.geoData, 'pages-meta.json'), 'utf8'));
const pageMap: Array<{ url: string; slug: string; title: string; path: string }> =
  JSON.parse(readFileSync(resolve(dirs.geoData, 'page-map.json'), 'utf8'));

const siteUrl = (business.website ?? '').replace(/\/$/, '');
const lang = business.language ?? 'da';

// ── Prepare dist directory ───────────────────────────────────────────────────

mkdirSync(distDir, { recursive: true });

// Copy assets
if (existsSync(dirs.assets)) {
  const distAssets = resolve(distDir, '_assets');
  mkdirSync(distAssets, { recursive: true });
  cpSync(dirs.assets, distAssets, { recursive: true });
}

console.log(`\n🔧 Injecting GEO layer into ${pageMap.length} pages...\n`);

// ── Process each page ────────────────────────────────────────────────────────

for (const page of pageMap) {
  const htmlPath = resolve(dirs.raw, `${page.slug}.html`);
  if (!existsSync(htmlPath)) {
    console.warn(`  ⚠ Missing: ${page.slug}.html — skipped`);
    continue;
  }

  const html = readFileSync(htmlPath, 'utf8');
  const $ = cheerio.load(html);
  const meta = pagesMeta.find(p => p.slug === page.slug);
  const pageType = meta?.pageType ?? 'other';
  const isEmpty = meta?.isEmpty ?? false;
  const pagePath = page.path === '/' ? '/' : page.path.replace(/\/?$/, '/');
  const canonicalUrl = `${siteUrl}${pagePath}`;

  // 1. Set lang attribute
  $('html').attr('lang', lang);

  // 2. Strip client-side JavaScript (keep JSON-LD scripts)
  $('script').each((_, el) => {
    const type = $(el).attr('type');
    if (type === 'application/ld+json') return; // keep existing JSON-LD
    $(el).remove();
  });

  // 2b. Fix CSS visibility — builder platforms use JS to control visibility.
  //     Without JS, content may be hidden. Inject overrides to force it visible.
  fixBuilderVisibility($);

  // 3. Remove tracking/analytics elements
  $('noscript').each((_, el) => {
    const content = $(el).html() || '';
    if (/google|analytics|facebook|pixel|track/i.test(content)) {
      $(el).remove();
    }
  });

  // 4. Update/add meta tags
  if (meta?.metaTitle) {
    $('title').text(meta.metaTitle);
  }

  setMeta($, 'name', 'description', meta?.metaDescription ?? '');
  setMeta($, 'property', 'og:title', meta?.metaTitle ?? $('title').text());
  setMeta($, 'property', 'og:description', meta?.metaDescription ?? '');
  setMeta($, 'property', 'og:type', 'website');
  setMeta($, 'property', 'og:url', canonicalUrl);
  setMeta($, 'property', 'og:site_name', business.name ?? '');

  // Add canonical link
  let canonical = $('link[rel="canonical"]');
  if (canonical.length === 0) {
    $('head').append(`<link rel="canonical" href="${canonicalUrl}">`);
  } else {
    canonical.attr('href', canonicalUrl);
  }

  // 5. noindex for empty pages
  if (isEmpty) {
    setMeta($, 'name', 'robots', 'noindex, follow');
  }

  // 6. Inject JSON-LD schemas
  // Remove any existing JSON-LD (we'll replace with our comprehensive version)
  $('script[type="application/ld+json"]').remove();

  // LocalBusiness — on every page
  const localBusinessSchema = buildLocalBusinessSchema(business);
  $('head').append(
    `<script type="application/ld+json">${JSON.stringify(localBusinessSchema)}</script>`
  );

  // Service schema — on service pages
  if (pageType === 'service') {
    // Normalize slug: page-map uses "--" separator, services.json uses "/"
    const normalizedSlug = page.slug.replace(/--/g, '/');
    const service = services.find(s => s.slug === normalizedSlug || s.slug === page.slug);
    if (service) {
      const serviceSchema = buildServiceSchema(service, business);
      $('head').append(
        `<script type="application/ld+json">${JSON.stringify(serviceSchema)}</script>`
      );
    }
  }

  // FAQPage schema — on FAQ pages or pages with FAQ content
  if (pageType === 'faq' && faq.items?.length > 0) {
    const faqSchema = buildFaqSchema(faq.items);
    $('head').append(
      `<script type="application/ld+json">${JSON.stringify(faqSchema)}</script>`
    );
  }

  // 7. Rewrite internal links to clean relative paths
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    try {
      const absUrl = new URL(href, page.url);
      if (absUrl.origin === new URL(siteUrl || page.url).origin) {
        let path = absUrl.pathname;
        if (path !== '/' && !path.endsWith('/')) path += '/';
        $(el).attr('href', path);
      }
    } catch { /* keep original */ }
  });

  // 8. Write to dist with clean URL structure
  const distPath = pagePath === '/'
    ? resolve(distDir, 'index.html')
    : resolve(distDir, pagePath.replace(/^\//, '').replace(/\/$/, ''), 'index.html');

  mkdirSync(dirname(distPath), { recursive: true });
  writeFileSync(distPath, $.html());

  const icon = isEmpty ? '⚪' : '✅';
  console.log(`  ${icon} ${pagePath}`);
}

// ── Generate llms.txt ────────────────────────────────────────────────────────

const llmsTxt = generateLlmsTxt(business, services, pageMap);
writeFileSync(resolve(distDir, 'llms.txt'), llmsTxt);
console.log('\n  📄 llms.txt generated');

// ── Generate sitemap.xml ─────────────────────────────────────────────────────

const sitemapXml = generateSitemap(pageMap, pagesMeta, siteUrl);
writeFileSync(resolve(distDir, 'sitemap.xml'), sitemapXml);
console.log('  📄 sitemap.xml generated');

// ── Generate robots.txt ──────────────────────────────────────────────────────

const robotsTxt = [
  'User-agent: *',
  'Allow: /',
  '',
  `Sitemap: ${siteUrl}/sitemap.xml`,
].join('\n');
writeFileSync(resolve(distDir, 'robots.txt'), robotsTxt);
console.log('  📄 robots.txt generated');

// ── Done ─────────────────────────────────────────────────────────────────────

const distFiles = readdirSync(distDir, { recursive: true })
  .filter((f): f is string => f.toString().endsWith('.html'));

console.log(`\n✅ GEO injection complete:`);
console.log(`   Pages:    ${distFiles.length}`);
console.log(`   JSON-LD:  LocalBusiness + ${services.length} Service schemas`);
console.log(`   Output:   ${distDir}`);
console.log(`\nNext: pnpm clone:qa ${clientName}`);

// ══════════════════════════════════════════════════════════════════════════════
// Helpers
// ══════════════════════════════════════════════════════════════════════════════

function fixBuilderVisibility($: cheerio.CheerioAPI) {
  // Builder platforms (one.com, Wix, Squarespace, etc.) use JS to control
  // layout and visibility. Without JS, content stays hidden. This function
  // detects builder patterns and injects CSS overrides to force visibility.

  const overrides: string[] = [
    'body { opacity: 1 !important; visibility: visible !important; }',
  ];

  // ── one.com builder ────────────────────────────────────────────────
  if ($('.mm-mobile-preview').length > 0 || $('.template').length > 0) {
    // The page has two renderings: mobile (.mm-mobile-preview) and desktop (.template).
    // Desktop (.template) is the full content; mobile is header-only.
    // JS normally hides mobile preview and shows desktop. Without JS, neither shows.

    // Hide the mobile-only header (incomplete — only has nav, not content)
    $('.mm-mobile-preview').remove();

    // Force the desktop template visible with correct layout
    overrides.push(
      '.template { display: block !important; max-width: 100% !important; visibility: visible !important; }',
      '.template * { visibility: visible !important; }',
      '.template .row, .template > .row { height: auto !important; min-height: auto !important; overflow: visible !important; }',
      '.template .col { height: auto !important; }',
      // Sections/blocks: ensure they stack and show
      '[data-kind="SECTION"], [data-kind="Block"] { display: block !important; position: relative !important; }',
      '.Preview_row__3Fkye { display: flex !important; flex-wrap: wrap !important; height: auto !important; min-height: auto !important; overflow: visible !important; }',
      '.Preview_column__1KeVx { display: block !important; }',
      '.Preview_block__16Zmu { display: block !important; position: relative !important; }',
      '.Preview_componentWrapper__2i4QI { display: block !important; }',
      '.Preview_component__SbiKo { display: block !important; }',
      '.Preview_mobileHide__9T929 { display: block !important; }',
      // Background sections
      '.StripPreview_backgroundComponent__3YmQM { position: relative !important; }',
      '.Background_backgroundComponent__3_1Ea { position: relative !important; min-height: 50px !important; }',
    );

    // Remove data-mobile-view attribute to prevent mobile CSS rules
    $('.template').removeAttr('data-mobile-view');
  }

  // ── Wix ────────────────────────────────────────────────────────────
  if ($('[data-mesh-id]').length > 0) {
    overrides.push(
      '[data-mesh-id] { opacity: 1 !important; visibility: visible !important; }',
      '#SITE_CONTAINER { opacity: 1 !important; }',
    );
  }

  // ── Squarespace ────────────────────────────────────────────────────
  if ($('.sqs-block-content').length > 0) {
    overrides.push('.sqs-block-content { opacity: 1 !important; visibility: visible !important; }');
  }

  // ── GoDaddy / website-builder ──────────────────────────────────────
  if ($('[data-ux]').length > 0) {
    overrides.push('[data-ux] { opacity: 1 !important; visibility: visible !important; }');
  }

  $('head').append(`<style id="geo-visibility-fix">\n${overrides.join('\n')}\n</style>`);
}

function setMeta($: cheerio.CheerioAPI, attr: string, name: string, content: string) {
  const selector = `meta[${attr}="${name}"]`;
  if ($(selector).length > 0) {
    $(selector).attr('content', content);
  } else {
    $('head').append(`<meta ${attr}="${name}" content="${escapeAttr(content)}">`);
  }
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildLocalBusinessSchema(biz: Record<string, any>) {
  const schema: Record<string, any> = {
    '@context': 'https://schema.org',
    '@type': biz.schemaType || 'LocalBusiness',
    'name': biz.name,
    'description': biz.description,
    'url': biz.website,
  };

  if (biz.phone) schema.telephone = biz.phone;
  if (biz.email) schema.email = biz.email;

  if (biz.address) {
    schema.address = {
      '@type': 'PostalAddress',
      'streetAddress': biz.address.street,
      'addressLocality': biz.address.city,
      'postalCode': biz.address.zip,
      'addressCountry': biz.address.country,
    };
  }

  if (biz.geo?.lat && biz.geo?.lng) {
    schema.geo = {
      '@type': 'GeoCoordinates',
      'latitude': biz.geo.lat,
      'longitude': biz.geo.lng,
    };
  }

  if (Array.isArray(biz.hours) && biz.hours.length > 0) {
    schema.openingHoursSpecification = biz.hours.map((h: any) => ({
      '@type': 'OpeningHoursSpecification',
      'dayOfWeek': h.day,
      'opens': h.open,
      'closes': h.close,
    }));
  }

  const sameAs = [];
  if (biz.facebookUrl) sameAs.push(biz.facebookUrl);
  if (biz.trustpilotUrl) sameAs.push(biz.trustpilotUrl);
  if (biz.googleMapsUrl) sameAs.push(biz.googleMapsUrl);
  if (Array.isArray(biz.sameAs)) sameAs.push(...biz.sameAs);
  if (sameAs.length > 0) schema.sameAs = [...new Set(sameAs)];

  return schema;
}

function buildServiceSchema(
  service: { name: string; description: string },
  biz: Record<string, any>,
) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Service',
    'name': service.name,
    'description': service.description,
    'provider': {
      '@type': biz.schemaType || 'LocalBusiness',
      'name': biz.name,
    },
    'areaServed': biz.address?.city ? {
      '@type': 'City',
      'name': biz.address.city,
    } : undefined,
  };
}

function buildFaqSchema(items: Array<{ question: string; answer: string }>) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    'mainEntity': items.map(item => ({
      '@type': 'Question',
      'name': item.question,
      'acceptedAnswer': {
        '@type': 'Answer',
        'text': item.answer,
      },
    })),
  };
}

function generateLlmsTxt(
  biz: Record<string, any>,
  services: Array<{ name: string; description: string }>,
  pages: Array<{ url: string; slug: string; title: string; path: string }>,
): string {
  const lines = [
    `# ${biz.name}`,
    '',
    `> ${biz.description}`,
    '',
  ];

  if (biz.address) {
    lines.push(`## Location`);
    lines.push(`${biz.address.street}, ${biz.address.zip} ${biz.address.city}, ${biz.address.country}`);
    lines.push('');
  }

  if (biz.phone || biz.email) {
    lines.push('## Contact');
    if (biz.phone) lines.push(`- Phone: ${biz.phone}`);
    if (biz.email) lines.push(`- Email: ${biz.email}`);
    if (biz.bookingUrl) lines.push(`- Booking: ${biz.bookingUrl}`);
    lines.push('');
  }

  if (Array.isArray(biz.hours) && biz.hours.length > 0) {
    lines.push('## Opening Hours');
    for (const h of biz.hours) {
      lines.push(`- ${h.day}: ${h.open}–${h.close}`);
    }
    lines.push('');
  }

  if (services.length > 0) {
    lines.push('## Services');
    for (const s of services) {
      lines.push(`- ${s.name}: ${s.description}`);
    }
    lines.push('');
  }

  if (biz.practitioner?.name) {
    lines.push('## Practitioner');
    lines.push(`${biz.practitioner.name}${biz.practitioner.title ? `, ${biz.practitioner.title}` : ''}`);
    if (biz.practitioner.credentials?.length > 0) {
      lines.push(`Credentials: ${biz.practitioner.credentials.join(', ')}`);
    }
    lines.push('');
  }

  lines.push('## Pages');
  for (const p of pages) {
    const url = biz.website ? `${biz.website.replace(/\/$/, '')}${p.path}` : p.url;
    lines.push(`- [${p.title}](${url})`);
  }

  return lines.join('\n');
}

function generateSitemap(
  pages: Array<{ url: string; slug: string; path: string }>,
  meta: Array<{ slug: string; isEmpty: boolean }>,
  siteUrl: string,
): string {
  const today = new Date().toISOString().split('T')[0];
  const urls = pages
    .filter(p => {
      const m = meta.find(pm => pm.slug === p.slug);
      return !m?.isEmpty;
    })
    .map(p => {
      const loc = `${siteUrl}${p.path === '/' ? '/' : p.path.replace(/\/?$/, '/')}`;
      const priority = p.slug === 'index' ? '1.0' : '0.8';
      return `  <url>\n    <loc>${escapeXml(loc)}</loc>\n    <lastmod>${today}</lastmod>\n    <priority>${priority}</priority>\n  </url>`;
    });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    '</urlset>',
  ].join('\n');
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
