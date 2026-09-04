# Operations

## First deploy

You need a GitHub repository and a Cloudflare account. Both free.

**1. Push the repository**

```bash
gh repo create regulated-watches --private --source=. --push
```

**2. Connect Cloudflare Pages**

Cloudflare dashboard → Workers & Pages → Create → Pages → Connect to Git →
pick the repo, then:

| Setting | Value |
|---|---|
| Framework preset | Astro |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Node version | `22` (env var `NODE_VERSION=22`) |

**3. Set your Associates tag before the first real deploy**

`site.config.json` → `affiliate.associateTag`. Then update `site.url` to the
domain Pages gives you, so canonical tags and the sitemap point at the right
place.

**4. Optional: daily rebuild**

Pages → Settings → Builds & deployments → Deploy hooks → create one. Add the
URL as the GitHub secret `CF_DEPLOY_HOOK`. The workflow in
`.github/workflows/daily-rebuild.yml` picks it up. Without the secret it exits
cleanly and costs nothing.

---

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
npm run curate
```

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
