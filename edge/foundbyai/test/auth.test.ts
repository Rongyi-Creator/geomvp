import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemKV } from '../src/lib/kvmock.ts';
import { saveAccount } from '../src/lib/account.ts';
import {
  isOpsEmail, getCookie, mintLoginToken, consumeLoginToken,
  createSession, destroySession, getIdentity, sessionCookie,
} from '../src/lib/auth.ts';

test('isOpsEmail matches case-insensitively within CSV', () => {
  assert.equal(isOpsEmail('Me@Foundbyai.dk', 'me@foundbyai.dk,boss@x.dk'), true);
  assert.equal(isOpsEmail('other@x.dk', 'me@foundbyai.dk'), false);
  assert.equal(isOpsEmail('me@foundbyai.dk', ''), false);
});

test('getCookie parses a named cookie', () => {
  const req = new Request('https://x.dk', { headers: { Cookie: 'a=1; fbai_session=abc; b=2' } });
  assert.equal(getCookie(req, 'fbai_session'), 'abc');
  assert.equal(getCookie(req, 'missing'), null);
});

test('login token is single-use', async () => {
  const kv = new MemKV() as unknown as KVNamespace;
  const t = await mintLoginToken('a@b.dk', kv);
  assert.equal(await consumeLoginToken(t, kv), 'a@b.dk');
  assert.equal(await consumeLoginToken(t, kv), null); // already consumed
});

test('getIdentity resolves cookie -> session -> account, applies ops flag', async () => {
  const kv = new MemKV() as unknown as KVNamespace;
  await saveAccount({ email: 'a@b.dk', isOps: false, createdAt: 'now', productSlugs: [] }, kv);
  const sid = await createSession('a@b.dk', kv);
  const req = new Request('https://x.dk', { headers: { Cookie: sessionCookie(sid).split(';')[0] } });
  const id = await getIdentity(req, { DASHBOARD_KV: kv, OPS_EMAILS: 'a@b.dk' });
  assert.equal(id?.email, 'a@b.dk');
  assert.equal(id?.isOps, true); // from OPS_EMAILS even though stored account.isOps=false
});

test('getIdentity returns null without a valid session', async () => {
  const kv = new MemKV() as unknown as KVNamespace;
  const req = new Request('https://x.dk');
  assert.equal(await getIdentity(req, { DASHBOARD_KV: kv, OPS_EMAILS: '' }), null);
});

test('destroySession deletes the session keyed by cookie', async () => {
  const kv = new MemKV() as unknown as KVNamespace;
  const sid = await createSession('u@x.dk', kv);
  assert.equal(await kv.get(`session:${sid}`), 'u@x.dk');
  const req = new Request('https://x/', { headers: { Cookie: `fbai_session=${sid}` } });
  await destroySession(req, kv);
  assert.equal(await kv.get(`session:${sid}`), null);
});
