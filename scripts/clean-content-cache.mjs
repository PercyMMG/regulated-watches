#!/usr/bin/env node
import { rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { paths } from './lib/config.mjs';

/**
 * Runs automatically before `npm run build` (npm's `prebuild` hook).
 *
 * Astro 5 keeps its content-layer store at node_modules/.astro/data-store.json,
 * and that file outlives `rm -rf .astro`. If a watch is unpublished — rejected,
 * or deleted outright — and the store still holds the old entry, the build
 * happily renders a page for content that no longer exists on disk.
 *
 * On this site that failure is not cosmetic: unpublishing is how a watch comes
 * down, so a stale store means a watch you took down stays live. Clearing the
 * store costs about a second and removes the whole class of problem.
 *
 * A fresh CI checkout is unaffected (empty node_modules), but local builds and
 * any environment that caches node_modules are exactly where this bites.
 */

const targets = [
  join(paths.root, 'node_modules', '.astro', 'data-store.json'),
  join(paths.root, '.astro', 'data-store.json'),
];

let cleared = 0;
for (const t of targets) {
  if (!existsSync(t)) continue;
  rmSync(t, { force: true });
  cleared++;
}

if (process.env.VERBOSE) {
  console.log(cleared ? `  Cleared ${cleared} stale content store(s).` : '  No content store to clear.');
}
