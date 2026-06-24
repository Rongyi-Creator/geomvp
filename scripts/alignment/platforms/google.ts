import type { ClientProfile, GoogleResult } from '../types.js';
import { nameMatches } from '../normalize.js';

// Uses Outscraper Google Maps Search API
// Free tier: 500 requests/month
export async function checkGoogle(client: ClientProfile): Promise<GoogleResult> {
  const apiKey = process.env.OUTSCRAPER_API_KEY;
  if (!apiKey) throw new Error('OUTSCRAPER_API_KEY not set');

  // Use name + zip for Maps search — city name alone can mismatch municipality in Google Maps
  const query = `${client.name} ${client.address.zip} ${client.address.country}`;
  const params = new URLSearchParams({
    query,
    limit: '3',
    language: 'da',
    fields: 'name,full_address,phone,rating,reviews,working_hours,place_id,google_id,site',
  });

  const resp = await fetch(`https://api.outscraper.com/maps/search?${params}`, {
    headers: { 'X-API-KEY': apiKey },
  });

  if (!resp.ok) {
    const text = await resp.text();
    return errorGoogle(`Outscraper API error ${resp.status}: ${text.slice(0, 100)}`);
  }

  const data = await resp.json() as { data?: Array<Record<string, unknown>[]> };
  const results: Record<string, unknown>[] = data.data?.[0] ?? [];

  // Find the best match by name (fuzzy)
  const match = results.find(r => nameMatches(String(r.name ?? ''), client.name));
  if (!match) return { exists: false, name: null, address: null, phone: null, rating: null, reviewCount: null, hours: null, mapsUrl: null, placeId: null, categories: [], claimed: false };

  const placeId = String(match.place_id ?? match.google_id ?? '');
  return {
    exists: true,
    name: String(match.name ?? ''),
    address: String(match.full_address ?? ''),
    phone: String(match.phone ?? ''),
    rating: typeof match.rating === 'number' ? match.rating : null,
    reviewCount: typeof match.reviews === 'number' ? match.reviews : null,
    hours: match.working_hours ? JSON.stringify(match.working_hours) : null,
    mapsUrl: placeId ? `https://maps.google.com/?cid=${placeId}` : null,
    placeId: placeId || null,
    categories: [],
    // ponytail: Outscraper doesn't return claimed status; assume claimed if listing exists with phone
    claimed: Boolean(match.phone),
  };
}

function errorGoogle(msg: string): GoogleResult {
  return { exists: false, name: null, address: null, phone: null, rating: null, reviewCount: null, hours: null, mapsUrl: null, placeId: null, categories: [], claimed: false, error: msg };
}
