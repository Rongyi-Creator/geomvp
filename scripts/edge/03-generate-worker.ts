/**
 * Edge Pipeline Step 3: Generate Cloudflare Worker from extracted GEO data
 * Usage: tsx scripts/edge/03-generate-worker.ts <client-name>
 *
 * Reads geo-data/ (business.json, faq.json, services.json, pages-meta.json)
 * and produces a complete edge proxy Worker at clients/<client>/edge/src/worker.ts
 * plus wrangler.toml and package.json, ready for deployment.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { getCloneDir, ROOT } from '../config.js';

const clientName = process.argv[2];
if (!clientName) {
  console.error('Usage: tsx scripts/edge/03-generate-worker.ts <client-name>');
  process.exit(1);
}

const dirs = getCloneDir(clientName);
const geoDir = dirs.geoData;
const edgeDir = resolve(ROOT, 'clients', clientName, 'edge');
const srcDir = resolve(edgeDir, 'src');

// ── Verify inputs exist ─────────────────────────────────────────────────────

const requiredFiles = ['business.json', 'faq.json', 'services.json', 'pages-meta.json'];
for (const f of requiredFiles) {
  const path = resolve(geoDir, f);
  if (!existsSync(path)) {
    console.error(`\n❌ Missing ${f} in ${geoDir}`);
    console.error(`   Run step 2 first: tsx scripts/clone/02-extract-geo.ts ${clientName}`);
    process.exit(1);
  }
}

console.log(`\n🔧 Generating Edge Proxy Worker for "${clientName}"`);
console.log(`   Reading geo-data from: ${geoDir}`);

const business = JSON.parse(readFileSync(resolve(geoDir, 'business.json'), 'utf8'));
const faq = JSON.parse(readFileSync(resolve(geoDir, 'faq.json'), 'utf8'));
const services: Array<{ name: string; slug: string; description: string }> =
  JSON.parse(readFileSync(resolve(geoDir, 'services.json'), 'utf8'));
const pagesMeta: Array<{
  slug: string; path: string; pageType: string; isEmpty: boolean;
  metaTitle: string; metaDescription: string;
}> = JSON.parse(readFileSync(resolve(geoDir, 'pages-meta.json'), 'utf8'));

const originUrl = business.website as string;
const workerName = `geo-edge-${clientName}`;

// ── Build SERVICES record ───────────────────────────────────────────────────

function buildServicesRecord(): string {
  const entries: string[] = [];
  for (const svc of services) {
    const pageMeta = pagesMeta.find(p => p.slug === svc.slug || p.slug === svc.slug.replace(/\//g, '--'));
    const path = pageMeta?.path ?? `/${svc.slug}/`;
    const nameEsc = JSON.stringify(svc.name);
    const descEsc = JSON.stringify(svc.description);
    entries.push(`  ${JSON.stringify(path)}: { name: ${nameEsc}, description: ${descEsc} },`);
  }
  return `const SERVICES: Record<string, { name: string; description: string }> = {\n${entries.join('\n')}\n};`;
}

// ── Build PAGES_META record ─────────────────────────────────────────────────

function buildPagesMeta(): string {
  const entries: string[] = [];
  for (const p of pagesMeta) {
    entries.push(`  ${JSON.stringify(p.path)}: { pageType: ${JSON.stringify(p.pageType)}, metaTitle: ${JSON.stringify(p.metaTitle)}, metaDescription: ${JSON.stringify(p.metaDescription)} },`);
  }
  return `const PAGES_META: Record<string, PageMeta> = {\n${entries.join('\n')}\n};`;
}

// ── Generate worker source ──────────────────────────────────────────────────

const workerSource = `interface Env {
  ORIGIN_HOST: string;
  GEO_ANALYTICS: AnalyticsEngineDataset;
}

// ── GEO Data (auto-generated from extracted business data) ──

const BUSINESS = ${JSON.stringify({
  '@context': 'https://schema.org',
  '@type': business.schemaType || 'LocalBusiness',
  name: business.name,
  description: business.description,
  url: business.website,
  address: {
    '@type': 'PostalAddress',
    streetAddress: business.address?.street || '',
    addressLocality: business.address?.city || '',
    postalCode: business.address?.zip || '',
    addressCountry: business.address?.country || 'DK',
  },
  geo: {
    '@type': 'GeoCoordinates',
    latitude: business.geo?.lat || 0,
    longitude: business.geo?.lng || 0,
  },
  ...(business.phone ? { telephone: business.phone } : {}),
  ...(business.email ? { email: business.email } : {}),
  ...(business.sameAs?.length ? { sameAs: business.sameAs } : {}),
  medicalSpecialty: business.practitioner?.specialties?.[0] || undefined,
}, null, 2)};

const FAQ_ITEMS = ${JSON.stringify(faq.items || [], null, 2)};

${buildServicesRecord()}

interface PageMeta {
  pageType: string;
  metaTitle: string;
  metaDescription: string;
}

${buildPagesMeta()}

// ── Path normalization ──

function normalizePath(pathname: string): string {
  let p = pathname;
  if (p !== "/" && !p.endsWith("/")) p += "/";
  return p;
}

function lookupPage(pathname: string): PageMeta | null {
  const norm = normalizePath(pathname);
  return PAGES_META[norm] ?? null;
}

// ── UA classification ──

const AI_RETRIEVAL_BOTS: Record<string, string> = {
  "OAI-SearchBot": "OAI-SearchBot",
  "ChatGPT-User": "ChatGPT-User",
  "PerplexityBot": "PerplexityBot",
  "ClaudeBot": "ClaudeBot",
  "YouBot": "YouBot",
  "Applebot": "Applebot",
};

const SEO_CRAWLERS: Record<string, string> = {
  "Googlebot": "Googlebot",
  "Bingbot": "Bingbot",
  "bingbot": "Bingbot",
  "YandexBot": "YandexBot",
  "Baiduspider": "Baiduspider",
};

const AI_TRAINING_BOTS: Record<string, string> = {
  "GPTBot": "GPTBot",
  "CCBot": "CCBot",
  "Google-Extended": "Google-Extended",
  "anthropic-ai": "anthropic-ai",
  "Bytespider": "Bytespider",
};

type UACategory = "ai_retrieval" | "seo_crawler" | "ai_training" | "visitor";

function classifyUA(ua: string): { category: UACategory; botName: string } {
  for (const [token, name] of Object.entries(AI_RETRIEVAL_BOTS)) {
    if (ua.includes(token)) return { category: "ai_retrieval", botName: name };
  }
  for (const [token, name] of Object.entries(SEO_CRAWLERS)) {
    if (ua.includes(token)) return { category: "seo_crawler", botName: name };
  }
  for (const [token, name] of Object.entries(AI_TRAINING_BOTS)) {
    if (ua.includes(token)) return { category: "ai_training", botName: name };
  }
  return { category: "visitor", botName: "none" };
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
    "@context": "https://schema.org",
    "@type": "MedicalTherapy",
    name: svc.name,
    description: svc.description,
    provider: {
      "@type": ${JSON.stringify(business.schemaType || 'LocalBusiness')},
      name: BUSINESS.name,
      url: BUSINESS.url,
    },
  });
}

function buildFaqJsonLd(): string {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ_ITEMS.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer,
      },
    })),
  });
}

// ── Static routes ──

function serveRobotsTxt(): Response {
  const body = \`# GEO Reforge — AI bot access policy
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

Sitemap: ${originUrl}/sitemap.xml
\`;
  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

function serveSitemap(): Response {
  const paths = Object.keys(PAGES_META);
  const urls = paths
    .map((p) => \`  <url><loc>${originUrl}\${p === "/" ? "/" : p}</loc></url>\`)
    .join("\\n");
  const body = \`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
\${urls}
</urlset>\`;
  return new Response(body, {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
}

// ── HTMLRewriter handlers ──

class HeadInjector {
  private schemas: string[];
  private metaDescription: string | null;
  constructor(schemas: string[], metaDescription: string | null) {
    this.schemas = schemas;
    this.metaDescription = metaDescription;
  }
  element(el: Element) {
    if (this.metaDescription) {
      el.append(
        \`<meta name="description" content="\${this.metaDescription}">\`,
        { html: true },
      );
    }
    for (const schema of this.schemas) {
      el.append(
        \`<script type="application/ld+json">\${schema}</script>\`,
        { html: true },
      );
    }
  }
}

class TitleRewriter {
  private title: string;
  constructor(title: string) {
    this.title = title;
  }
  text(text: Text) {
    if (text.lastInTextNode) {
      text.replace(this.title);
    } else {
      text.remove();
    }
  }
}

class MetaDescriptionRemover {
  element(el: Element) {
    el.remove();
  }
}

class CanonicalRewriter {
  private href: string;
  constructor(href: string) {
    this.href = href;
  }
  element(el: Element) {
    el.setAttribute("href", this.href);
  }
}

// ── Main fetch handler ──

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/robots.txt") return serveRobotsTxt();
    if (url.pathname === "/sitemap.xml") return serveSitemap();

    const originUrl = \`\${env.ORIGIN_HOST}\${url.pathname}\${url.search}\`;
    const originResponse = await fetch(originUrl, {
      method: request.method,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; GeoReforge/1.0; +https://georeforge.com)",
        Accept: request.headers.get("Accept") || "*/*",
      },
    });

    const contentType = originResponse.headers.get("content-type") || "";
    if (!contentType.includes("text/html") || !originResponse.ok) {
      const visitorUA = request.headers.get("user-agent") || "";
      const { category, botName } = classifyUA(visitorUA);
      const geoStatus = !originResponse.ok ? "skipped_non2xx" : "passthrough_nonhtml";
      env.GEO_ANALYTICS.writeDataPoint({
        blobs: [category, botName, url.pathname, geoStatus, "asset"],
        doubles: [1],
        indexes: [request.headers.get("cf-ray") ?? ""],
      });
      return originResponse;
    }

    const page = lookupPage(url.pathname);
    const schemas: string[] = [buildLocalBusinessJsonLd()];

    if (page) {
      if (page.pageType === "service") {
        const svcSchema = buildServiceJsonLd(url.pathname);
        if (svcSchema) schemas.push(svcSchema);
      }
      if (page.pageType === "faq" || page.pageType === "home") {
        schemas.push(buildFaqJsonLd());
      }
    }

    const canonicalPath = normalizePath(url.pathname);
    const canonicalHref = \`${originUrl}\${canonicalPath === "/" ? "/" : canonicalPath}\`;

    let rewriter = new HTMLRewriter()
      .on("head", new HeadInjector(schemas, page?.metaDescription ?? null))
      .on("link[rel='canonical']", new CanonicalRewriter(canonicalHref));

    if (page) {
      rewriter = rewriter
        .on("title", new TitleRewriter(page.metaTitle))
        .on('meta[name="description"]', new MetaDescriptionRemover());
    }

    const visitorUA = request.headers.get("user-agent") || "";
    const { category, botName } = classifyUA(visitorUA);
    const geoStatus = page ? "injected" : "passthrough";
    env.GEO_ANALYTICS.writeDataPoint({
      blobs: [category, botName, url.pathname, geoStatus, page?.pageType ?? "unknown"],
      doubles: [1],
      indexes: [request.headers.get("cf-ray") ?? ""],
    });

    return rewriter.transform(originResponse);
  },
};
`;

