/**
 * Edge Pipeline Step 5 (Vercel): Verify deployed Vercel Edge Function
 * Usage: tsx scripts/edge/05-verify-vercel.ts <client-name> [--url https://custom-url.vercel.app]
 *
 * Reads clients/<client>/vercel-edge/.vercel/project.json for the deployment URL
 * (or use --url to specify explicitly).
 *
 * Checks:
 * 1. Homepage returns 200
 * 2. JSON-LD LocalBusiness schema injected
 * 3. Meta description rewritten
 * 4. <title> rewritten
 * 5. robots.txt serves AI bot policy
 * 6. sitemap.xml is generated
 * 7. Service page gets MedicalTherapy schema
 * 8. FAQ page gets FAQPage schema
 * 9. canonical URL points to canonical host
 */

import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { getCloneDir, ROOT } from '../config.js';

const args = process.argv.slice(2);
const clientName = args[0];
if (!clientName) {
  console.error('Usage: tsx scripts/edge/05-verify-vercel.ts <client-name> [--url https://...vercel.app]');
  process.exit(1);
}

const urlFlagIdx = args.indexOf('--url');
let baseUrl: string | null = urlFlagIdx >= 0 ? args[urlFlagIdx + 1] : null;

// Try to read deployment URL from .vercel/project.json or last deploy output
const vercelDir = resolve(ROOT, 'clients', clientName, 'vercel-edge');
if (!baseUrl) {
  const projectJson = resolve(vercelDir, '.vercel', 'project.json');
  if (!existsSync(projectJson)) {
    console.error(`\n❌ Cannot determine deployment URL.`);
    console.error(`   Either pass --url https://...vercel.app or link the project first.`);
    process.exit(1);
  }
}

// Load pages meta to find service + faq pages
const dirs = getCloneDir(clientName);
const pagesMetaPath = resolve(dirs.geoData, 'pages-meta.json');
let pagesMeta: Array<{ path: string; pageType: string; isEmpty: boolean }> = [];
if (existsSync(pagesMetaPath)) {
  pagesMeta = JSON.parse(readFileSync(pagesMetaPath, 'utf8'));
}

const servicePage = pagesMeta.find((p) => p.pageType === 'service' && !p.isEmpty);
const faqPage = pagesMeta.find((p) => p.pageType === 'faq' && !p.isEmpty);

// If no URL provided, ask user to specify
if (!baseUrl) {
  console.error(`\n⚠️  No --url provided. After deployment, the Vercel URL appears in the deploy output.`);
  console.error(`   Rerun with: tsx scripts/edge/05-verify-vercel.ts ${clientName} --url https://...vercel.app`);
  process.exit(1);
}

const base = (baseUrl as string).replace(/\/$/, '');

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
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    results.push({ name, pass: false, detail: msg });
    console.log(` ❌ ${msg}`);
  }
}

async function fetchText(url: string, ua = 'PerplexityBot/1.0'): Promise<{ status: number; body: string; headers: Headers }> {
  const res = await fetch(url, {
    headers: { 'User-Agent': ua, Accept: 'text/html,application/xhtml+xml,*/*' },
  });
  const body = await res.text();
  return { status: res.status, body, headers: res.headers };
}

console.log(`\n🔍 Verifying Vercel Edge Function: ${base}\n`);

await check('Homepage returns 200', async () => {
  const { status } = await fetchText(`${base}/`);
  return { pass: status === 200, detail: `HTTP ${status}` };
});

await check('JSON-LD LocalBusiness injected', async () => {
  const { body } = await fetchText(`${base}/`);
  const hasSchema = body.includes('"@type"') && body.includes('application/ld+json');
  const hasLocalBusiness = body.includes('LocalBusiness') || body.includes('MedicalBusiness');
  return {
    pass: hasSchema && hasLocalBusiness,
    detail: !hasSchema ? 'No JSON-LD script tag found' : 'LocalBusiness type missing',
  };
});

await check('Meta description rewritten', async () => {
  const { body } = await fetchText(`${base}/`);
  const match = body.match(/<meta\s+name=["']description["'][^>]*content=["']([^"']+)["']/i);
  if (!match) return { pass: false, detail: 'No meta description found' };
  return { pass: match[1].length > 20, detail: `Meta: "${match[1].slice(0, 60)}…"` };
});

await check('Title rewritten', async () => {
  const { body } = await fetchText(`${base}/`);
  const match = body.match(/<title>([^<]*)<\/title>/i);
  if (!match) return { pass: false, detail: 'No <title> found' };
  return { pass: match[1].length > 5, detail: `Title: "${match[1].slice(0, 60)}"` };
});

await check('robots.txt — AI bot policy', async () => {
  const { status, body } = await fetchText(`${base}/robots.txt`, 'curl/8.0');
  const hasPolicy = body.includes('OAI-SearchBot') && body.includes('GPTBot');
  return {
    pass: status === 200 && hasPolicy,
    detail: status !== 200 ? `HTTP ${status}` : 'Missing bot policy entries',
  };
});

await check('sitemap.xml generated', async () => {
  const { status, body } = await fetchText(`${base}/sitemap.xml`, 'Googlebot/2.1');
  const hasUrls = body.includes('<urlset') && body.includes('<loc>');
  return {
    pass: status === 200 && hasUrls,
    detail: status !== 200 ? `HTTP ${status}` : 'No <loc> entries in sitemap',
  };
});

if (servicePage) {
  await check(`Service page schema (${servicePage.path})`, async () => {
    const { body } = await fetchText(`${base}${servicePage.path}`);
    const hasMedical = body.includes('MedicalTherapy');
    return {
      pass: hasMedical,
      detail: 'MedicalTherapy schema not found',
    };
  });
}

if (faqPage) {
  await check(`FAQ page schema (${faqPage.path})`, async () => {
    const { body } = await fetchText(`${base}${faqPage.path}`);
    const hasFaq = body.includes('FAQPage');
    return {
      pass: hasFaq,
      detail: 'FAQPage schema not found',
    };
  });
}

await check('Canonical URL uses canonical host', async () => {
  const { body } = await fetchText(`${base}/`);
  const match = body.match(/<link\s+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i);
  if (!match) return { pass: false, detail: 'No canonical link found' };
  // Canonical should NOT point to vercel.app — it should point to the real domain
  const isVercelApp = match[1].includes('.vercel.app');
  return {
    pass: !isVercelApp,
    detail: isVercelApp ? `Canonical still points to vercel.app: ${match[1]}` : `Canonical: ${match[1]}`,
  };
});

// ── Summary ───────────────────────────────────────────────────────────────────

const passed = results.filter((r) => r.pass).length;
const total = results.length;
console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed}/${total} checks passed`);

if (passed === total) {
  console.log(`✅ All checks passed — Vercel Edge Function is healthy!\n`);
} else {
  const failed = results.filter((r) => !r.pass);
  console.log(`\n❌ Failed checks:`);
  for (const f of failed) {
    console.log(`   • ${f.name}: ${f.detail}`);
  }
  console.log('');
  process.exit(1);
}
