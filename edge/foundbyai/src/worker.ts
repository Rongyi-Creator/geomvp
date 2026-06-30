// foundbyai-worker — activation onboarding for foundbyai.dk
// Routes: GET /activate/:token  POST /api/extract  PUT /api/confirm
//         POST /api/checkout    GET /success        POST /api/webhook
//         GET /api/dns-status
// Cron: */5 * * * *  → checkPendingDns

import {
  deriveSlug, addProduct, getProduct, saveProduct,
  getAccount, putWaitlist, dashboardUrl, type Product,
} from './lib/account.ts';
import {
  mintLoginToken, consumeLoginToken, createSession, destroySession,
  getIdentity, sessionCookie, clearCookie, randomHex,
} from './lib/auth.ts';

interface Env {
  DASHBOARD_KV: KVNamespace;
  ANTHROPIC_API_KEY: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  STRIPE_PRICE_ID: string;
  RESEND_API_KEY: string;
  SITE_URL: string;    // https://foundbyai.dk
  GEO_PROXY_IP: string; // 76.76.21.21
  DASHBOARD_URL: string; // customer dashboard origin
  DASHBOARD_TOKEN: string; // master ops token for dashboard worker (?view=ops)
  OPS_EMAILS: string;
}

interface TokenData {
  domain: string;
  email: string;
  industry: string;
  status: 'pending' | 'content_confirmed' | 'paid' | 'dns_pending' | 'active';
  createdAt: string;
  expiresAt: string;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  activatedAt?: string;
}

interface DraftContent {
  businessName: string;
  address: string;
  phone: string;
  openingHours: string;
  services: string[];
  extractedAt: string;
}

const TOKEN_TTL = 7 * 24 * 3600; // 7 days in seconds

// ── Helpers ─────────────────────────────────────────────────────────────────

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function html(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html;charset=utf-8' },
  });
}

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function getToken(token: string, env: Env): Promise<TokenData | null> {
  const raw = await env.DASHBOARD_KV.get(`token:${token}`);
  if (!raw) return null;
  const data = JSON.parse(raw) as TokenData;
  if (new Date(data.expiresAt) < new Date()) return null;
  return data;
}

async function saveToken(token: string, data: TokenData, env: Env) {
  // Use remaining time from expiresAt so KV TTL never extends beyond the app-level expiry.
  const remainingSecs = Math.max(60, Math.floor((new Date(data.expiresAt).getTime() - Date.now()) / 1000));
  await env.DASHBOARD_KV.put(`token:${token}`, JSON.stringify(data), {
    expirationTtl: remainingSecs,
  });
}

async function resolveARecord(domain: string): Promise<string[]> {
  try {
    const res = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${domain}&type=A`,
      { headers: { Accept: 'application/dns-json' } }
    );
    const data = await res.json() as { Answer?: Array<{ data: string }> };
    return data.Answer?.map(a => a.data) ?? [];
  } catch {
    return [];
  }
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

// ponytail: XOR accumulator — constant-time compare regardless of first differing byte
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

async function verifyStripeSignature(
  payload: string,
  sigHeader: string,
  secret: string
): Promise<boolean> {
  try {
    // Parse all k=v pairs; collect ALL v1= values (Stripe sends multiple during key rotation)
    const parts = sigHeader.split(',');
    let t: string | undefined;
    const v1Values: string[] = [];
    for (const part of parts) {
      const eq = part.indexOf('=');
      if (eq < 0) continue;
      const k = part.slice(0, eq).trim();
      const v = part.slice(eq + 1).trim();
      if (k === 't') t = v;
      if (k === 'v1') v1Values.push(v);
    }
    if (!t || v1Values.length === 0) return false;

    const ts = parseInt(t, 10);
    if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false;

    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const sigBuf = await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(`${t}.${payload}`)
    );
    const computed = new Uint8Array(sigBuf);

    // Accept if ANY v1 matches (supports key rotation window)
    return v1Values.some(v1 => timingSafeEqual(computed, hexToBytes(v1)));
  } catch {
    return false;
  }
}

// ── Content Extraction ──────────────────────────────────────────────────────

async function extractContent(domain: string, env: Env): Promise<DraftContent> {
  // Fetch website text
  const siteRes = await fetch(`https://${domain}`, {
    signal: AbortSignal.timeout(10000),
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FoundByAI-Extractor/1.0)' },
  });
  const rawHtml = await siteRes.text();

  // Strip tags, collapse whitespace — stay under Claude's context limit
  const text = rawHtml
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 8000);

  const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [{
        role: 'user',
        content: `Extract business info from this website text. Return ONLY valid JSON, no markdown:\n{"businessName":"","address":"","phone":"","openingHours":"","services":[]}\n\nWebsite text:\n${text}`,
      }],
    }),
  });

  const claudeData = await claudeRes.json() as {
    content: Array<{ type: string; text: string }>;
  };
  const raw = claudeData.content[0]?.text ?? '{}';
  const parsed = JSON.parse(raw.replace(/```json?|```/g, '').trim()) as Partial<DraftContent>;

  return {
    businessName: parsed.businessName ?? '',
    address: parsed.address ?? '',
    phone: parsed.phone ?? '',
    openingHours: parsed.openingHours ?? '',
    services: Array.isArray(parsed.services) ? parsed.services : [],
    extractedAt: new Date().toISOString(),
  };
}

// ── Route Handlers ──────────────────────────────────────────────────────────

async function requireOwnedProduct(req: Request, env: Env, slug: string): Promise<{ id: { email: string; isOps: boolean }; product: Product } | Response> {
  if (!/^[a-z0-9-]+$/.test(slug)) return json({ error: 'bad_slug' }, 400);
  const id = await getIdentity(req, env);
  if (!id) return json({ error: 'unauthorized' }, 401);
  const product = await getProduct(slug, env.DASHBOARD_KV);
  if (!product) return json({ error: 'not_found' }, 404);
  const acc = await getAccount(id.email, env.DASHBOARD_KV);
  const owns = id.isOps || (acc?.productSlugs.includes(slug) ?? false);
  if (!owns) return json({ error: 'not_found' }, 404);
  return { id, product };
}

