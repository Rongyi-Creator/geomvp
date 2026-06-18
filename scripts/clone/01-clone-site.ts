/**
 * Clone Pipeline Step 1: Playwright-based site cloning
 * Usage: pnpm clone:site <url> <client-name>
 *
 * Uses a headless browser to render each page, letting JS execute
 * so builder platforms (one.com, Wix, Squarespace, etc.) compute
 * their layout. Captures the post-JS DOM with all inline styles
 * and computed class states baked in.
 *
 * Then internalizes all CSS and images for a self-contained snapshot.
 */

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { createHash } from 'crypto';
import * as cheerio from 'cheerio';
import { chromium, type Browser, type Page } from 'playwright';
import { getCloneDir } from '../config.js';

const [url, clientName] = process.argv.slice(2);
if (!url || !clientName) {
  console.error('Usage: pnpm clone:site <url> <client-name>');
  process.exit(1);
}

const dirs = getCloneDir(clientName);
mkdirSync(dirs.raw, { recursive: true });
mkdirSync(dirs.css, { recursive: true });
mkdirSync(dirs.images, { recursive: true });
mkdirSync(dirs.geoData, { recursive: true });

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const base = new URL(url);

interface PageEntry {
  url: string;
  slug: string;
  title: string;
}

// ── Launch browser ──────────────────────────────────────────────────────────

console.log(`\n📡 Cloning (Playwright): ${url}`);
console.log(`   Client: ${clientName}\n`);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  userAgent: UA,
  viewport: { width: 1440, height: 900 },
  ignoreHTTPSErrors: true,
});

// ── Crawl all pages ─────────────────────────────────────────────────────────

const visited = new Set<string>();
const queue = [url];
const pages: PageEntry[] = [];
const allHtml = new Map<string, string>();

while (queue.length > 0 && pages.length < 50) {
  const current = queue.shift()!;
  const normalized = normalizeUrl(current);
  if (visited.has(normalized)) continue;
  visited.add(normalized);

  try {
    const page = await context.newPage();
    const renderedHtml = await renderPage(page, current);
    await page.close();

    if (!renderedHtml) continue;

    const slug = urlToSlug(current);
    const $ = cheerio.load(renderedHtml);
    const title = $('title').text().trim() || slug;

    pages.push({ url: current, slug, title });
    allHtml.set(slug, renderedHtml);
    process.stdout.write(`\r  Rendered ${pages.length} pages...`);

    // Discover internal links from the rendered DOM
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      if (!href) return;
      try {
        const abs = new URL(href, current).href;
        const absNorm = normalizeUrl(abs);
        if (abs.startsWith(base.origin) && !visited.has(absNorm) &&
            !abs.match(/\.(pdf|jpg|jpeg|png|gif|svg|css|js|xml|ico|zip|mp4|mp3)(\?|$)/i)) {
          queue.push(abs);
        }
      } catch { /* invalid URL */ }
    });

    await new Promise(r => setTimeout(r, 300));
  } catch (err) {
    console.error(`\n  ⚠ Failed to render: ${current} — ${(err as Error).message}`);
  }
}
console.log();

if (pages.length === 0) {
  await browser.close();
  console.error('\n❌ No pages cloned. Site may require authentication or have JS issues.');
  process.exit(1);
}

// ── Download CSS ────────────────────────────────────────────────────────────

const cssMap = new Map<string, string>();
const downloadedCss = new Set<string>();

console.log('  Downloading CSS...');
for (const [slug, html] of allHtml) {
  const $ = cheerio.load(html);
  $('link[rel="stylesheet"]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    try {
      const absUrl = new URL(href, pages.find(p => p.slug === slug)!.url).href;
      if (!downloadedCss.has(absUrl)) downloadedCss.add(absUrl);
    } catch { /* skip invalid */ }
  });
}

for (const cssUrl of downloadedCss) {
  try {
    const res = await fetch(cssUrl, { headers: { 'User-Agent': UA } });
    if (!res.ok) continue;
    const cssText = await res.text();
    const hash = createHash('md5').update(cssUrl).digest('hex').slice(0, 8);
    const filename = `style-${hash}.css`;
    writeFileSync(resolve(dirs.css, filename), cssText);
    cssMap.set(cssUrl, `_assets/css/${filename}`);
  } catch { /* skip */ }
}
console.log(`    ${cssMap.size} CSS files downloaded`);

// ── Download images ─────────────────────────────────────────────────────────

const imgMap = new Map<string, string>();
const downloadedImgs = new Set<string>();

