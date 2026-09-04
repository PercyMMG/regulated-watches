#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config, paths } from './lib/config.mjs';
import { loadAll } from './lib/curation.mjs';
import { buildPack, packToMarkdown } from './lib/socialpack.mjs';
import { writeJson, ensureDir } from './lib/store.mjs';

/**
 * Top-5 selection and social pack generation from the command line.
 * Same engine the dashboard uses; this exists so the step can be scripted.
 */

function parseArgs(argv) {
  const args = { asins: null, title: '', start: '', suggest: false, list: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--asins') args.asins = argv[++i].split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
    else if (a === '--title') args.title = argv[++i];
    else if (a === '--start') args.start = argv[++i];
    else if (a === '--suggest') args.suggest = true;
    else if (a === '--list') args.list = true;
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

/**
 * Ranking for the --suggest shortlist.
 *
 * Every term is visible and every term comes off the record, so you can
 * argue with the ordering rather than trusting it. Nothing here is a
 * commercial signal: commission rate is not an input.
 */
function score(w) {
  const parts = [];
  const rating = typeof w.rating === 'number' ? w.rating : 0;
  const count = typeof w.rating_count === 'number' ? w.rating_count : 0;

  // Rating, damped by how many ratings back it up (100 ratings ~ half weight),
  // and measured from 4.0 rather than 0. Almost every watch on Amazon sits
  // between 4.2 and 4.8, so scoring the absolute value would swamp every other
  // term and the ranking would collapse into "sort by rating".
  const confidence = count / (count + 100);
  parts.push({
    term: 'rating',
    value: +(Math.max(0, rating - 4.0) * confidence * 10).toFixed(2),
    why: `${rating || '—'}/5 across ${count || 0} ratings`,
  });

  // Specs we can verify from the listing.
  parts.push({ term: 'water resistance', value: (w.water_resistance_m || 0) >= 100 ? 4 : 0, why: `${w.water_resistance_m ?? '—'} m` });
  parts.push({ term: 'movement', value: ['automatic', 'hand-wound', 'solar'].includes(w.movement) ? 3 : 0, why: w.movement || 'not stated' });
  parts.push({ term: 'sapphire', value: (w.tags || []).includes('sapphire') ? 3 : 0, why: (w.tags || []).includes('sapphire') ? 'stated' : 'not stated' });

  // Cheaper watches carry short-form better; the audience is buying, not admiring.
  const tierBonus = { entry: 4, core: 5, upper: 2, top: 0 }[w.tier] ?? 0;
  parts.push({ term: 'price band', value: tierBonus, why: w.tier || 'unknown' });

  // A watch with unresolved caveats is a weaker pick, not a stronger one.
  parts.push({ term: 'open caveats', value: -Math.min(3, (w.cons || []).length), why: `${(w.cons || []).length} listed` });

  const total = parts.reduce((s, p) => s + p.value, 0);
  return { total: +total.toFixed(2), parts };
}

function usage() {
  console.log(`
  Generate a social pack from approved watches.

    npm run social -- --list                       show approved watches
    npm run social -- --suggest                    rank them and show the working
    npm run social -- --asins B01,B02,B03,B04,B05 --title "Top 5 divers"

  Options
    --asins   exactly ${config.social.packSize}, comma separated, in rank order (1 first)
    --title   pack title
    --start   first posting date, YYYY-MM-DD (default: today)
    --suggest print a ranked shortlist with the score breakdown, write nothing
    --list    print approved watches, write nothing

  The pack is written to content/social/ as JSON plus a Markdown working copy.
  Nothing is posted anywhere: you upload it by hand.
`);
}

const { approved } = loadAll();
const args = parseArgs(process.argv.slice(2));

if (args.help) {
  usage();
  process.exit(0);
}

if (args.list) {
  if (!approved.length) console.log('\n  No approved watches yet. Run: npm run curate\n');
  for (const w of approved) {
    console.log(`  ${w.asin}  ${String(w.brand).padEnd(12)} ${String(w.tier || '—').padEnd(6)} ${w.title}`);
  }
  process.exit(0);
}

if (args.suggest) {
  const ranked = approved.map((w) => ({ w, s: score(w) })).sort((a, b) => b.s.total - a.s.total);
  console.log(`\n  Suggested top ${config.social.packSize}, best first. The working is shown so you can disagree with it.\n`);
  ranked.slice(0, Math.max(config.social.packSize, 8)).forEach((r, i) => {
    const marker = i < config.social.packSize ? '*' : ' ';
    console.log(`  ${marker} ${String(i + 1).padStart(2)}. ${r.w.asin}  ${r.s.total.toFixed(2).padStart(6)}  ${r.w.brand} — ${r.w.title}`);
    for (const p of r.s.parts) {
      if (p.value === 0) continue;
      const signed = `${p.value > 0 ? '+' : '-'}${Math.abs(p.value).toFixed(2)}`;
      console.log(`         ${signed.padStart(7)}  ${p.term} (${p.why})`);
    }
  });
  const picks = ranked.slice(0, config.social.packSize).map((r) => r.w.asin);
  if (picks.length === config.social.packSize) {
    console.log(`\n  To accept this ordering:\n    npm run social -- --asins ${picks.join(',')} --title "..."\n`);
  } else {
    console.log(`\n  Only ${picks.length} approved watches. A pack needs ${config.social.packSize}.\n`);
  }
  process.exit(0);
}

if (!args.asins) {
  usage();
  console.log(`  Approved watches available: ${approved.length}\n`);
  process.exit(1);
}

const chosen = args.asins.map((asin) => {
  const w = approved.find((x) => x.asin === asin);
  if (!w) {
    console.error(`\n  ${asin} is not an approved watch. Only approved watches can go in a pack.`);
    console.error('  Run "npm run social -- --list" to see what is available.\n');
    process.exit(1);
  }
  return w;
});

const pack = buildPack(chosen, { title: args.title, startDate: args.start || undefined });
ensureDir(paths.social);
writeJson(paths.social, `${pack.id}.json`, pack);
writeFileSync(join(paths.social, `${pack.id}.md`), packToMarkdown(pack), 'utf8');

console.log('');
console.log(`  Pack ${pack.id}`);
console.log(`  ${'-'.repeat(52)}`);
console.log(`  ${pack.video_scripts.length} video scripts across ${config.social.platforms.length} platforms`);
console.log(`  ${pack.image_prompts.length * 3} image prompts (backgrounds only, never the product)`);
console.log(`  ${pack.captions.length} captions, ${pack.posting_schedule.length} scheduled slots`);
console.log(`  compliance: ${pack.compliance.clean ? 'clean' : `${pack.compliance.issues.length} issue(s)`}`);
for (const i of pack.compliance.issues) console.log(`    [${i.level}] ${i.where}: ${i.detail}`);
console.log('');
console.log(`  content/social/${pack.id}.md   <- work from this one`);
console.log(`  content/social/${pack.id}.json`);
console.log('');
