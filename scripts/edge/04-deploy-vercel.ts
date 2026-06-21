/**
 * Edge Pipeline Step 4 (Vercel): Deploy generated Vercel Edge Function
 * Usage: tsx scripts/edge/04-deploy-vercel.ts <client-name>
 *
 * Prerequisites:
 *   - Run step 3 first: tsx scripts/edge/03-generate-vercel.ts <client-name>
 *   - First-time setup: cd clients/<client>/vercel-edge && vercel link
 *   - DASHBOARD_TOKEN must be set in .env.local
 */

import { execSync, spawnSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { getCloneDir, ROOT } from '../config.js';

const clientName = process.argv[2];
if (!clientName) {
  console.error('Usage: tsx scripts/edge/04-deploy-vercel.ts <client-name>');
  process.exit(1);
}

const vercelDir = resolve(ROOT, 'clients', clientName, 'vercel-edge');

// ── Verify generated files exist ─────────────────────────────────────────────

if (!existsSync(resolve(vercelDir, 'api', 'proxy.ts'))) {
  console.error(`\n❌ Vercel Edge Function not found at ${vercelDir}`);
  console.error(`   Run step 3 first: tsx scripts/edge/03-generate-vercel.ts ${clientName}`);
  process.exit(1);
}

console.log(`\n🚀 Deploying Vercel Edge Function for "${clientName}"`);
console.log(`   Dir: ${vercelDir}`);

// ── Check Vercel CLI ──────────────────────────────────────────────────────────

const vercelBin = resolve(ROOT, 'node_modules', '.bin', 'vercel');
const vercelCmd = existsSync(vercelBin) ? vercelBin : 'vercel';

try {
  execSync(`${vercelCmd} --version`, { stdio: 'pipe' });
} catch {
  console.error('\n❌ Vercel CLI not found. Install it: npm i -g vercel');
  process.exit(1);
}

// ── Check project link ────────────────────────────────────────────────────────

const projectJson = resolve(vercelDir, '.vercel', 'project.json');
if (!existsSync(projectJson)) {
  console.log(`\n⚠️  Project not linked to Vercel yet.`);
  console.log(`   Run these commands first:`);
  console.log(`     cd ${vercelDir}`);
  console.log(`     vercel link`);
  console.log(`   Then re-run this deploy script.\n`);
  process.exit(1);
}

const projectData = JSON.parse(readFileSync(projectJson, 'utf8'));
console.log(`   Project: ${projectData.projectId ?? '(linked)'}`);

// ── Install dependencies ──────────────────────────────────────────────────────

console.log('\n📦 Installing dependencies…');
const installResult = spawnSync('npm', ['install', '--prefer-offline'], {
  cwd: vercelDir,
  stdio: 'inherit',
  shell: true,
});
if (installResult.status !== 0) {
  console.error('\n❌ npm install failed');
  process.exit(1);
}

// ── Add DASHBOARD_TOKEN env var if set locally ────────────────────────────────

const dashboardToken = process.env.DASHBOARD_TOKEN;
if (dashboardToken) {
  console.log('\n🔑 Setting DASHBOARD_TOKEN on Vercel project…');
  const envResult = spawnSync(
    vercelCmd,
    ['env', 'add', 'DASHBOARD_TOKEN', 'production'],
    {
      cwd: vercelDir,
      input: dashboardToken + '\n',
      stdio: ['pipe', 'inherit', 'inherit'],
      shell: false,
    },
  );
  if (envResult.status === 0) {
    console.log('   ✅ DASHBOARD_TOKEN set');
  } else {
    console.log('   ℹ️  DASHBOARD_TOKEN may already exist — skipping (add manually if needed)');
  }
} else {
  console.log('\n⚠️  DASHBOARD_TOKEN not found in env — analytics will be disabled.');
  console.log('   Add it with: vercel env add DASHBOARD_TOKEN production');
}

// ── Deploy ────────────────────────────────────────────────────────────────────

console.log('\n▲ Deploying to Vercel production…');
const deployResult = spawnSync(vercelCmd, ['--prod', '--yes'], {
  cwd: vercelDir,
  stdio: 'inherit',
  shell: false,
  env: { ...process.env },
});

if (deployResult.status !== 0) {
  console.error('\n❌ Vercel deployment failed');
  process.exit(1);
}

console.log(`\n✅ Deployment complete!`);
console.log(`   Next: tsx scripts/edge/05-verify-vercel.ts ${clientName} <production-url>`);
