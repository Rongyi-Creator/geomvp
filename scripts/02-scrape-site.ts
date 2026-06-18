/**
 * Step 2: Scrape entire site
 * Usage:  pnpm scrape <url> <client-name> [--manual]
 *
 * Firecrawl mode (default): requires FIRECRAWL_API_KEY in .env.local
 * Manual mode (--manual):   uses fetch + recursive link following, no API needed
 */

import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { FIRECRAWL_API_KEY, getClientDir } from './config.js';

const [url, clientName, flag] = process.argv.slice(2);
const MANUAL_MODE = flag === '--manual' || !FIRECRAWL_API_KEY;

if (!url || !clientName) {
  console.error('Usage: pnpm scrape <url> <client-name> [--manual]');
  process.exit(1);
}

const dirs = getClientDir(clientName);
mkdirSync(dirs.raw, { recursive: true });
mkdirSync(resolve(dirs.raw, 'pages'), { recursive: true });
mkdirSync(dirs.images, { recursive: true });

const UA = 'GEO-Reforge-Scraper/1.0 (content migration; contact: hello.rongyi@gmail.com)';

// ── Firecrawl mode ────────────────────────────────────────────────────────────
async function scrapeWithFirecrawl() {
  console.log('🔥 Using Firecrawl API...');
  const crawlRes = await fetch('https://api.firecrawl.dev/v1/crawl', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url,
      limit: 50,
      scrapeOptions: { formats: ['markdown', 'html'] },
    }),
  });

  if (!crawlRes.ok) {
    throw new Error(`Firecrawl error: ${crawlRes.status} ${await crawlRes.text()}`);
  }

  const { id: jobId } = await crawlRes.json() as { id: string };
  console.log(`  Job ID: ${jobId}`);

  // Poll for completion (max 5 minutes)
  let pages: FirecrawlPage[] = [];
  let completed = false;
  for (let i = 0; i < 100; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const statusRes = await fetch(`https://api.firecrawl.dev/v1/crawl/${jobId}`, {
      headers: { 'Authorization': `Bearer ${FIRECRAWL_API_KEY}` },
    });
    const status = await statusRes.json() as FirecrawlStatus;
    process.stdout.write(`\r  Status: ${status.status} (${status.completed ?? 0}/${status.total ?? '?'})`);
    if (status.status === 'completed') {
      pages = status.data ?? [];
      completed = true;
      break;
    }
    if (status.status === 'failed') {
      throw new Error(`Firecrawl job failed. Job ID: ${jobId}`);
    }
  }
  console.log();
  if (!completed) {
    throw new Error(`Firecrawl job timed out after 5 minutes. Job ID: ${jobId}\nTry: pnpm scrape ${url} ${process.argv[3]} --manual`);
  }
  return pages;
}

interface FirecrawlPage {
  metadata?: { sourceURL?: string; title?: string; description?: string };
  markdown?: string;
  html?: string;
}
interface FirecrawlStatus {
  status: string; completed: number; total: number; data?: FirecrawlPage[];
}

