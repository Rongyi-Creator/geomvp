/**
 * Clone Pipeline Step 4: Quality check on GEO-injected clone
 * Usage: pnpm clone:qa <client-name>
 *
 * Validates GEO layer integrity: JSON-LD, meta tags, llms.txt,
 * sitemap, robots.txt, content preservation, and link integrity.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { resolve } from 'path';
import * as cheerio from 'cheerio';
import { getCloneDir } from '../config.js';

const [clientName] = process.argv.slice(2);
if (!clientName) {
  console.error('Usage: pnpm clone:qa <client-name>');
  process.exit(1);
}

const dirs = getCloneDir(clientName);
const distDir = dirs.dist;

if (!existsSync(distDir)) {
  console.error(`❌ No dist found at ${distDir}. Run: pnpm clone:inject ${clientName} first.`);
  process.exit(1);
}

interface CheckResult {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  detail: string;
}

const checks: CheckResult[] = [];
let hasFail = false;

function check(name: string, ok: boolean, detail: string, isWarn = false) {
  const status = ok ? 'pass' : (isWarn ? 'warn' : 'fail');
  if (!ok && !isWarn) hasFail = true;
  checks.push({ name, status, detail });
}

// ── Find all HTML files ──────────────────────────────────────────────────────

const htmlFiles = findHtmlFiles(distDir);

check('Page count', htmlFiles.length >= 2, `${htmlFiles.length} pages in dist`);

// ── 1. JSON-LD Validation ────────────────────────────────────────────────────

console.log('\n=== GEO Clone Quality Report ===\n');
console.log('1. JSON-LD Schemas');

function extractJsonLd(html: string): any[] {
  const schemas: any[] = [];
  const matches = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  for (const m of matches) {
    try { schemas.push(JSON.parse(m[1])); } catch { /* invalid */ }
  }
  return schemas;
}

const indexPath = resolve(distDir, 'index.html');
const indexHtml = existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : '';
const indexSchemas = extractJsonLd(indexHtml);

const lb = indexSchemas.find((s: any) =>
  s['@type'] === 'LocalBusiness' || s['@type'] === 'MedicalBusiness' ||
  s['@type'] === 'HealthAndBeautyBusiness'
);

check('LocalBusiness schema on homepage', !!lb, lb ? `@type: ${lb['@type']}` : 'Missing');
if (lb) {
  check('LB: name', !!lb.name, lb.name ?? 'MISSING');
  check('LB: address', !!lb.address, lb.address ? 'present' : 'MISSING');
  check('LB: phone', !!lb.telephone, lb.telephone ?? 'not found', true);
  check('LB: hours', Array.isArray(lb.openingHoursSpecification) && lb.openingHoursSpecification.length > 0,
    `${lb.openingHoursSpecification?.length ?? 0} entries`, true);
}

// Count service schemas across all pages
let serviceSchemaCount = 0;
for (const file of htmlFiles) {
  const html = readFileSync(resolve(distDir, file), 'utf8');
  const schemas = extractJsonLd(html);
  serviceSchemaCount += schemas.filter((s: any) => s['@type'] === 'Service').length;
}
check('Service schemas', serviceSchemaCount > 0, `${serviceSchemaCount} service pages with schema`, serviceSchemaCount === 0);

// ── 2. Meta Tags ─────────────────────────────────────────────────────────────

console.log('\n2. Meta Tags & SEO');

const titles = new Set<string>();
const descs = new Set<string>();
let missingCanonical = 0;
let missingOg = 0;
let missingLang = 0;

for (const file of htmlFiles) {
  const html = readFileSync(resolve(distDir, file), 'utf8');
  const $ = cheerio.load(html);

  const title = $('title').text().trim();
  const desc = $('meta[name="description"]').attr('content') ?? '';
  const canonical = $('link[rel="canonical"]').attr('href');
  const ogTitle = $('meta[property="og:title"]').attr('content');
  const lang = $('html').attr('lang');

  if (title) titles.add(title);
  if (desc) descs.add(desc);
  if (!canonical) missingCanonical++;
  if (!ogTitle) missingOg++;
  if (!lang) missingLang++;
}

check('Unique titles', titles.size >= htmlFiles.length - 1, `${titles.size}/${htmlFiles.length} unique`);
check('Unique descriptions', descs.size >= htmlFiles.length - 2, `${descs.size}/${htmlFiles.length} unique`);
check('Canonical URLs', missingCanonical === 0, missingCanonical === 0 ? 'all pages' : `${missingCanonical} missing`);
check('Open Graph tags', missingOg === 0, missingOg === 0 ? 'all pages' : `${missingOg} missing`);
check('lang attribute', missingLang === 0, missingLang === 0 ? 'all pages' : `${missingLang} missing`);

// ── 3. JS Stripped ───────────────────────────────────────────────────────────

console.log('\n3. Static HTML Compliance');

let pagesWithJs = 0;
for (const file of htmlFiles) {
  const html = readFileSync(resolve(distDir, file), 'utf8');
  const $ = cheerio.load(html);
  const scripts = $('script').not('[type="application/ld+json"]');
  if (scripts.length > 0) pagesWithJs++;
}
check('No client-side JS', pagesWithJs === 0, pagesWithJs === 0 ? 'clean' : `${pagesWithJs} pages still have <script> tags`);

