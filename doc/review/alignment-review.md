# Alignment System Code Review
> 2026-06-24 · Opus 4.8 · branch: feature/clone-geo-layer

## Summary

The alignment feature has a **critical multi-tenant isolation failure**: the per-client magic-link auth gate validates a token for the client named in `?client=`, but API route handlers read the target client from the URL *path*. Any customer with a valid magic link can read, overwrite, and corrupt every other customer's data. Secondary issues: `POST /api/alignment/:client` writes to KV before validating the payload (so a malformed body can brick the dashboard), NAP scoring treats absent/unparseable data as perfect consistency (40/40), HTML scrapers correlate fields by array index producing wrong NAP data, and `updateGeoLayer` erases valid `sameAs` links on transient failures.

---

## Findings Table

| Sev | Location | Description | Fix |
|-----|----------|-------------|-----|
| CRITICAL | `worker.ts:1135-1190`, `1677-1731` | Tenant isolation bypass / IDOR. Any authenticated client can read/write all other clients' KV data via `?view=client&client=<self>` + path `clientId`. | Require ops Bearer for all `/api/*` writes; for client view, gate to matching clientId only. |
| CRITICAL | `worker.ts:1681-1690` | Write-before-validate. Raw body written to KV before fields checked → `{}` persists, dashboard 500s on render. Exploitable cross-tenant via IDOR. | Validate required fields before `put`. Make render functions defensive against missing `score`. |
| HIGH | `scoring.ts:28-34`, `compare-nap.ts:41-47` | Missing/unparseable NAP comparisons score as perfect consistency (40/40). Claude outage silently inflates score. | Treat "no data" as 0 or exclude from denominator; propagate parse failure explicitly. |
| HIGH | `krak.ts:29-43`, `gulesider.ts:32-41` | Field correlation by array index. Cards missing a field desync arrays → wrong address/phone attached to wrong company. | Parse per-card (extract fields within each card container), not flat array correlation. |
| HIGH | `krak.ts:26-46`, `gulesider.ts:25-44` | Scraper fragility → false "missing". JS-rendered / consent-walled pages return 200 with no matches → `exists:false`, client told to create a profile they already have. | Detect block/consent pages → report `unable_to_check`; validate selectors against live HTML. |
| HIGH | `update-geo-layer.ts:17-20` | Overwrites `sameAs` wholesale. Transient `unable_to_check` drops previously verified URLs — violates CLAUDE.md "保留所有外部链接". | Union with existing `sameAs`; only remove on definitive negative, never on transient failure. |
| MEDIUM | `worker.ts:1683-1689` | History append: non-atomic read-modify-write, no dedup → duplicate same-day entries possible. | Guard with idempotency on `date`; dedup before writing. |
| MEDIUM | `worker.ts:1682-1690`, `1469-1500` | No server-side score clamping. POST body `score.total` stored and rendered as-is (can be >100 or negative via IDOR). | Clamp/validate score server-side before storing. |
| MEDIUM | `compare-nap.ts:40` | `response.content[0].type` accessed outside try/catch; throws uncaught if `content` is empty. | Guard `response.content?.[0]`; default to `[]`. |
| MEDIUM | `google.ts:18-20` | No timeout on Outscraper fetch — pipeline stalls indefinitely on hung request. | Add `AbortSignal.timeout(15000)`. |
| MEDIUM | `run.ts:99-107`, `send-email.ts:64-67` | Email failure after successful dashboard push throws → CI fails → retry creates duplicate history entries. | Wrap email step in try/catch (log, don't fail run); or push to dashboard last. |
| MEDIUM | `worker.ts:1162-1176` | `client` query param used unsanitized in cookie name and `getCookie` regex. Regex-special / CRLF chars risk broken matching or header injection. | Validate `client` against `^[a-z0-9-]+$` before use in cookie names/KV keys. |
| LOW/MEDIUM | `send-email.ts:11-13` | `action_da` from Claude output interpolated into email HTML unescaped → HTML injection vector. `renderBlock6` escapes same data — inconsistent. | HTML-escape all dynamic values in email template. |
| LOW/MEDIUM | `worker.ts:1762-1768` | Welcome email fire-and-forget: `dns_ready_at` written before Resend succeeds, so transient failure = no welcome email ever sent. | Only set `dns_ready_at` after confirmed send, or add retry. |
| LOW | `worker.ts:1144,1149,1166` | Non-constant-time token compare (`===`); magic-link tokens in URL (history/referer/log leakage). | Constant-time compare; prefer POST/cookie exchange over URL tokens. |
| LOW | `worker.ts:583` | `rate` = `injected/(injected+passthrough)` → `NaN%` when both are 0 but `totalHtml > 0`. | Guard denominator. |
| LOW | `krak.ts:29`, `gulesider.ts` | `nameMatches2` variable name; unused `_searchUrl` param; `stripTags` duplicated across both scrapers. | Rename, remove unused param, extract shared util. |
| LOW | `run.ts:44` | `--run-type` value cast with `as` and no validation. | Validate against allowed union before cast. |

---

## Detailed: CRITICAL Items

### CR-01 — Cross-tenant IDOR (CRITICAL)

`checkAuth` grants access when cookie matches `client_token:<client>` for the `?client=` *query param*. It returns `null` (authorized) for any path. API handlers derive their target client from the URL *path*:

```
GET /api/alignment/bob?view=client&client=alice
```

Alice's cookie authorizes the request → Bob's data is returned. Same for `POST` (overwrite), history, exports, and every other `/api/*` route. All clients' data is accessible to any other authenticated client.

**Fix:** For `/api/*`, require ops Bearer token. For client-view dashboard GET, explicitly assert that the authenticated `client` matches the resource's `clientId`.

---

### CR-02 — Write-before-validate (CRITICAL + DoS)

```typescript
// worker.ts:1681-1690
const report = JSON.parse(body) as AlignmentReport;
await env.DASHBOARD_KV.put(`alignment:${clientId}:latest`, body);  // ← writes first
hist.history.push({ ..., total: report.score.total ... });          // ← may throw
```

`JSON.parse("{}")` succeeds. `latest` is overwritten with `{}`. Next render: `report.score` is `undefined` → throws → dashboard 500 for all views. Combined with CR-01, any client can one-request DoS any other client's dashboard.

**Fix:** Validate all required fields (generatedAt, score.total, score.grade, platforms, prioritizedActions) before any `put`. Wrap `renderGeoHealthScoreCard` to handle missing `score` gracefully.

---

## Priority Fix Order

1. **CR-01 + CR-02** (auth + write-before-validate) — must fix before any real multi-client deploy
2. **HI-04** (`sameAs` link erasure) — violates core CLAUDE.md constraint, data-loss bug
3. **HI-01** (NAP scoring with no data = perfect score) — corrupts the product's core value
4. **HI-02 + HI-03** (scraper index correlation + false missing) — fix before first real client run
5. MEDIUM items — address before production

---

*Review generated by Claude Opus 4.8*
