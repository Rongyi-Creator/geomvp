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
