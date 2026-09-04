# Operations

## First deploy

Hosting is GitHub Pages. No account beyond the GitHub one you already have,
no card, no dashboard to configure.

**One-time setup**

Repository → **Settings** → **Pages** → **Source** → **GitHub Actions**.

That is the whole thing. `.github/workflows/deploy.yml` builds and publishes on
every push to `main`, running the OAuth tests, `npm run verify` and
`npm run audit` first so a compliance failure cannot reach the public site.

The site is at:

    https://percymmg.github.io/regulated-watches

**Before the first real deploy**

Set `affiliate.associateTag` in `site.config.json`. Until then every Amazon
link is an ordinary untagged link: publishable, but earning nothing.

**What GitHub Pages cannot do**

- **Custom HTTP headers.** `public/_headers` is inert here. `Base.astro`
  carries a `<meta>` CSP as partial cover, but `frame-ancestors` cannot be
  expressed in meta, so there is no clickjacking protection until the site
  moves to a host with real headers.
- **Serverless functions.** No hosted CMS login — see below.

Both come back unchanged on Cloudflare Pages or Netlify if you ever want them.

## Hosted admin — not available, and do not set it up

**Do not create a GitHub OAuth app for this site.**

An earlier version of this document told you to register the callback URL
`https://regulated.pages.dev/api/callback`. That domain is not ours and never
was — it belongs to someone else. Registering it would have sent your GitHub
authorisation codes to a stranger. If you already created that OAuth app,
delete it: github.com → Settings → Developer settings → OAuth Apps.

Browser-based editing needs the OAuth proxy in `functions/api/`, and GitHub
Pages runs no server code, so it cannot work here at all.

**Curate locally instead:**

```bash
npm run dev
```

| | |
|---|---|
| `http://localhost:4321` | the site |
| `http://localhost:4321/curate` | the dashboard — approve, reject, images, social packs |

That dashboard is more capable than the hosted CMS would have been: Decap
cannot model the pending queue, the review gate or the Top-5 packs.

If you later move to a host that runs functions (Cloudflare Pages, Netlify),
`functions/api/` is written and tested — 17 tests in `npm run test:oauth`. At
that point, and only then, create the OAuth app with a callback on **the domain
you actually control**.

## The weekly loop

Budget: about 90 minutes a week once you have the rhythm.

### Monday — ingest (10 min)

Open two or three Amazon category pages. Ctrl+S each as **Webpage, HTML Only**
into `inbox/`.

```bash
npm run ingest
```

Read the parse report. `field hit rate: title 24, price 0` means Amazon changed
its markup — fall back to the list adapter rather than fighting it:

```bash
npm run ingest -- --adapter asin-list --file inbox/asins.txt
```

Delete the saved pages afterwards. They are gitignored, but they are large.

### Monday — curate (40 min)

```bash
npm run dev
```

Starts the site and the dashboard together on one port:

| | |
|---|---|
| `http://localhost:4321` | the site |
| `http://localhost:4321/curate` | the dashboard |

There is a **Curate →** link in the site header and Preview / Live site
links in the dashboard header, so you can move between them without
switching tabs. Ctrl+C stops both.

`npm run curate` still runs the dashboard on its own at :4331 if you want it
without the site.

**The dashboard is local-only, and must stay that way.** It writes directly
into your working tree and has no login, because it has no network surface:
it binds to loopback, pins the Host header, checks Origin, and refuses any
request whose forwarded client address is not loopback. That last check is
what stops `astro dev --host` — which you might reach for to preview on a
phone — from putting a filesystem-writing admin on your network. It is never
built into `dist/`, so it cannot reach production at all.

Ten watches is a good week. Per watch, roughly two minutes:

1. Check brand, style, movement and case size against the listing. Detection is
   good, not perfect.
2. Rewrite the blurb in your own words. The drafted one is a scaffold and it
   reads like one.
3. Read the drafted pros and cons. Delete any you cannot stand behind. The
   "not stated in the listing" cons are the honest ones — keep them.
4. Promote the suggested tags you agree with.
5. Approve.

Reject freely. A rejected watch is one line of JSON and restoring it is a click.

### Wednesday — collections and comparisons (15 min)

