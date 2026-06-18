/**
 * Step 1: Compatibility check
 * Input:  a URL (argv[2])
 * Output: { compatible, page_count_estimate, platform_guess, warnings }
 */

const url = process.argv[2];
if (!url) {
  console.error('Usage: pnpm check <url>');
  process.exit(1);
}

interface CheckResult {
  compatible: boolean;
  url: string;
  page_count_estimate: number;
  platform_guess: string;
  warnings: string[];
}

async function checkCompatibility(targetUrl: string): Promise<CheckResult> {
  const warnings: string[] = [];

  // Fetch homepage
  let html = '';
  let status = 0;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    const res = await fetch(targetUrl, {
      signal: controller.signal,
      headers: { 'User-Agent': 'GEO-Reforge-Checker/1.0' },
    });
    clearTimeout(timeout);
    status = res.status;
    html = await res.text();
  } catch (err) {
    return {
      compatible: false,
      url: targetUrl,
      page_count_estimate: 0,
      platform_guess: 'unknown',
      warnings: [`Fetch failed: ${(err as Error).message}`],
    };
  }

  if (status !== 200) {
    return {
      compatible: false,
      url: targetUrl,
      page_count_estimate: 0,
      platform_guess: 'unknown',
      warnings: [`HTTP ${status}`],
    };
  }

  // Extract text content (rough)
  const textContent = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  if (textContent.length < 200) {
    warnings.push('Page has very little text — may be JS-rendered (SPA). Scrape may be incomplete.');
  }

  // Check for nav / internal links
  const internalLinks = [...html.matchAll(/href="(\/[^"]*?)"/g)].map(m => m[1]);
  const uniqueLinks = [...new Set(internalLinks)].filter(l => !l.includes('.') || l.endsWith('/'));
  if (uniqueLinks.length < 2) {
    warnings.push('Few internal links found — may be a single-page site.');
  }

  // Check for contact info
  const hasPhone = /\+?\d[\d\s\-().]{7,}/u.test(html);
  const hasEmail = /@[a-z0-9.-]+\.[a-z]{2,}/i.test(html);
  const hasAddress = /\b\d{4,5}\b/.test(html); // zip code heuristic
  if (!hasPhone && !hasEmail && !hasAddress) {
    warnings.push('No contact information detected (phone/email/zip). Verify site has NAP data.');
  }

  // Check for login wall
  if (/login|sign.?in|password/i.test(html.slice(0, 5000))) {
    warnings.push('Possible login wall detected on homepage.');
  }

  // Platform detection
  let platform_guess = 'unknown';
  const generator = html.match(/<meta[^>]+name="generator"[^>]+content="([^"]+)"/i)?.[1] ?? '';
  if (generator) platform_guess = generator;
  else if (/one\.com/i.test(html)) platform_guess = 'one.com';
  else if (/wix\.com/i.test(html)) platform_guess = 'Wix';
  else if (/squarespace/i.test(html)) platform_guess = 'Squarespace';
  else if (/shopify/i.test(html)) platform_guess = 'Shopify';
  else if (/wordpress/i.test(html)) platform_guess = 'WordPress';

  // Page count estimate from nav links
  const navLinks = [...html.matchAll(/<(?:nav|header)[^>]*>([\s\S]*?)<\/(?:nav|header)>/gi)]
    .flatMap(m => [...m[1].matchAll(/href="([^"]+)"/g)].map(l => l[1]));
  const page_count_estimate = Math.max(uniqueLinks.length, navLinks.length, 3);

  const compatible = warnings.filter(w =>
    w.includes('Fetch failed') || w.includes('HTTP ') || w.includes('login wall')
  ).length === 0;

  return { compatible, url: targetUrl, page_count_estimate, platform_guess, warnings };
}

const result = await checkCompatibility(url);
console.log('\n=== Compatibility Check ===');
console.log(JSON.stringify(result, null, 2));

if (!result.compatible) {
  console.error('\n❌ Site is NOT compatible for automated processing.');
  process.exit(1);
}

const icon = result.warnings.length > 0 ? '⚠️' : '✅';
console.log(`\n${icon} Site is compatible. Proceed with: pnpm scrape ${url} <client-name>`);
