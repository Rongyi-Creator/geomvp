// Builds the verification TODO block for Slack (slice 2). For each platform the human
// should check, gives a one-click "go look" link + the expected NAP, plus the /verify
// page link. Returned as text so run.ts can fold it into one consolidated message.
import type { ClientProfile } from './types.js';

const NAME_DA: Record<string, string> = {
  trustpilot: 'Trustpilot', krak: 'Krak.dk', guleSider: 'De Gule Sider', facebook: 'Facebook',
};

// Where the human goes to look. Trustpilot has a deterministic profile URL; Facebook a stable
// page-search; Krak/GuleSider have no clean public search URL, so scope a Google search to them.
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

export function buildTodoText(workerUrl: string, client: ClientProfile, platforms: string[]): string {
  const addr = `${client.address.street}, ${client.address.zip} ${client.address.city}`;
  const lines = platforms.map(p => `• *${NAME_DA[p] ?? p}* — tjek: ${checkUrl(p, client)}`);
  return [
    `🔍 *Verificér ${platforms.length} platform${platforms.length > 1 ? 'e' : ''}*`,
    `Forventet — navn: *${client.name}* · tlf: *${client.phone}* · adresse: *${addr}*`,
    '',
    ...lines,
    '',
    `Registrér resultat: ${workerUrl}/verify?client=${client.id}`,
  ].join('\n');
}