async function handleActivatePage(token: string, env: Env): Promise<Response> {
  // Legacy cold-email link: map token→slug, create a session, send to setup.
  const data = await getToken(token, env);
  if (!data) return html(renderErrorPage('Linket er udløbet eller ugyldigt. Kontakt os for et nyt link.'), 404);
  const slug = deriveSlug(data.domain);
  await addProduct(data.email, slug, env.DASHBOARD_KV);
  if (!(await getProduct(slug, env.DASHBOARD_KV))) {
    await saveProduct({ slug, domain: data.domain, email: data.email, status: 'draft', createdAt: new Date().toISOString() }, env.DASHBOARD_KV);
  }
  const sid = await createSession(data.email, env.DASHBOARD_KV);
  return new Response(null, { status: 302, headers: { Location: `/app/p/${slug}/setup`, 'Set-Cookie': sessionCookie(sid) } });
}

async function handleExtract(req: Request, env: Env): Promise<Response> {
  const { slug } = (await req.json()) as { slug: string };
  const guard = await requireOwnedProduct(req, env, slug);
  if (guard instanceof Response) return guard;
  const cached = await env.DASHBOARD_KV.get(`draft:${slug}`);
  if (cached) return new Response(cached, { headers: { 'Content-Type': 'application/json' } });
  try {
    const draft = await extractContent(guard.product.domain, env);
    await env.DASHBOARD_KV.put(`draft:${slug}`, JSON.stringify(draft));
    return json(draft);
  } catch {
    return json({ error: 'extraction_failed' }, 500);
  }
}

async function handleConfirm(req: Request, env: Env): Promise<Response> {
  const body = (await req.json()) as { slug: string } & Partial<DraftContent>;
  const { slug, ...fields } = body;
  const guard = await requireOwnedProduct(req, env, slug);
  if (guard instanceof Response) return guard;
  const draft: DraftContent = {
    businessName: fields.businessName ?? '',
    address: fields.address ?? '',
    phone: fields.phone ?? '',
    openingHours: fields.openingHours ?? '',
    services: Array.isArray(fields.services) ? fields.services : [],
    extractedAt: new Date().toISOString(),
  };
  await env.DASHBOARD_KV.put(`draft:${slug}`, JSON.stringify(draft));
  guard.product.status = 'content_confirmed';
  await saveProduct(guard.product, env.DASHBOARD_KV);
  return json({ ok: true });
}

async function handleCheckout(req: Request, env: Env): Promise<Response> {
  const { slug } = (await req.json()) as { slug: string };
  const guard = await requireOwnedProduct(req, env, slug);
  if (guard instanceof Response) return guard;
  const product = guard.product;
  if (product.status !== 'content_confirmed') return json({ error: 'confirm_first' }, 400);

  const successUrl = `${env.SITE_URL}/success?session_id={CHECKOUT_SESSION_ID}&slug=${slug}`;
  const cancelUrl = `${env.SITE_URL}/app/p/${slug}/setup`;
  const params = new URLSearchParams({
    mode: 'subscription',
    'payment_method_types[]': 'card',
    'line_items[0][price]': env.STRIPE_PRICE_ID,
    'line_items[0][quantity]': '1',
    'subscription_data[trial_period_days]': '30',
    'customer_email': product.email,
    'success_url': successUrl,
    'cancel_url': cancelUrl,
    'metadata[slug]': slug,
  });
  const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const session = (await stripeRes.json()) as { url?: string; error?: { message: string } };
  if (!session.url) return json({ error: session.error?.message ?? 'stripe_error' }, 500);
  return json({ url: session.url });
}

async function handleSuccess(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const sessionId = url.searchParams.get('session_id');
  const slug = url.searchParams.get('slug') ?? '';
  if (!sessionId || !/^[a-z0-9-]+$/.test(slug)) return html(renderErrorPage('Ugyldigt link.'), 400);
  const product = await getProduct(slug, env.DASHBOARD_KV);
  if (!product) return html(renderErrorPage('Produkt ikke fundet.'), 400);
  if (product.status === 'active') return Response.redirect(`${env.SITE_URL}/app/p/${slug}`, 302);

  const stripeRes = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, {
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
  });
  const session = (await stripeRes.json()) as { status?: string; customer?: string; subscription?: string; metadata?: { slug?: string } };
  if (session.status !== 'complete') return Response.redirect(`${env.SITE_URL}/app/p/${slug}/setup`, 302);
  if (session.metadata?.slug !== slug) return html(renderErrorPage('Sessionen passer ikke til dette produkt.'), 400);

  product.status = 'trial_pending_dns';
  if (session.customer) product.stripeCustomerId = session.customer;
  if (session.subscription) product.stripeSubscriptionId = session.subscription;
  await saveProduct(product, env.DASHBOARD_KV);
  await env.DASHBOARD_KV.put(`dns_pending:${slug}`, product.domain, { expirationTtl: 7 * 24 * 3600 });
  return Response.redirect(`${env.SITE_URL}/app/p/${slug}/setup`, 302);
}

