import {
  ORIGIN_HOST,
  CANONICAL_HOST,
  BUSINESS,
  FAQ_ITEMS,
  SERVICES,
  PAGES_META,
} from '../lib/geo-data.js';

export const config = { runtime: 'edge' };

// ── Path normalization ──

function normalizePath(pathname: string): string {
  let p = pathname;
  if (p !== '/' && !p.endsWith('/')) p += '/';
  return p;
}

// ── Schema builders ──

function buildLocalBusinessJsonLd(): string {
  return JSON.stringify(BUSINESS);
}

function buildServiceJsonLd(pathname: string): string | null {
  const norm = normalizePath(pathname);
  const svc = SERVICES[norm];
  if (!svc) return null;
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'MedicalTherapy',
    name: svc.name,
    description: svc.description,
    provider: {
      '@type': 'MedicalBusiness',
      name: BUSINESS.name,
      url: BUSINESS.url,
    },
  });
}

function buildFaqJsonLd(): string {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQ_ITEMS.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.answer,
      },
    })),
  });
}

// ── Static routes ──

function serveRobotsTxt(): Response {
  const body = `# GEO Reforge — AI bot access policy
User-agent: OAI-SearchBot
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: ChatGPT-User
Allow: /

User-agent: Googlebot
Allow: /

User-agent: Bingbot
Allow: /

User-agent: GPTBot
Disallow: /

User-agent: CCBot
Disallow: /

User-agent: Google-Extended
Disallow: /

User-agent: *
Allow: /

Sitemap: ${CANONICAL_HOST}/sitemap.xml
`;
  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
    },
  });
}

function serveSitemap(): Response {
  const paths = Object.keys(PAGES_META);
  const urls = paths
    .map(
      (p) =>
        `  <url><loc>${CANONICAL_HOST}${p === '/' ? '/' : p}</loc></url>`,
    )
    .join('\n');
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;
  return new Response(body, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
    },
  });
}

