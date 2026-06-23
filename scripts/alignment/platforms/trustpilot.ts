import type { ClientProfile, TrustpilotResult } from '../types.js';

export async function checkTrustpilot(client: ClientProfile): Promise<TrustpilotResult> {
  const profileUrl = `https://dk.trustpilot.com/review/${client.domain}`;

  try {
    const resp = await fetch(profileUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FoundByAI-AlignmentCheck/1.0)' },
      signal: AbortSignal.timeout(10000),
    });

    if (resp.status === 404) {
      return { exists: false, claimed: false, rating: null, reviewCount: null, profileUrl: null };
    }

    if (!resp.ok) {
      return { exists: false, claimed: false, rating: null, reviewCount: null, profileUrl: null, error: `HTTP ${resp.status}` };
    }

    const html = await resp.text();

    // Extract rating from JSON-LD
    let rating: number | null = null;
    let reviewCount: number | null = null;
    const jsonLdMatch = html.match(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g);
    if (jsonLdMatch) {
      for (const block of jsonLdMatch) {
        try {
          const inner = block.replace(/<script[^>]*>/, '').replace(/<\/script>/, '');
          const parsed = JSON.parse(inner);
          if (parsed.aggregateRating) {
            rating = parseFloat(parsed.aggregateRating.ratingValue) || null;
            reviewCount = parseInt(parsed.aggregateRating.reviewCount) || null;
            break;
          }
        } catch { /* skip malformed JSON-LD */ }
      }
    }

    // Fallback: data-rating attribute
    if (rating === null) {
      const ratingMatch = html.match(/data-rating-value="([\d.]+)"/);
      if (ratingMatch) rating = parseFloat(ratingMatch[1]);
    }

    const claimed = html.includes('Verified company') || html.includes('Verificeret virksomhed');

    return { exists: true, claimed, rating, reviewCount, profileUrl };
  } catch (e) {
    return { exists: false, claimed: false, rating: null, reviewCount: null, profileUrl: null, error: String(e) };
  }
}
