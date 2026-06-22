import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from '../config.ts';

type Grade = 'A' | 'B' | 'C';

export interface Lead {
  query: string;
  name: string;
  domain: string;
  website: string;
  email: string;
  phone: string;
  address: string;
  rating: number;
  reviews: number;
  generator: string;
  grade: Grade;
  gradeReason: string;
}

// RFC 4180 CSV parser — handles quoted fields, embedded commas, embedded newlines
function parseCSV(content: string): Record<string, string>[] {
  const lines: string[][] = [];
  let cur: string[] = [''];
  let inQuote = false;

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    const next = content[i + 1];
    if (inQuote) {
      if (ch === '"' && next === '"') { cur[cur.length - 1] += '"'; i++; }
      else if (ch === '"') { inQuote = false; }
      else { cur[cur.length - 1] += ch; }
    } else {
      if (ch === '"') { inQuote = true; }
      else if (ch === ',') { cur.push(''); }
      else if (ch === '\n') { lines.push(cur); cur = ['']; }
      else if (ch !== '\r') { cur[cur.length - 1] += ch; }
    }
  }
  if (cur.some(c => c !== '')) lines.push(cur);

  const [headers, ...rows] = lines;
  return rows.map(row => {
    const obj: Record<string, string> = {};
    headers?.forEach((h, i) => { obj[h.trim()] = row[i] ?? ''; });
    return obj;
  });
}

function classify(generator: string): { grade: Grade; gradeReason: string } {
  const g = generator.toLowerCase();
  if (g.includes('wix') || g.includes('shopify') || g.includes('squarespace')) {
    return { grade: 'C', gradeReason: 'DNS locked platform' };
  }
  if (g.includes('wordpress') || g.includes('divi') || g.includes('elementor')) {
    return { grade: 'B', gradeReason: 'WordPress — DNS modifiable but more complex' };
  }
  return { grade: 'A', gradeReason: generator ? `${generator} — compatible` : 'No CMS detected — likely standard hosting' };
}

function extractDomain(website: string): string {
  try { return new URL(website).hostname.replace(/^www\./, ''); }
  catch { return website.replace(/^https?:\/\/(www\.)?/, '').split('/')[0]; }
}

// ── Main ─────────────────────────────────────────────────────────────────────

const rawDir = resolve(ROOT, 'clients/leads/raw');
const outDir = resolve(ROOT, 'clients/leads');
mkdirSync(outDir, { recursive: true });

const files = readdirSync(rawDir).filter(f => f.endsWith('.csv'));
console.log(`Reading ${files.length} CSV files from ${rawDir}`);

const seen = new Set<string>();
const leads: Lead[] = [];
let skippedNoWebsite = 0, skippedNoEmail = 0, skippedLowRating = 0, skippedDupe = 0;

for (const file of files) {
  const rows = parseCSV(readFileSync(resolve(rawDir, file), 'utf-8'));
  for (const row of rows) {
    const website = row.website?.trim();
    const email = row.email?.trim();
    const ratingRaw = row.rating?.trim();
    const rating = ratingRaw ? parseFloat(ratingRaw) : 0;

    if (!website) { skippedNoWebsite++; continue; }
    if (!email)   { skippedNoEmail++;   continue; }
    if (rating > 0 && rating < 3.5) { skippedLowRating++; continue; }

    const domain = row.domain?.trim() || extractDomain(website);
    if (seen.has(domain)) { skippedDupe++; continue; }
    seen.add(domain);

    const generator = row.website_generator?.trim() ?? '';
    const { grade, gradeReason } = classify(generator);

    leads.push({
      query: row.query?.trim() ?? '',
      name: row.name?.trim() ?? '',
      domain,
      website,
      email,
      phone: row.phone?.trim() ?? '',
      address: row.address?.trim() ?? '',
      rating,
      reviews: parseInt(row.reviews || '0', 10),
      generator,
      grade,
      gradeReason,
    });
  }
}

// Sort: A → B → C, then rating desc within each grade
leads.sort((a, b) => {
  if (a.grade !== b.grade) return a.grade < b.grade ? -1 : 1;
  return b.rating - a.rating;
});

const outPath = resolve(outDir, 'raw-leads.json');
writeFileSync(outPath, JSON.stringify(leads, null, 2));

const byGrade = { A: 0, B: 0, C: 0 };
leads.forEach(l => byGrade[l.grade]++);

console.log(`\nResults:`);
console.log(`  Total unique leads: ${leads.length}`);
console.log(`  A-grade: ${byGrade.A} | B-grade: ${byGrade.B} | C-grade: ${byGrade.C}`);
console.log(`\nSkipped:`);
console.log(`  No website: ${skippedNoWebsite}`);
console.log(`  No email:   ${skippedNoEmail}`);
console.log(`  Rating <3.5: ${skippedLowRating}`);
console.log(`  Duplicates: ${skippedDupe}`);
console.log(`\nWrote → ${outPath}`);
