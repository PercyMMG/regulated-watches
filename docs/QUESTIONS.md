# Decisions and open questions

The brief said to ask rather than assume. Four questions were answered before
any code was written; the rest were defaulted so the site could ship the same
day, and every default is one line in `site.config.json`.

This file is the audit trail: what was decided, on what reasoning, and what is
still genuinely open.

---

## Answered before building

| Question | Answer | Consequence |
|---|---|---|
| Where does it deploy? | Cloudflare Pages | Pages Functions available but unused; `_headers` and `_redirects` are Pages-native |
| Which categories? | A mixture, sectioned by tier and style | Four price bands × seven styles, both first-class navigation |
| Where does curation run? | Local only | No OAuth, no hosted admin, no auth surface. `/admin` blocked in production |
| Voice and look? | Dry expert, dark UI | Charcoal palette, one brass accent; copy templates avoid superlatives |

---

## Defaulted, with reasoning

Each of these was a real fork. The default is stated so you can overturn it in
one edit.

### Ingestion

**Which categories to scrape** — not hardcoded anywhere. You choose per run by
choosing which page to save. Seeding the repo with categories would have been a
guess about your niche.

**How often** — weekly, Monday. Documented in OPERATIONS.md, not enforced.
Ingestion is manual by design, so a cron would have nothing to run.

**Functions or local script** — local script. You chose local-only curation, so
a serverless function would add a deployment surface for a step that already
runs on your machine.

**Store raw scrape logs** — yes. `logs/ingest/*.json`, gitignored. They are the
only way to diagnose a markup change after the fact.

### Curation

**Bulk approve** — enabled, but every record still passes the full per-record
gate. Blocked ones are reported individually rather than skipped quietly. Bulk
approve here means "approve ten things I have already reviewed", not "approve
ten things I have not read".

**Bulk reject** — enabled, no gate. Rejecting is reversible; approving is not.

**Auto-tagging** — enabled, as *suggestions* in a separate `suggested_tags`
field. They never become real tags until you promote them.

**Auto pros/cons** — enabled, flagged as drafts, and a draft flag blocks
approval. This is the most consequential default in the repo: it is what stops
the site becoming machine-written.

### Social

| Setting | Default | Why |
|---|---|---|
| Tone | dry-expert | Matches the site voice you chose |
| Video length | 30s TikTok/Reels, 45s Shorts | Shorts rewards slightly longer; the other two do not |
| Posting frequency | 5/week over 14 days | 10 slots for 5 watches + 1 roundup + 4 re-cuts |
| Caption style | hook → spec → caveat → CTA | The caveat is what makes the rest credible |
| Hashtags | 2 broad + 4 niche + 2 brand, max 8 | Broad tags alone put you in an unwinnable pool |
| Sunday | skipped | Reliably the worst day for this content |

### Site

**Images** — placeholder mode. Amazon listing images may not be redistributed
outside PA-API, so the default renders a typographic card rather than hotlinking
or silently breaking. Switch to `local` once you add your own photographs.

**Prices** — shown with a timestamp, expired after 24 hours, in the build *and*
in the browser. Both gates are needed; see ARCHITECTURE.md §6.

**Affiliate links** — derived at render time, never stored in content files, so
rotating your tag does not mean rewriting every file.

---

## Still open — worth a decision when you have data

**1. Marketplace.** Configured for `amazon.co.uk` and GBP. If your audience is
mostly US, that is a different tag, different ASINs, and the tier boundaries
need redrawing in dollars. One-line change, but do it before you have 50
watches, not after.

**2. Tier boundaries.** £100 / £250 / £500 are reasonable but arbitrary. After
30 watches you will see where yours actually cluster, and the bands should
follow the inventory rather than a round number.

**3. Comparison strategy.** Currently manual, two at a time. At 30+ watches the
question becomes whether to auto-suggest pairs that are close on price and share
a style. Worth doing then; premature now.

**4. Whether `/admin` ever goes public.** Blocked today. Reversing it means a
GitHub OAuth app and an OAuth proxy. Only worth it if you genuinely want to
curate from a phone — the local dashboard is better on a desktop.

**5. What happens to out-of-stock listings.** Nothing detects this today. A
watch can be delisted and its page stays up. Manual for now; PA-API solves it
properly at Phase 4.

**6. Whether to publish a sitemap.** `robots.txt` references
`/sitemap.xml`, which is not generated yet. `@astrojs/sitemap` is free and is
one integration line — worth adding when there are enough pages for it to
matter.

---

## Questions I did not ask, and why

Three things in the brief I built differently rather than asking about, because
the brief's version put the Associates account at risk and the account is the
whole revenue mechanism:

**"Scrapes Amazon category pages."** Built as: parses a page you saved. Same
output, no automated traffic to Amazon, no robots.txt question, no bot
detection. If you specifically want HTTP fetching, that is a real decision with
a real downside and it should be a deliberate one.

**"Extracts price."** Built as: extracts price, stamps it, and expires it after
24 hours in two independent places. Displaying a stale scraped price is one of
the most common reasons Associates accounts are terminated.

**"Extracts image."** Built as: records the URL for your reference, renders a
placeholder. Listing images are not redistributable outside PA-API.

Each is reversible in configuration, and each is documented in
[COMPLIANCE.md](COMPLIANCE.md) with the specific rule behind it.
