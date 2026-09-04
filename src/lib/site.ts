import raw from '../../site.config.json';

export const site = raw;

export const TAG_PLACEHOLDER = 'REPLACE-ME-21';

/**
 * Internal link, prefixed with the deploy base path.
 *
 * GitHub Pages serves a project repo from a subdirectory
 * (/regulated-watches/), so a bare href="/watches" would resolve to the root
 * of github.io and 404. Every internal link goes through this; external ones
 * (Amazon, Commons) must not.
 */
export function link(path: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  if (!path.startsWith('/')) return path;
  return `${base}${path}` || '/';
}

export const hasAssociateTag = () =>
  Boolean(site.affiliate.associateTag) && site.affiliate.associateTag !== TAG_PLACEHOLDER;

/**
 * Affiliate URL, built at render time from the ASIN and the configured tag.
 *
 * Returns null when no tag is set. Every call site treats null as "render the
 * button disabled", so a misconfigured deploy ships an obviously broken button
 * rather than an untagged link that earns nothing and looks fine.
 */
export function affiliateLink(asin: string): string | null {
  if (!hasAssociateTag()) return null;
  return site.affiliate.linkTemplate
    .replace('{marketplace}', site.affiliate.marketplace)
    .replace('{asin}', asin)
    .replace('{tag}', site.affiliate.associateTag);
}

/** ASIN where there is one, otherwise the catalogue key or id. */
export const watchKey = (w: { asin?: string; catalogue_key?: string; id?: string }): string =>
  w.asin || w.catalogue_key || w.id || '';

/**
 * Plain, untagged Amazon search for a model.
 *
 * Used when a watch has no ASIN yet. A search link is honest — it takes the
 * reader to the right place without pretending to be a specific listing — and
 * it costs nothing to replace with a product link later.
 */
export function searchUrl(w: { brand?: string; title?: string; model_ref?: string }): string {
  const q = encodeURIComponent([w.brand, w.model_ref || w.title].filter(Boolean).join(' ').trim());
  const base = `https://www.${site.affiliate.marketplace}/s?k=${q}`;

  // The tag is what earns, not the destination. An untagged search link sends
  // a reader to Amazon and attributes nothing, which is the worst of both:
  // you lose the visitor and get paid for it. Tagged search links do track,
  // they simply convert far worse than a link to a specific product.
  return hasAssociateTag() ? `${base}&tag=${encodeURIComponent(site.affiliate.associateTag)}` : base;
}

export const tierById = (id: string) => site.taxonomy.tiers.find((t) => t.id === id) ?? null;
export const styleById = (id: string) => site.taxonomy.styles.find((s) => s.id === id) ?? null;

/**
 * Is a stored price still inside the window the Associates terms allow?
 *
 * Evaluated at build time here, and again in the browser by price-guard.js.
 * The build-time check alone is not enough: a page built on Monday would still
 * be claiming Monday's price on Wednesday.
 */
export function priceIsFresh(checkedAt: string | null | undefined, now = Date.now()): boolean {
  if (!checkedAt) return false;
  const t = Date.parse(checkedAt);
  if (!Number.isFinite(t)) return false;
  return now - t < site.price.maxAgeHours * 3600 * 1000;
}

export function imageFor(watch: { image?: string }): string | null {
  if (site.images.mode === 'placeholder') return null;
  if (!watch.image) return null;
  const name = String(watch.image).replace(/^.*[\\/]/, '');
  return link(`/images/watches/${name}`);
}

/** Deterministic hue per ASIN, so a watch's placeholder card is always the same. */
export function placeholderHue(asin: string): number {
  let h = 0;
  for (let i = 0; i < asin.length; i++) h = (h * 31 + asin.charCodeAt(i)) % 360;
  return h;
}

/**
 * Brand + title, without saying the brand twice.
 *
 * Amazon titles almost always lead with the brand ("Seiko 5 Sports SRPD55K1"),
 * so prefixing the stored brand unconditionally produces "Seiko Seiko 5 Sports".
 */
export function fullName(w: { brand?: string; title?: string }): string {
  const brand = (w.brand ?? '').trim();
  const title = (w.title ?? '').trim();
  if (!brand) return title;
  if (title.toLowerCase().startsWith(brand.toLowerCase())) return title;
  return `${brand} ${title}`;
}

/** Style and movement, without repeating a word that is in both (digital). */
export function specChips(w: { style?: string; movement?: string }): string[] {
  const out: string[] = [];
  if (w.style) out.push(w.style);
  if (w.movement && w.movement !== w.style) out.push(w.movement);
  return out;
}

export const formatDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
