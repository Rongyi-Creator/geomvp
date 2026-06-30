// Shared presentational layer for the styled personal center (/app, /app/billing, /app/profile).
import type { Product, ProductStatus } from './account.ts';

function esc(s: string): string {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
}

export const APP_CSS = `
  *,*::before,*::after{box-sizing:border-box}
  body{margin:0;font-family:'Geist',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#FAFAF8;color:#1A1A17;-webkit-font-smoothing:antialiased;line-height:1.6}
  a{color:inherit;text-decoration:none}
  .nav{display:flex;align-items:center;justify-content:space-between;padding:18px clamp(20px,5vw,48px);border-bottom:1px solid #ECEBE3}
  .nav .logo{font-weight:600;font-size:15px;letter-spacing:-0.02em}
  .nav .logo b{display:inline-block;width:5px;height:5px;background:#86AD94;transform:rotate(45deg);margin:0 7px}
  .nav .links a{font-size:14px;color:#5C5C54;margin-left:22px}
  .nav .links a.on{color:#1A1A17;font-weight:600}
  .wrap{max-width:760px;margin:0 auto;padding:48px clamp(20px,5vw,40px)}
  h1{font-size:24px;font-weight:600;letter-spacing:-0.02em;margin:0 0 28px}
  .card{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:20px 22px;background:#fff;border:1px solid #ECEBE3;border-radius:14px;margin-bottom:14px}
  .card .meta{min-width:0}
  .card .dom{font-weight:600;font-size:15px}
  .card .metric{color:#5C5C54;font-size:13px;margin-top:4px}
  .cta{padding:10px 18px;background:#587B66;color:#fff;font-weight:600;font-size:13px;border-radius:10px;white-space:nowrap}
  .cta.ghost{background:#EAF0EC;color:#456250}
  .badge{display:inline-block;padding:3px 10px;border-radius:100px;font-size:12px;font-weight:500}
  .empty{color:#5C5C54}
`;

// Typed as Record<string, ...> rather than Record<ProductStatus, ...> so that
// past_due and cancelled (added in Task 4) don't cause tsc errors against the
// current 4-value ProductStatus union. This is an intentional deviation from
// the brief's literal text.
const BADGES: Record<string, { label: string; bg: string; fg: string }> = {
  draft:             { label: 'Kladde',            bg: '#ECEBE3', fg: '#5C5C54' },
  content_confirmed: { label: 'Klar til betaling',  bg: '#EAF0EC', fg: '#456250' },
  trial_pending_dns: { label: 'Afventer DNS',       bg: '#FDF2D6', fg: '#92702A' },
  active:            { label: 'Aktiv',              bg: '#E3F0E8', fg: '#2E6B47' },
  // extended in Task 4:
  past_due:          { label: 'Betaling fejlede',   bg: '#FBE4DA', fg: '#9A4520' },
  cancelled:         { label: 'Opsagt',             bg: '#ECEBE3', fg: '#8A8A82' },
};

export function statusBadge(status: ProductStatus): string {
  const b = BADGES[status] ?? BADGES['draft']!;
  return `<span class="badge" style="background:${b.bg};color:${b.fg}">${b.label}</span>`;
}

export function productCard(slug: string, product: Product, metric: string | null): string {
  const active = product.status === 'active';
  const safeSlug = esc(slug);
  const href = active ? `/app/p/${safeSlug}` : `/app/p/${safeSlug}/setup`;
  const cta = active ? 'Åbn dashboard →' : 'Fortsæt opsætning →';
  const metricLine = metric ? `<div class="metric">${esc(metric)}</div>` : '';
  return `<div class="card"><div class="meta">
    <div class="dom">${esc(product.domain)} ${statusBadge(product.status)}</div>
    ${metricLine}
  </div><a class="cta${active ? '' : ' ghost'}" href="${href}">${cta}</a></div>`;
}

export function appShell(opts: { title: string; heading: string; body: string; active: 'sites' | 'billing' | 'profile' }): string {
  const link = (key: string, href: string, label: string) =>
    `<a href="${href}"${opts.active === key ? ' class="on"' : ''}>${label}</a>`;
  return `<!DOCTYPE html><html lang="da"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(opts.title)} — Found by AI</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>${APP_CSS}</style></head><body>
<nav class="nav"><a class="logo" href="/app">Found<b></b>by AI</a>
<div class="links">${link('sites', '/app', 'Mine websites')}${link('billing', '/app/billing', 'Abonnement')}${link('profile', '/app/profile', 'Profil')}</div></nav>
<div class="wrap"><h1>${esc(opts.heading)}</h1>${opts.body}</div></body></html>`;
}