async function handleWebhook(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const sig = req.headers.get('stripe-signature') ?? '';
  const payload = await req.text();

  if (!(await verifyStripeSignature(payload, sig, env.STRIPE_WEBHOOK_SECRET))) {
    return new Response('Bad signature', { status: 400 });
  }

  const event = JSON.parse(payload) as {
    type: string;
    data: { object: Record<string, unknown> };
  };

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const token = (session['metadata'] as Record<string, string> | undefined)?.['token'];
    if (token) {
      ctx.waitUntil((async () => {
        const data = await getToken(token, env);
        if (data && data.status !== 'dns_pending' && data.status !== 'active') {
          data.status = 'dns_pending';
          if (session['customer']) data.stripeCustomerId = String(session['customer']);
          if (session['subscription']) data.stripeSubscriptionId = String(session['subscription']);
          await saveToken(token, data, env);
          await env.DASHBOARD_KV.put(`dns_pending:${token}`, data.domain, { expirationTtl: TOKEN_TTL });
        }
      })());
    }
  }

  return new Response('ok');
}

async function handleDnsStatus(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const slug = new URL(req.url).searchParams.get('slug') ?? '';
  const guard = await requireOwnedProduct(req, env, slug);
  if (guard instanceof Response) return guard;
  if (guard.product.status === 'active') return json({ active: true });
  const ips = await resolveARecord(guard.product.domain);
  if (ips.includes(env.GEO_PROXY_IP)) {
    ctx.waitUntil(activateClient(slug, env));
    return json({ active: true });
  }
  return json({ active: false, resolvedIps: ips });
}

// ── Activation Logic ─────────────────────────────────────────────────────────

async function activateClient(slug: string, env: Env) {
  const product = await getProduct(slug, env.DASHBOARD_KV);
  if (!product) return;
  if (product.status === 'active') return; // already activated — avoid duplicate config writes + emails
  product.status = 'active';
  product.activatedAt = new Date().toISOString();
  await saveProduct(product, env.DASHBOARD_KV);

  const draftRaw = await env.DASHBOARD_KV.get(`draft:${slug}`);
  const draft = draftRaw ? (JSON.parse(draftRaw) as DraftContent) : null;

  // Dashboard config keyed by slug (dashboard worker reads config:<slug>).
  await env.DASHBOARD_KV.put(`config:${slug}`, JSON.stringify({
    domain: product.domain,
    activeSince: product.activatedAt,
    ...(draft ?? {}),
  }));
  // Mint the per-product dashboard token used by the dashboard worker's client auth.
  let clientToken = await env.DASHBOARD_KV.get(`client_token:${slug}`);
  if (!clientToken) {
    clientToken = randomHex(32);
    await env.DASHBOARD_KV.put(`client_token:${slug}`, clientToken);
  }
  await env.DASHBOARD_KV.delete(`dns_pending:${slug}`);

  const dashLink = `${env.DASHBOARD_URL}/?view=client&client=${slug}&token=${clientToken}`;
  await sendActivationEmail(product.email, product.domain, draft?.businessName ?? product.domain, env, dashLink);
}

async function sendActivationEmail(to: string, domain: string, name: string, env: Env, dashLink: string) {
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Found by AI <hej@foundbyai.dk>',
      to: [to],
      subject: `✅ ${name} er nu synlig for AI — Found by AI`,
      html:
        `<div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;padding:32px 16px">` +
        `<h1 style="color:#15803d;font-size:22px">🎉 Dit GEO Layer er nu aktivt!</h1>` +
        `<p style="color:#374151;line-height:1.6">` +
        `<strong>${esc(name)}</strong> (${esc(domain)}) er nu synlig for ChatGPT, Perplexity og Claude.<br><br>` +
        `AI-søgemaskiner kan nu læse din virksomhedsinfo og anbefale dig til kunder.` +
        `</p>` +
        `<p style="color:#374151;line-height:1.6">` +
        `Du vil modtage en månedlig rapport med data om, hvornår AI-bots besøger din side og citerer din virksomhed.` +
        `</p>` +
        `<p style="margin:24px 0"><a href="${dashLink}" style="background:#587B66;color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:600">Åbn dit dashboard →</a></p>` +
        `<p style="color:#6b7280;font-size:14px;margin-top:32px">` +
        `Found by AI · <a href="https://foundbyai.dk" style="color:#2563eb">foundbyai.dk</a>` +
        `</p>` +
        `</div>`,
    }),
  });
}

// ── Scheduled: batch DNS check ───────────────────────────────────────────────

async function checkPendingDns(env: Env) {
  const list = await env.DASHBOARD_KV.list({ prefix: 'dns_pending:' });
  await Promise.all(
    list.keys.map(async ({ name }) => {
      const slug = name.slice('dns_pending:'.length);
      const domain = await env.DASHBOARD_KV.get(name);
      if (!domain) return;
      const ips = await resolveARecord(domain);
      if (ips.includes(env.GEO_PROXY_IP)) await activateClient(slug, env);
    }),
  );
}

// ── HTML Templates ───────────────────────────────────────────────────────────

function renderErrorPage(message: string): string {
  return `<!DOCTYPE html><html lang="da"><head><meta charset="UTF-8"><meta name="robots" content="noindex">
<title>Found by AI</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f1f5f9}
.box{background:white;border-radius:12px;padding:40px;max-width:440px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.1)}
h2{color:#dc2626;margin-bottom:12px}p{color:#64748b;line-height:1.6}
a{color:#2563eb}</style></head>
<body><div class="box"><h2>Link ikke gyldigt</h2><p>${esc(message)}</p>
<p style="margin-top:24px"><a href="mailto:hej@foundbyai.dk">Kontakt os</a></p></div></body></html>`;
}

