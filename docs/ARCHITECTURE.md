# Architecture

## 1. System overview

```
   YOU                          MACHINE                        PUBLIC
   ───                          ───────                        ──────

   Save Amazon page
   into inbox/  ──────────▶  npm run ingest
                             adapters/html-file.mjs
                             ├ dedupe by ASIN
                             ├ cap at 50/run
                             ├ classify style/movement/tier
                             └ draft blurb, pros, cons, tags
                                       │
                                       ▼
                             content/pending/*.json
                                       │
   npm run curate ◀────────────────────┤
   localhost:4331                      │
   ├ read the facts                    │
   ├ write the blurb                   │
   ├ confirm or rewrite drafts         │
   └ approve ──────────────────────────┤
                                       ▼
                             content/watches/*.md
                                       │
                          ┌────────────┼────────────┐
                          ▼            ▼            ▼
                   npm run build  npm run social  Decap CMS
                   Astro          pack generator  /admin (local)
                          │            │
                          ▼            ▼
                   dist/ ──────▶  Cloudflare Pages ──▶ readers
                             content/social/*.md ──▶ you upload by hand
```

Nothing crosses a boundary on its own. Ingestion does not publish; the pack
generator does not post; the deploy happens because you pushed.

## 2. Hard constraints and where each is enforced

| Constraint | Enforced by |
|---|---|
| Free hosting only | Static output, `dist/`, Cloudflare Pages free tier |
| Free CMS only | Decap, git-based, `public/admin/config.yml` |
| No Amazon API | `adapters/html-file.mjs` reads a local file; PA-API adapter throws |
| No dynamic JS scraping | Adapters parse static HTML text only |
| No reviews or descriptions ingested | No pattern in `FIELD_PATTERNS` matches them |
| Max 50 items per scrape | `ingestion.maxItemsPerScrape`, hard ceiling in `ingest.mjs` |
| Dedupe by ASIN | `knownAsins()` spans all three states |
| Only approved watches appear | Astro reads `content/watches` only |
| Human text before approval | `readyToApprove()` in `compliance.mjs` |
| Zero per-run content cost | `copy.mjs` is deterministic, no network |

## 3. Data models

As implemented. `content.config.ts` validates the approved set at build time
and fails the build on drift.

### Watch

`content/pending/*.json`, `content/rejected/*.json` (JSON) ·
`content/watches/*.md` (frontmatter + Markdown body)

| Field | Type | Notes |
|---|---|---|
| `id` | string | `watch-{asin lowercased}` |
| `asin` | string | `^[A-Z0-9]{10}$`, the primary key |
| `title` | string | Display title, trimmed from Amazon's keyword soup |
| `full_title` | string | Untrimmed listing title. Spec detection reads this; never rendered |
| `brand` | string | Detected against a known-brand list, human-confirmed |
| `style` | enum | diver, field, pilot, dress, chronograph, digital, gmt |
| `movement` | enum | automatic, hand-wound, quartz, solar, kinetic, digital |
| `tier` | enum | entry, core, upper, top — derived from `price_value` |
| `case_mm` | number\|null | Only when the listing stated it |
| `water_resistance_m` | number\|null | Only when the listing stated it |
| `image` | string | Filename in `public/images/watches/`. Your photo, not Amazon's |
| `source_image_url` | string | Listing image URL, reference only, never rendered |
| `price_display` | string | e.g. `£229.00` |
| `price_value` | number\|null | Numeric, drives tier and sorting |
| `price_checked_at` | ISO\|null | Drives the 24-hour expiry |
| `rating` | number\|null | 0–5 |
| `rating_count` | number\|null | Confidence weight in top-5 scoring |
| `scraped_url` | string | Canonical `/dp/{asin}`, no affiliate tag |
| `source_page` | string | Provenance of the ingest |
| `scraped_at` / `approved_at` | ISO | |
| `short_blurb` | string | **Required to approve.** Curated text |
| `long_description` | markdown | The Markdown body of the file |
| `pros[]` / `cons[]` | string[] | Fact-gated drafts, human-confirmed |
| `tags[]` | string[] | Confirmed tags |
| `suggested_tags[]` | string[] | Proposed by ingestion, promoted by hand |
| `featured` | boolean | Homepage placement. Editorial, never commercial |
| `drafts[]` | string[] | Fields still unreviewed. **Non-empty blocks approval** |
| `status` | enum | pending \| approved \| rejected |

`amazon_affiliate_link` is deliberately **not** stored. It is derived at render
time from `asin` + the configured tag (`src/lib/site.ts`), so rotating your tag
is a one-line change rather than a rewrite of every content file.

### Collection — `content/collections/{slug}.json`

`id`, `title`, `slug`, `intro_text`, `watch_ids[]` (order is the displayed
ranking), `updated_at`. Watch ids that are no longer approved are skipped at
build rather than rendering a dead card.

### Comparison — `content/comparisons/{slug}.json`

`id`, `title`, `slug`, `watch_a`, `watch_b`, `asin_a`, `asin_b`,
`summary_winner`, `key_differences[]` as `{field, a, b}`, `updated_at`.

`key_differences` is auto-filled from stored facts, and only where the two
listings actually stated *different* values. Fields neither listing specified
are omitted rather than invented.

### SocialPack — `content/social/pack-{date}-{slug}.json` + `.md`

`id`, `title`, `created_at`, `tone`, `selected_watch_ids[5]`, `ranking[]`,
`video_scripts[]` (5 watches × 3 platforms), `roundup_script`,
`image_prompts[]`, `captions[]`, `hashtags[]`, `posting_schedule[]`,
`compliance{}`.

## 4. Ingestion pipeline

