# Compliance

What the Amazon Associates programme requires, how this repository enforces it,
and where to look when you want to change something.

This is an engineering document, not legal advice. The Associates Operating
Agreement is the authority and it changes; re-read it before you scale up.

---

## The four rules that terminate accounts

### 1. Prices must be current or absent

**Rule.** Price information must come from the Product Advertising API and must
be refreshed or removed within 24 hours. A stale displayed price is the single
most common cause of account termination.

**Enforced by.**

| Where | What it does |
|---|---|
| `site.config.json` → `price.maxAgeHours` | 24. `verify.mjs` fails the build if raised above it |
| `src/components/Price.astro` | Build-time gate — a stale price is never emitted |
| `public/price-guard.js` | Browser gate — re-checks against the visitor's clock, swaps in the fallback |
| `scripts/verify.mjs` | Errors on a price with no timestamp; warns on stale prices |
| `scripts/lib/compliance.mjs` → `lintCopy` | Rejects prices in blurbs, captions and scripts entirely |

Both gates are needed. The build-time one alone means a page built on Monday
keeps asserting Monday's price on Wednesday.

**If you change nothing else, do not change this.**

### 2. Product images come from PA-API or not at all

**Rule.** Listing images may only be used through PA-API or an approved link
builder. Hotlinking or re-hosting them is not permitted.

**Enforced by.** `images.mode` defaults to `placeholder`. `Thumb.astro` renders
a typographic card and never emits an Amazon URL. `source_image_url` is stored
for your reference and is never rendered. `verify.mjs` errors if `image` is ever
set to an Amazon URL.

**To use real images:** photograph the watch yourself, drop it in
`public/images/watches/{asin}.jpg`, set `images.mode` to `local`. Or reach
PA-API eligibility and switch to `paapi`.

### 3. No implied endorsement, no trademark misuse

**Rule.** You may not imply Amazon endorses, sponsors or reviews your site, use
Amazon's marks in your site name, logo or domain, or present "Amazon" as a badge.

**Enforced by.** `compliance.bannedCopyPhrases` blocks "official amazon",
"amazon official", "endorsed by amazon", "amazon recommends". The
`AMAZON_ENDORSEMENT` pattern in `compliance.mjs` catches "Amazon's Choice/
approved/verified/recommended" constructions. The site name contains no Amazon
mark. `Base.astro` carries the trademark attribution in the footer of every page.

### 4. Disclosure on every page and every post

**Rule.** Affiliate relationships must be disclosed clearly and conspicuously.
This is FTC/ASA law as well as an Associates requirement.

**Enforced by.** `Base.astro` puts the long disclosure in the footer of every
page. `BuyButton.astro` puts the short one next to every link. `/disclosure` is
a full page. `lintCaption` refuses any social caption without `#ad`. Every
generated video script carries an on-screen disclosure in its shot notes.

---

## Scraping

Amazon's Conditions of Use prohibit automated scraping. This repository sends
**no automated requests to Amazon at all**:

- `adapters/html-file.mjs` reads a file from your disk.
- `adapters/asin-list.mjs` reads a text file.
- `adapters/paapi.mjs` throws until implemented, and PA-API is the sanctioned
  route anyway.

There is no HTTP client in the ingestion path. Verify with:

```bash
grep -rn "fetch\|https\.get\|axios" scripts/
```

The only `fetch` in the repo is in the dashboard's browser code, calling
`127.0.0.1`.

## Copyrighted content

Reviews and product descriptions are Amazon's or the manufacturer's copyrighted
content. No pattern in `FIELD_PATTERNS` matches either. What is ingested is:
ASIN, title, brand, price, star rating, rating count, image URL. Facts and
short identifiers.

Descriptions on this site are written by the copy engine from stored facts, or
by you.

---

## Claims we can support

Beyond Amazon's rules, the copy engine will not assert what the data does not
support:

- Every pro and con is gated on a fact being present on the record. No fact, no
  sentence.
- Missing facts become explicit caveats — *"Crystal material is not confirmed in
  the listing"* — rather than optimistic guesses.
- `SUPERLATIVE` in `compliance.mjs` warns on "the best", "unbeatable",
  "flawless", "nothing comes close".
- "Swiss made" is a banned phrase: it is a legally regulated designation and
  Amazon listings use it loosely.
- Every watch page states plainly that we have not handled the watch.

## Ranking integrity

Commission rate is not an input to any ranking, and there is no field to store
it in. The top-5 scorer prints its full arithmetic (`npm run social -- --suggest`)
so any ordering can be audited. `featured` is editorial and earns nothing extra.

---

## Pre-deploy check

```bash
npm run verify
```

Errors — build must not ship:

- unconfirmed drafts in approved content
- a price with no timestamp
- `image` pointing at an Amazon URL
- `price.maxAgeHours` above 24
- duplicate ASIN across states
- banned phrase in published copy
- missing `price-guard.js`, `_headers`, `robots.txt` or `/disclosure`

Warnings — advisory:

- placeholder Associates tag
- stale prices
- empty collections, dead references
- unresolved compliance issues in a social pack

---

## If Amazon changes the rules

The enforcement points are deliberately few and named:

| Concern | File |
|---|---|
| Price window | `site.config.json` → `price.maxAgeHours` |
| Banned language | `site.config.json` → `compliance.bannedCopyPhrases` |
| Lint logic | `scripts/lib/compliance.mjs` |
| Publish gate | `scripts/lib/compliance.mjs` → `readyToApprove` |
| Image policy | `site.config.json` → `images.mode`, `src/components/Thumb.astro` |
| Disclosure text | `site.config.json` → `affiliate.disclosure*` |

A rule change should be a config edit or a single-function change, not a hunt
through the codebase.