function renderSetupPage(slug: string, domain: string, initialJson: string): string {
  return `<!DOCTYPE html>
<html lang="da">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta name="robots" content="noindex">
<title>Aktiver din AI-synlighed — Found by AI</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,-apple-system,sans-serif;background:#f1f5f9;color:#1e293b;min-height:100vh}
.header{background:#1e293b;color:white;padding:16px 24px;font-weight:700;font-size:18px}
.header span{color:#60a5fa}
.container{max-width:640px;margin:0 auto;padding:28px 16px 48px}
.score-card{background:white;border-radius:12px;padding:22px 24px;margin-bottom:20px;border:1px solid #e2e8f0}
.score-card h2{font-size:12px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.08em;margin-bottom:14px}
.score-row{display:flex;align-items:center;gap:12px;margin-bottom:8px}
.score-label{font-size:13px;color:#475569;width:220px;flex-shrink:0}
.score-bar{flex:1;height:7px;background:#f1f5f9;border-radius:4px;overflow:hidden}
.score-fill{height:100%;border-radius:4px}
.score-fill.low{background:#ef4444;width:20%}
.score-fill.high{background:#22c55e;width:70%}
.score-value{font-size:12px;color:#94a3b8;width:32px;text-align:right}
.step{background:white;border-radius:12px;padding:24px;margin-bottom:16px;border:1px solid #e2e8f0;transition:opacity .15s}
.step.locked{opacity:.42;pointer-events:none}
.step-header{display:flex;align-items:center;gap:12px;margin-bottom:20px}
.step-num{width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;flex-shrink:0}
.step-num.active{background:#2563eb;color:white}
.step-num.done{background:#22c55e;color:white}
.step-num.waiting{background:#e2e8f0;color:#94a3b8}
.step-title{font-size:15px;font-weight:600}
.field-group{margin-bottom:14px}
.field-group label{display:block;font-size:12px;font-weight:500;color:#374151;margin-bottom:5px}
.field-group input,.field-group textarea{width:100%;padding:9px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;color:#1e293b;font-family:inherit;background:white}
.field-group input:focus,.field-group textarea:focus{outline:none;border-color:#2563eb;box-shadow:0 0 0 3px rgba(37,99,235,.1)}
.field-locked{display:flex;align-items:center;gap:8px;padding:9px 12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;color:#64748b}
.cb-row{display:flex;align-items:flex-start;gap:10px;margin:18px 0}
.cb-row input[type=checkbox]{margin-top:2px;flex-shrink:0;width:16px;height:16px;cursor:pointer;accent-color:#2563eb}
.cb-row label{font-size:13px;color:#374151;cursor:pointer;line-height:1.5}
.btn{display:block;width:100%;padding:13px;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;text-align:center;transition:background .15s}
.btn-primary{background:#2563eb;color:white}
.btn-primary:hover:not(:disabled){background:#1d4ed8}
.btn-primary:disabled{background:#93c5fd;cursor:not-allowed}
.loading{display:flex;align-items:center;gap:10px;padding:14px 0;color:#64748b;font-size:14px}
.spinner{width:17px;height:17px;border:2px solid #e2e8f0;border-top-color:#2563eb;border-radius:50%;animation:spin .75s linear infinite;flex-shrink:0}
@keyframes spin{to{transform:rotate(360deg)}}
.dns-box{background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:16px;margin:16px 0}
.dns-ip{font-family:monospace;font-size:20px;font-weight:700;color:#0369a1;letter-spacing:1px}
.dns-copy{background:#0369a1;color:white;border:none;padding:7px 13px;border-radius:6px;font-size:12px;cursor:pointer;float:right;font-family:inherit}
.dns-copy:hover{background:#075985}
.dns-status{display:flex;align-items:center;gap:8px;margin-top:14px;font-size:13px;color:#64748b}
.dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.dot.waiting{background:#f59e0b;animation:pulse 1.4s ease-in-out infinite}
.dot.active{background:#22c55e}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}
.success-banner{background:#f0fdf4;border:1px solid #86efac;border-radius:10px;padding:22px;text-align:center;margin-top:16px;display:none}
.success-banner h3{color:#15803d;font-size:17px;margin-bottom:8px}
.success-banner p{color:#166534;font-size:13px;line-height:1.5}
.guide-link{display:inline-flex;align-items:center;gap:5px;color:#2563eb;font-size:13px;text-decoration:none;margin-top:10px}
.guide-link:hover{text-decoration:underline}
.err{background:#fef2f2;border:1px solid #fecaca;border-radius:7px;padding:10px 14px;color:#dc2626;font-size:13px;margin-top:10px;display:none}
.price-note{font-size:12px;color:#94a3b8;text-align:center;margin-top:10px;line-height:1.5}
.terms-note{font-size:11px;color:#cbd5e1;text-align:center;margin-top:8px}
.terms-note a{color:#94a3b8}
.footer{text-align:center;padding:24px 0;color:#94a3b8;font-size:12px}
.footer a{color:#94a3b8}
</style>
</head>
<body>
<div class="header">Found <span>by AI</span></div>
<div class="container">

  <div class="score-card">
    <h2>AI-synlighedsscore for ${esc(domain)}</h2>
    <div class="score-row">
      <div class="score-label">Din hjemmeside nu</div>
      <div class="score-bar"><div class="score-fill low"></div></div>
      <div class="score-value">Lav</div>
    </div>
    <div class="score-row">
      <div class="score-label">Dine konkurrenter i gennemsnit</div>
      <div class="score-bar"><div class="score-fill high"></div></div>
      <div class="score-value">Høj</div>
    </div>
  </div>

  <!-- Step 1 -->
  <div class="step" id="step1">
    <div class="step-header">
      <div class="step-num active" id="num1">1</div>
      <div class="step-title">Bekræft dine oplysninger</div>
    </div>

    <div id="s1-loading" class="loading" style="display:none">
      <div class="spinner"></div>
      Analyserer din hjemmeside...
    </div>

    <div id="s1-fields" style="display:none">
      <div class="field-group">
        <label>Virksomhedsnavn</label>
        <input type="text" id="f-name">
      </div>
      <div class="field-group">
        <label>Adresse</label>
        <input type="text" id="f-address">
      </div>
      <div class="field-group">
        <label>Telefon</label>
        <input type="text" id="f-phone">
      </div>
      <div class="field-group">
        <label>Åbningstider</label>
        <input type="text" id="f-hours">
      </div>
      <div class="field-group">
        <label>Ydelser (kommasepareret)</label>
        <textarea id="f-services" rows="2"></textarea>
      </div>
      <div class="field-group">
        <label>Domæne</label>
        <div class="field-locked">🔒 ${esc(domain)}</div>
      </div>
      <div class="cb-row">
        <input type="checkbox" id="cb-confirm">
        <label for="cb-confirm">Ovenstående oplysninger er korrekte og må bruges til AI-søgeoptimering.</label>
      </div>
      <div class="err" id="confirm-err">Der opstod en fejl. Prøv igen.</div>
      <button class="btn btn-primary" id="btn-confirm">BEKRÆFT ✓</button>
    </div>

    <div class="err" id="s1-err">Kunne ikke analysere din hjemmeside. Genindlæs siden og prøv igen.</div>
  </div>

  <!-- Step 2 -->
  <div class="step locked" id="step2">
    <div class="step-header">
      <div class="step-num waiting" id="num2">2</div>
      <div class="step-title">Start gratis prøveperiode</div>
    </div>
    <p style="font-size:14px;color:#475569;margin-bottom:18px;line-height:1.6">
      De første 30 dage er helt gratis. Herefter 199 kr/md. Opsig når som helst — du får besked 7 dage før første betaling.
    </p>
    <div class="err" id="trial-err">Der opstod en fejl. Prøv igen.</div>
    <button class="btn btn-primary" id="btn-trial">START GRATIS PRØVEPERIODE →</button>
    <div class="price-note">Ingen binding · 30 dages gratis prøveperiode · Annuller når som helst</div>
    <div class="terms-note">Ved at aktivere accepterer du vores <a href="/privacy">privatlivspolitik</a> og <a href="/terms">servicevilkår</a>.</div>
  </div>

  <!-- Step 3 -->
  <div class="step locked" id="step3">
    <div class="step-header">
      <div class="step-num waiting" id="num3">3</div>
      <div class="step-title">Forbind din hjemmeside</div>
    </div>
    <p style="font-size:14px;color:#475569;margin-bottom:16px;line-height:1.6">
      Det eneste tekniske trin: sæt denne A-record i dit domænes DNS-indstillinger.
    </p>
    <div class="dns-box">
      <button class="dns-copy" id="dns-copy-btn">KOPIÉR</button>
      <div style="font-size:12px;color:#64748b;margin-bottom:4px">A-record:</div>
      <div class="dns-ip">76.76.21.21</div>
    </div>
    <a class="guide-link" href="https://help.one.com/hc/da/articles/115005588189" target="_blank" rel="noopener">
      📖 Sådan ændrer du DNS hos one.com →
    </a>
    <div id="dns-waiting" class="dns-status">
      <div class="dot waiting"></div>
      Venter på DNS-ændring... (Vi tjekker automatisk hvert 5. minut)
    </div>
    <div id="dns-active" class="dns-status" style="display:none">
      <div class="dot active"></div>
      DNS registreret!
    </div>
    <div class="success-banner" id="success-banner">
      <h3>🎉 Dit GEO Layer er nu aktivt!</h3>
      <p>AI-søgemaskiner som ChatGPT og Perplexity kan nu anbefale ${esc(domain)}.<br>
      Du modtager en bekræftelse på e-mail.</p>
    </div>
  </div>

  <div class="footer">Found by AI · <a href="/privacy">Privatlivspolitik</a> · <a href="/terms">Vilkår</a> · <a href="mailto:hej@foundbyai.dk">Kontakt</a></div>
</div>

<script>
(function () {
  var D = ${initialJson};
  function $i(id) { return document.getElementById(id); }

  function markDone(n) {
    var el = $i('num' + n);
    el.className = 'step-num done';
    el.textContent = '✓';
  }

  function unlock(n) {
    $i('step' + n).classList.remove('locked');
    $i('num' + n).className = 'step-num active';
  }

  function populateFields(draft) {
    $i('f-name').value = draft.businessName || '';
    $i('f-address').value = draft.address || '';
    $i('f-phone').value = draft.phone || '';
    $i('f-hours').value = draft.openingHours || '';
    $i('f-services').value = Array.isArray(draft.services) ? draft.services.join(', ') : '';
    $i('s1-loading').style.display = 'none';
    $i('s1-fields').style.display = 'block';
  }

  function startStep3() {
    markDone(1); markDone(2); unlock(3);
    startDnsPolling();
  }

  function startDnsPolling() {
    var timer;
    function check() {
      fetch('/api/dns-status?slug=' + D.slug)
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (data.active) {
            clearTimeout(timer);
            markDone(3);
            $i('dns-waiting').style.display = 'none';
            $i('dns-active').style.display = 'flex';
            $i('success-banner').style.display = 'block';
            $i('success-banner').scrollIntoView({ behavior: 'smooth' });
          } else {
            timer = setTimeout(check, 30000);
          }
        })
        .catch(function() { timer = setTimeout(check, 60000); });
    }
    check();
  }

  // Restore state
  if (D.status === 'active') {
    markDone(1); markDone(2); markDone(3); unlock(3);
    $i('dns-waiting').style.display = 'none';
    $i('dns-active').style.display = 'flex';
    $i('success-banner').style.display = 'block';
    if (D.draft) populateFields(D.draft);
    $i('s1-loading').style.display = 'none';
    return;
  }

  if (D.status === 'trial_pending_dns') {
    if (D.draft) populateFields(D.draft);
    else { $i('s1-loading').style.display = 'none'; }
    startStep3();
    return;
  }

  if (D.status === 'content_confirmed' && D.draft) {
    populateFields(D.draft);
    markDone(1);
    unlock(2);
    return;
  }

  // Trigger extraction
  $i('s1-loading').style.display = 'flex';
  fetch('/api/extract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug: D.slug })
  })
    .then(function(r) { if (!r.ok) throw new Error(); return r.json(); })
    .then(function(draft) { populateFields(draft); })
    .catch(function() {
      $i('s1-loading').style.display = 'none';
      $i('s1-err').style.display = 'block';
    });

  // Confirm button
  $i('btn-confirm').addEventListener('click', function () {
    var btn = this;
    if (!$i('cb-confirm').checked) {
      alert('Sæt kryds for at bekræfte dine oplysninger.');
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Gemmer...';
    var services = $i('f-services').value.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
    fetch('/api/confirm', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slug: D.slug,
        businessName: $i('f-name').value,
        address: $i('f-address').value,
        phone: $i('f-phone').value,
        openingHours: $i('f-hours').value,
        services: services
      })
    })
      .then(function(r) { if (!r.ok) throw new Error(); return r.json(); })
      .then(function() {
        markDone(1);
        unlock(2);
        $i('step2').scrollIntoView({ behavior: 'smooth', block: 'start' });
      })
      .catch(function() {
        btn.disabled = false;
        btn.textContent = 'BEKRÆFT ✓';
        $i('confirm-err').style.display = 'block';
      });
  });

  // Start trial button
  $i('btn-trial').addEventListener('click', function () {
    var btn = this;
    btn.disabled = true;
    btn.textContent = 'Opretter session...';
    fetch('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: D.slug })
    })
      .then(function(r) { if (!r.ok) throw new Error(); return r.json(); })
      .then(function(data) { window.location.href = data.url; })
      .catch(function() {
        btn.disabled = false;
        btn.textContent = 'START GRATIS PRØVEPERIODE →';
        $i('trial-err').style.display = 'block';
      });
  });

  // Copy IP button
  $i('dns-copy-btn').addEventListener('click', function () {
    var btn = this;
    navigator.clipboard.writeText('76.76.21.21').then(function () {
      btn.textContent = '✓ Kopieret';
      setTimeout(function () { btn.textContent = 'KOPIÉR'; }, 2000);
    });
  });
})();
</script>
</body>
</html>`;
}

