/**
 * Step 5: Quality check on generated site
 * Usage:  pnpm qa <client-name> [--scheme scheme-a]
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { execSync } from 'child_process';
import { getClientDir } from './config.js';

const [clientName, schemeFlag, schemeId = 'scheme-a'] = process.argv.slice(2);

if (!clientName) {
  console.error('Usage: pnpm qa <client-name> [--scheme scheme-a|scheme-b|scheme-c]');
  process.exit(1);
}

const dirs = getClientDir(clientName);
const distDir = resolve(dirs.site, `dist-${schemeFlag === '--scheme' ? schemeId : 'scheme-a'}`);

if (!existsSync(distDir)) {
  console.error(`❌ No build found at ${distDir}. Run: pnpm generate ${clientName} first.`);
  process.exit(1);
}

interface QAResult {
  pass: boolean;
  checks: Array<{ name: string; status: 'pass' | 'fail' | 'warn'; detail: string }>;
}

const result: QAResult = { pass: true, checks: [] };

function check(name: string, ok: boolean, detail: string, isWarn = false) {
  const status = ok ? 'pass' : (isWarn ? 'warn' : 'fail');
  if (!ok && !isWarn) result.pass = false;
  result.checks.push({ name, status, detail });
}

function readHtml(path: string) {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

// ── 1. JSON-LD Validation ──────────────────────────────────────────────────────
function extractJsonLd(html: string): object[] {
  const schemas: object[] = [];
  const matches = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  for (const m of matches) {
    try { schemas.push(JSON.parse(m[1])); } catch { /* invalid */ }
  }
  return schemas;
}

const indexHtml = readHtml(resolve(distDir, 'index.html'));
const indexSchemas = extractJsonLd(indexHtml);
const localBusiness = indexSchemas.find((s: any) => s['@type'] === 'LocalBusiness' || s['@type'] === 'MedicalBusiness') as any;

check('LocalBusiness schema present', !!localBusiness, localBusiness ? 'Found' : 'Missing on homepage');
if (localBusiness) {
  check('LB: name',    !!localBusiness.name,      `name: ${localBusiness.name ?? 'MISSING'}`);
  check('LB: address', !!localBusiness.address,   `address: ${localBusiness.address ? 'present' : 'MISSING'}`);
  check('LB: phone',   !!localBusiness.telephone, `phone: ${localBusiness.telephone ?? 'MISSING'}`, true);
  check('LB: hours',   Array.isArray(localBusiness.openingHoursSpecification) && localBusiness.openingHoursSpecification.length > 0,
    `hours: ${localBusiness.openingHoursSpecification?.length ?? 0} entries`, true);
}

const faqHtml = readHtml(resolve(distDir, 'faq', 'index.html'));
const faqSchemas = extractJsonLd(faqHtml);
const faqPage = faqSchemas.find((s: any) => s['@type'] === 'FAQPage') as any;
check('FAQPage schema present', !!faqPage, faqPage ? `${faqPage.mainEntity?.length ?? 0} questions` : 'Missing on /faq/');

// ── 2. Content integrity ────────────────────────────────────────────────────────
const htmlFiles = readdirSync(distDir, { recursive: true })
  .filter((f): f is string => f.toString().endsWith('index.html'));
check('Page count', htmlFiles.length >= 5, `${htmlFiles.length} pages (need ≥ 5)`);

let externalCdnRefs = 0;
let missingAlt = 0;
let externalLinks = 0;

for (const file of htmlFiles) {
  const html = readHtml(resolve(distDir, file));
  if (/src="https?:\/\/[^"]*one\.com/i.test(html)) externalCdnRefs++;
  missingAlt += [...html.matchAll(/<img(?![^>]*alt=)[^>]*>/g)].length;
  if (/href="https?:\/\/[^"]*planway/i.test(html)) externalLinks++;
}

check('No CDN references', externalCdnRefs === 0, `${externalCdnRefs} external CDN img src found`);
check('All images have alt', missingAlt === 0, `${missingAlt} images missing alt`, missingAlt > 0 && missingAlt <= 2);
check('Booking links preserved', externalLinks > 0, `${externalLinks} pages have booking link`, true);

