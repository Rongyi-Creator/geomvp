/**
 * Clone Pipeline Step 1: Download full HTML + CSS + images
 * Usage: pnpm clone:site <url> <client-name>
 *
 * Downloads every page as raw HTML, internalizes all CSS and images
 * so the output is a fully self-contained static snapshot.
 */

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { createHash } from 'crypto';
import * as cheerio from 'cheerio';
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

const UA = 'GEO-Reforge-Cloner/1.0 (content migration; contact: hello.rongyi@gmail.com)';
const base = new URL(url);

interface PageEntry {
  url: string;
  slug: string;
  title: string;
}

// ── Crawl all pages ──────────────────────────────────────────────────────────

const visited = new Set<string>();
const queue = [url];
const pages: PageEntry[] = [];
const allHtml = new Map<string, string>();

console.log(`\n📡 Cloning: ${url}`);
console.log(`   Client: ${clientName}\n`);

while (queue.length > 0 && pages.length < 50) {
  const current = queue.shift()!;
  const normalized = normalizeUrl(current);
  if (visited.has(normalized)) continue;
  visited.add(normalized);

  try {
    const res = await fetch(current, {
      headers: { 'User-Agent': UA },
      redirect: 'follow',
    });
    if (!res.ok || !res.headers.get('content-type')?.includes('html')) continue;

    const html = await res.text();
    const slug = urlToSlug(current);
    const $ = cheerio.load(html);
    const title = $('title').text().trim() || slug;

    pages.push({ url: current, slug, title });
    allHtml.set(slug, html);
    process.stdout.write(`\r  Crawled ${pages.length} pages...`);

    // Discover internal links
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

    await new Promise(r => setTimeout(r, 500));
  } catch (err) {
    console.error(`\n  ⚠ Failed to fetch: ${current}`);
  }
}
console.log();

if (pages.length === 0) {
  console.error('\n❌ No pages cloned. Site may be blocking crawlers or using client-side rendering.');
  process.exit(1);
}

// ── Download CSS ─────────────────────────────────────────────────────────────

const cssMap = new Map<string, string>(); // original URL → local filename
const downloadedCss = new Set<string>();

console.log('  Downloading CSS...');
for (const [slug, html] of allHtml) {
  const $ = cheerio.load(html);
  $('link[rel="stylesheet"]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    try {
      const absUrl = new URL(href, pages.find(p => p.slug === slug)!.url).href;
      if (!downloadedCss.has(absUrl)) {
        downloadedCss.add(absUrl);
      }
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

// ── Download images ──────────────────────────────────────────────────────────

const imgMap = new Map<string, string>(); // original URL → local path
const downloadedImgs = new Set<string>();

console.log('  Downloading images...');
for (const [slug, html] of allHtml) {
  const $ = cheerio.load(html);
  const pageUrl = pages.find(p => p.slug === slug)!.url;

  $('img[src]').each((_, el) => {
    const src = $(el).attr('src');
    if (!src) return;
    try {
      const absUrl = new URL(src, pageUrl).href;
      if (!downloadedImgs.has(absUrl) && absUrl.startsWith('http')) {
        downloadedImgs.add(absUrl);
      }
    } catch { /* skip */ }
  });

  // Also grab CSS background images from inline styles
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

    // Derive a clean filename
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

// ── Rewrite HTML with local asset paths & save ───────────────────────────────

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
        // Relative path that wasn't internalized — resolve to absolute so it
        // still loads from the original domain when hosted elsewhere
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

  // Save rewritten HTML
  writeFileSync(resolve(dirs.raw, `${slug}.html`), $.html());
}

// ── Also rewrite URLs inside downloaded CSS files ────────────────────────────

for (const [originalUrl, localPath] of cssMap) {
  const cssPath = resolve(dirs.base, localPath);
  if (!existsSync(cssPath)) continue;
  let cssText = readFileSync(cssPath, 'utf8');

  for (const [imgUrl, imgLocal] of imgMap) {
    cssText = cssText.replaceAll(imgUrl, `/${imgLocal}`);
  }

  writeFileSync(cssPath, cssText);
}

// ── Save page map ────────────────────────────────────────────────────────────

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

console.log(`\n✅ Clone complete:`);
console.log(`   Pages:  ${pages.length}`);
console.log(`   CSS:    ${cssMap.size} files`);
console.log(`   Images: ${imgCount} files`);
console.log(`   Output: ${dirs.raw}`);
console.log(`\nNext: pnpm clone:extract ${clientName}`);

// ── Helpers ──────────────────────────────────────────────────────────────────

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
