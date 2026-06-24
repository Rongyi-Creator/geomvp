import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import type { AlignmentReport } from './types.js';

// Updates sameAs in business.json based on verified alignment results
export function updateGeoLayer(clientId: string, report: AlignmentReport): void {
  const businessPath = resolve(process.cwd(), `clients/${getClientDir(clientId)}/structured/business.json`);

  let business: Record<string, unknown>;
  try {
    business = JSON.parse(readFileSync(businessPath, 'utf8'));
  } catch (e) {
    console.error(`[alignment] Could not read business.json for ${clientId}:`, e);
    return;
  }

  const prev = (business.sameAs as string[] | undefined) ?? [];
  // Union: keep existing verified URLs, add newly confirmed ones — never remove on transient failure
  const merged = Array.from(new Set([...prev, ...report.sameAsUpdated]));
  business.sameAs = merged;

  writeFileSync(businessPath, JSON.stringify(business, null, 2) + '\n');
  console.log(`[alignment] sameAs updated for ${clientId}:`);
  console.log(`  Before: [${prev.join(', ')}]`);
  console.log(`  After:  [${report.sameAsUpdated.join(', ')}]`);
}

// Maps client ID to directory name under clients/
function getClientDir(clientId: string): string {
  const map: Record<string, string> = {
    'virum': 'virum-akupunktur',
  };
  return map[clientId] ?? clientId;
}