A collection should answer one question: *"best diver under £200"*, not
*"nice watches"*. Order matters — it renders as a ranking.

A comparison needs two approved watches. The difference table fills itself from
stored specs; you write the verdict.

### Thursday — social pack (15 min)

```bash
npm run social -- --suggest
```

Read the working. If you disagree with the ordering, use your own:

```bash
npm run social -- --asins B01,B02,B03,B04,B05 --title "Five divers worth the money"
```

Work from `content/social/pack-*.md`. It has the scripts with timings, the
on-screen text, the captions ready to paste, the hashtags and the calendar.

Filming: your own footage, or text cards. Never Amazon's listing photography,
and never an AI-generated image of a real watch.

### Friday — ship (5 min)

```bash
npm run verify && npm run build
git add -A && git commit -m "Week of ..." && git push
```

`verify` failing is a stop sign, not advice. It fails on things that are
expensive on a live affiliate site.

---

## When something breaks

| Symptom | Cause | Fix |
|---|---|---|
| `product blocks found: 0` | Not a results page, or saved as MHTML | Re-save as "Webpage, HTML Only" |
| `field hit rate: price 0` | Amazon changed markup | Use `--adapter asin-list`, then add the new pattern to `FIELD_PATTERNS` |
| "Cannot approve: unconfirmed drafts" | Working as designed | Review each drafted field in the dashboard |
| Buy buttons say "Link not configured" | `associateTag` still the placeholder | Set it in `site.config.json` |
| Prices show "Check current price" | Older than 24h | Re-ingest. This is correct behaviour, not a bug |
| Build fails on a content file | Frontmatter drifted from the schema | The error names the file and field |
| Collection page has fewer cards | A watch was unpublished | Expected — dead ids are skipped, `verify` warns |
| An unpublished watch is still on the built site | Stale Astro content store | `npm run build` clears it automatically (`prebuild`). If you ran `astro build` directly, delete `node_modules/.astro/data-store.json` |

---

## Optimisation plan

Ordered by return on effort. Do not start the next one until the current one is
actually running.

### Phase 1 — get to 30 watches (weeks 1–3)

Nothing else matters at ten watches: there is not enough to link between, and
search has nothing to rank. Two tiers deep in two styles beats one of
everything. `entry` and `core` first — that is where the volume is.

**Done when:** 30 approved, four collections, three comparisons.

### Phase 2 — earn the clicks (weeks 4–6)

Comparison pages convert best because they catch people who have already
decided to buy and are choosing between two. Build one for every pair you have
that a buyer would genuinely cross-shop.

Add your own photographs. A real photo of a watch on a wrist is the single
biggest lift available here, and it is the only thing that makes the placeholder
cards go away. Set `images.mode` to `local` once you have them.

**Done when:** every core-tier watch has a photo and appears in at least one
comparison.

### Phase 3 — the social loop (weeks 6+)

One pack a fortnight, posted on the schedule the pack generates. Track which
hooks land. The template arrays in `copy.mjs` are ordinary arrays — add hooks
that worked, delete ones that did not.

Do not automate posting. Beyond the platform terms, the failure mode of an
automated poster is publishing something wrong at scale, and there is no upside
here that justifies it.

**Done when:** you know which two hooks outperform, and the arrays reflect it.

### Phase 4 — PA-API (after three qualifying sales)

At three qualifying sales in 180 days you become eligible. That unlocks:

- prices and images direct from Amazon, both redistributable
- unattended scheduled ingestion, because it is an API call not a saved file
- accurate availability, so you stop linking to things that are out of stock

Implement `adapters/paapi.mjs` against the interface that is already there.
Nothing else in the pipeline changes.

**Done when:** `ingestion.adapter` is `paapi` and ingestion runs on a cron.

### What not to do

- **Do not add a database.** The moment content lives anywhere but git you have
  a backup problem, a migration problem and a hosting bill.
- **Do not auto-approve.** The gate is the product. A site that publishes
  whatever a parser produced is indistinguishable from the thousands of
  auto-generated affiliate sites that rank nowhere.
- **Do not rank by commission.** Beyond the disclosure problem, it is the one
  change that makes every other page on the site less trustworthy.
- **Do not add a paid tier of anything** without re-reading the cost table in
  the README. The whole design holds together because nothing recurs.