// ── Export ───────────────────────────────────────────────────────────────────

// ── Landing page compatibility check ─────────────────────────────────────────
// Mirrors scripts/marketing/02-check-compatibility.ts, adapted for the Worker
// runtime (no cheerio). Returns the same result/platform shape the LP expects.
type CheckResult = 'compatible' | 'incompatible' | 'unreachable' | 'timeout' | 'system_error';

function detectPlatform(html: string, headers: Headers): { platform: string; incompatible: boolean } {
  const h = html.toLowerCase();
  const server = (headers.get('server') || '').toLowerCase();
  // Incompatible SaaS site-builders (can't change DNS to our proxy).
  if (/static\.wixstatic\.com|wix\.com|x-wix/.test(h) || headers.has('x-wix-request-id'))
    return { platform: 'Wix', incompatible: true };
  if (/static1\.squarespace\.com|squarespace\.com/.test(h) || server.includes('squarespace'))
    return { platform: 'Squarespace', incompatible: true };
  if (/assets\.website-files\.com|assets-global\.website-files\.com|webflow\.io/.test(h) || /generator" content="webflow/.test(h))
    return { platform: 'Webflow', incompatible: true };
  if (/cdn\.shopify\.com|myshopify\.com/.test(h) || headers.has('x-shopid'))
    return { platform: 'Shopify', incompatible: true };
  // Compatible platforms.
  if (/wp-content|wp-includes|generator" content="wordpress/.test(h))
    return { platform: 'WordPress', incompatible: false };
  return { platform: 'one.com', incompatible: false };
}

