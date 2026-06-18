import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const services = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/services' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    serviceName: z.string(),
    serviceDescription: z.string(),
    originalUrl: z.string().url().optional(),
    isEmpty: z.boolean().default(false),
    order: z.number().default(99),
  }),
});

export const collections = { services };
