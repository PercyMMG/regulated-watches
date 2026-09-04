#!/usr/bin/env node
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { config, paths, hasAssociateTag, TAG_PLACEHOLDER } from './lib/config.mjs';
import { listJson, listMarkdown } from './lib/store.mjs';
import { readyToApprove, lintCopy, priceIsFresh } from './lib/compliance.mjs';

/**
 * Pre-flight check. Run before every deploy.
 *
 * These are the failures that are expensive on a live affiliate site:
 * an untagged link earns nothing, a stale price breaches the Associates
 * terms, a half-curated record makes the site look automated.
 */

/** Any real tag, plus bare angle brackets that could open one. */
const DANGEROUS_MARKUP = /<\s*\/?\s*[a-zA-Z][^>]*>|<\s*script|javascript:\s*/i;

const errors = [];
const warns = [];
const err = (where, msg) => errors.push(`${where}: ${msg}`);
const warn = (where, msg) => warns.push(`${where}: ${msg}`);

/* ---- configuration ---- */

if (!hasAssociateTag()) {
  warn('config', `affiliate.associateTag is still "${TAG_PLACEHOLDER}". Links render as ordinary untagged Amazon links, so the site is publishable but earns nothing.`);
}
if (!/^https:\/\//.test(config.url)) err('config', 'site.url must be an https URL; it is used for canonical tags.');
if (config.price.maxAgeHours > 24) {
  err('config', `price.maxAgeHours is ${config.price.maxAgeHours}. The Associates terms require 24 or less.`);
}

/* ---- watches ---- */

const approved = listMarkdown(paths.watches);
const pending = listJson(paths.pending);
const rejected = listJson(paths.rejected);

const seen = new Map();
for (const [state, list] of [['approved', approved], ['pending', pending], ['rejected', rejected]]) {
  for (const w of list) {
    if (w._error) err(w._file, w._error);
    // Catalogue-seeded watches have no ASIN; they are keyed by catalogue_key.
    const key = w.asin || w.catalogue_key || w.id;
    if (!key) { err(w._file, 'no ASIN, catalogue key or id - nothing identifies this record'); continue; }
    if (seen.has(key)) err(key, `appears twice: ${seen.get(key)} and ${state}`);
    else seen.set(key, state);
  }
}

let stalePrices = 0;
let missingImages = 0;

for (const w of approved) {
  const where = w._file;
  for (const issue of readyToApprove(w)) err(where, issue.detail);

  if (w.status !== 'approved') err(where, `status is "${w.status}", expected "approved"`);

  for (const issue of lintCopy(w.short_blurb, { context: 'short_blurb' })) {
    (issue.level === 'error' ? err : warn)(where, `short_blurb — ${issue.detail}`);
  }
  if (!w.pros?.length && !w.cons?.length) warn(where, 'no pros or cons; the page will read thin.');

  if (w.price_display && !priceIsFresh(w.price_checked_at)) stalePrices++;
  if (w.price_display && !w.price_checked_at) err(where, 'has a price with no price_checked_at timestamp.');

  if (config.images.mode !== 'placeholder') {
    if (!w.image) missingImages++;
    else if (!existsSync(join(paths.publicImages, String(w.image).replace(/^.*[\\/]/, '')))) {
      err(where, `image "${w.image}" is not in public/images/watches/`);
    }
  }
  // A CC image without a rendered credit breaches its licence. This is the
  // gate that stops one shipping.
  if (w.image && !w.image_credit_author) {
    err(where, 'has an image but no image_credit_author. A CC-licensed image must be attributed, or removed.');
  }
  if (w.image && w.image_credit_licence && /-nc|-nd|non-?commercial/i.test(w.image_credit_licence)) {
    err(where, `image licence "${w.image_credit_licence}" forbids commercial use. This site carries affiliate links; remove the image.`);
  }

  if (w.source_image_url && w.image && w.image === w.source_image_url) {
    err(where, 'image points at the Amazon listing URL. Hotlinking listing images is not permitted outside PA-API.');
  }

  // Astro renders a watch's Markdown body as raw HTML. Ingested fields are
  // stripped of markup at the boundary, but a curator can still paste a tag in
  // by hand, so the deploy is gated here as well. No page on this site needs
  // raw HTML in its body.
  for (const [field, value] of [
    ['long_description', w.long_description],
    ['short_blurb', w.short_blurb],
    ...(w.pros || []).map((p, i) => [`pros[${i}]`, p]),
    ...(w.cons || []).map((c, i) => [`cons[${i}]`, c]),
  ]) {
    const s = String(value || '');
    if (DANGEROUS_MARKUP.test(s)) {
      err(where, `${field} contains HTML markup, which is rendered raw. Remove the tag.`);
    }
  }
}

if (stalePrices) {
  warn('prices', `${stalePrices} approved watch(es) have a price older than ${config.price.maxAgeHours}h. They will render as "${config.price.staleLabel}". Re-ingest to refresh.`);
}
if (missingImages) warn('images', `${missingImages} approved watch(es) have no local image while images.mode is "${config.images.mode}".`);

/* ---- collections and comparisons ---- */

const ids = new Set(approved.map((w) => w.id));
for (const c of listJson(paths.collections)) {
  if (c._error) { err(c._file, c._error); continue; }
  if (!c.slug) err(c._file, 'no slug');
  const dead = (c.watch_ids || []).filter((id) => !ids.has(id));
  if (dead.length) warn(c._file, `${dead.length} watch id(s) no longer approved; they are skipped at build: ${dead.join(', ')}`);
  if ((c.watch_ids || []).length === 0) warn(c._file, 'empty collection; the page will render with no cards.');
}
for (const c of listJson(paths.comparisons)) {
  if (c._error) { err(c._file, c._error); continue; }
  for (const side of ['watch_a', 'watch_b']) {
    if (!ids.has(c[side])) warn(c._file, `${side} (${c[side]}) is not approved; this comparison page will not be built.`);
  }
}

/* ---- social packs ---- */

for (const p of listJson(paths.social)) {
  if (p._error) { err(p._file, p._error); continue; }
  if (p.compliance && !p.compliance.clean) {
    warn(p._file, `${p.compliance.issues.length} unresolved compliance issue(s) in this pack.`);
  }
  const missing = (p.selected_watch_ids || []).filter((id) => !ids.has(id));
  if (missing.length) warn(p._file, `references ${missing.length} watch(es) that are no longer approved.`);
}

/* ---- required site furniture ---- */

for (const f of ['public/price-guard.js', 'public/_headers', 'public/robots.txt', 'src/pages/disclosure.astro']) {
  if (!existsSync(join(paths.root, f))) err('site', `${f} is missing.`);
}
if (existsSync(paths.inbox) && readdirSync(paths.inbox).length) {
  warn('inbox', 'Saved Amazon pages are still in inbox/. They are gitignored, but delete them when done.');
}

/* ---- report ---- */

console.log('');
console.log(`  Verify — ${config.brand}`);
console.log(`  ${'-'.repeat(52)}`);
console.log(`  approved ${approved.length}   pending ${pending.length}   rejected ${rejected.length}`);
console.log('');

if (warns.length) {
  console.log(`  ${warns.length} warning(s)`);
  for (const w of warns) console.log(`    - ${w}`);
  console.log('');
}
if (errors.length) {
  console.log(`  ${errors.length} error(s)`);
  for (const e of errors) console.log(`    ! ${e}`);
  console.log('');
  console.log('  Not safe to deploy. Fix the errors above.');
  console.log('');
  process.exit(1);
}

console.log(`  No errors.${warns.length ? ' Warnings above are advisory.' : ''}`);
console.log('');
