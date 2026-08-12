# Promo Radar — Design

**Date:** 2026-08-12
**Status:** Approved

## Purpose

A personal web service that collects Polish grocery-store promotional leaflets
(*gazetki*), extracts the individual offers from them, and identifies when
different shops promote the same product — so a weekly shop can be planned from
one comparison table instead of six leaflet apps.

Scope for the first version: **Biedronka, Lidl, Kaufland**. Everything downstream
of acquisition is shop-agnostic, so more chains are additive.

## Decisions

| Area | Decision |
|---|---|
| Framework | Next.js (App Router), TypeScript. Read-only UI + JSON endpoints. |
| Acquisition | Single source adapter over `gazetkipromocyjne.net` **WordPress REST API**. |
| Extraction | OpenAI vision, one call per rasterized page, structured outputs. |
| Matching | Normalize to a canonical key, then Postgres `pg_trgm` similarity. |
| Storage | Postgres + local filesystem for PDFs and page images. |
| Orchestration | CLI scripts (`scripts/*.ts`) run by system cron (launchd). No queue, no Redis. |
| Hosting | Local development only for now. |

Rejected, with reasons: per-shop scrapers (Biedronka has no PDF and serves a JS
viewer; Kaufland returned 403 to a plain fetch — three brittle Playwright
adapters replaced by one JSON call); BullMQ + Redis (a second process for a job
that runs once a day); a local-OCR-only pipeline (Polish leaflet layouts are
dense collages; rule maintenance would dominate).

## Source: verified facts

All of the following was verified against the live site on 2026-08-12, not
assumed.

**The REST API is open and needs no browser.** `/wp-json/` returns 200. There is
no custom post type for leaflets — only stock WordPress types — so leaflets are
discovered through the media library:

```
GET /wp-json/wp/v2/media
      ?mime_type=application/pdf
      &after=<last_seen_date ISO>
      &per_page=100&orderby=date&order=asc
```

Each item supplies everything discovery needs:

| Field | Example | Use |
|---|---|---|
| `id` | `113166` | `external_id` |
| `source_url` | `…/uploads/pdf/49945__6a7c2c003e754.pdf` | the PDF |
| `date` | `2026-08-12T10:17:04` | new-leaflet trigger and `after=` cursor |
| `link` | `…/**lewiatan**/attachment/…` | **shop slug** |
| `media_details.sizes.full` | `…-pdf.jpg` (1522×2389) | free cover thumbnail |

Verified: the shop slug is present in `link` for all 31 PDFs published in a
single day, covering 18 chains including `biedronka`, `lidl`, `kaufland`. The
`post` parent id is **not** reliable (`0__` prefix for Lidl and Kaufland) — the
shop must be derived from `link`.

**The PDFs are image-only.** The current Biedronka leaflet is 84 pages, 47 MB,
page size 1146×1800 pt, one embedded JPEG per page. `pdftotext` yields **1 byte
per page** — there is no text layer, so there is no text-extraction shortcut.
Every page goes to vision. Rasterizing at 100–110 dpi produces a ~600 KB JPEG
that is comfortably legible, including small print such as `0,80 zł/100 g`.

**Retention is about one week.** `x-wp-total` is 224 PDFs against roughly 30
published per day. **The cron must run at least daily**, or leaflets disappear
before we see them. Our `storage/` directory is the only archive.

**`per_page` caps at 100.** Pagination is required on backfill.

**Dates live inside the PDF, per offer.** The cover carries per-tile badges
(`OFERTA OD 12.08 DO 14.08` on one tile, `OD 13.08 DO 14.08` on the next) and the
leaflet's own legal line states the precedence: *"Oferta obowiązuje według dat
podanych przy produktach albo dat podanych na konkretnej stronie."* The year
comes from the issue number in the sidebar (`NR 33/2026`). No extra HTTP request
and no HTML parsing is needed for dates — they arrive in the vision pass we are
already paying for.

**Promo mechanics observed in the wild** (the schema must carry all of these):
plain price; `% TANIEJ`; `PRZY ZAKUPIE 3 → KAŻDA Z 3 SZTUK 1,99` (multi-buy);
`1+1 GRATIS — tańszy produkt gratis`; `Cena przed obniżką` and `Cena poza
promocją` as two distinct reference prices; `Z KARTĄ LUB APKĄ` loyalty gating;
`Limit dzienny 3 szt. na kartę` purchase limits; `zł/kg`, `zł/100 g`,
`zł/rolka` unit prices; `na wagę` loose goods with no package size.

## Architecture

