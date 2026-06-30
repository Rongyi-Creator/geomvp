// Account / product data model on top of shared DASHBOARD_KV.
export type ProductStatus = 'draft' | 'content_confirmed' | 'trial_pending_dns' | 'active' | 'past_due' | 'cancelled';

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

// Reads the latest Otterly citation count for a slug from the shared KV (written
// by the dashboard worker). Tolerant of shape: array length, or {count|total}.
// Returns null when absent/unparseable so the card degrades gracefully.
export async function citationCount(slug: string, kv: KVNamespace): Promise<number | null> {
  const raw = await kv.get(`otterly_citations:${slug}`);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    if (Array.isArray(v)) return v.length;
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if (typeof o['count'] === 'number') return o['count'];
      if (typeof o['total'] === 'number') return o['total'];
      if (Array.isArray(o['citations'])) return o['citations'].length;
    }
    return null;
  } catch { return null; }
}

// Resolves the product list for an identity: all products for Ops, else the
// account's owned slugs.
export async function productsForIdentity(
  id: { email: string; isOps: boolean }, kv: KVNamespace,
): Promise<Product[]> {
  let slugs: string[];
  if (id.isOps) {
    const list = await kv.list({ prefix: 'product:' });
    slugs = list.keys.map(k => k.name.slice('product:'.length));
  } else {
    slugs = (await getAccount(id.email, kv))?.productSlugs ?? [];
  }
  const out: Product[] = [];
  for (const s of slugs) {
    const p = await getProduct(s, kv);
    if (p) out.push(p);
  }
  return out;
}

// Reverse index subscriptionId → slug, so churn webhooks (which carry only the
// Stripe subscription id) can find the product.
export async function setSubIndex(subId: string, slug: string, kv: KVNamespace): Promise<void> {
  await kv.put(`subindex:${subId}`, slug);
}
export async function getSlugBySub(subId: string, kv: KVNamespace): Promise<string | null> {
  return kv.get(`subindex:${subId}`);
}

// Applies a Stripe subscription lifecycle event to product status. Returns the
// slug touched, or null if the subscription id is unknown.
export async function applySubscriptionEvent(
  kind: 'deleted' | 'payment_failed' | 'recovered', subId: string, kv: KVNamespace,
): Promise<string | null> {
  const slug = await getSlugBySub(subId, kv);
  if (!slug) return null;
  const product = await getProduct(slug, kv);
  if (!product) return null;
  if (kind === 'deleted') {
    product.status = 'cancelled';
    await kv.delete(`config:${slug}`); // deactivate the GEO layer (dashboard stops serving)
    await kv.delete(`subindex:${subId}`); // reap the reverse-index so re-delivery stays safe
  } else if (kind === 'payment_failed') {
    product.status = 'past_due';
  } else {
    // 'recovered': only promote past_due → active; never touch other statuses.
    // config:<slug> was never deleted on the past_due path, so it already exists.
    if (product.status !== 'past_due') return slug;
    product.status = 'active';
  }
  await saveProduct(product, kv);
  return slug;
}

// Builds the dashboard-worker deep link. Ops → rich ops view authenticated by
// the master DASHBOARD_TOKEN (dashboard swaps ?token= for a cookie, worker.ts:1271).
// Client → per-product client view authenticated by client_token.
export function dashboardUrl(
  opts: { base: string; opsToken: string; clientToken: string | null },
  slug: string,
  isOps: boolean,
): string {
  if (isOps) return `${opts.base}/?view=ops&client=${slug}&token=${opts.opsToken}`;
  return opts.clientToken
    ? `${opts.base}/?view=client&client=${slug}&token=${opts.clientToken}`
    : `${opts.base}/?view=client&client=${slug}`;
}
