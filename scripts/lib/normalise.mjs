import {
  detectBrand,
  detectStyle,
  detectMovement,
  detectCaseSize,
  detectWaterResistance,
  tierFor,
} from './taxonomy.mjs';
import { config } from './config.mjs';

const CURRENCY = /([£$€])\s?([0-9][0-9,]*(?:\.[0-9]{2})?)/;

export function parsePrice(raw) {
  if (raw === null || raw === undefined) return { price_display: '', price_value: null };
  const s = String(raw).replace(/\s+/g, ' ').trim();
  const m = CURRENCY.exec(s);
  if (!m) return { price_display: '', price_value: null };
  const value = Number(m[2].replace(/,/g, ''));
  if (!Number.isFinite(value) || value <= 0) return { price_display: '', price_value: null };
  return { price_display: m[1] + m[2], price_value: value };
}

export function parseRating(raw) {
  if (raw === null || raw === undefined) return null;
  const m = /([0-5](?:\.[0-9])?)\s*(?:out of 5|\/\s*5|stars)/i.exec(String(raw));
  const fallback = m ? null : /^\s*([0-5](?:\.[0-9])?)\s*$/.exec(String(raw));
  const hit = m || fallback;
  if (!hit) return null;
  const v = Number(hit[1]);
  return v >= 0 && v <= 5 ? v : null;
}

export function parseRatingCount(raw) {
  if (raw === null || raw === undefined) return null;
  const m = /([\d,]{1,12})/.exec(String(raw));
  if (!m) return null;
  const v = Number(m[1].replace(/,/g, ''));
  return Number.isFinite(v) && v >= 0 ? v : null;
}

const ENTITIES = {
  '&amp;': '&',
  '&#39;': "'",
  '&apos;': "'",
  '&quot;': '"',
  '&nbsp;': ' ',
  '&lt;': '<',
  '&gt;': '>',
  '&pound;': '£',
  '&euro;': '€',
  '&dollar;': '$',
  '&mdash;': '—',
  '&ndash;': '–',
};

export function decodeEntities(s) {
  return String(s || '')
    .replace(/&(?:amp|#39|apos|quot|nbsp|lt|gt|pound|euro|dollar|mdash|ndash);/g, (m) => ENTITIES[m] || m)
    .replace(/&#(\d{2,5});/g, (_, d) => String.fromCodePoint(Number(d)));
}

/**
 * Remove anything that could be read as markup.
 *
 * Ingested fields come from an Amazon page, which is untrusted input, and
 * decodeEntities turns "&lt;script&gt;" back into a real tag. Those fields
 * flow into the generated blurb and from there into a watch's Markdown body,
 * which Astro renders as raw HTML. Astro escapes template expressions, so the
 * title in an <h1> is safe, but the Markdown body is not.
 *
 * Stripping at the boundary means untrusted data can never carry markup,
 * whatever it is later interpolated into.
 */
export function stripMarkup(s) {
  return String(s || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Amazon titles are keyword soup. Trim to something a human can scan. */
export function cleanTitle(raw) {
  let t = stripMarkup(decodeEntities(raw)).replace(/\s+/g, ' ').trim();
  // Amazon pads titles with comma-separated keyword lists; keep the first two clauses.
  const parts = t.split(/\s*[,|]\s*/);
  if (parts.length > 2 && parts.join(', ').length > 80) t = parts.slice(0, 2).join(', ');
  if (t.length > 110) t = t.slice(0, 107).replace(/\s+\S*$/, '') + '...';
  return t;
}

export const isAsin = (s) => /^[A-Z0-9]{10}$/.test(String(s || '').toUpperCase());

/**
 * Brand + title, without saying the brand twice.
 *
 * Amazon titles almost always lead with the brand ("Seiko 5 Sports SRPD55K1"),
 * so prefixing the stored brand unconditionally gives "Seiko Seiko 5 Sports".
 * Mirrors fullName() in src/lib/site.ts, which does the same job at render time.
 */
export function fullName(w) {
  const brand = String(w?.brand ?? '').trim();
  const title = String(w?.title ?? '').trim();
  if (!brand) return title;
  if (title.toLowerCase().startsWith(brand.toLowerCase())) return title;
  return `${brand} ${title}`;
}

/**
 * Turn a raw extracted row into a `pending` Watch record.
 *
 * Everything derived here is a *suggestion*. Nothing in this object is
 * publishable until a human has curated it in the dashboard.
 */
export function toPendingWatch(raw, opts = {}) {
  const { sourceUrl = '', scrapedAt = new Date().toISOString() } = opts;
  const asin = String(raw.asin || '').toUpperCase();

  // Detection runs on the FULL listing title. cleanTitle() drops the keyword
  // tail, and that tail is where Amazon puts the case size, water resistance
  // and movement. Clean for display, detect from the original.
  const fullTitle = stripMarkup(decodeEntities(raw.title)).replace(/\s+/g, ' ').trim();
  const title = cleanTitle(raw.title);
  const { price_display, price_value } = parsePrice(raw.price);
  const brand = raw.brand ? cleanTitle(raw.brand) : stripMarkup(detectBrand(fullTitle));

  return {
    id: `watch-${asin.toLowerCase()}`,
    asin,
    title,
    // The untrimmed listing title, kept so spec detection and the curator can
    // both see everything Amazon stated. Never rendered on the site.
    full_title: fullTitle,
    brand,
    style: detectStyle(fullTitle),
    movement: detectMovement(fullTitle),
    tier: tierFor(price_value),
    case_mm: detectCaseSize(fullTitle),
    water_resistance_m: detectWaterResistance(fullTitle),

    // Never rendered. Kept only so the curator can find the product photo.
    source_image_url: raw.image_url || '',
    image: '',

    price_display,
    price_value,
    price_checked_at: price_display ? scrapedAt : null,
    rating: parseRating(raw.rating),
    rating_count: parseRatingCount(raw.rating_count),

    scraped_url: `https://www.${config.affiliate.marketplace}/dp/${asin}`,
    source_page: sourceUrl,
    scraped_at: scrapedAt,

    // Affiliate link is derived at build time from the ASIN + configured tag.
    // It is deliberately not baked into content files.
    short_blurb: '',
    long_description: '',
    pros: [],
    cons: [],
    tags: [],
    suggested_tags: [],
    featured: false,
    drafts: [],
    status: 'pending',
  };
}
