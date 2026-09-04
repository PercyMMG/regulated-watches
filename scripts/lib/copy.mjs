import { config } from './config.mjs';
import { tierById, styleById } from './taxonomy.mjs';
import { fullName } from './normalise.mjs';

/* ------------------------------------------------------------------ *
 * Content generation engine.
 *
 * Two rules govern everything below:
 *
 *  1. FACT-GATED. A sentence is only emitted when the fact that supports
 *     it is present on the record. We never write "sapphire crystal"
 *     because it sounds good; we write it because the listing said so.
 *     Where a fact is missing we say it is missing, which is useful copy
 *     in its own right.
 *
 *  2. DETERMINISTIC. No model call, no API key, no per-run cost. Variety
 *     comes from a PRNG seeded on the ASIN, so the same watch always
 *     produces the same copy and two watches never produce the same copy.
 * ------------------------------------------------------------------ */

function seedFrom(str) {
  let h = 2166136261;
  for (let i = 0; i < String(str).length; i++) {
    h ^= String(str).charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (arr, r) => arr[Math.floor(r() * arr.length) % arr.length];

const STYLE_NOUN = {
  diver: 'diver',
  field: 'field watch',
  pilot: 'pilot watch',
  dress: 'dress watch',
  chronograph: 'chronograph',
  digital: 'digital watch',
  gmt: 'GMT',
};

const MOVEMENT_PHRASE = {
  automatic: 'automatic',
  'hand-wound': 'hand-wound',
  quartz: 'quartz',
  solar: 'solar',
  kinetic: 'kinetic',
  digital: 'digital',
};

export const styleNoun = (w) => STYLE_NOUN[w.style] || 'watch';

/** "digital watch" -> "digital watches", not "digital watchs". */
export const styleNounPlural = (w) => {
  const n = styleNoun(w);
  if (/(ch|sh|s|x|z)$/i.test(n)) return n + 'es';
  return n + 's';
};

/**
 * The line as it appears burned into the video. Cuts at a real clause
 * boundary, never mid-number: splitting "Rated 4.7/5" on "." would put
 * "Rated 4" on screen.
 */
function onScreenFrom(line, max = 32) {
  const clause = String(line).split(/\s+[—–-]\s+|,\s+|\.\s+/)[0].trim();
  if (clause.length <= max) return clause;
  return clause.slice(0, max).replace(/\s+\S*$/, '').trim();
}

/**
 * Confirmed tags plus not-yet-confirmed suggestions. Drafts are generated
 * before the curator has promoted suggestions to real tags, so both sets
 * have to be visible or every spec-derived line would be suppressed.
 */
const effectiveTags = (w) => new Set([...(w.tags || []), ...(w.suggested_tags || [])]);

/* ------------------------------------------------------------------ *
 * Pros and cons, derived only from stored facts
 * ------------------------------------------------------------------ */

export function draftPros(w) {
  const out = [];
  const tags = effectiveTags(w);

  if (w.movement === 'automatic') out.push('Automatic movement, so there is no battery to replace.');
  if (w.movement === 'hand-wound') out.push('Hand-wound movement — no rotor, usually a thinner case.');
  if (w.movement === 'solar') out.push('Solar charged, so there is no battery service interval.');
  if (w.movement === 'quartz') out.push('Quartz movement: more accurate day to day than any mechanical at this level.');
  if (w.movement === 'digital') out.push('Digital display, so the functions are readable without interpretation.');

  const wr = w.water_resistance_m;
  if (wr >= 200) out.push(`${wr} m water resistance — swimmable, and rated for more than most owners will ask of it.`);
  else if (wr >= 100) out.push(`${wr} m water resistance — fine for swimming and showering.`);

  if (w.case_mm && w.case_mm <= 40) out.push(`${w.case_mm} mm case, which suits a smaller wrist without looking undersized.`);
  if (tags.has('sapphire')) out.push('Sapphire crystal, which resists scratches far better than mineral glass.');
  if (tags.has('titanium')) out.push('Titanium case, noticeably lighter on the wrist than steel.');
  if (tags.has('lume')) out.push('Lume on the hands and markers, so it stays readable in the dark.');

  if (typeof w.rating === 'number' && w.rating >= 4.3 && (w.rating_count || 0) >= 100) {
    out.push(`Rated ${w.rating}/5 across ${Number(w.rating_count).toLocaleString('en-GB')} Amazon ratings when we checked.`);
  }
  return out;
}

export function draftCons(w) {
  const out = [];
  const tags = effectiveTags(w);
  const wr = w.water_resistance_m;

  if (wr !== null && wr !== undefined && wr <= 50) {
    out.push(`Only ${wr} m water resistance — treat it as rain and handwashing, not swimming.`);
  }
  if (wr === null || wr === undefined) {
    out.push('Water resistance is not stated in the listing. Confirm it before you buy.');
  }
  if (w.case_mm && w.case_mm >= 44) {
    out.push(`${w.case_mm} mm case is large. Measure your wrist before committing.`);
  }
  if (!w.movement) {
    out.push('The listing does not state the movement. Confirm whether it is mechanical or quartz.');
  }
  if (!tags.has('sapphire')) {
    out.push('Crystal material is not confirmed in the listing — assume mineral glass unless stated.');
  }
  if (w.movement === 'quartz' && (w.tier === 'upper' || w.tier === 'top')) {
    out.push('Quartz at this price means you are paying for the case and finishing rather than the movement.');
  }
  if (typeof w.rating_count === 'number' && w.rating_count > 0 && w.rating_count < 50) {
    out.push(`Only ${w.rating_count} ratings so far, so the average is not yet reliable.`);
  }
  // Only meaningful for a record that came from a listing. A catalogue entry
  // never had review data to lose, so saying we failed to capture it is noise.
  if ((w.rating_count === null || w.rating_count === undefined) && w.source_page !== 'catalogue') {
    out.push('No rating count captured, so we cannot judge how settled the reviews are.');
  }
  if (w.source_page === 'catalogue' && !w.asin) {
    out.push('We have not matched this to a specific Amazon listing yet, so check the exact reference and seller before buying.');
  }
  return out;
}

/** One-line summary. Dry, factual, no adjectives we cannot support. */
export function draftBlurb(w) {
  const r = rng(seedFrom(w.asin || w.title || 'x'));
  const noun = styleNoun(w);
  const brand = w.brand || 'This';

  // Skip the movement word when the style noun already contains it, or we get
  // "a digital digital watch".
  const mvRaw = MOVEMENT_PHRASE[w.movement] || '';
  const mv = mvRaw && !noun.toLowerCase().includes(mvRaw.toLowerCase()) ? mvRaw : '';

  const size = w.case_mm ? `${w.case_mm} mm` : '';

  // Every opener has to survive a missing case size and a missing movement,
  // which is the common case on a thin listing.
  const openers = [
    size
      ? `${brand} ${noun} in a ${size} case${mv ? `, ${mv}` : ''}.`
      : `${brand} ${noun}${mv ? `, ${mv}` : ''}.`,
    size ? `A ${size} ${mv ? mv + ' ' : ''}${noun} from ${brand}.` : `A ${mv ? mv + ' ' : ''}${noun} from ${brand}.`,
    `${brand}'s ${noun}: ${[size ? `${size} case` : '', mv || 'movement not stated'].filter(Boolean).join(', ')}.`,
  ];
  const pros = draftPros(w);
  const lead = pros.length ? ' ' + pros[0] : '';
  return (pick(openers, r) + lead).replace(/\s+/g, ' ').trim();
}

/** Long-form body. Structured, short paragraphs, all claims traceable. */
export function draftLongDescription(w) {
  const tier = tierById(w.tier);
  const style = styleById(w.style);
  const fromCatalogue = w.source_page === 'catalogue';
  const paras = [];

  // Deliberately does NOT open with draftBlurb. The blurb is already rendered
  // as the lede directly above the body, and repeating it verbatim two
  // paragraphs apart is the tell of a generated page.

  if (style) paras.push(`**Where it sits.** ${style.blurb}${tier ? ` This one falls in our ${tier.title} band.` : ''}`);

  const specs = [];
  if (w.movement) specs.push(`movement: ${w.movement}`);
  if (w.case_mm) specs.push(`case: ${w.case_mm} mm`);
  if (w.water_resistance_m) specs.push(`water resistance: ${w.water_resistance_m} m`);

  if (specs.length) {
    // Where the specification came from is not decoration. A catalogue entry
    // was never read off a listing, and saying it was would be untrue.
    const provenance = fromCatalogue
      ? 'Taken from the published specification for this model, not from a particular listing and not from hands-on measurement. Confirm it against the listing you buy from: regional variants differ.'
      : 'Taken from the Amazon listing at the time of checking, not from hands-on measurement.';
    paras.push(`**Stated specification.** ${specs.join(', ')}. ${provenance}`);
  }

  paras.push(
    fromCatalogue
      ? '**What we have not done.** We have not handled this watch, and we have not tied it to one specific listing yet. Everything above comes from the model\'s published specification, and we say so rather than implying a review we did not carry out.'
      : '**What we have not done.** We have not handled this watch. Everything above is read off the listing and the spec sheet, and we say so rather than implying a review we did not carry out.'
  );
  return paras.join('\n\n');
}

/* ------------------------------------------------------------------ *
 * Social pack generation
 * ------------------------------------------------------------------ */

const HOOKS = [
  (w) => `Everyone asks what to buy in ${styleNounPlural(w)}. Here is the boring, correct answer.`,
  (w) => `Three things to check on a ${styleNoun(w)} before you spend anything.`,
  (w) => `${w.brand} put a ${w.movement ? w.movement + ' movement' : 'movement'} in this. Here is what that actually gets you.`,
  (w) => `This ${styleNoun(w)} is on the list for one reason, and it is not the looks.`,
  (w) => `The spec sheet on this ${styleNoun(w)} does something most of its rivals do not.`,
  (w) => `Not the flashiest ${styleNoun(w)} on the shelf. Still the one we would pick.`,
];

const CTAS = [
  'Full write-up and the link are on the site — link in bio.',
  'Specs, caveats and the link are in the bio.',
  'The whole shortlist, with the caveats, is linked in bio.',
];

const PLATFORM_SPEC = {
  tiktok: { name: 'TikTok', aspect: '9:16', captionMax: 2200, style: 'Cut hard on every beat. Text on screen for each spec. No music bed louder than voice.' },
  reels: { name: 'Instagram Reels', aspect: '9:16', captionMax: 2200, style: 'First frame must carry the hook as on-screen text; most viewers watch muted.' },
  shorts: { name: 'YouTube Shorts', aspect: '9:16', captionMax: 1000, style: 'Slightly longer runway. Say the brand and model out loud in the first 3 seconds for search.' },
};

function beatsFor(w, seconds) {
  const pros = draftPros(w).slice(0, 3);
  const cons = draftCons(w).slice(0, 1);
  const beats = [];
  let t = 3;
  const per = Math.max(3, Math.floor((seconds - 8) / Math.max(1, pros.length + cons.length)));

  for (const p of pros) {
    beats.push({ at: `${t}s`, line: p, onScreen: onScreenFrom(p) });
    t += per;
  }
  for (const c of cons) {
    beats.push({ at: `${t}s`, line: `The catch: ${c.charAt(0).toLowerCase() + c.slice(1)}`, onScreen: 'The catch' });
    t += per;
  }
  return { beats, endsAt: t };
}

export function videoScript(w, platform, index) {
  const r = rng(seedFrom(w.asin + platform));
  const seconds = config.social.videoSeconds[platform] || 30;
  const spec = PLATFORM_SPEC[platform];
  const hook = pick(HOOKS, r)(w);
  const { beats, endsAt } = beatsFor(w, seconds);

  return {
    watch_id: w.id,
    asin: w.asin,
    platform,
    platform_name: spec.name,
    target_seconds: seconds,
    aspect: spec.aspect,
    direction: spec.style,
    hook: { at: '0s', line: hook, onScreen: onScreenFrom(hook) },
    beats,
    cta: { at: `${Math.max(endsAt, seconds - 5)}s`, line: pick(CTAS, r), onScreen: 'Link in bio' },
    spoken_word_count: [hook, ...beats.map((b) => b.line)].join(' ').split(/\s+/).length,
    shot_notes: [
      'Product footage must be your own. Do not reuse Amazon listing photography.',
      'If you do not have the watch in hand, use a text-card cut with the spec on screen instead of any product image.',
      'On-screen disclosure required: the word "affiliate" or "#ad" visible in the first 3 seconds.',
    ],
    order: index,
  };
}

/**
 * Image prompts deliberately never describe the specific product.
 * Generating a synthetic photo of a real watch would be a fabricated
 * product image, and viewers would reasonably read it as the real thing.
 * These prompts produce backdrops and text-card grounds only.
 */
export function imagePrompts(w) {
  const r = rng(seedFrom(w.asin + 'img'));
  const moods = [
    'low-key studio backdrop, charcoal seamless paper, single soft key light from upper left, deep shadow falloff, no products in frame',
    'flat overhead surface of brushed dark steel, cool grey tone, subtle directional grain, empty composition with copy space centre',
    'matte black slate texture with a faint warm rim light along the top edge, generous negative space, no objects',
    'dark walnut desk surface, shallow depth of field, muted warm highlights in the far corner, entirely empty frame',
  ];
  return [
    {
      purpose: 'title card background',
      prompt: `${pick(moods, r)}. 9:16 vertical. Photographic, neutral colour grade, no text, no watches, no logos, no people.`,
      negative: 'watch, wristwatch, product, logo, brand mark, text, hands, person, Amazon',
      note: 'Overlay the watch name and spec as type. The product itself must be your own photograph or absent.',
    },
    {
      purpose: 'spec card background',
      prompt: `${pick(moods, r)}. 9:16 vertical, darker overall exposure so white type reads cleanly. No text, no watches, no logos.`,
      negative: 'watch, product, logo, text, clutter',
      note: 'Used behind the three spec beats.',
    },
    {
      purpose: 'end card background',
      prompt: `${pick(moods, r)}. 9:16 vertical, slightly brighter centre to hold a call to action. No text, no watches, no logos.`,
      negative: 'watch, product, logo, text',
      note: 'Used behind the CTA and the affiliate disclosure.',
    },
  ];
}

export function caption(w, platform) {
  const r = rng(seedFrom(w.asin + platform + 'cap'));
  const spec = PLATFORM_SPEC[platform];
  const pros = draftPros(w);
  const cons = draftCons(w);
  const lines = [];

  lines.push(pick(HOOKS, r)(w));
  lines.push('');
  if (pros[0]) lines.push(`- ${pros[0]}`);
  if (pros[1]) lines.push(`- ${pros[1]}`);
  if (cons[0]) lines.push(`- Caveat: ${cons[0].charAt(0).toLowerCase() + cons[0].slice(1)}`);
  lines.push('');
  lines.push('No price quoted on purpose — it moves. Check the current one on the listing.');
  lines.push(pick(CTAS, r));
  lines.push('');
  lines.push(`${config.social.requiredDisclosureTag} Affiliate link — we may earn a commission at no extra cost to you.`);

  const text = lines.join('\n');
  return { platform, text, length: text.length, limit: spec.captionMax, withinLimit: text.length <= spec.captionMax };
}

export function hashtags(w) {
  const s = config.social.hashtagStrategy;
  const broad = ['#watches', '#watchtok', '#wristwatch', '#horology'];
  const nicheByStyle = {
    diver: ['#divewatch', '#diverwatch', '#toolwatch', '#skxmods'],
    field: ['#fieldwatch', '#toolwatch', '#militarywatch', '#everydaycarry'],
    pilot: ['#pilotwatch', '#fliegerwatch', '#aviationwatch', '#toolwatch'],
    dress: ['#dresswatch', '#classicwatch', '#watchstyle', '#minimalwatch'],
    chronograph: ['#chronograph', '#chronowatch', '#racingwatch', '#watchspec'],
    digital: ['#gshock', '#digitalwatch', '#casio', '#everydaycarry'],
    gmt: ['#gmtwatch', '#travelwatch', '#dualtime', '#toolwatch'],
  };
  const niche = nicheByStyle[w.style] || ['#affordablewatches', '#watchcollector', '#watchreview', '#toolwatch'];
  const brandTag = w.brand ? '#' + String(w.brand).toLowerCase().replace(/[^a-z0-9]/g, '') : null;
  const tierTag = w.tier === 'entry' || w.tier === 'core' ? '#affordablewatches' : '#watchcollection';

  const tags = [
    ...broad.slice(0, s.broad),
    ...niche.slice(0, s.niche),
    ...[brandTag, tierTag].filter(Boolean).slice(0, s.brand),
  ];
  return [...new Set(tags)].slice(0, s.max);
}

/**
 * Posting schedule.
 *
 * One slot = one publishing action across all three platforms on the same
 * day. Five watches take five slots; the roundup takes one; the remainder
 * are re-cuts of whichever entries performed, decided by the human.
 */
export function schedule(watches, startDate = new Date()) {
  const { scheduleDays, postsPerWeek, postTimesLocal } = config.social;
  const slots = [];
  const wanted = Math.max(1, Math.round((postsPerWeek / 7) * scheduleDays));

  let day = 0;
  while (slots.length < wanted && day < scheduleDays) {
    const d = new Date(startDate.getTime() + day * 86400000);
    const dow = d.getUTCDay();
    // Skip Sunday: engagement on watch content is reliably worst there.
    if (dow !== 0) {
      const time = postTimesLocal[slots.length % postTimesLocal.length];
      slots.push({ date: d.toISOString().slice(0, 10), time_local: time });
    }
    day += Math.max(1, Math.round(7 / postsPerWeek));
  }

  const plan = slots.map((slot, i) => {
    if (i < watches.length) {
      const w = watches[i];
      return {
        ...slot,
        slot: i + 1,
        type: 'single',
        watch_id: w.id,
        asin: w.asin,
        label: fullName(w).slice(0, 80),
        platforms: config.social.platforms,
      };
    }
    if (i === watches.length) {
      return { ...slot, slot: i + 1, type: 'roundup', watch_id: null, asin: null, label: 'All five, ranked, 45s', platforms: config.social.platforms };
    }
    const w = watches[(i - watches.length - 1) % watches.length];
    return {
      ...slot,
      slot: i + 1,
      type: 're-cut',
      watch_id: w.id,
      asin: w.asin,
      label: `Re-cut of ${w.brand} with a different hook — swap for a better performer if one emerged`,
      platforms: config.social.platforms,
    };
  });

  return plan;
}

export function roundupScript(watches) {
  return {
    platform: 'all',
    target_seconds: 45,
    aspect: '9:16',
    hook: { at: '0s', line: `Five watches, ranked. Number one is not the most expensive.`, onScreen: 'Five, ranked' },
    beats: watches.map((w, i) => ({
      at: `${3 + i * 7}s`,
      line: `${watches.length - i}. ${w.brand}. ${(draftPros(w)[0] || 'See the site for the spec.').replace(/\.$/, '')}.`,
      onScreen: `${watches.length - i}. ${w.brand}`,
    })),
    cta: { at: '40s', line: 'All five, with the caveats, linked in bio.', onScreen: 'Link in bio' },
    shot_notes: [
      'Count down, do not count up — the reveal has to land last.',
      'Own footage or text cards only.',
      'Disclosure on screen in the first 3 seconds.',
    ],
  };
}
