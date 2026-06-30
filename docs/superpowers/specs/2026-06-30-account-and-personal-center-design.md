# Account Layer, Self-Serve Trial & Personal Center — Design

**Date:** 2026-06-30
**Status:** Approved (design), pending spec review
**Scope:** Close the product loop — LP visitor → email → magic-link login → onboarding → card → DNS → live dashboard. Introduce an email-based **account** layer that powers login, self-serve checkout, a multi-product **personal center**, and the Ops super-view through one entrypoint.

---

## 1. Problem & Goal

Today the product has no concept of an **account**. All state is keyed by domain/slug
(`config:<slug>`, `client_token:<slug>`), so one person owning two sites has two
unrelated magic links, two Stripe customers, and no place to see them together.
Three concrete loop gaps exist:

1. **Self-serve checkout has no front door.** `/api/checkout` requires a pre-existing
   `content_confirmed` token that today only a cold-email send creates. An LP visitor has none.
2. **Activation never grants dashboard access.** `activateClient()` writes `config:<domain>`
   but never creates a `client_token`, and the confirmation email has no dashboard link — an
   activated customer currently cannot reach their own dashboard.
3. **Slug is inconsistent.** Dashboard reads `config:<slug>` (short, e.g. `virum`); activation
   writes `config:<domain>` (full `virumakupunktur.dk`). No canonical key ties
   `email ↔ slug ↔ domain ↔ stripeCustomer`.

**Goal:** an email-identity account layer that fixes all three, with a personal center that
gracefully spans "one product mid-onboarding" to "several live products," and folds the Ops
super-view into the same UI.

**Non-goals (YAGNI):** passwords/OAuth, self-built invoice/refund UI, team/multi-user accounts,
in-app plan upgrades/downgrades (one plan exists), org hierarchy.

---

## 2. Decisions (locked)

| # | Decision | Choice |
|---|----------|--------|
| D1 | Auth mechanism | **Passwordless email magic-link** (reuses Resend + token plumbing). Ops = `isOps` flag on the email. |
| D2 | Card timing | **After "confirm business info", before "change DNS".** `email first → card before DNS`. |
| D3 | Email capture | **Earliest, lightest** — one field on the compatibility-result card. Creates the account immediately. |
| D4 | Personal center structure | **Product list as home → click into single-product dashboard.** Billing → Stripe Portal. Ops reuses the list with `list config:*`. |

### D2 rationale (the card moment)
Two friction walls exist — entering a card, and changing the DNS A-record. The "aha" is
seeing one's own business data correctly extracted. Optimal order is `aha → card → DNS`:
don't stack both walls back-to-back. Asking for the card *after* DNS would mean giving
30 days of service with no payment method (collection risk at 199 DKK ACV); *before*
content-confirm shows no value yet. The DNS step self-selects high-intent users, so
card-required at that point doesn't crush signups — and anyone who completes DNS has already
attached a card, making trial→paid near-mechanical. This matches existing code:
`handleCheckout` already requires `content_confirmed` and `/success` already sets `dns_pending`.

### D3 rationale (email first)
Email is the lowest-friction ask and is needed anyway (magic link + confirmation mail).
Capturing it first means the account exists from second one (prerequisite for the personal
center) and every drop-off is a known, resumable account state for nurture.

### D4 rationale (list home)
A product mid-onboarding has **no dashboard to show**. A list renders it as a progress card
beside live cards with zero awkwardness; a "switcher into a dashboard" structure would land
users in an empty dashboard. The list = the account layer (`account:<email>`), dashboards =
product layer (`config:<slug>`) — structure mirrors data. Ops reuses the same list component
with the data source swapped from "my products" to "all products."

---

## 3. Data Model (Cloudflare KV, shared `DASHBOARD_KV`)

New canonical key: a **slug** derived once from the domain and used everywhere.

```
slug = domain.replace(/^www\./,'').replace(/\.(dk|com|net|...)$/,'').replace(/[^a-z0-9]+/g,'-')
       (e.g. virumakupunktur.dk → "virumakupunktur")
```

> Migration note: existing data uses `virum`. The one existing live client is migrated by
> writing alias keys (see §7). New accounts use the derived slug consistently.

| Key | Value | Owner |
|-----|-------|-------|
| `account:<email>` | `{ email, isOps, createdAt, productSlugs: string[] }` | new |
| `product:<slug>` | `{ slug, domain, email, status, stripeCustomerId?, stripeSubscriptionId?, createdAt, activatedAt? }` | new (supersedes per-token `TokenData` as source of truth) |
| `session:<sid>` | `email` (TTL 30d) | new — cookie `fbai_session` |
| `login:<loginToken>` | `email` (TTL 15m, single-use) | new — magic-link |
| `config:<slug>` | `{ domain, activeSince, ...draft }` | existing (dashboard reads this) |
| `draft:<slug>` | `DraftContent` (Claude extraction) | existing, re-keyed token→slug |
| `dns_pending:<slug>` | domain | existing, re-keyed |
| `client_token:<slug>` | per-product dashboard token | existing — still minted at activation for the dashboard worker's client auth |

