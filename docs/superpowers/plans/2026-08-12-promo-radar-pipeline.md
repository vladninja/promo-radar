# Promo Radar — Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A CLI that discovers new Polish grocery leaflets daily, extracts every offer from their pages with OpenAI vision, and links offers describing the same product across shops — all persisted in Postgres.

**Architecture:** One source adapter reads the `gazetkipromocyjne.net` WordPress REST media endpoint for new PDFs; PDFs are downloaded, content-hashed and rasterized with poppler; each page image goes to a vision model behind a narrow `VisionClient` interface returning schema-validated offer tiles; pure normalization functions turn tile text into money-as-integers, canonical sizes and a canonical key; matching attaches each offer to a product by exact key or `pg_trgm` similarity. Scripts are plain Node entry points run by launchd — no queue, no server.

**Tech Stack:** Node 24, TypeScript (strict, ESM), pnpm, Postgres 17 in Docker with `pg_trgm`, drizzle-orm 0.45 + drizzle-kit, openai 7.4, zod 4.4, Vitest 4.1, tsx, poppler-utils (`pdftoppm`, `pdfinfo`, `pdfseparate`, `pdfunite`).

**Spec:** `docs/superpowers/specs/2026-08-12-promo-radar-design.md`

## Global Constraints

- Money is stored and computed as **integer grosze**. Never a float, never a Decimal string.
- All dates stored as `timestamptz`; all parsing is anchored to `Europe/Warsaw`.
- Pinned versions: `next@16.3.0`, `vitest@4.1.10`, `drizzle-orm@0.45.2`, `openai@7.4.0`, `zod@4.4.3`.
- Vision models: primary `gpt-5.6-luna`, escalation `gpt-5.6-terra`. Both read from env with those defaults.
- Only the three allowlisted shop slugs are ingested: `biedronka`, `lidl`, `kaufland`.
- Politeness: at most 1 request per second to `gazetkipromocyjne.net`, with a browser-like `User-Agent`.
- Cost guard: at most `MAX_PAGES_PER_RUN` (default 400) vision calls per run.
- **Deliberate deviation from the spec:** pages are extracted **sequentially**, not at concurrency 4. Sequential keeps the page budget exact and failures isolated to one page, and a daily cron has the wall-clock to spare (about 7 minutes for an 84-page leaflet). Concurrency can be added later behind the same `extractPage` call; nothing in the design depends on it.
- Exactly one file may import the `openai` package: `src/lib/extract/openai-client.ts`. Everything else depends on the `VisionClient` interface.
- Package manager is `pnpm`. Every command in this plan uses it.
- Tests never make network calls. The only exception is the opt-in smoke test in Task 12, gated behind `SMOKE=1`.

---

## File Structure

| File | Responsibility |
|---|---|
| `docker-compose.yml` | Postgres 17 with `pg_trgm`, port 55432 |
| `src/lib/config.ts` | env parsing, model ids, price table, limits |
| `src/lib/db/schema.ts` | Drizzle tables |
| `src/lib/db/client.ts` | pool + drizzle instance |
| `src/lib/sources/types.ts` | `LeafletSource`, `DiscoveredLeaflet` |
| `src/lib/sources/gazetkipromocyjne.ts` | the one source implementation |
| `src/lib/sources/rate-limit.ts` | 1 req/s gate + backoff |
| `src/lib/acquire/download.ts` | fetch PDF, sha256, store |
| `src/lib/acquire/rasterize.ts` | `pdfinfo`/`pdftoppm` wrappers incl. cropping |
| `src/lib/normalize/money.ts` | grosze + unit-price parsing |
| `src/lib/normalize/size.ts` | size + unit extraction |
| `src/lib/normalize/stopwords.ts` | marketing-token stoplist |
| `src/lib/normalize/canonical.ts` | canonical key |
| `src/lib/extract/dates.ts` | date badges, issue year, precedence |
| `src/lib/extract/schema.ts` | zod tile/page schemas |
| `src/lib/extract/prompt.ts` | the Polish extraction prompt |
| `src/lib/extract/vision.ts` | `VisionClient` interface, suspicion rule, split retry |
| `src/lib/extract/openai-client.ts` | the only file importing `openai` |
| `src/lib/match/attach.ts` | exact + trigram matching |
| `src/lib/pipeline/scan.ts` | the orchestration, unit-testable |
| `scripts/scan.ts` | thin CLI wrapper + exit codes |
| `scripts/reparse.ts` | re-extract one leaflet |
| `scripts/rescore.ts` | re-run matching only |
| `scripts/prune-pages.ts` | delete page JPEGs older than 30 days |

---

### Task 1: Project scaffold, Postgres in Docker, Vitest

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `docker-compose.yml`, `.env.example`, `src/lib/config.ts`, `src/lib/db/client.ts`, `tests/setup/global.ts`
- Test: `tests/db/extension.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `config` object with `{ databaseUrl, openaiApiKey, visionModel, visionModelEscalation, maxPagesPerRun, storageDir, sourceBaseUrl, userAgent }`; `db` (drizzle instance) and `pool` (pg Pool) from `src/lib/db/client.ts`; `getTestDb()` from `tests/setup/global.ts`.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "promo-radar",
  "private": true,
  "type": "module",
  "scripts": {
    "scan": "tsx scripts/scan.ts",
    "reparse": "tsx scripts/reparse.ts",
    "rescore": "tsx scripts/rescore.ts",
    "prune": "tsx scripts/prune-pages.ts",
    "db:up": "docker-compose up -d && sleep 3",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "drizzle-orm": "0.45.2",
    "openai": "7.4.0",
    "pg": "8.13.1",
    "zod": "4.4.3"
  },
  "devDependencies": {
    "@types/node": "24.3.0",
    "@types/pg": "8.11.10",
    "drizzle-kit": "0.31.1",
    "tsx": "4.19.2",
    "typescript": "5.7.2",
    "vitest": "4.1.10"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node"],
    "paths": { "@/*": ["./src/*"] },
    "baseUrl": "."
  },
  "include": ["src", "scripts", "tests", "*.ts"]
}
```

- [ ] **Step 3: Create `docker-compose.yml`**

```yaml
services:
  db:
    image: postgres:17-alpine
    ports: ["55432:5432"]
    environment:
      POSTGRES_USER: promo
      POSTGRES_PASSWORD: promo
      POSTGRES_DB: promo_radar
    volumes:
      - pgdata:/var/lib/postgresql/data
volumes:
  pgdata:
```

- [ ] **Step 4: Create `.env.example` and copy it to `.env`**

```bash
DATABASE_URL=postgres://promo:promo@localhost:55432/promo_radar
DATABASE_URL_TEST=postgres://promo:promo@localhost:55432/promo_radar_test
OPENAI_API_KEY=sk-replace-me
VISION_MODEL=gpt-5.6-luna
VISION_MODEL_ESCALATION=gpt-5.6-terra
MAX_PAGES_PER_RUN=400
STORAGE_DIR=./storage
```

Run: `cp .env.example .env` and put a real key in `.env`.

- [ ] **Step 5: Create `src/lib/config.ts`**

```ts
function required(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing env var ${name}`)
  return v
}

export const config = {
  databaseUrl: () => required('DATABASE_URL'),
  openaiApiKey: () => required('OPENAI_API_KEY'),
  visionModel: process.env.VISION_MODEL ?? 'gpt-5.6-luna',
  visionModelEscalation: process.env.VISION_MODEL_ESCALATION ?? 'gpt-5.6-terra',
  maxPagesPerRun: Number(process.env.MAX_PAGES_PER_RUN ?? 400),
  storageDir: process.env.STORAGE_DIR ?? './storage',
  sourceBaseUrl: 'https://www.gazetkipromocyjne.net',
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127 Safari/537.36',
  shopAllowlist: ['biedronka', 'lidl', 'kaufland'] as const,
  concurrency: 4,
  staleHours: 36,
  /** USD per 1M tokens, from OpenAI docs 2026-08-12. */
  pricing: {
    'gpt-5.6-luna': { input: 0.2, output: 1.2 },
    'gpt-5.6-terra': { input: 2.0, output: 12.0 },
  } as Record<string, { input: number; output: number }>,
}
```

- [ ] **Step 6: Write the failing test `tests/db/extension.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { Pool } from 'pg'

describe('database', () => {
  it('has the pg_trgm extension available', async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL_TEST })
    const { rows } = await pool.query(
      "select extname from pg_extension where extname = 'pg_trgm'",
    )
    await pool.end()
    expect(rows).toHaveLength(1)
  })
})
```

- [ ] **Step 7: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globalSetup: ['./tests/setup/global.ts'],
    env: { TZ: 'Europe/Warsaw' },
    testTimeout: 20_000,
  },
})
```

- [ ] **Step 8: Create `tests/setup/global.ts`**

This file must not import application config — it runs before the app is loaded.

```ts
import { Pool } from 'pg'

export default async function setup() {
  process.env.DATABASE_URL_TEST ??=
    'postgres://promo:promo@localhost:55432/promo_radar_test'
  const admin = new Pool({
    connectionString: 'postgres://promo:promo@localhost:55432/promo_radar',
  })
  const { rows } = await admin.query(
    "select 1 from pg_database where datname = 'promo_radar_test'",
  )
  if (rows.length === 0) await admin.query('create database promo_radar_test')
  await admin.end()

  const test = new Pool({ connectionString: process.env.DATABASE_URL_TEST })
  await test.query('create extension if not exists pg_trgm')
  await test.end()
}
```

- [ ] **Step 9: Run the test to verify it fails**

Run: `pnpm install && pnpm vitest run tests/db/extension.test.ts`
Expected: FAIL — `ECONNREFUSED` against port 55432, because Postgres is not running.

- [ ] **Step 10: Start Postgres and re-run**

Run: `pnpm db:up && pnpm vitest run tests/db/extension.test.ts`
Expected: PASS — one row, `pg_trgm`.

- [ ] **Step 11: Create `src/lib/db/client.ts`**

```ts
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { config } from '@/lib/config'

export const pool = new Pool({ connectionString: config.databaseUrl() })
export const db = drizzle(pool)
export type Db = typeof db
```

- [ ] **Step 12: Add `.gitignore` entries and commit**

```bash
printf 'storage/\nnode_modules/\n.env\n!.env.example\ndrizzle/meta/\n' >> .gitignore
git add -A
git commit -m "feat: scaffold project with Postgres in Docker and Vitest"
```

---

### Task 2: Database schema

**Files:**
- Create: `src/lib/db/schema.ts`, `drizzle.config.ts`
- Test: `tests/db/schema.test.ts`

**Interfaces:**
- Consumes: `db` from Task 1.
- Produces: tables `shops`, `leaflets`, `leafletPages`, `offers`, `products`, `jobRuns`, `sourceCursors`; enums `leafletStatus`, `extractStatus`, `promoKind`, `dateSource`, `sizeUnit`, `unitBasis`, `matchMethod`.

- [ ] **Step 1: Write the failing test `tests/db/schema.test.ts`**

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { shops, leaflets, leafletPages, offers } from '@/lib/db/schema'

const pool = new Pool({ connectionString: process.env.DATABASE_URL_TEST })
const db = drizzle(pool)

beforeAll(async () => {
  await pool.query(
    'truncate offers, leaflet_pages, leaflets, products, shops, job_runs, source_cursors cascade',
  )
})

