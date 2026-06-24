import type { ClientProfile, GuleSiderResult } from '../types.js';
import { googleSearch } from '../outscraper.js';
import { nameMatches } from '../normalize.js';

// A real De Gule Sider company listing URL ends in /<numeric-id>/firma.
// /firmaer (plural) and /kort/søg/ are category/search pages — same false-positive
// risk as Krak, so require a real profile URL + name match.
const isGuleSiderProfile = (link: string) => /\/\d+\/firma\/?$/.test(link);

// Uses Outscraper Google Search (site:degulesider.dk) to bypass 403 bot protection
export async function checkGuleSider(client: ClientProfile): Promise<GuleSiderResult> {
  const empty: GuleSiderResult = { exists: false, name: null, address: null, phone: null, listingUrl: null };
  try {
    const results = await googleSearch(`site:degulesider.dk "${client.name}"`);
    const match = results.find(r => r.link && isGuleSiderProfile(r.link) && nameMatches(r.title ?? '', client.name));
    if (!match?.link) return empty;
    // ponytail: NAP not scraped — GuleSider blocks direct scraping; we only confirm the listing exists
    return { exists: true, name: match.title ?? null, address: null, phone: null, listingUrl: match.link };
  } catch (e) {
    return { ...empty, error: String(e) };
  }
}