function countJsonLd(html: string): number {
  let n = 0;
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try { JSON.parse((m[1] ?? '').trim()); n++; } catch { /* malformed, skip */ }
  }
  return n;
}

async function handleCheck(req: Request, env: Env): Promise<Response> {
  void env;
  const raw = new URL(req.url).searchParams.get('url') || '';
  let target: string;
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (u.hostname.indexOf('.') === -1) throw new Error('no tld');
    target = u.origin + '/';
  } catch {
    return json({ result: 'unreachable' as CheckResult });
  }

  try {
    const res = await fetch(target, {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; foundbyai-checker/1.0)' },
      redirect: 'follow',
    });
    if (!res.ok) return json({ result: 'unreachable' as CheckResult });
    const body = await res.text();
    const { platform, incompatible } = detectPlatform(body, res.headers);
    const signals = countJsonLd(body);
    return json({
      result: (incompatible ? 'incompatible' : 'compatible') as CheckResult,
      platform,
      signals,
    });
  } catch (e) {
    const name = (e as Error)?.name || '';
    if (name === 'TimeoutError' || name === 'AbortError') return json({ result: 'timeout' as CheckResult });
    return json({ result: 'unreachable' as CheckResult });
  }
}

async function handleStart(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  let body: { url?: string; email?: string } = {};
  try { body = (await req.json()) as { url?: string; email?: string }; } catch { return json({ ok: true }); }
  const { url = '', email = '' } = body;
  const cleanEmail = email.trim().toLowerCase();
  const domain = url.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail) || !domain.includes('.')) {
    return json({ ok: true }); // no enumeration / no detail leak
  }
  const slug = deriveSlug(domain);
  if (!/^[a-z0-9-]+$/.test(slug)) return json({ ok: true });

  // ponytail: best-effort per-email cooldown — blocks email-bombing + repeated paid Claude calls.
  // Per-IP limiting deferred to M2. Still returns {ok:true} (no enumeration).
  if (await env.DASHBOARD_KV.get(`cooldown:start:${cleanEmail}`)) return json({ ok: true });
  await env.DASHBOARD_KV.put(`cooldown:start:${cleanEmail}`, '1', { expirationTtl: 60 });

  ctx.waitUntil((async () => {
    await addProduct(cleanEmail, slug, env.DASHBOARD_KV);
    if (!(await getProduct(slug, env.DASHBOARD_KV))) {
      const p: Product = { slug, domain, email: cleanEmail, status: 'draft', createdAt: new Date().toISOString() };
      await saveProduct(p, env.DASHBOARD_KV);
    }
    const t = await mintLoginToken(cleanEmail, env.DASHBOARD_KV);
    await sendLoginEmail(cleanEmail, `${env.SITE_URL}/auth/verify?t=${t}`, env);
    // Kick off extraction (cached under draft:<slug>); ignore failures here.
    try {
      const draft = await extractContent(domain, env);
      await env.DASHBOARD_KV.put(`draft:${slug}`, JSON.stringify(draft));
    } catch { /* extraction retried on the setup page */ }
  })());

  return json({ ok: true });
}

