import { config } from './config.mjs';
import { listMarkdown } from './store.mjs';
import { paths } from './config.mjs';
import { listJson, slugify } from './store.mjs';
import { fullName } from './normalise.mjs';
import { tierById } from './taxonomy.mjs';
import { styleNounPlural } from './copy.mjs';

/**
 * Suggest the pages that can actually rank.
 *
 * A watch page of 120 words does not appear in search results on a new
 * domain. Comparisons and collections do: they answer a query someone
 * actually types ("seiko 5 vs orient kamasu", "best diver under £250"), they
 * carry real length, and they link internally to the watch pages, which is
 * how those get crawled at all.
 *
 * This proposes them. It does not write them - the verdict and the intro are
 * the parts with editorial value, and they are the parts a human must supply.
 */

const TIER_ORDER = config.taxonomy.tiers.map((t) => t.id);
const tierIndex = (id) => TIER_ORDER.indexOf(id);

const approved = () => listMarkdown(paths.watches);

/* ------------------------------------------------------------------ *
 * Comparisons
 * ------------------------------------------------------------------ */

/** Facts on which two watches genuinely differ. An identical pair is a dull page. */
function differences(a, b) {
  const out = [];
  const cmp = (field, va, vb, fmt = (x) => String(x)) => {
    if (va == null || vb == null || va === vb) return;
    out.push({ field, a: fmt(va), b: fmt(vb) });
  };
  cmp('Movement', a.movement, b.movement);
  cmp('Case size', a.case_mm, b.case_mm, (x) => `${x} mm`);
  cmp('Water resistance', a.water_resistance_m, b.water_resistance_m, (x) => `${x} m`);
  cmp('Price band', a.tier, b.tier, (x) => tierById(x)?.title ?? x);

  const crystal = (w) => (w.tags || []).includes('sapphire') ? 'sapphire' : (w.tags || []).includes('mineral-crystal') ? 'mineral' : null;
  cmp('Crystal', crystal(a), crystal(b));
  return out;
}

/**
 * Would a buyer actually choose between these two?
 *
 * Same style is required - nobody cross-shops a dress watch against a diver.
 * Beyond that the interesting pairs are close in price and different in
 * substance, so tier distance costs and real differences pay.
 */
function pairScore(a, b) {
  if (!a.style || a.style !== b.style) return null;

  const gap = Math.abs(tierIndex(a.tier) - tierIndex(b.tier));
  if (gap > 1) return null; // different budgets entirely

  const diffs = differences(a, b);
  if (diffs.length === 0) return null; // nothing to say

  const parts = [
    { term: 'same style', value: 3, why: a.style },
    { term: 'price proximity', value: gap === 0 ? 3 : 1, why: gap === 0 ? 'same band' : 'adjacent band' },
    { term: 'real differences', value: Math.min(diffs.length, 4), why: diffs.map((d) => d.field).join(', ') },
    // Cross-brand comparisons are what people search for; two Casios less so.
    { term: 'different brands', value: a.brand !== b.brand ? 2 : 0, why: a.brand === b.brand ? 'same brand' : `${a.brand} vs ${b.brand}` },
  ];
  return { total: parts.reduce((s, p) => s + p.value, 0), parts, diffs };
}

export function suggestComparisons(limit = 12) {
  const ws = approved();
  const existing = new Set(
    listJson(paths.comparisons).map((c) => [c.watch_a, c.watch_b].sort().join('|'))
  );

  const out = [];
  for (let i = 0; i < ws.length; i++) {
    for (let j = i + 1; j < ws.length; j++) {
      const a = ws[i];
      const b = ws[j];
      if (existing.has([a.id, b.id].sort().join('|'))) continue;
      const score = pairScore(a, b);
      if (!score) continue;
      out.push({
        a: { id: a.id, key: a.asin || a.catalogue_key, label: fullName(a), tier: a.tier },
        b: { id: b.id, key: b.asin || b.catalogue_key, label: fullName(b), tier: b.tier },
        style: a.style,
        title: `${fullName(a)} vs ${fullName(b)}`.slice(0, 90),
        score: score.total,
        working: score.parts.filter((p) => p.value),
        key_differences: score.diffs,
      });
    }
  }
  return out.sort((x, y) => y.score - x.score).slice(0, limit);
}

/* ------------------------------------------------------------------ *
 * Collections
 * ------------------------------------------------------------------ */

/** Defensible default order: cheapest band first, then by how much spec is stated. */
function collectionOrder(ws) {
  const specWeight = (w) =>
    (w.water_resistance_m >= 200 ? 3 : w.water_resistance_m >= 100 ? 2 : 0) +
    ((w.tags || []).includes('sapphire') ? 3 : 0) +
    (['automatic', 'hand-wound', 'solar'].includes(w.movement) ? 2 : 0);
  return [...ws].sort(
    (a, b) => tierIndex(a.tier) - tierIndex(b.tier) || specWeight(b) - specWeight(a)
  );
}

function draftIntro(kind, label, ws) {
  const n = ws.length;
  const withSapphire = ws.filter((w) => (w.tags || []).includes('sapphire')).length;
  const mechanical = ws.filter((w) => ['automatic', 'hand-wound'].includes(w.movement)).length;

  const facts = [];
  if (mechanical) facts.push(`${mechanical} of them mechanical`);
  if (withSapphire) facts.push(`${withSapphire} with sapphire`);

  return [
    `${n} watches${facts.length ? `, ${facts.join(' and ')}` : ''}.`,
    kind === 'tier'
      ? `Everything here sits in the ${label} band, ordered by how little you give up at that money.`
      : `All ${label.toLowerCase()}, ordered cheapest first.`,
    'Specifications are as stated by the manufacturer or the listing; we have not handled every watch here and say so on each page.',
  ].join(' ');
}

export function suggestCollections(minMembers = 3) {
  const ws = approved();
  const existing = new Set(listJson(paths.collections).map((c) => c.slug));
  const out = [];

  const propose = (title, kind, label, members) => {
    if (members.length < minMembers) return;
    const slug = slugify(title);
    if (existing.has(slug)) return;
    const ordered = collectionOrder(members);
    out.push({
      title,
      slug,
      intro_text: draftIntro(kind, label, ordered),
      watch_ids: ordered.map((w) => w.id),
      members: ordered.map((w) => fullName(w)),
      count: ordered.length,
    });
  };

  // "Best field" and "Best digital" do not read; these are the phrases someone
  // would actually type, which is the whole point of the page.
  const styleWord = (id) => styleNounPlural({ style: id });
  const tierWord = (t) => t.phrase || t.title.toLowerCase();

  for (const s of config.taxonomy.styles) {
    const members = ws.filter((w) => w.style === s.id);
    propose(`Best ${styleWord(s.id)}`, 'style', s.title, members);
  }
  for (const t of config.taxonomy.tiers) {
    const members = ws.filter((w) => w.tier === t.id);
    propose(`The best watches ${tierWord(t)}`, 'tier', t.title, members);
  }
  // Style within a band is the highest-intent query of the three shapes.
  for (const s of config.taxonomy.styles) {
    for (const t of config.taxonomy.tiers) {
      const members = ws.filter((w) => w.style === s.id && w.tier === t.id);
      propose(`Best ${styleWord(s.id)} ${tierWord(t)}`, 'tier', t.title, members);
    }
  }

  return out.sort((a, b) => b.count - a.count);
}
