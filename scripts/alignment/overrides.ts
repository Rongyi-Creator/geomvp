// Human-verification overrides (slice 2): when automated detection returns
// needs_verification, a human confirms via the dashboard /verify page, which stores
// the verdict in KV. This module fetches those verdicts and folds them back into the
// check result so scoring credits confirmed listings.
import type { AlignmentCheckResult, AlignmentOverrides } from './types.js';

export async function fetchOverrides(workerUrl: string, opsToken: string, client: string): Promise<AlignmentOverrides> {
  try {
    const r = await fetch(`${workerUrl}/api/verify/${client}`, { headers: { Authorization: `Bearer ${opsToken}` } });
    if (!r.ok) return {};
    return (await r.json() as { overrides?: AlignmentOverrides }).overrides ?? {};
  } catch { return {}; }
}

// Mutate exists per the human verdict so calcCoverageScore credits a manually-confirmed
// listing (and stops crediting one a human confirmed absent). 'differs' still exists.
export function applyOverrides(check: AlignmentCheckResult, ov: AlignmentOverrides): void {
  const platforms = check.platforms as Record<string, { exists?: boolean }>;
  for (const [id, o] of Object.entries(ov)) {
    if (!platforms[id]) continue;
    platforms[id].exists = o.verdict !== 'missing'; // exists | differs → true, missing → false
  }
}

// ponytail: self-check the merge — run `tsx scripts/alignment/overrides.ts --selftest`
if (process.argv.includes('--selftest')) {
  const mk = () => ({ platforms: { trustpilot: { exists: false }, krak: { exists: false }, facebook: { exists: true } } }) as unknown as AlignmentCheckResult;
  const c = mk();
  applyOverrides(c, { trustpilot: { verdict: 'exists', at: 'x' }, krak: { verdict: 'missing', at: 'x' }, facebook: { verdict: 'differs', at: 'x' } });
  const p = c.platforms as Record<string, { exists?: boolean }>;
  if (p.trustpilot.exists !== true)  throw new Error('exists verdict should set exists=true');
  if (p.krak.exists !== false)       throw new Error('missing verdict should set exists=false');
  if (p.facebook.exists !== true)    throw new Error('differs verdict should keep exists=true');
  console.log('✓ applyOverrides self-check passed');
}
