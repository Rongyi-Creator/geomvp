import type { ClientProfile, TrustpilotResult } from '../types.js';
import { googleSearch } from '../outscraper.js';

// Direct fetch to dk.trustpilot.com reliably 403s (bot protection).
// Locate the review page via Outscraper Google Search instead.
// ponytail: rating/reviewCount need the page HTML we can't fetch — left null, not scored
export async function checkTrustpilot(client: ClientProfile): Promise<TrustpilotResult> {
  const empty: TrustpilotResult = { exists: false, claimed: false, rating: null, reviewCount: null, profileUrl: null };
  try {
    const results = await googleSearch(`site:trustpilot.com "${client.name}"`);
    const match = results.find(r => r.link?.includes('trustpilot.com/review/'));
    if (!match?.link) return empty;
    return { exists: true, claimed: false, rating: null, reviewCount: null, profileUrl: match.link };
  } catch (e) {
    return { ...empty, error: String(e) };
  }
}
