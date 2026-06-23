import type { AlignmentCheckResult, NapComparison, ScoreBreakdown, ScoreGrade } from './types.js';

const PLATFORM_WEIGHTS = [
  { platform: 'google',     maxPoints: 15, existsPoints: 8,  claimedPoints: 15 },
  { platform: 'trustpilot', maxPoints: 10, existsPoints: 5,  claimedPoints: 10 },
  { platform: 'krak',       maxPoints:  5, existsPoints: 3,  claimedPoints:  5 },
  { platform: 'guleSider',  maxPoints:  5, existsPoints: 3,  claimedPoints:  5 },
  { platform: 'facebook',   maxPoints:  5, existsPoints: 3,  claimedPoints:  5 },
];

export { PLATFORM_WEIGHTS };

function calcCoverageScore(r: AlignmentCheckResult): number {
  let score = 0;
  for (const w of PLATFORM_WEIGHTS) {
    const p = (r.platforms as Record<string, { exists?: boolean; claimed?: boolean }>)[w.platform];
    if (!p?.exists) continue;
    score += (p.claimed !== false) ? w.claimedPoints : w.existsPoints;
  }
  return score; // 0–40
}

const MATCH_SCORE: Record<string, number> = { exact: 1.0, equivalent: 0.8, minor_diff: 0.4, major_diff: 0.0, missing: 0.0 };

function calcConsistencyScore(comparisons: NapComparison[]): number {
  const fieldWeights: Record<string, number> = { name: 15, address: 15, phone: 10 };
  let score = 0;
  for (const [field, maxPoints] of Object.entries(fieldWeights)) {
    const fieldComparisons = comparisons.filter(c => c.field === field);
    if (fieldComparisons.length === 0) { score += maxPoints; continue; }
    const avg = fieldComparisons.reduce((s, c) => s + (MATCH_SCORE[c.match] ?? 0), 0) / fieldComparisons.length;
    score += Math.round(avg * maxPoints);
  }
  return score; // 0–40
}

function calcSignalScore(r: AlignmentCheckResult): number {
  let score = 0;
  const site = r.platforms.website;
  if (site.hasJsonLd)    score += 4;
  if (site.hasRobotsTxt) score += 2;
  if (site.hasSitemap)   score += 2;
  if (site.sslValid)     score += 2;

  const g = r.platforms.google;
  const tp = r.platforms.trustpilot;
  if (g.rating !== null) {
    if (g.rating >= 4.5) score += 5;
    else if (g.rating >= 4.0) score += 4;
    else if (g.rating >= 3.5) score += 2;
    else score += 1;
  }
  const totalReviews = (g.reviewCount ?? 0) + (tp.reviewCount ?? 0);
  if (totalReviews >= 20) score += 3;
  else if (totalReviews >= 10) score += 2;
  else if (totalReviews >= 3)  score += 1;

  if (tp.rating !== null) {
    if (tp.rating >= 4.0) score += 2;
    else if (tp.rating >= 3.0) score += 1;
  }
  return score; // 0–20
}

function getGrade(total: number): ScoreGrade {
  if (total >= 85) return { score: total, grade: 'A', label_da: 'Fremragende',   color: '#16A34A' };
  if (total >= 70) return { score: total, grade: 'B', label_da: 'God',            color: '#65A30D' };
  if (total >= 50) return { score: total, grade: 'C', label_da: 'Acceptabel',     color: '#CA8A04' };
  if (total >= 30) return { score: total, grade: 'D', label_da: 'Utilstrækkelig', color: '#EA580C' };
  return                   { score: total, grade: 'F', label_da: 'Kritisk',        color: '#DC2626' };
}

export function calcScore(r: AlignmentCheckResult, comparisons: NapComparison[]): ScoreBreakdown {
  const coverage    = calcCoverageScore(r);
  const consistency = calcConsistencyScore(comparisons);
  const signals     = calcSignalScore(r);
  const total       = coverage + consistency + signals;
  return { coverage, consistency, signals, total, grade: getGrade(total) };
}
