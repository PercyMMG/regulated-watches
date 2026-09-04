#!/usr/bin/env node
import { readdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { paths } from './lib/config.mjs';
import * as curation from './lib/curation.mjs';
import { buildPack, packToMarkdown } from './lib/socialpack.mjs';
import { writeJson, ensureDir } from './lib/store.mjs';

/**
 * Populate a working demo from the bundled fixture, so the whole pipeline can
 * be seen end to end without touching Amazon.
 *
 * Every ASIN in the fixture is deliberately invalid (B0SAMPLE01...), so nothing
 * this produces can become a live affiliate link.
 *
 *   npm run demo         build the demo
 *   npm run demo -- --clear   remove it again
 */

const clearOnly = process.argv.includes('--clear');

function wipe() {
  let n = 0;
  for (const dir of [paths.pending, paths.watches, paths.rejected, paths.collections, paths.comparisons, paths.social]) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!/\.(json|md)$/.test(f)) continue;
      rmSync(join(dir, f));
      n++;
    }
  }
  if (existsSync(paths.logs)) rmSync(paths.logs, { recursive: true, force: true });
  return n;
}

const removed = wipe();

if (clearOnly) {
  console.log(`\n  Cleared ${removed} content file(s). The site will build empty.\n`);
  process.exit(0);
}

// 1. Ingest the fixture through the real pipeline.
execFileSync(
  process.execPath,
  [join(paths.root, 'scripts', 'ingest.mjs'), '--file', join(paths.examples, 'sample-amazon-results.html'), '--source-url', 'https://example.invalid/fixture'],
  { stdio: 'inherit' }
);

// 2. Curate: confirm the drafted fields, promote the suggested tags, approve.
//    A real curator rewrites the blurb here; the demo accepts the draft.
let state = curation.loadAll();
for (const w of state.pending) {
  for (const field of w.drafts || []) curation.confirmDraft(w.asin, field);
  curation.saveWatch(w.asin, { tags: w.suggested_tags || [] });
}

state = curation.loadAll();
const approvable = state.pending.filter((w) => w._canApprove);
for (const w of approvable.slice(0, 5)) curation.approve(w.asin);

// 3. Leave one in each of the other states, so every view has something in it.
state = curation.loadAll();
if (state.pending.length) curation.reject(state.pending[0].asin, 'Demo: shows the rejected queue.');

// 4. A collection, a comparison and a social pack.
state = curation.loadAll();
const divers = state.approved.filter((w) => w.style === 'diver');
if (divers.length) {
  curation.saveCollection({
    title: 'Divers worth the money',
    intro_text: 'Rotating bezel, real water resistance, and a movement you do not have to apologise for. Ordered by how little you give up.',
    watch_ids: divers.map((w) => w.id),
  });
}
if (state.approved.length >= 2) {
  curation.saveComparison({
    watch_a: state.approved[0].asin,
    watch_b: state.approved[1].asin,
    summary_winner: 'The cheaper one, unless you actually swim in it.',
  });
}
if (state.approved.length >= 5) {
  const pack = buildPack(state.approved.slice(0, 5), { title: 'Opening five' });
  ensureDir(paths.social);
  writeJson(paths.social, `${pack.id}.json`, pack);
  writeFileSync(join(paths.social, `${pack.id}.md`), packToMarkdown(pack), 'utf8');
}

const final = curation.loadAll();
console.log('');
console.log('  Demo content built from examples/sample-amazon-results.html');
console.log(`  ${'-'.repeat(52)}`);
console.log(`  approved ${final.approved.length}   pending ${final.pending.length}   rejected ${final.rejected.length}`);
console.log(`  collections ${final.collections.length}   comparisons ${final.comparisons.length}   packs ${final.social.length}`);
console.log('');
console.log('  npm run dev      see the site');
console.log('  npm run curate   see the dashboard');
console.log('  npm run demo -- --clear   remove it all again before going live');
console.log('');
