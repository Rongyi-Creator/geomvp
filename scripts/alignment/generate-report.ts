import type { AlignmentCheckResult, NapComparison, ScoreBreakdown, AlignmentReport, PlatformStatus, PrioritizedAction } from './types.js';
import { PLATFORM_WEIGHTS } from './scoring.js';

const PLATFORM_CONFIG: Record<string, { name_da: string; icon: string; createUrl: string; checkUrl: string }> = {
  google:     { name_da: 'Google Business Profile', icon: '📍', createUrl: 'https://business.google.com/', checkUrl: 'https://business.google.com/' },
  trustpilot: { name_da: 'Trustpilot',              icon: '⭐', createUrl: 'https://business.trustpilot.com/', checkUrl: 'https://business.trustpilot.com/' },
  krak:       { name_da: 'Krak.dk',                 icon: '📞', createUrl: 'https://www.krak.dk/', checkUrl: 'https://www.krak.dk/' },
  guleSider:  { name_da: 'De Gule Sider',            icon: '📒', createUrl: 'https://www.degulesider.dk/', checkUrl: 'https://www.degulesider.dk/' },
  facebook:   { name_da: 'Facebook Business',        icon: '👥', createUrl: 'https://www.facebook.com/business/', checkUrl: 'https://www.facebook.com/' },
  website:    { name_da: 'Din hjemmeside (GEO Layer)', icon: '🌐', createUrl: '', checkUrl: '' },
};

function buildPlatformStatuses(r: AlignmentCheckResult, comparisons: NapComparison[]): PlatformStatus[] {
  const statuses: PlatformStatus[] = [];
  const p = r.platforms;

  // Google
  if (p.google.error && !p.google.exists) {
    statuses.push(ps('google', 'unable_to_check', 'Kunne ikke kontrolleres', []));
  } else if (!p.google.exists) {
    statuses.push(ps('google', 'missing', 'Ikke fundet på Google Maps', ['Ingen Google Business Profile registreret']));
  } else {
    const issues = comparisons.filter(c => c.platform === 'google' && (c.match === 'minor_diff' || c.match === 'major_diff')).map(c => c.diffDescription);
    statuses.push(ps('google', issues.length ? 'warning' : 'ok', issues.length ? 'Fundet — oplysninger bør opdateres' : 'Oprettet og verificeret', issues, p.google.mapsUrl));
  }

  // Trustpilot
  if (!p.trustpilot.exists) {
    statuses.push(ps('trustpilot', 'missing', 'Ingen Trustpilot-profil', ['Profil ikke oprettet']));
  } else {
    statuses.push(ps('trustpilot', 'ok', `Profil fundet · ${p.trustpilot.rating ?? '--'}/5 (${p.trustpilot.reviewCount ?? 0} anmeldelser)`, [], p.trustpilot.profileUrl));
  }

  // Krak
  if (p.krak.error) {
    statuses.push(ps('krak', 'unable_to_check', 'Kunne ikke kontrolleres automatisk', []));
  } else if (!p.krak.exists) {
    statuses.push(ps('krak', 'missing', 'Ikke fundet på Krak.dk', []));
  } else {
    const issues = comparisons.filter(c => c.platform === 'krak' && (c.match === 'minor_diff' || c.match === 'major_diff')).map(c => c.diffDescription);
    // ponytail: we only confirm the listing exists — NAP not scraped from Krak, so don't claim "korrekt"
    statuses.push(ps('krak', issues.length ? 'warning' : 'ok', issues.length ? 'Fundet — oplysninger afviger' : 'Profil fundet', issues, p.krak.listingUrl));
  }

  // De Gule Sider
  if (p.guleSider.error) {
    statuses.push(ps('guleSider', 'unable_to_check', 'Kunne ikke kontrolleres automatisk', []));
  } else if (!p.guleSider.exists) {
    statuses.push(ps('guleSider', 'missing', 'Ikke fundet på De Gule Sider', []));
  } else {
    const issues = comparisons.filter(c => c.platform === 'guleSider' && (c.match === 'minor_diff' || c.match === 'major_diff')).map(c => c.diffDescription);
    // ponytail: we only confirm the listing exists — NAP not scraped from GuleSider, so don't claim "korrekt"
    statuses.push(ps('guleSider', issues.length ? 'warning' : 'ok', issues.length ? 'Fundet — oplysninger afviger' : 'Profil fundet', issues, p.guleSider.listingUrl));
  }

  // Facebook
  if (!p.facebook.exists) {
    statuses.push(ps('facebook', 'missing', 'Ingen Facebook Business-side fundet', []));
  } else {
    statuses.push(ps('facebook', 'ok', 'Facebook-side fundet (NAP kræver manuel verifikation)', [], p.facebook.pageUrl));
  }

  // Website (GEO layer)
  const siteIssues: string[] = [];
  if (!p.website.hasJsonLd)    siteIssues.push('Intet JSON-LD schema-markup fundet');
  if (!p.website.hasRobotsTxt) siteIssues.push('robots.txt mangler');
  if (!p.website.hasSitemap)   siteIssues.push('sitemap.xml mangler');
  if (!p.website.sslValid)     siteIssues.push('SSL-certifikat ugyldigt');
  statuses.push(ps('website', siteIssues.length ? 'warning' : 'ok', siteIssues.length ? 'GEO-lag aktiv — tekniske forbedringer mulige' : 'GEO-lag fuldt aktivt', siteIssues));

  return statuses;
}

