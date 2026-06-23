import type { ClientProfile, WebsiteResult } from '../types.js';

export async function checkWebsite(client: ClientProfile): Promise<WebsiteResult> {
  const base = `https://${client.domain}`;

  const [homeResp, robotsResp, sitemapResp] = await Promise.allSettled([
    fetch(`${base}/`, { signal: AbortSignal.timeout(10000) }),
    fetch(`${base}/robots.txt`, { signal: AbortSignal.timeout(5000) }),
    fetch(`${base}/sitemap.xml`, { signal: AbortSignal.timeout(5000) }),
  ]);

  const sslValid = homeResp.status === 'fulfilled' && !homeResp.value.url.startsWith('http://');
  const hasRobotsTxt = robotsResp.status === 'fulfilled' && robotsResp.value.ok;
  const hasSitemap = sitemapResp.status === 'fulfilled' && sitemapResp.value.ok;

  let hasJsonLd = false;
  let jsonLdData: object | null = null;
  let napFromSite = { name: null as string | null, address: null as string | null, phone: null as string | null };

  if (homeResp.status === 'fulfilled' && homeResp.value.ok) {
    const html = await homeResp.value.text();

    // Extract JSON-LD
    const jsonLdMatches = [...html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)];
    for (const m of jsonLdMatches) {
      try {
        const parsed = JSON.parse(m[1]);
        // Look for LocalBusiness/MedicalBusiness schema
        const schemas = Array.isArray(parsed) ? parsed : [parsed];
        const biz = schemas.find(s => s['@type'] && String(s['@type']).includes('Business'));
        if (biz) {
          hasJsonLd = true;
          jsonLdData = biz;
          napFromSite = {
            name: biz.name ?? null,
            address: biz.address ? `${biz.address.streetAddress ?? ''} ${biz.address.postalCode ?? ''} ${biz.address.addressLocality ?? ''}`.trim() : null,
            phone: biz.telephone ?? null,
          };
          break;
        }
      } catch { /* skip */ }
    }

    // Fallback: extract visible NAP from footer/kontakt if no JSON-LD
    if (!napFromSite.phone) {
      const phoneMatch = html.match(/(\+45[\s\d]{8,12}|[\d]{2}[\s\d]{6,8})/);
      if (phoneMatch) napFromSite.phone = phoneMatch[1].trim();
    }
  }

  return { hasJsonLd, jsonLdData, hasRobotsTxt, hasSitemap, sslValid, napFromSite };
}
