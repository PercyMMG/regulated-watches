import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

/**
 * Content lives in /content, outside /src, because Decap CMS and the local
 * curation dashboard both write there and neither should have to know about
 * Astro's internals.
 *
 * Only `watches` is Markdown. Everything else is machine-written JSON.
 */

const watches = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './content/watches' }),
  schema: z.object({
    id: z.string(),
    asin: z.string().regex(/^[A-Z0-9]{10}$/, 'ASIN must be 10 uppercase alphanumerics'),
    title: z.string().min(3),
    full_title: z.string().optional(),
    brand: z.string(),
    style: z.string().optional().default(''),
    movement: z.string().optional().default(''),
    tier: z.string().optional().default(''),
    case_mm: z.number().nullable().optional(),
    water_resistance_m: z.number().nullable().optional(),

    image: z.string().optional().default(''),
    source_image_url: z.string().optional().default(''),

    price_display: z.string().optional().default(''),
    price_value: z.number().nullable().optional(),
    price_checked_at: z.string().nullable().optional(),
    rating: z.number().min(0).max(5).nullable().optional(),
    rating_count: z.number().nullable().optional(),

    scraped_url: z.string().optional().default(''),
    source_page: z.string().optional().default(''),
    scraped_at: z.string().optional(),
    approved_at: z.string().optional(),

    short_blurb: z.string().min(1, 'Approved watches must carry curated text'),
    pros: z.array(z.string()).default([]),
    cons: z.array(z.string()).default([]),
    tags: z.array(z.string()).default([]),
    suggested_tags: z.array(z.string()).default([]),
    featured: z.boolean().default(false),
    drafts: z.array(z.string()).default([]),
    status: z.literal('approved'),
  }),
});

const collections_ = defineCollection({
  loader: glob({ pattern: '**/*.json', base: './content/collections' }),
  schema: z.object({
    id: z.string(),
    title: z.string(),
    slug: z.string(),
    intro_text: z.string().default(''),
    watch_ids: z.array(z.string()).default([]),
    updated_at: z.string().optional(),
  }),
});

const comparisons = defineCollection({
  loader: glob({ pattern: '**/*.json', base: './content/comparisons' }),
  schema: z.object({
    id: z.string(),
    title: z.string(),
    slug: z.string(),
    watch_a: z.string(),
    watch_b: z.string(),
    asin_a: z.string().optional(),
    asin_b: z.string().optional(),
    summary_winner: z.string().default(''),
    key_differences: z
      .array(z.object({ field: z.string(), a: z.string(), b: z.string() }))
      .default([]),
    updated_at: z.string().optional(),
  }),
});

export const collections = { watches, collections: collections_, comparisons };