`status` lifecycle: `draft → content_confirmed → trial_pending_dns → active` (plus terminal
`incompatible_waitlist`). Mirrors the existing `TokenData.status` values, re-homed onto `product:`.

**Identity resolution:** request cookie `fbai_session` → `session:<sid>` → email →
`account:<email>` → `productSlugs[]` → `product:<slug>` each. Ops email sees `list config:*`
(or an Ops index) instead of its own `productSlugs`.

---

## 4. Components & Routes

All on the existing **`foundbyai-worker`** (`edge/foundbyai/`). The dashboard worker is
unchanged except for §7 alias; the personal center **links/iframes** to it rather than
reimplementing dashboards.

### 4.1 Auth (new module: `auth.ts`)
- `getIdentity(req, env): Promise<Identity | null>` — cookie → session → account. `Identity = { email, isOps }`.
- `requireAuth(req, env)` — returns identity or a 302 to `/login`.
- Magic-link mint + verify + session create helpers.

### 4.2 Routes (added to `foundbyai-worker` fetch router)

| Method · Path | Purpose |
|---|---|
| `POST /api/auth/request` | body `{email}` → mint `login:<t>`, email magic link `https://foundbyai.dk/auth/verify?t=…`. Always 200 (no account enumeration). If no account exists yet, still send (creates on verify). |
| `GET /auth/verify?t=` | validate single-use login token → create `session:<sid>`, set `fbai_session` cookie → 302 `/app`. |
| `POST /api/auth/logout` | delete session, clear cookie → 302 `/`. |
| `GET /login` | passwordless login page (email field). *(replaces current redirect-to-dashboard stub)* |
| `GET /app` | **personal center home** — product list (own, or all if Ops). |
| `GET /app/p/:slug` | single-product view: if `active` → 302 to the dashboard worker's client view with a fresh per-product magic link (`{DASHBOARD_URL}/?view=client&client=<slug>&token=<client_token>`); else → redirect to `/app/p/:slug/setup`. Authz: slug ∈ account.productSlugs OR isOps. *(Redirect, not iframe/proxy — the dashboard worker already owns client auth + cookie; reusing it avoids reimplementing or proxying ~2300 lines. Trade-off: user briefly leaves foundbyai.dk for the dashboard origin. Acceptable; revisit with a custom domain on the dashboard if branding matters.)* |
| `GET /app/p/:slug/setup` | "Kom i gang" onboarding checklist (confirm info → card → DNS), resumes at `status`. |
| `GET /app/billing` | one row per product (status, trial days left, next charge); "Administrér" → Stripe Billing Portal. |
| `GET /app/profile` | email, language, logout. |
| `POST /api/start` | body `{url,email}` from LP result card → derive slug, create `account` (if new) + `product:<slug>` (status `draft`), kick off Claude extraction, then trigger magic link. The **closural step** D3 names. |
| `POST /api/billing/portal` | create Stripe Billing Portal session for current account's customer → `{url}`. |

### 4.3 Existing routes — changes
- `POST /api/extract`, `PUT /api/confirm`, `POST /api/checkout`, `GET /success`,
  `GET /api/dns-status` — re-keyed from `token` to `slug` + gated by session identity instead
  of a bare token. `handleCheckout` logic (trial 30d, customer_email) unchanged.
- `activateClient()` — additionally: mint `client_token:<slug>`, set `config:<slug>` (slug key,
  not domain), add dashboard deep-link to the confirmation email.
- `/activate/:token` — **kept** for in-flight cold-email links (back-compat), internally maps
  token→slug. New traffic uses `/app/p/:slug/setup`.

### 4.4 LP change (`public/index.html` + `app.js`)
The compatibility **result card** gains an inline email field:
`✓ Klar til optimering` → `[ din@email.dk ] [ Send mig mit login → ]` → `POST /api/start`
→ "Tjek din indbakke" confirmation. The incompatible card's existing waitlist email field is
unchanged. `/login` link in nav already present.

---

## 5. User Flows

### 5.1 New self-serve customer (happy path)
```
LP: enter URL → /api/check (built) → "Klar til optimering"
 → enter email → POST /api/start
     • create account:<email> (isOps=false) + product:<slug> (draft)
     • start Claude extraction → draft:<slug>
     • mint login token → Resend magic link
 → "Tjek din indbakke for dit login-link"
Email → /auth/verify → session → /app
 → product card shows "⚙ Opsætning" → /app/p/:slug/setup
     ① Bekræft virksomhedsinfo (edit draft) → PUT confirm → status content_confirmed   [AHA]
     ② Aktivér prøveperiode → /api/checkout → Stripe Checkout (card, 30d trial, no charge)  [CARD]
        → /success → status trial_pending_dns, dns_pending:<slug>
     ③ Skift DNS (guided A-record) → cron/poll detects → activateClient()  [DNS]
        → status active, client_token + config:<slug> written, confirmation email w/ dashboard link
 → /app/p/:slug now renders the live dashboard
```

