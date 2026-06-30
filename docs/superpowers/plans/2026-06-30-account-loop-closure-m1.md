# Account Layer & Loop Closure (Milestone 1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A real LP visitor can self-serve from URL-check → email → magic-link login → onboarding (confirm info → card → DNS) → an activated product reachable via an emailed dashboard link; incompatible-platform emails persist as waitlist leads; Ops can log in.

**Architecture:** Add an email-identity **account** layer (KV) to the existing `foundbyai-worker`. Two new pure-logic modules (`lib/account.ts`, `lib/auth.ts`) tested in isolation with an in-memory KV mock. The existing onboarding endpoints (extract/confirm/checkout/success/dns) are re-keyed from per-product `token` to `product:<slug>` gated by session identity. Onboarding UI moves to a session-gated `/app/p/:slug/setup` page (adapted from the current activate page). Dashboard viewing is a 302 to the existing dashboard worker — not reimplemented.

**Tech Stack:** Cloudflare Workers (TypeScript), Workers KV (`DASHBOARD_KV`), Resend (email), Stripe (checkout/subscription), `node:test` + `tsx` for tests (zero new deps — `tsx` resolves from repo root `node_modules`).

## Global Constraints

- **One plan, one worker:** all changes are in `edge/foundbyai/` (`foundbyai-worker`). Do not modify `edge/dashboard/` except where explicitly stated (none in M1).
- **Shared KV:** `DASHBOARD_KV` id `76d59151b3934aa1b29306d6b6301293` is shared with the dashboard worker. Key prefixes in M1: `account:`, `product:`, `session:`, `login:`, `waitlist:`, plus existing `draft:`, `config:`, `client_token:`, `dns_pending:`.
- **Slug derivation (canonical, copy verbatim):** `domain.toLowerCase().replace(/^https?:\/\//,'').replace(/^www\./,'').replace(/\/.*$/,'').replace(/\.[a-z.]+$/,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'')` → e.g. `virumakupunktur.dk` → `virumakupunktur`. Slug param guard everywhere: `/^[a-z0-9-]+$/`.
- **Product status lifecycle:** `draft → content_confirmed → trial_pending_dns → active`, plus no product for waitlist. (Maps onto the legacy `TokenData.status` values `pending/paid/dns_pending` which remain only in dead legacy code.)
- **Cookies:** `fbai_session` — `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`.
- **No account enumeration:** `POST /api/auth/request` and `POST /api/auth/waitlist`/`/api/start` always return 200 regardless of whether the email exists.
- **Magic-link tokens:** 32-byte random hex, `login:<token>` TTL 900s, single-use (deleted on verify).
- **Danish copy** for all user-facing pages/emails (match existing tone). **Never** edit client website content (project red-line — N/A here but keep in mind for extraction).
- **OPS_EMAILS** env var (comma-separated) decides `isOps`. Add to `wrangler.toml [vars]` and read in auth.
- **Commit after every task** with `type: description` English messages, ending with the Co-Authored-By trailer:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

## File Structure

- **Create** `edge/foundbyai/src/lib/account.ts` — types (`Account`, `Product`, `ProductStatus`), `deriveSlug`, KV helpers (`getAccount/saveAccount/addProduct`, `getProduct/saveProduct`, `putWaitlist`).
- **Create** `edge/foundbyai/src/lib/auth.ts` — magic-link mint/verify, session create/get/destroy, `getIdentity`, `requireAuth`, `isOpsEmail`, `getCookie`.
- **Create** `edge/foundbyai/test/account.test.ts` — slug + KV-helper tests with in-memory KV mock.
- **Create** `edge/foundbyai/test/auth.test.ts` — magic-link single-use, session resolution, ops flag.
- **Create** `edge/foundbyai/src/lib/kvmock.ts` — tiny in-memory `KVNamespace` stand-in for tests (also importable by both test files).
- **Modify** `edge/foundbyai/src/worker.ts` — add `Env` fields; new handlers (`handleStart`, `handleWaitlist`, `handleLoginPage`, `handleAuthRequest`, `handleAuthVerify`, `handleLogout`, `handleApp`, `handleSetupPage`); re-key existing handlers (`handleExtract/handleConfirm/handleCheckout/handleSuccess/handleDnsStatus/activateClient`) to slug+session; new routes; rename `renderActivatePage`→`renderSetupPage`.
- **Modify** `edge/foundbyai/public/index.html` + `public/app.js` — result-card email field → `/api/start`; incompatible card → real `/api/waitlist`.
- **Modify** `edge/foundbyai/wrangler.toml` — add `OPS_EMAILS` var.
- **Modify** `edge/foundbyai/package.json` — add `"test"` script.

---

## Task 1: Data-model module (`lib/account.ts`) + KV mock + tests

**Files:**
- Create: `edge/foundbyai/src/lib/kvmock.ts`
- Create: `edge/foundbyai/src/lib/account.ts`
- Create: `edge/foundbyai/test/account.test.ts`
- Modify: `edge/foundbyai/package.json` (add test script)

**Interfaces:**
- Produces:
  - `type ProductStatus = 'draft' | 'content_confirmed' | 'trial_pending_dns' | 'active'`
  - `interface Account { email: string; isOps: boolean; createdAt: string; productSlugs: string[] }`
  - `interface Product { slug: string; domain: string; email: string; status: ProductStatus; stripeCustomerId?: string; stripeSubscriptionId?: string; createdAt: string; activatedAt?: string }`
  - `deriveSlug(domain: string): string`
  - `getAccount(email: string, kv: KVNamespace): Promise<Account | null>`
  - `saveAccount(a: Account, kv: KVNamespace): Promise<void>`
  - `addProduct(email: string, slug: string, kv: KVNamespace): Promise<void>` (creates account if missing, dedupes slug)
  - `getProduct(slug: string, kv: KVNamespace): Promise<Product | null>`
  - `saveProduct(p: Product, kv: KVNamespace): Promise<void>`
  - `putWaitlist(email: string, domain: string, platform: string, kv: KVNamespace): Promise<void>`
  - `MemKV` (from kvmock) implementing `get/put/delete/list` subset used here.

