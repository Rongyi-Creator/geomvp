import type { ClientProfile, FacebookResult } from '../types.js';
import { googleSearch } from '../outscraper.js';
import { nameMatches } from '../normalize.js';

// A site:facebook.com search matches any post/group/event mentioning the name, not
// just the official Business page. Accept only page-root URLs (facebook.com/<slug>
// or legacy /pages/...), reject posts/groups/events/personal profiles to cut false positives.
const SUBPAGE_SEGMENTS = new Set(['posts', 'photos', 'videos', 'reel', 'reels', 'events', 'about', 'community']);
const NON_PAGE_FIRST = new Set(['groups', 'watch', 'marketplace', 'story.php', 'profile.php', 'sharer', 'login', 'help', 'events']);
function isFacebookPage(link: string): boolean {
  try {
    const u = new URL(link);
    if (!u.hostname.replace(/^www\./, '').endsWith('facebook.com')) return false;
    const seg = u.pathname.split('/').filter(Boolean).map(s => s.toLowerCase());
    if (seg.length === 0) return false;            // bare facebook.com
    if (seg.some(s => SUBPAGE_SEGMENTS.has(s))) return false; // a post/photo/etc under a page
    if (NON_PAGE_FIRST.has(seg[0])) return false;  // group / personal profile / system path
    return true;                                    // /<slug> or legacy /pages/<name>/<id>
  } catch { return false; }
}

// Facebook doesn't expose NAP data reliably via scraping.
// We locate the page via Outscraper Google Search, then mark NAP as needs_manual_check.
export async function checkFacebook(client: ClientProfile): Promise<FacebookResult> {
  const empty: FacebookResult = { exists: false, pageUrl: null, name: null, napStatus: 'not_found' };
  try {
    const results = await googleSearch(`site:facebook.com "${client.name}"`);
    const match = results.find(r => r.link && isFacebookPage(r.link) && nameMatches(r.title ?? '', client.name));
    if (!match?.link) return empty;
    return {
      exists: true,
      pageUrl: match.link,
      name: match.title ?? null,
      // ponytail: FB page content not scraped — NAP verification requires manual check
      napStatus: 'needs_manual_check',
    };
  } catch (e) {
    return { ...empty, error: String(e) };
  }
}

// ponytail: self-check the page matcher — run `tsx scripts/alignment/platforms/facebook.ts --selftest`
if (process.argv.includes('--selftest')) {
  const pages = ['https://www.facebook.com/VirumAkupunktur', 'https://facebook.com/pages/Foo-Clinic/123', 'https://www.facebook.com/virum.akupunktur/'];
  const notPages = ['https://www.facebook.com/groups/123456', 'https://www.facebook.com/VirumAkupunktur/posts/789', 'https://facebook.com/profile.php?id=9', 'https://www.facebook.com/watch/?v=1', 'https://m.youtube.com/x'];
  for (const u of pages)    if (!isFacebookPage(u)) throw new Error(`expected PAGE: ${u}`);
  for (const u of notPages) if (isFacebookPage(u))  throw new Error(`expected NON-PAGE: ${u}`);
  console.log('✓ isFacebookPage self-check passed');
}
