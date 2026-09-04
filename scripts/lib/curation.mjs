import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { config, paths } from './config.mjs';
import { listJson, listMarkdown, writeJson, writeMarkdown, removeFile, slugify, fileFor } from './store.mjs';
import { readyToApprove, priceIsFresh } from './compliance.mjs';
import { fullName } from './normalise.mjs';
import { suggestTags } from './taxonomy.mjs';
import { draftPros, draftCons, draftBlurb, draftLongDescription } from './copy.mjs';

/* ------------------------------------------------------------------ *
 * State machine
 *
 *   pending  --approve-->  approved
 *      ^                      |
 *      | restore              | unpublish
 *      |                      v
 *   rejected  <--reject--  pending
 *      |
 *      +--delete--> gone
 *
 * Each state is a directory. The file format differs by state on purpose:
 * pending and rejected are machine records (JSON), approved watches are
 * Markdown so Decap CMS can edit the body as prose.
 * ------------------------------------------------------------------ */

const FIELDS_EDITABLE = new Set([
  'title', 'brand', 'style', 'movement', 'tier', 'case_mm', 'water_resistance_m',
  'short_blurb', 'long_description', 'pros', 'cons', 'tags', 'featured', 'image',
  'price_display', 'price_value', 'price_checked_at', 'rating', 'rating_count',
]);

export function loadAll() {
  const pending = listJson(paths.pending).map(decorate);
  const approved = listMarkdown(paths.watches).map((w) => decorate({ ...w, status: 'approved' }));
  const rejected = listJson(paths.rejected).map((w) => decorate({ ...w, status: 'rejected' }));
  const collections = listJson(paths.collections);
  const comparisons = listJson(paths.comparisons);
  const social = listJson(paths.social);
  return { pending, approved, rejected, collections, comparisons, social };
}

function decorate(w) {
  const blocking = readyToApprove(w);
  return {
    ...w,
    _blocking: blocking,
    _canApprove: blocking.length === 0,
    _priceFresh: priceIsFresh(w.price_checked_at),
    _hasImage: Boolean(w.image) && existsSync(join(paths.publicImages, String(w.image).replace(/^.*[\\/]/, ''))),
  };
}

const findIn = (list, asin) => list.find((w) => String(w.asin).toUpperCase() === String(asin).toUpperCase());

export function findWatch(asin) {
  const all = loadAll();
  for (const [state, dir] of [['pending', paths.pending], ['approved', paths.watches], ['rejected', paths.rejected]]) {
    const hit = findIn(all[state === 'approved' ? 'approved' : state], asin);
    if (hit) return { watch: hit, state, dir };
  }
  return null;
}

/** Apply an edit from the dashboard. Only whitelisted fields move. */
export function saveWatch(asin, patch) {
  const found = findWatch(asin);
  if (!found) throw new Error(`No watch with ASIN ${asin}`);
  const { watch, state, dir } = found;

  const next = { ...watch };
  for (const [k, v] of Object.entries(patch || {})) {
    if (!FIELDS_EDITABLE.has(k)) continue;
    next[k] = v;
  }

  // Any field the human has now touched stops being a draft.
  const touched = Object.keys(patch || {}).filter((k) => FIELDS_EDITABLE.has(k));
  next.drafts = (watch.drafts || []).filter((d) => !touched.includes(d));

  persist(next, state, dir, watch._file);
  return decorate(next);
}

/** Clear a draft flag without changing the value: "yes, that line is fine". */
export function confirmDraft(asin, field) {
  const found = findWatch(asin);
  if (!found) throw new Error(`No watch with ASIN ${asin}`);
  const { watch, state, dir } = found;
  const next = { ...watch, drafts: (watch.drafts || []).filter((d) => d !== field) };
  persist(next, state, dir, watch._file);
  return decorate(next);
}

/** Regenerate a field from the current facts, and re-flag it as a draft. */
export function regenerate(asin, field) {
  const found = findWatch(asin);
  if (!found) throw new Error(`No watch with ASIN ${asin}`);
  const { watch, state, dir } = found;
  const next = { ...watch };

  if (field === 'pros') next.pros = draftPros(watch);
  else if (field === 'cons') next.cons = draftCons(watch);
  else if (field === 'short_blurb') next.short_blurb = draftBlurb(watch);
  else if (field === 'long_description') next.long_description = draftLongDescription(watch);
  else if (field === 'tags') next.suggested_tags = suggestTags(watch);
  else throw new Error(`Cannot regenerate "${field}"`);

  next.drafts = [...new Set([...(watch.drafts || []), field])];
  persist(next, state, dir, watch._file);
  return decorate(next);
}

function persist(watch, state, dir, oldFile) {
  const slug = slugify(watch.title);
  if (state === 'approved') {
    const name = fileFor(watch.asin, slug, 'md');
    if (oldFile && oldFile !== name) removeFile(dir, oldFile);
    const { long_description, ...fm } = watch;
    writeMarkdown(dir, name, stripInternal(fm), long_description || '');
  } else {
    const name = fileFor(watch.asin, slug, 'json');
    if (oldFile && oldFile !== name) removeFile(dir, oldFile);
    writeJson(dir, name, stripInternal(watch));
  }
}

function stripInternal(w) {
  const out = {};
  for (const [k, v] of Object.entries(w)) if (!k.startsWith('_')) out[k] = v;
  return out;
}

