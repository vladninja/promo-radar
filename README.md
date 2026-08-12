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
| `pnpm reparse <externalId>` | Clear one leaflet so the next scan re-extracts it. |
| `pnpm rescore` | Re-run matching over all offers. No API calls. |
| `pnpm prune` | Delete rendered page images older than 30 days. |
| `pnpm test` | Full test suite. Needs `pnpm db:up` first. |

## How it works

1. **Discover** — `GET /wp-json/wp/v2/media?mime_type=application/pdf&after=<cursor>`.
   The shop comes from the attachment `link` (`…/biedronka/attachment/…`); the
   filename prefix is unreliable.
2. **Acquire** — download at 1 req/s, content-hash, store under `storage/pdf/`.
3. **Rasterize** — `pdftoppm -r 110 -jpeg` per page.
4. **Extract** — one vision call per page returning schema-validated offer tiles.
   The leaflet PDFs carry **no text layer**, so every page goes to vision.
5. **Resolve dates** — the leaflet states its own precedence: dates printed on an
   offer beat dates printed on the page. The year comes from `NR nn/YYYY`.
6. **Match** — canonical key, then `pg_trgm` similarity within the same unit and
   ±5% size.

## Costs

Vision is the only recurring cost: about 150–250 pages a week at roughly
$0.002 a page on `gpt-5.6-luna`, so a few dollars a month. `MAX_PAGES_PER_RUN`
(default 400) is a hard ceiling per run; per-run token use and USD cost land in
the `job_runs` table.

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
