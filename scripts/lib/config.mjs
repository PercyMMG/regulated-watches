import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const config = JSON.parse(readFileSync(join(ROOT, 'site.config.json'), 'utf8'));

export const paths = {
  root: ROOT,
  content: join(ROOT, 'content'),
  pending: join(ROOT, 'content', 'pending'),
  watches: join(ROOT, 'content', 'watches'),
  rejected: join(ROOT, 'content', 'rejected'),
  collections: join(ROOT, 'content', 'collections'),
  comparisons: join(ROOT, 'content', 'comparisons'),
  social: join(ROOT, 'content', 'social'),
  logs: join(ROOT, config.ingestion.logDir),
  inbox: join(ROOT, 'inbox'),
  examples: join(ROOT, 'examples'),
  publicImages: join(ROOT, 'public', 'images', 'watches'),
};

export const TAG_PLACEHOLDER = 'REPLACE-ME-21';

/** Build a canonical Amazon affiliate URL. Never guesses; refuses without a real tag. */
export function affiliateLink(asin) {
  const tag = config.affiliate.associateTag;
  if (!tag || tag === TAG_PLACEHOLDER) return null;
  return config.affiliate.linkTemplate
    .replace('{marketplace}', config.affiliate.marketplace)
    .replace('{asin}', asin)
    .replace('{tag}', tag);
}

/** The plain, tag-free product URL. Safe to store at ingest time. */
export function productUrl(asin) {
  return `https://www.${config.affiliate.marketplace}/dp/${asin}`;
}

export const hasAssociateTag = () =>
  Boolean(config.affiliate.associateTag) && config.affiliate.associateTag !== TAG_PLACEHOLDER;
