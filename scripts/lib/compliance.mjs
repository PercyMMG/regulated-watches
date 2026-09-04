import { config } from './config.mjs';

/**
 * Copy lint. Everything the content engine produces, and everything a human
 * types into the dashboard, passes through this before it can be published.
 *
 * The rules exist for two separate reasons:
 *   - Amazon Associates terms (trademark use, stale prices, implied endorsement)
 *   - Not making claims we cannot support from the data we actually hold
 */

const PRICE_IN_COPY = /[£$€]\s?\d|(\b\d+\s?(?:quid|pounds|dollars|euros)\b)|\bunder \d+\b/i;
const AMAZON_ENDORSEMENT = /\bamazon('s)?\s+(official|approved|recommended|endorsed|choice|pick|verified)\b/i;
const SUPERLATIVE = /\b(the (best|greatest|finest|perfect)|world'?s (best|finest)|unbeatable|flawless|nothing comes close)\b/i;

export function lintCopy(text, opts = {}) {
  const { allowPrice = false, context = 'copy' } = opts;
  const issues = [];
  const s = String(text || '');
  const lower = s.toLowerCase();

  for (const phrase of config.compliance.bannedCopyPhrases) {
    if (lower.includes(String(phrase).toLowerCase())) {
      issues.push({ level: 'error', rule: 'banned-phrase', detail: `Contains banned phrase: "${phrase}"`, context });
    }
  }
  if (!allowPrice && PRICE_IN_COPY.test(s)) {
    issues.push({
      level: 'error',
      rule: 'price-in-copy',
      detail: 'Names a price. Prices go stale within 24h and stale prices breach Associates terms. Say "check the current price" instead.',
      context,
    });
  }
  if (AMAZON_ENDORSEMENT.test(s)) {
    issues.push({ level: 'error', rule: 'implied-endorsement', detail: 'Implies Amazon endorses or vouches for this site or pick.', context });
  }
  if (SUPERLATIVE.test(s)) {
    issues.push({ level: 'warn', rule: 'unsupported-superlative', detail: 'Superlative we cannot evidence from the stored data.', context });
  }
  return issues;
}

/** A social caption must carry a disclosure. Non-negotiable. */
export function lintCaption(caption) {
  const issues = lintCopy(caption, { context: 'caption' });
  const tag = config.social.requiredDisclosureTag;
  if (!String(caption || '').toLowerCase().includes(tag.toLowerCase())) {
    issues.push({ level: 'error', rule: 'missing-disclosure', detail: `Caption must contain ${tag}.`, context: 'caption' });
  }
  return issues;
}

/**
 * Publish gate. A watch may only move pending -> approved when this returns [].
 * Keeps half-finished records off the live site.
 */
export function readyToApprove(watch, curation = config.curation) {
  const issues = [];
  if (!watch.asin || !/^[A-Z0-9]{10}$/.test(watch.asin)) {
    issues.push({ level: 'error', rule: 'bad-asin', detail: 'ASIN missing or malformed.' });
  }
  if (!watch.title || watch.title.length < 8) {
    issues.push({ level: 'error', rule: 'no-title', detail: 'Title missing or too short.' });
  }
  if (!watch.brand) {
    issues.push({ level: 'error', rule: 'no-brand', detail: 'Brand not set. Auto-detection did not find one; set it by hand.' });
  }
  if (curation.requireCuratedTextBeforeApprove && !String(watch.short_blurb || '').trim()) {
    issues.push({ level: 'error', rule: 'no-blurb', detail: 'short_blurb is empty. Curated text is required before approval.' });
  }
  if (Array.isArray(watch.drafts) && watch.drafts.length > 0) {
    issues.push({
      level: 'error',
      rule: 'unconfirmed-drafts',
      detail: `Auto-generated fields still marked draft: ${watch.drafts.join(', ')}. Review and confirm each one.`,
    });
  }
  if (!watch.style) {
    issues.push({ level: 'warn', rule: 'no-style', detail: 'No style assigned, so it will not appear on any style page.' });
  }
  if (!watch.tier) {
    issues.push({ level: 'warn', rule: 'no-tier', detail: 'No price tier, so it will not appear on any tier page.' });
  }
  issues.push(...lintCopy(watch.short_blurb, { allowPrice: false, context: 'short_blurb' }));
  issues.push(...lintCopy(watch.long_description, { allowPrice: false, context: 'long_description' }));
  for (const p of watch.pros || []) issues.push(...lintCopy(p, { context: 'pros' }));
  for (const c of watch.cons || []) issues.push(...lintCopy(c, { context: 'cons' }));

  return issues.filter((i) => i.level === 'error');
}

export const warningsFor = (watch) =>
  [...lintCopy(watch.short_blurb, { context: 'short_blurb' })].filter((i) => i.level === 'warn');

/** Is a stored price still inside the window Amazon's terms allow us to show? */
export function priceIsFresh(checkedAt, now = Date.now()) {
  if (!checkedAt) return false;
  const t = Date.parse(checkedAt);
  if (!Number.isFinite(t)) return false;
  return now - t < config.price.maxAgeHours * 3600 * 1000;
}