describe('schema', () => {
  it('rejects a duplicate (shop, external_id) leaflet', async () => {
    const [shop] = await db
      .insert(shops)
      .values({ slug: 'biedronka', name: 'Biedronka' })
      .returning()
    const row = {
      shopId: shop!.id,
      externalId: '113166',
      sourceSlug: 'gazetkipromocyjne',
      pdfUrl: 'https://example.test/a.pdf',
      publishedAt: new Date('2026-08-12T10:17:04Z'),
      fileHash: 'abc',
      pageCount: 84,
    }
    await db.insert(leaflets).values(row)
    await expect(db.insert(leaflets).values(row)).rejects.toThrow()
  })

  it('stores money as an integer number of grosze', async () => {
    const [shop] = await db
      .insert(shops)
      .values({ slug: 'lidl', name: 'Lidl' })
      .returning()
    const [leaflet] = await db
      .insert(leaflets)
      .values({
        shopId: shop!.id,
        externalId: '999',
        sourceSlug: 'gazetkipromocyjne',
        pdfUrl: 'https://example.test/b.pdf',
        publishedAt: new Date(),
        fileHash: 'def',
        pageCount: 1,
      })
      .returning()
    await db.insert(leafletPages).values({
      leafletId: leaflet!.id,
      pageNo: 1,
      imagePath: 'p/1.jpg',
      imageHash: 'h1',
    })
    const [offer] = await db
      .insert(offers)
      .values({
        leafletId: leaflet!.id,
        pageNo: 1,
        rawName: 'Masło Ekstra Mleczna Dolina, 200 g',
        name: 'masło ekstra',
        priceGrosze: 199,
        promoKind: 'multibuy',
        minQty: 3,
        requiresLoyalty: true,
        dateSource: 'offer',
      })
      .returning()
    expect(offer!.priceGrosze).toBe(199)
    expect(Number.isInteger(offer!.priceGrosze)).toBe(true)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run tests/db/schema.test.ts`
Expected: FAIL — cannot resolve `@/lib/db/schema`.

- [ ] **Step 3: Create `src/lib/db/schema.ts`**

```ts
import {
  boolean, index, integer, jsonb, pgEnum, pgTable, real, text,
  timestamp, unique, uuid,
} from 'drizzle-orm/pg-core'

export const leafletStatus = pgEnum('leaflet_status', ['pending', 'done', 'partial', 'failed'])
export const extractStatus = pgEnum('extract_status', ['pending', 'done', 'failed'])
export const promoKind = pgEnum('promo_kind', ['price', 'percent', 'multibuy', 'bogo'])
export const dateSource = pgEnum('date_source', ['offer', 'page', 'leaflet'])
export const sizeUnit = pgEnum('size_unit', ['g', 'ml', 'pcs'])
export const unitBasis = pgEnum('unit_basis', ['kg', 'l', 'pcs'])
export const matchMethod = pgEnum('match_method', ['exact', 'trigram', 'new'])

export const shops = pgTable('shops', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
})

export const leaflets = pgTable('leaflets', {
  id: uuid('id').primaryKey().defaultRandom(),
  shopId: uuid('shop_id').notNull().references(() => shops.id),
  externalId: text('external_id').notNull(),
  sourceSlug: text('source_slug').notNull(),
  pdfUrl: text('pdf_url').notNull(),
  publishedAt: timestamp('published_at', { withTimezone: true }).notNull(),
  validFrom: timestamp('valid_from', { withTimezone: true }),
  validTo: timestamp('valid_to', { withTimezone: true }),
  fileHash: text('file_hash').notNull(),
  pageCount: integer('page_count').notNull(),
  status: leafletStatus('status').notNull().default('pending'),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique('leaflets_shop_external').on(t.shopId, t.externalId)])

export const leafletPages = pgTable('leaflet_pages', {
  id: uuid('id').primaryKey().defaultRandom(),
  leafletId: uuid('leaflet_id').notNull().references(() => leaflets.id),
  pageNo: integer('page_no').notNull(),
  imagePath: text('image_path').notNull(),
  imageHash: text('image_hash').notNull(),
  validFrom: timestamp('valid_from', { withTimezone: true }),
  validTo: timestamp('valid_to', { withTimezone: true }),
  status: extractStatus('status').notNull().default('pending'),
  rawJson: jsonb('raw_json'),
  error: text('error'),
  tokensIn: integer('tokens_in'),
  tokensOut: integer('tokens_out'),
  splitRetry: boolean('split_retry').notNull().default(false),
}, (t) => [
  unique('pages_leaflet_page').on(t.leafletId, t.pageNo),
  index('pages_hash_idx').on(t.imageHash),
])

export const products = pgTable('products', {
  id: uuid('id').primaryKey().defaultRandom(),
  canonicalKey: text('canonical_key').notNull().unique(),
  displayName: text('display_name').notNull(),
  brand: text('brand'),
  sizeValue: integer('size_value'),
  sizeUnit: sizeUnit('size_unit'),
})

export const offers = pgTable('offers', {
  id: uuid('id').primaryKey().defaultRandom(),
  leafletId: uuid('leaflet_id').notNull().references(() => leaflets.id),
  pageNo: integer('page_no').notNull(),
  rawName: text('raw_name').notNull(),
  brand: text('brand'),
  name: text('name').notNull(),
  sizeValue: integer('size_value'),
  sizeUnit: sizeUnit('size_unit'),
  priceGrosze: integer('price_grosze'),
  priceBefore: integer('price_before'),
  priceRegular: integer('price_regular'),
  discountPercent: integer('discount_percent'),
  promoKind: promoKind('promo_kind').notNull(),
  minQty: integer('min_qty'),
  unitPriceGrosze: integer('unit_price_grosze'),
  unitBasis: unitBasis('unit_basis'),
  unitPriceRaw: text('unit_price_raw'),
  requiresLoyalty: boolean('requires_loyalty').notNull().default(false),
  purchaseLimit: text('purchase_limit'),
  validFrom: timestamp('valid_from', { withTimezone: true }),
  validTo: timestamp('valid_to', { withTimezone: true }),
  dateSource: dateSource('date_source').notNull(),
  canonicalKey: text('canonical_key'),
  productId: uuid('product_id').references(() => products.id),
  matchMethod: matchMethod('match_method'),
  matchScore: real('match_score'),
  needsReview: boolean('needs_review').notNull().default(false),
  bbox: jsonb('bbox'),
}, (t) => [
  index('offers_product_idx').on(t.productId),
  index('offers_valid_idx').on(t.validFrom, t.validTo),
])

export const jobRuns = pgTable('job_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  script: text('script').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  status: text('status').notNull().default('running'),
  stats: jsonb('stats'),
  error: text('error'),
})

export const sourceCursors = pgTable('source_cursors', {
  sourceSlug: text('source_slug').primaryKey(),
  lastSeenDate: timestamp('last_seen_date', { withTimezone: true }).notNull(),
})
```

- [ ] **Step 4: Create `drizzle.config.ts`**

```ts
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/lib/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
})
```

- [ ] **Step 5: Generate and apply migrations to both databases**

```bash
pnpm db:generate
DATABASE_URL=postgres://promo:promo@localhost:55432/promo_radar pnpm db:migrate
DATABASE_URL=postgres://promo:promo@localhost:55432/promo_radar_test pnpm db:migrate
```

Then add a trigram index by hand, since drizzle-kit does not emit GIN operator classes. Create `drizzle/9999_trgm.sql`:

```sql
create extension if not exists pg_trgm;
create index if not exists products_name_trgm
  on products using gin (display_name gin_trgm_ops);
```

Apply it to both databases:

```bash
for u in promo_radar promo_radar_test; do
  docker-compose exec -T db psql -U promo -d $u < drizzle/9999_trgm.sql
done
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm vitest run tests/db/schema.test.ts`
Expected: PASS — both tests green.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add database schema with trigram index"
```

---

### Task 3: Money parsing

**Files:**
- Create: `src/lib/normalize/money.ts`
- Test: `tests/normalize/money.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `parseGrosze(raw: string): number | null`; `type UnitBasis = 'kg' | 'l' | 'pcs'`; `interface UnitPrice { grosze: number; basis: UnitBasis }`; `parseUnitPrice(raw: string): UnitPrice | null`.

Unit prices are **normalized at parse time** to per-kilogram, per-litre or per-piece, so comparison across pack sizes is a plain integer comparison later.

- [ ] **Step 1: Write the failing test `tests/normalize/money.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { parseGrosze, parseUnitPrice } from '@/lib/normalize/money'

describe('parseGrosze', () => {
  const cases: Array<[string, number | null]> = [
    ['7,99', 799],
    ['7 99', 799],          // big-digit price rendered with a gap
    ['28,99', 2899],
    ['1,50', 150],
    ['2,99 zł', 299],
    ['14,99/kg', 1499],
    ['0,80', 80],
    ['199', 19900],         // whole zloty, no decimals
    ['', null],
    ['gratis', null],
  ]
  it.each(cases)('parses %s', (input, expected) => {
    expect(parseGrosze(input)).toBe(expected)
  })
})