```
promo-radar/
  src/
    app/
      page.tsx                  # promo list
      products/[id]/page.tsx    # cross-shop comparison
      leaflets/[id]/page.tsx    # page image + offer bboxes
      api/…                     # JSON for the same three views
    lib/
      sources/
        types.ts                # LeafletSource interface
        gazetkipromocyjne.ts    # the one implementation
        index.ts                # registry
      acquire/                  # download, content-hash, store, rasterize
      extract/                  # vision call, schema validation, retry-by-halves
      normalize/                # brand / size / unit → canonical key
      match/                    # candidate lookup + trigram scoring
      db/                       # Drizzle schema + client
  scripts/
    scan.ts                     # cron entry point: discover → acquire → extract → match
    reparse.ts                  # re-extract one leaflet
    rescore.ts                  # re-run matching only, no API calls
  storage/                      # PDFs + rendered page images (gitignored)
```

The CLI scripts and the Next.js app live in one repo and import the same
`src/lib` modules, so the read layer and the pipeline cannot drift apart.

### The one seam

```ts
interface DiscoveredLeaflet {
  shopSlug: string
  externalId: string
  pdfUrl: string
  publishedAt: Date
  coverUrl?: string
}

interface LeafletSource {
  slug: string
  discover(shops: string[], since: Date | null): Promise<DiscoveredLeaflet[]>
  fetchAsset(l: DiscoveredLeaflet): Promise<{ path: string }>
}
```

Everything downstream is shop-agnostic. Adding a chain is a registry entry;
adding a different source (Tiendeo, or a direct shop adapter) is one new file
implementing this interface.

## Data model

Postgres with the `pg_trgm` extension, Drizzle for schema and queries.

- **`shops`** — `slug`, `name`. Seeded with the three configured chains; `scan.ts`
  ignores every source slug outside this allowlist.
- **`leaflets`** — `shop_id`, `external_id`, `source_slug`, `pdf_url`,
  `published_at`, `valid_from`, `valid_to`, `file_hash`, `page_count`,
  `status` (`pending`\|`done`\|`partial`\|`failed`), `fetched_at`.
  Unique on (`shop_id`, `external_id`).
- **`leaflet_pages`** — `leaflet_id`, `page_no`, `image_path`, `image_hash`,
  `valid_from`, `valid_to`, `extract_status`, `raw_json`, `error`,
  `tokens_in`, `tokens_out`, `split_retry` (bool).
  Unique on (`leaflet_id`, `page_no`).
- **`offers`** — one row per promo tile:
  `leaflet_id`, `page_no`, `raw_name`, `brand`, `name`, `size_value`,
  `size_unit`, `price_grosze`, `price_before`, `price_regular`,
  `discount_percent`, `promo_kind` (`price`\|`percent`\|`multibuy`\|`bogo`),
  `min_qty`, `unit_price`, `unit_basis`, `requires_loyalty`, `purchase_limit`,
  `valid_from`, `valid_to`, `date_source` (`offer`\|`page`\|`leaflet`),
  `canonical_key`, `product_id`, `match_method`, `match_score`, `needs_review`
  (bool), `bbox` (jsonb).
- **`products`** — the merged identity: `canonical_key` (unique),
  `display_name`, `brand`, `size_value`, `size_unit`.
- **`job_runs`** — `script`, `started_at`, `finished_at`, `status`,
  `stats` (jsonb: pages parsed, tokens, cost, offers created), `error`.
- **`source_cursors`** — `source_slug`, `last_seen_date`.

Two load-bearing choices:

1. **Offers are immutable facts; products are derived.** Re-running matching
   never touches extraction. `rescore.ts` can re-tune the similarity threshold
   across the whole archive without a single API call.
2. **`file_hash` and `image_hash` make `scan.ts` idempotent.** It can be run
   hourly; unchanged leaflets are skipped and an already-parsed page is never
   billed twice.

Money is stored as **integer grosze**. No floats.

## Pipeline

`scripts/scan.ts`, run daily by launchd:

1. **Discover** — `LeafletSource.discover(['biedronka','lidl','kaufland'], cursor)`.
   Advance `source_cursors.last_seen_date` only after the leaflet row is committed.
2. **Acquire** — download the PDF at ≤1 req/s, content-hash it, skip if the hash
   is already known, store under `storage/pdf/<shop>/<external_id>.pdf`.
3. **Rasterize** — `pdftoppm -r 110 -jpeg` into
   `storage/pages/<leaflet_id>/<page_no>.jpg`, hash each page.
4. **Extract** — for each page not already extracted (by `image_hash`), one
   OpenAI vision call returning an array of offer tiles against a strict JSON
   schema, validated with zod. Concurrency 4.
5. **Resolve dates** — offer badge → page header → leaflet range, recording
   which level was used in `date_source`. Year from `NR nn/YYYY`, falling back
   to `published_at`, handling the December→January rollover.
   `leaflets.valid_from`/`valid_to` are **derived after extraction** as the min
   and max of all dates found on that leaflet's pages and offers. If a page
   yields no dates at all, it inherits that derived leaflet range; if the whole
   leaflet yields none, the range is `published_at` to `published_at + 7 days`
   and every offer on it is flagged `needs_review`.
6. **Normalize and match** — canonical key, then trigram candidates.
7. **Record** — write `job_runs` with page counts, token usage and cost.