// ── 3. SEO basics ───────────────────────────────────────────────────────────────
const titles = new Set<string>();
const descs = new Set<string>();
let h1Issues = 0;

for (const file of htmlFiles) {
  const html = readHtml(resolve(distDir, file));
  const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? '';
  const desc = html.match(/<meta[^>]+name="description"[^>]+content="([^"]+)"/)?.[1] ?? '';
  const h1Count = [...html.matchAll(/<h1[^>]*>/g)].length;

  titles.add(title);
  descs.add(desc);
  if (h1Count !== 1) h1Issues++;
}

check('Unique titles', titles.size === htmlFiles.length, `${titles.size}/${htmlFiles.length} unique`);
check('Unique descriptions', descs.size >= htmlFiles.length - 1, `${descs.size}/${htmlFiles.length} unique`);
check('Single H1 per page', h1Issues === 0, h1Issues === 0 ? 'OK' : `${h1Issues} pages with 0 or 2+ H1`);
check('robots.txt exists', existsSync(resolve(distDir, 'robots.txt')), '');
check('llms.txt exists', existsSync(resolve(distDir, 'llms.txt')), '');
check('sitemap exists', existsSync(resolve(distDir, 'sitemap-index.xml')), '');

// ── 4. Lighthouse (if available) ────────────────────────────────────────────────
let lighthouseRan = false;
try {
  const previewPort = 4399;
  const previewProc = execSync(
    `pnpm preview --port ${previewPort} --root "${dirs.site}" &`,
    { cwd: dirs.site, encoding: 'utf8', timeout: 5000 }
  );
  await new Promise(r => setTimeout(r, 2000));

  execSync(
    `pnpm dlx @lhci/cli@latest collect --url=http://localhost:${previewPort}/ --settings.chromeFlags="--headless"`,
    { cwd: dirs.site, stdio: 'ignore', timeout: 60_000 }
  );

  const lhrFiles = readdirSync(resolve(dirs.site, '.lighthouseci')).filter(f => f.endsWith('.json'));
  if (lhrFiles.length > 0) {
    const lhr = JSON.parse(readFileSync(resolve(dirs.site, '.lighthouseci', lhrFiles[0]), 'utf8'));
    const scores = lhr.categories;
    check('LH Performance ≥90', scores.performance?.score >= 0.9,  `${Math.round(scores.performance?.score * 100)}`, false);
    check('LH SEO ≥95',         scores.seo?.score >= 0.95,         `${Math.round(scores.seo?.score * 100)}`, false);
    check('LH Accessibility ≥90',scores.accessibility?.score >= 0.9,`${Math.round(scores.accessibility?.score * 100)}`, false);
    lighthouseRan = true;
  }
  execSync(`pkill -f "astro preview"`, { stdio: 'ignore' });
} catch {
  if (!lighthouseRan) {
    result.checks.push({ name: 'Lighthouse', status: 'warn', detail: 'Skipped (run manually)' });
  }
}

// ── Report ──────────────────────────────────────────────────────────────────────
const passCount = result.checks.filter(c => c.status === 'pass').length;
const failCount = result.checks.filter(c => c.status === 'fail').length;
const warnCount = result.checks.filter(c => c.status === 'warn').length;

console.log('\n=== Quality Report ===');
for (const c of result.checks) {
  const icon = c.status === 'pass' ? '✅' : c.status === 'warn' ? '⚠️' : '❌';
  const detail = c.detail ? `  — ${c.detail}` : '';
  console.log(`${icon} ${c.name}${detail}`);
}

console.log(`\n${'─'.repeat(40)}`);
console.log(`✅ Pass: ${passCount}  ⚠️ Warn: ${warnCount}  ❌ Fail: ${failCount}`);

const reportPath = resolve(dirs.structured, 'quality-report.json');
const report = { timestamp: new Date().toISOString(), clientName, ...result };
import { writeFileSync as wfs } from 'fs';
wfs(reportPath, JSON.stringify(report, null, 2));
console.log(`\nFull report: ${reportPath}`);

if (!result.pass) {
  console.error('\n❌ Quality check FAILED. Fix issues before deploying.');
  process.exit(1);
}
console.log('\n✅ Quality check PASSED. Site is ready for deployment.');