async function handleWaitlist(req: Request, env: Env): Promise<Response> {
  let body: { url?: string; email?: string } = {};
  try { body = (await req.json()) as { url?: string; email?: string }; } catch { return json({ ok: true }); }
  const { url = '', email = '' } = body;
  const cleanEmail = email.trim().toLowerCase();
  const domain = url.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail) && domain.includes('.')) {
    const platform = new URL(req.url).searchParams.get('platform') || 'ukendt';
    await putWaitlist(cleanEmail, domain, platform, env.DASHBOARD_KV);
  }
  return json({ ok: true });
}

// ── Auth / Login handlers ────────────────────────────────────────────────────

function renderLoginPage(sent = false): string {
  return `<!DOCTYPE html><html lang="da"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Log ind — Found by AI</title>
<style>body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0A0D10;color:#E0DED8;display:flex;min-height:100vh;align-items:center;justify-content:center}
.card{background:#12151A;border:1px solid #252830;border-radius:16px;padding:36px;max-width:380px;width:90%}
h1{font-size:20px;margin:0 0 8px}p{color:#9CA29C;font-size:14px;line-height:1.5}
input{width:100%;padding:12px 14px;border-radius:10px;border:1px solid #2A2E36;background:#0A0D10;color:#fff;font-size:15px;margin:14px 0;box-sizing:border-box}
button{width:100%;padding:12px;border:none;border-radius:10px;background:#587B66;color:#fff;font-weight:600;font-size:15px;cursor:pointer}</style>
</head><body><div class="card">
${sent
  ? `<h1>Tjek din indbakke</h1><p>Vi har sendt dig et login-link. Klik på linket i e-mailen for at logge ind.</p>`
  : `<h1>Log ind</h1><p>Indtast din e-mail, så sender vi dig et login-link.</p>
     <form method="POST" action="/api/auth/request">
       <input type="email" name="email" required placeholder="din@email.dk">
       <button type="submit">Send mig et login-link</button>
     </form>`}
</div></body></html>`;
}

async function sendLoginEmail(to: string, link: string, env: Env): Promise<void> {
  const _r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Found by AI <hej@foundbyai.dk>',
      to: [to],
      subject: 'Dit login-link til Found by AI',
      html: `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px 16px">
        <h1 style="font-size:20px;color:#1A1A17">Log ind på Found by AI</h1>
        <p style="color:#46453E;line-height:1.6">Klik på knappen for at logge ind. Linket udløber om 15 minutter.</p>
        <p style="margin:24px 0"><a href="${link}" style="background:#587B66;color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:600">Log ind →</a></p>
        <p style="color:#8A8A80;font-size:13px">Hvis du ikke bad om dette, kan du ignorere e-mailen.</p>
      </div>`,
    }),
  });
  if (!_r.ok) console.error('Resend login email failed', _r.status, await _r.text().catch(() => ''));
}

function handleLoginPage(): Response { return html(renderLoginPage(false)); }

async function handleAuthRequest(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const ct = req.headers.get('content-type') || '';
  let email = '';
  try {
    if (ct.includes('application/json')) email = ((await req.json()) as { email?: string }).email ?? '';
    else email = String((await req.formData()).get('email') ?? '');
  } catch { email = ''; }
  email = email.trim().toLowerCase();
  // Always 200 (no enumeration). Only send if it looks like an email.
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) && !(await env.DASHBOARD_KV.get(`cooldown:login:${email}`))) {
    await env.DASHBOARD_KV.put(`cooldown:login:${email}`, '1', { expirationTtl: 60 });
    ctx.waitUntil((async () => {
      const t = await mintLoginToken(email, env.DASHBOARD_KV);
      await sendLoginEmail(email, `${env.SITE_URL}/auth/verify?t=${t}`, env);
    })());
  }
  if (ct.includes('application/json')) return json({ ok: true });
  return html(renderLoginPage(true));
}

async function handleAuthVerify(req: Request, env: Env): Promise<Response> {
  const t = new URL(req.url).searchParams.get('t') ?? '';
  const email = await consumeLoginToken(t, env.DASHBOARD_KV);
  if (!email) return html(renderErrorPage('Login-linket er udløbet eller allerede brugt. Bed om et nyt.'), 400);
  // Ensure an account exists (covers verify-before-start edge cases).
  if (!(await getAccount(email, env.DASHBOARD_KV))) {
    await env.DASHBOARD_KV.put(`account:${email}`, JSON.stringify({ email, isOps: false, createdAt: new Date().toISOString(), productSlugs: [] }));
  }
  const sid = await createSession(email, env.DASHBOARD_KV);
  return new Response(null, { status: 302, headers: { Location: '/app', 'Set-Cookie': sessionCookie(sid) } });
}

