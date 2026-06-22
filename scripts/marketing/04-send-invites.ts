// Reads leads-scored.json, generates one-time tokens, stores in KV, sends invite emails via Resend.
// Usage: tsx scripts/marketing/04-send-invites.ts [--dry-run] [--grade A] [--limit 30]

import { readFileSync, appendFileSync } from 'fs';
import { resolve } from 'path';
import { randomUUID } from 'node:crypto';
import { ROOT, requireEnv } from '../config.ts';
import type { ScoredLead } from './02-check-compatibility.ts';

const RESEND_API_KEY    = requireEnv('RESEND_API_KEY');
const KV_ACCOUNT_ID    = requireEnv('CF_ACCOUNT_ID');
const KV_NAMESPACE_ID  = requireEnv('CF_KV_NAMESPACE_ID');   // DASHBOARD_KV id
const CF_API_TOKEN     = requireEnv('CF_API_TOKEN');
const SITE_URL         = process.env.SITE_URL ?? 'https://foundbyai.dk';
const FROM             = 'Blake <blake@foundbyai.dk>';
const REPLY_TO         = 'hej@foundbyai.dk';
const TOKEN_TTL_SECS   = 7 * 24 * 3600;

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const gradeFilter = (() => { const i = args.indexOf('--grade'); return i >= 0 ? args[i + 1] : 'A'; })();
const limitArg    = (() => { const i = args.indexOf('--limit'); return i >= 0 ? parseInt(args[i + 1] ?? '30') : 30; })();

// ── Template loading ──────────────────────────────────────────────────────────

const TEMPLATES: Record<string, string> = {
  akupunktur:    readFileSync(resolve(ROOT, 'scripts/marketing/templates/invite-akupunktur.html'), 'utf-8'),
  kiropraktor:   readFileSync(resolve(ROOT, 'scripts/marketing/templates/invite-kiropraktor.html'), 'utf-8'),
  psykolog:      readFileSync(resolve(ROOT, 'scripts/marketing/templates/invite-psykolog.html'), 'utf-8'),
  psykoterapeut: readFileSync(resolve(ROOT, 'scripts/marketing/templates/invite-psykolog.html'), 'utf-8'),
};

function pickTemplate(lead: ScoredLead): string {
  const q = lead.query.toLowerCase();
  if (q.includes('kiropraktor')) return TEMPLATES['kiropraktor']!;
  if (q.includes('psykolog') || q.includes('psykoterapeut')) return TEMPLATES['psykolog']!;
  return TEMPLATES['akupunktur']!; // default
}

function pickIndustry(lead: ScoredLead): string {
  const q = lead.query.toLowerCase();
  if (q.includes('kiropraktor'))   return 'kiropraktor';
  if (q.includes('psykoterapeut')) return 'psykoterapeut';
  if (q.includes('psykolog'))      return 'psykolog';
  return 'akupunktur';
}

function pickSubject(lead: ScoredLead): string {
  const name = lead.name || lead.domain;
  const q = lead.query.toLowerCase();
  if (q.includes('kiropraktor'))
    return `${name} mangler i ChatGPTs anbefalinger for rygbehandling i København`;
  if (q.includes('psykolog') || q.includes('psykoterapeut'))
    return `${name} vises ikke, når patienter spørger ChatGPT om psykolog i København`;
  return `${name} mangler i ChatGPTs anbefalinger for akupunktur i København`;
}

function findCompetitor(leads: ScoredLead[], current: ScoredLead): string {
  // Pick highest-rated A-grade lead in same query category (not the same business)
  const same = leads.filter(l =>
    l.domain !== current.domain &&
    l.query === current.query &&
    l.finalGrade === 'A' &&
    l.rating >= 4.5 &&
    l.name
  );
  return same[0]?.name ?? 'en konkurrent';
}

// ── KV token storage ──────────────────────────────────────────────────────────

async function storeToken(key: string, value: string): Promise<void> {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${KV_ACCOUNT_ID}/storage/kv/namespaces/${KV_NAMESPACE_ID}/values/${encodeURIComponent(key)}?expiration_ttl=${TOKEN_TTL_SECS}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${CF_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: value,
    }
  );
  if (!res.ok) throw new Error(`KV write failed: ${await res.text()}`);
}

// ── Resend send ───────────────────────────────────────────────────────────────

async function sendEmail(to: string, subject: string, htmlBody: string): Promise<string> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM,
      reply_to: REPLY_TO,
      to: [to],
      subject,
      html: htmlBody,
    }),
  });

  const data = await res.json() as { id?: string; name?: string; message?: string };
  if (!res.ok) throw new Error(`Resend error: ${data.name ?? ''} — ${data.message ?? ''}`);
  return data.id ?? '';
}

// ── Log record ────────────────────────────────────────────────────────────────

interface SendRecord {
  sentAt: string;
  domain: string;
  email: string;
  token: string;
  resendId: string;
}

const LOG_PATH = resolve(ROOT, 'clients/leads/sends.ndjson');

function logSend(record: SendRecord) {
  appendFileSync(LOG_PATH, JSON.stringify(record) + '\n');
}

// ── Main ──────────────────────────────────────────────────────────────────────

const leads: ScoredLead[] = JSON.parse(
  readFileSync(resolve(ROOT, 'clients/leads/leads-scored.json'), 'utf-8')
);

const candidates = leads
  .filter(l => l.finalGrade === gradeFilter)
  .slice(0, limitArg);

console.log(`\nSend-invites${DRY_RUN ? ' [DRY RUN]' : ''}`);
console.log(`Grade filter: ${gradeFilter} | Candidates: ${candidates.length} | Limit: ${limitArg}\n`);

let sent = 0, failed = 0;

for (const lead of candidates) {
  const token = randomUUID();
  const tokenUrl = `${SITE_URL}/activate/${token}`;
  const competitor = findCompetitor(leads, lead);

  const tokenData = {
    domain:    lead.domain,
    email:     lead.email,
    industry:  pickIndustry(lead),
    status:    'pending',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + TOKEN_TTL_SECS * 1000).toISOString(),
  };

  const bodyHtml = pickTemplate(lead)
    .replace(/\{\{NAME\}\}/g, lead.name)
    .replace(/\{\{DOMAIN\}\}/g, lead.domain)
    .replace(/\{\{COMPETITOR\}\}/g, competitor)
    .replace(/\{\{TOKEN_URL\}\}/g, tokenUrl);

  const subject = pickSubject(lead);

  console.log(`→ ${lead.name} <${lead.email}> [${lead.domain}]`);
  console.log(`  token: ${token}`);
  console.log(`  competitor: ${competitor}`);

  if (DRY_RUN) {
    console.log(`  [skip — dry run]\n`);
    continue;
  }

  try {
    // Store token first — if email fails we can retry without a dangling token
    await storeToken(`token:${token}`, JSON.stringify(tokenData));
    const resendId = await sendEmail(lead.email, subject, bodyHtml);
    logSend({ sentAt: new Date().toISOString(), domain: lead.domain, email: lead.email, token, resendId });
    console.log(`  ✓ sent (resend: ${resendId})\n`);
    sent++;
    // Resend free tier: 100/day, no rate limit docs but 2 req/s is safe
    await new Promise(r => setTimeout(r, 500));
  } catch (err) {
    console.error(`  ✗ failed: ${(err as Error).message}\n`);
    failed++;
  }
}

console.log(`\nDone: ${sent} sent, ${failed} failed`);
if (DRY_RUN) console.log('(dry run — nothing was sent)');
