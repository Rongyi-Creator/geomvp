import type { ClientProfile, AlignmentCheckResult, NapComparison } from './types.js';
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

export async function compareNap(canonical: ClientProfile, checkResult: AlignmentCheckResult): Promise<NapComparison[]> {
  const p = checkResult.platforms;

  const prompt = `Du er en dansk SEO-specialist der verificerer NAP-konsistens (Name, Address, Phone) for en lokal virksomhed på tværs af platforme.

KANONISK DATA (dette er den korrekte version):
Navn: ${canonical.name}
Adresse: ${canonical.address.street}, ${canonical.address.zip} ${canonical.address.city}
Telefon: ${canonical.phone}

PLATFORM DATA:
Google: Navn="${p.google.name ?? 'ikke fundet'}", Adresse="${p.google.address ?? 'ikke fundet'}", Telefon="${p.google.phone ?? 'ikke fundet'}"
Trustpilot: ${p.trustpilot.exists ? 'Profil fundet' : 'Ingen profil'}
Krak: Navn="${p.krak.name ?? 'ikke fundet'}", Adresse="${p.krak.address ?? 'ikke fundet'}", Telefon="${p.krak.phone ?? 'ikke fundet'}"
De Gule Sider: Navn="${p.guleSider.name ?? 'ikke fundet'}", Adresse="${p.guleSider.address ?? 'ikke fundet'}", Telefon="${p.guleSider.phone ?? 'ikke fundet'}"

For hvert felt på hver platform (kun platforme der eksisterer), vurdér:
- "exact": Identisk med kanonisk data
- "equivalent": Semantisk identisk men formateret anderledes (f.eks. "+45 25724265" vs "+45 25 72 42 65")
- "minor_diff": Lille afvigelse der bør rettes
- "major_diff": Væsentlig afvigelse (forkert nummer, forkert adresse)
- "missing": Platform eksisterer ikke eller data ikke tilgængelig

Output KUN et JSON array:
[{ "platform": "google", "field": "phone", "canonical": "${canonical.phone}", "platformValue": "...", "match": "equivalent", "diffDescription": "...", "recommendation": "..." }]

Skriv diffDescription og recommendation på dansk. Returnér KUN JSON.`;

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '[]';
  try {
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) as NapComparison[] : [];
  } catch {
    console.error('[alignment] Claude NAP comparison parse error:', text.slice(0, 200));
    return [];
  }
}
