import type { ClientProfile, KrakResult } from '../types.js';
import { googleSearch } from '../outscraper.js';
import { nameMatches } from '../normalize.js';

// A real Krak company listing URL ends in /<numeric-id>/firma.
// /firmaer (plural) and /kort/søg/ are category/search pages — a site: search returns
// lots of those containing the words, so we must require a real profile + name match.
const isKrakProfile = (link: string) => /\/\d+\/firma\/?$/.test(link);

// Uses Outscraper Google Search (site:krak.dk) to bypass 403 bot protection
export async function checkKrak(client: ClientProfile): Promise<KrakResult> {
  const empty: KrakResult = { exists: false, name: null, address: null, phone: null, listingUrl: null };
  try {
    const results = await googleSearch(`site:krak.dk "${client.name}"`);
    const match = results.find(r => r.link && isKrakProfile(r.link) && nameMatches(r.title ?? '', client.name));
    if (!match?.link) return empty;
    // ponytail: NAP not scraped — Krak blocks direct scraping; we only confirm the listing exists
    return { exists: true, name: match.title ?? null, address: null, phone: null, listingUrl: match.link };
  } catch (e) {
    return { ...empty, error: String(e) };
  }
}
