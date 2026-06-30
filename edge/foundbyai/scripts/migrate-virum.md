**WARNING:** These commands target PRODUCTION KV. Run only after the branch is merged and the worker is deployed to production. Do not run during development. Add `--remote` to every `wrangler kv` command — without it wrangler 4 hits the local dev store, not production (verified gotcha, 2026-06-30).

# One-off: bring existing client + Ops into the account model

**Verified prod state (2026-06-30), before migration:**
- `client_token:virum` — EXISTS ✓
- `client_email:virum` — EXISTS ✓ (source the owner email from here; see below)
- `otterly_prompts:*`, `alignment:virum:*` — EXIST ✓ (dashboard data)
- `config:virum` — **DOES NOT EXIST** ✗ (the dashboard has been running on a hardcoded fallback; the new Ops `/app` lists `config:*`, so this MUST be created or virum stays invisible)
- `product:virum` — **DOES NOT EXIST** ✗ (new model)
- `account:*` — none yet

Get the real owner email first (don't guess it):
```bash
wrangler kv key get --binding=DASHBOARD_KV --remote "client_email:virum"   # -> EMAIL_OWNER
```

Then replace EMAIL_OWNER with that value and OPS_EMAIL with your Ops email (`hello.rongyi@gmail.com`):

```bash
wrangler kv key put --binding=DASHBOARD_KV --remote "account:OPS_EMAIL" '{"email":"OPS_EMAIL","isOps":true,"createdAt":"2026-06-30T00:00:00Z","productSlugs":[]}'
wrangler kv key put --binding=DASHBOARD_KV --remote "account:EMAIL_OWNER" '{"email":"EMAIL_OWNER","isOps":false,"createdAt":"2026-06-30T00:00:00Z","productSlugs":["virum"]}'
wrangler kv key put --binding=DASHBOARD_KV --remote "product:virum" '{"slug":"virum","domain":"virumakupunktur.dk","email":"EMAIL_OWNER","status":"active","createdAt":"2026-06-19T00:00:00Z","activatedAt":"2026-06-19T00:00:00Z"}'
# config:virum does NOT exist — create it (Ops /app + dashboard config read depend on it):
wrangler kv key put --binding=DASHBOARD_KV --remote "config:virum" '{"domain":"virumakupunktur.dk","activeSince":"2026-06-19T00:00:00Z"}'
```

> Note: the Ops account here also gets auto-created on first magic-link login (handleAuthVerify ensures an account), but pre-seeding it with `isOps:true` is harmless and explicit. `OPS_EMAILS` in `wrangler.toml` is the actual source of the Ops flag at runtime.

## Verification

```bash
wrangler kv key get --binding=DASHBOARD_KV --remote "product:virum"
wrangler kv key get --binding=DASHBOARD_KV --remote "config:virum"
wrangler kv key get --binding=DASHBOARD_KV --remote "client_token:virum"
```

After migration, an Ops login should list `virum` at `/app`, and `/app/p/virum` should 302 to the dashboard client view with the `client_token`.

## Additional setup

Ensure `OPS_EMAILS` in `wrangler.toml` includes OPS_EMAIL (already set: `hello.rongyi@gmail.com`).