export function approve(asin) {
  const found = findWatch(asin);
  if (!found) throw new Error(`No watch with ASIN ${asin}`);
  if (found.state === 'approved') return decorate(found.watch);

  const blocking = readyToApprove(found.watch);
  if (blocking.length) {
    const err = new Error(`Cannot approve ${asin}: ${blocking.map((b) => b.detail).join(' ')}`);
    err.blocking = blocking;
    throw err;
  }

  const w = { ...found.watch, status: 'approved', approved_at: new Date().toISOString() };
  delete w.rejected_at;
  delete w.reject_reason;
  removeFile(found.dir, found.watch._file);

  const { long_description, ...fm } = w;
  writeMarkdown(paths.watches, fileFor(w.asin, slugify(w.title), 'md'), stripInternal(fm), long_description || '');
  return decorate(w);
}

export function reject(asin, reason = '') {
  const found = findWatch(asin);
  if (!found) throw new Error(`No watch with ASIN ${asin}`);
  if (found.state === 'rejected') return decorate(found.watch);

  const w = { ...found.watch, status: 'rejected', rejected_at: new Date().toISOString(), reject_reason: reason };
  delete w.approved_at;
  removeFile(found.dir, found.watch._file);
  writeJson(paths.rejected, fileFor(w.asin, slugify(w.title), 'json'), stripInternal(w));
  return decorate(w);
}

export function restore(asin) {
  const found = findWatch(asin);
  if (!found) throw new Error(`No watch with ASIN ${asin}`);
  const w = { ...found.watch, status: 'pending' };
  delete w.rejected_at;
  delete w.reject_reason;
  delete w.approved_at;
  removeFile(found.dir, found.watch._file);
  writeJson(paths.pending, fileFor(w.asin, slugify(w.title), 'json'), stripInternal(w));
  return decorate(w);
}

/** Permanent delete. Only ever allowed from the rejected state. */
export function destroy(asin) {
  const found = findWatch(asin);
  if (!found) throw new Error(`No watch with ASIN ${asin}`);
  if (found.state !== 'rejected') {
    throw new Error(`Refusing to delete ${asin}: it is ${found.state}. Reject it first, then delete.`);
  }
  removeFile(found.dir, found.watch._file);
  return { asin, deleted: true };
}

export function bulk(action, asins, reason = '') {
  const results = { ok: [], failed: [] };
  if (action === 'approve' && !config.curation.allowBulkApprove) {
    throw new Error('Bulk approve is disabled in site.config.json (curation.allowBulkApprove).');
  }
  if (action === 'reject' && !config.curation.allowBulkReject) {
    throw new Error('Bulk reject is disabled in site.config.json (curation.allowBulkReject).');
  }
  for (const asin of asins || []) {
    try {
      if (action === 'approve') approve(asin);
      else if (action === 'reject') reject(asin, reason);
      else if (action === 'restore') restore(asin);
      else if (action === 'delete') destroy(asin);
      else throw new Error(`Unknown bulk action "${action}"`);
      results.ok.push(asin);
    } catch (err) {
      results.failed.push({ asin, reason: err.message });
    }
  }
  return results;
}

/* ------------------------------------------------------------------ *
 * Collections
 * ------------------------------------------------------------------ */

export function saveCollection(input) {
  const slug = slugify(input.slug || input.title);
  if (!slug) throw new Error('A collection needs a title.');
  const col = {
    id: input.id || `collection-${slug}`,
    title: input.title,
    slug,
    intro_text: input.intro_text || '',
    watch_ids: [...new Set(input.watch_ids || [])],
    updated_at: new Date().toISOString(),
  };
  writeJson(paths.collections, `${slug}.json`, col);
  return col;
}

export function deleteCollection(slug) {
  removeFile(paths.collections, `${slugify(slug)}.json`);
  return { slug, deleted: true };
}

/* ------------------------------------------------------------------ *
 * Comparisons
 * ------------------------------------------------------------------ */

export function saveComparison(input) {
  const approved = listMarkdown(paths.watches);
  const a = approved.find((w) => w.id === input.watch_a || w.asin === input.watch_a);
  const b = approved.find((w) => w.id === input.watch_b || w.asin === input.watch_b);
  if (!a || !b) throw new Error('Both sides of a comparison must be approved watches.');

  const title = input.title || `${fullName(a)} vs ${fullName(b)}`.slice(0, 90);
  const slug = slugify(input.slug || `${a.brand}-vs-${b.brand}-${a.asin}-${b.asin}`);

  const cmp = {
    id: input.id || `comparison-${slug}`,
    title,
    slug,
    watch_a: a.id,
    watch_b: b.id,
    asin_a: a.asin,
    asin_b: b.asin,
    summary_winner: input.summary_winner || '',
    key_differences: input.key_differences?.length ? input.key_differences : autoDifferences(a, b),
    updated_at: new Date().toISOString(),
  };
  writeJson(paths.comparisons, `${slug}.json`, cmp);
  return cmp;
}

/** Differences we can state from stored facts alone. */
function autoDifferences(a, b) {
  const out = [];
  const cmp = (label, va, vb, fmt = (x) => String(x)) => {
    if (va == null || vb == null || va === vb) return;
    out.push({ field: label, a: fmt(va), b: fmt(vb) });
  };
  cmp('Movement', a.movement, b.movement);
  cmp('Case size', a.case_mm, b.case_mm, (x) => `${x} mm`);
  cmp('Water resistance', a.water_resistance_m, b.water_resistance_m, (x) => `${x} m`);
  cmp('Style', a.style, b.style);
  cmp('Price band', a.tier, b.tier);
  cmp('Rating', a.rating, b.rating, (x) => `${x}/5`);
  return out;
}

export function deleteComparison(slug) {
  removeFile(paths.comparisons, `${slugify(slug)}.json`);
  return { slug, deleted: true };
}
