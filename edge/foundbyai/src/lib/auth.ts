import { getAccount } from './account.ts';

export interface Identity { email: string; isOps: boolean }

const SESSION_TTL = 2592000; // 30 days
const LOGIN_TTL = 900;       // 15 min

export function randomHex(bytes: number): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return [...a].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function isOpsEmail(email: string, opsCsv: string): boolean {
  const set = (opsCsv || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  return set.includes(email.trim().toLowerCase());
}

export function getCookie(req: Request, name: string): string | null {
  const cookies = req.headers.get('Cookie') || '';
  const m = cookies.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return m ? m[1] : null;
}

export function sessionCookie(sid: string): string {
  return `fbai_session=${sid}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL}`;
}
export function clearCookie(): string {
  return `fbai_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export async function mintLoginToken(email: string, kv: KVNamespace): Promise<string> {
  const t = randomHex(32);
  await kv.put(`login:${t}`, email, { expirationTtl: LOGIN_TTL });
  return t;
}

export async function consumeLoginToken(token: string, kv: KVNamespace): Promise<string | null> {
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const email = await kv.get(`login:${token}`);
  if (!email) return null;
  await kv.delete(`login:${token}`); // single-use
  return email;
}

export async function createSession(email: string, kv: KVNamespace): Promise<string> {
  const sid = randomHex(32);
  await kv.put(`session:${sid}`, email, { expirationTtl: SESSION_TTL });
  return sid;
}

export async function getIdentity(
  req: Request,
  env: { DASHBOARD_KV: KVNamespace; OPS_EMAILS: string },
): Promise<Identity | null> {
  const sid = getCookie(req, 'fbai_session');
  if (!sid) return null;
  const email = await env.DASHBOARD_KV.get(`session:${sid}`);
  if (!email) return null;
  const acc = await getAccount(email, env.DASHBOARD_KV);
  const isOps = isOpsEmail(email, env.OPS_EMAILS) || !!acc?.isOps;
  return { email, isOps };
}

export async function destroySession(req: Request, kv: KVNamespace): Promise<void> {
  const sid = getCookie(req, 'fbai_session');
  if (sid) await kv.delete(`session:${sid}`);
}
