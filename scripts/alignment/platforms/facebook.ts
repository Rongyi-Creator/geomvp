import type { ClientProfile, FacebookResult } from '../types.js';

// Facebook doesn't expose NAP data reliably via scraping.
// We locate the page via Outscraper Google Search, then mark NAP as needs_manual_check.
export async function checkFacebook(client: ClientProfile): Promise<FacebookResult> {
  const apiKey = process.env.OUTSCRAPER_API_KEY;
  if (!apiKey) {
    return { exists: false, pageUrl: null, name: null, napStatus: 'not_found', error: 'OUTSCRAPER_API_KEY not set' };
  }

  const query = `site:facebook.com "${client.name}"`;
  const params = new URLSearchParams({ query, limit: '3', language: 'da', async: 'false' });

  try {
    const resp = await fetch(`https://api.outscraper.com/google-search?${params}`, {
      headers: { 'X-API-KEY': apiKey },
      signal: AbortSignal.timeout(60000), // sync request holds connection until results ready
    });

    if (!resp.ok) {
      return { exists: false, pageUrl: null, name: null, napStatus: 'not_found', error: `Outscraper ${resp.status}` };
    }

    const data = await resp.json() as { data?: Array<Array<{ link?: string; title?: string }>> };
    const results = data.data?.[0] ?? [];

    const fbResult = results.find(r => r.link?.includes('facebook.com'));
    if (!fbResult?.link) {
      return { exists: false, pageUrl: null, name: null, napStatus: 'not_found' };
    }

    return {
      exists: true,
      pageUrl: fbResult.link,
      name: fbResult.title ?? null,
      // ponytail: FB page content not scraped — NAP verification requires manual check
      napStatus: 'needs_manual_check',
    };
  } catch (e) {
    return { exists: false, pageUrl: null, name: null, napStatus: 'not_found', error: String(e) };
  }
}
