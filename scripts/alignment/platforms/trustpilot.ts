import type { ClientProfile, TrustpilotResult } from '../types.js';
import { googleSearch } from '../outscraper.js';

// Direct fetch to dk.trustpilot.com reliably 403s (bot protection).
// Locate the review page via Outscraper Google Search instead.
// ponytail: rating/reviewCount need the page HTML we can't fetch — left null, not scored
export async function checkTrustpilot(client: ClientProfile): Promise<TrustpilotResult> {
  const empty: TrustpilotResult = { exists: false, claimed: false, rating: null, reviewCount: null, profileUrl: null };
  try {
    const results = await googleSearch(`site:trustpilot.com "${client.name}"`);
    // Trustpilot review URLs are .../review/<domain> — require the client's own domain
    // so we don't match another company's review page that merely mentions the name.
    const domain = client.domain.replace(/^www\./, '').toLowerCase();
    const match = results.find(r => r.link?.toLowerCase().includes(`/review/${domain}`));
    if (!match?.link) return empty;
    return { exists: true, claimed: false, rating: null, reviewCount: null, profileUrl: match.link };
  } catch (e) {
    return { ...empty, error: String(e) };
  }
}