// ── Manual fetch mode ─────────────────────────────────────────────────────────
async function scrapeManual() {
  console.log('🔧 Manual scrape mode (no API key required)...');
  const base = new URL(url);
  const visited = new Set<string>();
  const queue = [url];
  const pages: Array<{ url: string; html: string }> = [];

  while (queue.length > 0 && pages.length < 40) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    try {
      const res = await fetch(current, { headers: { 'User-Agent': UA } });
      if (!res.ok || !res.headers.get('content-type')?.includes('html')) continue;
      const html = await res.text();
      pages.push({ url: current, html });
      process.stdout.write(`\r  Scraped ${pages.length} pages...`);

      // Discover internal links
      const links = [...html.matchAll(/href="([^"#?]+)"/g)]
        .map(m => m[1])
        .filter(href => !href.match(/\.(pdf|jpg|png|gif|svg|css|js|xml|ico)$/i));

      for (const href of links) {
        try {
          const abs = new URL(href, base).href;
          if (abs.startsWith(base.origin) && !visited.has(abs)) queue.push(abs);
        } catch { /* ignore invalid URLs */ }
      }

      await new Promise(r => setTimeout(r, 500)); // polite delay
    } catch { /* skip failed pages */ }
  }
  console.log();
  return pages;
}

// ── Convert HTML to Markdown (simple) ────────────────────────────────────────
function htmlToMarkdown(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '# $1\n')
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '## $1\n')
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '### $1\n')
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '$1\n\n')
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function urlToSlug(pageUrl: string, baseUrl: string): string {
  const path = new URL(pageUrl).pathname.replace(/^\/|\/$/g, '') || 'index';
  return path.replace(/\//g, '--');
}

// ── Save image ────────────────────────────────────────────────────────────────
async function downloadImages(html: string, baseUrl: string, imageDir: string) {
  const imgUrls = [...html.matchAll(/src="(https?:\/\/[^"]+\.(jpg|jpeg|png|gif|webp|svg))"/gi)]
    .map(m => m[1]);
  const imageMap: Record<string, string> = {};

  for (const imgUrl of imgUrls) {
    try {
      const filename = imgUrl.split('/').pop()!.split('?')[0];
      const localPath = resolve(imageDir, filename);
      if (!existsSync(localPath)) {
        const res = await fetch(imgUrl);
        if (res.ok) {
          const buf = await res.arrayBuffer();
          writeFileSync(localPath, Buffer.from(buf));
        }
      }
      imageMap[imgUrl] = `./raw/images/${filename}`;
    } catch { /* skip */ }
  }
  return imageMap;
}

// ── Main ──────────────────────────────────────────────────────────────────────
console.log(`\n📡 Scraping: ${url}`);
console.log(`   Client: ${clientName}`);
console.log(`   Mode: ${MANUAL_MODE ? 'manual (fetch)' : 'Firecrawl API'}\n`);

let rawPages: Array<{ url: string; markdown: string; html: string; meta: object }> = [];

if (MANUAL_MODE) {
  const pages = await scrapeManual();
  for (const p of pages) {
    const md = htmlToMarkdown(p.html);
    const titleMatch = p.html.match(/<title>([^<]*)<\/title>/i);
    const descMatch = p.html.match(/<meta[^>]+name="description"[^>]+content="([^"]+)"/i);
    rawPages.push({
      url: p.url,
      markdown: md,
      html: p.html,
      meta: {
        sourceURL: p.url,
        title: titleMatch?.[1]?.trim() ?? '',
        description: descMatch?.[1]?.trim() ?? '',
      },
    });
  }
} else {
  const pages = await scrapeWithFirecrawl();
  rawPages = pages.map(p => ({
    url: p.metadata?.sourceURL ?? '',
    markdown: p.markdown ?? htmlToMarkdown(p.html ?? ''),
    html: p.html ?? '',
    meta: p.metadata ?? {},
  }));
}

// Save pages
const sitemap: Array<{ url: string; slug: string; title: string }> = [];
const imageMap: Record<string, string> = {};

for (const page of rawPages) {
  const slug = urlToSlug(page.url, url);
  const pageDir = resolve(dirs.raw, 'pages');

  writeFileSync(resolve(pageDir, `${slug}.md`), page.markdown);
  writeFileSync(resolve(pageDir, `${slug}.meta.json`), JSON.stringify(page.meta, null, 2));
  sitemap.push({ url: page.url, slug, title: (page.meta as { title?: string }).title ?? '' });

  // Download images
  const imgMap = await downloadImages(page.html, url, dirs.images);
  Object.assign(imageMap, imgMap);
}

writeFileSync(resolve(dirs.raw, 'sitemap.json'), JSON.stringify(sitemap, null, 2));
writeFileSync(resolve(dirs.raw, 'image-map.json'), JSON.stringify(imageMap, null, 2));

if (rawPages.length === 0) {
  console.error('\n❌ No pages scraped. The site may be blocking crawlers or using heavy JS rendering.');
  console.error(`   Try manual mode: pnpm scrape ${url} ${clientName} --manual`);
  process.exit(1);
}

console.log(`\n✅ Scrape complete:`);
console.log(`   Pages saved: ${rawPages.length}`);
console.log(`   Images downloaded: ${Object.keys(imageMap).length}`);
console.log(`   Output: ${dirs.raw}`);
console.log(`\nNext: pnpm structure ${clientName}`);
