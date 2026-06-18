import dotenv from 'dotenv';
import { resolve } from 'path';

// Load .env first, then .env.local (overrides). Mirrors Vite/Next.js convention.
dotenv.config({ path: resolve(import.meta.dirname, '..', '.env') });
dotenv.config({ path: resolve(import.meta.dirname, '..', '.env.local'), override: true });

export const ROOT = resolve(import.meta.dirname, '..');

export function getClientDir(clientName: string) {
  return {
    raw:        resolve(ROOT, 'clients', clientName, 'raw'),
    structured: resolve(ROOT, 'clients', clientName, 'structured'),
    site:       resolve(ROOT, 'clients', clientName, 'site'),
    pages:      resolve(ROOT, 'clients', clientName, 'structured', 'pages'),
    images:     resolve(ROOT, 'clients', clientName, 'raw', 'images'),
  };
}

export const FIRECRAWL_API_KEY  = process.env.FIRECRAWL_API_KEY ?? '';
export const ANTHROPIC_API_KEY  = process.env.ANTHROPIC_API_KEY ?? '';
export const TEMPLATE_DIR       = resolve(ROOT, 'template');

export function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing env: ${key}. Add it to .env.local`);
  return val;
}
