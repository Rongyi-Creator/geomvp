// Slack TODO for human verification (slice 2). For each platform automated detection
// couldn't confirm, gives a one-click "go check" link + the expected NAP values, plus a
// link to the dashboard /verify page where the human records the verdict.
import type { ClientProfile } from './types.js';

const NAME_DA: Record<string, string> = {
  trustpilot: 'Trustpilot', krak: 'Krak.dk', guleSider: 'De Gule Sider', facebook: 'Facebook',
};

// Where the human goes to look. Trustpilot has a deterministic profile URL; Facebook has a
// stable page-search; Krak/GuleSider have no clean public search URL, so scope a Google
// search to their domain (reliably surfaces a listing if one exists).
function checkUrl(platform: string, client: ClientProfile): string {
  const domain = client.domain.replace(/^www\./, '');
  const q = (s: string) => encodeURIComponent(s);
  switch (platform) {
    case 'trustpilot': return `https://www.trustpilot.com/review/${domain}`;
    case 'facebook':   return `https://www.facebook.com/search/pages?q=${q(client.name)}`;
    case 'krak':       return `https://www.google.com/search?q=${q(`${client.name} site:krak.dk`)}`;
    case 'guleSider':  return `https://www.google.com/search?q=${q(`${client.name} site:degulesider.dk`)}`;
    default:           return '';
  }
}

export async function postVerificationTodo(
  webhookUrl: string,
  workerUrl: string,
  client: ClientProfile,
  platforms: string[],
): Promise<void> {
  const addr = `${client.address.street}, ${client.address.zip} ${client.address.city}`;
  const lines = platforms.map(p => `• *${NAME_DA[p] ?? p}* — tjek: ${checkUrl(p, client)}`);
  const text = [
    `🔍 *Alignment-verifikation* for *${client.name}* (${platforms.length} platform${platforms.length > 1 ? 'e' : ''})`,
    `Forventet — navn: *${client.name}* · tlf: *${client.phone}* · adresse: *${addr}*`,
    '',
    ...lines,
    '',
    `Registrér resultat (findes / findes ikke / afviger): ${workerUrl}/verify?client=${client.id}`,
  ].join('\n');

  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
}
