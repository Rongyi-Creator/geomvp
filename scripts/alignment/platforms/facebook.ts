import type { ClientProfile, FacebookResult } from '../types.js';
import { googleSearch } from '../outscraper.js';

// Facebook doesn't expose NAP data reliably via scraping.
// We locate the page via Outscraper Google Search, then mark NAP as needs_manual_check.
export async function checkFacebook(client: ClientProfile): Promise<FacebookResult> {
  const empty: FacebookResult = { exists: false, pageUrl: null, name: null, napStatus: 'not_found' };
  try {
    const results = await googleSearch(`site:facebook.com "${client.name}"`);
    const match = results.find(r => r.link?.includes('facebook.com'));
    if (!match?.link) return empty;
    return {
      exists: true,
      pageUrl: match.link,
      name: match.title ?? null,
      // ponytail: FB page content not scraped — NAP verification requires manual check
      napStatus: 'needs_manual_check',
    };
  } catch (e) {
    return { ...empty, error: String(e) };
  }
}
