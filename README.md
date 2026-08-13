# Promo Radar

Collects Polish grocery leaflets, extracts offers with OpenAI vision, and links
the same product across shops.

Shops: Biedronka, Lidl, Kaufland. Source: the `gazetkipromocyjne.net` shop
listing pages, which publish each chain's leaflet as a PDF alongside its
validity dates.

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
| `pnpm tsx scripts/reclassify.ts` | Rescue offers stuck in "inne" using the category rules. Promotes only, never demotes. |
| `pnpm tsx scripts/rebuild-offers.ts` | Regenerate every offer from the readings already stored. No API calls. |
| `pnpm prune` | Delete rendered page images older than 30 days. |
| `pnpm test` | Full test suite. Needs `pnpm db:up` first. |

## Reading a leaflet by hand

The vision API is not the only way in. Any source of page readings can be
ingested, and it goes through identical downstream logic — date precedence,
money parsing, size extraction, product matching — via `persistPageResult`.

```bash
pnpm tsx scripts/prepare-leaflet.ts --list        # what is on offer today
pnpm tsx scripts/prepare-leaflet.ts 4__6a7c1f3ae960d   # download + render, free
# look at storage/pages/<leafletId>/p*.jpg, write readings as JSON
pnpm tsx scripts/ingest-pages.ts <leafletId> readings.json
```

The JSON is `[{ "pageNo": 1, "result": { page_date_badge, issue_text, tiles: [...] } }]`,
validated against the same schema the API output must satisfy, so a malformed
reading fails loudly instead of corrupting the data. Pages already marked done
are skipped, so ingestion is repeatable.

This is useful for spot-fixing a page the model got wrong, and it means the
pipeline is not locked to one vision provider.

## How it works

1. **Discover** — one `GET /<shop>/` per shop. The listing page pairs each PDF
   with its validity dates (in the download anchor) and usually its page count
   (in the viewer iframe), so a leaflet is identified by its PDF file stem, e.g.
   `4__6a7c1f3ae960d`. Three requests, no pagination, no cursor.

   The `wp-json/wp/v2/media` endpoint was used for this and was dropped: it
   carries no validity dates, so it forced a walk of the whole 223-PDF archive
   plus a cursor to keep the volume down — and it returned exactly the same 19
   current leaflets. Its only extra was a publication timestamp, which the
   validity dates make redundant.
2. **Keep only what is on offer today** — `valid_from <= today <= valid_to`.
   Expired leaflets are dropped, and so are ones not yet started: shops publish
   next week's leaflet days early, and it is parsed on the day it begins.
   Because discovery re-reads the listing pages every run, a deferred leaflet
   simply reappears when it becomes current. Nothing already parsed is parsed
   again (`file_hash`, per-page status, and page-image hashes).
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

Styling follows shadcn's design language (neutral palette as CSS variables, one
radius scale, muted foregrounds, card surfaces, pill badges) written as plain
CSS. shadcn itself is React plus Radix plus Tailwind, none of which these static
screens would use. Light scheme only. Tables collapse to labelled cards below
820px.

| Route | What it shows |
|---|---|
| `/` | Current promotions, one card per product. Filters: search, shop, **category**, cross-shop only, needs-review. Sort by discount or unit price. |
| `/products/<id>` | The same product across every shop promoting it now, with the cheapest unit price marked. |
| `/leaflets/<id>?page=n` | The source page image with offer boxes overlaid — the fastest way to check a parse. |
| `/api/promos`, `/api/products/<id>` | JSON for the first two. |

### What one card stands for

A card is a product, not a printing. The same yoghurt on the cover and in the
dairy section, and again in two other shops the same week, is one thing a shopper
is looking for — so matched offers collapse to a single card at the lowest price,
carrying the shop whose price that is. The detail page lists everywhere else it
is on. Offers the matcher could not identify stay per-shop: without a product
there is nothing to say two of them are the same thing.

The cards carry icons rather than labels — several shops, loyalty card, needs
review — each with a `<title>` for hover and screen readers. The shop appears as
its mark on the thumbnail, and the mechanic as one chip per kind (`Cena promo`,
`Rabat`, `Wielosztuka`, `Gratis`) so a grid of forty can be scanned. Dates are
left to the detail page.

