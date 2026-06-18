/**
 * Step 3: Structure content
 * Usage:  pnpm structure <client-name>
 *
 * Claude API mode (default): requires ANTHROPIC_API_KEY in .env.local
 * Manual mode (--manual):    outputs a prompt for manual Claude.ai processing
 */

import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { ANTHROPIC_API_KEY, getClientDir } from './config.js';

const [clientName, flag] = process.argv.slice(2);
const MANUAL_MODE = flag === '--manual' || !ANTHROPIC_API_KEY;

if (!clientName) {
  console.error('Usage: pnpm structure <client-name> [--manual]');
  process.exit(1);
}

const dirs = getClientDir(clientName);
mkdirSync(dirs.structured, { recursive: true });
mkdirSync(dirs.pages, { recursive: true });

// ── Load raw pages ─────────────────────────────────────────────────────────────
const pageDir = resolve(dirs.raw, 'pages');
const pageFiles = readdirSync(pageDir).filter(f => f.endsWith('.md') && !f.startsWith('.'));

if (pageFiles.length === 0) {
  console.error(`\n❌ No scraped pages found in ${pageDir}`);
  console.error(`   Run step 2 first: pnpm scrape <url> ${clientName}`);
  process.exit(1);
}
const sitemap: Array<{ url: string; slug: string; title: string }> =
  JSON.parse(readFileSync(resolve(dirs.raw, 'sitemap.json'), 'utf8'));

const pages = pageFiles.map(file => {
  const slug = file.replace('.md', '');
  const content = readFileSync(resolve(pageDir, file), 'utf8');
  const meta = JSON.parse(readFileSync(resolve(pageDir, `${slug}.meta.json`), 'utf8'));
  return { slug, content: content.slice(0, 2000), meta }; // trim — 2k chars is enough per page
});

// ── Schema ─────────────────────────────────────────────────────────────────────
const DATA_CONTRACT = `
Business JSON schema:
{
  name, schemaType, description, phone, email, website, bookingUrl,
  facebookUrl, trustpilotUrl, googleMapsUrl,
  address: { street, city, zip, country },
  geo: { lat, lng },
  hours: [{ day, open, close, note? }],
  practitioner: { name, title, credentials[], specialties[] },
  insurance: [],
  sameAs: [],
  aboutSummary
}

Page markdown frontmatter:
---
slug: "ydelser/smertebehandling"
title: "[Service] i [City] | [Business]"
description: "≤155 chars, unique per page"
pageType: "home|service|faq|contact|about|prices"
serviceName: "..."   (only for service pages)
serviceDescription: "..."  (only for service pages)
originalUrl: "..."
isEmpty: false
order: 1
---
`;

const SYSTEM_PROMPT = `You are a website content extraction specialist.
Rules:
1. NEVER edit, translate, or rewrite any content — format conversion only
2. Empty pages get isEmpty: true
3. Meta title format: "[Topic] i [City] | [BusinessName]"
4. Meta description: unique per page, includes city + service, ≤155 chars
5. Extract FAQ only from existing content — never fabricate
6. Preserve all external links (booking, maps, social)
7. Output valid JSON only — no commentary`;

// ── Manual mode ────────────────────────────────────────────────────────────────
if (MANUAL_MODE) {
  const prompt = `${SYSTEM_PROMPT}

${DATA_CONTRACT}

Here is the raw scraped content from ${clientName}:

${pages.map(p => `=== ${p.slug} (${p.meta.sourceURL}) ===\n${p.content}`).join('\n\n---\n\n')}

Output a JSON object with:
{
  "business": { ...business.json data... },
  "pages": [ ...array of page objects with frontmatter fields... ],
  "faq": { "items": [ ...{ question, answer }... ] },
  "colors": { "source": "extracted", "active": "scheme-a", "schemes": [...] }
}`;

  writeFileSync(resolve(dirs.structured, 'MANUAL-PROMPT.txt'), prompt);
  console.log(`\n📋 Manual mode: prompt saved to ${dirs.structured}/MANUAL-PROMPT.txt`);
  console.log('   Paste it into Claude.ai, then save the JSON response as:');
  console.log(`   ${dirs.structured}/structured-output.json`);
  console.log('   Then run: pnpm generate ${clientName}');
  process.exit(0);
}

// ── Claude API mode ────────────────────────────────────────────────────────────
console.log(`\n🤖 Structuring content with Claude API...`);
const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

function extractJson(raw: string): unknown {
  // Strip markdown code fences if present
  const stripped = raw.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
  const match = stripped.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON object found in Claude response');
  return JSON.parse(match[0]);
}

const pagesSummary = pages.map(p =>
  `=== ${p.slug} (${p.meta.sourceURL ?? 'unknown'}) ===\n${p.content}`
).join('\n\n---\n\n');

