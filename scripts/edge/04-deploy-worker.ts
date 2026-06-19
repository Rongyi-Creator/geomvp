/**
 * Edge Pipeline Step 4: Deploy Worker to Cloudflare
 * Usage: tsx scripts/edge/04-deploy-worker.ts <client-name>
 *
 * Runs pnpm install + wrangler deploy inside clients/<client>/edge/.
 * Requires CLOUDFLARE_API_TOKEN in .env.local.
 */

import { existsSync } from 'fs';
import { resolve } from 'path';
import { execSync } from 'child_process';
import { ROOT, requireEnv } from '../config.js';

const clientName = process.argv[2];
if (!clientName) {
  console.error('Usage: tsx scripts/edge/04-deploy-worker.ts <client-name>');
  process.exit(1);
}

const edgeDir = resolve(ROOT, 'clients', clientName, 'edge');
const workerFile = resolve(edgeDir, 'src', 'worker.ts');
const wranglerToml = resolve(edgeDir, 'wrangler.toml');

if (!existsSync(workerFile) || !existsSync(wranglerToml)) {
  console.error(`\n❌ No generated worker found at ${edgeDir}`);
  console.error(`   Run step 3 first: tsx scripts/edge/03-generate-worker.ts ${clientName}`);
  process.exit(1);
}

const cfToken = requireEnv('CLOUDFLARE_API_TOKEN');

console.log(`\n🚀 Deploying Edge Worker for "${clientName}"`);
console.log(`   Directory: ${edgeDir}\n`);

function run(cmd: string, label: string) {
  console.log(`── ${label} ──`);
  try {
    execSync(cmd, {
      cwd: edgeDir,
      stdio: 'inherit',
      env: { ...process.env, CLOUDFLARE_API_TOKEN: cfToken },
    });
    console.log(`   ✅ ${label} complete\n`);
  } catch (e) {
    console.error(`\n❌ ${label} failed`);
    process.exit(1);
  }
}

run('pnpm install --frozen-lockfile 2>/dev/null || pnpm install', 'Install dependencies');
run('npx wrangler deploy', 'Deploy to Cloudflare');

console.log(`\n✅ Worker deployed successfully`);
console.log(`\nNext: tsx scripts/edge/05-verify-worker.ts ${clientName}`);
