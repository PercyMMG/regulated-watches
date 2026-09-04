# Shortlist

A zero-cost, human-curated Amazon affiliate watch site.

Astro static site · Decap CMS · local curation dashboard · deterministic social-content engine.
No server, no database, no paid API, no paid plugin. Hosting is Cloudflare Pages' free tier.

---

## Go live

Four steps. The first three are yours; the fourth is a git push.

### 1. Set your Associates tag

Open `site.config.json` and replace `REPLACE-ME-21`:

```json
"affiliate": { "associateTag": "yourtag-21" }
```

Until you do, every buy button renders visibly disabled rather than shipping an
untagged link that earns nothing and looks fine.

### 2. Get some watches in

Open an Amazon watch category or search page in your browser. Save it with
Ctrl+S as **Webpage, HTML Only**, into `inbox/`. Then:

```bash
npm run ingest
```

Nothing in this repo contacts Amazon. It reads the file you already saved.
See [ingestion](#ingestion) for why it works that way.

### 3. Curate

```bash
npm run curate
```

Open <http://localhost:4331>. For each watch: check the auto-filled facts, write
the blurb in your own words, confirm or rewrite the drafted pros and cons, then
approve. A record cannot be approved while any field is still marked as an
unreviewed draft.

### 4. Ship

```bash
npm run verify && npm run build
git add -A && git commit -m "First ten watches" && git push
```

Cloudflare Pages builds on push. First-time setup is in
[docs/OPERATIONS.md](docs/OPERATIONS.md#first-deploy).

---

## Commands

| Command | What it does |
|---|---|
| `npm run ingest` | Parse saved pages in `inbox/` into `content/pending/` |
| `npm run curate` | Curation dashboard on :4331 — approve, reject, edit, build social packs |
| `npm run social -- --suggest` | Rank approved watches for a top-5, showing the working |
| `npm run social -- --asins A,B,C,D,E` | Generate a social pack |
| `npm run verify` | Pre-deploy checks: compliance, dead references, stale prices |
| `npm run dev` | Astro dev server on :4321 |
| `npm run build` | Static build into `dist/` |
| `npm run cms` | Decap's local git proxy, for editing at `/admin/` |

Try the whole pipeline without touching Amazon:

```bash
npm run ingest -- --file examples/sample-amazon-results.html
```

That fixture uses deliberately invalid ASINs (`B0SAMPLE01`…), so nothing in it
can become a live affiliate link by accident.

---

## Ingestion

The spec this was built from asked for a scraper that fetches Amazon category
pages and stores price, rating and image. That is worth understanding before
you change it, because the obvious implementation puts your Associates account
at risk:

- Amazon's Conditions of Use prohibit automated scraping.
- The Associates Operating Agreement requires price data to come from the
  Product Advertising API and to be refreshed or removed within 24 hours.
  Displaying scraped prices is among the most common reasons accounts are
  terminated.
- Listing images may only be used through PA-API or an approved link builder.

Since the affiliate account is the entire revenue mechanism, ingestion is built
so it does not touch any of that:

| | How it works here |
|---|---|
| Source | A page **you** saved from your own browser, or a list of ASINs |
| Traffic to Amazon | None. No robots.txt question, no rate limiting, no bot detection |
| Prices | Stored with a timestamp, hidden automatically after 24h |
| Images | Never hotlinked. A typographic placeholder until you add your own photo |
| Reviews / descriptions | Never read. They are Amazon's copyrighted content |

There are three adapters behind one interface:

- `html-file` — a saved results page. The default.
- `asin-list` — one ASIN or product URL per line. The fallback that cannot
  break when Amazon changes its markup.
- `paapi` — a stub. When you reach three qualifying sales in 180 days you get
  API access, and switching is one line in `site.config.json` rather than a
  rewrite. PA-API is free for approved associates.

---

## How content is generated

Every blurb, pro, con, video script and caption comes from a deterministic
engine in `scripts/lib/copy.mjs`. No model call, no API key, no per-run cost,
and the same watch always produces the same copy.

Two rules govern it:

**Fact-gated.** A sentence is only emitted when the fact that supports it is on
the record. "Sapphire crystal" appears because the listing said so. Where a fact
is missing, the engine says it is missing — *"Crystal material is not confirmed
in the listing"* is more useful to a buyer than a guess, and it is true.

**Draft until a human says otherwise.** Everything generated arrives flagged in
`drafts[]`. The publish gate in `scripts/lib/compliance.mjs` refuses to approve
a watch while any flag remains. The machine drafts; you decide.

---

## Repository layout

```
content/
  pending/       ingested, not yet reviewed        (JSON)
  watches/       approved and live                 (Markdown + frontmatter)
  rejected/      turned down, restorable           (JSON)
  collections/   curated groupings                 (JSON)
  comparisons/   head-to-heads                     (JSON)
  social/        generated packs                   (JSON + Markdown)

scripts/
  ingest.mjs     saved page -> pending records
  curate.mjs     local dashboard (loopback only, no auth, no network surface)
  social.mjs     top-5 selection and pack generation
  verify.mjs     pre-deploy checks
  lib/           taxonomy, copy engine, compliance rules, state machine
  adapters/      html-file, asin-list, paapi (stub)

src/             Astro site
public/admin/    Decap CMS (local backend; blocked in production by _redirects)
site.config.json every tunable decision, in one file
```

---

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — data models, pipeline, state machine, full blueprint
- [docs/OPERATIONS.md](docs/OPERATIONS.md) — first deploy, weekly cadence, optimisation plan
- [docs/COMPLIANCE.md](docs/COMPLIANCE.md) — the Amazon rules encoded in this repo and where each one lives
- [docs/QUESTIONS.md](docs/QUESTIONS.md) — decisions taken by default, and the open questions behind them

---

## Cost

| | |
|---|---|
| Hosting | Cloudflare Pages free tier — unlimited bandwidth, 500 builds/month |
| CMS | Decap, git-based, no service |
| Ingestion | Local Node script |
| Content generation | Deterministic, runs locally |
| CI | GitHub Actions, free for public repositories |
| **Total** | **£0/month** |