describe('parseUnitPrice', () => {
  it('normalizes zł/100 g to per kilogram', () => {
    expect(parseUnitPrice('0,80 zł/100 g')).toEqual({ grosze: 800, basis: 'kg' })
  })
  it('keeps zł/kg as per kilogram', () => {
    expect(parseUnitPrice('14,99 zł/kg')).toEqual({ grosze: 1499, basis: 'kg' })
  })
  it('normalizes zł/100 ml to per litre', () => {
    expect(parseUnitPrice('1,20 zł/100 ml')).toEqual({ grosze: 1200, basis: 'l' })
  })
  it('keeps zł/l as per litre', () => {
    expect(parseUnitPrice('3,49 zł/l')).toEqual({ grosze: 349, basis: 'l' })
  })
  it('treats per-piece bases as pcs', () => {
    expect(parseUnitPrice('1,50 zł/rolka')).toEqual({ grosze: 150, basis: 'pcs' })
    expect(parseUnitPrice('2,00 zł/szt.')).toEqual({ grosze: 200, basis: 'pcs' })
  })
  it('returns null when there is no unit', () => {
    expect(parseUnitPrice('7,99')).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run tests/normalize/money.test.ts`
Expected: FAIL — cannot resolve `@/lib/normalize/money`.

- [ ] **Step 3: Implement `src/lib/normalize/money.ts`**

```ts
export type UnitBasis = 'kg' | 'l' | 'pcs'
export interface UnitPrice { grosze: number; basis: UnitBasis }

const NUMBER = /(\d+)\s*[,.]\s*(\d{2})|(\d+)/

/** Parses a printed Polish price into integer grosze. */
export function parseGrosze(raw: string): number | null {
  if (!raw) return null
  // Leaflets render "7 99" with the grosze part as a superscript.
  const spaced = raw.match(/(\d+)\s+(\d{2})(?!\d)/)
  if (spaced) return Number(spaced[1]) * 100 + Number(spaced[2])
  const m = raw.match(NUMBER)
  if (!m) return null
  if (m[1] !== undefined && m[2] !== undefined) {
    return Number(m[1]) * 100 + Number(m[2])
  }
  return Number(m[3]) * 100
}

const BASES: Array<[RegExp, UnitBasis, number]> = [
  [/\/\s*100\s*g/i, 'kg', 10],
  [/\/\s*kg/i, 'kg', 1],
  [/\/\s*100\s*ml/i, 'l', 10],
  [/\/\s*(l|litr)/i, 'l', 1],
  [/\/\s*(szt|rolka|rolki|opak|sztuk)/i, 'pcs', 1],
]

/** Parses a unit price and normalizes it to per kg, per l or per piece. */
export function parseUnitPrice(raw: string): UnitPrice | null {
  if (!raw) return null
  const grosze = parseGrosze(raw)
  if (grosze === null) return null
  for (const [re, basis, factor] of BASES) {
    if (re.test(raw)) return { grosze: grosze * factor, basis }
  }
  return null
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/normalize/money.test.ts`
Expected: PASS — all cases green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/normalize/money.ts tests/normalize/money.test.ts
git commit -m "feat: parse Polish leaflet prices into integer grosze"
```

---

### Task 4: Size and unit extraction

**Files:**
- Create: `src/lib/normalize/size.ts`
- Test: `tests/normalize/size.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type SizeUnit = 'g' | 'ml' | 'pcs'`; `interface Size { value: number; unit: SizeUnit }`; `extractSize(name: string): Size | null`.

- [ ] **Step 1: Write the failing test `tests/normalize/size.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { extractSize } from '@/lib/normalize/size'

describe('extractSize', () => {
  const cases: Array<[string, ReturnType<typeof extractSize>]> = [
    ['Masło Ekstra Mleczna Dolina, 200 g', { value: 200, unit: 'g' }],
    ['Napój gazowany, 2 l', { value: 2000, unit: 'ml' }],
    ['Ręczniki kuchenne Queen Milla, 2 rolki', { value: 2, unit: 'pcs' }],
    ['Karma dla psa, 1,5 kg', { value: 1500, unit: 'g' }],
    ['Sok pomarańczowy, 900 ml', { value: 900, unit: 'ml' }],
    ['Jogurt naturalny, 4 x 125 g', { value: 500, unit: 'g' }],
    ['Winogrono jasne na wagę', null],
    ['Karkówka grillowa pakowana próżniowo', null],
  ]
  it.each(cases)('extracts from %s', (input, expected) => {
    expect(extractSize(input)).toEqual(expected)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run tests/normalize/size.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/normalize/size.ts`**

```ts
export type SizeUnit = 'g' | 'ml' | 'pcs'
export interface Size { value: number; unit: SizeUnit }

const num = (s: string) => Number(s.replace(',', '.'))

/** Multipack first: "4 x 125 g" is 500 g, not 125 g. */
const MULTIPACK = /(\d+)\s*[x×]\s*(\d+(?:[,.]\d+)?)\s*(kg|g|l|ml)\b/i
const SINGLE = /(\d+(?:[,.]\d+)?)\s*(kg|g|l|ml)\b/i
const PIECES = /(\d+)\s*(szt\.?|rolki|rolka|opakowa[nń]|sztuk)\b/i

function toCanonical(value: number, unit: string): Size {
  switch (unit.toLowerCase()) {
    case 'kg': return { value: Math.round(value * 1000), unit: 'g' }
    case 'g': return { value: Math.round(value), unit: 'g' }
    case 'l': return { value: Math.round(value * 1000), unit: 'ml' }
    default: return { value: Math.round(value), unit: 'ml' }
  }
}

export function extractSize(name: string): Size | null {
  const multi = name.match(MULTIPACK)
  if (multi) {
    const one = toCanonical(num(multi[2]!), multi[3]!)
    return { value: one.value * Number(multi[1]), unit: one.unit }
  }
  const single = name.match(SINGLE)
  if (single) return toCanonical(num(single[1]!), single[2]!)
  const pieces = name.match(PIECES)
  if (pieces) return { value: Number(pieces[1]), unit: 'pcs' }
  return null
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/normalize/size.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/normalize/size.ts tests/normalize/size.test.ts
git commit -m "feat: extract and canonicalize package sizes"
```

---

### Task 5: Stoplist and canonical key

**Files:**
- Create: `src/lib/normalize/stopwords.ts`, `src/lib/normalize/canonical.ts`
- Test: `tests/normalize/canonical.test.ts`

**Interfaces:**
- Consumes: `Size`, `SizeUnit` from Task 4.
- Produces: `STOPWORDS: string[]`; `coreName(raw: string): string`; `canonicalKey(input: { brand: string | null; name: string; size: Size | null }): string`.

Polish diacritics are preserved — `masło` and `maslo` are different words, and the vision model reads the diacritics correctly.

- [ ] **Step 1: Write the failing test `tests/normalize/canonical.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { coreName, canonicalKey } from '@/lib/normalize/canonical'

describe('coreName', () => {
  it('strips marketing tokens and punctuation, keeps diacritics', () => {
    expect(coreName('Masło Ekstra Mleczna Dolina, 200 g, Mega Paka'))
      .toBe('masło ekstra mleczna dolina')
  })
  it('strips loose-goods wording', () => {
    expect(coreName('Winogrono jasne na wagę')).toBe('winogrono jasne')
  })
  it('collapses whitespace', () => {
    expect(coreName('Napój   gazowany,  2 l')).toBe('napój gazowany')
  })
})

describe('canonicalKey', () => {
  it('combines brand, core name and size', () => {
    expect(canonicalKey({
      brand: 'Mleczna Dolina',
      name: 'Masło Ekstra Mleczna Dolina, 200 g',
      size: { value: 200, unit: 'g' },
    })).toBe('mleczna dolina|masło ekstra mleczna dolina|200g')
  })
  it('omits the size segment when there is none', () => {
    expect(canonicalKey({
      brand: null,
      name: 'Winogrono jasne na wagę',
      size: null,
    })).toBe('|winogrono jasne|')
  })
  it('is stable across letter case and trailing punctuation', () => {
    const a = canonicalKey({ brand: 'MORLINY', name: 'Kiełbasa Śląska.', size: null })
    const b = canonicalKey({ brand: 'Morliny', name: 'kiełbasa śląska', size: null })
    expect(a).toBe(b)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run tests/normalize/canonical.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/normalize/stopwords.ts`**

```ts
/**
 * Marketing text observed in Polish leaflets that carries no product identity.
 * Extend this list as new phrasing shows up; `rescore.ts` can then re-key
 * historical offers without any API calls.
 */
export const STOPWORDS = [
  'mega paka',
  'supercena',
  'super cena',
  'nowość',
  'na wagę',
  'gratis',
  'promocja',
  'taniej',
  'duża paczka',
  'mieszaj dowolnie',
  'pakowane próżniowo',
  'pakowana próżniowo',
]
```

- [ ] **Step 4: Implement `src/lib/normalize/canonical.ts`**

```ts
import type { Size } from '@/lib/normalize/size'
import { STOPWORDS } from '@/lib/normalize/stopwords'

const SIZE_TOKENS = /\b\d+(?:[,.]\d+)?\s*(kg|g|l|ml|szt\.?|rolki|rolka|opakowa[nń]|sztuk)\b/gi
const MULTIPACK_TOKENS = /\b\d+\s*[x×]\s*\d+(?:[,.]\d+)?\s*(kg|g|l|ml)\b/gi

export function coreName(raw: string): string {
  let s = raw.toLowerCase()
  s = s.replace(MULTIPACK_TOKENS, ' ').replace(SIZE_TOKENS, ' ')
  for (const w of STOPWORDS) s = s.split(w).join(' ')
  s = s.replace(/[.,;:!()\[\]"'“”]/g, ' ')
  return s.replace(/\s+/g, ' ').trim()
}

export function canonicalKey(input: {
  brand: string | null
  name: string
  size: Size | null
}): string {
  const brand = (input.brand ?? '').toLowerCase().trim()
  const size = input.size ? `${input.size.value}${input.size.unit}` : ''
  return `${brand}|${coreName(input.name)}|${size}`
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm vitest run tests/normalize/canonical.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/normalize/ tests/normalize/canonical.test.ts
git commit -m "feat: build canonical product keys from leaflet names"
```

---

### Task 6: Dates — badges, issue year, precedence

**Files:**
- Create: `src/lib/extract/dates.ts`
- Test: `tests/extract/dates.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `interface DateRange { from: Date; to: Date }`; `type DateSource = 'offer' | 'page' | 'leaflet'`; `parseIssueYear(text: string): number | null`; `parseDateBadge(text: string, anchorYear: number): DateRange | null`; `resolveDates(offer: DateRange | null, page: DateRange | null, leaflet: DateRange): { range: DateRange; source: DateSource }`; `fallbackLeafletRange(publishedAt: Date): DateRange`.

Badges print no year (`OD 12.08 DO 14.08`). The year is taken from the issue number (`NR 33/2026`) when present, otherwise from the leaflet's publication date. When the end date falls before the start date, the range crosses New Year and the end date rolls into the following year.

- [ ] **Step 1: Write the failing test `tests/extract/dates.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import {
  parseIssueYear, parseDateBadge, resolveDates, fallbackLeafletRange,
} from '@/lib/extract/dates'

describe('parseIssueYear', () => {
  it('reads the year from the issue number', () => {
    expect(parseIssueYear('NR 33/2026 P')).toBe(2026)
  })
  it('returns null when absent', () => {
    expect(parseIssueYear('Produkty dostępne do wyczerpania zapasów.')).toBeNull()
  })
})

describe('parseDateBadge', () => {
  it('parses an offer badge', () => {
    const r = parseDateBadge('OFERTA OD 12.08 DO 14.08', 2026)!
    expect(r.from.toISOString().slice(0, 10)).toBe('2026-08-12')
    expect(r.to.toISOString().slice(0, 10)).toBe('2026-08-14')
  })
  it('parses a page header with weekday names', () => {
    const r = parseDateBadge('ŚRODA – PIĄTEK 12.08-14.08', 2026)!
    expect(r.from.toISOString().slice(0, 10)).toBe('2026-08-12')
    expect(r.to.toISOString().slice(0, 10)).toBe('2026-08-14')
  })
  it('rolls the end date into the next year across New Year', () => {
    const r = parseDateBadge('OFERTA OD 28.12 DO 03.01', 2026)!
    expect(r.from.toISOString().slice(0, 10)).toBe('2026-12-28')
    expect(r.to.toISOString().slice(0, 10)).toBe('2027-01-03')
  })
  it('returns null when there are no dates', () => {
    expect(parseDateBadge('1+1 GRATIS', 2026)).toBeNull()
  })
})

describe('resolveDates', () => {
  const leaflet = {
    from: new Date('2026-08-12T00:00:00Z'),
    to: new Date('2026-08-19T00:00:00Z'),
  }
  const page = {
    from: new Date('2026-08-12T00:00:00Z'),
    to: new Date('2026-08-14T00:00:00Z'),
  }
  const offer = {
    from: new Date('2026-08-13T00:00:00Z'),
    to: new Date('2026-08-14T00:00:00Z'),
  }

  it('prefers the offer badge', () => {
    const r = resolveDates(offer, page, leaflet)
    expect(r.source).toBe('offer')
    expect(r.range.from).toEqual(offer.from)
  })
  it('falls back to the page header', () => {
    expect(resolveDates(null, page, leaflet).source).toBe('page')
  })
  it('falls back to the leaflet range', () => {
    expect(resolveDates(null, null, leaflet).source).toBe('leaflet')
  })
})

describe('fallbackLeafletRange', () => {
  it('spans a week from publication', () => {
    const r = fallbackLeafletRange(new Date('2026-08-12T10:17:04Z'))
    expect(r.to.getTime() - r.from.getTime()).toBe(7 * 24 * 3600 * 1000)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run tests/extract/dates.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/extract/dates.ts`**

```ts
export interface DateRange { from: Date; to: Date }
export type DateSource = 'offer' | 'page' | 'leaflet'

const ISSUE = /\bNR\s*\d+\s*\/\s*(20\d{2})/i
const TWO_DATES = /(\d{1,2})[.,](\d{1,2})\D{1,12}?(\d{1,2})[.,](\d{1,2})/

export function parseIssueYear(text: string): number | null {
  const m = text.match(ISSUE)
  return m ? Number(m[1]) : null
}

function utcDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day))
}

export function parseDateBadge(text: string, anchorYear: number): DateRange | null {
  const m = text.match(TWO_DATES)
  if (!m) return null
  const [d1, m1, d2, m2] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])]
  const from = utcDate(anchorYear, m1, d1)
  let to = utcDate(anchorYear, m2, d2)
  if (to < from) to = utcDate(anchorYear + 1, m2, d2)
  return { from, to }
}

export function resolveDates(
  offer: DateRange | null,
  page: DateRange | null,
  leaflet: DateRange,
): { range: DateRange; source: DateSource } {
  if (offer) return { range: offer, source: 'offer' }
  if (page) return { range: page, source: 'page' }
  return { range: leaflet, source: 'leaflet' }
}

export function fallbackLeafletRange(publishedAt: Date): DateRange {
  return {
    from: publishedAt,
    to: new Date(publishedAt.getTime() + 7 * 24 * 3600 * 1000),
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/extract/dates.test.ts`
Expected: PASS — all cases including the New Year rollover.

- [ ] **Step 5: Commit**

```bash
git add src/lib/extract/dates.ts tests/extract/dates.test.ts
git commit -m "feat: resolve offer validity dates with documented precedence"
```

---

### Task 7: Source adapter — discovery

**Files:**
- Create: `src/lib/sources/types.ts`, `src/lib/sources/rate-limit.ts`, `src/lib/sources/gazetkipromocyjne.ts`, `src/lib/sources/index.ts`
- Test: `tests/sources/gazetkipromocyjne.test.ts`, `tests/fixtures/media-2026-08-12.json`

**Interfaces:**
- Consumes: `config` from Task 1.
- Produces: `interface DiscoveredLeaflet { shopSlug: string; externalId: string; pdfUrl: string; publishedAt: Date; coverUrl: string | null }`; `interface LeafletSource { slug: string; discover(shopSlugs: readonly string[], since: Date | null): Promise<DiscoveredLeaflet[]>; fetchAsset(l: DiscoveredLeaflet, destDir: string): Promise<{ path: string; sha256: string }> }`; `parseMediaItems(items: unknown[], allowlist: readonly string[]): DiscoveredLeaflet[]`; `gazetkiSource: LeafletSource`; `createRateLimiter(minIntervalMs: number)`.

`parseMediaItems` is exported separately from `discover` so the mapping logic is testable without any network access.

- [ ] **Step 1: Record the fixture from the live API**

```bash
mkdir -p tests/fixtures
curl -s -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/127 Safari/537.36" \
  "https://www.gazetkipromocyjne.net/wp-json/wp/v2/media?mime_type=application/pdf&per_page=100&orderby=date&order=desc&_fields=id,date,source_url,post,link,media_details" \
  -o tests/fixtures/media-2026-08-12.json
node -e "const d=require('./tests/fixtures/media-2026-08-12.json');console.log(d.length,'items')"
```

Expected: prints a count between 1 and 100.

- [ ] **Step 2: Write the failing test `tests/sources/gazetkipromocyjne.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseMediaItems } from '@/lib/sources/gazetkipromocyjne'

const items = JSON.parse(
  readFileSync('tests/fixtures/media-2026-08-12.json', 'utf8'),
) as unknown[]

describe('parseMediaItems', () => {
  it('keeps only allowlisted shops', () => {
    const out = parseMediaItems(items, ['biedronka', 'lidl', 'kaufland'])
    expect(out.length).toBeGreaterThan(0)
    for (const l of out) {
      expect(['biedronka', 'lidl', 'kaufland']).toContain(l.shopSlug)
    }
  })

  it('derives the shop from link, not from the filename prefix', () => {
    const out = parseMediaItems(
      [{
        id: 1,
        date: '2026-08-12T10:17:04',
        link: 'https://www.gazetkipromocyjne.net/lidl/attachment/0__abc/',
        source_url: 'https://www.gazetkipromocyjne.net/wp-content/uploads/pdf/0__abc.pdf',
        post: 0,
      }],
      ['lidl'],
    )
    expect(out).toEqual([{
      shopSlug: 'lidl',
      externalId: '1',
      pdfUrl: 'https://www.gazetkipromocyjne.net/wp-content/uploads/pdf/0__abc.pdf',
      publishedAt: new Date('2026-08-12T10:17:04'),
      coverUrl: null,
    }])
  })

  it('skips items whose link has no shop slug', () => {
    expect(parseMediaItems(
      [{
        id: 2, date: '2026-08-12T10:00:00',
        link: 'https://www.gazetkipromocyjne.net/attachment/x/',
        source_url: 'https://example.test/x.pdf', post: 0,
      }],
      ['lidl'],
    )).toEqual([])
  })

  it('reads the cover thumbnail when present', () => {
    const out = parseMediaItems(
      [{
        id: 3, date: '2026-08-12T10:00:00',
        link: 'https://www.gazetkipromocyjne.net/biedronka/attachment/y/',
        source_url: 'https://example.test/y.pdf',
        media_details: { sizes: { full: { source_url: 'https://example.test/y-pdf.jpg' } } },
      }],
      ['biedronka'],
    )
    expect(out[0]!.coverUrl).toBe('https://example.test/y-pdf.jpg')
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm vitest run tests/sources/gazetkipromocyjne.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `src/lib/sources/types.ts`**

```ts
export interface DiscoveredLeaflet {
  shopSlug: string
  externalId: string
  pdfUrl: string
  publishedAt: Date
  coverUrl: string | null
}

export interface LeafletSource {
  slug: string
  discover(
    shopSlugs: readonly string[],
    since: Date | null,
  ): Promise<DiscoveredLeaflet[]>
  fetchAsset(
    leaflet: DiscoveredLeaflet,
    destDir: string,
  ): Promise<{ path: string; sha256: string }>
}
```

- [ ] **Step 5: Implement `src/lib/sources/rate-limit.ts`**

```ts
/** Serializes calls so consecutive requests are at least minIntervalMs apart. */
export function createRateLimiter(minIntervalMs: number) {
  let tail = Promise.resolve()
  let last = 0
  return function schedule<T>(fn: () => Promise<T>): Promise<T> {
    const run = tail.then(async () => {
      const wait = last + minIntervalMs - Date.now()
      if (wait > 0) await new Promise((r) => setTimeout(r, wait))
      last = Date.now()
      return fn()
    })
    tail = run.then(() => undefined, () => undefined)
    return run
  }
}
```

- [ ] **Step 6: Implement `src/lib/sources/gazetkipromocyjne.ts`**

```ts
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { config } from '@/lib/config'
import { createRateLimiter } from '@/lib/sources/rate-limit'
import type { DiscoveredLeaflet, LeafletSource } from '@/lib/sources/types'

const SHOP_FROM_LINK = /^https?:\/\/[^/]+\/([^/]+)\/attachment\//

export function parseMediaItems(
  items: unknown[],
  allowlist: readonly string[],
): DiscoveredLeaflet[] {
  const out: DiscoveredLeaflet[] = []
  for (const raw of items) {
    const it = raw as {
      id?: number
      date?: string
      link?: string
      source_url?: string
      media_details?: { sizes?: { full?: { source_url?: string } } }
    }
    if (!it.id || !it.date || !it.link || !it.source_url) continue
    const m = it.link.match(SHOP_FROM_LINK)
    const slug = m?.[1]
    if (!slug || !allowlist.includes(slug)) continue
    out.push({
      shopSlug: slug,
      externalId: String(it.id),
      pdfUrl: it.source_url,
      publishedAt: new Date(it.date),
      coverUrl: it.media_details?.sizes?.full?.source_url ?? null,
    })
  }
  return out
}

const limit = createRateLimiter(1000)

async function getJson(url: string): Promise<unknown[]> {
  const res = await limit(() =>
    fetch(url, { headers: { 'User-Agent': config.userAgent } }),
  )
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`)
  return (await res.json()) as unknown[]
}

export const gazetkiSource: LeafletSource = {
  slug: 'gazetkipromocyjne',

  async discover(shopSlugs, since) {
    const found: DiscoveredLeaflet[] = []
    for (let page = 1; page <= 10; page++) {
      const params = new URLSearchParams({
        mime_type: 'application/pdf',
        per_page: '100',
        page: String(page),
        orderby: 'date',
        order: 'asc',
        _fields: 'id,date,source_url,link,media_details',
      })
      if (since) params.set('after', since.toISOString())
      const items = await getJson(
        `${config.sourceBaseUrl}/wp-json/wp/v2/media?${params}`,
      )
      found.push(...parseMediaItems(items, shopSlugs))
      if (items.length < 100) break
    }
    return found
  },

  async fetchAsset(leaflet, destDir) {
    const res = await limit(() =>
      fetch(leaflet.pdfUrl, { headers: { 'User-Agent': config.userAgent } }),
    )
    if (!res.ok) throw new Error(`GET ${leaflet.pdfUrl} failed: ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    const sha256 = createHash('sha256').update(buf).digest('hex')
    const dir = join(destDir, leaflet.shopSlug)
    await mkdir(dir, { recursive: true })
    const path = join(dir, `${leaflet.externalId}.pdf`)
    await writeFile(path, buf)
    return { path, sha256 }
  },
}
```

- [ ] **Step 7: Implement `src/lib/sources/index.ts`**

```ts
import { gazetkiSource } from '@/lib/sources/gazetkipromocyjne'
import type { LeafletSource } from '@/lib/sources/types'

export const sources: Record<string, LeafletSource> = {
  [gazetkiSource.slug]: gazetkiSource,
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `pnpm vitest run tests/sources/gazetkipromocyjne.test.ts`
Expected: PASS — four tests green.

- [ ] **Step 9: Commit**

```bash
git add src/lib/sources/ tests/sources/ tests/fixtures/
git commit -m "feat: discover new leaflets via the WordPress media endpoint"
```

---

### Task 8: Rasterizing pages, with cropping

**Files:**
- Create: `src/lib/acquire/rasterize.ts`
- Test: `tests/acquire/rasterize.test.ts`, `tests/fixtures/leaflet-2pages.pdf`

**Interfaces:**
- Consumes: nothing.
- Produces: `pageCount(pdfPath: string): Promise<number>`; `pageSizePx(pdfPath: string, dpi: number): Promise<{ width: number; height: number }>`; `renderPage(pdfPath: string, pageNo: number, outDir: string, dpi?: number): Promise<{ path: string; sha256: string }>`; `renderHalves(pdfPath: string, pageNo: number, outDir: string, dpi?: number): Promise<Array<{ path: string; sha256: string }>>`.

Cropping is done by poppler (`pdftoppm -x -y -W -H`), so no image-processing library is needed. Halves overlap by 10% of page height, which keeps a tile that straddles the midpoint intact in at least one half.

- [ ] **Step 1: Build the fixture — a 2-page slice of a real leaflet**

```bash
mkdir -p tests/fixtures /tmp/pr
curl -sL -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/127 Safari/537.36" \
  -o /tmp/pr/full.pdf \
  "https://www.gazetkipromocyjne.net/wp-content/uploads/pdf/4__6a7c1f3ae960d.pdf"
pdfseparate -f 1 -l 2 /tmp/pr/full.pdf /tmp/pr/page-%d.pdf
pdfunite /tmp/pr/page-1.pdf /tmp/pr/page-2.pdf tests/fixtures/leaflet-2pages.pdf
pdfinfo tests/fixtures/leaflet-2pages.pdf | grep -E "^Pages|^Page size"
ls -lh tests/fixtures/leaflet-2pages.pdf
```

Expected: `Pages: 2`, page size `1146 x 1800 pts`, file about 1–2 MB.

If that URL has expired (the source keeps roughly one week), pick any current
Biedronka PDF from
`https://www.gazetkipromocyjne.net/wp-json/wp/v2/media?mime_type=application/pdf&per_page=100`
and repeat.

- [ ] **Step 2: Write the failing test `tests/acquire/rasterize.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  pageCount, pageSizePx, renderPage, renderHalves,
} from '@/lib/acquire/rasterize'

const PDF = 'tests/fixtures/leaflet-2pages.pdf'

describe('rasterize', () => {
  it('counts pages', async () => {
    expect(await pageCount(PDF)).toBe(2)
  })

  it('computes pixel size at a given dpi', async () => {
    // 1146 x 1800 pt at 110 dpi
    expect(await pageSizePx(PDF, 110)).toEqual({ width: 1751, height: 2750 })
  })

  it('renders a page to a hashed jpeg', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pr-'))
    const out = await renderPage(PDF, 1, dir)
    expect(out.path.endsWith('.jpg')).toBe(true)
    expect(out.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(statSync(out.path).size).toBeGreaterThan(50_000)
  })

  it('is deterministic — the same page hashes the same twice', async () => {
    const a = await renderPage(PDF, 1, await mkdtemp(join(tmpdir(), 'pr-')))
    const b = await renderPage(PDF, 1, await mkdtemp(join(tmpdir(), 'pr-')))
    expect(a.sha256).toBe(b.sha256)
  })

  it('renders two overlapping halves', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pr-'))
    const halves = await renderHalves(PDF, 1, dir)
    expect(halves).toHaveLength(2)
    expect(halves[0]!.sha256).not.toBe(halves[1]!.sha256)
    for (const h of halves) expect(statSync(h.path).size).toBeGreaterThan(20_000)
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm vitest run tests/acquire/rasterize.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `src/lib/acquire/rasterize.ts`**

```ts
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
const DEFAULT_DPI = 110

async function hashFile(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

export async function pageCount(pdfPath: string): Promise<number> {
  const { stdout } = await run('pdfinfo', [pdfPath])
  const m = stdout.match(/^Pages:\s+(\d+)/m)
  if (!m) throw new Error(`pdfinfo gave no page count for ${pdfPath}`)
  return Number(m[1])
}

export async function pageSizePx(
  pdfPath: string,
  dpi = DEFAULT_DPI,
): Promise<{ width: number; height: number }> {
  const { stdout } = await run('pdfinfo', [pdfPath])
  const m = stdout.match(/^Page size:\s+([\d.]+) x ([\d.]+) pts/m)
  if (!m) throw new Error(`pdfinfo gave no page size for ${pdfPath}`)
  return {
    width: Math.round((Number(m[1]) / 72) * dpi),
    height: Math.round((Number(m[2]) / 72) * dpi),
  }
}

const JPEG_ARGS = ['-jpeg', '-jpegopt', 'quality=80']

export async function renderPage(
  pdfPath: string,
  pageNo: number,
  outDir: string,
  dpi = DEFAULT_DPI,
): Promise<{ path: string; sha256: string }> {
  const prefix = join(outDir, `p${pageNo}`)
  await run('pdftoppm', [
    '-f', String(pageNo), '-l', String(pageNo),
    '-r', String(dpi), ...JPEG_ARGS, '-singlefile',
    pdfPath, prefix,
  ])
  const path = `${prefix}.jpg`
  return { path, sha256: await hashFile(path) }
}

export async function renderHalves(
  pdfPath: string,
  pageNo: number,
  outDir: string,
  dpi = DEFAULT_DPI,
): Promise<Array<{ path: string; sha256: string }>> {
  const { width, height } = await pageSizePx(pdfPath, dpi)
  const overlap = Math.round(height * 0.1)
  const windows = [
    { y: 0, h: Math.round(height / 2) + overlap, tag: 'top' },
    { y: Math.round(height / 2) - overlap, h: Math.round(height / 2) + overlap, tag: 'bottom' },
  ]
  const out: Array<{ path: string; sha256: string }> = []
  for (const w of windows) {
    const prefix = join(outDir, `p${pageNo}-${w.tag}`)
    await run('pdftoppm', [
      '-f', String(pageNo), '-l', String(pageNo),
      '-r', String(dpi), ...JPEG_ARGS, '-singlefile',
      '-x', '0', '-y', String(w.y), '-W', String(width), '-H', String(w.h),
      pdfPath, prefix,
    ])
    const path = `${prefix}.jpg`
    out.push({ path, sha256: await hashFile(path) })
  }
  return out
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm vitest run tests/acquire/rasterize.test.ts`
Expected: PASS — five tests green.

If `pageSizePx` returns something other than 1751×2750, the fixture PDF has a
different page size; update the expectation to `round(pts / 72 * 110)` for the
actual size reported by `pdfinfo`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/acquire/rasterize.ts tests/acquire/ tests/fixtures/leaflet-2pages.pdf
git commit -m "feat: rasterize leaflet pages and crops with poppler"
```

---

### Task 9: Vision extraction

**Files:**
- Create: `src/lib/extract/schema.ts`, `src/lib/extract/prompt.ts`, `src/lib/extract/vision.ts`, `src/lib/extract/openai-client.ts`
- Test: `tests/extract/vision.test.ts`, `tests/extract/golden.test.ts` (records `tests/fixtures/vision-page3.json`)

**Interfaces:**
- Consumes: `config` (Task 1), `renderPage`/`renderHalves` (Task 8).
- Produces: `PageResultSchema`, `OfferTileSchema`, `type PageResult`, `type OfferTile` (zod-inferred); `buildPrompt(): string`; `interface VisionClient { parsePage(imagePath: string, model: string): Promise<{ result: PageResult; tokensIn: number; tokensOut: number }> }`; `isSuspicious(r: PageResult): boolean`; `extractPage(args: { client: VisionClient; pdfPath: string; pageNo: number; outDir: string }): Promise<ExtractOutcome>`; `createOpenAiVisionClient(): VisionClient`.

`ExtractOutcome` is:

```ts
interface OutcomeBase {
  tokensIn: number
  tokensOut: number
  splitRetry: boolean
  /** Path and hash of the whole-page render, so the caller can store both. */
  imagePath: string
  imageHash: string
}
export type ExtractOutcome =
  | ({ status: 'done'; result: PageResult } & OutcomeBase)
  | ({ status: 'failed'; error: string } & OutcomeBase)
```

The page hash travels with the outcome because `leaflet_pages.image_hash` is what
makes re-runs free — a page already recorded with a hash is never re-rendered or
re-billed.

- [ ] **Step 1: Write the failing test `tests/extract/vision.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { isSuspicious, extractPage, type PageResult, type VisionClient } from '@/lib/extract/vision'

const tile = (over: Partial<PageResult['tiles'][number]> = {}) => ({
  raw_name: 'Masło Ekstra Mleczna Dolina, 200 g',
  brand: 'Mleczna Dolina',
  price: '1,99',
  price_before: null,
  price_regular: null,
  discount_percent: 60,
  promo_kind: 'multibuy' as const,
  min_qty: 3,
  unit_price_raw: null,
  requires_loyalty: true,
  purchase_limit: 'Limit dzienny 3 szt. na kartę Moja Biedronka',
  date_badge: 'OFERTA OD 13.08 DO 14.08',
  bbox: { x: 0.55, y: 0.03, w: 0.4, h: 0.2 },
  ...over,
})

const page = (over: Partial<PageResult> = {}): PageResult => ({
  page_date_badge: 'ŚRODA – PIĄTEK 12.08-14.08',
  issue_text: 'NR 33/2026 P',
  tiles: [tile()],
  ...over,
})

describe('isSuspicious', () => {
  it('flags a page with no tiles', () => {
    expect(isSuspicious(page({ tiles: [] }))).toBe(true)
  })
  it('flags a plain-price tile with no price', () => {
    expect(isSuspicious(page({
      tiles: [tile({ promo_kind: 'price', price: null })],
    }))).toBe(true)
  })
  it('accepts a bogo tile with no price', () => {
    expect(isSuspicious(page({
      tiles: [tile({ promo_kind: 'bogo', price: null })],
    }))).toBe(false)
  })
  it('accepts a healthy page', () => {
    expect(isSuspicious(page())).toBe(false)
  })
})

describe('extractPage', () => {
  const PDF = 'tests/fixtures/leaflet-2pages.pdf'

  it('returns the first result when it is healthy, without splitting', async () => {
    const calls: string[] = []
    const client: VisionClient = {
      async parsePage(imagePath) {
        calls.push(imagePath)
        return { result: page(), tokensIn: 1000, tokensOut: 500 }
      },
    }
    const out = await extractPage({ client, pdfPath: PDF, pageNo: 1, outDir: 'storage/test' })
    expect(out.status).toBe('done')
    expect(calls).toHaveLength(1)
    expect(out.splitRetry).toBe(false)
  })

  it('retries as halves when the page looks suspicious, and merges tiles', async () => {
    const calls: string[] = []
    const client: VisionClient = {
      async parsePage(imagePath) {
        calls.push(imagePath)
        if (calls.length === 1) return { result: page({ tiles: [] }), tokensIn: 900, tokensOut: 10 }
        return { result: page(), tokensIn: 800, tokensOut: 400 }
      },
    }
    const out = await extractPage({ client, pdfPath: PDF, pageNo: 1, outDir: 'storage/test' })
    expect(calls).toHaveLength(3)          // whole page, then two halves
    expect(out.splitRetry).toBe(true)
    expect(out.status).toBe('done')
    if (out.status === 'done') expect(out.result.tiles).toHaveLength(2)
    expect(out.tokensIn).toBe(2500)        // tokens accumulate across all calls
  })

  it('fails when both halves are still suspicious', async () => {
    const client: VisionClient = {
      async parsePage() {
        return { result: page({ tiles: [] }), tokensIn: 100, tokensOut: 5 }
      },
    }
    const out = await extractPage({ client, pdfPath: PDF, pageNo: 1, outDir: 'storage/test' })
    expect(out.status).toBe('failed')
    expect(out.splitRetry).toBe(true)
  })

  it('fails with the error message when the client throws', async () => {
    const client: VisionClient = {
      async parsePage() { throw new Error('schema validation failed') },
    }
    const out = await extractPage({ client, pdfPath: PDF, pageNo: 1, outDir: 'storage/test' })
    expect(out.status).toBe('failed')
    if (out.status === 'failed') expect(out.error).toContain('schema validation failed')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run tests/extract/vision.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/extract/schema.ts`**

```ts
import { z } from 'zod'

export const OfferTileSchema = z.object({
  raw_name: z.string(),
  brand: z.string().nullable(),
  price: z.string().nullable(),
  price_before: z.string().nullable(),
  price_regular: z.string().nullable(),
  discount_percent: z.number().int().nullable(),
  promo_kind: z.enum(['price', 'percent', 'multibuy', 'bogo']),
  min_qty: z.number().int().nullable(),
  unit_price_raw: z.string().nullable(),
  requires_loyalty: z.boolean(),
  purchase_limit: z.string().nullable(),
  date_badge: z.string().nullable(),
  bbox: z.object({
    x: z.number(), y: z.number(), w: z.number(), h: z.number(),
  }),
})

export const PageResultSchema = z.object({
  page_date_badge: z.string().nullable(),
  issue_text: z.string().nullable(),
  tiles: z.array(OfferTileSchema),
})

export type OfferTile = z.infer<typeof OfferTileSchema>
export type PageResult = z.infer<typeof PageResultSchema>
```

- [ ] **Step 4: Implement `src/lib/extract/prompt.ts`**

```ts
export function buildPrompt(): string {
  return `You are reading one page of a Polish supermarket promotional leaflet (gazetka).

Return every promotional tile on the page. A tile is one product offer: a price block plus the product name near it.

Field rules:
- raw_name: the product description exactly as printed, including size text.
- brand: the manufacturer brand if identifiable (e.g. "Mleczna Dolina", "Morliny", "Coca-Cola"), otherwise null.
- price: the large promotional price exactly as printed, e.g. "7,99". Null if the tile has no single price (for example "1+1 GRATIS").
- price_before: the value labelled "Cena przed obniżką".
- price_regular: the value labelled "Cena poza promocją" or "Cena bez karty".
- discount_percent: the integer from a "NN% TANIEJ" badge.
- promo_kind: "multibuy" when the tile says "PRZY ZAKUPIE n" or "KAŻDA Z n SZTUK"; "bogo" for "1+1 GRATIS" or similar; "percent" when the offer is expressed only as a percentage; otherwise "price".
- min_qty: the n from "PRZY ZAKUPIE n" or "KAŻDA Z n SZTUK", otherwise null.
- unit_price_raw: the small per-unit price as printed, e.g. "0,80 zł/100 g" or "1,50 zł/rolka".
- requires_loyalty: true when the tile carries a loyalty badge such as "Z KARTĄ", "Z KARTĄ LUB APKĄ", "Moja Biedronka", "Lidl Plus".
- purchase_limit: text of any limit, e.g. "Limit dzienny 3 szt. na kartę".
- date_badge: the tile's own validity text if present, e.g. "OFERTA OD 12.08 DO 14.08". Null if the tile shows no dates.
- bbox: the tile's bounding box as fractions of page width and height, each between 0 and 1.

Page-level fields:
- page_date_badge: a date range printed as a page header, e.g. "ŚRODA – PIĄTEK 12.08-14.08". Null if absent.
- issue_text: any issue marking such as "NR 33/2026". Null if absent.

Read prices exactly as printed, with the comma. Do not convert, round or compute anything. Do not invent tiles for decorative images or for the shop's own logo.`
}
```

- [ ] **Step 5: Implement `src/lib/extract/vision.ts`**

```ts
import { renderHalves, renderPage } from '@/lib/acquire/rasterize'
import type { PageResult } from '@/lib/extract/schema'

export type { OfferTile, PageResult } from '@/lib/extract/schema'
export { OfferTileSchema, PageResultSchema } from '@/lib/extract/schema'

export interface VisionClient {
  parsePage(
    imagePath: string,
    model: string,
  ): Promise<{ result: PageResult; tokensIn: number; tokensOut: number }>
}

interface OutcomeBase {
  tokensIn: number
  tokensOut: number
  splitRetry: boolean
  imagePath: string
  imageHash: string
}

export type ExtractOutcome =
  | ({ status: 'done'; result: PageResult } & OutcomeBase)
  | ({ status: 'failed'; error: string } & OutcomeBase)

/** A page is suspicious when it yielded nothing, or a priced tile lost its price. */
export function isSuspicious(r: PageResult): boolean {
  if (r.tiles.length === 0) return true
  return r.tiles.some(
    (t) => t.raw_name.trim().length > 0 && t.price === null && t.promo_kind === 'price',
  )
}

export async function extractPage(args: {
  client: VisionClient
  pdfPath: string
  pageNo: number
  outDir: string
  model?: string
  escalationModel?: string
}): Promise<ExtractOutcome> {
  const { client, pdfPath, pageNo, outDir } = args
  const model = args.model ?? 'gpt-5.6-luna'
  const escalation = args.escalationModel ?? 'gpt-5.6-terra'
  let tokensIn = 0
  let tokensOut = 0
  let imagePath = ''
  let imageHash = ''

  try {
    const whole = await renderPage(pdfPath, pageNo, outDir)
    imagePath = whole.path
    imageHash = whole.sha256
    const first = await client.parsePage(whole.path, model)
    tokensIn += first.tokensIn
    tokensOut += first.tokensOut
    if (!isSuspicious(first.result)) {
      return {
        status: 'done', result: first.result,
        tokensIn, tokensOut, splitRetry: false, imagePath, imageHash,
      }
    }

    // Suspicious: re-render as overlapping halves on the stronger model.
    const halves = await renderHalves(pdfPath, pageNo, outDir)
    const merged: PageResult = {
      page_date_badge: first.result.page_date_badge,
      issue_text: first.result.issue_text,
      tiles: [],
    }
    for (const half of halves) {
      const r = await client.parsePage(half.path, escalation)
      tokensIn += r.tokensIn
      tokensOut += r.tokensOut
      merged.tiles.push(...r.result.tiles)
      merged.page_date_badge ??= r.result.page_date_badge
      merged.issue_text ??= r.result.issue_text
    }
    if (isSuspicious(merged)) {
      return {
        status: 'failed',
        error: 'page still suspicious after split retry',
        tokensIn, tokensOut, splitRetry: true, imagePath, imageHash,
      }
    }
    return {
      status: 'done', result: merged,
      tokensIn, tokensOut, splitRetry: true, imagePath, imageHash,
    }
  } catch (e) {
    return {
      status: 'failed',
      error: e instanceof Error ? e.message : String(e),
      tokensIn, tokensOut, splitRetry: false, imagePath, imageHash,
    }
  }
}
```

Note the deliberate behaviour the tests pin down: halves are merged rather than
replaced, tokens accumulate across every call, and a tile without a price is
only suspicious when its `promo_kind` is `price` — a `bogo` tile legitimately
has none.

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm vitest run tests/extract/vision.test.ts`
Expected: PASS — eight tests green.

- [ ] **Step 7: Implement `src/lib/extract/openai-client.ts`**

This is the only file allowed to import `openai`.

```ts
import { readFile } from 'node:fs/promises'
import OpenAI from 'openai'
import { zodTextFormat } from 'openai/helpers/zod'
import { config } from '@/lib/config'
import { buildPrompt } from '@/lib/extract/prompt'
import { PageResultSchema } from '@/lib/extract/schema'
import type { VisionClient } from '@/lib/extract/vision'

export function createOpenAiVisionClient(): VisionClient {
  const client = new OpenAI({ apiKey: config.openaiApiKey() })
  const prompt = buildPrompt()

  return {
    async parsePage(imagePath, model) {
      const b64 = (await readFile(imagePath)).toString('base64')
      const res = await client.responses.parse({
        model,
        input: [{
          role: 'user',
          content: [
            { type: 'input_text', text: prompt },
            { type: 'input_image', image_url: `data:image/jpeg;base64,${b64}`, detail: 'high' },
          ],
        }],
        text: { format: zodTextFormat(PageResultSchema, 'page') },
      })
      if (!res.output_parsed) throw new Error('vision returned no parsed output')
      return {
        result: res.output_parsed,
        tokensIn: res.usage?.input_tokens ?? 0,
        tokensOut: res.usage?.output_tokens ?? 0,
      }
    },
  }
}
```

- [ ] **Step 8: Typecheck the SDK call shape**

Run: `pnpm typecheck`
Expected: no errors. If `responses.parse`, `zodTextFormat` or the content part
names differ in `openai@7.4.0`, fix this file to match the installed types —
`node_modules/openai/resources/responses/responses.d.ts` is the reference. No
other file changes, because everything else depends on `VisionClient`.

- [ ] **Step 9: Record the golden fixture with one real API call**

This is the only test that ever touches the network, and it is opt-in. Running it
writes `tests/fixtures/vision-page3.json`, which the golden test below then reads
on every future run for free.

Create `tests/extract/golden.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { existsSync, writeFileSync, readFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderPage } from '@/lib/acquire/rasterize'
import { PageResultSchema } from '@/lib/extract/schema'
import { parseGrosze } from '@/lib/normalize/money'

const FIXTURE = 'tests/fixtures/vision-page3.json'

describe.runIf(process.env.SMOKE === '1')('live vision smoke', () => {
  it('parses a real leaflet page and records the response', async () => {
    const { createOpenAiVisionClient } = await import('@/lib/extract/openai-client')
    const dir = await mkdtemp(join(tmpdir(), 'smoke-'))
    const img = await renderPage('tests/fixtures/leaflet-2pages.pdf', 1, dir)
    const out = await createOpenAiVisionClient().parsePage(img.path, 'gpt-5.6-luna')
    expect(out.result.tiles.length).toBeGreaterThan(0)
    writeFileSync(FIXTURE, JSON.stringify(out.result, null, 2))
  }, 120_000)
})

describe.runIf(existsSync(FIXTURE))('golden page result', () => {
  const raw = JSON.parse(readFileSync(FIXTURE, 'utf8'))

  it('still satisfies the page schema', () => {
    expect(() => PageResultSchema.parse(raw)).not.toThrow()
  })

  it('yields parseable prices for every plain-price tile', () => {
    const page = PageResultSchema.parse(raw)
    const priced = page.tiles.filter((t) => t.promo_kind === 'price')
    expect(priced.length).toBeGreaterThan(0)
    for (const t of priced) expect(parseGrosze(t.price ?? '')).not.toBeNull()
  })

  it('keeps bbox values as fractions of the page', () => {
    const page = PageResultSchema.parse(raw)
    for (const t of page.tiles) {
      for (const v of [t.bbox.x, t.bbox.y, t.bbox.w, t.bbox.h]) {
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(1)
      }
    }
  })
})
```

Run: `SMOKE=1 pnpm vitest run tests/extract/golden.test.ts`
Expected: the live test passes, the fixture file appears, and the three golden
tests then pass against it. Afterwards `pnpm test` runs the golden tests only —
no network, no cost.

If the bbox test fails because values come back as pixels, tighten that sentence
in `src/lib/extract/prompt.ts` and re-record.

- [ ] **Step 10: Commit**

```bash
git add src/lib/extract/ tests/extract/vision.test.ts tests/extract/golden.test.ts tests/fixtures/vision-page3.json
git commit -m "feat: extract offer tiles from page images with escalating split retry"
```

---

### Task 10: Matching offers to products

**Files:**
- Create: `src/lib/match/attach.ts`
- Test: `tests/match/attach.test.ts`

**Interfaces:**
- Consumes: `db` (Task 1), `products` table (Task 2), `canonicalKey`/`coreName` (Task 5), `Size` (Task 4).
- Produces: `interface MatchInput { brand: string | null; name: string; size: Size | null }`; `interface MatchResult { productId: string; canonicalKey: string; method: 'exact' | 'trigram' | 'new'; score: number | null; needsReview: boolean }`; `attachToProduct(db: Db, input: MatchInput): Promise<MatchResult>`; `THRESHOLD_ATTACH = 0.55`; `THRESHOLD_REVIEW = 0.45`.

- [ ] **Step 1: Write the failing test `tests/match/attach.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { attachToProduct } from '@/lib/match/attach'
import { products } from '@/lib/db/schema'

const pool = new Pool({ connectionString: process.env.DATABASE_URL_TEST })
const db = drizzle(pool)

beforeEach(async () => {
  await pool.query('truncate offers, products cascade')
})

describe('attachToProduct', () => {
  it('creates a new product when nothing matches', async () => {
    const r = await attachToProduct(db, {
      brand: 'Mleczna Dolina',
      name: 'Masło Ekstra Mleczna Dolina, 200 g',
      size: { value: 200, unit: 'g' },
    })
    expect(r.method).toBe('new')
    expect(r.needsReview).toBe(false)
    expect(r.canonicalKey).toBe('mleczna dolina|masło ekstra mleczna dolina|200g')
  })

  it('reuses the product on an exact canonical key', async () => {
    const first = await attachToProduct(db, {
      brand: 'Mleczna Dolina',
      name: 'Masło Ekstra Mleczna Dolina, 200 g',
      size: { value: 200, unit: 'g' },
    })
    const second = await attachToProduct(db, {
      brand: 'mleczna dolina',
      name: 'masło ekstra mleczna dolina 200 g',
      size: { value: 200, unit: 'g' },
    })
    expect(second.method).toBe('exact')
    expect(second.productId).toBe(first.productId)
  })

  it('matches a near-identical name by trigram similarity', async () => {
    const first = await attachToProduct(db, {
      brand: null,
      name: 'Mleko UHT Łaciate 3,2%, 1 l',
      size: { value: 1000, unit: 'ml' },
    })
    const second = await attachToProduct(db, {
      brand: null,
      name: 'Mleko Łaciate 3,2% 1 l',
      size: { value: 1000, unit: 'ml' },
    })
    expect(second.method).toBe('trigram')
    expect(second.productId).toBe(first.productId)
    expect(second.score).toBeGreaterThanOrEqual(0.55)
  })

  it('does not match across different units', async () => {
    await attachToProduct(db, {
      brand: null, name: 'Sok pomarańczowy Hortex, 1 l',
      size: { value: 1000, unit: 'ml' },
    })
    const r = await attachToProduct(db, {
      brand: null, name: 'Sok pomarańczowy Hortex, 1 kg',
      size: { value: 1000, unit: 'g' },
    })
    expect(r.method).toBe('new')
  })

  it('does not match when sizes differ by more than 5%', async () => {
    await attachToProduct(db, {
      brand: null, name: 'Jogurt naturalny Piątnica, 400 g',
      size: { value: 400, unit: 'g' },
    })
    const r = await attachToProduct(db, {
      brand: null, name: 'Jogurt naturalny Piątnica, 150 g',
      size: { value: 150, unit: 'g' },
    })
    expect(r.method).toBe('new')
  })

  it('flags a borderline similarity for review', async () => {
    await db.insert(products).values({
      canonicalKey: 'x|chleb pszenny krojony|500g',
      displayName: 'chleb pszenny krojony',
      sizeValue: 500,
      sizeUnit: 'g',
    })
    const r = await attachToProduct(db, {
      brand: null, name: 'Chleb pszenno-żytni na zakwasie, 500 g',
      size: { value: 500, unit: 'g' },
    })
    // Either a new product or a review flag, but never a silent confident match.
    expect(r.method === 'new' || r.needsReview).toBe(true)
  })

  it('matches loose goods on name alone', async () => {
    const first = await attachToProduct(db, {
      brand: null, name: 'Winogrono jasne na wagę', size: null,
    })
    const second = await attachToProduct(db, {
      brand: null, name: 'Winogrono jasne', size: null,
    })
    expect(second.productId).toBe(first.productId)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run tests/match/attach.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/match/attach.ts`**

```ts
import { and, eq, sql } from 'drizzle-orm'
import type { Db } from '@/lib/db/client'
import { products } from '@/lib/db/schema'
import { canonicalKey, coreName } from '@/lib/normalize/canonical'
import type { Size } from '@/lib/normalize/size'

export const THRESHOLD_ATTACH = 0.55
export const THRESHOLD_REVIEW = 0.45
const SIZE_TOLERANCE = 0.05

export interface MatchInput {
  brand: string | null
  name: string
  size: Size | null
}

export interface MatchResult {
  productId: string
  canonicalKey: string
  method: 'exact' | 'trigram' | 'new'
  score: number | null
  needsReview: boolean
}

export async function attachToProduct(
  db: Db,
  input: MatchInput,
): Promise<MatchResult> {
  const key = canonicalKey(input)
  const core = coreName(input.name)

  const [exact] = await db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.canonicalKey, key))
    .limit(1)
  if (exact) {
    return { productId: exact.id, canonicalKey: key, method: 'exact', score: null, needsReview: false }
  }

  const sizeFilter = input.size
    ? and(
        eq(products.sizeUnit, input.size.unit),
        sql`${products.sizeValue} between ${Math.floor(input.size.value * (1 - SIZE_TOLERANCE))}
            and ${Math.ceil(input.size.value * (1 + SIZE_TOLERANCE))}`,
      )
    : sql`${products.sizeValue} is null`

  const [candidate] = await db
    .select({
      id: products.id,
      score: sql<number>`similarity(${products.displayName}, ${core})`.as('score'),
    })
    .from(products)
    .where(sizeFilter)
    .orderBy(sql`similarity(${products.displayName}, ${core}) desc`)
    .limit(1)

  if (candidate && candidate.score >= THRESHOLD_ATTACH) {
    return {
      productId: candidate.id, canonicalKey: key,
      method: 'trigram', score: candidate.score, needsReview: false,
    }
  }

  const needsReview =
    candidate !== undefined &&
    candidate.score >= THRESHOLD_REVIEW &&
    candidate.score < THRESHOLD_ATTACH

  const [created] = await db
    .insert(products)
    .values({
      canonicalKey: key,
      displayName: core,
      brand: input.brand,
      sizeValue: input.size?.value ?? null,
      sizeUnit: input.size?.unit ?? null,
    })
    .returning({ id: products.id })

  return {
    productId: created!.id, canonicalKey: key, method: 'new',
    score: candidate?.score ?? null, needsReview,
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/match/attach.test.ts`
Expected: PASS — seven tests green.

If the "near-identical name" case scores below 0.55, do not lower the constant
to force it. Print the score, confirm the pair should match, and only then
adjust — `rescore.ts` in Task 12 exists precisely so this threshold can be
revisited against real data later.

- [ ] **Step 5: Commit**

```bash
git add src/lib/match/ tests/match/
git commit -m "feat: attach offers to products by canonical key and trigram similarity"
```

---

### Task 11: The scan pipeline

**Files:**
- Create: `src/lib/pipeline/scan.ts`, `scripts/scan.ts`
- Test: `tests/pipeline/scan.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–10.
- Produces: `interface ScanDeps { db: Db; source: LeafletSource; client: VisionClient; storageDir: string; now: () => Date; maxPages: number }`; `interface ScanStats { leafletsSeen: number; leafletsNew: number; pagesExtracted: number; pagesFailed: number; offersCreated: number; tokensIn: number; tokensOut: number; costUsd: number; capped: boolean }`; `runScan(deps: ScanDeps): Promise<ScanStats>`; `isStale(db: Db, now: Date, staleHours: number): Promise<boolean>`.

The orchestration takes its dependencies as arguments so the test can supply a
fake source and a fake vision client while using the real database.

- [ ] **Step 1: Write the failing test `tests/pipeline/scan.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { copyFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { runScan } from '@/lib/pipeline/scan'
import { leaflets, leafletPages, offers, shops } from '@/lib/db/schema'
import type { LeafletSource } from '@/lib/sources/types'
import type { VisionClient } from '@/lib/extract/vision'

const pool = new Pool({ connectionString: process.env.DATABASE_URL_TEST })
const db = drizzle(pool)

beforeEach(async () => {
  await pool.query(
    'truncate offers, leaflet_pages, leaflets, products, shops, job_runs, source_cursors cascade',
  )
  await db.insert(shops).values([
    { slug: 'biedronka', name: 'Biedronka' },
    { slug: 'lidl', name: 'Lidl' },
    { slug: 'kaufland', name: 'Kaufland' },
  ])
})

const fakeSource: LeafletSource = {
  slug: 'gazetkipromocyjne',
  async discover() {
    return [{
      shopSlug: 'biedronka',
      externalId: '113166',
      pdfUrl: 'https://example.test/a.pdf',
      publishedAt: new Date('2026-08-12T10:17:04Z'),
      coverUrl: null,
    }]
  },
  async fetchAsset(_l, destDir) {
    await mkdir(join(destDir, 'biedronka'), { recursive: true })
    const path = join(destDir, 'biedronka', '113166.pdf')
    await copyFile('tests/fixtures/leaflet-2pages.pdf', path)
    return { path, sha256: 'fixedhash' }
  },
}

function fakeVision(counter: { calls: number }): VisionClient {
  return {
    async parsePage() {
      counter.calls++
      return {
        tokensIn: 1200, tokensOut: 800,
        result: {
          page_date_badge: 'ŚRODA – PIĄTEK 12.08-14.08',
          issue_text: 'NR 33/2026 P',
          tiles: [{
            raw_name: 'Masło Ekstra Mleczna Dolina, 200 g',
            brand: 'Mleczna Dolina',
            price: '1,99', price_before: null, price_regular: null,
            discount_percent: 60, promo_kind: 'multibuy', min_qty: 3,
            unit_price_raw: '1,00 zł/100 g', requires_loyalty: true,
            purchase_limit: 'Limit dzienny 3 szt.',
            date_badge: 'OFERTA OD 13.08 DO 14.08',
            bbox: { x: 0.5, y: 0.1, w: 0.4, h: 0.2 },
          }],
        },
      }
    },
  }
}

const deps = (counter: { calls: number }, maxPages = 400) => ({
  db, source: fakeSource, client: fakeVision(counter),
  storageDir: 'storage/test-scan', now: () => new Date('2026-08-12T12:00:00Z'),
  maxPages,
})

describe('runScan', () => {
  it('ingests a leaflet, extracts its pages and creates offers', async () => {
    const c = { calls: 0 }
    const stats = await runScan(deps(c))
    expect(stats.leafletsNew).toBe(1)
    expect(stats.pagesExtracted).toBe(2)
    expect(stats.offersCreated).toBe(2)
    expect(stats.tokensIn).toBe(2400)
    expect(stats.costUsd).toBeGreaterThan(0)

    const rows = await db.select().from(offers)
    expect(rows).toHaveLength(2)
    expect(rows[0]!.priceGrosze).toBe(199)
    expect(rows[0]!.unitPriceGrosze).toBe(1000)   // 1,00 zł/100 g → 10,00 zł/kg
    expect(rows[0]!.unitBasis).toBe('kg')
    expect(rows[0]!.requiresLoyalty).toBe(true)
    expect(rows[0]!.minQty).toBe(3)
    expect(rows[0]!.dateSource).toBe('offer')
    expect(rows[0]!.productId).not.toBeNull()
  })

  it('derives the leaflet validity range from its pages', async () => {
    await runScan(deps({ calls: 0 }))
    const [l] = await db.select().from(leaflets)
    expect(l!.validFrom!.toISOString().slice(0, 10)).toBe('2026-08-12')
    expect(l!.validTo!.toISOString().slice(0, 10)).toBe('2026-08-14')
    expect(l!.status).toBe('done')
  })

  it('is idempotent — a second run costs nothing', async () => {
    const first = { calls: 0 }
    await runScan(deps(first))
    expect(first.calls).toBe(2)

    const second = { calls: 0 }
    const stats = await runScan(deps(second))
    expect(second.calls).toBe(0)          // no vision calls at all
    expect(stats.pagesExtracted).toBe(0)
    expect(await db.select().from(offers)).toHaveLength(2)  // no duplicates
    expect(await db.select().from(leafletPages)).toHaveLength(2)
  })

  it('respects the per-run page cap', async () => {
    const c = { calls: 0 }
    const stats = await runScan(deps(c, 1))
    expect(c.calls).toBe(1)
    expect(stats.capped).toBe(true)
    expect(stats.pagesExtracted).toBe(1)
    const [l] = await db.select().from(leaflets)
    expect(l!.status).toBe('partial')
  })

  it('advances the source cursor to the newest publication seen', async () => {
    await runScan(deps({ calls: 0 }))
    const { rows } = await pool.query('select last_seen_date from source_cursors')
    expect(new Date(rows[0].last_seen_date).toISOString())
      .toBe('2026-08-12T10:17:04.000Z')
  })

  it('records a job run with stats', async () => {
    await runScan(deps({ calls: 0 }))
    const { rows } = await pool.query('select script, status, stats from job_runs')
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('ok')
    expect(rows[0].stats.offersCreated).toBe(2)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run tests/pipeline/scan.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/pipeline/scan.ts`**

```ts
import { and, eq, sql } from 'drizzle-orm'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { config } from '@/lib/config'
import type { Db } from '@/lib/db/client'
import {
  jobRuns, leaflets, leafletPages, offers, shops, sourceCursors,
} from '@/lib/db/schema'
import { pageCount } from '@/lib/acquire/rasterize'
import {
  fallbackLeafletRange, parseDateBadge, parseIssueYear, resolveDates,
} from '@/lib/extract/dates'
import { extractPage, type VisionClient } from '@/lib/extract/vision'
import { attachToProduct } from '@/lib/match/attach'
import { coreName } from '@/lib/normalize/canonical'
import { parseGrosze, parseUnitPrice } from '@/lib/normalize/money'
import { extractSize } from '@/lib/normalize/size'
import type { LeafletSource } from '@/lib/sources/types'

export interface ScanDeps {
  db: Db
  source: LeafletSource
  client: VisionClient
  storageDir: string
  now: () => Date
  maxPages: number
}

export interface ScanStats {
  leafletsSeen: number
  leafletsNew: number
  pagesExtracted: number
  pagesFailed: number
  offersCreated: number
  tokensIn: number
  tokensOut: number
  costUsd: number
  capped: boolean
}

function costUsd(tokensIn: number, tokensOut: number, model: string): number {
  const p = config.pricing[model] ?? { input: 0, output: 0 }
  return (tokensIn * p.input + tokensOut * p.output) / 1_000_000
}

export async function isStale(
  db: Db,
  now: Date,
  staleHours: number,
): Promise<boolean> {
  const [cursor] = await db.select().from(sourceCursors).limit(1)
  if (!cursor) return false
  const age = now.getTime() - cursor.lastSeenDate.getTime()
  return age > staleHours * 3600 * 1000
}

export async function runScan(deps: ScanDeps): Promise<ScanStats> {
  const { db, source, client, storageDir, now } = deps
  const stats: ScanStats = {
    leafletsSeen: 0, leafletsNew: 0, pagesExtracted: 0, pagesFailed: 0,
    offersCreated: 0, tokensIn: 0, tokensOut: 0, costUsd: 0, capped: false,
  }

  const [run] = await db
    .insert(jobRuns)
    .values({ script: 'scan', startedAt: now() })
    .returning({ id: jobRuns.id })

  try {
    const [cursor] = await db.select().from(sourceCursors).limit(1)
    const discovered = await source.discover(
      config.shopAllowlist,
      cursor?.lastSeenDate ?? null,
    )
    stats.leafletsSeen = discovered.length

    const shopRows = await db.select().from(shops)
    const shopIdBySlug = new Map(shopRows.map((s) => [s.slug, s.id]))
    let newestSeen = cursor?.lastSeenDate ?? null
    let pageBudget = deps.maxPages

    for (const d of discovered) {
      const shopId = shopIdBySlug.get(d.shopSlug)
      if (!shopId) continue
      if (!newestSeen || d.publishedAt > newestSeen) newestSeen = d.publishedAt

      const [known] = await db
        .select({ id: leaflets.id })
        .from(leaflets)
        .where(and(eq(leaflets.shopId, shopId), eq(leaflets.externalId, d.externalId)))
        .limit(1)

      let leafletId: string
      let pdfPath: string
      const pdfDir = join(storageDir, 'pdf')

      if (known) {
        leafletId = known.id
        pdfPath = join(pdfDir, d.shopSlug, `${d.externalId}.pdf`)
      } else {
        const asset = await source.fetchAsset(d, pdfDir)
        pdfPath = asset.path
        const [inserted] = await db
          .insert(leaflets)
          .values({
            shopId, externalId: d.externalId, sourceSlug: source.slug,
            pdfUrl: d.pdfUrl, publishedAt: d.publishedAt,
            fileHash: asset.sha256, pageCount: await pageCount(asset.path),
          })
          .returning({ id: leaflets.id })
        leafletId = inserted!.id
        stats.leafletsNew++
      }

      const [leaflet] = await db
        .select().from(leaflets).where(eq(leaflets.id, leafletId)).limit(1)
      const leafletRange = fallbackLeafletRange(leaflet!.publishedAt)
      const pageDir = join(storageDir, 'pages', leafletId)
      await mkdir(pageDir, { recursive: true })

      const existing = await db
        .select({ pageNo: leafletPages.pageNo, status: leafletPages.status })
        .from(leafletPages)
        .where(eq(leafletPages.leafletId, leafletId))
      const done = new Set(
        existing.filter((p) => p.status === 'done').map((p) => p.pageNo),
      )

      for (let pageNo = 1; pageNo <= leaflet!.pageCount; pageNo++) {
        if (done.has(pageNo)) continue
        if (pageBudget <= 0) { stats.capped = true; break }
        pageBudget--

        const outcome = await extractPage({
          client, pdfPath, pageNo, outDir: pageDir,
          model: config.visionModel, escalationModel: config.visionModelEscalation,
        })
        stats.tokensIn += outcome.tokensIn
        stats.tokensOut += outcome.tokensOut
        stats.costUsd += costUsd(outcome.tokensIn, outcome.tokensOut, config.visionModel)

        if (outcome.status === 'failed') {
          stats.pagesFailed++
          await db.insert(leafletPages).values({
            leafletId, pageNo,
            imagePath: outcome.imagePath, imageHash: outcome.imageHash,
            status: 'failed', error: outcome.error,
            tokensIn: outcome.tokensIn, tokensOut: outcome.tokensOut,
            splitRetry: outcome.splitRetry,
          }).onConflictDoNothing()
          continue
        }

        const year =
          parseIssueYear(outcome.result.issue_text ?? '') ??
          leaflet!.publishedAt.getUTCFullYear()
        const pageRange = outcome.result.page_date_badge
          ? parseDateBadge(outcome.result.page_date_badge, year)
          : null

        await db.insert(leafletPages).values({
          leafletId, pageNo,
          imagePath: outcome.imagePath, imageHash: outcome.imageHash,
          status: 'done', rawJson: outcome.result,
          validFrom: pageRange?.from ?? null, validTo: pageRange?.to ?? null,
          tokensIn: outcome.tokensIn, tokensOut: outcome.tokensOut,
          splitRetry: outcome.splitRetry,
        }).onConflictDoNothing()
        stats.pagesExtracted++

        for (const tile of outcome.result.tiles) {
          const offerRange = tile.date_badge
            ? parseDateBadge(tile.date_badge, year)
            : null
          const { range, source: dateSrc } = resolveDates(
            offerRange, pageRange, leafletRange,
          )
          const size = extractSize(tile.raw_name)
          const unit = tile.unit_price_raw ? parseUnitPrice(tile.unit_price_raw) : null
          const match = await attachToProduct(db, {
            brand: tile.brand, name: tile.raw_name, size,
          })

          await db.insert(offers).values({
            leafletId, pageNo,
            rawName: tile.raw_name, brand: tile.brand, name: coreName(tile.raw_name),
            sizeValue: size?.value ?? null, sizeUnit: size?.unit ?? null,
            priceGrosze: tile.price ? parseGrosze(tile.price) : null,
            priceBefore: tile.price_before ? parseGrosze(tile.price_before) : null,
            priceRegular: tile.price_regular ? parseGrosze(tile.price_regular) : null,
            discountPercent: tile.discount_percent,
            promoKind: tile.promo_kind, minQty: tile.min_qty,
            unitPriceGrosze: unit?.grosze ?? null, unitBasis: unit?.basis ?? null,
            unitPriceRaw: tile.unit_price_raw,
            requiresLoyalty: tile.requires_loyalty,
            purchaseLimit: tile.purchase_limit,
            validFrom: range.from, validTo: range.to, dateSource: dateSrc,
            canonicalKey: match.canonicalKey, productId: match.productId,
            matchMethod: match.method, matchScore: match.score,
            needsReview: match.needsReview || dateSrc === 'leaflet',
            bbox: tile.bbox,
          })
          stats.offersCreated++
        }
      }

      // Derive the leaflet range from what the pages actually said.
      const [agg] = await db
        .select({
          from: sql<Date | null>`min(${leafletPages.validFrom})`,
          to: sql<Date | null>`max(${leafletPages.validTo})`,
          failed: sql<number>`count(*) filter (where ${leafletPages.status} = 'failed')`,
          total: sql<number>`count(*)`,
        })
        .from(leafletPages)
        .where(eq(leafletPages.leafletId, leafletId))

      const complete = Number(agg!.total) === leaflet!.pageCount
      await db.update(leaflets).set({
        validFrom: agg!.from ?? leafletRange.from,
        validTo: agg!.to ?? leafletRange.to,
        status: !complete ? 'partial' : Number(agg!.failed) > 0 ? 'partial' : 'done',
      }).where(eq(leaflets.id, leafletId))

      if (stats.capped) break
    }

    if (newestSeen) {
      await db.insert(sourceCursors)
        .values({ sourceSlug: source.slug, lastSeenDate: newestSeen })
        .onConflictDoUpdate({
          target: sourceCursors.sourceSlug,
          set: { lastSeenDate: newestSeen },
        })
    }

    await db.update(jobRuns)
      .set({ finishedAt: now(), status: 'ok', stats })
      .where(eq(jobRuns.id, run!.id))
    return stats
  } catch (e) {
    await db.update(jobRuns)
      .set({
        finishedAt: now(), status: 'failed', stats,
        error: e instanceof Error ? e.message : String(e),
      })
      .where(eq(jobRuns.id, run!.id))
    throw e
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/pipeline/scan.test.ts`
Expected: PASS — six tests green.

- [ ] **Step 5: Write `scripts/scan.ts`**

```ts
import { config } from '@/lib/config'
import { db, pool } from '@/lib/db/client'
import { createOpenAiVisionClient } from '@/lib/extract/openai-client'
import { isStale, runScan } from '@/lib/pipeline/scan'
import { sources } from '@/lib/sources'

const source = sources['gazetkipromocyjne']!

try {
  const stats = await runScan({
    db, source,
    client: createOpenAiVisionClient(),
    storageDir: config.storageDir,
    now: () => new Date(),
    maxPages: config.maxPagesPerRun,
  })
  console.log(JSON.stringify(stats))

  if (await isStale(db, new Date(), config.staleHours)) {
    console.error(
      `No new leaflets for over ${config.staleHours}h — the source may have changed.`,
    )
    process.exitCode = 1
  }
  if (stats.pagesFailed > 0) {
    console.error(`${stats.pagesFailed} pages failed to extract.`)
    process.exitCode = 1
  }
} catch (e) {
  console.error(e)
  process.exitCode = 2
} finally {
  await pool.end()
}
```

- [ ] **Step 6: Run it for real against one leaflet**

```bash
MAX_PAGES_PER_RUN=3 pnpm scan
```

Expected: JSON stats on stdout with `pagesExtracted: 3`, `capped: true`, and a
non-zero `costUsd`. Then check the result by eye:

```bash
docker-compose exec -T db psql -U promo -d promo_radar -c \
  "select raw_name, price_grosze, unit_price_grosze, unit_basis, requires_loyalty,
          valid_from::date, valid_to::date, date_source
     from offers order by id limit 20;"
```

Expected: real product names with sensible prices in grosze. If names or prices
are wrong, fix `src/lib/extract/prompt.ts` and re-run — the prompt is the knob,
not the parsers.

- [ ] **Step 7: Commit**

```bash
git add src/lib/pipeline/ scripts/scan.ts tests/pipeline/
git commit -m "feat: add the scan pipeline with cost guard and idempotent re-runs"
```

---

### Task 12: Maintenance scripts

**Files:**
- Create: `scripts/reparse.ts`, `scripts/rescore.ts`, `scripts/prune-pages.ts`, `src/lib/pipeline/rescore.ts`, `src/lib/pipeline/prune.ts`, `README.md`, `launchd/com.promoradar.scan.plist`
- Test: `tests/pipeline/rescore.test.ts`, `tests/pipeline/prune.test.ts`

**Interfaces:**
- Consumes: `attachToProduct` (Task 10), `offers`/`products` tables (Task 2).
- Produces: `rescoreAll(db: Db): Promise<{ offers: number; relinked: number }>`; `prunePages(dir: string, olderThanDays: number, now: Date): Promise<number>`.

- [ ] **Step 1: Write the failing test `tests/pipeline/rescore.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { rescoreAll } from '@/lib/pipeline/rescore'
import { leaflets, offers, products, shops } from '@/lib/db/schema'

const pool = new Pool({ connectionString: process.env.DATABASE_URL_TEST })
const db = drizzle(pool)

beforeEach(async () => {
  await pool.query(
    'truncate offers, leaflet_pages, leaflets, products, shops cascade',
  )
})

async function seedOffer(rawName: string) {
  const [shop] = await db.insert(shops)
    .values({ slug: `s${Math.random()}`, name: 'S' }).returning()
  const [leaflet] = await db.insert(leaflets).values({
    shopId: shop!.id, externalId: String(Math.random()),
    sourceSlug: 'x', pdfUrl: 'https://example.test/x.pdf',
    publishedAt: new Date(), fileHash: 'h', pageCount: 1,
  }).returning()
  await db.insert(offers).values({
    leafletId: leaflet!.id, pageNo: 1, rawName, name: rawName.toLowerCase(),
    promoKind: 'price', dateSource: 'leaflet',
  })
}

describe('rescoreAll', () => {
  it('links every offer to a product without any vision calls', async () => {
    await seedOffer('Masło Ekstra Mleczna Dolina, 200 g')
    await seedOffer('Masło Ekstra Mleczna Dolina 200 g')

    const out = await rescoreAll(db)
    expect(out.offers).toBe(2)
    expect(out.relinked).toBe(2)

    const rows = await db.select().from(offers)
    expect(rows.every((r) => r.productId !== null)).toBe(true)
    expect(rows[0]!.productId).toBe(rows[1]!.productId)
    expect(await db.select().from(products)).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run tests/pipeline/rescore.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/pipeline/rescore.ts`**

```ts
import { eq } from 'drizzle-orm'
import type { Db } from '@/lib/db/client'
import { offers, products } from '@/lib/db/schema'
import { attachToProduct } from '@/lib/match/attach'
import { extractSize } from '@/lib/normalize/size'

/**
 * Re-runs matching over every stored offer. Makes no API calls, so thresholds
 * and the stoplist can be re-tuned against the whole archive for free.
 */
export async function rescoreAll(db: Db): Promise<{ offers: number; relinked: number }> {
  await db.update(offers).set({
    productId: null, matchMethod: null, matchScore: null, needsReview: false,
  })
  await db.delete(products)

  const rows = await db.select().from(offers)
  let relinked = 0
  for (const row of rows) {
    const match = await attachToProduct(db, {
      brand: row.brand, name: row.rawName, size: extractSize(row.rawName),
    })
    await db.update(offers).set({
      canonicalKey: match.canonicalKey, productId: match.productId,
      matchMethod: match.method, matchScore: match.score,
      needsReview: match.needsReview,
    }).where(eq(offers.id, row.id))
    relinked++
  }
  return { offers: rows.length, relinked }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/pipeline/rescore.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing test `tests/pipeline/prune.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { mkdtemp, utimes, writeFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { prunePages } from '@/lib/pipeline/prune'

describe('prunePages', () => {
  it('deletes jpegs older than the cutoff and keeps the rest', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'prune-'))
    const now = new Date('2026-08-12T00:00:00Z')
    const old = new Date('2026-06-01T00:00:00Z')

    await writeFile(join(dir, 'old.jpg'), 'x')
    await utimes(join(dir, 'old.jpg'), old, old)
    await writeFile(join(dir, 'new.jpg'), 'x')
    await utimes(join(dir, 'new.jpg'), now, now)
    await writeFile(join(dir, 'keep.pdf'), 'x')
    await utimes(join(dir, 'keep.pdf'), old, old)

    const deleted = await prunePages(dir, 30, now)
    expect(deleted).toBe(1)
    expect((await readdir(dir)).sort()).toEqual(['keep.pdf', 'new.jpg'])
  })
})
```

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm vitest run tests/pipeline/prune.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 7: Implement `src/lib/pipeline/prune.ts`**

```ts
import { readdir, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'

/** Deletes rendered page JPEGs older than the cutoff. PDFs are the archive and are kept. */
export async function prunePages(
  dir: string,
  olderThanDays: number,
  now: Date,
): Promise<number> {
  const cutoff = now.getTime() - olderThanDays * 24 * 3600 * 1000
  let deleted = 0
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      deleted += await prunePages(path, olderThanDays, now)
      continue
    }
    if (!entry.name.endsWith('.jpg')) continue
    if ((await stat(path)).mtime.getTime() < cutoff) {
      await unlink(path)
      deleted++
    }
  }
  return deleted
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `pnpm vitest run tests/pipeline/prune.test.ts`
Expected: PASS.

- [ ] **Step 9: Write the three CLI wrappers**

`scripts/rescore.ts`:

```ts
import { db, pool } from '@/lib/db/client'
import { rescoreAll } from '@/lib/pipeline/rescore'

try {
  console.log(JSON.stringify(await rescoreAll(db)))
} finally {
  await pool.end()
}
```

`scripts/prune-pages.ts`:

```ts
import { join } from 'node:path'
import { config } from '@/lib/config'
import { prunePages } from '@/lib/pipeline/prune'

const deleted = await prunePages(join(config.storageDir, 'pages'), 30, new Date())
console.log(`deleted ${deleted} page images`)
```

`scripts/reparse.ts` — clears one leaflet's pages and offers so the next scan
re-extracts it:

```ts
import { eq } from 'drizzle-orm'
import { db, pool } from '@/lib/db/client'
import { leaflets, leafletPages, offers } from '@/lib/db/schema'

const externalId = process.argv[2]
if (!externalId) {
  console.error('usage: pnpm reparse <externalId>')
  process.exit(1)
}

try {
  const [leaflet] = await db.select().from(leaflets)
    .where(eq(leaflets.externalId, externalId)).limit(1)
  if (!leaflet) throw new Error(`no leaflet with external id ${externalId}`)
  await db.delete(offers).where(eq(offers.leafletId, leaflet.id))
  await db.delete(leafletPages).where(eq(leafletPages.leafletId, leaflet.id))
  await db.update(leaflets).set({ status: 'pending' }).where(eq(leaflets.id, leaflet.id))
  console.log(`cleared leaflet ${externalId}; run pnpm scan to re-extract`)
} finally {
  await pool.end()
}
```

- [ ] **Step 10: Add the launchd job `launchd/com.promoradar.scan.plist`**

Daily at 07:30. `gazetkipromocyjne.net` keeps only about a week of PDFs, so this
must not be less frequent than daily.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.promoradar.scan</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-lc</string>
    <string>cd /Users/vlad/projects/promo-radar &amp;&amp; pnpm scan &gt;&gt; storage/scan.log 2&gt;&amp;1</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>7</integer><key>Minute</key><integer>30</integer></dict>
  <key>StandardErrorPath</key><string>/Users/vlad/projects/promo-radar/storage/scan.err.log</string>
</dict>
</plist>
```

Install it:

```bash
mkdir -p storage
cp launchd/com.promoradar.scan.plist ~/Library/LaunchAgents/
launchctl unload ~/Library/LaunchAgents/com.promoradar.scan.plist 2>/dev/null
launchctl load ~/Library/LaunchAgents/com.promoradar.scan.plist
launchctl list | grep promoradar
```

Expected: one line showing the label.

- [ ] **Step 11: Write `README.md`**

````markdown
# Promo Radar

Collects Polish grocery leaflets, extracts offers with OpenAI vision, and links
the same product across shops.

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

## Costs

Vision is the only recurring cost: about 150–250 pages a week at roughly
$0.002 a page on `gpt-5.6-luna`, so a few dollars a month. `MAX_PAGES_PER_RUN`
(default 400) is a hard ceiling per run; per-run token use and USD cost land in
the `job_runs` table.

## Operational notes

- The source keeps only about a week of PDFs. **Scan at least daily** or
  leaflets are lost. `storage/pdf` is the archive.
- `pnpm scan` exits non-zero when no new leaflets have appeared for 36 hours
  (the source probably changed) or when any page failed to extract.
- Prices are integer grosze everywhere.
````

- [ ] **Step 12: Run the whole suite and commit**

```bash
pnpm test
pnpm typecheck
git add -A
git commit -m "feat: add maintenance scripts, launchd job and README"
```

Expected: all tests pass, no type errors.

---

## Verification

The pipeline is done when all of these hold:

- [ ] `pnpm test` passes with Postgres up, and makes no network calls.
- [ ] `SMOKE=1 pnpm vitest run tests/extract/golden.test.ts` passed once, and the recorded fixture is committed.
- [ ] `pnpm typecheck` is clean.
- [ ] `MAX_PAGES_PER_RUN=3 pnpm scan` produces offers whose names and prices match what is printed on the rendered page images in `storage/pages/`.
- [ ] Running `pnpm scan` twice makes no second vision call and creates no duplicate offers.
- [ ] `launchctl list | grep promoradar` shows the job installed.
