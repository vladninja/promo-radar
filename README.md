# Promo Radar

Collects Polish grocery leaflets, extracts offers with OpenAI vision, and links
the same product across shops.

Shops: Biedronka, Lidl, Kaufland. Source: the `gazetkipromocyjne.net` WordPress
REST media endpoint, which publishes each chain's leaflet as a PDF.

## Setup

```bash
pnpm install
cp .env.example .env      # add your OPENAI_API_KEY
pnpm db:up
pnpm db:migrate
for u in promo_radar promo_radar_test; do
  docker-compose exec -T db psql -U promo -d $u < drizzle/9999_trgm.sql
done
docker-compose exec -T db psql -U promo -d promo_radar -c \
  "insert into shops (slug, name) values
     ('biedronka','Biedronka'),('lidl','Lidl'),('kaufland','Kaufland')
   on conflict do nothing;"
```

## Commands

| Command | What it does |
|---|---|
| `pnpm scan` | Discover, download, extract and match. Run daily. |
| `MAX_PAGES_PER_RUN=0 pnpm scan` | Free dry run: reports what would be parsed without spending anything. |
| `pnpm reparse <externalId>` | Clear one leaflet so the next scan re-extracts it. |
| `pnpm rescore` | Re-run matching over all offers. No API calls. |
| `pnpm prune` | Delete rendered page images older than 30 days. |
| `pnpm test` | Full test suite. Needs `pnpm db:up` first. |

## How it works

1. **Discover** — `GET /wp-json/wp/v2/media?mime_type=application/pdf&after=<cursor>`.
   The shop comes from the attachment `link` (`…/biedronka/attachment/…`); the
   filename prefix is unreliable. One listing page per shop then supplies each
   leaflet's validity dates and often its page count, paired to the PDF in the
   same markup.
2. **Keep only what is on offer today** — `valid_from <= today <= valid_to`.
   Expired leaflets are dropped, and so are ones not yet started: shops publish
   next week's leaflet days early, and it is parsed on the day it begins. The
   cursor is held just behind any skipped future leaflet so it stays
   discoverable. Nothing already parsed is parsed again (`file_hash`, per-page
   status, and page-image hashes).
3. **Acquire** — download at 1 req/s, content-hash, store under `storage/pdf/`.
4. **Rasterize** — `pdftoppm -r 110 -jpeg` per page.
5. **Extract** — one vision call per page returning schema-validated offer tiles.
   The leaflet PDFs carry **no text layer**, so every page goes to vision.
6. **Resolve dates** — the leaflet states its own precedence: dates printed on an
   offer beat dates printed on the page. The year comes from `NR nn/YYYY`.
7. **Match** — canonical key, then `pg_trgm` similarity within the same unit and
   ±5% size.

## Web UI

```bash
pnpm dev     # http://localhost:3000
```

A single Hono server rendering JSX to HTML. No client JavaScript, no bundler —
the screens are read-only and filters are a plain GET form.

| Route | What it shows |
|---|---|
| `/` | Current promos. Filters: search, shop, cross-shop only, needs-review. Sort by discount or unit price. |
| `/products/<id>` | The same product across every shop promoting it now, with the cheapest unit price marked. |
| `/leaflets/<id>?page=n` | The source page image with offer boxes overlaid — the fastest way to check a parse. |
| `/api/promos`, `/api/products/<id>` | JSON for the first two. |

Prices marked **z kartą** require the shop's loyalty card, so they are not
comparable to a plain shelf price. "Najtaniej" is decided on the normalized unit
price and only among offers sharing the same basis (per kg, per l, or per piece),
so a per-piece price never wins against a per-kilogram one.

The cross-shop view only has something to show once two different shops promote
the same product, which needs a few days of scans across Biedronka, Lidl and
Kaufland.

## Costs

Vision is the only recurring cost: roughly **$0.0021 a page** on `gpt-5.6-luna`,
so a few dollars a month. `MAX_PAGES_PER_RUN` (default 400) is a hard ceiling
per run; per-run token use and USD cost land in the `job_runs` table.

About two thirds of a page's cost is **output** tokens, not the image, so the
savings target the JSON coming back:

| Measure | Effect |
|---|---|
| Terse wire schema — short keys, positional bbox, dates only | −17% output tokens, −12% total (measured on identical pages) |
| Parse only leaflets on offer today, using dates from the shop listing page | Avoids whole leaflets: 40–95 pages, $0.08–0.20 each |
| Reuse pages by image hash | A republished page is never billed twice |
| Publication-age fallback | `MAX_LEAFLET_AGE_DAYS` (default 14), used only when the listing page gives no dates |

The model emits short keys (`n`, `p`, `pb`, `dt`, `b`…) which
`toPageResult()` maps back to the readable shape everything else uses, so the
saving is invisible outside `extract/`.

Still on the table: the OpenAI **Batch API** is 50% off and fits a nightly cron,
at the cost of a submit/collect state machine and up to 24h latency.

Pages that come back empty or with a priced tile missing its price are retried
once as two overlapping halves on `gpt-5.6-terra`. Only those pages cost double.

## Operational notes

- The source keeps only about a week of PDFs (`x-wp-total` ≈ 224 against ~30
  published a day). **Scan at least daily** or leaflets are lost. `storage/pdf`
  is the archive.
- `pnpm scan` exits non-zero when no new leaflets have appeared for 36 hours
  (the source probably changed) or when any page failed to extract.
- Prices are integer grosze everywhere. Unit prices are normalized at parse time
  to per kg, per l or per piece, so pack sizes compare honestly.
- Pages are extracted sequentially. That keeps the page budget exact and
  failures isolated; an 84-page leaflet takes a few minutes, which a daily cron
  can afford.

## Scheduling

```bash
mkdir -p storage
cp launchd/com.promoradar.scan.plist ~/Library/LaunchAgents/
launchctl unload ~/Library/LaunchAgents/com.promoradar.scan.plist 2>/dev/null
launchctl load ~/Library/LaunchAgents/com.promoradar.scan.plist
launchctl list | grep promoradar
```

Runs daily at 07:30, logging to `storage/scan.log` and `storage/scan.err.log`.

## Tests

`pnpm test` makes no network calls. The one live test is opt-in:

```bash
SMOKE=1 pnpm vitest run tests/extract/golden.test.ts
```

It spends a single vision call, records `tests/fixtures/vision-page3.json`, and
every later run checks the recorded response against the schema for free.

`tests/fixtures/leaflet-2pages.pdf` is an image-only two-page leaflet rebuilt by
`tests/fixtures/build-fixture.mjs` — slicing the original with pdfseparate
carries the whole shared resource set (91 MB for two pages).
