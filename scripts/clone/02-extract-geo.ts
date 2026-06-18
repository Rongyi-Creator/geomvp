/**
 * Clone Pipeline Step 2: Extract business data for GEO layer
 * Usage: pnpm clone:extract <client-name>
 *
 * Reads cloned HTML, uses Claude API to extract structured business data
 * (NAP, services, FAQ) needed for JSON-LD injection. Much lighter than
 * the template pipeline — we only extract metadata, not restructure content.
 */

import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import * as cheerio from 'cheerio';
import Anthropic from '@anthropic-ai/sdk';
import { ANTHROPIC_API_KEY, getCloneDir } from '../config.js';

const [clientName, flag] = process.argv.slice(2);
const MANUAL_MODE = flag === '--manual' || !ANTHROPIC_API_KEY;

if (!clientName) {
  console.error('Usage: pnpm clone:extract <client-name> [--manual]');
  process.exit(1);
}

const dirs = getCloneDir(clientName);
mkdirSync(dirs.geoData, { recursive: true });

// ── Load cloned pages ────────────────────────────────────────────────────────

const htmlFiles = readdirSync(dirs.raw).filter(f => f.endsWith('.html'));
if (htmlFiles.length === 0) {
  console.error(`\n❌ No HTML files found in ${dirs.raw}`);
  console.error(`   Run step 1 first: pnpm clone:site <url> ${clientName}`);
  process.exit(1);
}

const pageMap: Array<{ url: string; slug: string; title: string; path: string }> =
  JSON.parse(readFileSync(resolve(dirs.geoData, 'page-map.json'), 'utf8'));

// Extract visible text from each page (stripped HTML → readable content)
const pageTexts = htmlFiles.map(file => {
  const slug = file.replace('.html', '');
  const html = readFileSync(resolve(dirs.raw, file), 'utf8');
  const $ = cheerio.load(html);

  // Remove non-content elements
  $('script, style, nav, noscript, iframe').remove();

  const text = $('body').text()
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1500); // enough context per page

  const title = $('title').text().trim();
  const mapEntry = pageMap.find(p => p.slug === slug);

  return {
    slug,
    title,
    url: mapEntry?.url ?? '',
    path: mapEntry?.path ?? `/${slug.replace(/--/g, '/')}/`,
    text,
  };
});

// ── Build extraction prompt ──────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a website metadata extraction specialist for GEO (Generative Engine Optimization).
Your job is to extract structured business data from website content — NOT to rewrite or restructure anything.

Rules:
1. Extract only facts visible on the pages — never fabricate
2. For FAQ: extract real Q&A from existing content, never invent questions
3. Keep all text in its original language (do not translate)
4. Output valid JSON only — no commentary`;

const EXTRACTION_PROMPT = `Analyze this website and extract structured business data for JSON-LD schemas.

Pages:
${pageTexts.map(p => `=== ${p.slug} (${p.url}) ===\nTitle: ${p.title}\n${p.text}`).join('\n\n---\n\n')}

Return this exact JSON structure:
{
  "business": {
    "name": "Business name",
    "schemaType": "LocalBusiness or more specific type like MedicalBusiness",
    "description": "1-2 sentence description from site content",
    "phone": "phone number or null",
    "email": "email or null",
    "website": "canonical URL",
    "bookingUrl": "booking system URL or null",
    "facebookUrl": "Facebook URL or null",
    "trustpilotUrl": "Trustpilot URL or null",
    "googleMapsUrl": "Google Maps URL or null",
    "address": {
      "street": "...",
      "city": "...",
      "zip": "...",
      "country": "DK or relevant country code"
    },
    "geo": { "lat": 0.0, "lng": 0.0 },
    "hours": [{ "day": "Monday", "open": "09:00", "close": "18:00" }],
    "practitioner": {
      "name": "practitioner name or null",
      "title": "title or null",
      "credentials": [],
      "specialties": []
    },
    "insurance": [],
    "sameAs": [],
    "aboutSummary": "2-3 sentences about the business from existing content",
    "language": "da or detected language code"
  },
  "faq": {
    "items": [
      { "question": "...", "answer": "..." }
    ]
  },
  "services": [
    {
      "name": "Service name",
      "slug": "matching page slug",
      "description": "1-2 sentence description from page content"
    }
  ],
  "pages": [
    {
      "slug": "page slug",
      "path": "/url/path/",
      "pageType": "home|service|faq|contact|about|prices|other",
      "isEmpty": false,
      "metaTitle": "Optimized title for GEO: [Topic] i [City] | [Business]",
      "metaDescription": "≤155 chars, unique, includes city + service"
    }
  ]
}