### Extraction details

The prompt encodes the leaflet vocabulary explicitly: `OFERTA OD…DO`,
`% TANIEJ`, `Cena przed obniżką`, `Cena poza promocją`, `Z KARTĄ LUB APKĄ`,
`PRZY ZAKUPIE n`, `KAŻDA Z n SZTUK`, `1+1 GRATIS`, `Limit dzienny`, `zł/kg`,
`zł/100 g`, `na wagę`. Prices are read as comma decimals and converted to grosze.

**Small print is handled in two tiers rather than by always splitting pages.**
Run the whole page first. A page is flagged suspicious if it yields zero tiles,
or any tile has a name but no price. Only flagged pages are retried as two
vertically overlapping halves (`split_retry = true`). This pays double only
where it is warranted.

The exact model id and its per-image price are confirmed against current OpenAI
documentation at implementation time, not guessed here. Expected volume is
150–250 pages per week at roughly 3k tokens each, which is low single-digit
dollars per month on a mini-tier vision model — the only recurring cost.

### Matching details

Normalization extracts the package size into `size_value` plus a canonical
`size_unit` (g/kg → g, ml/l → ml, szt/rolki/opakowań → pcs) and removes tokens
listed in a maintained stoplist at `normalize/stopwords.ts` (`Mega Paka`,
`Supercena`, `nowość`, `na wagę`, and similar marketing text observed in
leaflets). `canonical_key` = brand + core name + size.

1. Exact `canonical_key` hit → attach to that product.
2. Otherwise `pg_trgm` similarity against `products.display_name`, restricted to
   the same `size_unit` and a size within ±5%:
   - **≥ 0.55** → attach, `match_method = 'trigram'`
   - **0.45–0.55** → attach to a new product and flag `needs_review`
   - **< 0.45** → create a new product
3. Loose goods (`na wagę`) have no size and match on name alone.

`match_method` and `match_score` are persisted so thresholds can be re-tuned by
`rescore.ts`.

**A cross-shop promo** is a product with two or more offers from different shops
whose validity windows overlap today. Comparison normalizes to **zł/kg or zł/l**
so 200 g and 500 g packs compare honestly, and loyalty-gated offers are marked
so a card price never sits silently beside a shelf price.

## UI

Three server-rendered screens reading Postgres directly.

1. **`/` — promo list.** Search by name, filter by shop, "cross-shop only"
   toggle, `needs_review` filter, sort by discount percent or unit price.
2. **`/products/[id]` — comparison.** One row per shop: price, unit price,
   validity, promo kind, loyalty flag, purchase limit, link to the source page.
3. **`/leaflets/[id]?page=n` — page viewer.** The page image with offer
   bounding boxes overlaid. Doubles as the parse-debugging tool.

`needs_review` is a filter on the list, not a separate screen.

## Error handling

- **Per-page isolation.** A failed page is recorded with its error; the leaflet
  completes as `partial`. One bad page never loses the other 83.
- **Schema failure** retries once with stricter instructions, then marks the page
  failed.
- **Resumability.** The cursor is persisted, so an interrupted run resumes from
  where it stopped; content hashes make re-runs free.
- **Politeness.** Realistic UA, ≤1 req/s to the source, exponential backoff on
  429/5xx. Personal-use volume, cached locally so nothing is fetched twice.
- **Cost guard.** OpenAI concurrency 4 and a hard per-run page cap
  (default 400, configurable). Token usage and cost land in `job_runs`.
- **Breakage alarm.** `scan.ts` exits non-zero if no new PDFs have appeared for
  36 hours — the signal that the source changed. launchd captures stderr to a log.
- **Disk.** PDFs are kept as the archive; rendered page JPEGs older than 30 days
  are pruned, since they are regenerable.

## Testing

- **Pure functions carry the coverage:** price parsing (`7,99`, `7 99 /kg`,
  `2,90/100 g`), size and unit extraction, canonical key construction,
  date-precedence resolution, year inference including the December→January
  rollover.
- **Golden-file extraction test:** three committed page JPEGs with their expected
  offer JSON, OpenAI client mocked with recorded responses. Catches prompt and
  schema regressions at zero cost.
- **Source adapter test** against a recorded `wp/v2/media` JSON fixture, so a
  shape change fails a test instead of silently returning zero leaflets.
- **Matching test** over a table of real Polish product-name pairs with expected
  match / no-match verdicts.
- **Opt-in live smoke test** (`npm run smoke`, gated behind an env var) that
  hits the real API for a single page.

## Out of scope

Deployment, authentication, watchlists and alerts, per-store regional pricing,
shopping-list building, recipe integration, and chains beyond the initial three.

## Prerequisites

Node 24 (present), poppler-utils — `pdftotext`/`pdftoppm`/`pdfimages` (present),
Postgres with `pg_trgm` (**not yet installed locally**), an OpenAI API key.
