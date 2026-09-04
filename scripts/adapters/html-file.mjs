import { readFileSync } from 'node:fs';
import { decodeEntities } from '../lib/normalise.mjs';

/**
 * Adapter: saved Amazon category / search page (local .html file).
 *
 * Why a saved file rather than an HTTP fetch:
 *   - It sends no automated traffic to Amazon, so there is no robots.txt
 *     question, no rate limiting, and no bot detection to work around.
 *   - The human has already seen the page they are ingesting, which is the
 *     whole point of a curated site.
 *   - It costs nothing to run and never breaks because of an IP block.
 *
 * We extract only: ASIN, title, brand, price, rating, rating count, image URL.
 * Reviews and product descriptions are never read - they are Amazon's
 * copyrighted content and the spec forbids ingesting them.
 */

const FIELD_PATTERNS = {
  title: [
    /<h2[^>]*>[\s\S]{0,400}?<span[^>]*>([^<]{10,300})<\/span>/i,
    /<h2[^>]*aria-label="([^"]{10,300})"/i,
    /class="[^"]*a-text-normal[^"]*"[^>]*>([^<]{10,300})</i,
    /<img[^>]+class="s-image"[^>]+alt="([^"]{10,300})"/i,
  ],
  price: [
    /<span class="a-price"[^>]*>[\s\S]{0,200}?<span class="a-offscreen">([^<]{2,20})<\/span>/i,
    /<span class="a-offscreen">([£$€][\d.,]+)<\/span>/i,
    /class="a-price-whole">([\d.,]+)<[\s\S]{0,120}?class="a-price-fraction">(\d{2})</i,
  ],
  rating: [
    /<span class="a-icon-alt">([0-5](?:\.\d)? out of 5 stars)<\/span>/i,
    /aria-label="([0-5](?:\.\d)? out of 5 stars)"/i,
  ],
  ratingCount: [
    /aria-label="([\d,]+) ratings?"/i,
    /class="[^"]*s-underline-text[^"]*">([\d,]+)</i,
    />\(?([\d,]{2,12})\)?<\/span>\s*<\/a>\s*<\/div>[\s\S]{0,200}?a-price/i,
  ],
  image: [/<img[^>]+class="s-image"[^>]+src="([^"]+)"/i, /<img[^>]+src="(https:\/\/m\.media-amazon\.com\/images\/[^"]+)"/i],
  brand: [/class="[^"]*s-line-clamp-1[^"]*"[^>]*>\s*<span[^>]*>([^<]{2,40})<\/span>/i],
};

function firstMatch(block, patterns) {
  for (const re of patterns) {
    const m = re.exec(block);
    if (m) return m.length > 2 && m[2] ? `${m[1]}.${m[2]}` : m[1];
  }
  return '';
}

/** Split the document into one block per search result. */
function splitResults(html) {
  const blocks = [];
  const re = /data-asin="([A-Z0-9]{10})"/g;
  const marks = [];
  let m;
  while ((m = re.exec(html)) !== null) marks.push({ asin: m[1], at: m.index });

  for (let i = 0; i < marks.length; i++) {
    // Start exactly at the marker. Backing off would pull in the tail of the
    // previous result and every field would be read off the wrong product.
    const start = marks[i].at;
    const end = i + 1 < marks.length ? marks[i + 1].at : Math.min(html.length, marks[i].at + 6000);
    blocks.push({ asin: marks[i].asin, html: html.slice(start, end) });
  }
  return blocks;
}

export const id = 'html-file';

export function describe() {
  return {
    id,
    label: 'Saved Amazon page (.html)',
    input: 'A page saved from your browser with Ctrl+S ("Webpage, Complete" or "Webpage, HTML Only").',
    sendsTraffic: false,
  };
}

export function extract(filePath, opts = {}) {
  const { max = 50, sourceUrl = '' } = opts;
  const html = readFileSync(filePath, 'utf8');
  const blocks = splitResults(html);

  const seen = new Set();
  const rows = [];
  const report = { file: filePath, blocks: blocks.length, kept: 0, skipped: {}, fieldHits: { title: 0, price: 0, rating: 0, ratingCount: 0, image: 0, brand: 0 } };

  const skip = (why) => {
    report.skipped[why] = (report.skipped[why] || 0) + 1;
  };

  for (const b of blocks) {
    if (rows.length >= max) {
      skip('over-max');
      continue;
    }
    if (seen.has(b.asin)) {
      skip('duplicate-asin-in-page');
      continue;
    }

    const title = decodeEntities(firstMatch(b.html, FIELD_PATTERNS.title)).trim();
    if (!title || title.length < 8) {
      skip('no-title');
      continue;
    }

    // Saved pages carry either the literal glyph or the entity, depending on
    // how the browser wrote the file. Decode before deciding what it is.
    const priceRaw = decodeEntities(firstMatch(b.html, FIELD_PATTERNS.price)).trim();
    const price = priceRaw && !/^[£$€]/.test(priceRaw) ? '£' + priceRaw : priceRaw;
    const rating = firstMatch(b.html, FIELD_PATTERNS.rating).trim();
    const ratingCount = firstMatch(b.html, FIELD_PATTERNS.ratingCount).trim();
    const image = firstMatch(b.html, FIELD_PATTERNS.image).trim();
    const brand = decodeEntities(firstMatch(b.html, FIELD_PATTERNS.brand)).trim();

    if (title) report.fieldHits.title++;
    if (price) report.fieldHits.price++;
    if (rating) report.fieldHits.rating++;
    if (ratingCount) report.fieldHits.ratingCount++;
    if (image) report.fieldHits.image++;
    if (brand) report.fieldHits.brand++;

    seen.add(b.asin);
    rows.push({ asin: b.asin, title, brand, price, rating, rating_count: ratingCount, image_url: image, source_page: sourceUrl });
  }

  report.kept = rows.length;
  return { rows, report };
}