IMPORTANT:
- "pages" array must include ALL ${pageTexts.length} pages
- metaTitle/metaDescription: optimize for AI discoverability but keep in original language
- services: list all individual services found across service pages
- slug values must match exactly: ${pageTexts.map(p => p.slug).join(', ')}`;

// ── Manual mode ──────────────────────────────────────────────────────────────

if (MANUAL_MODE) {
  const prompt = `${SYSTEM_PROMPT}\n\n${EXTRACTION_PROMPT}`;
  writeFileSync(resolve(dirs.geoData, 'MANUAL-PROMPT.txt'), prompt);
  console.log(`\n📋 Manual mode: prompt saved to ${dirs.geoData}/MANUAL-PROMPT.txt`);
  console.log('   Paste into Claude.ai, save response as:');
  console.log(`   ${dirs.geoData}/extraction.json`);
  console.log(`   Then run: pnpm clone:inject ${clientName}`);
  process.exit(0);
}

// ── Claude API mode (split into 2 calls to avoid token limits) ───────────────

console.log(`\n🤖 Extracting business data with Claude API...`);
console.log(`   ${pageTexts.length} pages to analyze\n`);

const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
const pageSummary = pageTexts.map(p => `=== ${p.slug} (${p.url}) ===\nTitle: ${p.title}\n${p.text}`).join('\n\n---\n\n');

function extractJson(raw: string): unknown {
  const stripped = raw.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
  const match = stripped.match(/\{[\s\S]*\}/) ?? stripped.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('No JSON found in response');
  return JSON.parse(match[0]);
}

// ── Call 1: business + faq + services (compact output) ───────────────────────

console.log('   Call 1/2: Extracting business info, FAQ, services...');
const call1 = await client.messages.create({
  model: 'claude-sonnet-4-6',
  max_tokens: 4096,
  system: SYSTEM_PROMPT,
  messages: [{
    role: 'user',
    content: `Analyze this website and extract structured business data.

Pages:
${pageSummary}

Return ONLY this JSON (no pages array):
{
  "business": {
    "name": "Business name",
    "schemaType": "LocalBusiness or more specific (e.g. MedicalBusiness)",
    "description": "1-2 sentence description from site content",
    "phone": "phone or null", "email": "email or null",
    "website": "canonical URL", "bookingUrl": "booking URL or null",
    "facebookUrl": "or null", "trustpilotUrl": "or null", "googleMapsUrl": "or null",
    "address": { "street": "...", "city": "...", "zip": "...", "country": "DK" },
    "geo": { "lat": 0.0, "lng": 0.0 },
    "hours": [{ "day": "Monday", "open": "09:00", "close": "18:00" }],
    "practitioner": { "name": "or null", "title": "or null", "credentials": [], "specialties": [] },
    "insurance": [], "sameAs": [],
    "aboutSummary": "2-3 sentences from existing content",
    "language": "da or detected language code"
  },
  "faq": { "items": [{ "question": "...", "answer": "..." }] },
  "services": [{ "name": "Service name", "slug": "matching page slug", "description": "1 sentence" }]
}`,
  }],
});

const raw1 = call1.content[0].type === 'text' ? call1.content[0].text : '';
let data1: { business: Record<string, unknown>; faq: any; services: any[] };
try {
  data1 = extractJson(raw1) as typeof data1;
} catch (e) {
  writeFileSync(resolve(dirs.geoData, 'raw-response-1.txt'), raw1);
  console.error(`❌ Call 1 JSON parse failed. Raw saved to ${dirs.geoData}/raw-response-1.txt`);
  process.exit(1);
}

// ── Call 2: page metadata (slug → meta title/description/type) ───────────────

console.log('   Call 2/2: Extracting page metadata...');
const call2 = await client.messages.create({
  model: 'claude-sonnet-4-6',
  max_tokens: 8192,
  system: SYSTEM_PROMPT,
  messages: [{
    role: 'user',
    content: `For each page below, classify it and generate GEO-optimized meta tags.
Business name: ${(data1.business as any).name ?? 'Unknown'}
Business city: ${(data1.business as any).address?.city ?? 'Unknown'}

Pages:
${pageTexts.map(p => `- slug: "${p.slug}", title: "${p.title}", path: "${p.path}", text preview: "${p.text.slice(0, 200)}"`).join('\n')}

Return a JSON array (no wrapping object):
[
  {
    "slug": "exact slug from above",
    "path": "/url/path/",
    "pageType": "home|service|faq|contact|about|prices|other",
    "isEmpty": false,
    "metaTitle": "GEO-optimized title in original language: [Topic] i [City] | [Business]",
    "metaDescription": "≤155 chars, unique, city + service keywords, original language"
  }
]

Rules:
- Include ALL ${pageTexts.length} pages
- slug values must match EXACTLY: ${pageTexts.map(p => p.slug).join(', ')}
- Keep text in original language (Danish)`,
  }],
});

const raw2 = call2.content[0].type === 'text' ? call2.content[0].text : '';
let pagesData: Array<Record<string, unknown>>;
try {
  const stripped2 = raw2.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
  const arrMatch = stripped2.match(/\[[\s\S]*\]/);
  if (!arrMatch) throw new Error('No JSON array found');
  pagesData = JSON.parse(arrMatch[0]);
} catch (e) {
  writeFileSync(resolve(dirs.geoData, 'raw-response-2.txt'), raw2);
  console.error(`❌ Call 2 JSON parse failed. Raw saved to ${dirs.geoData}/raw-response-2.txt`);
  process.exit(1);
}

// Save extracted data
writeFileSync(resolve(dirs.geoData, 'business.json'), JSON.stringify(data1.business, null, 2));
writeFileSync(resolve(dirs.geoData, 'faq.json'), JSON.stringify(data1.faq, null, 2));
writeFileSync(resolve(dirs.geoData, 'services.json'), JSON.stringify(data1.services, null, 2));
writeFileSync(resolve(dirs.geoData, 'pages-meta.json'), JSON.stringify(pagesData, null, 2));

console.log('\n✅ Extraction complete:');
console.log(`   business.json   → ${dirs.geoData}/business.json`);
console.log(`   faq.json        → ${dirs.geoData}/faq.json`);
console.log(`   services.json   → ${dirs.geoData}/services.json`);
console.log(`   pages-meta.json → ${dirs.geoData}/pages-meta.json`);
console.log(`\nNext: pnpm clone:inject ${clientName}`);
