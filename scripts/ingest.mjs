#!/usr/bin/env node
import { readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { config, paths } from './lib/config.mjs';
import { listJson, listMarkdown, writeJson, ensureDir, slugify, fileFor } from './lib/store.mjs';
import { toPendingWatch, isAsin } from './lib/normalise.mjs';
import { suggestTags } from './lib/taxonomy.mjs';
import { draftBlurb, draftPros, draftCons } from './lib/copy.mjs';

const ADAPTERS = {
  'html-file': () => import('./adapters/html-file.mjs'),
  'asin-list': () => import('./adapters/asin-list.mjs'),
  paapi: () => import('./adapters/paapi.mjs'),
};

function parseArgs(argv) {
  const args = { adapter: config.ingestion.adapter, max: config.ingestion.maxItemsPerScrape, file: null, dir: null, sourceUrl: '', dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--adapter') args.adapter = argv[++i];
    else if (a === '--file') args.file = argv[++i];
    else if (a === '--dir') args.dir = argv[++i];
    else if (a === '--source-url') args.sourceUrl = argv[++i];
    else if (a === '--max') args.max = Math.min(Number(argv[++i]) || 0, config.ingestion.maxItemsPerScrape);
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

function usage() {
  console.log(`
  Ingest watches into content/pending/

    npm run ingest -- --file inbox/divers.html
    npm run ingest -- --dir inbox
    npm run ingest -- --adapter asin-list --file inbox/asins.txt
    npm run ingest -- --file inbox/divers.html --source-url "https://www.amazon.co.uk/s?k=dive+watch" --dry-run

  Options
    --adapter     html-file (default) | asin-list | paapi (stub)
    --file        one input file
    --dir         every .html/.txt file in a directory
    --source-url  the page the file was saved from, recorded for provenance
    --max         cap on new records this run (hard ceiling ${config.ingestion.maxItemsPerScrape})
    --dry-run     parse and report, write nothing

  How to get an input file
    1. Open an Amazon watch category or search page in your browser.
    2. Ctrl+S, save as "Webpage, HTML Only", into ./inbox/
    3. Run the command above.

  Nothing here contacts Amazon. It reads a file you already have.
`);
}

/** Every ASIN we have ever seen, in any state, so nothing is ingested twice. */
function knownAsins() {
  const known = new Map();
  for (const w of listJson(paths.pending)) if (w.asin) known.set(w.asin, 'pending');
  for (const w of listJson(paths.rejected)) if (w.asin) known.set(w.asin, 'rejected');
  for (const w of listMarkdown(paths.watches)) if (w.asin) known.set(w.asin, 'approved');
  return known;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return usage();

  const loader = ADAPTERS[args.adapter];
  if (!loader) {
    console.error(`Unknown adapter "${args.adapter}". Choose one of: ${Object.keys(ADAPTERS).join(', ')}`);
    process.exit(1);
  }
  const adapter = await loader();

  let files = [];
  if (args.file) files = [args.file];
  else if (args.dir) {
    if (!existsSync(args.dir)) {
      console.error(`Directory not found: ${args.dir}`);
      process.exit(1);
    }
    files = readdirSync(args.dir)
      .filter((f) => ['.html', '.htm', '.txt'].includes(extname(f).toLowerCase()))
      .map((f) => join(args.dir, f));
  } else {
    ensureDir(paths.inbox);
    files = readdirSync(paths.inbox)
      .filter((f) => ['.html', '.htm', '.txt'].includes(extname(f).toLowerCase()))
      .map((f) => join(paths.inbox, f));
  }

  if (files.length === 0) {
    console.error('No input files. Save an Amazon category page into ./inbox/ (Ctrl+S, "Webpage, HTML Only") and run again.');
    console.error('Run with --help for the full usage.');
    process.exit(1);
  }

  const known = knownAsins();
  const runAt = new Date().toISOString();
  const reports = [];
  let written = 0;
  let skippedKnown = 0;
  let skippedInvalid = 0;

  for (const file of files) {
    if (!existsSync(file)) {
      console.error(`  ! missing: ${file}`);
      continue;
    }
    const remaining = args.max - written;
    if (remaining <= 0) break;

    const { rows, report } = adapter.extract(file, { max: remaining, sourceUrl: args.sourceUrl });
    reports.push(report);

    for (const row of rows) {
      if (!isAsin(row.asin)) {
        skippedInvalid++;
        continue;
      }
      if (known.has(row.asin)) {
        skippedKnown++;
        continue;
      }

      const w = toPendingWatch(row, { sourceUrl: row.source_page || args.sourceUrl, scrapedAt: runAt });

      // Suggestions only. Each one is listed in `drafts` and the dashboard
      // will not let the record be approved until every draft is confirmed.
      const drafts = [];
      if (config.curation.autoTag) {
        w.suggested_tags = suggestTags(w);
        if (w.suggested_tags.length) drafts.push('tags');
      }
      if (config.curation.autoProsCons) {
        w.pros = draftPros(w);
        w.cons = draftCons(w);
        if (w.pros.length) drafts.push('pros');
        if (w.cons.length) drafts.push('cons');
      }
      w.short_blurb = draftBlurb(w);
      drafts.push('short_blurb');
      w.drafts = config.curation.autoProsConsAreDraftsOnly ? drafts : [];

      known.set(w.asin, 'pending');
      if (!args.dryRun) writeJson(paths.pending, fileFor(w.asin, slugify(w.title), 'json'), w);
      written++;
      if (written >= args.max) break;
    }
  }

  if (config.ingestion.keepRawLogs && !args.dryRun) {
    ensureDir(paths.logs);
    const logFile = join(paths.logs, `${runAt.replace(/[:.]/g, '-')}.json`);
    writeFileSync(
      logFile,
      JSON.stringify({ run_at: runAt, adapter: args.adapter, source_url: args.sourceUrl, files: files.map((f) => basename(f)), written, skippedKnown, skippedInvalid, reports }, null, 2) + '\n',
      'utf8'
    );
  }

  console.log('');
  console.log(`  Ingest  ${args.dryRun ? '(dry run) ' : ''}via ${args.adapter}`);
  console.log(`  ${'-'.repeat(52)}`);
  for (const r of reports) {
    console.log(`  ${basename(r.file)}`);
    console.log(`    product blocks found : ${r.blocks}`);
    console.log(`    rows extracted       : ${r.kept}`);
    console.log(`    field hit rate       : title ${r.fieldHits.title}, price ${r.fieldHits.price}, rating ${r.fieldHits.rating}, image ${r.fieldHits.image}`);
    const skips = Object.entries(r.skipped);
    if (skips.length) console.log(`    skipped              : ${skips.map(([k, v]) => `${k} ${v}`).join(', ')}`);
  }
  console.log(`  ${'-'.repeat(52)}`);
  console.log(`  new pending records    : ${written}`);
  console.log(`  already known (deduped): ${skippedKnown}`);
  if (skippedInvalid) console.log(`  invalid ASIN           : ${skippedInvalid}`);
  console.log('');

  if (reports.length && reports.every((r) => r.blocks === 0)) {
    console.log('  No product blocks found. Either the file is not an Amazon results page,');
    console.log('  or the markup changed. Fall back to the list adapter:');
    console.log('    npm run ingest -- --adapter asin-list --file inbox/asins.txt');
    console.log('');
  } else if (written > 0) {
    console.log('  Next: npm run curate');
    console.log('');
  }
}

main().catch((err) => {
  console.error('\n  Ingest failed:\n');
  console.error('  ' + String(err.message).split('\n').join('\n  '));
  console.error('');
  process.exit(1);
});
