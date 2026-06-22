import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { load } from 'cheerio';
import { ROOT } from '../config.ts';
import type { Lead } from './01-fetch-leads.ts';

export interface ScoredLead extends Lead {
  httpOk: boolean;
  httpsOk: boolean;
  hasJsonLD: boolean;
  jsonLDTypes: string[];
  finalGrade: 'A' | 'B' | 'C';
  finalReason: string;
  checkedAt: string;
}

const TIMEOUT_MS = 8000;
const CONCURRENCY = 5;

async function checkSite(lead: Lead): Promise<ScoredLead> {
  const url = lead.website.startsWith('http') ? lead.website : `https://${lead.website}`;
  const httpsOk = url.startsWith('https://');

  let httpOk = false;
  let hasJsonLD = false;
  let jsonLDTypes: string[] = [];

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; foundbyai-checker/1.0)' },
      redirect: 'follow',
    });

    httpOk = res.ok;

    if (httpOk) {
      const html = await res.text();
      const $ = load(html);
      $('script[type="application/ld+json"]').each((_, el) => {
        try {
          const data = JSON.parse($(el).html() ?? '');
          const types = Array.isArray(data)
            ? data.map((d: Record<string, unknown>) => d['@type']).flat()
            : [data['@type']];
          jsonLDTypes.push(...types.filter(Boolean).map(String));
          hasJsonLD = true;
        } catch { /* malformed JSON-LD, ignore */ }
      });
    }
  } catch {
    // timeout or network error — leave httpOk = false
  }

  // Re-grade based on live check
  let finalGrade = lead.grade as 'A' | 'B' | 'C';
  let finalReason = lead.gradeReason;

  if (!httpOk) {
    finalGrade = 'C';
    finalReason = 'Site unreachable';
  } else if (hasJsonLD && jsonLDTypes.length > 0) {
    finalGrade = 'C';
    finalReason = `Already has JSON-LD (${jsonLDTypes.join(', ')}) — low GEO gain`;
  } else if (lead.grade === 'A') {
    finalGrade = 'A';
    finalReason = `${lead.gradeReason} · no JSON-LD · site OK`;
  }

  return { ...lead, httpOk, httpsOk, hasJsonLD, jsonLDTypes, finalGrade, finalReason, checkedAt: new Date().toISOString() };
}

// Run in batches to avoid hammering sites
async function runBatched<T, R>(items: T[], fn: (item: T) => Promise<R>, concurrency: number): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
    process.stdout.write(`\r  Checked ${Math.min(i + concurrency, items.length)}/${items.length}`);
  }
  console.log();
  return results;
}

// ── Main ─────────────────────────────────────────────────────────────────────

const inPath = resolve(ROOT, 'clients/leads/raw-leads.json');
const outPath = resolve(ROOT, 'clients/leads/leads-scored.json');

const allLeads: Lead[] = JSON.parse(readFileSync(inPath, 'utf-8'));
// Only check A and B — C is already filtered out
const toCheck = allLeads.filter(l => l.grade === 'A' || l.grade === 'B');
const cLeads = allLeads.filter(l => l.grade === 'C');

console.log(`Checking ${toCheck.length} leads (skipping ${cLeads.length} C-grade)...`);

const scored = await runBatched(toCheck, checkSite, CONCURRENCY);
const all: ScoredLead[] = [
  ...scored,
  ...cLeads.map(l => ({
    ...l,
    httpOk: false, httpsOk: false, hasJsonLD: false, jsonLDTypes: [],
    finalGrade: 'C' as const, finalReason: l.gradeReason, checkedAt: new Date().toISOString(),
  })),
];

all.sort((a, b) => {
  if (a.finalGrade !== b.finalGrade) return a.finalGrade < b.finalGrade ? -1 : 1;
  return b.rating - a.rating;
});

writeFileSync(outPath, JSON.stringify(all, null, 2));

const counts = { A: 0, B: 0, C: 0 };
all.forEach(l => counts[l.finalGrade]++);

console.log(`\nFinal grades after live check:`);
console.log(`  A: ${counts.A} | B: ${counts.B} | C: ${counts.C}`);
console.log(`\nWrote → ${outPath}`);
