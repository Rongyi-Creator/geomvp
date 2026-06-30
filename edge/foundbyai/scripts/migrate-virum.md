**WARNING:** These commands target PRODUCTION KV. Run only after the branch is merged and the worker is deployed to production. Do not run during development.

# One-off: bring existing client + Ops into the account model

Replace EMAIL_OWNER with the client's email, OPS_EMAIL with your Ops email.

```bash
wrangler kv key put --binding=DASHBOARD_KV "account:OPS_EMAIL" '{"email":"OPS_EMAIL","isOps":true,"createdAt":"2026-06-30T00:00:00Z","productSlugs":[]}'
wrangler kv key put --binding=DASHBOARD_KV "account:EMAIL_OWNER" '{"email":"EMAIL_OWNER","isOps":false,"createdAt":"2026-06-30T00:00:00Z","productSlugs":["virum"]}'
wrangler kv key put --binding=DASHBOARD_KV "product:virum" '{"slug":"virum","domain":"virumakupunktur.dk","email":"EMAIL_OWNER","status":"active","createdAt":"2026-06-19T00:00:00Z","activatedAt":"2026-06-19T00:00:00Z"}'
```

## Verification

`config:virum` and `client_token:virum` already exist (dashboard reads them). Verify:

```bash
wrangler kv key get --binding=DASHBOARD_KV "config:virum"
wrangler kv key get --binding=DASHBOARD_KV "client_token:virum"
```

## Additional setup

Ensure `OPS_EMAILS` in `wrangler.toml` includes OPS_EMAIL (already set in Task 3).