console.log('  Downloading images...');
for (const [slug, html] of allHtml) {
  const $ = cheerio.load(html);
  const pageUrl = pages.find(p => p.slug === slug)!.url;

  // <img src>
  $('img[src]').each((_, el) => {
    const src = $(el).attr('src');
    if (!src) return;
    try {
      const absUrl = new URL(src, pageUrl).href;
      if (!downloadedImgs.has(absUrl) && absUrl.startsWith('http')) downloadedImgs.add(absUrl);
    } catch { /* skip */ }
  });

  // <img srcset> and <source srcset>
  $('img[srcset], source[srcset]').each((_, el) => {
    const srcset = $(el).attr('srcset') || '';
    for (const part of srcset.split(',')) {
      const imgSrc = part.trim().split(/\s+/)[0];
      if (!imgSrc) continue;
      try {
        const absUrl = new URL(imgSrc, pageUrl).href;
        if (!downloadedImgs.has(absUrl) && absUrl.startsWith('http')) downloadedImgs.add(absUrl);
      } catch { /* skip */ }
    }
  });

  // CSS background-image in inline styles
  $('[style]').each((_, el) => {
    const style = $(el).attr('style') || '';
    const bgMatches = [...style.matchAll(/url\(['"]?(https?:\/\/[^'")\s]+)['"]?\)/g)];
    for (const m of bgMatches) {
      if (!downloadedImgs.has(m[1])) downloadedImgs.add(m[1]);
    }
  });
}

let imgCount = 0;
for (const imgUrl of downloadedImgs) {
  try {
    const res = await fetch(imgUrl, { headers: { 'User-Agent': UA } });
    if (!res.ok) continue;
    const buf = Buffer.from(await res.arrayBuffer());

    const urlPath = new URL(imgUrl).pathname;
    const ext = (urlPath.match(/\.(jpg|jpeg|png|gif|webp|svg|avif|ico)$/i) || ['.bin'])[0];
    const hash = createHash('md5').update(imgUrl).digest('hex').slice(0, 8);
    const baseName = urlPath.split('/').pop()?.replace(/[^a-zA-Z0-9._-]/g, '_') || `img-${hash}`;
    const filename = baseName.includes('.') ? baseName : `${baseName}${ext}`;

    writeFileSync(resolve(dirs.images, filename), buf);
    imgMap.set(imgUrl, `_assets/images/${filename}`);
    imgCount++;
  } catch { /* skip */ }
}
console.log(`    ${imgCount} images downloaded`);

// ── Rewrite HTML with local asset paths & save ──────────────────────────────

console.log('  Rewriting asset URLs...');
for (const [slug, html] of allHtml) {
  const $ = cheerio.load(html);
  const pageUrl = pages.find(p => p.slug === slug)!.url;

  // Rewrite <link rel="stylesheet"> hrefs
  $('link[rel="stylesheet"]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    try {
      const absUrl = new URL(href, pageUrl).href;
      const localPath = cssMap.get(absUrl);
      if (localPath) {
        $(el).attr('href', `/${localPath}`);
      } else if (href.startsWith('/') && !href.startsWith('//')) {
        $(el).attr('href', absUrl);
      }
    } catch { /* keep original */ }
  });

  // Rewrite <img> src
  $('img[src]').each((_, el) => {
    const src = $(el).attr('src');
    if (!src) return;
    try {
      const absUrl = new URL(src, pageUrl).href;
      const localPath = imgMap.get(absUrl);
      if (localPath) {
        $(el).attr('src', `/${localPath}`);
      } else if (src.startsWith('/') && !src.startsWith('//')) {
        $(el).attr('src', absUrl);
      }
    } catch { /* keep original */ }
  });

  // Rewrite <img srcset> and <source srcset>
  $('img[srcset], source[srcset]').each((_, el) => {
    let srcset = $(el).attr('srcset') || '';
    for (const [imgUrl, localPath] of imgMap) {
      srcset = srcset.replaceAll(imgUrl, `/${localPath}`);
    }
    $(el).attr('srcset', srcset);
  });

  // Rewrite inline style background-image URLs
  $('[style]').each((_, el) => {
    let style = $(el).attr('style') || '';
    const bgMatches = [...style.matchAll(/url\(['"]?(https?:\/\/[^'")\s]+)['"]?\)/g)];
    for (const m of bgMatches) {
      const localPath = imgMap.get(m[1]);
      if (localPath) {
        style = style.replace(m[0], `url('/${localPath}')`);
      }
    }
    $(el).attr('style', style);
  });

  writeFileSync(resolve(dirs.raw, `${slug}.html`), $.html());
}

// ── Also rewrite URLs inside downloaded CSS files ───────────────────────────

for (const [originalUrl, localPath] of cssMap) {
  const cssPath = resolve(dirs.base, localPath);
  if (!existsSync(cssPath)) continue;
  let cssText = readFileSync(cssPath, 'utf8');

  for (const [imgUrl, imgLocal] of imgMap) {
    cssText = cssText.replaceAll(imgUrl, `/${imgLocal}`);
  }

  writeFileSync(cssPath, cssText);
}