// ── HTML transformation ──

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function transformHtml(html: string, pathname: string): string {
  const norm = normalizePath(pathname);
  const page = PAGES_META[norm] ?? null;

  const schemas: string[] = [buildLocalBusinessJsonLd()];
  if (page) {
    if (page.pageType === 'service') {
      const svcSchema = buildServiceJsonLd(pathname);
      if (svcSchema) schemas.push(svcSchema);
    }
    if (page.pageType === 'faq' || page.pageType === 'home') {
      schemas.push(buildFaqJsonLd());
    }
  }

  const schemaScripts = schemas
    .map((s) => `<script type="application/ld+json">${s}</script>`)
    .join('');
  const metaTag = page?.metaDescription
    ? `<meta name="description" content="${escapeHtml(page.metaDescription)}">`
    : '';
  const injection = metaTag + schemaScripts;

  if (page) {
    html = html.replace(/<meta\s+name=["']description["'][^>]*>/gi, '');
  }

  html = html.replace('</head>', `${injection}</head>`);

  if (page) {
    html = html.replace(
      /<title>[^<]*<\/title>/i,
      `<title>${escapeHtml(page.metaTitle)}</title>`,
    );
  }

  const canonicalHref = `${CANONICAL_HOST}${norm}`;
  html = html.replace(
    /<link\s+rel=["']canonical["']\s+href=["'][^"']*["'][^>]*>/gi,
    `<link rel="canonical" href="${canonicalHref}">`,
  );

  return html;
}

// ── Analytics reporting ──

const DASHBOARD_URL = 'https://geo-dashboard.blake-designing.workers.dev';
const DASHBOARD_CLIENT = "virum";

async function reportTraffic(
  category: string,
  botName: string,
  path: string,
  geoStatus: string,
  pageType: string,
): Promise<void> {
  const token = process.env.DASHBOARD_TOKEN;
  if (!token) return;
  try {
    await fetch(`${DASHBOARD_URL}/api/traffic/${DASHBOARD_CLIENT}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ category, botName, path, geoStatus, pageType, client: DASHBOARD_CLIENT }),
    });
  } catch {
    // never let analytics affect the proxy response
  }
}

// ── UA classification ──

const AI_RETRIEVAL_BOTS: Record<string, string> = {
  'OAI-SearchBot': 'OAI-SearchBot',
  'ChatGPT-User': 'ChatGPT-User',
  'PerplexityBot': 'PerplexityBot',
  'ClaudeBot': 'ClaudeBot',
  'YouBot': 'YouBot',
  'Applebot': 'Applebot',
};

const SEO_CRAWLERS: Record<string, string> = {
  Googlebot: 'Googlebot',
  Bingbot: 'Bingbot',
  bingbot: 'Bingbot',
  YandexBot: 'YandexBot',
  Baiduspider: 'Baiduspider',
};

const AI_TRAINING_BOTS: Record<string, string> = {
  GPTBot: 'GPTBot',
  CCBot: 'CCBot',
  'Google-Extended': 'Google-Extended',
  'anthropic-ai': 'anthropic-ai',
  Bytespider: 'Bytespider',
};

type UACategory = 'ai_retrieval' | 'seo_crawler' | 'ai_training' | 'visitor';

function classifyUA(ua: string): { category: UACategory; botName: string } {
  for (const [token, name] of Object.entries(AI_RETRIEVAL_BOTS)) {
    if (ua.includes(token)) return { category: 'ai_retrieval', botName: name };
  }
  for (const [token, name] of Object.entries(SEO_CRAWLERS)) {
    if (ua.includes(token)) return { category: 'seo_crawler', botName: name };
  }
  for (const [token, name] of Object.entries(AI_TRAINING_BOTS)) {
    if (ua.includes(token)) return { category: 'ai_training', botName: name };
  }
  return { category: 'visitor', botName: 'none' };
}

// ── Main handler ──

export default async function handler(
  request: Request,
  context: { waitUntil: (promise: Promise<unknown>) => void },
): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === '/robots.txt') return serveRobotsTxt();
  if (url.pathname === '/sitemap.xml') return serveSitemap();

  const originUrl = `${ORIGIN_HOST}${url.pathname}${url.search}`;
  const originResponse = await fetch(originUrl, {
    method: request.method,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (compatible; GeoReforge/1.0; +https://georeforge.com)',
      Accept: request.headers.get('Accept') || '*/*',
    },
  });

  const contentType = originResponse.headers.get('content-type') || '';

  if (!contentType.includes('text/html') || !originResponse.ok) {
    const visitorUA = request.headers.get('user-agent') || '';
    const { category, botName } = classifyUA(visitorUA);
    const geoStatus = !originResponse.ok ? 'skipped_non2xx' : 'passthrough_nonhtml';
    console.log(`[GEO] ${geoStatus} | ${category}:${botName} | ${url.pathname}`);
    if (geoStatus === 'skipped_non2xx') {
      context.waitUntil(reportTraffic(category, botName, url.pathname, geoStatus, 'unknown'));
    }
    return originResponse;
  }

  const originalHtml = await originResponse.text();
  const transformedHtml = transformHtml(originalHtml, url.pathname);

  const norm = normalizePath(url.pathname);
  const page = PAGES_META[norm] ?? null;
  const visitorUA = request.headers.get('user-agent') || '';
  const { category, botName } = classifyUA(visitorUA);
  const geoStatus = page ? 'injected' : 'passthrough';
  const pageType = page?.pageType ?? 'unknown';
  console.log(`[GEO] ${geoStatus} | ${category}:${botName} | ${url.pathname} | ${pageType}`);
  context.waitUntil(reportTraffic(category, botName, url.pathname, geoStatus, pageType));

  const responseHeaders = new Headers(originResponse.headers);
  responseHeaders.set('Content-Type', 'text/html; charset=utf-8');
  responseHeaders.set('Cache-Control', 'public, max-age=0, must-revalidate');
  responseHeaders.set('Vercel-CDN-Cache-Control', 's-maxage=300, stale-while-revalidate=60');
  responseHeaders.delete('content-length');
  responseHeaders.delete('content-encoding');

  return new Response(transformedHtml, {
    status: originResponse.status,
    headers: responseHeaders,
  });
}