function ps(id: string, status: PlatformStatus['status'], statusText_da: string, issues: string[], detailUrl?: string | null): PlatformStatus {
  const cfg = PLATFORM_CONFIG[id];
  return {
    id, name_da: cfg.name_da, icon: cfg.icon, status, statusText_da, issues,
    actionUrl: status === 'missing' ? cfg.createUrl : (status === 'warning' ? cfg.checkUrl : null),
    actionText_da: status === 'missing' ? 'Opret profil →' : (status === 'warning' ? 'Ret oplysninger →' : null),
    detailUrl: detailUrl ?? null,
  };
}

function buildActions(platforms: PlatformStatus[], comparisons: NapComparison[]): PrioritizedAction[] {
  const actions: PrioritizedAction[] = [];
  for (const p of platforms) {
    if (p.status !== 'missing') continue;
    const w = PLATFORM_WEIGHTS.find(w => w.platform === p.id);
    actions.push({
      priority: p.id === 'google' ? 1 : p.id === 'trustpilot' ? 2 : 5,
      action_da: `Opret profil på ${p.name_da}`,
      timeEstimate_da: p.id === 'google' ? '15 min + verifikation (1–5 dage)' : '10 minutter',
      impactText_da: `Forbedrer din score med op til ${w?.maxPoints ?? 5} point`,
      url: p.actionUrl ?? '',
      guideUrl: null,
    });
  }
  for (const c of comparisons.filter(c => c.match === 'major_diff')) {
    actions.push({ priority: 3, action_da: c.recommendation, timeEstimate_da: '2 minutter', impactText_da: 'Kritisk for AI-genkendelse', url: PLATFORM_CONFIG[c.platform]?.checkUrl ?? '', guideUrl: null });
  }
  for (const c of comparisons.filter(c => c.match === 'minor_diff')) {
    actions.push({ priority: 4, action_da: c.recommendation, timeEstimate_da: '2 minutter', impactText_da: 'Forbedrer konsistens', url: PLATFORM_CONFIG[c.platform]?.checkUrl ?? '', guideUrl: null });
  }
  return actions.sort((a, b) => a.priority - b.priority);
}

function buildSameAs(r: AlignmentCheckResult, platforms: PlatformStatus[]): string[] {
  const urls: string[] = [];
  const ok = (id: string) => platforms.find(p => p.id === id)?.status === 'ok';
  if (ok('google') && r.platforms.google.mapsUrl)         urls.push(r.platforms.google.mapsUrl);
  if (ok('trustpilot') && r.platforms.trustpilot.profileUrl) urls.push(r.platforms.trustpilot.profileUrl);
  if (ok('facebook') && r.platforms.facebook.pageUrl)     urls.push(r.platforms.facebook.pageUrl);
  if (ok('krak') && r.platforms.krak.listingUrl)          urls.push(r.platforms.krak.listingUrl);
  if (ok('guleSider') && r.platforms.guleSider.listingUrl) urls.push(r.platforms.guleSider.listingUrl);
  return urls;
}

export function generateReport(
  checkResult: AlignmentCheckResult,
  comparisons: NapComparison[],
  score: ScoreBreakdown,
  runType: AlignmentReport['runType'],
): AlignmentReport {
  const platforms  = buildPlatformStatuses(checkResult, comparisons);
  const actions    = buildActions(platforms, comparisons);
  const sameAs     = buildSameAs(checkResult, platforms);

  return {
    clientId: checkResult.clientId,
    generatedAt: checkResult.checkedAt,
    runType,
    client: { name: checkResult.canonical.name, domain: checkResult.canonical.domain },
    score,
    platforms,
    inconsistencies: comparisons,
    prioritizedActions: actions,
    sameAsUpdated: sameAs,
  };
}
