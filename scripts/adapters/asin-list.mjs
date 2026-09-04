import { readFileSync } from 'node:fs';

/**
 * Adapter: a plain list of ASINs or product URLs, one per line.
 *
 * This is the fallback that cannot break. When Amazon changes its markup
 * and the HTML adapter stops finding fields, you paste ten URLs in here
 * and carry on; you type the title and price during curation instead.
 *
 * Optional trailing fields, pipe-separated:
 *   B01ABCDEFG | Seiko 5 Sports SRPD55 | £229.00 | 4.5 | 1203
 */

export const id = 'asin-list';

export function describe() {
  return {
    id,
    label: 'ASIN or URL list (.txt)',
    input: 'One ASIN or Amazon product URL per line. Optionally "| title | price | rating | ratingCount".',
    sendsTraffic: false,
  };
}

const ASIN_IN_URL = /\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})/i;

export function extract(filePath, opts = {}) {
  const { max = 50, sourceUrl = '' } = opts;
  const text = readFileSync(filePath, 'utf8');
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));

  const seen = new Set();
  const rows = [];
  const report = { file: filePath, blocks: lines.length, kept: 0, skipped: {}, fieldHits: { title: 0, price: 0, rating: 0, ratingCount: 0, image: 0, brand: 0 } };
  const skip = (why) => {
    report.skipped[why] = (report.skipped[why] || 0) + 1;
  };

  for (const line of lines) {
    if (rows.length >= max) {
      skip('over-max');
      continue;
    }
    const [first, title = '', price = '', rating = '', ratingCount = ''] = line.split('|').map((s) => s.trim());

    let asin = '';
    const urlHit = ASIN_IN_URL.exec(first);
    if (urlHit) asin = urlHit[1].toUpperCase();
    else if (/^[A-Z0-9]{10}$/i.test(first)) asin = first.toUpperCase();

    if (!asin) {
      skip('no-asin');
      continue;
    }
    if (seen.has(asin)) {
      skip('duplicate-asin-in-file');
      continue;
    }
    seen.add(asin);

    if (title) report.fieldHits.title++;
    if (price) report.fieldHits.price++;
    if (rating) report.fieldHits.rating++;
    if (ratingCount) report.fieldHits.ratingCount++;

    rows.push({
      asin,
      title: title || `Untitled — ${asin} (add the title during curation)`,
      brand: '',
      price,
      rating,
      rating_count: ratingCount,
      image_url: '',
      source_page: sourceUrl,
    });
  }

  report.kept = rows.length;
  return { rows, report };
}
