import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { paths, config } from './config.mjs';
import { slugify } from './store.mjs';
import { listJson, listMarkdown } from './store.mjs';

/**
 * Seed the pending queue from the bundled catalogue of real watches.
 *
 * This exists so the site can be filled with genuine content before an
 * Associates account exists, without contacting Amazon. Nothing here is
 * scraped and no price is stored: prices change, and a stale price breaches
 * the Associates terms whatever its source.
 *
 * Everything produced is a draft. The approve gate in compliance.mjs will not
 * let a record through until a human has confirmed each field against the real
 * listing, which matters more here than for ingested records: catalogue specs
 * come from general knowledge, and knowledge of a specific model reference can
 * be out of date.
 */

const RAW = JSON.parse(readFileSync(join(paths.root, 'data', 'catalogue.json'), 'utf8'));

export const catalogue = RAW.watches;

/** Stable identity for a catalogue watch, which has no ASIN to key on. */
export const catalogueKey = (entry) => `cat-${slugify(`${entry.brand}-${entry.ref}`)}`;

/** Every catalogue key already ingested, in any state. */
function usedKeys() {
  const keys = new Set();
  const add = (w) => {
    if (w.catalogue_key) keys.add(w.catalogue_key);
  };
  listJson(paths.pending).forEach(add);
  listJson(paths.rejected).forEach(add);
  listMarkdown(paths.watches).forEach(add);
  return keys;
}

export function remaining() {
  const used = usedKeys();
  return catalogue.filter((e) => !used.has(catalogueKey(e)));
}

/** A plain, untagged Amazon search for the model. Becomes a tagged link later. */
export function searchUrl(entry) {
  const q = encodeURIComponent(`${entry.brand} ${entry.model}`.trim());
  return `https://www.${config.affiliate.marketplace}/s?k=${q}`;
}

function tagsFor(entry) {
  const tags = new Set();
  if (entry.style) tags.add(entry.style);
  if (entry.movement) tags.add(entry.movement);
  if (entry.tier_hint) tags.add(entry.tier_hint);
  if (entry.brand) tags.add(slugify(entry.brand));
  const crystal = String(entry.crystal || '').toLowerCase();
  if (crystal === 'sapphire') tags.add('sapphire');
  if (crystal === 'mineral') tags.add('mineral-crystal');
  if (crystal === 'acrylic') tags.add('acrylic-crystal');
  if (entry.case_mm && entry.case_mm <= 40) tags.add('small-case');
  if (entry.water_resistance_m >= 100) tags.add('water-resistant');
  return [...tags];
}

/**
 * Turn a catalogue entry into a pending Watch.
 *
 * `asin` is deliberately empty. Inventing one would produce a link that looks
 * right and goes nowhere, which is worse than having no link at all. The
 * curator pastes the real ASIN once they have found the listing; until then
 * the site links to an Amazon search for the model.
 */
export function toPendingWatch(entry, now = new Date().toISOString()) {
  const key = catalogueKey(entry);
  // Several catalogue models already lead with the brand ("Seiko 5 SNK809"),
  // so prefixing unconditionally gives "Seiko Seiko 5 SNK809".
  const model = String(entry.model || '').trim();
  const brand = String(entry.brand || '').trim();
  const title = model.toLowerCase().startsWith(brand.toLowerCase()) ? model : `${brand} ${model}`.trim();

  const w = {
    id: `watch-${key}`,
    catalogue_key: key,
    asin: '',
    model_ref: entry.ref || '',
    title,
    full_title: title,
    brand: entry.brand,
    style: entry.style || '',
    movement: entry.movement || '',
    tier: entry.tier_hint || '',
    case_mm: typeof entry.case_mm === 'number' ? entry.case_mm : null,
    water_resistance_m: typeof entry.water_resistance_m === 'number' ? entry.water_resistance_m : null,

    source_image_url: '',
    image: '',

    // No price, on purpose. Nothing here was read off a listing at a moment in
    // time, so there is no timestamp that would make a price honest.
    price_display: '',
    price_value: null,
    price_checked_at: null,
    rating: null,
    rating_count: null,

    scraped_url: searchUrl(entry),
    source_page: 'catalogue',
    scraped_at: now,

    short_blurb: '',
    long_description: '',
    pros: [],
    cons: [],
    tags: [],
    suggested_tags: tagsFor(entry),
    featured: false,
    catalogue_confidence: entry.confidence || 'low',
    catalogue_note: entry.note || '',
    drafts: [],
    status: 'pending',
  };

  return w;
}

/** The next `size` unused catalogue entries, as pending Watch records. */
export function nextBatch(size = 10) {
  const now = new Date().toISOString();
  return remaining()
    .slice(0, Math.max(1, Math.min(size, 25)))
    .map((e) => toPendingWatch(e, now));
}

export const stats = () => {
  const used = usedKeys();
  return { total: catalogue.length, used: used.size, remaining: catalogue.length - used.size };
};
