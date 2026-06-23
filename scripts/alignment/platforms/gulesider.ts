import type { ClientProfile, GuleSiderResult } from '../types.js';
import { nameMatches } from '../normalize.js';

export async function checkGuleSider(client: ClientProfile): Promise<GuleSiderResult> {
  const searchUrl = `https://www.degulesider.dk/søg/${encodeURIComponent(client.name)}/${encodeURIComponent(client.address.city)}`;

  try {
    const resp = await fetch(searchUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FoundByAI-AlignmentCheck/1.0)' },
      signal: AbortSignal.timeout(12000),
    });

    if (!resp.ok) {
      if (resp.status === 429) return { exists: false, name: null, address: null, phone: null, listingUrl: null, error: 'rate_limited' };
      return { exists: false, name: null, address: null, phone: null, listingUrl: null, error: `HTTP ${resp.status}` };
    }

    const html = await resp.text();
    return parseGuleSiderResults(html, client);
  } catch (e) {
    return { exists: false, name: null, address: null, phone: null, listingUrl: null, error: String(e) };
  }
}

function parseGuleSiderResults(html: string, client: ClientProfile): GuleSiderResult {
  // De Gule Sider renders similar card structure to Krak
  const nameMatches2 = [...html.matchAll(/<[^>]+class="[^"]*company-name[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/gi)];
  const addressMatches = [...html.matchAll(/<[^>]+class="[^"]*company-address[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/gi)];
  const phoneMatches = [...html.matchAll(/<[^>]+class="[^"]*company-phone[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/gi)];
  const hrefMatches = [...html.matchAll(/href="(\/virksomhed\/[^"]+)"/gi)];

  for (let i = 0; i < nameMatches2.length; i++) {
    const rawName = stripTags(nameMatches2[i]?.[1] ?? '').trim();
    if (!rawName || !nameMatches(rawName, client.name)) continue;

    const address = stripTags(addressMatches[i]?.[1] ?? '').trim() || null;
    const phone = stripTags(phoneMatches[i]?.[1] ?? '').trim() || null;
    const href = hrefMatches[i]?.[1] ?? null;
    const listingUrl = href ? `https://www.degulesider.dk${href}` : null;

    return { exists: true, name: rawName, address, phone, listingUrl };
  }

  return { exists: false, name: null, address: null, phone: null, listingUrl: null };
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').trim();
}