// ── Call 1: business + faq + colors (small, predictable output) ───────────────
console.log('   Call 1/2: Extracting business info, FAQ, colors...');
const call1 = await client.messages.create({
  model: 'claude-sonnet-4-6',
  max_tokens: 4096,
  system: SYSTEM_PROMPT,
  messages: [{
    role: 'user',
    content: `${DATA_CONTRACT}

Scraped site: ${clientName}
Pages:

${pagesSummary}

Return ONLY this JSON (no pages array):
{
  "business": { ...complete business.json fields... },
  "faq": { "items": [ ...up to 8 Q&A extracted from existing content only... ] },
  "colors": {
    "source": "extracted from original site",
    "active": "scheme-a",
    "schemes": [
      { "id": "scheme-a", "name": "Original", "colors": { "primary": "#...", "primary-light": "#...", "primary-dark": "#...", "bg": "#fff", "bg-alt": "#f8f9fa", "text": "#1a1a1a", "text-muted": "#6b7280", "accent": "#...", "border": "#e5e7eb" } },
      { "id": "scheme-b", "name": "Warm", "colors": { "primary": "#...", "primary-light": "#...", "primary-dark": "#...", "bg": "#fffdf9", "bg-alt": "#fdf5ec", "text": "#1a1a1a", "text-muted": "#6b7280", "accent": "#...", "border": "#e8ddd4" } },
      { "id": "scheme-c", "name": "Cool", "colors": { "primary": "#...", "primary-light": "#...", "primary-dark": "#...", "bg": "#fff", "bg-alt": "#f0f5f9", "text": "#1a1a1a", "text-muted": "#6b7280", "accent": "#...", "border": "#d8e4ed" } }
    ]
  }
}`,
  }],
});

const r1 = extractJson(call1.content[0].type === 'text' ? call1.content[0].text : '') as {
  business: object; faq: object; colors: object;
};

// ── Call 2: pages array ───────────────────────────────────────────────────────
console.log('   Call 2/2: Extracting page content...');
const call2 = await client.messages.create({
  model: 'claude-sonnet-4-6',
  max_tokens: 8192,
  system: SYSTEM_PROMPT,
  messages: [{
    role: 'user',
    content: `${DATA_CONTRACT}

Scraped site: ${clientName}
Pages:

${pagesSummary}

Return ONLY a JSON array of page objects (no wrapping object):
[
  {
    "slug": "ydelser/smertebehandling",
    "title": "...",
    "description": "...",
    "pageType": "service",
    "serviceName": "...",
    "serviceDescription": "...",
    "originalUrl": "...",
    "isEmpty": false,
    "order": 1,
    "body": "...markdown body text..."
  },
  ...one object per unique service page found...
]

Rules:
- Only include service pages (pageType="service") — skip home, contact, about, prices pages
- slug must start with "ydelser/" for service pages
- slug uses only lowercase letters, numbers, hyphens — no slashes except the prefix
- isEmpty: true if page had no real content
- body: the page's content in Danish, verbatim from scraped text`,
  }],
});

const rawPages2 = call2.content[0].type === 'text' ? call2.content[0].text : '';
const stripped2 = rawPages2.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
const arrMatch = stripped2.match(/\[[\s\S]*\]/);
if (!arrMatch) throw new Error('Claude call 2 did not return a JSON array');
const pageObjects = JSON.parse(arrMatch[0]) as Array<{
  slug: string; body?: string; [k: string]: unknown;
}>;

// Save outputs
writeFileSync(resolve(dirs.structured, 'business.json'), JSON.stringify(r1.business, null, 2));
writeFileSync(resolve(dirs.structured, 'faq.json'), JSON.stringify(r1.faq, null, 2));
writeFileSync(resolve(dirs.structured, 'colors.json'), JSON.stringify(r1.colors, null, 2));

for (const page of pageObjects) {
  const { slug, body = '', ...frontmatter } = page;
  if (!slug || slug.trim() === '') continue; // skip any bad slug
  const content = [
    '---',
    ...Object.entries(frontmatter).map(([k, v]) => `${k}: ${JSON.stringify(v)}`),
    '---',
    '',
    body,
  ].join('\n');
  const filePath = resolve(dirs.pages, `${slug.replace(/\//g, '--')}.md`);
  writeFileSync(filePath, content);
}

console.log('\n✅ Structuring complete:');
console.log(`   business.json  → ${dirs.structured}/business.json`);
console.log(`   faq.json       → ${dirs.structured}/faq.json`);
console.log(`   colors.json    → ${dirs.structured}/colors.json`);
console.log(`   pages          → ${dirs.pages}/`);
console.log(`\nNext: pnpm generate ${clientName}`);
