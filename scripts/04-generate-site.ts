/**
 * Step 4: Generate the Astro site from template + structured data
 * Usage:  pnpm generate <client-name> [--scheme scheme-a|scheme-b|scheme-c]
 */

import { mkdirSync, cpSync, writeFileSync, readFileSync, readdirSync, renameSync, rmSync, existsSync } from 'fs';
import { resolve } from 'path';
import { execSync } from 'child_process';
import { TEMPLATE_DIR, getClientDir } from './config.js';

const [clientName, schemeFlag, schemeId = 'scheme-a'] = process.argv.slice(2);

if (!clientName) {
  console.error('Usage: pnpm generate <client-name> [--scheme scheme-a|scheme-b|scheme-c]');
  process.exit(1);
}

const dirs = getClientDir(clientName);
const siteDir = dirs.site;

// ── Copy template ──────────────────────────────────────────────────────────────
console.log(`\n📁 Copying template → ${siteDir}`);
cpSync(TEMPLATE_DIR, siteDir, {
  recursive: true,
  filter: (src) => !src.includes('/dist/') && !src.includes('/node_modules/') && !src.includes('/.astro/'),
});

// ── Inject structured data ─────────────────────────────────────────────────────
const dataDir = resolve(siteDir, 'src', 'data');
const contentDir = resolve(siteDir, 'src', 'content', 'services');

// Read color scheme
const colorsData = JSON.parse(readFileSync(resolve(dirs.structured, 'colors.json'), 'utf8'));
const targetSchemeId = schemeFlag === '--scheme' ? schemeId : 'scheme-a';
const scheme = colorsData.schemes.find((s: { id: string }) => s.id === targetSchemeId)
  ?? colorsData.schemes[0];

// Copy business.json + faq.json
cpSync(resolve(dirs.structured, 'business.json'), resolve(dataDir, 'business.json'));
cpSync(resolve(dirs.structured, 'faq.json'), resolve(dataDir, 'faq.json'));

// Write colors.json with active scheme set
const activeColors = {
  ...colorsData,
  active: scheme.id,
  schemes: colorsData.schemes,
};
writeFileSync(resolve(dataDir, 'colors.json'), JSON.stringify(activeColors, null, 2));

// Inject color CSS variables into theme.css
const themePath = resolve(siteDir, 'src', 'styles', 'theme.css');
let themeCSS = readFileSync(themePath, 'utf8');
const colorVars: Record<string, string> = scheme.colors;
for (const [key, val] of Object.entries(colorVars)) {
  const cssVar = `--color-${key}`;
  themeCSS = themeCSS.replace(
    new RegExp(`(${cssVar.replace(/-/g, '\\-')}:\\s*)[^;]+;`),
    `$1${val};`
  );
}
writeFileSync(themePath, themeCSS);

// Copy structured pages (remove sample content first)
const existingMd = readdirSync(contentDir).filter(f => f.endsWith('.md'));
for (const f of existingMd) {
  // keep sample files if no structured pages exist
}

const structuredPages = readdirSync(dirs.pages)
  .filter(f => f.endsWith('.md') && !f.startsWith('.') && f.length > 3);
if (structuredPages.length > 0) {
  // Remove sample content
  for (const f of existingMd) {
    writeFileSync(resolve(contentDir, f), ''); // clear; can't delete easily
  }
  // Write structured pages
  for (const f of structuredPages) {
    const src = readFileSync(resolve(dirs.pages, f), 'utf8');
    writeFileSync(resolve(contentDir, f), src);
  }
}

// Copy images
const imageDir = resolve(siteDir, 'public', 'images');
mkdirSync(imageDir, { recursive: true });
try {
  cpSync(dirs.images, imageDir, { recursive: true });
} catch { /* no images to copy */ }

// Update astro.config.mjs with real domain from business.json
const business = JSON.parse(readFileSync(resolve(dirs.structured, 'business.json'), 'utf8'));
const configPath = resolve(siteDir, 'astro.config.mjs');
let config = readFileSync(configPath, 'utf8');
config = config.replace('https://DOMAIN_PLACEHOLDER', business.website ?? 'https://example.com');
writeFileSync(configPath, config);

// Update robots.txt domain
const robotsPath = resolve(siteDir, 'public', 'robots.txt');
let robots = readFileSync(robotsPath, 'utf8');
robots = robots.replace('https://DOMAIN_PLACEHOLDER', business.website ?? 'https://example.com');
writeFileSync(robotsPath, robots);

// ── Install & build ────────────────────────────────────────────────────────────
console.log('\n📦 Installing dependencies...');
execSync('pnpm install', { cwd: siteDir, stdio: 'inherit' });

console.log(`\n🔨 Building (${scheme.name})...`);
execSync('pnpm build', { cwd: siteDir, stdio: 'inherit' });

// Rename dist/ → dist-<scheme-id>/ so multiple schemes can coexist
const defaultDist = resolve(siteDir, 'dist');
const distDir = resolve(siteDir, `dist-${scheme.id}`);
if (existsSync(distDir)) rmSync(distDir, { recursive: true, force: true });
renameSync(defaultDist, distDir);

console.log(`\n✅ Site generated:`);
console.log(`   Scheme: ${scheme.name} (${scheme.id})`);
console.log(`   Output: ${distDir}`);
console.log(`\nNext: pnpm qa ${clientName}`);