A multibuy's headline is not a discount. "Trzeci produkt 100% taniej" is a third
off three items, so sorting on the printed number put thirteen price-less bundles
at the head of the list and every real bargain behind them; the sort spreads it
over the bundle, and the card omits a percentage it would misstate.

### How two offers are compared

Per unit when both sides print one on the same basis; otherwise on the shelf
price. Most package goods print no per-unit figure at all — two 990 g bottles of
ketchup are advertised at 8,99 and 8,49 and nothing else — so requiring one made
the app decline to compare exactly the products people buy. Falling back is safe
because the two offers are already matched, and matching enforces the same unit
and a size within ±5%.

Deriving the unit price from `price ÷ size` would let package goods sort by unit
price too. Deliberately not done yet: a derived figure is only as trustworthy as
the size extraction, and mixing it with printed ones in the "cheapest" logic
would hide which is which. If it is added, it belongs in its own column.

Prices marked **z kartą** require the shop's loyalty card, so they are not
comparable to a plain shelf price. "Najtaniej" follows the comparison rule above, and
never lets a per-piece price win against a per-kilogram one.

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
at the cost of a submit/collect state machine and up to 24h latency. It is the
only large saving left that carries no accuracy risk.

### Measured and rejected

Two plausible savings were tried and abandoned. Both are recorded here so they
are not re-attempted from first principles.

**Lower render resolution — worth ~5%, not the 15–20% expected.** Image tokens do
not scale with page area; they bucket. Measured on one page with
`scripts/calibrate-dpi.ts`:

| dpi | pixels | tokens in | tokens out | cost |
|---|---|---|---|---|
| 110 | 1525×2481 | 3,977 | 1,006 | $0.00200 |
| 90 | 1248×2030 | 4,024 | 1,160 | $0.00220 |
| 70 | 970×1579 | 2,889 | 1,090 | $0.00189 |

90 dpi cost *more* input than 110 despite a third fewer pixels, and because
output dominates, the whole 110→70 spread is about 5%. 70 dpi also misread a
product code (`AMAK00052` → `AMK00052`). Not worth degrading fine text. **Keep
110 dpi.**

**Cheaper image `detail` — `low` costs *more* than `high`.** Image cost is
patch-based (`ceil(w/32) × ceil(h/32)`), so `low` sends a 512×512 copy for a
fraction of the input. Measured on the same page:

| detail | tokens in | tokens out | cost | result |
|---|---|---|---|---|
| `low` | 1,221 | 2,327 | $0.00304 | hallucinated names and prices, all reference prices lost |
| `high` | 3,977 | 810 | $0.00177 | correct |
| `original` | 5,521 | 1,036 | $0.00235 | correct, no measurable gain over `high` |

Starved of detail the model guesses, and guessing costs output tokens — nearly
3× as many — so the bill goes *up* while the data becomes wrong. `original`
skips the downsampling `high` applies above ~2,500 patches, but costs 33% more
for no demonstrated benefit. **Keep `high`** (`VISION_DETAIL` if you want to
re-test on a future model).

**Local OCR gate to skip page-images with no prices — unsafe, would lose
offers.** Of a real 44-page leaflet, tesseract found price-shaped text on 41
pages, so the upside was only ~7%. Worse, one of the three "empty" pages
(page 13) carried two genuine offers at 9,99 zł and 14,99 zł. Polish leaflets
print prices as large stylized digits with a superscript grosze part, which OCR
reads as decoration rather than money — so the gate would silently drop real
offers to save $0.002. **Do not add an OCR pre-filter.**

Pages that come back empty or with a priced tile missing its price are retried
once as two overlapping halves on `gpt-5.6-terra`. Only those pages cost double.

## Operational notes

- The shop pages list only current and near-future leaflets, and the site keeps
  roughly a week of PDFs. **Scan at least daily** or leaflets are lost;
  `storage/pdf` is the archive.
- `pnpm scan` exits non-zero when the listing pages yield no current leaflets at
  all (the source probably changed) or when any page failed to extract.
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
