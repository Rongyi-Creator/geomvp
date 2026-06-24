import type { ClientProfile, TrustpilotResult } from '../types.js';

// Direct fetch to dk.trustpilot.com reliably 403s (bot protection).
// Locate the review page via Outscraper Google Search instead.
// ponytail: rating/reviewCount need the page HTML we can't fetch — left null, not scored
export async function checkTrustpilot(client: ClientProfile): Promise<TrustpilotResult> {
  const apiKey = process.env.OUTSCRAPER_API_KEY;
  if (!apiKey) return { exists: false, claimed: false, rating: null, reviewCount: null, profileUrl: null, error: 'OUTSCRAPER_API_KEY not set' };

  const query = `site:trustpilot.com "${client.name}"`;
  const params = new URLSearchParams({ query, limit: '3', language: 'da', async: 'false' });

  try {
    const resp = await fetch(`https://api.outscraper.com/google-search?${params}`, {
      headers: { 'X-API-KEY': apiKey },
      signal: AbortSignal.timeout(60000), // sync request holds connection until results ready
    });

    if (!resp.ok) return { exists: false, claimed: false, rating: null, reviewCount: null, profileUrl: null, error: `Outscraper ${resp.status}` };

    const data = await resp.json() as { data?: Array<Array<{ link?: string; title?: string }>> };
    const results = data.data?.[0] ?? [];

    const match = results.find(r => r.link?.includes('trustpilot.com/review/'));
    if (!match?.link) return { exists: false, claimed: false, rating: null, reviewCount: null, profileUrl: null };

    return { exists: true, claimed: false, rating: null, reviewCount: null, profileUrl: match.link };
  } catch (e) {
    return { exists: false, claimed: false, rating: null, reviewCount: null, profileUrl: null, error: String(e) };
  }
}
