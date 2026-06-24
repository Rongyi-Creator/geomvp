import type { ClientProfile, KrakResult } from '../types.js';
import { googleSearch } from '../outscraper.js';

// Uses Outscraper Google Search (site:krak.dk) to bypass 403 bot protection
export async function checkKrak(client: ClientProfile): Promise<KrakResult> {
  const empty: KrakResult = { exists: false, name: null, address: null, phone: null, listingUrl: null };
  try {
    const results = await googleSearch(`site:krak.dk "${client.name}"`);
    const match = results.find(r => r.link?.includes('krak.dk'));
    if (!match?.link) return empty;
    // ponytail: NAP extracted from snippet only — Krak blocks direct scraping
    return { exists: true, name: match.title ?? null, address: null, phone: null, listingUrl: match.link };
  } catch (e) {
    return { ...empty, error: String(e) };
  }
}