// ── Write output files ──────────────────────────────────────────────────────

mkdirSync(srcDir, { recursive: true });

writeFileSync(resolve(srcDir, 'worker.ts'), workerSource);
console.log(`   ✅ src/worker.ts (${(workerSource.length / 1024).toFixed(1)} KB)`);

const wranglerToml = `name = "${workerName}"
main = "src/worker.ts"
compatibility_date = "2024-12-01"

[vars]
ORIGIN_HOST = "${originUrl}"

[[analytics_engine_datasets]]
binding = "GEO_ANALYTICS"
dataset = "geo_traffic"
`;
writeFileSync(resolve(edgeDir, 'wrangler.toml'), wranglerToml);
console.log(`   ✅ wrangler.toml`);

const packageJson = JSON.stringify({
  name: workerName,
  private: true,
  scripts: {
    dev: 'wrangler dev',
    deploy: 'wrangler deploy',
  },
  devDependencies: {
    wrangler: '^4.0.0',
    '@cloudflare/workers-types': '^4.0.0',
  },
}, null, 2);
writeFileSync(resolve(edgeDir, 'package.json'), packageJson);
console.log(`   ✅ package.json`);

const tsconfig = JSON.stringify({
  compilerOptions: {
    target: 'ES2022',
    module: 'ES2022',
    moduleResolution: 'bundler',
    types: ['@cloudflare/workers-types'],
    strict: true,
  },
}, null, 2);
writeFileSync(resolve(edgeDir, 'tsconfig.json'), tsconfig);
console.log(`   ✅ tsconfig.json`);

console.log(`\n✅ Edge Worker generated at: ${edgeDir}`);
console.log(`   ${pagesMeta.length} pages, ${services.length} services, ${(faq.items || []).length} FAQ items`);
console.log(`   Origin: ${originUrl}`);
console.log(`\nNext: tsx scripts/edge/04-deploy-worker.ts ${clientName}`);