- [ ] **Step 1: Add the test script to package.json**

Modify `edge/foundbyai/package.json` `"scripts"` to add (keep existing keys):

```json
    "test": "tsx --test test/*.test.ts"
```

- [ ] **Step 2: Write the in-memory KV mock**

Create `edge/foundbyai/src/lib/kvmock.ts`:

```ts
// Minimal in-memory KVNamespace stand-in for tests. Implements only the subset used.
export class MemKV {
  store = new Map<string, string>();
  async get(key: string, _type?: string): Promise<string | null> {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  async put(key: string, value: string, _opts?: { expirationTtl?: number }): Promise<void> {
    this.store.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
  async list(opts?: { prefix?: string }): Promise<{ keys: { name: string }[] }> {
    const prefix = opts?.prefix ?? '';
    return { keys: [...this.store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })) };
  }
}
```

- [ ] **Step 3: Write the failing tests**

Create `edge/foundbyai/test/account.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemKV } from '../src/lib/kvmock.ts';
import {
  deriveSlug, getAccount, saveAccount, addProduct,
  getProduct, saveProduct, putWaitlist, type Product,
} from '../src/lib/account.ts';

test('deriveSlug strips scheme, www, tld, path and normalizes', () => {
  assert.equal(deriveSlug('virumakupunktur.dk'), 'virumakupunktur');
  assert.equal(deriveSlug('https://www.Virum-Akupunktur.dk/kontakt'), 'virum-akupunktur');
  assert.equal(deriveSlug('My Klinik.co.uk'), 'my-klinik');
});

test('addProduct creates account and dedupes slugs', async () => {
  const kv = new MemKV() as unknown as KVNamespace;
  await addProduct('a@b.dk', 'foo', kv);
  await addProduct('a@b.dk', 'foo', kv);
  await addProduct('a@b.dk', 'bar', kv);
  const acc = await getAccount('a@b.dk', kv);
  assert.deepEqual(acc?.productSlugs, ['foo', 'bar']);
  assert.equal(acc?.isOps, false);
});

test('saveProduct / getProduct round-trip', async () => {
  const kv = new MemKV() as unknown as KVNamespace;
  const p: Product = { slug: 'foo', domain: 'foo.dk', email: 'a@b.dk', status: 'draft', createdAt: 'now' };
  await saveProduct(p, kv);
  assert.deepEqual(await getProduct('foo', kv), p);
  assert.equal(await getProduct('missing', kv), null);
});

test('putWaitlist stores keyed by email, overwrites on resubmit', async () => {
  const kv = new MemKV() as unknown as KVNamespace;
  await putWaitlist('a@b.dk', 'wix.dk', 'Wix', kv);
  await putWaitlist('a@b.dk', 'wix2.dk', 'Wix', kv);
  const raw = await kv.get('waitlist:a@b.dk');
  const rec = JSON.parse(raw!);
  assert.equal(rec.domain, 'wix2.dk');
  assert.equal(rec.platform, 'Wix');
  assert.ok(rec.createdAt);
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `cd edge/foundbyai && npm test`
Expected: FAIL — `Cannot find module '../src/lib/account.ts'`.

- [ ] **Step 5: Implement `lib/account.ts`**

Create `edge/foundbyai/src/lib/account.ts`:

```ts
// Account / product data model on top of shared DASHBOARD_KV.
export type ProductStatus = 'draft' | 'content_confirmed' | 'trial_pending_dns' | 'active';

export interface Account {
  email: string;
  isOps: boolean;
  createdAt: string;
  productSlugs: string[];
}

export interface Product {
  slug: string;
  domain: string;
  email: string;
  status: ProductStatus;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  createdAt: string;
  activatedAt?: string;
}

