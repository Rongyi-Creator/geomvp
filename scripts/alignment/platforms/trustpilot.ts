import type { ClientProfile, TrustpilotResult } from '../types.js';
import { googleSearch } from '../outscraper.js';

// Trustpilot review pages are keyed by DOMAIN, not name: the URL is /review/<domain>
// (sometimes /review/www.<domain>). We search by domain instead of the business name —
// it avoids name collisions (重名) and matches how Trustpilot indexes. Name search missed
// thin/new 0-review profiles that Google ranks too low to surface in the top results.
const reviewSlug = (link: string): string | undefined =>
  link.toLowerCase().match(/\/review\/([^/?#]+)/)?.[1]?.replace(/^www\./, '');

// Direct fetch to dk.trustpilot.com reliably 403s (bot protection); locate the review
// page via Outscraper Google Search instead.
// ponytail: rating/reviewCount need the page HTML we can't fetch — left null, not scored
export async function checkTrustpilot(client: ClientProfile): Promise<TrustpilotResult> {
  const empty: TrustpilotResult = { exists: false, claimed: false, rating: null, reviewCount: null, profileUrl: null };
  try {
    const domain = client.domain.replace(/^www\./, '').toLowerCase();
    const results = await googleSearch(`site:trustpilot.com ${domain}`, { limit: '10' });
    // Match the review page for THIS domain exactly (www-insensitive), so we don't pick
    // up another company's review page that merely mentions the domain.
    const match = results.find(r => r.link && reviewSlug(r.link) === domain);
    if (!match?.link) return empty;
    return { exists: true, claimed: false, rating: null, reviewCount: null, profileUrl: match.link };
  } catch (e) {
    return { ...empty, error: String(e) };
  }
}

// ponytail: self-check the domain matcher — run `tsx scripts/alignment/platforms/trustpilot.ts --selftest`
if (process.argv.includes('--selftest')) {
  const ok = ['https://dk.trustpilot.com/review/virumakupunktur.dk', 'https://www.trustpilot.com/review/www.virumakupunktur.dk?utm=x'];
  const no = ['https://www.trustpilot.com/review/anden-klinik.dk', 'https://www.trustpilot.com/categories/akupunktur', 'https://dk.trustpilot.com/review/virumakupunktur.dk.evil.com'];
  for (const u of ok) if (reviewSlug(u) !== 'virumakupunktur.dk') throw new Error(`expected match: ${u} -> ${reviewSlug(u)}`);
  for (const u of no) if (reviewSlug(u) === 'virumakupunktur.dk') throw new Error(`expected NON-match: ${u}`);
  console.log('✓ trustpilot reviewSlug self-check passed');
}