async function handleLogout(req: Request, env: Env): Promise<Response> {
  await destroySession(req, env.DASHBOARD_KV);
  return new Response(null, { status: 302, headers: { Location: '/', 'Set-Cookie': clearCookie() } });
}

async function handleSetupPage(req: Request, env: Env, slug: string): Promise<Response> {
  const guard = await requireOwnedProduct(req, env, slug);
  if (guard instanceof Response) {
    if (guard.status === 401) return new Response(null, { status: 302, headers: { Location: '/login' } });
    return html(renderErrorPage('Produktet blev ikke fundet.'), 404);
  }
  const product = guard.product;
  const draftRaw = await env.DASHBOARD_KV.get(`draft:${slug}`);
  const draft = draftRaw ? JSON.parse(draftRaw) : null;
  const initial = JSON.stringify({ slug, domain: product.domain, status: product.status, draft });
  return html(renderSetupPage(slug, product.domain, initial));
}

async function handleProductPage(req: Request, env: Env, slug: string): Promise<Response> {
  const guard = await requireOwnedProduct(req, env, slug);
  if (guard instanceof Response) {
    if (guard.status === 401) return new Response(null, { status: 302, headers: { Location: '/login' } });
    return html(renderErrorPage('Produktet blev ikke fundet.'), 404);
  }
  return appProductRedirect(slug, env, guard.id.isOps);
}

async function appProductRedirect(slug: string, env: Env, isOps: boolean): Promise<Response> {
  const product = await getProduct(slug, env.DASHBOARD_KV);
  if (product && product.status === 'active') {
    const clientToken = await env.DASHBOARD_KV.get(`client_token:${slug}`);
    const loc = dashboardUrl(
      { base: env.DASHBOARD_URL, opsToken: env.DASHBOARD_TOKEN, clientToken },
      slug, isOps,
    );
    return new Response(null, { status: 302, headers: { Location: loc } });
  }
  return new Response(null, { status: 302, headers: { Location: `/app/p/${slug}/setup` } });
}

async function handleApp(req: Request, env: Env): Promise<Response> {
  const id = await getIdentity(req, env);
  if (!id) return new Response(null, { status: 302, headers: { Location: '/login' } });

  // Ops or multi-product: minimal functional list (styled center is Milestone 2).
  let slugs: string[];
  if (id.isOps) {
    const list = await env.DASHBOARD_KV.list({ prefix: 'config:' });
    slugs = list.keys.map(k => k.name.slice('config:'.length));
  } else {
    slugs = (await getAccount(id.email, env.DASHBOARD_KV))?.productSlugs ?? [];
  }

  const only = slugs[0];
  if (!id.isOps && slugs.length === 1 && only) {
    return appProductRedirect(only, env, id.isOps);
  }
  const items = slugs.map(s => `<li><a href="/app/p/${s}" style="color:#86AD94">${s}</a></li>`).join('');
  return html(`<!DOCTYPE html><html lang="da"><head><meta charset="utf-8"><meta name="robots" content="noindex">
<title>Mine websites — Found by AI</title></head>
<body style="font-family:-apple-system,sans-serif;background:#0A0D10;color:#E0DED8;padding:40px">
<h1 style="font-size:20px">${id.isOps ? 'Alle websites (Ops)' : 'Mine websites'}</h1>
<ul style="line-height:2">${items || '<li>Ingen endnu.</li>'}</ul>
<p><a href="/api/auth/logout" style="color:#9CA29C">Log ud</a></p>
</body></html>`);
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const parts = url.pathname.split('/').filter(Boolean);
    const [p0, p1] = parts;

    if (req.method === 'GET' && p0 === 'activate' && p1)
      return handleActivatePage(p1, env);
    if (req.method === 'POST' && p0 === 'api' && p1 === 'extract')
      return handleExtract(req, env);
    if (req.method === 'PUT' && p0 === 'api' && p1 === 'confirm')
      return handleConfirm(req, env);
    if (req.method === 'POST' && p0 === 'api' && p1 === 'checkout')
      return handleCheckout(req, env);
    if (req.method === 'GET' && p0 === 'success')
      return handleSuccess(req, env);
    if (req.method === 'POST' && p0 === 'api' && p1 === 'webhook')
      return handleWebhook(req, env, ctx);
    if (req.method === 'GET' && p0 === 'api' && p1 === 'dns-status')
      return handleDnsStatus(req, env, ctx);
    if (req.method === 'GET' && p0 === 'api' && p1 === 'check')
      return handleCheck(req, env);
    if (req.method === 'POST' && p0 === 'api' && p1 === 'start')
      return handleStart(req, env, ctx);
    if (req.method === 'POST' && p0 === 'api' && p1 === 'waitlist')
      return handleWaitlist(req, env);

    if (req.method === 'GET' && p0 === 'login') return handleLoginPage();
    if (req.method === 'POST' && p0 === 'api' && p1 === 'auth' && parts[2] === 'request')
      return handleAuthRequest(req, env, ctx);
    if (req.method === 'GET' && p0 === 'auth' && p1 === 'verify')
      return handleAuthVerify(req, env);
    if (req.method === 'POST' && p0 === 'api' && p1 === 'auth' && parts[2] === 'logout')
      return handleLogout(req, env);

    if (req.method === 'GET' && p0 === 'app' && !p1) return handleApp(req, env);
    if (req.method === 'GET' && p0 === 'app' && p1 === 'p' && parts[2] && parts[3] === 'setup')
      return handleSetupPage(req, env, parts[2]);
    if (req.method === 'GET' && p0 === 'app' && p1 === 'p' && parts[2] && !parts[3])
      return handleProductPage(req, env, parts[2]);
    if (req.method === 'GET' && p0 === 'api' && p1 === 'auth' && parts[2] === 'logout')
      return handleLogout(req, env); // GET convenience for the list link

    return new Response('Not found', { status: 404 });
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(checkPendingDns(env));
  },
};