export function deriveSlug(domain: string): string {
  return domain
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
    .replace(/\.[a-z.]+$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export async function getAccount(email: string, kv: KVNamespace): Promise<Account | null> {
  const raw = await kv.get(`account:${email}`);
  return raw ? (JSON.parse(raw) as Account) : null;
}

export async function saveAccount(a: Account, kv: KVNamespace): Promise<void> {
  await kv.put(`account:${a.email}`, JSON.stringify(a));
}

export async function addProduct(email: string, slug: string, kv: KVNamespace): Promise<void> {
  const existing = await getAccount(email, kv);
  const acc: Account = existing ?? { email, isOps: false, createdAt: new Date().toISOString(), productSlugs: [] };
  if (!acc.productSlugs.includes(slug)) acc.productSlugs.push(slug);
  await saveAccount(acc, kv);
}

export async function getProduct(slug: string, kv: KVNamespace): Promise<Product | null> {
  const raw = await kv.get(`product:${slug}`);
  return raw ? (JSON.parse(raw) as Product) : null;
}

export async function saveProduct(p: Product, kv: KVNamespace): Promise<void> {
  await kv.put(`product:${p.slug}`, JSON.stringify(p));
}

export async function putWaitlist(email: string, domain: string, platform: string, kv: KVNamespace): Promise<void> {
  await kv.put(`waitlist:${email}`, JSON.stringify({ email, domain, platform, createdAt: new Date().toISOString() }));
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd edge/foundbyai && npm test`
Expected: PASS — 4 tests.

- [ ] **Step 7: Typecheck the worker still builds**

Run: `cd edge/foundbyai && npx tsc --noEmit -p tsconfig.json` (if it errors only on pre-existing issues unrelated to new files, that's acceptable; new files must be clean).
Expected: no errors in `src/lib/account.ts` / `src/lib/kvmock.ts`.

- [ ] **Step 8: Commit**

```bash
cd /Users/blake/Documents/geomvp
git add edge/foundbyai/src/lib/account.ts edge/foundbyai/src/lib/kvmock.ts edge/foundbyai/test/account.test.ts edge/foundbyai/package.json
git commit -m "feat(account): data-model module + slug util + KV-mock tests

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Auth module (`lib/auth.ts`) + tests

**Files:**
- Create: `edge/foundbyai/src/lib/auth.ts`
- Create: `edge/foundbyai/test/auth.test.ts`

**Interfaces:**
- Consumes: `getAccount`, `saveAccount`, `Account` from `lib/account.ts`; `MemKV` from `lib/kvmock.ts`.
- Produces:
  - `interface Identity { email: string; isOps: boolean }`
  - `isOpsEmail(email: string, opsCsv: string): boolean`
  - `getCookie(req: Request, name: string): string | null`
  - `mintLoginToken(email: string, kv: KVNamespace): Promise<string>` (stores `login:<t>` → email, TTL 900)
  - `consumeLoginToken(token: string, kv: KVNamespace): Promise<string | null>` (returns email, single-use; deletes)
  - `createSession(email: string, kv: KVNamespace): Promise<string>` (returns sid; stores `session:<sid>` → email TTL 2592000)
  - `getIdentity(req: Request, env: { DASHBOARD_KV: KVNamespace; OPS_EMAILS: string }): Promise<Identity | null>`
  - `destroySession(req: Request, kv: KVNamespace): Promise<void>`
  - `sessionCookie(sid: string): string` and `clearCookie(): string` (Set-Cookie header values)
  - `randomHex(bytes: number): string`

- [ ] **Step 1: Write the failing tests**

Create `edge/foundbyai/test/auth.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemKV } from '../src/lib/kvmock.ts';
import { saveAccount } from '../src/lib/account.ts';
import {
  isOpsEmail, getCookie, mintLoginToken, consumeLoginToken,
  createSession, getIdentity, sessionCookie,
} from '../src/lib/auth.ts';

test('isOpsEmail matches case-insensitively within CSV', () => {
  assert.equal(isOpsEmail('Me@Foundbyai.dk', 'me@foundbyai.dk,boss@x.dk'), true);
  assert.equal(isOpsEmail('other@x.dk', 'me@foundbyai.dk'), false);
  assert.equal(isOpsEmail('me@foundbyai.dk', ''), false);
});

test('getCookie parses a named cookie', () => {
  const req = new Request('https://x.dk', { headers: { Cookie: 'a=1; fbai_session=abc; b=2' } });
  assert.equal(getCookie(req, 'fbai_session'), 'abc');
  assert.equal(getCookie(req, 'missing'), null);
});

test('login token is single-use', async () => {
  const kv = new MemKV() as unknown as KVNamespace;
  const t = await mintLoginToken('a@b.dk', kv);
  assert.equal(await consumeLoginToken(t, kv), 'a@b.dk');
  assert.equal(await consumeLoginToken(t, kv), null); // already consumed
});

test('getIdentity resolves cookie -> session -> account, applies ops flag', async () => {
  const kv = new MemKV() as unknown as KVNamespace;
  await saveAccount({ email: 'a@b.dk', isOps: false, createdAt: 'now', productSlugs: [] }, kv);
  const sid = await createSession('a@b.dk', kv);
  const req = new Request('https://x.dk', { headers: { Cookie: sessionCookie(sid).split(';')[0] } });
  const id = await getIdentity(req, { DASHBOARD_KV: kv, OPS_EMAILS: 'a@b.dk' });
  assert.equal(id?.email, 'a@b.dk');
  assert.equal(id?.isOps, true); // from OPS_EMAILS even though stored account.isOps=false
});

test('getIdentity returns null without a valid session', async () => {
  const kv = new MemKV() as unknown as KVNamespace;
  const req = new Request('https://x.dk');
  assert.equal(await getIdentity(req, { DASHBOARD_KV: kv, OPS_EMAILS: '' }), null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd edge/foundbyai && npm test`
Expected: FAIL — `Cannot find module '../src/lib/auth.ts'`.

- [ ] **Step 3: Implement `lib/auth.ts`**

Create `edge/foundbyai/src/lib/auth.ts`:

```ts
import { getAccount } from './account.ts';

export interface Identity { email: string; isOps: boolean }

const SESSION_TTL = 2592000; // 30 days
const LOGIN_TTL = 900;       // 15 min

export function randomHex(bytes: number): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return [...a].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function isOpsEmail(email: string, opsCsv: string): boolean {
  const set = (opsCsv || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  return set.includes(email.trim().toLowerCase());
}

export function getCookie(req: Request, name: string): string | null {
  const cookies = req.headers.get('Cookie') || '';
  const m = cookies.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return m ? m[1] : null;
}

export function sessionCookie(sid: string): string {
  return `fbai_session=${sid}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL}`;
}
export function clearCookie(): string {
  return `fbai_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export async function mintLoginToken(email: string, kv: KVNamespace): Promise<string> {
  const t = randomHex(32);
  await kv.put(`login:${t}`, email, { expirationTtl: LOGIN_TTL });
  return t;
}

export async function consumeLoginToken(token: string, kv: KVNamespace): Promise<string | null> {
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const email = await kv.get(`login:${token}`);
  if (!email) return null;
  await kv.delete(`login:${token}`); // single-use
  return email;
}

export async function createSession(email: string, kv: KVNamespace): Promise<string> {
  const sid = randomHex(32);
  await kv.put(`session:${sid}`, email, { expirationTtl: SESSION_TTL });
  return sid;
}

export async function getIdentity(
  req: Request,
  env: { DASHBOARD_KV: KVNamespace; OPS_EMAILS: string },
): Promise<Identity | null> {
  const sid = getCookie(req, 'fbai_session');
  if (!sid) return null;
  const email = await env.DASHBOARD_KV.get(`session:${sid}`);
  if (!email) return null;
  const acc = await getAccount(email, env.DASHBOARD_KV);
  const isOps = isOpsEmail(email, env.OPS_EMAILS) || !!acc?.isOps;
  return { email, isOps };
}

export async function destroySession(req: Request, kv: KVNamespace): Promise<void> {
  const sid = getCookie(req, 'fbai_session');
  if (sid) await kv.delete(`session:${sid}`);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd edge/foundbyai && npm test`
Expected: PASS — all account + auth tests (9 total).

- [ ] **Step 5: Commit**

```bash
cd /Users/blake/Documents/geomvp
git add edge/foundbyai/src/lib/auth.ts edge/foundbyai/test/auth.test.ts
git commit -m "feat(auth): passwordless magic-link + session identity module

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Login page + auth routes wired to router

**Files:**
- Modify: `edge/foundbyai/src/worker.ts` (Env, imports, handlers, router)
- Modify: `edge/foundbyai/wrangler.toml` (OPS_EMAILS)

**Interfaces:**
- Consumes: `mintLoginToken`, `consumeLoginToken`, `createSession`, `destroySession`, `getIdentity`, `sessionCookie`, `clearCookie` from `lib/auth.ts`; `addProduct` not needed here.
- Produces: routes `GET /login`, `POST /api/auth/request`, `GET /auth/verify`, `POST /api/auth/logout`. Sends magic-link email via Resend. `getIdentity` available to later tasks.

- [ ] **Step 1: Add OPS_EMAILS to wrangler.toml**

Modify `edge/foundbyai/wrangler.toml` `[vars]` block — add (use your real Ops email):

```toml
OPS_EMAILS = "hello.rongyi@gmail.com"
```

- [ ] **Step 2: Add Env field + imports in worker.ts**

In `edge/foundbyai/src/worker.ts`, add to `interface Env` (after `DASHBOARD_URL`):

```ts
  OPS_EMAILS: string;
```

At the top of the file (below the header comment, before `interface Env`), add:

```ts
import {
  deriveSlug, addProduct, getProduct, saveProduct,
  getAccount, putWaitlist, type Product,
} from './lib/account.ts';
import {
  mintLoginToken, consumeLoginToken, createSession, destroySession,
  getIdentity, sessionCookie, clearCookie,
} from './lib/auth.ts';
```

- [ ] **Step 3: Add a magic-link email sender + login page + auth handlers**

In `edge/foundbyai/src/worker.ts`, add near the other `render*`/`handle*` functions:

```ts
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
  await fetch('https://api.resend.com/emails', {
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
}

function handleLoginPage(): Response { return html(renderLoginPage(false)); }

async function handleAuthRequest(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const ct = req.headers.get('content-type') || '';
  let email = '';
  if (ct.includes('application/json')) email = ((await req.json()) as { email?: string }).email ?? '';
  else email = String((await req.formData()).get('email') ?? '');
  email = email.trim().toLowerCase();
  // Always 200 (no enumeration). Only send if it looks like an email.
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    ctx.waitUntil((async () => {
      const t = await mintLoginToken(email, env);
      await sendLoginEmail(email, `${env.SITE_URL}/auth/verify?t=${t}`, env);
    })());
  }
  if (ct.includes('application/json')) return json({ ok: true });
  return html(renderLoginPage(true));
}

async function handleAuthVerify(req: Request, env: Env): Promise<Response> {
  const t = new URL(req.url).searchParams.get('t') ?? '';
  const email = await consumeLoginToken(t, env);
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
```

- [ ] **Step 4: Wire the routes**

In the `fetch` router in `worker.ts`, replace the existing login redirect:

```ts
    if (req.method === 'GET' && p0 === 'login')
      return Response.redirect(env.DASHBOARD_URL, 302);
```

with:

```ts
    if (req.method === 'GET' && p0 === 'login') return handleLoginPage();
    if (req.method === 'POST' && p0 === 'api' && p1 === 'auth' && parts[2] === 'request')
      return handleAuthRequest(req, env, ctx);
    if (req.method === 'GET' && p0 === 'auth' && p1 === 'verify')
      return handleAuthVerify(req, env);
    if (req.method === 'POST' && p0 === 'api' && p1 === 'auth' && parts[2] === 'logout')
      return handleLogout(req, env);
```

- [ ] **Step 5: Build check (dry-run) + typecheck**

Run: `cd edge/foundbyai && npx wrangler deploy --dry-run 2>&1 | tail -5`
Expected: builds, "Total Upload" line printed, no TS errors.

- [ ] **Step 6: Manual smoke (local)**

Run in background: `cd edge/foundbyai && npx wrangler dev --port 8787 --local` (then in another shell):
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8787/login            # 200
curl -s -X POST http://localhost:8787/api/auth/request -H 'content-type: application/json' -d '{"email":"x@y.dk"}'  # {"ok":true}
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:8787/auth/verify?t=deadbeef"  # 400 (invalid token)
```
Expected: codes as commented. Stop the dev server after.

- [ ] **Step 7: Commit**

```bash
cd /Users/blake/Documents/geomvp
git add edge/foundbyai/src/worker.ts edge/foundbyai/wrangler.toml
git commit -m "feat(auth): /login page + magic-link request/verify/logout routes

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: `/api/start` + `/api/waitlist` + LP front-end wiring

**Files:**
- Modify: `edge/foundbyai/src/worker.ts` (handlers + routes)
- Modify: `edge/foundbyai/public/index.html` (result-card email field markup)
- Modify: `edge/foundbyai/public/app.js` (post to /api/start and /api/waitlist)

**Interfaces:**
- Consumes: `deriveSlug`, `addProduct`, `getProduct`, `saveProduct`, `putWaitlist`, `Product` (account.ts); `mintLoginToken`, `sendLoginEmail` (Task 3); `extractContent` (existing).
- Produces: routes `POST /api/start`, `POST /api/waitlist`. After `/api/start`, a `product:<slug>` (status `draft`) + `account:<email>` exist, a `draft:<slug>` extraction is kicked off, and a magic link is emailed.

- [ ] **Step 1: Implement handlers in worker.ts**

Add near the other handlers in `worker.ts`:

```ts
async function handleStart(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const { url = '', email = '' } = (await req.json()) as { url?: string; email?: string };
  const cleanEmail = email.trim().toLowerCase();
  const domain = url.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail) || !domain.includes('.')) {
    return json({ ok: true }); // no enumeration / no detail leak
  }
  const slug = deriveSlug(domain);
  if (!/^[a-z0-9-]+$/.test(slug)) return json({ ok: true });

  ctx.waitUntil((async () => {
    await addProduct(cleanEmail, slug, env.DASHBOARD_KV);
    if (!(await getProduct(slug, env.DASHBOARD_KV))) {
      const p: Product = { slug, domain, email: cleanEmail, status: 'draft', createdAt: new Date().toISOString() };
      await saveProduct(p, env.DASHBOARD_KV);
    }
    // Kick off extraction (cached under draft:<slug>); ignore failures here.
    try {
      const draft = await extractContent(domain, env);
      await env.DASHBOARD_KV.put(`draft:${slug}`, JSON.stringify(draft));
    } catch { /* extraction retried on the setup page */ }
    const t = await mintLoginToken(cleanEmail, env);
    await sendLoginEmail(cleanEmail, `${env.SITE_URL}/auth/verify?t=${t}`, env);
  })());

  return json({ ok: true });
}

async function handleWaitlist(req: Request, env: Env): Promise<Response> {
  const { url = '', email = '' } = (await req.json()) as { url?: string; email?: string };
  const cleanEmail = email.trim().toLowerCase();
  const domain = url.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail) && domain.includes('.')) {
    const platform = new URL(req.url).searchParams.get('platform') || 'ukendt';
    await putWaitlist(cleanEmail, domain, platform, env.DASHBOARD_KV);
  }
  return json({ ok: true });
}
```

- [ ] **Step 2: Wire the routes**

In the router, add (after the `/api/check` route):

```ts
    if (req.method === 'POST' && p0 === 'api' && p1 === 'start')
      return handleStart(req, env, ctx);
    if (req.method === 'POST' && p0 === 'api' && p1 === 'waitlist')
      return handleWaitlist(req, env);
```

- [ ] **Step 3: Add the email field to the compatible result card (app.js)**

In `edge/foundbyai/public/app.js`, in `resultCard()` for the `compatible` branch, replace the `<button id="start-trial" …>Start gratis prøveperiode →</button>` line with a small email form:

```js
        '<form id="start-form" style="display:flex; flex-wrap:wrap; gap:8px; margin-top:4px;">' +
          '<input id="start-email" type="email" required placeholder="din@email.dk" style="flex:1 1 180px; min-width:0; padding:11px 14px; border:1px solid #DCDBD3; border-radius:10px; outline:none; font-size:14px; background:#FAFAF8;">' +
          '<button type="submit" style="flex:0 1 auto; padding:11px 18px; background:var(--accent); color:#fff; font-family:\'Geist\',sans-serif; font-weight:600; font-size:13px; border-radius:10px;">Send mig mit login →</button>' +
        '</form>' +
```

And add a `start`-done branch: at the top of `resultCard()` add handling so that when `state.startDone` is true and result is compatible, the card body shows a confirmation. Implement by adding near the start of the `if (r === 'compatible')` block:

```js
      if (state.startDone) {
        return '<div style="max-width:460px; width:100%; margin:28px auto 0; padding:24px 26px; background:#fff; border:1.5px solid var(--accent); border-radius:14px; text-align:left; box-shadow:0 8px 30px -10px rgba(88,123,102,0.4); animation:fbai-rise .45s cubic-bezier(.2,.7,.2,1) both;">' +
          '<div style="display:flex; align-items:center; gap:9px; margin-bottom:8px;"><span style="display:inline-flex; align-items:center; justify-content:center; width:22px; height:22px; border-radius:50%; background:var(--accent); color:#fff; font-size:13px;">✓</span><span style="font-family:\'Geist\',sans-serif; font-weight:600; font-size:15px;">Tjek din indbakke</span></div>' +
          '<p style="margin:0; font-size:14px; color:#46453E; line-height:1.5;">Vi har sendt et login-link til <strong>' + (state.startEmail || '') + '</strong>. Klik på linket for at fortsætte opsætningen.</p>' +
        '</div>';
      }
```

- [ ] **Step 4: Add `startDone`/`startEmail` to state + wire both forms (app.js)**

In `app.js`, extend the initial `state` object (line ~17) to include:

```js
  var state = { phase: 'idle', result: null, loadingStep: 0, showError: false, platform: '', waitDone: false, startDone: false, startEmail: '' };
```

In `runCheck()` where it resets per-run flags, also reset: set `state.startDone = false; state.startEmail = '';` alongside `state.waitDone = false;`.

In `wireFeedback()`, replace the `start-trial` block with start-form handling, and update the wait-form to POST:

```js
    var sf = $('#start-form', feedback);
    if (sf) sf.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = ($('#start-email', feedback) || {}).value || '';
      state.startEmail = email;
      var url = normalize(input.value);
      fetch('/api/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: url, email: email }) });
      state.startDone = true; render();
    });
    var wf = $('#wait-form', feedback);
    if (wf) wf.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = ($('#wait-email', feedback) || {}).value || '';
      var url = normalize(input.value);
      var plat = encodeURIComponent(state.platform || 'ukendt');
      fetch('/api/waitlist?platform=' + plat, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: url, email: email }) });
      state.waitDone = true; render();
    });
```

Remove the now-unused `start-trial` hover/click wiring (the old `var trial = $('#start-trial', feedback)` block) and the `startTrial` function.

- [ ] **Step 5: Manual smoke (local)**

Run `npx wrangler dev --port 8787 --local`, then:
```bash
curl -s -X POST http://localhost:8787/api/start -H 'content-type: application/json' -d '{"url":"virumakupunktur.dk","email":"x@y.dk"}'    # {"ok":true}
curl -s -X POST "http://localhost:8787/api/waitlist?platform=Wix" -H 'content-type: application/json' -d '{"url":"foo.wix.com","email":"x@y.dk"}'  # {"ok":true}
```
Then open `http://localhost:8787/` in a browser, run a URL check, confirm the compatible card shows an email field and submitting flips to "Tjek din indbakke". (Email won't actually send against test Resend key — that's fine; check `wrangler dev` logs show no error.)

- [ ] **Step 6: Commit**

```bash
cd /Users/blake/Documents/geomvp
git add edge/foundbyai/src/worker.ts edge/foundbyai/public/app.js
git commit -m "feat(lp): /api/start + /api/waitlist + result-card email capture

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Re-key onboarding endpoints to slug + session; activate by slug

**Files:**
- Modify: `edge/foundbyai/src/worker.ts` (`handleExtract`, `handleConfirm`, `handleCheckout`, `handleSuccess`, `handleDnsStatus`, `activateClient`, routes)

**Interfaces:**
- Consumes: `getProduct`, `saveProduct`, `getIdentity` (lib); existing `extractContent`, `getDraft`, `sendActivationEmail`, `resolveARecord`.
- Produces: onboarding endpoints keyed by `slug` + session-gated. `activateClient(slug, env)` writes `client_token:<slug>`, `config:<slug>`, and emails a dashboard deep-link. Helper `ownsSlug(id, slug)`.

**Background:** existing handlers take `{ token }` and use `getToken/saveToken` + `TokenData`. We switch them to `{ slug }` + `getProduct/saveProduct` + session ownership. The legacy `token:`/`TokenData` functions remain in the file but are no longer routed (dead code; removed in a later cleanup). `getDraft`/draft writes switch from `draft:<token>` to `draft:<slug>`.

- [ ] **Step 1: Add an ownership helper + re-key handleExtract/handleConfirm**

Add helper above the handlers:

```ts
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
```

Replace `handleExtract` with:

```ts
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
```

Replace `handleConfirm` with:

```ts
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
```

- [ ] **Step 2: Re-key handleCheckout + handleSuccess**

Replace `handleCheckout` body (keep the Stripe params unchanged) with slug+session:

```ts
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
```

Replace `handleSuccess` with slug-based:

```ts
async function handleSuccess(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const sessionId = url.searchParams.get('session_id');
  const slug = url.searchParams.get('slug') ?? '';
  if (!sessionId || !/^[a-z0-9-]+$/.test(slug)) return html(renderErrorPage('Ugyldigt link.'), 400);
  const product = await getProduct(slug, env.DASHBOARD_KV);
  if (!product) return html(renderErrorPage('Produkt ikke fundet.'), 400);

  const stripeRes = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, {
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
  });
  const session = (await stripeRes.json()) as { status?: string; customer?: string; subscription?: string };
  if (session.status !== 'complete') return Response.redirect(`${env.SITE_URL}/app/p/${slug}/setup`, 302);

  product.status = 'trial_pending_dns';
  if (session.customer) product.stripeCustomerId = session.customer;
  if (session.subscription) product.stripeSubscriptionId = session.subscription;
  await saveProduct(product, env.DASHBOARD_KV);
  await env.DASHBOARD_KV.put(`dns_pending:${slug}`, product.domain, { expirationTtl: 7 * 24 * 3600 });
  return Response.redirect(`${env.SITE_URL}/app/p/${slug}/setup`, 302);
}
```

- [ ] **Step 3: Re-key handleDnsStatus + activateClient + checkPendingDns**

Replace `handleDnsStatus`:

```ts
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
```

Replace `activateClient` (note new signature `(slug, env)`):

```ts
async function activateClient(slug: string, env: Env) {
  const product = await getProduct(slug, env.DASHBOARD_KV);
  if (!product) return;
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
    clientToken = randomHexLocal(32);
    await env.DASHBOARD_KV.put(`client_token:${slug}`, clientToken);
  }
  await env.DASHBOARD_KV.delete(`dns_pending:${slug}`);

  const dashLink = `${env.DASHBOARD_URL}/?view=client&client=${slug}&token=${clientToken}`;
  await sendActivationEmail(product.email, product.domain, draft?.businessName ?? product.domain, env, dashLink);
}
```

Add a local random hex (or import from auth). Add import at top: append `randomHex` to the auth import and define:

```ts
function randomHexLocal(n: number): string { return randomHex(n); }
```

(Update the `lib/auth.ts` import line to include `randomHex`.)

Update `sendActivationEmail` signature to accept the dashboard link and add a button. Change its declaration to:

```ts
async function sendActivationEmail(to: string, domain: string, name: string, env: Env, dashLink: string) {
```

and inside the email HTML, add before the closing footer `<p>`:

```ts
          `<p style="margin:24px 0"><a href="${dashLink}" style="background:#587B66;color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:600">Åbn dit dashboard →</a></p>` +
```

(Insert it by concatenation into the existing template — convert the relevant template literal section to include this anchor; ensure `dashLink` is interpolated.)

Replace `checkPendingDns` body's activation call: it currently iterates `dns_pending:` keys and calls `activateClient(token, data, env)`. Change to slug-based:

```ts
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
```

- [ ] **Step 4: Update routes for slug-based dns-status**

The route `GET /api/dns-status` is unchanged in path; it now reads `?slug=`. Leave the route line as-is. The `/activate/:token` route and `handleActivatePage` stay (legacy, untouched) — they reference legacy `getToken`; that's fine, they remain compilable. **Do not delete them in this task.**

- [ ] **Step 5: Build + typecheck**

Run: `cd edge/foundbyai && npx wrangler deploy --dry-run 2>&1 | tail -5`
Expected: builds with no TS errors. (If TS complains that legacy `activateClient` callers changed — ensure the only callers are `handleDnsStatus` and `checkPendingDns`, both updated.)

- [ ] **Step 6: Commit**

```bash
cd /Users/blake/Documents/geomvp
git add edge/foundbyai/src/worker.ts
git commit -m "refactor(onboarding): re-key extract/confirm/checkout/dns to slug+session

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Setup page + `/app` routing + dashboard redirect

**Files:**
- Modify: `edge/foundbyai/src/worker.ts` (`renderActivatePage`→`renderSetupPage`, `handleSetupPage`, `handleApp`, routes)

**Interfaces:**
- Consumes: `getIdentity`, `getAccount`, `getProduct` (lib); existing `renderActivatePage` markup.
- Produces: routes `GET /app`, `GET /app/p/:slug`, `GET /app/p/:slug/setup`. Single-product accounts auto-route from `/app`.

- [ ] **Step 1: Convert the activate page to a slug-based setup page**

In `worker.ts`, change the signature `function renderActivatePage(domain: string, initialJson: string): string` to `function renderSetupPage(slug: string, domain: string, initialJson: string): string`. In its embedded client `<script>`, change the three onboarding fetch calls from token to slug:
- `fetch('/api/extract', { ... body: JSON.stringify({ token: D.token }) })` → `body: JSON.stringify({ slug: D.slug })`
- `fetch('/api/confirm', { ... body: JSON.stringify({ token: D.token, ... }) })` → `slug: D.slug, ...`
- `fetch('/api/dns-status?token=' + D.token)` → `fetch('/api/dns-status?slug=' + D.slug)`
- the checkout call (the button posting to `/api/checkout`) body → `JSON.stringify({ slug: D.slug })`

The page bootstraps `const D = <initialJson>`; ensure `initialJson` now provides `slug` instead of `token` (set in `handleSetupPage`). Also update the client status checks to use the new status names: `'paid' || 'dns_pending'` → `'trial_pending_dns'` (single value).

- [ ] **Step 2: Implement handleSetupPage + handleApp**

Add handlers:

```ts
async function handleSetupPage(req: Request, env: Env, slug: string): Promise<Response> {
  const guard = await requireOwnedProduct(req, env, slug);
  if (guard instanceof Response) {
    // Not logged in → send to login; keep it simple.
    return new Response(null, { status: 302, headers: { Location: '/login' } });
  }
  const product = guard.product;
  const draftRaw = await env.DASHBOARD_KV.get(`draft:${slug}`);
  const draft = draftRaw ? JSON.parse(draftRaw) : null;
  const initial = JSON.stringify({ slug, domain: product.domain, status: product.status, draft });
  return html(renderSetupPage(slug, product.domain, initial));
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

  if (!id.isOps && slugs.length === 1) {
    return appProductRedirect(slugs[0], env);
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

async function appProductRedirect(slug: string, env: Env): Promise<Response> {
  const product = await getProduct(slug, env.DASHBOARD_KV);
  if (product && product.status === 'active') {
    const token = await env.DASHBOARD_KV.get(`client_token:${slug}`);
    const loc = token
      ? `${env.DASHBOARD_URL}/?view=client&client=${slug}&token=${token}`
      : `${env.DASHBOARD_URL}/?view=client&client=${slug}`;
    return new Response(null, { status: 302, headers: { Location: loc } });
  }
  return new Response(null, { status: 302, headers: { Location: `/app/p/${slug}/setup` } });
}
```

> Note: `/api/auth/logout` is POST in Task 3; for the simple list link, also accept GET. In the router add a GET variant for logout (see Step 3).

- [ ] **Step 3: Wire routes**

Add to the router (before the static-asset fallthrough / 404):

```ts
    if (req.method === 'GET' && p0 === 'app' && !p1) return handleApp(req, env);
    if (req.method === 'GET' && p0 === 'app' && p1 === 'p' && parts[2] && parts[3] === 'setup')
      return handleSetupPage(req, env, parts[2]);
    if (req.method === 'GET' && p0 === 'app' && p1 === 'p' && parts[2] && !parts[3])
      return appProductRedirect(parts[2], env);
    if (req.method === 'GET' && p0 === 'api' && p1 === 'auth' && parts[2] === 'logout')
      return handleLogout(req, env); // GET convenience for the list link
```

Also update `handleActivatePage` (legacy) is left as-is. The legacy `/activate/:token` still calls `renderActivatePage` — since we renamed it, update that one call site: in `handleActivatePage`, change `renderActivatePage(data.domain, initial)` to log the user in instead. Replace `handleActivatePage` with a bridge:

```ts
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
```

This removes the only remaining caller of the renamed function and keeps legacy links working.

- [ ] **Step 4: Build + typecheck**

Run: `cd edge/foundbyai && npx wrangler deploy --dry-run 2>&1 | tail -5`
Expected: builds, no TS errors, "Read N files from the assets directory".

- [ ] **Step 5: Manual end-to-end smoke (local, with a seeded session)**

Run `npx wrangler dev --port 8787 --local`. Seed an account+product+session directly via the verify path is hard offline (email), so verify routing only:
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8787/app                      # 302 → /login (no cookie)
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8787/app/p/foo/setup          # 302 → /login (no cookie)
```
Expected: both 302. (Full authed walk-through is covered in the post-deploy verification below.)

- [ ] **Step 6: Commit**

```bash
cd /Users/blake/Documents/geomvp
git add edge/foundbyai/src/worker.ts
git commit -m "feat(app): setup page + /app routing + dashboard redirect + legacy bridge

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Migrate the existing live client + post-deploy verification

**Files:**
- Create: `edge/foundbyai/scripts/migrate-virum.md` (one-off runbook; commands only)

**Interfaces:** none (operational).

- [ ] **Step 1: Write the migration runbook**

Create `edge/foundbyai/scripts/migrate-virum.md` documenting the one-off KV writes (run with `wrangler kv key put --binding=DASHBOARD_KV` against the live namespace). Existing live client keeps legacy slug `virum`:

```md
# One-off: bring existing client + Ops into the account model

Replace EMAIL_OWNER with the client's email, OPS_EMAIL with your Ops email.

wrangler kv key put --binding=DASHBOARD_KV "account:OPS_EMAIL" '{"email":"OPS_EMAIL","isOps":true,"createdAt":"2026-06-30T00:00:00Z","productSlugs":[]}'
wrangler kv key put --binding=DASHBOARD_KV "account:EMAIL_OWNER" '{"email":"EMAIL_OWNER","isOps":false,"createdAt":"2026-06-30T00:00:00Z","productSlugs":["virum"]}'
wrangler kv key put --binding=DASHBOARD_KV "product:virum" '{"slug":"virum","domain":"virumakupunktur.dk","email":"EMAIL_OWNER","status":"active","createdAt":"2026-06-19T00:00:00Z","activatedAt":"2026-06-19T00:00:00Z"}'

# config:virum and client_token:virum already exist (dashboard reads them). Verify:
wrangler kv key get --binding=DASHBOARD_KV "config:virum"
wrangler kv key get --binding=DASHBOARD_KV "client_token:virum"
```

Note: also ensure `OPS_EMAILS` in `wrangler.toml` includes OPS_EMAIL (already set in Task 3).

- [ ] **Step 2: Deploy**

Run: `cd edge/foundbyai && npx wrangler deploy`
Expected: deploy succeeds, prints the worker URL.

- [ ] **Step 3: Live verification — auth + loop**

```bash
# Login page
curl -s -o /dev/null -w "%{http_code}\n" https://go.foundbyai.dk/login                    # 200
# Magic link request (will actually email if RESEND key is live; ok)
curl -s -X POST https://go.foundbyai.dk/api/auth/request -H 'content-type: application/json' -d '{"email":"YOUR_EMAIL"}'   # {"ok":true}
```
Then: open the emailed link → expect redirect to `/app`. As Ops, `/app` lists all `config:*` (includes `virum`). Click `virum` → 302 to the dashboard worker client view and it renders.

- [ ] **Step 4: Live verification — full self-serve (manual, browser)**

On `https://foundbyai.dk/` (once root is routed to this worker) or `https://go.foundbyai.dk/`:
1. Enter `virumakupunktur.dk` → "Klar til optimering" → enter your email → "Send mig mit login".
2. Open the login email → land on `/app/p/virumakupunktur/setup` (new product) OR if you reused an existing one, its setup.
3. Confirm info → checkout (Stripe **test** card `4242 4242 4242 4242`) → redirected back to setup at `trial_pending_dns`.
4. (DNS step only completes for a domain actually pointed at the proxy — verify the UI shows the DNS-pending state and polling works; full activation is validated on a real onboarding.)

- [ ] **Step 5: Commit the runbook**

```bash
cd /Users/blake/Documents/geomvp
git add edge/foundbyai/scripts/migrate-virum.md
git commit -m "docs(ops): runbook to migrate existing client into account model

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage (M1 scope):**
- D1 magic-link auth → Tasks 2, 3 ✓
- D2 card before DNS → preserved in re-keyed `handleCheckout`/`handleSuccess` (Task 5) ✓
- D3 email first → `/api/start` (Task 4) ✓
- §3 data model (`account`/`product`/`session`/`waitlist`) → Task 1, 2 ✓
- §4.2 routes auth/start/waitlist/app/setup → Tasks 3,4,6 ✓; **deferred to M2:** `/app/billing`, `/app/profile`, `/api/billing/portal`, styled product list, webhook churn updates (noted below).
- §4.3 activateClient writes client_token + config:slug + email link → Task 5 ✓
- §5.5 waitlist real persistence → Task 4 ✓
- §7 migration → Task 7 ✓
- §8 security (single-use token, session cookie flags, slug guard, no enumeration, 404-not-403) → Tasks 1–6 ✓

**Deferred to Milestone 2 (planned after M1 executes):** styled `/app` personal center (product cards + status badges + metrics), `/app/p/:slug` for non-active states beyond setup, `/app/billing` + Stripe Billing Portal, `/app/profile`, Stripe webhook churn → `product.status`, and updating `04-send-invites.ts` to create accounts/products when cold sending resumes. The existing `/api/webhook` continues to work on the legacy path; M2 re-keys it to slug + status updates.

**Placeholder scan:** none — every code step has complete code; manual-only verification steps (DNS activation) are explicitly marked as such.

**Type consistency:** `activateClient(slug, env)` (Task 5) matches both callers (`handleDnsStatus`, `checkPendingDns`) updated in the same task. `renderSetupPage(slug, domain, initialJson)` (Task 6) matches its only caller `handleSetupPage` and the legacy `handleActivatePage` bridge no longer calls it. `requireOwnedProduct` returns `{id, product} | Response` and every caller checks `instanceof Response`. `getIdentity(req, env)` env shape (`DASHBOARD_KV`, `OPS_EMAILS`) is satisfied by the worker `Env`.
