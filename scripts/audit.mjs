#!/usr/bin/env node
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { paths, config } from './lib/config.mjs';

/**
 * Audit the BUILT site, not the source.
 *
 * verify.mjs checks the content files; this checks what actually ships. The
 * failures that matter on an affiliate site are all things that look fine in
 * source and are wrong in dist/: a link that 404s, a page missing its
 * disclosure, an Amazon link with no tag, a price with no date.
 *
 *   npm run audit
 */

const DIST = join(paths.root, 'dist');
const BASE = '/regulated-watches';

const problems = [];
const notes = [];
const fail = (where, msg) => problems.push({ where, msg });
const note = (where, msg) => notes.push({ where, msg });

if (!existsSync(DIST)) {
  console.error('\n  No dist/. Run "npm run build" first.\n');
  process.exit(1);
}

/* ---------- collect every built page ---------- */

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const files = walk(DIST);
const pages = files.filter((f) => f.endsWith('.html'));
const assets = new Set(files.map((f) => '/' + relative(DIST, f).replace(/\\/g, '/')));

/** Does an internal href resolve to something we actually built? */
function resolves(href) {
  let p = href.split('#')[0].split('?')[0];
  if (!p.startsWith(BASE)) return false;
  p = p.slice(BASE.length) || '/';
  if (assets.has(p)) return true;
  if (assets.has(p + '/index.html')) return true;
  if (assets.has(p.replace(/\/$/, '') + '/index.html')) return true;
  if (p === '/' && assets.has('/index.html')) return true;
  return false;
}

/* ---------- per-page checks ---------- */

const AMAZON = /https:\/\/www\.amazon\.[a-z.]+\/[^"']*/g;
let pagesWithBuyLink = 0;
let taggedLinks = 0;
let untaggedLinks = 0;

for (const file of pages) {
  const rel = '/' + relative(DIST, file).replace(/\\/g, '/');
  const html = readFileSync(file, 'utf8');

  // 1. internal links must resolve
  for (const m of html.matchAll(/href="([^"]+)"/g)) {
    const href = m[1];
    if (/^(https?:|mailto:|#|data:)/.test(href)) continue;
    if (!resolves(href)) fail(rel, `dead internal link: ${href}`);
  }

  // 2. scripts and images must resolve
  for (const m of html.matchAll(/src="([^"]+)"/g)) {
    const src = m[1];
    if (/^(https?:|data:)/.test(src)) continue;
    if (!resolves(src)) fail(rel, `missing asset: ${src}`);
  }

  // 3. every page carries the affiliate disclosure
  if (!/As an Amazon Associate/i.test(html)) {
    fail(rel, 'no affiliate disclosure in the page');
  }

  // 4. Amazon links: tagged consistently, and marked sponsored when tagged
  const amazonLinks = [...html.matchAll(AMAZON)].map((m) => m[0]);
  if (amazonLinks.length) pagesWithBuyLink++;
  for (const url of amazonLinks) {
    const tagged = /[?&]tag=/.test(url);
    tagged ? taggedLinks++ : untaggedLinks++;
  }
  for (const m of html.matchAll(/<a class="buy[^"]*"[^>]*>/g)) {
    const a = m[0];
    const hrefMatch = /href="([^"]+)"/.exec(a);
    if (!hrefMatch) continue;
    const tagged = /[?&]tag=/.test(hrefMatch[1]);
    const sponsored = /rel="[^"]*sponsored/.test(a);
    if (tagged && !sponsored) fail(rel, 'tagged Amazon link without rel="sponsored" (undisclosed paid link)');
    if (!tagged && sponsored) fail(rel, 'rel="sponsored" on a link that earns nothing (inaccurate)');
    if (!/target="_blank"/.test(a)) note(rel, 'buy link does not open in a new tab');
    if (/target="_blank"/.test(a) && !/noopener/.test(a)) fail(rel, 'target="_blank" without noopener');
  }

  // 5. a rendered price must carry a timestamp the browser can re-check
  for (const m of html.matchAll(/<span class="price"[^>]*>/g)) {
    const span = m[0];
    if (!/data-price/.test(span)) continue;
    if (!/data-checked-at="[^"]+"/.test(span)) fail(rel, 'price rendered with no data-checked-at; it can never expire');
  }

  // 6. an image must carry its credit
  for (const m of html.matchAll(/<img[^>]+src="([^"]*\/images\/watches\/[^"]+)"/g)) {
    if (rel.includes('/watches/') && !/img-credit/.test(html)) {
      fail(rel, `photo ${m[1]} rendered with no visible credit`);
    }
  }

  // 7. canonical must point at the real site
  const canonical = /<link rel="canonical" href="([^"]+)"/.exec(html);
  if (!canonical) note(rel, 'no canonical tag');
  else if (!canonical[1].startsWith(config.url.replace(/\/$/, ''))) {
    fail(rel, `canonical points elsewhere: ${canonical[1]}`);
  }

  // 8. nothing should reference a host we do not control
  if (/regulated\.pages\.dev/.test(html)) fail(rel, 'references regulated.pages.dev, which is not our domain');
}

/* ---------- site-wide checks ---------- */

if (!existsSync(join(DIST, '.nojekyll'))) {
  fail('site', '.nojekyll missing — GitHub Pages will strip /_astro/ and the site will load unstyled');
}
if (!existsSync(join(DIST, 'sitemap-index.xml'))) {
  fail('site', 'robots.txt advertises a sitemap that was not generated');
}
const robots = existsSync(join(DIST, 'robots.txt')) ? readFileSync(join(DIST, 'robots.txt'), 'utf8') : '';
const sitemapUrl = /Sitemap:\s*(\S+)/.exec(robots)?.[1];
if (sitemapUrl && !sitemapUrl.startsWith(config.url.replace(/\/$/, ''))) {
  fail('robots.txt', `sitemap URL does not match site.url: ${sitemapUrl}`);
}
if (existsSync(join(DIST, 'curate')) || existsSync(join(DIST, 'curate.html'))) {
  fail('site', 'the curation dashboard is present in the build — it must never deploy');
}

/* ---------- report ---------- */

console.log('');
console.log(`  Audit — ${pages.length} built pages`);
console.log(`  ${'-'.repeat(56)}`);
console.log(`  pages with an Amazon link : ${pagesWithBuyLink}`);
console.log(`  Amazon links tagged       : ${taggedLinks}`);
console.log(`  Amazon links untagged     : ${untaggedLinks}${untaggedLinks && !taggedLinks ? '  (expected: no Associates tag set yet)' : ''}`);
console.log('');

if (notes.length) {
  console.log(`  ${notes.length} note(s)`);
  for (const n of notes.slice(0, 10)) console.log(`    - ${n.where}: ${n.msg}`);
  if (notes.length > 10) console.log(`    …and ${notes.length - 10} more`);
  console.log('');
}

if (problems.length) {
  // Group: one dead link repeated across 30 pages is one problem, not thirty.
  const grouped = new Map();
  for (const p of problems) {
    if (!grouped.has(p.msg)) grouped.set(p.msg, []);
    grouped.get(p.msg).push(p.where);
  }
  console.log(`  ${grouped.size} distinct problem(s) across ${problems.length} occurrence(s)`);
  for (const [msg, where] of grouped) {
    console.log(`    ! ${msg}`);
    console.log(`      on ${where.length} page(s), e.g. ${where[0]}`);
  }
  console.log('');
  process.exit(1);
}

console.log('  No problems found in the built site.');
console.log('');
