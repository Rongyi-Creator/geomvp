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

// Patch CSS: remove builder rules that hide content (Playwright rendered it visible,
// but the CSS still has the original hiding rules)
const distCssDir = resolve(distDir, '_assets', 'css');
if (existsSync(distCssDir)) {
  for (const cssFile of readdirSync(distCssDir).filter(f => f.endsWith('.css'))) {
    const cssPath = resolve(distCssDir, cssFile);
    let css = readFileSync(cssPath, 'utf8');
    // Replace visibility:hidden on .template (one.com)
    css = css.replace(/\.template\s*\{([^}]*?)visibility\s*:\s*hidden/g, '.template{$1visibility:visible');
    // Replace height:0!important on rows inside .template (one.com mobile mode)
    css = css.replace(/\.template\.mobileViewLoaded\b[^}]*height\s*:\s*0\s*!important[^}]*/g, (m) =>
      m.replace(/height\s*:\s*0\s*!important/g, 'height:auto!important')
        .replace(/min-height\s*:\s*0\s*!important/g, 'min-height:auto!important')
    );
    writeFileSync(cssPath, css);
  }
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

  // 2. Clean up builder artifacts (mobile duplicates, consent banners)
  cleanBuilderArtifacts($);

  // 3. Strip client-side JavaScript (keep JSON-LD scripts)
  $('script').each((_, el) => {
    const type = $(el).attr('type');
    if (type === 'application/ld+json') return;
    $(el).remove();
  });

  // 3b. Visibility safety net
  ensureVisibility($);

  // 4. Remove tracking/analytics elements
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

function cleanBuilderArtifacts($: cheerio.CheerioAPI) {
  // Remove cookie/consent banners baked into the rendered DOM
  // Use specific selectors — [class*="termly"] would match <body> which has termly class
  $('#termly-code-snippet-support').remove();
  $('div[class^="termly-"]').remove();
  $('button[class*="termly-"]').remove();
  $('[id*="cookie-banner"], [class*="cookie-banner"]').remove();
  $('[id*="consent-banner"]').remove();
  // Strip termly classes from body
  const bodyClass = $('body').attr('class') || '';
  if (bodyClass.includes('termly')) {
    $('body').attr('class', bodyClass.replace(/\btermly-[\w-]*/g, '').trim());
  }
  $('.announcement-banner-container, .announcement-popup-container').remove();

  // ── one.com: remove mobile-only header (duplicate nav, no content)
  if ($('.mm-mobile-preview').length > 0 || $('.template').length > 0) {
    $('.mm-mobile-preview').remove();
    $('#wsb-mobile-header').remove();
    $('.template').removeAttr('data-mobile-view');
    $('style').each((_, el) => {
      const text = $(el).html() || '';
      if (text.includes('.template { visibility: hidden }') || text.includes('.template{visibility:hidden}')) {
        $(el).html(text
          .replace('.template { visibility: hidden }', '.template { visibility: visible }')
          .replace('.template{visibility:hidden}', '.template{visibility:visible}')
        );
      }
    });
  }

  // ── Wix: consent manager overlays
  $('[id*="consentManager"]').remove();

  // ── Squarespace: cookie policy banner
  $('[class*="cookie-policy"]').remove();
}

function ensureVisibility($: cheerio.CheerioAPI) {
  const overrides = [
    'body { opacity: 1 !important; visibility: visible !important; }',
    '*, *::before, *::after { transition: none !important; animation: none !important; }',
    '.template { visibility: visible !important; display: block !important; }',
    '.template * { visibility: visible !important; }',
  ];
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