### 5.2 Returning customer
`/login` → email → magic link → `/app` → list → click live product → dashboard.
Optimization: if account has exactly one product and it's `active`, `/app` may 302 straight
to `/app/p/:slug`.

### 5.3 Ops (you)
Same `/login`. Your email has `isOps:true`. `/app` lists **all** products (`list config:*` /
Ops index) with the same status badges + metrics; click any → that client's dashboard. No
separate UI. `/app/billing` and per-product authz bypass the `productSlugs` check when `isOps`.

### 5.4 Add second product (returning, logged in)
`/app` → "+ Tilføj nyt website" → same URL-check + email-skipped (already authed) → new
`product:<slug>` appended to `account.productSlugs` → setup checklist. This is the
second-conversion path the multi-product model unlocks.

### 5.5 Incompatible platform
Result card → waitlist email (existing behavior) → no account created.

---

## 6. Billing (Stripe)

- One Stripe **Customer per account email** (reuse across products via `customer_email` /
  stored `stripeCustomerId`). Each product = one **Subscription** on that customer.
- `/app/billing` is **read-only summary** rendered from `product:<slug>` records; the
  "Administrér abonnement" button calls `POST /api/billing/portal` →
  Stripe **Billing Portal** session (card change, invoices, cancel all hosted by Stripe).
- No self-built invoice/refund/dunning UI (YAGNI at 199 DKK ACV).
- Webhook (`/api/webhook`, existing) extended to update `product:<slug>.status` on
  `customer.subscription.deleted` / `invoice.payment_failed` so the list/billing reflect churn.

---

## 7. Migration (existing single client)

Existing live client uses slug `virum`, `config:virumakupunktur.dk`, and a `client_token`.
One-time backfill script/keys:
- Create `account:<owner-email>` with `productSlugs:['virum']`, `isOps:false`.
- Create `product:virum` from current `config` + Stripe IDs (if any) with `status:active`.
- Ensure `config:virum` exists (dashboard already reads slug `virum`); keep
  `config:virumakupunktur.dk` as harmless legacy or delete after verifying.
- Your Ops account: `account:<your-email>` with `isOps:true`.

New accounts use the derived slug (`virumakupunktur`); only this pre-existing record keeps
the legacy short `virum` to avoid touching working dashboard data.

---

## 8. Error Handling & Security

- **Magic-link tokens:** single-use (delete on verify), 15-min TTL, 32-byte random. No account
  enumeration — `/api/auth/request` always returns 200.
- **Sessions:** `fbai_session` cookie `HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`;
  `session:<sid>` KV with matching TTL. Logout deletes KV + clears cookie.
- **Authz:** every `/app/p/:slug*` checks `slug ∈ account.productSlugs || isOps`; mismatch → 404
  (not 403, no existence leak).
- **Stripe:** webhook signature already verified (constant-time HMAC) — unchanged.
- **Slug validation:** `^[a-z0-9-]+$` (existing dashboard guard) applied on all slug params.
- **`/api/start` abuse:** rate-limit per IP (best-effort KV counter); extraction is the only
  paid (Claude) call — guard with a short per-email cooldown.

---

## 9. Testing

- **Unit (worker, runnable):** slug derivation; `getIdentity` cookie→session→account;
  magic-link single-use (second verify fails); authz (non-owner slug → 404, Ops → ok);
  status state-machine transitions. One `*.test.ts` with `assert`, no framework.
- **Integration (local wrangler):** full §5.1 happy path with mocked Stripe/Resend/Claude
  (env stubs); returning-login; add-second-product; incompatible→waitlist (no account).
- **Manual:** Ops login lists all; client login lists only own; billing portal redirect.

---

## 10. Build Order (for the implementation plan)

1. Slug util + `account`/`product`/`session` KV helpers + migration of existing client.
2. `auth.ts`: magic-link request/verify, session, `getIdentity`/`requireAuth`; `/login` page.
3. `/api/start` + LP result-card email field (closes the loop end-to-end to "check inbox").
4. `/app` product list (own + Ops `list config:*`), status badges, metrics summary.
5. `/app/p/:slug` (active→dashboard, else→setup) + `/app/p/:slug/setup` onboarding checklist
   (re-key existing extract/confirm/checkout/dns to slug+session).
6. `activateClient()` updates (client_token + config:slug + email deep-link).
7. `/app/billing` + Stripe Billing Portal + webhook churn updates.
8. `/app/profile` + logout. Tests alongside each slice.
```
