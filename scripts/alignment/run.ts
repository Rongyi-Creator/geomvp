#!/usr/bin/env tsx
/**
 * CLI entry point for alignment check.
 * Usage: pnpm tsx scripts/alignment/run.ts [clientId] [--force] [--no-email] [--run-type=day1|day4|biweekly|manual]
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { runAlignmentCheck } from './check-all.js';
import { compareNap } from './compare-nap.js';
import { calcScore } from './scoring.js';
import { generateReport } from './generate-report.js';
import { updateGeoLayer } from './update-geo-layer.js';
import { sendNotificationEmail } from './send-email.js';
import { fetchOverrides, applyOverrides } from './overrides.js';
import { buildTodoText } from './verify-todo.js';
import type { ClientProfile, AlignmentReport, ScoreHistory } from './types.js';

const clientId = process.argv[2] ?? 'virum';
const force     = process.argv.includes('--force');
const noEmail   = process.argv.includes('--no-email');
const runTypeArg = process.argv.find(a => a.startsWith('--run-type='))?.split('=')[1];

const CLIENT_DIR_MAP: Record<string, string> = { virum: 'virum-akupunktur' };

function loadClientProfile(id: string): ClientProfile {
  const dir  = CLIENT_DIR_MAP[id] ?? id;
  const path = resolve(process.cwd(), `clients/${dir}/client-profile.json`);
  return JSON.parse(readFileSync(path, 'utf8')) as ClientProfile;
}

async function postToDashboard(report: AlignmentReport): Promise<void> {
  const workerUrl  = process.env.DASHBOARD_WORKER_URL;
  const opsToken   = process.env.DASHBOARD_TOKEN;
  if (!workerUrl || !opsToken) { console.warn('[alignment] DASHBOARD_WORKER_URL or DASHBOARD_TOKEN not set — skipping KV push'); return; }

  const resp = await fetch(`${workerUrl}/api/alignment/${report.clientId}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${opsToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(report),
  });
  if (!resp.ok) throw new Error(`Dashboard POST failed: ${resp.status} ${await resp.text()}`);
  console.log(`[alignment] Report pushed to Dashboard (score=${report.score.total}, grade=${report.score.grade.grade})`);
}

function determineRunType(history: ScoreHistory | null): AlignmentReport['runType'] {
  if (runTypeArg) return runTypeArg as AlignmentReport['runType'];
  if (!history || history.history.length === 0) return 'day1';
  const lastDate   = new Date(history.history.at(-1)!.date);
  const daysSince  = (Date.now() - lastDate.getTime()) / 86400000;
  if (daysSince < 3) return 'day4';
  return 'biweekly';
}

async function postSlack(webhook: string, text: string): Promise<void> {
  await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  }).catch(() => {}); // ponytail: fire-and-forget — a Slack hiccup shouldn't fail the run
}

async function fetchHistory(workerUrl: string, opsToken: string, id: string): Promise<ScoreHistory | null> {
  try {
    const resp = await fetch(`${workerUrl}/api/alignment/${id}`, { headers: { Authorization: `Bearer ${opsToken}` } });
    if (!resp.ok) return null;
    const data = await resp.json() as { history?: ScoreHistory };
    return data.history ?? null;
  } catch { return null; }
}

async function main() {
  console.log(`[alignment] Starting check for client: ${clientId}`);
  const client = loadClientProfile(clientId);

  const workerUrl = process.env.DASHBOARD_WORKER_URL ?? '';
  const opsToken  = process.env.DASHBOARD_TOKEN ?? '';
  const history   = workerUrl && opsToken ? await fetchHistory(workerUrl, opsToken, clientId) : null;
  const overrides = workerUrl && opsToken ? await fetchOverrides(workerUrl, opsToken, clientId) : {};

  if (!force && history) {
    const lastDate  = new Date(history.history.at(-1)?.date ?? 0);
    const daysSince = (Date.now() - lastDate.getTime()) / 86400000;
    if (daysSince < 1) {
      console.log(`[alignment] Skipping — last check was ${daysSince.toFixed(1)} days ago (use --force to override)`);
      process.exit(0);
    }
  }

  const runType    = determineRunType(history);
  console.log(`[alignment] Run type: ${runType}`);

  // Step 1: detect platforms
  const checkResult = await runAlignmentCheck(client);

  // Fold in human-verification verdicts (slice 2): a confirmed listing flips exists=true
  // so coverage scoring credits it; a confirmed absence flips it to false.
  applyOverrides(checkResult, overrides);
  if (Object.keys(overrides).length) console.log(`[alignment] Applied ${Object.keys(overrides).length} manual override(s)`);

  // Guard: if infra errors (Outscraper timeout/API failure) hit most platforms, the
  // score is meaningless. Don't clobber the client's dashboard or email them a fake
  // low score — fail the run so CI/Slack alert ops instead. A legit "not found"
  // (exists:false, no error) is real data and does NOT count here.
  //
  // Google is deliberately EXCLUDED: Outscraper's Maps service chronically parks
  // /maps/search in Pending (external outage), so a Google timeout is expected, not a
  // sign our run is broken. It degrades gracefully on its own — scoring treats the
  // error as "unknown" (no false penalty) and the NAP ring renders grey
  // ("Afventer Google-profil", status unable_to_check). Aborting on it would freeze
  // the dashboard for every client whenever Maps is down. We still abort when the
  // OTHER platforms — which use the *healthy* google-search endpoint — fail en masse,
  // since that points at our side (network/CI/key), not one flaky vendor service.
  const ext = ['trustpilot', 'krak', 'guleSider', 'facebook'] as const;
  const platforms = checkResult.platforms as Record<string, { error?: string }>;
  const infraErrors = ext.filter(k => platforms[k]?.error);
  if (infraErrors.length >= 3) {
    console.error(`[alignment] Degraded run — ${infraErrors.length}/4 non-Google platforms failed. Skipping dashboard push to avoid publishing a misleading score.`);
    process.exit(1);
  }

  // Step 2: NAP comparison via Claude
  const comparisons = await compareNap(client, checkResult);
  console.log(`[alignment] NAP comparisons: ${comparisons.length} fields checked`);

  // Step 3: score
  const score = calcScore(checkResult, comparisons);
  console.log(`[alignment] Score: ${score.total}/100 (${score.grade.grade})`);

  // Step 4: generate report
  const report = generateReport(checkResult, comparisons, score, runType, overrides);

  // Step 4b: one consolidated Slack message. Imperative (manual) vs scheduled split —
  // a MANUAL run is a deliberate audit, so always notify with score + the verify links for
  // all directory platforms (re-confirm even verified ones). A scheduled/day1 run only
  // speaks when something genuinely needs verification; otherwise it stays SILENT
  // ("no news is good news"). Failures are alerted separately by the workflow (failure()).
  const OVERRIDABLE = ['trustpilot', 'krak', 'guleSider', 'facebook'];
  const needsVerif = report.platforms.filter(p => p.status === 'needs_verification').map(p => p.id);
  const todoPlatforms = runType === 'manual'
    ? OVERRIDABLE.filter(id => report.platforms.some(p => p.id === id))
    : needsVerif;
  if (process.env.SLACK_WEBHOOK_URL && workerUrl && (runType === 'manual' || todoPlatforms.length)) {
    let text = `:white_check_mark: Alignment for *${client.name}*: *${score.grade.grade}* (${score.total}/100) — <${workerUrl}/?view=ops|Dashboard>`;
    if (todoPlatforms.length) text += '\n\n' + buildTodoText(workerUrl, client, todoPlatforms);
    await postSlack(process.env.SLACK_WEBHOOK_URL, text);
    console.log(`[alignment] Slack sent (todo: ${todoPlatforms.join(', ') || 'none'})`);
  }

  // Step 5: update sameAs in business.json
  updateGeoLayer(clientId, report);

  // Step 6: push to Dashboard KV
  await postToDashboard(report);

  // Step 7: send notification email (skipped with --no-email). NON-FATAL: the dashboard is
  // already updated (step 6), so a Resend hiccup must not fail the whole run and fire a
  // misleading "alignment failed" alert. Log it so we still know the client wasn't emailed.
  if (!noEmail && client.email) {
    // ponytail: email delay handled externally via GitHub Actions wait step
    try {
      await sendNotificationEmail(report, client.email);
    } catch (e) {
      console.warn(`[alignment] ⚠️ Email to ${client.email} failed — run still OK, dashboard updated: ${String(e)}`);
    }
  } else if (noEmail) {
    console.log('[alignment] Email skipped (--no-email flag)');
  }

  // Output score for GitHub Actions step summary
  if (process.env.GITHUB_OUTPUT) {
    const { appendFileSync } = await import('fs');
    appendFileSync(process.env.GITHUB_OUTPUT, `score=${score.total}\ngrade=${score.grade.grade}\n`);
  }
  console.log(`[alignment] Done ✅`);
}

main().catch(e => { console.error('[alignment] Fatal error:', e); process.exit(1); });
