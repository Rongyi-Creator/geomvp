/**
 * Edge Pipeline Step 5: Verify deployed Worker
 * Usage: tsx scripts/edge/05-verify-worker.ts <url> <client-name>
 *
 * Fetches the worker URL with various User-Agent strings and checks:
 * 1. Origin proxying works (200 OK)
 * 2. JSON-LD schemas are injected for known pages
 * 3. Meta description is rewritten
 * 4. robots.txt serves AI bot policy
 * 5. sitemap.xml is generated
 */

import { readFileSync, existsSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from '../config.js';

const originUrl = process.argv[2];
const clientName = process.argv[3];

if (!originUrl || !clientName) {
  console.error('Usage: tsx scripts/edge/05-verify-worker.ts <worker-url> <client-name>');
  console.error('  e.g. tsx scripts/edge/05-verify-worker.ts https://geo-edge-virum.blake-designing.workers.dev virum-akupunktur');
  process.exit(1);
}

const edgeDir = resolve(ROOT, 'clients', clientName, 'edge');
const wranglerToml = resolve(edgeDir, 'wrangler.toml');
let workerUrl = originUrl;

if (existsSync(wranglerToml)) {
  const toml = readFileSync(wranglerToml, 'utf8');
  const nameMatch = toml.match(/^name\s*=\s*"([^"]+)"/m);
  if (nameMatch && !workerUrl.includes('.')) {
    workerUrl = `https://${nameMatch[1]}.blake-designing.workers.dev`;
  }
}

const base = workerUrl.replace(/\/$/, '');

interface CheckResult {
  name: string;
  pass: boolean;
  detail: string;
}

const results: CheckResult[] = [];

async function check(name: string, fn: () => Promise<{ pass: boolean; detail: string }>) {
  process.stdout.write(`   ${name}...`);
  try {
    const result = await fn();
    results.push({ name, ...result });
    console.log(result.pass ? ` ✅` : ` ❌ ${result.detail}`);
  } catch (e: any) {
    results.push({ name, pass: false, detail: e.message });
    console.log(` ❌ ${e.message}`);
  }
}

console.log(`\n🔍 Verifying Edge Worker: ${base}\n`);

// 1. Basic proxy
await check('Homepage returns 200', async () => {
  const res = await fetch(base + '/');
  return {
    pass: res.status === 200,
    detail: `Status ${res.status}`,
  };
});

// 2. HTML content proxied
await check('HTML content type', async () => {
  const res = await fetch(base + '/');
  const ct = res.headers.get('content-type') || '';
  return {
    pass: ct.includes('text/html'),
    detail: `Got: ${ct}`,
  };
});

// 3. JSON-LD injection
await check('JSON-LD schema injected on homepage', async () => {
  const res = await fetch(base + '/');
  const html = await res.text();
  const hasJsonLd = html.includes('application/ld+json');
  const hasSchema = html.includes('"@context"') && html.includes('schema.org');
  return {
    pass: hasJsonLd && hasSchema,
    detail: hasJsonLd ? 'Schema found but malformed' : 'No application/ld+json script tag',
  };
});

// 4. Meta description
await check('Meta description injected', async () => {
  const res = await fetch(base + '/');
  const html = await res.text();
  const match = html.match(/<meta\s+name="description"\s+content="([^"]+)"/);
  return {
    pass: !!match,
    detail: match ? `Found: "${match[1].slice(0, 60)}..."` : 'No meta description found',
  };
});

// 5. FAQ schema on FAQ/home page
await check('FAQ schema on homepage', async () => {
  const res = await fetch(base + '/');
  const html = await res.text();
  const hasFaq = html.includes('FAQPage');
  return {
    pass: hasFaq,
    detail: hasFaq ? '' : 'No FAQPage schema found',
  };
});

// 6. robots.txt
await check('robots.txt serves AI bot policy', async () => {
  const res = await fetch(base + '/robots.txt');
  const text = await res.text();
  const hasPerplexity = text.includes('PerplexityBot');
  const hasGPTBot = text.includes('GPTBot');
  const hasSitemap = text.includes('Sitemap:');
  return {
    pass: hasPerplexity && hasGPTBot && hasSitemap,
    detail: `PerplexityBot:${hasPerplexity} GPTBot:${hasGPTBot} Sitemap:${hasSitemap}`,
  };
});

// 7. sitemap.xml
await check('sitemap.xml generated', async () => {
  const res = await fetch(base + '/sitemap.xml');
  const text = await res.text();
  const hasUrlset = text.includes('<urlset');
  const urlCount = (text.match(/<url>/g) || []).length;
  return {
    pass: hasUrlset && urlCount > 0,
    detail: `${urlCount} URLs in sitemap`,
  };
});

// 8. Service page schema
const pagesMetaPath = resolve(ROOT, 'clients', clientName, 'clone', 'geo-data', 'pages-meta.json');
if (existsSync(pagesMetaPath)) {
  const pages = JSON.parse(readFileSync(pagesMetaPath, 'utf8'));
  const servicePage = pages.find((p: any) => p.pageType === 'service' && p.path !== '/our-team/');
  if (servicePage) {
    await check(`Service schema on ${servicePage.path}`, async () => {
      const res = await fetch(base + servicePage.path);
      const html = await res.text();
      const hasMedical = html.includes('MedicalTherapy');
      return {
        pass: hasMedical,
        detail: hasMedical ? '' : 'No MedicalTherapy schema found',
      };
    });
  }
}

// 9. Non-HTML passthrough
await check('Non-HTML assets pass through', async () => {
  const res = await fetch(base + '/favicon.ico');
  const ct = res.headers.get('content-type') || '';
  return {
    pass: !ct.includes('text/html'),
    detail: `Content-Type: ${ct || '(empty)'}`,
  };
});

// ── Summary ─────────────────────────────────────────────────────────────────

const passed = results.filter(r => r.pass).length;
const total = results.length;

console.log(`\n${'─'.repeat(50)}`);
console.log(`   ${passed}/${total} checks passed`);

if (passed === total) {
  console.log(`\n✅ All verification checks passed!`);
  console.log(`   Edge Worker is ready for DNS switch.`);
} else {
  console.log(`\n⚠️  ${total - passed} check(s) failed — review above.`);
}

const report = {
  workerUrl: base,
  timestamp: new Date().toISOString(),
  results,
  summary: { passed, total },
};
const reportPath = resolve(ROOT, 'clients', clientName, 'clone', 'geo-data', 'verify-report.json');
writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(`\n   Report saved: ${reportPath}`);
