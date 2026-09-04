import { config } from './config.mjs';

/* Known watch brands. Matched longest-first so "Orient Star" beats "Orient". */
export const BRANDS = [
  'Orient Star', 'Seiko Prospex', 'Seiko Presage', 'Casio G-Shock', 'G-Shock', 'Baby-G',
  'Citizen Eco-Drive', 'Swatch', 'Seiko', 'Citizen', 'Casio', 'Orient', 'Timex', 'Tissot',
  'Hamilton', 'Bulova', 'Certina', 'Mido', 'Vostok', 'Boldr', 'Lorier', 'Christopher Ward',
  'Bering', 'Skagen', 'Fossil', 'Garmin', 'Withings', 'Junghans', 'Sternglas', 'Nomos',
  'Dan Henry', 'Baltic', 'Traser', 'Luminox', 'Marathon', 'Victorinox', 'Wenger', 'Braun',
  'Pulsar', 'Lorus', 'Accurist', 'Rotary', 'Sekonda', 'Spinnaker', 'Steeldive', 'San Martin',
  'Pagani Design', 'Addiesdive', 'Cronos', 'Nivada', 'Zeppelin', 'Laco', 'Stowa',
  'Archimede', 'Tudor', 'Longines', 'Oris', 'Rado',
];

/**
 * Ordered by how strongly each signal dominates the others. First match wins.
 *
 * `digital` leads because it is a form factor, not a complication: a G-Shock
 * with a world-time function is a digital watch, not a GMT. `diver` beats
 * `chronograph` because a dive chronograph is bought as a diver.
 */
const STYLE_RULES = [
  ['digital', /\b(digital|g-?shock|baby-?g|lcd|databank|illuminator)\b/i],
  // Deliberately does NOT match "200m"/"300m". Water resistance is a spec, not
  // a style: plenty of non-divers are rated to 200 m.
  ['diver', /\b(divers?|dive watch|submarin\w*|seamaster|turtle|samurai|skx\d*|srpd\w*|aqua\w*)\b/i],
  ['chronograph', /\b(chronograph|chrono|stopwatch|tachymeter)\b/i],
  ['gmt', /\b(gmt|dual\s?time|world\s?time|worldtimer)\b/i],
  ['pilot', /\b(pilot|aviator|aviation|flieger|navitimer|airman|cockpit)\b/i],
  ['field', /\b(field|military|khaki|explorer|expedition|army|trench)\b/i],
  ['dress', /\b(dress|bambino|presage|classic|slim|thin|cocktail|minimalist)\b/i],
];

const MOVEMENT_RULES = [
  ['solar', /\b(solar|eco-?drive|tough\s?solar)\b/i],
  ['kinetic', /\bkinetic\b/i],
  ['automatic', /\b(automatic|self-?winding|nh3[56]|4r3[56]|6r35|miyota)\b/i],
  ['hand-wound', /\b(hand-?wound|hand\s?winding|manual\s?wind\w*)\b/i],
  ['digital', /\b(digital|lcd|g-?shock)\b/i],
  ['quartz', /\b(quartz|battery)\b/i],
];

const RE_SPECIALS = /[-/\\^$*+?.()|[\]{}]/g;
const escapeRe = (s) => String(s).replace(RE_SPECIALS, (c) => '\\' + c);

export function detectBrand(title) {
  const t = String(title || '');
  const ordered = [...BRANDS].sort((a, z) => z.length - a.length);
  for (const b of ordered) {
    if (new RegExp('\\b' + escapeRe(b) + '\\b', 'i').test(t)) return b;
  }
  // Fall back to the first capitalised token; the human confirms it during curation.
  const first = t.trim().split(/\s+/)[0] || '';
  return /^[A-Z][A-Za-z&.'-]{1,20}$/.test(first) ? first : '';
}

export function detectStyle(title) {
  const t = String(title || '');
  for (const [id, re] of STYLE_RULES) if (re.test(t)) return id;
  return '';
}

export function detectMovement(title) {
  const t = String(title || '');
  for (const [id, re] of MOVEMENT_RULES) if (re.test(t)) return id;
  return '';
}

export function tierFor(priceValue) {
  if (typeof priceValue !== 'number' || !Number.isFinite(priceValue)) return '';
  for (const t of config.taxonomy.tiers) {
    const underMax = t.max === null || priceValue < t.max;
    if (priceValue >= t.min && underMax) return t.id;
  }
  return '';
}

export const tierById = (id) => config.taxonomy.tiers.find((t) => t.id === id) || null;
export const styleById = (id) => config.taxonomy.styles.find((s) => s.id === id) || null;

/** Suggested tags. Always suggestions - the human confirms them in the dashboard. */
export function suggestTags(watch) {
  const { brand = '', price_value = null, style = '', movement = '' } = watch || {};
  // Prefer the untrimmed listing title: that is where the spec keywords live.
  const title = watch?.full_title || watch?.title || '';
  const tags = new Set();
  const s = style || detectStyle(title);
  const m = movement || detectMovement(title);
  const tier = tierFor(price_value);
  if (s) tags.add(s);
  if (m) tags.add(m);
  if (tier) tags.add(tier);
  const b = brand || detectBrand(title);
  if (b) tags.add(b.toLowerCase().replace(/\s+/g, '-'));

  const t = String(title);
  if (/\bsapphire\b/i.test(t)) tags.add('sapphire');
  if (/\b(lume|luminous|lumibrite|superluminova)\b/i.test(t)) tags.add('lume');
  if (/\btitanium\b/i.test(t)) tags.add('titanium');
  if (/\b\d{2,3}\s?m\b/i.test(t) || /\b\d{1,2}\s?bar\b/i.test(t)) tags.add('water-resistant');
  if (/\b(3[5-9]|4[0-2])\s?mm\b/i.test(t)) tags.add('small-case');
  return [...tags];
}

/** Case diameter in mm, if the title states one. Used for pros/cons drafts. */
export function detectCaseSize(title) {
  const m = /\b(\d{2}(?:\.\d)?)\s?mm\b/i.exec(String(title || ''));
  if (!m) return null;
  const v = Number(m[1]);
  return v >= 26 && v <= 52 ? v : null;
}

/** Water resistance in metres, if stated. */
export function detectWaterResistance(title) {
  const t = String(title || '');
  const m = /\b(\d{2,4})\s?m\b(?!m)/i.exec(t);
  if (m) {
    const v = Number(m[1]);
    if ([30, 50, 100, 150, 200, 300, 500, 1000].includes(v)) return v;
  }
  const bar = /\b(\d{1,2})\s?bar\b/i.exec(t);
  if (bar) return Number(bar[1]) * 10;
  return null;
}