```
inbox/*.html ─▶ splitResults()      one block per data-asin, no back-off
             ─▶ firstMatch()        multi-pattern, per field, with fallbacks
             ─▶ toPendingWatch()    normalise; detect from full_title
             ─▶ suggestTags()       proposals only
             ─▶ draftPros/Cons/Blurb
             ─▶ dedupe vs all three states
             ─▶ content/pending/{slug}-{asin}.json
             ─▶ logs/ingest/{ts}.json   parse report
```

The parse report is the debugging surface. It prints blocks found, rows kept,
per-field hit rate and skip reasons, so a markup change shows up as
`field hit rate: title 24, price 0` rather than silently empty records.

Two deliberate details, both found by testing against a fixture:

- Result blocks start **at** the `data-asin` marker, not before it. Backing off
  even 400 characters pulls in the previous product's tail, and every field is
  then read off the wrong watch.
- Spec detection runs on `full_title`, not the display title. Amazon puts case
  size and water resistance in the keyword tail that the display title trims.

## 5. Curation state machine

```
        ┌──────── restore ────────┐
        ▼                         │
    pending ──── approve ────▶ approved
        │                         │
        └──── reject ────▶ rejected ◀── reject (unpublish)
                              │
                           delete (permanent, rejected-only)
```

File format differs by state on purpose: pending and rejected are machine
records (JSON), approved watches are Markdown so Decap can edit prose.

Guards, all in `scripts/lib/`:

- Approve requires: valid ASIN, title, brand, non-empty `short_blurb`, and
  `drafts[]` empty. Copy passes the banned-phrase and price-in-copy lint.
- Delete is refused unless the record is already rejected.
- Bulk approve applies the same per-record gate; blocked records are reported
  rather than skipped silently.
- The dashboard binds to `127.0.0.1` and rejects cross-origin requests. It has
  no auth because it has no network surface, and it is never deployed.

## 6. Static site

| Route | Source |
|---|---|
| `/` | featured or most recent, tier grid, style index, collections |
| `/watches` | everything, cheapest first |
| `/watches/{slug}-{asin}` | detail: specs, pros/cons, prose, buy button, related |
| `/tier/{entry,core,upper,top}` | price band |
| `/style/{diver,field,…}` | style |
| `/collections`, `/collections/{slug}` | curated groupings |
| `/compare/{slug}` | head-to-head table |
| `/disclosure` | affiliate and editorial disclosure |

Price display has two gates. `Price.astro` decides at build time whether to
emit a price at all; `public/price-guard.js` re-checks in the browser against
the visitor's clock and swaps in *"Check current price on Amazon"* once the
window passes. The build-time check alone is not enough — a page built on
Monday would still be asserting Monday's price on Wednesday.

## 7. Social funnel

```
5 approved watches
   ├ videoScript(w, platform)   ×3 platforms  hook / 3 beats / catch / CTA
   ├ imagePrompts(w)            backgrounds only, never the product
   ├ caption(w, platform)       disclosure enforced by lint
   ├ hashtags(w)                2 broad + 4 niche + 2 brand, capped at 8
   ├ roundupScript(all 5)       counts down, 5 first and 1 last
   └ schedule(all 5)            10 slots over 14 days, Sundays skipped
                ▼
   lintCaption / lintCopy  ──▶ compliance.issues[]
                ▼
   content/social/pack-*.json  +  pack-*.md
                ▼
   you upload by hand
```

Two content rules that are not obvious:

**No prices in social copy.** A caption naming a price is stale the moment the
listing moves, and stale prices breach the Associates terms. `lintCopy` rejects
any price-shaped string. Captions say "check the current price" instead.

**Image prompts never describe the watch.** Generating a synthetic photograph of
a real product would be a fabricated product image, and a viewer would
reasonably read it as the real thing. The prompts produce backdrops and
text-card grounds; the product is your own photograph or absent.

## 8. Top-5 selection

`npm run social -- --suggest` scores approved watches and prints the working:

| Term | Weight |
|---|---|
| Rating | `max(0, rating − 4.0) × count/(count+100) × 10` |
| Water resistance ≥ 100 m | +4 |
| Automatic, hand-wound or solar | +3 |
| Sapphire stated | +3 |
| Price band | entry +4, core +5, upper +2, top 0 |
| Open caveats | −1 each, capped at −3 |

Rating is measured from 4.0, not 0. Almost every watch on Amazon sits between
4.2 and 4.8, so scoring the absolute value swamps every other term and the
ranking collapses into "sort by rating".

Commission rate is not an input, and there is no field to put it in.

The ranking is a suggestion with its arithmetic shown so you can disagree with
it. The pack is only written when you pass `--asins` explicitly.

## 9. Build and deploy

```
git push ──▶ Cloudflare Pages ──▶ npm ci ──▶ npm run build ──▶ dist/
```

Build command `npm run build`, output directory `dist`, Node 22.
`npm run verify` runs in CI on every push and fails the build on: unconfirmed
drafts in approved content, duplicate ASINs, a price without a timestamp, an
image pointing at an Amazon URL, `price.maxAgeHours` above 24.

## 10. Extension points

| You want to | Change |
|---|---|
| A different marketplace | `affiliate.marketplace` and `currency` |
| Different price bands | `taxonomy.tiers` — pages and filters follow |
| A new style | `taxonomy.styles` + a rule in `STYLE_RULES` |
| Switch to PA-API | Implement `adapters/paapi.mjs`, set `ingestion.adapter` |
| Real product photos | Drop files in `public/images/watches/`, set `images.mode` to `local` |
| Different tone | `social.tone`, and the template arrays in `copy.mjs` |
| Bigger or smaller packs | `social.packSize` |
| Hosted browser admin | GitHub OAuth proxy, `base_url` in `admin/config.yml`, drop the `_redirects` rule |
