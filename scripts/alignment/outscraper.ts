// Shared Outscraper client using the async submit→poll pattern.
//
// Sync mode (async=false) reliably times out on heavy queries (maps/search) and
// under concurrency — Outscraper queues simultaneous sync connections and the
// 4 parallel platform checks blew past 60s. The documented robust pattern is to
// submit async (returns {status:Pending, results_location}) then poll until Success.
//
// Returns the top-level `data` array. Shape differs per endpoint:
//   /maps/search    → data[0] is an array of place objects
//   /google-search  → data[0] is { query, organic_results: [...] }
const BASE = 'https://api.outscraper.com';

// Retries once on failure — Outscraper's per-account queue is sometimes congested
// and a poll times out even though a fresh submit succeeds (this caused Google maps
// and De Gule Sider to intermittently fail). Applies to all endpoints.
export async function outscraperRequest(
  path: string,
  params: Record<string, string>,
  { timeoutMs = 180000, pollMs = 3000, retries = 1 }: { timeoutMs?: number; pollMs?: number; retries?: number } = {},
): Promise<unknown[]> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await submitAndPoll(path, params, timeoutMs, pollMs);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

async function submitAndPoll(path: string, params: Record<string, string>, timeoutMs: number, pollMs: number): Promise<unknown[]> {
  const apiKey = process.env.OUTSCRAPER_API_KEY;
  if (!apiKey) throw new Error('OUTSCRAPER_API_KEY not set');

  const qs = new URLSearchParams({ ...params, async: 'true' });
  const submit = await fetch(`${BASE}${path}?${qs}`, {
    headers: { 'X-API-KEY': apiKey },
    signal: AbortSignal.timeout(20000),
  });
  if (!submit.ok) throw new Error(`Outscraper submit ${submit.status}`);

  const job = await submit.json() as { status?: string; data?: unknown[]; results_location?: string };
  if (job.status === 'Success' && Array.isArray(job.data)) return job.data; // occasionally returned inline
  if (!job.results_location) throw new Error('Outscraper: no results_location');

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, pollMs));
    const poll = await fetch(job.results_location, { headers: { 'X-API-KEY': apiKey }, signal: AbortSignal.timeout(20000) });
    if (!poll.ok) continue; // transient — keep polling
    const res = await poll.json() as { status?: string; data?: unknown[] };
    if (res.status === 'Success') return res.data ?? [];
    if (res.status && res.status !== 'Pending') throw new Error(`Outscraper job status: ${res.status}`);
  }
  throw new Error('Outscraper: poll timeout');
}

// Convenience for /google-search: returns the organic_results of the first query.
export async function googleSearch(
  query: string,
  opts?: { limit?: string; language?: string },
): Promise<Array<{ link?: string; title?: string; description?: string }>> {
  const data = await outscraperRequest('/google-search', {
    query, limit: opts?.limit ?? '3', language: opts?.language ?? 'da',
  });
  return (data[0] as { organic_results?: Array<{ link?: string; title?: string; description?: string }> })?.organic_results ?? [];
}
