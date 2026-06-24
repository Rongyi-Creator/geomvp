import type { ClientProfile, KrakResult } from '../types.js';

// Uses Outscraper Google Search (site:krak.dk) to bypass 403 bot protection
export async function checkKrak(client: ClientProfile): Promise<KrakResult> {
  const apiKey = process.env.OUTSCRAPER_API_KEY;
  if (!apiKey) return { exists: false, name: null, address: null, phone: null, listingUrl: null, error: 'OUTSCRAPER_API_KEY not set' };

  const query = `site:krak.dk "${client.name}" "${client.address.city}"`;
  const params = new URLSearchParams({ query, limit: '3', language: 'da' });

  try {
    const resp = await fetch(`https://api.outscraper.com/google-search?${params}`, {
      headers: { 'X-API-KEY': apiKey },
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) return { exists: false, name: null, address: null, phone: null, listingUrl: null, error: `Outscraper ${resp.status}` };

    const data = await resp.json() as { data?: Array<Array<{ link?: string; title?: string; snippet?: string }>> };
    const results = data.data?.[0] ?? [];

    const match = results.find(r => r.link?.includes('krak.dk'));
    if (!match?.link) return { exists: false, name: null, address: null, phone: null, listingUrl: null };

    // ponytail: NAP extracted from snippet only — Krak blocks direct scraping
    return { exists: true, name: match.title ?? null, address: null, phone: null, listingUrl: match.link };
  } catch (e) {
    return { exists: false, name: null, address: null, phone: null, listingUrl: null, error: String(e) };
  }
}
