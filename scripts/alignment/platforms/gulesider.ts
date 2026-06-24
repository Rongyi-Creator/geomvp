import type { ClientProfile, GuleSiderResult } from '../types.js';
import { googleSearch } from '../outscraper.js';

// Uses Outscraper Google Search (site:degulesider.dk) to bypass 403 bot protection
export async function checkGuleSider(client: ClientProfile): Promise<GuleSiderResult> {
  const empty: GuleSiderResult = { exists: false, name: null, address: null, phone: null, listingUrl: null };
  try {
    const results = await googleSearch(`site:degulesider.dk "${client.name}"`);
    const match = results.find(r => r.link?.includes('degulesider.dk'));
    if (!match?.link) return empty;
    // ponytail: NAP extracted from snippet only — GuleSider blocks direct scraping
    return { exists: true, name: match.title ?? null, address: null, phone: null, listingUrl: match.link };
  } catch (e) {
    return { ...empty, error: String(e) };
  }
}
