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
