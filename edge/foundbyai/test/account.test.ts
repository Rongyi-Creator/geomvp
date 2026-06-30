import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemKV } from '../src/lib/kvmock.ts';
import {
  deriveSlug, getAccount, saveAccount, addProduct,
  getProduct, saveProduct, putWaitlist, citationCount, productsForIdentity, type Product,
  setSubIndex, getSlugBySub, applySubscriptionEvent,
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

import { dashboardUrl } from '../src/lib/account.ts';

test('dashboardUrl builds ops vs client URLs', () => {
  const base = 'https://dash.example';
  assert.equal(
    dashboardUrl({ base, opsToken: 'OPS', clientToken: 'CT' }, 'virum', true),
    'https://dash.example/?view=ops&client=virum&token=OPS',
  );
  assert.equal(
    dashboardUrl({ base, opsToken: 'OPS', clientToken: 'CT' }, 'virum', false),
    'https://dash.example/?view=client&client=virum&token=CT',
  );
  // client with no per-product token yet → omit token param
  assert.equal(
    dashboardUrl({ base, opsToken: 'OPS', clientToken: null }, 'virum', false),
    'https://dash.example/?view=client&client=virum',
  );
});

test('citationCount: absent key → null', async () => {
  const kv = new MemKV() as unknown as KVNamespace;
  assert.equal(await citationCount('missing-slug', kv), null);
});

test('citationCount: JSON array → length', async () => {
  const kv = new MemKV() as unknown as KVNamespace;
  await kv.put('otterly_citations:virum', JSON.stringify(['a', 'b', 'c']));
  assert.equal(await citationCount('virum', kv), 3);
});

test('citationCount: {count: n} → n', async () => {
  const kv = new MemKV() as unknown as KVNamespace;
  await kv.put('otterly_citations:virum', JSON.stringify({ count: 7 }));
  assert.equal(await citationCount('virum', kv), 7);
});

test('citationCount: {total: n} → n (when count absent)', async () => {
  const kv = new MemKV() as unknown as KVNamespace;
  await kv.put('otterly_citations:virum', JSON.stringify({ total: 12 }));
  assert.equal(await citationCount('virum', kv), 12);
});

test('citationCount: {citations: [...]} → array length (when count/total absent)', async () => {
  const kv = new MemKV() as unknown as KVNamespace;
  await kv.put('otterly_citations:virum', JSON.stringify({ citations: ['x', 'y'] }));
  assert.equal(await citationCount('virum', kv), 2);
});

test('citationCount: invalid JSON → null', async () => {
  const kv = new MemKV() as unknown as KVNamespace;
  await kv.put('otterly_citations:virum', 'not json{');
  assert.equal(await citationCount('virum', kv), null);
});

test('productsForIdentity returns own products for client, all for ops', async () => {
  const kv = new MemKV() as unknown as KVNamespace;
  await saveProduct({ slug: 'a', domain: 'a.dk', email: 'u@x.dk', status: 'active', createdAt: 'now' }, kv);
  await saveProduct({ slug: 'b', domain: 'b.dk', email: 'other@x.dk', status: 'draft', createdAt: 'now' }, kv);
  await addProduct('u@x.dk', 'a', kv);

  const client = await productsForIdentity({ email: 'u@x.dk', isOps: false }, kv);
  assert.deepEqual(client.map(p => p.slug), ['a']);

  const ops = await productsForIdentity({ email: 'admin@x.dk', isOps: true }, kv);
  assert.deepEqual(ops.map(p => p.slug).sort(), ['a', 'b']);
});

test('applySubscriptionEvent maps churn events to product status', async () => {
  const kv = new MemKV() as unknown as KVNamespace;
  await saveProduct({ slug: 'virum', domain: 'virum.dk', email: 'u@x.dk', status: 'active', createdAt: 'now', stripeSubscriptionId: 'sub_1' }, kv);
  await kv.put('config:virum', JSON.stringify({ domain: 'virum.dk' }));
  await setSubIndex('sub_1', 'virum', kv);

  assert.equal(await applySubscriptionEvent('payment_failed', 'sub_1', kv), 'virum');
  assert.equal((await getProduct('virum', kv))?.status, 'past_due');

  assert.equal(await applySubscriptionEvent('deleted', 'sub_1', kv), 'virum');
  assert.equal((await getProduct('virum', kv))?.status, 'cancelled');
  assert.equal(await kv.get('config:virum'), null); // deactivated

  assert.equal(await applySubscriptionEvent('deleted', 'sub_unknown', kv), null);
});

test('applySubscriptionEvent: recovered restores past_due→active; ignores non-past_due; deleted reaps sub-index', async () => {
  const kv = new MemKV() as unknown as KVNamespace;

  // Setup: product starts active, transitions to past_due, then recovers.
  await saveProduct({ slug: 'rec', domain: 'rec.dk', email: 'u@x.dk', status: 'active', createdAt: 'now', stripeSubscriptionId: 'sub_r1' }, kv);
  await kv.put('config:rec', JSON.stringify({ domain: 'rec.dk' }));
  await setSubIndex('sub_r1', 'rec', kv);

  await applySubscriptionEvent('payment_failed', 'sub_r1', kv);
  assert.equal((await getProduct('rec', kv))?.status, 'past_due');

  // recovered: past_due → active
  assert.equal(await applySubscriptionEvent('recovered', 'sub_r1', kv), 'rec');
  assert.equal((await getProduct('rec', kv))?.status, 'active');
  // config:rec must still exist (was never deleted on the past_due path)
  assert.notEqual(await kv.get('config:rec'), null);

  // recovered on a product NOT in past_due (e.g. draft) → status unchanged
  await saveProduct({ slug: 'newsite', domain: 'new.dk', email: 'u@x.dk', status: 'draft', createdAt: 'now', stripeSubscriptionId: 'sub_r2' }, kv);
  await setSubIndex('sub_r2', 'newsite', kv);
  assert.equal(await applySubscriptionEvent('recovered', 'sub_r2', kv), 'newsite');
  assert.equal((await getProduct('newsite', kv))?.status, 'draft');

  // deleted reaps sub-index → getSlugBySub returns null afterwards
  await applySubscriptionEvent('deleted', 'sub_r1', kv);
  assert.equal(await getSlugBySub('sub_r1', kv), null);
});