// ── 4. Content Preservation ──────────────────────────────────────────────────

console.log('\n4. Content Preservation');

let externalLinksPreserved = 0;
let bookingLinksFound = 0;

for (const file of htmlFiles) {
  const html = readFileSync(resolve(distDir, file), 'utf8');
  if (/href="https?:\/\/[^"]*planway/i.test(html)) bookingLinksFound++;
  if (/href="https?:\/\/[^"]*facebook/i.test(html)) externalLinksPreserved++;
  if (/href="https?:\/\/[^"]*google\.com\/maps/i.test(html)) externalLinksPreserved++;
}

check('Booking links preserved', bookingLinksFound > 0, `${bookingLinksFound} pages with booking link`, bookingLinksFound === 0);
check('External links preserved', externalLinksPreserved > 0, `${externalLinksPreserved} external link references found`, externalLinksPreserved === 0);

// Compare raw page count vs dist page count
const rawFiles = readdirSync(dirs.raw).filter(f => f.endsWith('.html'));
check('All pages cloned', htmlFiles.length >= rawFiles.length,
  `${htmlFiles.length} dist vs ${rawFiles.length} raw`);

// ── 5. GEO Artifacts ────────────────────────────────────────────────────────

console.log('\n5. GEO Artifacts');

check('llms.txt exists', existsSync(resolve(distDir, 'llms.txt')), '');
check('sitemap.xml exists', existsSync(resolve(distDir, 'sitemap.xml')), '');
check('robots.txt exists', existsSync(resolve(distDir, 'robots.txt')), '');

if (existsSync(resolve(distDir, 'llms.txt'))) {
  const llms = readFileSync(resolve(distDir, 'llms.txt'), 'utf8');
  check('llms.txt has content', llms.length > 100, `${llms.length} chars`);
  check('llms.txt has business name', llms.includes('#'), 'has heading');
}

if (existsSync(resolve(distDir, 'sitemap.xml'))) {
  const sitemap = readFileSync(resolve(distDir, 'sitemap.xml'), 'utf8');
  const urlCount = [...sitemap.matchAll(/<loc>/g)].length;
  check('Sitemap has URLs', urlCount > 0, `${urlCount} URLs`);
}

if (existsSync(resolve(distDir, 'robots.txt'))) {
  const robots = readFileSync(resolve(distDir, 'robots.txt'), 'utf8');
  check('robots.txt has sitemap ref', robots.includes('Sitemap:'), '');
}

// ── 6. Asset Integrity ──────────────────────────────────────────────────────

console.log('\n6. Asset Integrity');

let brokenAssetRefs = 0;
for (const file of htmlFiles) {
  const html = readFileSync(resolve(distDir, file), 'utf8');
  const $ = cheerio.load(html);

  $('link[rel="stylesheet"]').each((_, el) => {
    const href = $(el).attr('href');
    if (href?.startsWith('/') && !href.startsWith('//')) {
      const assetPath = resolve(distDir, href.replace(/^\//, ''));
      if (!existsSync(assetPath)) brokenAssetRefs++;
    }
  });

  $('img[src]').each((_, el) => {
    const src = $(el).attr('src');
    if (src?.startsWith('/') && !src.startsWith('//')) {
      const assetPath = resolve(distDir, src.replace(/^\//, ''));
      if (!existsSync(assetPath)) brokenAssetRefs++;
    }
  });
}

check('Local asset references valid', brokenAssetRefs === 0,
  brokenAssetRefs === 0 ? 'all local refs resolve' : `${brokenAssetRefs} broken references`);

// ── Report ───────────────────────────────────────────────────────────────────

const passCount = checks.filter(c => c.status === 'pass').length;
const failCount = checks.filter(c => c.status === 'fail').length;
const warnCount = checks.filter(c => c.status === 'warn').length;

console.log('\n' + '─'.repeat(50));
for (const c of checks) {
  const icon = c.status === 'pass' ? '✅' : c.status === 'warn' ? '⚠️' : '❌';
  const detail = c.detail ? ` — ${c.detail}` : '';
  console.log(`${icon} ${c.name}${detail}`);
}

console.log(`\n${'─'.repeat(50)}`);
console.log(`✅ Pass: ${passCount}  ⚠️ Warn: ${warnCount}  ❌ Fail: ${failCount}`);

// Save report
const report = {
  timestamp: new Date().toISOString(),
  clientName,
  pipeline: 'clone',
  pass: !hasFail,
  checks,
};
const reportPath = resolve(dirs.geoData, 'quality-report.json');
writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(`\nFull report: ${reportPath}`);

if (hasFail) {
  console.error('\n❌ Quality check FAILED. Fix issues before deploying.');
  process.exit(1);
}

console.log('\n✅ Quality check PASSED. Site is ready for deployment.');
console.log(`\nPreview: cd "${distDir}" && python3 -m http.server 8888`);

// ── Helpers ──────────────────────────────────────────────────────────────────

function findHtmlFiles(dir: string): string[] {
  const results: string[] = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith('_')) {
      results.push(...findHtmlFiles(full).map(f => `${entry.name}/${f}`));
    } else if (entry.name === 'index.html') {
      results.push(entry.name);
    }
  }
  return results;
}
