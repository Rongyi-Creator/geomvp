import type { ClientProfile, KrakResult } from '../types.js';
import { nameMatches } from '../normalize.js';

export async function checkKrak(client: ClientProfile): Promise<KrakResult> {
  const searchUrl = `https://www.krak.dk/søg?what=${encodeURIComponent(client.name)}&where=${encodeURIComponent(client.address.city)}`;

  try {
    // Rate limit courtesy: caller should ensure ≥2s between Krak/GuleSider requests
    const resp = await fetch(searchUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FoundByAI-AlignmentCheck/1.0)' },
      signal: AbortSignal.timeout(12000),
    });

    if (!resp.ok) {
      if (resp.status === 429) return { exists: false, name: null, address: null, phone: null, listingUrl: null, error: 'rate_limited' };
      return { exists: false, name: null, address: null, phone: null, listingUrl: null, error: `HTTP ${resp.status}` };
    }

    const html = await resp.text();
    return parseKrakResults(html, client, searchUrl);
  } catch (e) {
    return { exists: false, name: null, address: null, phone: null, listingUrl: null, error: String(e) };
  }
}

function parseKrakResults(html: string, client: ClientProfile, _searchUrl: string): KrakResult {
  // Extract company name, address, phone from search result cards
  // Krak renders: <span class="hit-name">...</span> <span class="hit-address">...</span>
  const nameMatches2: RegExpMatchArray[] = [...html.matchAll(/<[^>]+class="[^"]*hit-name[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/gi)];
  const addressMatches: RegExpMatchArray[] = [...html.matchAll(/<[^>]+class="[^"]*hit-address[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/gi)];
  const phoneMatches: RegExpMatchArray[] = [...html.matchAll(/<[^>]+class="[^"]*hit-phone[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/gi)];
  const hrefMatches: RegExpMatchArray[] = [...html.matchAll(/href="(\/firma\/[^"]+)"/gi)];

  for (let i = 0; i < nameMatches2.length; i++) {
    const rawName = stripTags(nameMatches2[i]?.[1] ?? '').trim();
    if (!rawName || !nameMatches(rawName, client.name)) continue;

    const address = stripTags(addressMatches[i]?.[1] ?? '').trim() || null;
    const phone = stripTags(phoneMatches[i]?.[1] ?? '').trim() || null;
    const href = hrefMatches[i]?.[1] ?? null;
    const listingUrl = href ? `https://www.krak.dk${href}` : null;

    return { exists: true, name: rawName, address, phone, listingUrl };
  }

  return { exists: false, name: null, address: null, phone: null, listingUrl: null };
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').trim();
}
