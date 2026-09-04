import { writeFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { paths, config } from './config.mjs';
import { slugify } from './store.mjs';

/**
 * Wikimedia Commons image search.
 *
 * The only source of real product photography available before PA-API
 * eligibility (which needs three qualifying sales first). Commons hosts freely
 * licensed images, and several of the iconic models in the catalogue have one.
 *
 * Two rules govern this module:
 *
 *  1. COMMERCIAL USE ONLY. This site carries affiliate links, so it is a
 *     commercial use. Non-commercial (-NC) and no-derivatives (-ND) licences
 *     are rejected outright rather than left to the curator to notice.
 *
 *  2. NEVER AUTO-ATTACH. A file called "Casio watch.jpg" may be any Casio. The
 *     API returns candidates; a human picks. Putting a photograph of the wrong
 *     watch on a page is worse than having no photograph.
 */

const API = 'https://commons.wikimedia.org/w/api.php';

// Wikimedia's policy requires a descriptive User-Agent that identifies the tool.
const UA = `regulated-watches/1.0 (${config.url}; watch reference site) node`;

const ALLOWED = /cc0|public\s*domain|^pd|cc[\s-]?by/i;
const FORBIDDEN = /-nc|non[\s-]?commercial|-nd|no[\s-]?deriv|fair\s*use|copyright/i;

/**
 * Is this licence usable on a commercial page, with attribution?
 * Unknown or unparseable licences are rejected: silence is not permission.
 */
export function licenceIsUsable(shortName) {
  const s = String(shortName || '').trim();
  if (!s) return false;
  if (FORBIDDEN.test(s)) return false;
  return ALLOWED.test(s);
}

const stripHtml = (s) =>
  String(s || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

async function api(params) {
  const url = `${API}?${new URLSearchParams({ format: 'json', origin: '*', ...params })}`;
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
  if (!res.ok) throw new Error(`Commons returned HTTP ${res.status}`);
  return res.json();
}

/**
 * Search Commons for candidate photographs of a model.
 *
 * Returns only files whose licence permits commercial use, each with the
 * attribution needed to render a credit. Anything we cannot attribute is
 * dropped, because an unattributed CC image is a licence breach.
 */
export async function search(query, limit = 8, modelRef = '') {
  // Try the full model first, then progressively looser queries. Commons file
  // naming is inconsistent, so "Casio MDV-106" and "Casio MDV106" are different
  // searches and only one of them will hit.
  const variants = [
    `${query} watch`,
    query,
    query.replace(/[-\s]+/g, ''),
    query.split(/\s+/).slice(0, 2).join(' '),
  ].filter((v, i, a) => v && a.indexOf(v) === i);

  const titles = [];
  for (const srsearch of variants) {
    const found = await api({
      action: 'query',
      list: 'search',
      srsearch,
      srnamespace: '6', // File:
      srlimit: String(Math.min(limit * 3, 30)),
    });
    for (const r of found?.query?.search || []) {
      if (!titles.includes(r.title)) titles.push(r.title);
    }
    if (titles.length >= limit * 3) break;
  }

  if (!titles.length) return [];

  const info = await api({
    action: 'query',
    titles: titles.slice(0, 50).join('|'),
    prop: 'imageinfo',
    iiprop: 'url|size|extmetadata|mime',
    iiurlwidth: '400',
  });

  const pages = Object.values(info?.query?.pages || {});
  const out = [];

  for (const p of pages) {
    const ii = p.imageinfo?.[0];
    if (!ii) continue;
    if (!/^image\/(jpeg|png|webp)$/.test(ii.mime || '')) continue;

    const meta = ii.extmetadata || {};
    const licence = stripHtml(meta.LicenseShortName?.value);
    if (!licenceIsUsable(licence)) continue;

    const author = stripHtml(meta.Artist?.value) || stripHtml(meta.Credit?.value);
    if (!author) continue; // cannot attribute, so cannot use

    // Not a filter - a hint for the curator. Commons is full of backplates,
    // movements and, in at least one case, a counterfeit. The human decides;
    // this just makes the obvious rejects obvious.
    const name = p.title.replace(/^File:/, '');
    const caution = [
      /counterfeit|fake|replica/i.test(name) && 'possible counterfeit',
      /back|caseback|крышка|rear/i.test(name) && 'may be the back, not the dial',
      /movement|calibre|caliber|internals?/i.test(name) && 'may be the movement',
      /box|packaging|manual/i.test(name) && 'may be packaging',
      /custom|modded|modified|inverted/i.test(name) && 'may be modified, not stock',
      // The loose query variants deliberately cast wide, which pulls in other
      // references from the same family: a FROGMAN for a GA-2100, an SNKA23 for
      // an SNK809. If the reference is not in the filename, say so loudly.
      modelRef &&
        !name.toLowerCase().replace(/[^a-z0-9]/g, '').includes(String(modelRef).toLowerCase().replace(/[^a-z0-9]/g, '')) &&
        `filename does not mention ${modelRef} - check it is the right reference`,
    ].filter(Boolean);

    out.push({
      title: p.title,
      caution,
      thumb: ii.thumburl || ii.url,
      url: ii.url,
      width: ii.width,
      height: ii.height,
      mime: ii.mime,
      licence,
      licence_url: stripHtml(meta.LicenseUrl?.value) || '',
      author: author.slice(0, 120),
      source_url: ii.descriptionurl || `https://commons.wikimedia.org/wiki/${encodeURIComponent(p.title)}`,
    });

    if (out.length >= limit) break;
  }

  return out;
}

const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

/**
 * Download a chosen file into public/images/watches/ and return the record
 * fields to store. Images are self-hosted rather than hotlinked: Commons asks
 * that you do not hotlink, and a local copy cannot break later.
 */
/**
 * Only Wikimedia's own hosts serve the files we offer.
 *
 * The candidate object arrives in a request body, so its `url` is attacker-
 * controllable even though the UI only ever sends one we returned. Fetching it
 * unchecked would let a crafted request make this process request any address
 * it can reach - internal services, cloud metadata endpoints, the local
 * network. Pinning the host closes that.
 */
const IMAGE_HOSTS = new Set(['upload.wikimedia.org', 'commons.wikimedia.org']);

function assertFetchable(rawUrl) {
  let u;
  try {
    u = new URL(String(rawUrl));
  } catch {
    throw new Error('Image URL is not a valid URL.');
  }
  if (u.protocol !== 'https:') throw new Error('Image URL must be https.');
  if (!IMAGE_HOSTS.has(u.hostname)) {
    throw new Error(`Refusing to fetch from "${u.hostname}". Only ${[...IMAGE_HOSTS].join(' and ')} are allowed.`);
  }
  return u;
}

export async function fetchImage(candidate, key) {
  const url = assertFetchable(candidate?.url);

  // redirect: 'error' so a permitted host cannot bounce us somewhere else.
  const res = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'error' });
  if (!res.ok) throw new Error(`Could not download image: HTTP ${res.status}`);

  const original = Buffer.from(await res.arrayBuffer());
  // Commons originals are frequently archival scans of 30-60 MB. That is fine:
  // we resize immediately and only the resized copy is kept. The ceiling exists
  // to stop a pathological download, not to reject normal Commons files.
  if (original.length > 80_000_000) throw new Error('Source image is over 80 MB; pick a smaller one.');

  // Commons originals are archival: the first one tested was 3.1 MB at
  // 2410x2883. That is unusable on a page. Resize to something a browser can
  // reasonably load before it ever reaches the repository.
  const name = `${slugify(key)}.jpg`;
  let out;
  try {
    const sharp = (await import('sharp')).default;
    out = await sharp(original)
      .rotate() // honour EXIF orientation
      .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
  } catch {
    // Never fail the whole attach because the optimiser is unavailable.
    out = original;
  }

  writeFileSync(join(paths.publicImages, name), out);

  // These arrive in the request body and are written straight into content,
  // so strip anything markup-shaped rather than trusting the caller.
  const clean = (v, max = 200) => stripHtml(v).slice(0, max);
  const cleanUrl = (v) => {
    try {
      const u = new URL(String(v));
      return u.protocol === 'https:' ? u.href : '';
    } catch {
      return '';
    }
  };

  return {
    image: name,
    image_credit_author: clean(candidate.author, 120),
    image_credit_licence: clean(candidate.licence, 60),
    image_credit_licence_url: cleanUrl(candidate.licence_url),
    image_credit_source: cleanUrl(candidate.source_url),
    image_bytes: out.length,
  };
}
