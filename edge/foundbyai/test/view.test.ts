import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statusBadge, appShell, productCard } from '../src/lib/view.ts';
import type { Product } from '../src/lib/account.ts';

test('statusBadge renders a Danish label per status', () => {
  assert.match(statusBadge('active'), /Aktiv/);
  assert.match(statusBadge('draft'), /Kladde/);
  assert.match(statusBadge('content_confirmed'), /Klar til betaling/);
  assert.match(statusBadge('trial_pending_dns'), /Afventer DNS/);
});

test('appShell wraps content with noindex + title', () => {
  const out = appShell({ title: 'T', heading: 'H', body: '<p>x</p>', active: 'sites' });
  assert.match(out, /<title>T/);
  assert.match(out, /name="robots" content="noindex"/);
  assert.match(out, /<p>x<\/p>/);
});

test('productCard links to dashboard when active, setup otherwise', () => {
  const base: Product = { slug: 'virum', domain: 'virumakupunktur.dk', email: 'a@b.dk', status: 'active', createdAt: 'now' };
  assert.match(productCard('virum', base, '12 citater'), /\/app\/p\/virum"/);
  assert.match(productCard('virum', base, '12 citater'), /12 citater/);
  const draft: Product = { ...base, status: 'draft' };
  assert.match(productCard('virum', draft, null), /\/app\/p\/virum\/setup"/);
});
