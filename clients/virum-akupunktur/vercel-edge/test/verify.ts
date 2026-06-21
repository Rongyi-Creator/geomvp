/**
 * Local verification: fetch live HTML from origin, apply transformations,
 * and validate the output matches expected GEO injections.
 *
 * Usage: tsx test/verify.ts
 */

import {
  ORIGIN_HOST,
  CANONICAL_HOST,
  BUSINESS,
  FAQ_ITEMS,
  SERVICES,
  PAGES_META,
} from '../lib/geo-data.js';

const PASS = '\x1b[32m✓\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';
let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string, detail?: string) {
  if (condition) {
    console.log(`  ${PASS} ${label}`);
    passed++;
  } else {
    console.log(`  ${FAIL} ${label}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

// ── Import transformation logic inline (same as proxy.ts) ──

function normalizePath(pathname: string): string {
  let p = pathname;
  if (p !== '/' && !p.endsWith('/')) p += '/';
  return p;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function transformHtml(html: string, pathname: string): string {
  const norm = normalizePath(pathname);
  const page = PAGES_META[norm] ?? null;

  const schemas: string[] = [JSON.stringify(BUSINESS)];
  if (page) {
    if (page.pageType === 'service') {
      const svc = SERVICES[norm];
      if (svc) {
        schemas.push(JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'MedicalTherapy',
          name: svc.name,
          description: svc.description,
          provider: { '@type': 'MedicalBusiness', name: BUSINESS.name, url: BUSINESS.url },
        }));
      }
    }
    if (page.pageType === 'faq' || page.pageType === 'home') {
      schemas.push(JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: FAQ_ITEMS.map((item) => ({
          '@type': 'Question',
          name: item.question,
          acceptedAnswer: { '@type': 'Answer', text: item.answer },
        })),
      }));
    }
  }

  const schemaScripts = schemas.map((s) => `<script type="application/ld+json">${s}</script>`).join('');
  const metaTag = page?.metaDescription
    ? `<meta name="description" content="${escapeHtml(page.metaDescription)}">`
    : '';
  const injection = metaTag + schemaScripts;

  if (page) {
    html = html.replace(/<meta\s+name=["']description["'][^>]*>/gi, '');
  }
  html = html.replace('</head>', `${injection}</head>`);
  if (page) {
    html = html.replace(/<title>[^<]*<\/title>/i, `<title>${escapeHtml(page.metaTitle)}</title>`);
  }
  const canonicalHref = `${CANONICAL_HOST}${norm}`;
  html = html.replace(
    /<link\s+rel=["']canonical["']\s+href=["'][^"']*["'][^>]*>/gi,
    `<link rel="canonical" href="${canonicalHref}">`,
  );
  return html;
}

// ── Tests ──

async function fetchOrigin(path: string): Promise<string | null> {
  try {
    const res = await fetch(`${ORIGIN_HOST}${path}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GeoReforge/1.0)' },
    });
    if (!res.ok || !res.headers.get('content-type')?.includes('text/html')) return null;
    return res.text();
  } catch {
    return null;
  }
}

async function testHomePage() {
  console.log('\n── Homepage (/) ──');
  const html = await fetchOrigin('/');
  if (!html) { console.log('  ⚠ Could not fetch homepage'); return; }

  const result = transformHtml(html, '/');

  assert(result.includes('"@type":"MedicalBusiness"'), 'LocalBusiness JSON-LD injected');
  assert(result.includes('"@type":"FAQPage"'), 'FAQPage JSON-LD injected (home page)');
  assert(result.includes('Akupunktur i Dyssegård | Virum Akupunktur</title>'), 'Title replaced');
  assert(
    result.includes('content="Virum Akupunktur tilbyder professionel akupunkturbehandling'),
    'Meta description injected',
  );
  assert(
    result.includes(`href="${CANONICAL_HOST}/"`),
    'Canonical URL set',
  );

  const oldMetaCount = (result.match(/<meta\s+name=["']description["']/gi) || []).length;
  assert(oldMetaCount === 1, 'Only one meta description exists', `found ${oldMetaCount}`);

  const jsonLdCount = (result.match(/application\/ld\+json/g) || []).length;
  assert(jsonLdCount === 2, 'Exactly 2 JSON-LD blocks (LocalBusiness + FAQ)', `found ${jsonLdCount}`);
}

async function testServicePage() {
  console.log('\n── Service page (/our-team/) ──');
  const html = await fetchOrigin('/our-team/');
  if (!html) { console.log('  ⚠ Could not fetch /our-team/'); return; }

  const result = transformHtml(html, '/our-team/');

  assert(result.includes('"@type":"MedicalBusiness"'), 'LocalBusiness JSON-LD injected');
  assert(!result.includes('"@type":"FAQPage"'), 'No FAQ JSON-LD on service listing page');
  assert(result.includes('Akupunkturbehandlinger i Dyssegård | Virum Akupunktur</title>'), 'Title replaced');
  assert(
    result.includes(`href="${CANONICAL_HOST}/our-team/"`),
    'Canonical URL set',
  );
}

async function testUnknownPage() {
  console.log('\n── Unknown page (/some-random-path/) ──');
  const html = await fetchOrigin('/');
  if (!html) { console.log('  ⚠ Could not fetch origin'); return; }

  const result = transformHtml(html, '/some-random-path/');

  assert(result.includes('"@type":"MedicalBusiness"'), 'LocalBusiness JSON-LD always injected');
  assert(!result.includes('"@type":"FAQPage"'), 'No FAQ on unknown page');
  assert(!result.includes('"@type":"MedicalTherapy"'), 'No MedicalTherapy on unknown page');

  const jsonLdCount = (result.match(/application\/ld\+json/g) || []).length;
  assert(jsonLdCount === 1, 'Only 1 JSON-LD block (LocalBusiness)', `found ${jsonLdCount}`);
}

function testStaticRoutes() {
  console.log('\n── Static routes ──');

  const robotsPages = Object.keys(PAGES_META);
  assert(robotsPages.length > 30, `PAGES_META has ${robotsPages.length} pages`);

  const serviceCount = Object.keys(SERVICES).length;
  assert(serviceCount > 25, `SERVICES has ${serviceCount} entries`);

  assert(FAQ_ITEMS.length >= 5, `FAQ has ${FAQ_ITEMS.length} items`);
}

function testOriginConfig() {
  console.log('\n── Origin configuration ──');
  assert(ORIGIN_HOST === 'https://www.virumakupunktur.dk', `ORIGIN_HOST = ${ORIGIN_HOST}`);
  assert(CANONICAL_HOST === 'https://virumakupunktur.dk', `CANONICAL_HOST = ${CANONICAL_HOST}`);
  assert(
    ORIGIN_HOST !== CANONICAL_HOST,
    'Origin and canonical are different (prevents infinite loop)',
  );
}

async function main() {
  console.log('GEO Edge Proxy — Vercel Migration Verification\n');

  testOriginConfig();
  testStaticRoutes();
  await testHomePage();
  await testServicePage();
  await testUnknownPage();

  console.log(`\n${'─'.repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
