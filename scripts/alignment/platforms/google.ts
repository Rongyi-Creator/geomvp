import type { ClientProfile, GoogleResult } from '../types.js';
import { nameMatches } from '../normalize.js';
import { outscraperRequest } from '../outscraper.js';

// Uses Outscraper Google Maps Search API (async submit→poll, see outscraper.ts)
export async function checkGoogle(client: ClientProfile): Promise<GoogleResult> {
  // Use name + zip for Maps search — city name alone can mismatch municipality in Google Maps
  const query = `${client.name} ${client.address.zip} ${client.address.country}`;

  let results: Record<string, unknown>[];
  try {
    const data = await outscraperRequest('/maps/search', {
      query,
      limit: '3',
      language: 'da',
      fields: 'name,full_address,phone,rating,reviews,working_hours,place_id,google_id,site',
    });
    // maps/search: data[0] is the array of place objects for this query
    results = (data[0] as Record<string, unknown>[]) ?? [];
  } catch (e) {
    return errorGoogle(`Outscraper Maps error: ${String(e)}`);
  }

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