// ── Save page map ───────────────────────────────────────────────────────────

const pageMap = pages.map(p => ({
  url: p.url,
  slug: p.slug,
  title: p.title,
  path: urlToPath(p.url),
}));

writeFileSync(resolve(dirs.geoData, 'page-map.json'), JSON.stringify(pageMap, null, 2));
writeFileSync(resolve(dirs.geoData, 'asset-map.json'), JSON.stringify({
  css: Object.fromEntries(cssMap),
  images: Object.fromEntries(imgMap),
}, null, 2));

await browser.close();

console.log(`\n✅ Clone complete (Playwright):`);
console.log(`   Pages:  ${pages.length}`);
console.log(`   CSS:    ${cssMap.size} files`);
console.log(`   Images: ${imgCount} files`);
console.log(`   Output: ${dirs.raw}`);
console.log(`\nNext: pnpm clone:extract ${clientName}`);

// ══════════════════════════════════════════════════════════════════════════════
// Helpers
// ══════════════════════════════════════════════════════════════════════════════

async function renderPage(page: Page, pageUrl: string): Promise<string | null> {
  try {
    const response = await page.goto(pageUrl, {
      waitUntil: 'networkidle',
      timeout: 30_000,
    });

    if (!response || response.status() >= 400) return null;
    const contentType = response.headers()['content-type'] || '';
    if (!contentType.includes('html')) return null;

    // SPA builders (one.com, Wix, etc.) render content via JS after shell loads.
    // Wait for body to have substantial content before capturing.
    try {
      await page.waitForFunction(() => {
        const body = document.body;
        return body && body.children.length > 3 && body.innerHTML.length > 500;
      }, { timeout: 15_000 });
    } catch {
      // Fallback: extra wait for slow SPAs
      await page.waitForTimeout(3000);
    }

    await dismissOverlays(page);
    await autoScroll(page);
    await page.waitForTimeout(500);

    // Verify body has content; if empty, retry with a fresh page load
    let bodyLen = await page.evaluate(() => document.body.innerHTML.length);
    if (bodyLen < 100) {
      await page.reload({ waitUntil: 'networkidle', timeout: 15_000 }).catch(() => {});
      await page.waitForTimeout(3000);
      bodyLen = await page.evaluate(() => document.body.innerHTML.length);
      if (bodyLen < 100) return null;
    }

    return await page.content();
  } catch {
    return null;
  }
}

async function dismissOverlays(page: Page): Promise<void> {
  // Common cookie-consent button selectors across platforms
  const consentSelectors = [
    // Generic patterns
    'button[id*="accept"]', 'button[id*="Accept"]',
    'button[class*="accept"]', 'button[class*="Accept"]',
    'button[id*="consent"]', 'button[id*="Consent"]',
    'a[id*="accept"]', 'a[class*="accept"]',
    // CookieBot
    '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
    '#CybotCookiebotDialogBodyButtonAccept',
    // OneTrust
    '#onetrust-accept-btn-handler',
    // Cookieyes
    '.cky-btn-accept',
    // GDPR Cookie Compliance
    '.cli-plugin-button[data-cli_action="accept"]',
    // Generic close buttons on modals
    '.cookie-banner button', '.cookie-notice button',
    '[data-testid="cookie-accept"]',
  ];

  for (const selector of consentSelectors) {
    try {
      const btn = page.locator(selector).first();
      if (await btn.isVisible({ timeout: 200 })) {
        await btn.click({ timeout: 1000 });
        await page.waitForTimeout(300);
        break;
      }
    } catch { /* not found, try next */ }
  }
}

async function autoScroll(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const distance = 400;
    const delay = 100;
    let totalHeight = 0;
    const scrollHeight = document.body.scrollHeight;

    while (totalHeight < scrollHeight) {
      window.scrollBy(0, distance);
      totalHeight += distance;
      await new Promise(r => setTimeout(r, delay));
    }

    window.scrollTo(0, 0);
  });
}

function normalizeUrl(u: string): string {
  try {
    const parsed = new URL(u);
    let path = parsed.pathname.replace(/\/+$/, '') || '/';
    return `${parsed.origin}${path}`;
  } catch {
    return u;
  }
}

function urlToSlug(pageUrl: string): string {
  const path = new URL(pageUrl).pathname.replace(/^\/|\/$/g, '') || 'index';
  return path.replace(/\//g, '--');
}

function urlToPath(pageUrl: string): string {
  const path = new URL(pageUrl).pathname.replace(/\/+$/, '') || '/';
  if (path === '/') return '/';
  return path.endsWith('/') ? path : `${path}/`;
}
