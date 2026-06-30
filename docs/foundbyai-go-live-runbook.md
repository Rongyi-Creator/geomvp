# Found by AI — Go-Live Runbook & TODOs

**Last updated:** 2026-06-30 (after M2 merge, PR #3 → main `ad7f799`)
**Purpose:** Single source of "what's left before public launch." Update the status column as items close.

Legend: ✅ done · 🔧 operator action needed · ⏳ blocked on external · ☐ not started

---

## 0. Where things stand

- **Code:** M1 (account loop + LP) and M2 (styled personal center + Stripe Billing Portal + subscription churn) are merged to `main` and tests-green. Product surface lives on `foundbyai-worker` (`edge/foundbyai/`), served at **go.foundbyai.dk** (test value for `SITE_URL`).
- **One real client:** virumakupunktur.dk — live on Vercel Edge (GEO proxy), unaffected by the `/app` work.
- **Stripe:** still **test** keys/price/webhook. No paying customers yet.
- **Not yet public:** apex `foundbyai.dk` is not routed to the worker; cold emails not sent.

---

## 1. M2 deploy activation (do immediately after deploying M2)

These make the just-shipped M2 code actually work at runtime. Code being merged is NOT enough.

| # | Item | Status | Command / where |
|---|------|--------|-----------------|
| 1.1 | Deploy worker from `main` | 🔧 | `cd edge/foundbyai && wrangler deploy` |
| 1.2 | Set `DASHBOARD_TOKEN` secret (= the dashboard worker's `DASHBOARD_TOKEN` value) | 🔧 | `cd edge/foundbyai && wrangler secret put DASHBOARD_TOKEN` — **without this the Ops→`view=ops` redirect is inert** (dry-run/tsc cannot catch a missing secret; same class as M1's `env` vs `env.DASHBOARD_KV` bug) |
| 1.3 | Enable churn events on the Stripe webhook endpoint (go.foundbyai.dk/api/webhook): `customer.subscription.deleted`, `invoice.payment_failed`, `invoice.paid` — in addition to existing `checkout.session.completed` | 🔧 | Stripe Dashboard → Developers → Webhooks → (endpoint) → Update events |
| 1.4 | Browser walkthrough (the real gate — tests don't cover cross-worker cookie/redirect/styling) | ☐ | See §1a |

### 1a. Browser walkthrough checklist
- [ ] Ops login → `/app` shows **styled cards** (Geist/sage), status badges, citation metric.
- [ ] Ops clicks an active product → lands in **`view=ops`** rich dashboard (not client view), cookie sticks on the post-redirect request.
- [ ] Client login → `/app` lists **only their own** product(s).
- [ ] `/app/billing` → "Administrér" opens **Stripe Billing Portal**, returns to `/app/billing`.
- [ ] `/app/profile` shows email + working logout.
- [ ] Confirm `citationCount` renders against the **real** `otterly_citations:virum` JSON shape (tolerant parser + null fallback won't crash, but the number may be blank if the shape differs — verify with `wrangler kv key get "otterly_citations:virum" --binding DASHBOARD_KV --remote`).

> Known product gap (non-blocking, within plan scope): `past_due` recovery now handled via `invoice.paid` → back to `active`. No handling yet for plan upgrades/downgrades (only one plan exists — YAGNI).

---

## 2. Public-launch gate (apex domain + live Stripe)

| # | Item | Status | Notes |
|---|------|--------|-------|
| 2.1 | Route apex `foundbyai.dk` to `foundbyai-worker` (Cloudflare Worker Custom Domain) | ☐ | NS already on Cloudflare since 2026-06-23 |
| 2.2 | Flip `SITE_URL` from `https://go.foundbyai.dk` back to `https://foundbyai.dk` (`wrangler.toml [vars]`) + redeploy | ☐ | Magic-link / Stripe success / portal return URLs all derive from `SITE_URL` |
| 2.3 | Swap 3 Stripe secrets to **live** values: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID` | ⏳ | Blocked on business bank account; `wrangler secret put` each |
| 2.4 | Re-point / recreate the Stripe **live** webhook endpoint at the apex `/api/webhook` with the same 4 events (§1.3) | ⏳ | After 2.1 + 2.3 |
| 2.5 | Self walkthrough of the full loop with a **real inbox** on the live domain | ☐ | After 2.1–2.4 |

---

## 3. Pre-cold-email gate (legal + deliverability)

| # | Item | Status | Notes |
|---|------|--------|-------|
| 3.1 | Privacy + Terms pages (Danish) — footer links currently 404 | ☐ | Required before any cold send; `/privacy` skill exists |
| 3.2 | Resend domain verification (SPF + DKIM) for foundbyai.dk | ☐ | Required before sending |
| 3.3 | Update `scripts/marketing/04-send-invites.ts` to create `account:`/`product:` records (account model), not the legacy token flow | ☐ | A-grade leads (51) in `clients/leads/leads-scored.json` |
| 3.4 | Send first cold-email batch (A-grade) | ☐ | Gated on 3.1–3.3 + §2 live |

---

## 4. Deferred / when-scale-demands (YAGNI until then)

- Per-IP rate limit on `/api/start` (per-email 60s cooldown already exists; add IP limit if abuse observed).
- Ops `/app` list pagination (`list({prefix:'product:'})` caps at 1000 keys; ~1 client now).
- `subindex:<subId>` is reaped on cancel; no other cleanup needed.
- `/app/profile` strips email chars inline rather than using `esc()` — cosmetic, XSS-safe.

---

## Quick reference

- **Worker code:** `edge/foundbyai/src/worker.ts` (routing) · `src/lib/{auth,account,view}.ts`
- **Config:** `edge/foundbyai/wrangler.toml` (`[vars]` SITE_URL, DASHBOARD_URL, OPS_EMAILS; secrets listed in comments)
- **Shared KV:** `DASHBOARD_KV` id `76d59151b3934aa1b29306d6b6301293` (shared with dashboard worker)
- **Gotchas:** `wrangler kv` needs `--remote` to hit prod; `tsc --noEmit` (`npm run typecheck`) is the real gate, not `wrangler --dry-run` (esbuild, no typecheck).
- **Dashboard worker** (`edge/dashboard/`) ops auth: `?view=ops&client=<slug>&token=<DASHBOARD_TOKEN>` → sets `dashboard_token` cookie → redirect (`src/worker.ts:1271`).
