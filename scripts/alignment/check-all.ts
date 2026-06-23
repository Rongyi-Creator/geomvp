import type { ClientProfile, AlignmentCheckResult, GoogleResult, TrustpilotResult, KrakResult, GuleSiderResult, FacebookResult, WebsiteResult } from './types.js';
import { checkGoogle } from './platforms/google.js';
import { checkTrustpilot } from './platforms/trustpilot.js';
import { checkKrak } from './platforms/krak.js';
import { checkGuleSider } from './platforms/gulesider.js';
import { checkFacebook } from './platforms/facebook.js';
import { checkWebsite } from './platforms/website.js';

// ponytail: Krak and GuleSider need ≥2s gap to avoid rate limiting
async function withDelay<T>(fn: () => Promise<T>, delayMs: number): Promise<T> {
  await new Promise(r => setTimeout(r, delayMs));
  return fn();
}

export async function runAlignmentCheck(client: ClientProfile): Promise<AlignmentCheckResult> {
  console.log(`[alignment] Checking platforms for ${client.name} (${client.domain})...`);

  // Google and Facebook use Outscraper (rate-limit managed by them)
  // Krak and GuleSider need stagger to avoid their rate limits
  const [googleR, trustpilotR, websiteR, facebookR, krakR, guleSiderR] = await Promise.allSettled([
    checkGoogle(client),
    checkTrustpilot(client),
    checkWebsite(client),
    checkFacebook(client),
    withDelay(() => checkKrak(client), 0),
    withDelay(() => checkGuleSider(client), 2500), // 2.5s after Krak starts
  ]);

  const result: AlignmentCheckResult = {
    clientId: client.id,
    checkedAt: new Date().toISOString(),
    canonical: client,
    platforms: {
      google:     googleR.status    === 'fulfilled' ? googleR.value    : errorResult<GoogleResult>('Outscraper API failed'),
      trustpilot: trustpilotR.status === 'fulfilled' ? trustpilotR.value : errorResult<TrustpilotResult>('Trustpilot fetch failed'),
      krak:       krakR.status      === 'fulfilled' ? krakR.value      : errorResult<KrakResult>('Krak fetch failed'),
      guleSider:  guleSiderR.status === 'fulfilled' ? guleSiderR.value  : errorResult<GuleSiderResult>('GuleSider fetch failed'),
      facebook:   facebookR.status  === 'fulfilled' ? facebookR.value   : errorResult<FacebookResult>('Facebook search failed'),
      website:    websiteR.status   === 'fulfilled' ? websiteR.value    : errorResult<WebsiteResult>('Website fetch failed'),
    },
  };

  logSummary(result);
  return result;
}

function errorResult<T>(msg: string): T {
  return { exists: false, error: msg } as T;
}

function logSummary(r: AlignmentCheckResult): void {
  const p = r.platforms;
  console.log(`[alignment] Results:
  Google:      ${p.google.exists ? '✅' : '❌'} ${p.google.error ?? ''}
  Trustpilot:  ${p.trustpilot.exists ? '✅' : '❌'} ${p.trustpilot.error ?? ''}
  Krak:        ${p.krak.exists ? '✅' : '❌'} ${p.krak.error ?? ''}
  De Gule Sider: ${p.guleSider.exists ? '✅' : '❌'} ${p.guleSider.error ?? ''}
  Facebook:    ${p.facebook.exists ? '✅' : '❌'} ${p.facebook.error ?? ''}
  Website:     ${p.website.hasJsonLd ? '✅ JSON-LD' : '⚠️ no JSON-LD'} ${p.website.error ?? ''}`);
}
