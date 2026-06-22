// foundbyai-worker — activation onboarding for foundbyai.dk
// Routes: GET /activate/:token  POST /api/extract  PUT /api/confirm
//         POST /api/checkout    GET /success        POST /api/webhook
//         GET /api/dns-status
// Cron: */5 * * * *  → checkPendingDns

interface Env {
  DASHBOARD_KV: KVNamespace;
  ANTHROPIC_API_KEY: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  STRIPE_PRICE_ID: string;
  RESEND_API_KEY: string;
  SITE_URL: string;    // https://foundbyai.dk
  GEO_PROXY_IP: string; // 76.76.21.21
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

async function getDraft(token: string, env: Env): Promise<DraftContent | null> {
  const raw = await env.DASHBOARD_KV.get(`draft:${token}`);
  return raw ? (JSON.parse(raw) as DraftContent) : null;
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

async function handleActivatePage(token: string, env: Env): Promise<Response> {
  const data = await getToken(token, env);
  if (!data) return html(renderErrorPage('Linket er udløbet eller ugyldigt. Kontakt os for et nyt link.'), 404);

  const draft = await getDraft(token, env);
  const initial = JSON.stringify({ token, domain: data.domain, status: data.status, draft });

  return html(renderActivatePage(data.domain, initial));
}

async function handleExtract(req: Request, env: Env): Promise<Response> {
  const { token } = await req.json() as { token: string };
  const data = await getToken(token, env);
  if (!data) return json({ error: 'invalid_token' }, 400);

  // Return cached draft if exists
  const cached = await getDraft(token, env);
  if (cached) return json(cached);

  try {
    const draft = await extractContent(data.domain, env);
    await env.DASHBOARD_KV.put(`draft:${token}`, JSON.stringify(draft));
    return json(draft);
  } catch {
    return json({ error: 'extraction_failed' }, 500);
  }
}

async function handleConfirm(req: Request, env: Env): Promise<Response> {
  const body = await req.json() as { token: string } & Partial<DraftContent>;
  const { token, ...fields } = body;

  const data = await getToken(token, env);
  if (!data) return json({ error: 'invalid_token' }, 400);

  // Persist confirmed draft (overwrites extracted version with user edits)
  const draft: DraftContent = {
    businessName: fields.businessName ?? '',
    address: fields.address ?? '',
    phone: fields.phone ?? '',
    openingHours: fields.openingHours ?? '',
    services: Array.isArray(fields.services) ? fields.services : [],
    extractedAt: new Date().toISOString(),
  };
  await env.DASHBOARD_KV.put(`draft:${token}`, JSON.stringify(draft));

  data.status = 'content_confirmed';
  await saveToken(token, data, env);

  return json({ ok: true });
}

async function handleCheckout(req: Request, env: Env): Promise<Response> {
  const { token } = await req.json() as { token: string };
  const data = await getToken(token, env);
  if (!data) return json({ error: 'invalid_token' }, 400);
  if (data.status !== 'content_confirmed') return json({ error: 'confirm_first' }, 400);

  const successUrl = `${env.SITE_URL}/success?session_id={CHECKOUT_SESSION_ID}&token=${token}`;
  const cancelUrl = `${env.SITE_URL}/activate/${token}`;

  const params = new URLSearchParams({
    mode: 'subscription',
    'payment_method_types[]': 'card',
    'line_items[0][price]': env.STRIPE_PRICE_ID,
    'line_items[0][quantity]': '1',
    'subscription_data[trial_period_days]': '30',
    'customer_email': data.email,
    'success_url': successUrl,
    'cancel_url': cancelUrl,
    'metadata[token]': token,
  });

  const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  const session = await stripeRes.json() as { url?: string; error?: { message: string } };
  if (!session.url) return json({ error: session.error?.message ?? 'stripe_error' }, 500);

  return json({ url: session.url });
}

async function handleSuccess(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const sessionId = url.searchParams.get('session_id');
  const token = url.searchParams.get('token');
  if (!sessionId || !token) return html(renderErrorPage('Ugyldigt link.'), 400);

  const data = await getToken(token, env);
  if (!data) return html(renderErrorPage('Token udløbet.'), 400);

  // Verify session with Stripe
  const stripeRes = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, {
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
  });
  const session = await stripeRes.json() as {
    status?: string;
    payment_status?: string;
    customer?: string;
    subscription?: string;
    metadata?: { token?: string };
  };

  if (session.status !== 'complete') {
    return Response.redirect(`${env.SITE_URL}/activate/${token}`, 302);
  }

  data.status = 'dns_pending';
  if (session.customer) data.stripeCustomerId = session.customer;
  if (session.subscription) data.stripeSubscriptionId = session.subscription;
  await saveToken(token, data, env);

  // Add to dns polling queue
  await env.DASHBOARD_KV.put(`dns_pending:${token}`, data.domain, { expirationTtl: TOKEN_TTL });

  return Response.redirect(`${env.SITE_URL}/activate/${token}`, 302);
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
  const token = new URL(req.url).searchParams.get('token');
  if (!token) return json({ error: 'missing_token' }, 400);

  const data = await getToken(token, env);
  if (!data) return json({ error: 'invalid_token' }, 400);

  if (data.status === 'active') return json({ active: true });

  const ips = await resolveARecord(data.domain);
  if (ips.includes(env.GEO_PROXY_IP)) {
    ctx.waitUntil(activateClient(token, data, env));
    return json({ active: true });
  }

  return json({ active: false, resolvedIps: ips });
}

// ── Activation Logic ─────────────────────────────────────────────────────────

async function activateClient(token: string, data: TokenData, env: Env) {
  data.status = 'active';
  data.activatedAt = new Date().toISOString();
  await saveToken(token, data, env);

  // Write GEO config (same KV namespace, key = config:{domain})
  const draft = await getDraft(token, env);
  await env.DASHBOARD_KV.put(`config:${data.domain}`, JSON.stringify({
    domain: data.domain,
    activeSince: data.activatedAt,
    ...draft,
  }));

  // Remove from dns polling queue
  await env.DASHBOARD_KV.delete(`dns_pending:${token}`);

  // Send confirmation email
  await sendActivationEmail(data.email, data.domain, draft?.businessName ?? data.domain, env);
}

async function sendActivationEmail(to: string, domain: string, name: string, env: Env) {
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
      html: `
        <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;padding:32px 16px">
          <h1 style="color:#15803d;font-size:22px">🎉 Dit GEO Layer er nu aktivt!</h1>
          <p style="color:#374151;line-height:1.6">
            <strong>${esc(name)}</strong> (${esc(domain)}) er nu synlig for ChatGPT, Perplexity og Claude.<br><br>
            AI-søgemaskiner kan nu læse din virksomhedsinfo og anbefale dig til kunder.
          </p>
          <p style="color:#374151;line-height:1.6">
            Du vil modtage en månedlig rapport med data om, hvornår AI-bots besøger din side og citerer din virksomhed.
          </p>
          <p style="color:#6b7280;font-size:14px;margin-top:32px">
            Found by AI · <a href="https://foundbyai.dk" style="color:#2563eb">foundbyai.dk</a>
          </p>
        </div>
      `,
    }),
  });
}

// ── Scheduled: batch DNS check ───────────────────────────────────────────────

async function checkPendingDns(env: Env) {
  const list = await env.DASHBOARD_KV.list({ prefix: 'dns_pending:' });

  await Promise.all(
    list.keys.map(async ({ name }) => {
      const token = name.replace('dns_pending:', '');
      const domain = await env.DASHBOARD_KV.get(name);
      if (!domain) return;

      const ips = await resolveARecord(domain);
      if (ips.includes(env.GEO_PROXY_IP)) {
        const data = await getToken(token, env);
        if (data && data.status !== 'active') {
          await activateClient(token, data, env);
        }
      }
    })
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

function renderActivatePage(domain: string, initialJson: string): string {
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
      fetch('/api/dns-status?token=' + D.token)
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

  if (D.status === 'paid' || D.status === 'dns_pending') {
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
    body: JSON.stringify({ token: D.token })
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
        token: D.token,
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
      body: JSON.stringify({ token: D.token })
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

    return new Response('Not found', { status: 404 });
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(checkPendingDns(env));
  },
};
