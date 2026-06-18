import type { APIRoute } from 'astro';
import businessData from '../data/business.json';
import { getCollection } from 'astro:content';

export const GET: APIRoute = async () => {
  const services = await getCollection('services');
  const activeServices = services
    .filter(s => !s.data.isEmpty)
    .sort((a, b) => a.data.order - b.data.order);

  const content = `# ${businessData.name}

> ${businessData.description}

## Ydelser (Services)
${activeServices.map(s => `- ${s.data.serviceName}: ${s.data.serviceDescription}`).join('\n')}

## Beliggenhed (Location)
${businessData.address.street}, ${businessData.address.zip} ${businessData.address.city}, ${businessData.address.country}

## Kontakt
Telefon: ${businessData.phone}
Email: ${businessData.email}
Website: ${businessData.website}
Booking: ${businessData.bookingUrl}

## Åbningstider (Opening Hours)
${businessData.hours.map(h => `${'note' in h && h.note ? `${h.day}: ${h.open}–${h.close} (${h.note})` : `${h.day}: ${h.open}–${h.close}`}`).join('\n')}

## Forsikring (Insurance)
${businessData.insurance.join(', ')}

## Om (About)
${businessData.aboutSummary}

## Certificeringer
${businessData.practitioner.credentials.join(', ')}
`;

  return new Response(content, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
