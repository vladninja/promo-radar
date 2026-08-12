# Promo Radar — UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Prerequisite:** `docs/superpowers/plans/2026-08-12-promo-radar-pipeline.md` is complete and `pnpm scan` has produced real offers. This plan reads that data; it never writes to it.

**Goal:** Three server-rendered screens — a filterable promo list, a cross-shop price comparison per product, and a leaflet page viewer with offer boxes overlaid — plus JSON endpoints for the same views.

**Architecture:** A single Hono server rendering JSX to HTML. Every screen is read-only with a plain GET form for filters, so there is no client bundle, no bundler and no API layer between the page and the database: handlers call query functions that use drizzle directly. All SQL lives in `src/lib/queries/*.ts` so it is unit-testable without rendering; views are pure functions of their props. Page images live outside any public directory and are streamed by a route that resolves the path from the database.

**Tech Stack:** hono, @hono/node-server, drizzle-orm 0.45.2, Vitest 4.1.10, tsx. No React, no client JavaScript.

**Why not Next.js:** these screens have zero client-side interactivity, so React Server Components and a webpack/turbopack toolchain would carry real weight for three static tables. Hono's JSX renders the same component model straight to HTML in one process.

## Global Constraints

- Money is integer grosze in the database. Formatting to `zł` happens only in `src/lib/format.ts`.
- Unit prices are already normalized to per-kg / per-l / per-piece by the pipeline. Comparison never re-derives them from pack sizes.
- No client-side JavaScript. Filters are a GET form; navigation is plain links.
- A loyalty-gated offer (`requires_loyalty`) must be visually marked wherever a price is shown. Never present a card price as if it were the shelf price.
- "Current" always means `valid_from <= now <= valid_to`.
- JSX is Hono's, not React's: `"jsx": "react-jsx"` with `"jsxImportSource": "hono/jsx"`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/format.ts` | grosze → `zł`, dates, unit-price and promo labels |
| `src/lib/queries/promos.ts` | list query + filters |
| `src/lib/queries/product.ts` | one product with all its current offers |
| `src/lib/queries/leaflet.ts` | one leaflet page with its offer boxes |
| `src/server/views/layout.tsx` | page shell + stylesheet |
| `src/server/views/promos.tsx` | promo list view |
| `src/server/views/product.tsx` | comparison view |
| `src/server/views/leaflet.tsx` | page viewer view |
| `src/server/app.ts` | Hono routes |
| `src/server/index.ts` | node-server entry point |

---

### Task 1: Server scaffold and formatting

**Files:**
- Create: `src/lib/format.ts`, `src/server/views/layout.tsx`, `src/server/app.ts`, `src/server/index.ts`
- Modify: `package.json` (hono deps, `dev`/`start` scripts), `tsconfig.json` (jsx options)
- Test: `tests/format.test.ts`

**Interfaces:**
- Produces: `formatZl(grosze: number | null): string`; `formatUnitPrice(grosze: number | null, basis: 'kg' | 'l' | 'pcs' | null): string`; `formatRange(from: Date | null, to: Date | null): string`; `formatPromo(kind: string, minQty: number | null, discountPercent: number | null): string`; `Layout(props: { title: string; children: unknown })`; `app` (Hono instance).

- [ ] **Step 1: Install and add scripts**

```bash
pnpm add hono @hono/node-server
```

Add to `package.json` scripts:

```json
"dev": "tsx watch src/server/index.ts",
"start": "tsx src/server/index.ts"
```

- [ ] **Step 2: Add JSX options to `tsconfig.json`**

In `compilerOptions`: `"jsx": "react-jsx"`, `"jsxImportSource": "hono/jsx"`.

- [ ] **Step 3: Write the failing test `tests/format.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { formatZl, formatUnitPrice, formatRange, formatPromo } from '@/lib/format'

describe('formatZl', () => {
  it('renders grosze as zloty with two decimals', () => {
    expect(formatZl(799)).toBe('7,99 zł')
    expect(formatZl(2899)).toBe('28,99 zł')
    expect(formatZl(80)).toBe('0,80 zł')
    expect(formatZl(19900)).toBe('199,00 zł')
  })
  it('renders a dash for no price', () => {
    expect(formatZl(null)).toBe('—')
  })
})

describe('formatUnitPrice', () => {
  it('labels the normalized basis', () => {
    expect(formatUnitPrice(800, 'kg')).toBe('8,00 zł/kg')
    expect(formatUnitPrice(349, 'l')).toBe('3,49 zł/l')
    expect(formatUnitPrice(150, 'pcs')).toBe('1,50 zł/szt.')
  })
  it('renders a dash when unknown', () => {
    expect(formatUnitPrice(null, null)).toBe('—')
    expect(formatUnitPrice(800, null)).toBe('—')
  })
})

describe('formatRange', () => {
  it('renders a day-month range', () => {
    expect(formatRange(
      new Date('2026-08-12T00:00:00Z'),
      new Date('2026-08-14T00:00:00Z'),
    )).toBe('12.08 – 14.08')
  })
  it('handles a missing range', () => {
    expect(formatRange(null, null)).toBe('—')
  })
})

describe('formatPromo', () => {
  it('describes each promo kind', () => {
    expect(formatPromo('price', null, null)).toBe('cena promocyjna')
    expect(formatPromo('percent', null, 72)).toBe('72% taniej')
    expect(formatPromo('multibuy', 3, 60)).toBe('przy zakupie 3: 60% taniej')
    expect(formatPromo('bogo', null, null)).toBe('1+1 gratis')
  })
})
```

- [ ] **Step 4: Run it to verify it fails**

Run: `pnpm vitest run tests/format.test.ts`
Expected: FAIL — cannot resolve `@/lib/format`.

- [ ] **Step 5: Implement `src/lib/format.ts`**

```ts
export function formatZl(grosze: number | null): string {
  if (grosze === null) return '—'
  const zl = Math.floor(grosze / 100)
  const gr = String(grosze % 100).padStart(2, '0')
  return `${zl},${gr} zł`
}

const BASIS_LABEL: Record<string, string> = { kg: 'zł/kg', l: 'zł/l', pcs: 'zł/szt.' }

export function formatUnitPrice(
  grosze: number | null,
  basis: 'kg' | 'l' | 'pcs' | null,
): string {
  if (grosze === null || basis === null) return '—'
  const zl = Math.floor(grosze / 100)
  const gr = String(grosze % 100).padStart(2, '0')
  return `${zl},${gr} ${BASIS_LABEL[basis]}`
}

const dd = (d: Date) => String(d.getUTCDate()).padStart(2, '0')
const mm = (d: Date) => String(d.getUTCMonth() + 1).padStart(2, '0')

export function formatRange(from: Date | null, to: Date | null): string {
  if (!from || !to) return '—'
  return `${dd(from)}.${mm(from)} – ${dd(to)}.${mm(to)}`
}

export function formatPromo(
  kind: string,
  minQty: number | null,
  discountPercent: number | null,
): string {
  const pct = discountPercent !== null ? `${discountPercent}% taniej` : 'promocja'
  switch (kind) {
    case 'bogo': return '1+1 gratis'
    case 'multibuy': return `przy zakupie ${minQty ?? '?'}: ${pct}`
    case 'percent': return pct
    default: return 'cena promocyjna'
  }
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm vitest run tests/format.test.ts`
Expected: PASS.

- [ ] **Step 7: Implement `src/server/views/layout.tsx`**

The stylesheet is inlined, so there is nothing static to serve.

```tsx
const CSS = `
:root { --fg:#1a1a1a; --muted:#6b6b6b; --line:#e3e3e3; --accent:#c8102e; }
* { box-sizing:border-box; }
body { margin:0; color:var(--fg); background:#fff;
  font:15px/1.5 system-ui,-apple-system,sans-serif; }
a { color:inherit; }
header.top { display:flex; gap:1rem; align-items:baseline;
  padding:1rem 1.5rem; border-bottom:1px solid var(--line); }
header.top strong { color:var(--accent); }
main { padding:1.5rem; max-width:1150px; }
table { width:100%; border-collapse:collapse; }
th,td { text-align:left; padding:.5rem .6rem; border-bottom:1px solid var(--line); }
th { font-weight:600; color:var(--muted); font-size:13px; }
.muted { color:var(--muted); }
.price { font-weight:700; white-space:nowrap; }
.badge { display:inline-block; padding:.1rem .4rem; border-radius:3px;
  font-size:12px; background:#f2f2f2; }
.badge.card { background:#fff3cd; }
.badge.review { background:#ffe0e0; }
.badge.best { background:#d7f5dd; }
form.filters { display:flex; gap:.75rem; flex-wrap:wrap; align-items:center;
  margin-bottom:1.25rem; }
input,select,button { padding:.35rem .5rem; font:inherit; }
.viewer { position:relative; display:inline-block; max-width:100%; }
.viewer img { max-width:100%; height:auto; display:block; }
.viewer .box { position:absolute; border:2px solid var(--accent);
  background:rgba(200,16,46,.08); }
`

export function Layout(props: { title: string; children: unknown }) {
  return (
    <html lang="pl">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>{props.title}</title>
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
      </head>
      <body>
        <header class="top">
          <strong>Promo Radar</strong>
          <a href="/">Promocje</a>
        </header>
        <main>{props.children}</main>
      </body>
    </html>
  )
}
```

- [ ] **Step 8: Implement `src/server/app.ts` and `src/server/index.ts`**

```ts
// src/server/app.ts
import { Hono } from 'hono'

export const app = new Hono()

app.get('/health', (c) => c.text('ok'))
```

```ts
// src/server/index.ts
import { serve } from '@hono/node-server'
import { app } from '@/server/app'

const port = Number(process.env.PORT ?? 3000)
serve({ fetch: app.fetch, port })
console.log(`promo-radar on http://localhost:${port}`)
```

- [ ] **Step 9: Verify the server boots**

```bash
pnpm dev &
sleep 3
curl -s http://localhost:3000/health
kill %1
```

Expected: `ok`.

- [ ] **Step 10: Commit**

```bash
pnpm typecheck
git add -A
git commit -m "feat: add Hono server shell and value formatting"
```

---

### Task 2: Promo list

**Files:**
- Create: `src/lib/queries/promos.ts`, `src/server/views/promos.tsx`
- Modify: `src/server/app.ts`
- Test: `tests/queries/promos.test.ts`

**Interfaces:**
- Produces: `interface PromoFilters { q?: string; shop?: string; crossShopOnly?: boolean; needsReview?: boolean; sort?: 'discount' | 'unit'; now?: Date }`; `interface PromoRow { offerId: string; productId: string | null; rawName: string; shopSlug: string; priceGrosze: number | null; unitPriceGrosze: number | null; unitBasis: 'kg' | 'l' | 'pcs' | null; promoKind: string; minQty: number | null; discountPercent: number | null; requiresLoyalty: boolean; needsReview: boolean; validFrom: Date | null; validTo: Date | null; shopCount: number }`; `listPromos(db: Db, f: PromoFilters): Promise<PromoRow[]>`; `PromosView(props: { rows: PromoRow[]; filters: PromoFilters })`.

`shopCount` is the number of distinct shops currently promoting that product — the value that makes `crossShopOnly` meaningful.

- [ ] **Step 1: Write the failing test `tests/queries/promos.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { listPromos } from '@/lib/queries/promos'
import { leaflets, offers, products, shops } from '@/lib/db/schema'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL_TEST })
const db = drizzle(pool)
const NOW = new Date('2026-08-13T12:00:00Z')

async function seed() {
  const shopRows = await db.insert(shops).values([
    { slug: 'biedronka', name: 'Biedronka' },
    { slug: 'lidl', name: 'Lidl' },
  ]).returning()
  const [product] = await db.insert(products).values({
    canonicalKey: 'k|masło ekstra|200g',
    displayName: 'masło ekstra', sizeValue: 200, sizeUnit: 'g',
  }).returning()
  const [other] = await db.insert(products).values({
    canonicalKey: 'k|chleb|500g', displayName: 'chleb',
  }).returning()

  for (const [i, shop] of shopRows.entries()) {
    const [leaflet] = await db.insert(leaflets).values({
      shopId: shop!.id, externalId: `e${i}`, sourceSlug: 's',
      pdfUrl: 'https://example.test/x.pdf', publishedAt: NOW,
      fileHash: `h${i}`, pageCount: 1,
    }).returning()
    await db.insert(offers).values({
      leafletId: leaflet!.id, pageNo: 1,
      rawName: 'Masło Ekstra Mleczna Dolina, 200 g', name: 'masło ekstra',
      priceGrosze: 199 + i, unitPriceGrosze: 800 + i * 100, unitBasis: 'kg',
      promoKind: 'price', discountPercent: 60 - i * 10,
      requiresLoyalty: i === 0, productId: product!.id,
      validFrom: new Date('2026-08-12T00:00:00Z'),
      validTo: new Date('2026-08-14T00:00:00Z'),
      dateSource: 'offer',
    })
  }

  const [firstLeaflet] = await db.select().from(leaflets).limit(1)
  await db.insert(offers).values([
    {
      leafletId: firstLeaflet!.id, pageNo: 1, rawName: 'Chleb pszenny, 500 g',
      name: 'chleb pszenny', priceGrosze: 349, promoKind: 'price',
      productId: other!.id, dateSource: 'offer',
      validFrom: new Date('2026-08-12T00:00:00Z'),
      validTo: new Date('2026-08-14T00:00:00Z'),
    },
    {
      leafletId: firstLeaflet!.id, pageNo: 1, rawName: 'Stara promocja, 1 kg',
      name: 'stara promocja', priceGrosze: 999, promoKind: 'price',
      productId: other!.id, dateSource: 'offer',
      validFrom: new Date('2026-07-01T00:00:00Z'),
      validTo: new Date('2026-07-08T00:00:00Z'),
    },
  ])
}

beforeEach(async () => {
  await pool.query('truncate offers, leaflet_pages, leaflets, products, shops cascade')
  await seed()
})

describe('listPromos', () => {
  it('returns only offers valid now', async () => {
    const rows = await listPromos(db, { now: NOW })
    expect(rows.map((r) => r.rawName)).not.toContain('Stara promocja, 1 kg')
    expect(rows).toHaveLength(3)
  })

  it('reports how many shops promote each product', async () => {
    const rows = await listPromos(db, { now: NOW })
    const butter = rows.filter((r) => r.rawName.startsWith('Masło'))
    expect(butter).toHaveLength(2)
    expect(butter.every((r) => r.shopCount === 2)).toBe(true)
    const bread = rows.find((r) => r.rawName.startsWith('Chleb'))!
    expect(bread.shopCount).toBe(1)
  })

  it('filters to cross-shop products only', async () => {
    const rows = await listPromos(db, { now: NOW, crossShopOnly: true })
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.rawName.startsWith('Masło'))).toBe(true)
  })

  it('filters by shop', async () => {
    const rows = await listPromos(db, { now: NOW, shop: 'biedronka' })
    expect(rows.every((r) => r.shopSlug === 'biedronka')).toBe(true)
    expect(rows.length).toBeGreaterThan(0)
  })

  it('searches by name, case-insensitively', async () => {
    expect(await listPromos(db, { now: NOW, q: 'masło' })).toHaveLength(2)
    expect(await listPromos(db, { now: NOW, q: 'MASŁO' })).toHaveLength(2)
  })

  it('sorts by unit price ascending', async () => {
    const rows = await listPromos(db, { now: NOW, sort: 'unit', crossShopOnly: true })
    expect(rows[0]!.unitPriceGrosze).toBe(800)
    expect(rows[1]!.unitPriceGrosze).toBe(900)
  })

  it('sorts by discount descending by default', async () => {
    const rows = await listPromos(db, { now: NOW, crossShopOnly: true })
    expect(rows[0]!.discountPercent).toBe(60)
  })

  it('carries the loyalty flag through', async () => {
    const rows = await listPromos(db, { now: NOW, shop: 'biedronka' })
    expect(rows[0]!.requiresLoyalty).toBe(true)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run tests/queries/promos.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/queries/promos.ts`**

```ts
import { and, eq, gte, lte, sql, type SQL } from 'drizzle-orm'
import type { Db } from '@/lib/db/client'
import { leaflets, offers, shops } from '@/lib/db/schema'

export interface PromoFilters {
  q?: string
  shop?: string
  crossShopOnly?: boolean
  needsReview?: boolean
  sort?: 'discount' | 'unit'
  now?: Date
}

export interface PromoRow {
  offerId: string
  productId: string | null
  rawName: string
  shopSlug: string
  priceGrosze: number | null
  unitPriceGrosze: number | null
  unitBasis: 'kg' | 'l' | 'pcs' | null
  promoKind: string
  minQty: number | null
  discountPercent: number | null
  requiresLoyalty: boolean
  needsReview: boolean
  validFrom: Date | null
  validTo: Date | null
  shopCount: number
}

export async function listPromos(db: Db, f: PromoFilters): Promise<PromoRow[]> {
  const now = f.now ?? new Date()

  // Distinct shops currently promoting each product.
  const shopCount = sql<number>`(
    select count(distinct l2.shop_id)
      from offers o2
      join leaflets l2 on l2.id = o2.leaflet_id
     where o2.product_id = ${offers.productId}
       and o2.valid_from <= ${now} and o2.valid_to >= ${now}
  )`

  const where: SQL[] = [lte(offers.validFrom, now), gte(offers.validTo, now)]
  if (f.shop) where.push(eq(shops.slug, f.shop))
  if (f.q) where.push(sql`${offers.rawName} ilike ${'%' + f.q + '%'}`)
  if (f.needsReview) where.push(eq(offers.needsReview, true))
  if (f.crossShopOnly) where.push(sql`${shopCount} > 1`)

  const order = f.sort === 'unit'
    ? sql`${offers.unitPriceGrosze} asc nulls last`
    : sql`${offers.discountPercent} desc nulls last`

  const rows = await db
    .select({
      offerId: offers.id,
      productId: offers.productId,
      rawName: offers.rawName,
      shopSlug: shops.slug,
      priceGrosze: offers.priceGrosze,
      unitPriceGrosze: offers.unitPriceGrosze,
      unitBasis: offers.unitBasis,
      promoKind: offers.promoKind,
      minQty: offers.minQty,
      discountPercent: offers.discountPercent,
      requiresLoyalty: offers.requiresLoyalty,
      needsReview: offers.needsReview,
      validFrom: offers.validFrom,
      validTo: offers.validTo,
      shopCount: shopCount.as('shop_count'),
    })
    .from(offers)
    .innerJoin(leaflets, eq(leaflets.id, offers.leafletId))
    .innerJoin(shops, eq(shops.id, leaflets.shopId))
    .where(and(...where))
    .orderBy(order)
    .limit(300)

  return rows.map((r) => ({ ...r, shopCount: Number(r.shopCount) }))
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/queries/promos.test.ts`
Expected: PASS — eight tests green.

- [ ] **Step 5: Implement `src/server/views/promos.tsx`**

```tsx
import { Layout } from '@/server/views/layout'
import { formatPromo, formatRange, formatUnitPrice, formatZl } from '@/lib/format'
import type { PromoFilters, PromoRow } from '@/lib/queries/promos'

const SHOPS = [
  ['', 'Wszystkie sklepy'],
  ['biedronka', 'Biedronka'],
  ['lidl', 'Lidl'],
  ['kaufland', 'Kaufland'],
] as const

export function PromosView(props: { rows: PromoRow[]; filters: PromoFilters }) {
  const { rows, filters } = props
  return (
    <Layout title="Promocje — Promo Radar">
      <form class="filters" method="get" action="/">
        <input type="search" name="q" placeholder="Szukaj produktu" value={filters.q ?? ''} />
        <select name="shop">
          {SHOPS.map(([value, label]) => (
            <option value={value} selected={(filters.shop ?? '') === value}>{label}</option>
          ))}
        </select>
        <select name="sort">
          <option value="discount" selected={filters.sort !== 'unit'}>Największa zniżka</option>
          <option value="unit" selected={filters.sort === 'unit'}>Najniższa cena jednostkowa</option>
        </select>
        <label>
          <input type="checkbox" name="cross" value="1" checked={filters.crossShopOnly} />
          {' '}Tylko w kilku sklepach
        </label>
        <label>
          <input type="checkbox" name="review" value="1" checked={filters.needsReview} />
          {' '}Do sprawdzenia
        </label>
        <button type="submit">Filtruj</button>
      </form>

      <p class="muted">{rows.length} promocji</p>
      <table>
        <thead>
          <tr>
            <th>Produkt</th><th>Sklep</th><th>Cena</th><th>Za jednostkę</th>
            <th>Promocja</th><th>Termin</th><th>Sklepy</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr>
              <td>
                {r.productId
                  ? <a href={`/products/${r.productId}`}>{r.rawName}</a>
                  : r.rawName}
                {r.needsReview ? <> <span class="badge review">do sprawdzenia</span></> : null}
              </td>
              <td>{r.shopSlug}</td>
              <td class="price">
                {formatZl(r.priceGrosze)}
                {r.requiresLoyalty ? <> <span class="badge card">z kartą</span></> : null}
              </td>
              <td>{formatUnitPrice(r.unitPriceGrosze, r.unitBasis)}</td>
              <td>{formatPromo(r.promoKind, r.minQty, r.discountPercent)}</td>
              <td>{formatRange(r.validFrom, r.validTo)}</td>
              <td>{r.shopCount > 1 ? `${r.shopCount} sklepy` : '1'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Layout>
  )
}
```

- [ ] **Step 6: Wire the routes in `src/server/app.ts`**

```ts
import { Hono } from 'hono'
import type { Context } from 'hono'
import { db } from '@/lib/db/client'
import { listPromos, type PromoFilters } from '@/lib/queries/promos'
import { PromosView } from '@/server/views/promos'

export const app = new Hono()

function promoFilters(c: Context): PromoFilters {
  const q = c.req.query()
  return {
    q: q.q || undefined,
    shop: q.shop || undefined,
    crossShopOnly: q.cross === '1',
    needsReview: q.review === '1',
    sort: q.sort === 'unit' ? 'unit' : 'discount',
  }
}

app.get('/health', (c) => c.text('ok'))

app.get('/', async (c) => {
  const filters = promoFilters(c)
  return c.html(<PromosView rows={await listPromos(db, filters)} filters={filters} />)
})

app.get('/api/promos', async (c) => c.json(await listPromos(db, promoFilters(c))))
```

Rename the file to `src/server/app.tsx` so the JSX compiles, and update the
import in `src/server/index.ts` to `@/server/app`.

- [ ] **Step 7: Check the screen against real data**

```bash
pnpm dev &
sleep 3
curl -s "http://localhost:3000/api/promos" | head -c 300
curl -s "http://localhost:3000/" | grep -c "<tr>"
kill %1
```

Expected: JSON rows from your scanned data, and a positive row count in the HTML.

- [ ] **Step 8: Commit**

```bash
pnpm typecheck
git add -A
git commit -m "feat: add the promo list screen and JSON endpoint"
```

---

### Task 3: Cross-shop comparison

**Files:**
- Create: `src/lib/queries/product.ts`, `src/server/views/product.tsx`
- Modify: `src/server/app.tsx`
- Test: `tests/queries/product.test.ts`

**Interfaces:**
- Produces: `interface ProductOffer { offerId: string; shopSlug: string; leafletId: string; pageNo: number; rawName: string; priceGrosze: number | null; priceBefore: number | null; priceRegular: number | null; unitPriceGrosze: number | null; unitBasis: 'kg' | 'l' | 'pcs' | null; promoKind: string; minQty: number | null; discountPercent: number | null; requiresLoyalty: boolean; purchaseLimit: string | null; validFrom: Date | null; validTo: Date | null; isCheapest: boolean }`; `interface ProductDetail { id: string; displayName: string; brand: string | null; sizeValue: number | null; sizeUnit: 'g' | 'ml' | 'pcs' | null; offers: ProductOffer[] }`; `getProduct(db: Db, id: string, now?: Date): Promise<ProductDetail | null>`; `ProductView(props: { product: ProductDetail })`.

`isCheapest` is computed on the **normalized unit price** and only among offers
that share the same `unitBasis`, so 200 g and 500 g packs are ranked honestly and
a per-piece price is never compared against a per-kilogram one.

- [ ] **Step 1: Write the failing test `tests/queries/product.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { getProduct } from '@/lib/queries/product'
import { leaflets, offers, products, shops } from '@/lib/db/schema'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL_TEST })
const db = drizzle(pool)
const NOW = new Date('2026-08-13T12:00:00Z')
let productId: string

beforeEach(async () => {
  await pool.query('truncate offers, leaflet_pages, leaflets, products, shops cascade')
  const [product] = await db.insert(products).values({
    canonicalKey: 'k|masło ekstra|200g', displayName: 'masło ekstra',
    brand: 'Mleczna Dolina', sizeValue: 200, sizeUnit: 'g',
  }).returning()
  productId = product!.id

  const shopRows = await db.insert(shops).values([
    { slug: 'biedronka', name: 'Biedronka' },
    { slug: 'lidl', name: 'Lidl' },
    { slug: 'kaufland', name: 'Kaufland' },
  ]).returning()

  const unitPrices = [1200, 800, null]     // lidl is cheapest per kg
  for (const [i, shop] of shopRows.entries()) {
    const [leaflet] = await db.insert(leaflets).values({
      shopId: shop!.id, externalId: `e${i}`, sourceSlug: 's',
      pdfUrl: 'https://example.test/x.pdf', publishedAt: NOW,
      fileHash: `h${i}`, pageCount: 1,
    }).returning()
    await db.insert(offers).values({
      leafletId: leaflet!.id, pageNo: i + 1,
      rawName: 'Masło Ekstra Mleczna Dolina, 200 g', name: 'masło ekstra',
      priceGrosze: 300 - i * 10,
      unitPriceGrosze: unitPrices[i] ?? null,
      unitBasis: unitPrices[i] === null ? null : 'kg',
      promoKind: 'price', requiresLoyalty: i === 0,
      productId, dateSource: 'offer',
      validFrom: new Date('2026-08-12T00:00:00Z'),
      validTo: i === 2
        ? new Date('2026-08-01T00:00:00Z')     // already expired
        : new Date('2026-08-14T00:00:00Z'),
    })
  }
})

describe('getProduct', () => {
  it('returns the product with only its current offers', async () => {
    const p = (await getProduct(db, productId, NOW))!
    expect(p.displayName).toBe('masło ekstra')
    expect(p.brand).toBe('Mleczna Dolina')
    expect(p.offers).toHaveLength(2)
    expect(p.offers.map((o) => o.shopSlug).sort()).toEqual(['biedronka', 'lidl'])
  })

  it('marks the cheapest offer by normalized unit price', async () => {
    const p = (await getProduct(db, productId, NOW))!
    const cheapest = p.offers.filter((o) => o.isCheapest)
    expect(cheapest).toHaveLength(1)
    expect(cheapest[0]!.shopSlug).toBe('lidl')
    expect(cheapest[0]!.unitPriceGrosze).toBe(800)
  })

  it('keeps the loyalty flag and the source page', async () => {
    const p = (await getProduct(db, productId, NOW))!
    const biedronka = p.offers.find((o) => o.shopSlug === 'biedronka')!
    expect(biedronka.requiresLoyalty).toBe(true)
    expect(biedronka.pageNo).toBe(1)
    expect(biedronka.leafletId).toBeTruthy()
  })

  it('returns null for an unknown product', async () => {
    expect(await getProduct(
      db, '00000000-0000-0000-0000-000000000000', NOW,
    )).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run tests/queries/product.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/queries/product.ts`**

```ts
import { and, eq, gte, lte } from 'drizzle-orm'
import type { Db } from '@/lib/db/client'
import { leaflets, offers, products, shops } from '@/lib/db/schema'

export interface ProductOffer {
  offerId: string
  shopSlug: string
  leafletId: string
  pageNo: number
  rawName: string
  priceGrosze: number | null
  priceBefore: number | null
  priceRegular: number | null
  unitPriceGrosze: number | null
  unitBasis: 'kg' | 'l' | 'pcs' | null
  promoKind: string
  minQty: number | null
  discountPercent: number | null
  requiresLoyalty: boolean
  purchaseLimit: string | null
  validFrom: Date | null
  validTo: Date | null
  isCheapest: boolean
}

export interface ProductDetail {
  id: string
  displayName: string
  brand: string | null
  sizeValue: number | null
  sizeUnit: 'g' | 'ml' | 'pcs' | null
  offers: ProductOffer[]
}

export async function getProduct(
  db: Db,
  id: string,
  now = new Date(),
): Promise<ProductDetail | null> {
  const [product] = await db.select().from(products).where(eq(products.id, id)).limit(1)
  if (!product) return null

  const rows = await db
    .select({
      offerId: offers.id,
      shopSlug: shops.slug,
      leafletId: offers.leafletId,
      pageNo: offers.pageNo,
      rawName: offers.rawName,
      priceGrosze: offers.priceGrosze,
      priceBefore: offers.priceBefore,
      priceRegular: offers.priceRegular,
      unitPriceGrosze: offers.unitPriceGrosze,
      unitBasis: offers.unitBasis,
      promoKind: offers.promoKind,
      minQty: offers.minQty,
      discountPercent: offers.discountPercent,
      requiresLoyalty: offers.requiresLoyalty,
      purchaseLimit: offers.purchaseLimit,
      validFrom: offers.validFrom,
      validTo: offers.validTo,
    })
    .from(offers)
    .innerJoin(leaflets, eq(leaflets.id, offers.leafletId))
    .innerJoin(shops, eq(shops.id, leaflets.shopId))
    .where(and(
      eq(offers.productId, id),
      lte(offers.validFrom, now),
      gte(offers.validTo, now),
    ))

  // Cheapest is decided per unit basis, never across bases.
  const bestByBasis = new Map<string, number>()
  for (const r of rows) {
    if (r.unitBasis === null || r.unitPriceGrosze === null) continue
    const current = bestByBasis.get(r.unitBasis)
    if (current === undefined || r.unitPriceGrosze < current) {
      bestByBasis.set(r.unitBasis, r.unitPriceGrosze)
    }
  }

  return {
    id: product.id,
    displayName: product.displayName,
    brand: product.brand,
    sizeValue: product.sizeValue,
    sizeUnit: product.sizeUnit,
    offers: rows.map((r) => ({
      ...r,
      isCheapest:
        r.unitBasis !== null &&
        r.unitPriceGrosze !== null &&
        bestByBasis.get(r.unitBasis) === r.unitPriceGrosze,
    })),
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/queries/product.test.ts`
Expected: PASS — four tests green.

- [ ] **Step 5: Implement `src/server/views/product.tsx`**

```tsx
import { Layout } from '@/server/views/layout'
import { formatPromo, formatRange, formatUnitPrice, formatZl } from '@/lib/format'
import type { ProductDetail } from '@/lib/queries/product'

export function ProductView(props: { product: ProductDetail }) {
  const p = props.product
  const size = p.sizeValue ? `${p.sizeValue} ${p.sizeUnit}` : 'na wagę / bez rozmiaru'
  return (
    <Layout title={`${p.displayName} — Promo Radar`}>
      <h1>{p.displayName}</h1>
      <p class="muted">
        {p.brand ?? 'bez marki'} · {size} · {p.offers.length} ofert
      </p>
      <table>
        <thead>
          <tr>
            <th>Sklep</th><th>Cena</th><th>Za jednostkę</th><th>Przed obniżką</th>
            <th>Poza promocją</th><th>Promocja</th><th>Termin</th><th>Limit</th><th>Źródło</th>
          </tr>
        </thead>
        <tbody>
          {p.offers.map((o) => (
            <tr>
              <td>{o.shopSlug}</td>
              <td class="price">
                {formatZl(o.priceGrosze)}
                {o.requiresLoyalty ? <> <span class="badge card">z kartą</span></> : null}
              </td>
              <td>
                {formatUnitPrice(o.unitPriceGrosze, o.unitBasis)}
                {o.isCheapest ? <> <span class="badge best">najtaniej</span></> : null}
              </td>
              <td class="muted">{formatZl(o.priceBefore)}</td>
              <td class="muted">{formatZl(o.priceRegular)}</td>
              <td>{formatPromo(o.promoKind, o.minQty, o.discountPercent)}</td>
              <td>{formatRange(o.validFrom, o.validTo)}</td>
              <td class="muted">{o.purchaseLimit ?? '—'}</td>
              <td><a href={`/leaflets/${o.leafletId}?page=${o.pageNo}`}>s. {o.pageNo}</a></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Layout>
  )
}
```

- [ ] **Step 6: Add routes to `src/server/app.tsx`**

```tsx
app.get('/products/:id', async (c) => {
  const product = await getProduct(db, c.req.param('id'))
  if (!product) return c.text('not found', 404)
  return c.html(<ProductView product={product} />)
})

app.get('/api/products/:id', async (c) => {
  const product = await getProduct(db, c.req.param('id'))
  return product ? c.json(product) : c.json({ error: 'not found' }, 404)
})
```

- [ ] **Step 7: Commit**

```bash
pnpm typecheck
git add -A
git commit -m "feat: add cross-shop comparison screen"
```

---

### Task 4: Leaflet page viewer with offer boxes

**Files:**
- Create: `src/lib/queries/leaflet.ts`, `src/server/views/leaflet.tsx`
- Modify: `src/server/app.tsx`
- Test: `tests/queries/leaflet.test.ts`

**Interfaces:**
- Produces: `interface PageBox { offerId: string; rawName: string; priceGrosze: number | null; x: number; y: number; w: number; h: number }`; `interface LeafletPageView { leafletId: string; shopSlug: string; pageNo: number; pageCount: number; imageUrl: string; boxes: PageBox[] }`; `getLeafletPage(db: Db, leafletId: string, pageNo: number): Promise<LeafletPageView | null>`; `LeafletView(props: { view: LeafletPageView })`.

Page images live in `storage/`, so a route streams them. It resolves the path
from the database rather than from user input, so a crafted `pageNo` cannot
escape the storage directory.

- [ ] **Step 1: Write the failing test `tests/queries/leaflet.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { getLeafletPage } from '@/lib/queries/leaflet'
import { leaflets, leafletPages, offers, shops } from '@/lib/db/schema'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL_TEST })
const db = drizzle(pool)
let leafletId: string

beforeEach(async () => {
  await pool.query('truncate offers, leaflet_pages, leaflets, products, shops cascade')
  const [shop] = await db.insert(shops)
    .values({ slug: 'biedronka', name: 'Biedronka' }).returning()
  const [leaflet] = await db.insert(leaflets).values({
    shopId: shop!.id, externalId: '113166', sourceSlug: 's',
    pdfUrl: 'https://example.test/x.pdf', publishedAt: new Date(),
    fileHash: 'h', pageCount: 84,
  }).returning()
  leafletId = leaflet!.id

  await db.insert(leafletPages).values({
    leafletId, pageNo: 3, imagePath: 'storage/pages/x/p3.jpg',
    imageHash: 'hh', status: 'done',
  })
  await db.insert(offers).values([
    {
      leafletId, pageNo: 3, rawName: 'Karkówka grillowa', name: 'karkówka grillowa',
      priceGrosze: 799, promoKind: 'price', dateSource: 'page',
      bbox: { x: 0.05, y: 0.1, w: 0.3, h: 0.25 },
    },
    {
      leafletId, pageNo: 4, rawName: 'Inna strona', name: 'inna strona',
      priceGrosze: 100, promoKind: 'price', dateSource: 'page',
      bbox: { x: 0, y: 0, w: 1, h: 1 },
    },
  ])
})

describe('getLeafletPage', () => {
  it('returns the page with only its own offer boxes', async () => {
    const v = (await getLeafletPage(db, leafletId, 3))!
    expect(v.shopSlug).toBe('biedronka')
    expect(v.pageCount).toBe(84)
    expect(v.imageUrl).toBe(`/api/pages/${leafletId}/3`)
    expect(v.boxes).toHaveLength(1)
    expect(v.boxes[0]!.rawName).toBe('Karkówka grillowa')
    expect(v.boxes[0]!.x).toBeCloseTo(0.05)
  })

  it('skips offers whose bbox is missing', async () => {
    await db.insert(offers).values({
      leafletId, pageNo: 3, rawName: 'Bez ramki', name: 'bez ramki',
      promoKind: 'price', dateSource: 'page', bbox: null,
    })
    const v = (await getLeafletPage(db, leafletId, 3))!
    expect(v.boxes).toHaveLength(1)
  })

  it('returns null for a page that was never extracted', async () => {
    expect(await getLeafletPage(db, leafletId, 50)).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run tests/queries/leaflet.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/queries/leaflet.ts`**

```ts
import { and, eq } from 'drizzle-orm'
import type { Db } from '@/lib/db/client'
import { leaflets, leafletPages, offers, shops } from '@/lib/db/schema'

export interface PageBox {
  offerId: string
  rawName: string
  priceGrosze: number | null
  x: number
  y: number
  w: number
  h: number
}

export interface LeafletPageView {
  leafletId: string
  shopSlug: string
  pageNo: number
  pageCount: number
  imageUrl: string
  boxes: PageBox[]
}

function isBox(v: unknown): v is { x: number; y: number; w: number; h: number } {
  if (typeof v !== 'object' || v === null) return false
  const b = v as Record<string, unknown>
  return ['x', 'y', 'w', 'h'].every((k) => typeof b[k] === 'number')
}

export async function getLeafletPage(
  db: Db,
  leafletId: string,
  pageNo: number,
): Promise<LeafletPageView | null> {
  const [row] = await db
    .select({
      pageCount: leaflets.pageCount,
      shopSlug: shops.slug,
      pageNo: leafletPages.pageNo,
    })
    .from(leafletPages)
    .innerJoin(leaflets, eq(leaflets.id, leafletPages.leafletId))
    .innerJoin(shops, eq(shops.id, leaflets.shopId))
    .where(and(
      eq(leafletPages.leafletId, leafletId),
      eq(leafletPages.pageNo, pageNo),
    ))
    .limit(1)
  if (!row) return null

  const offerRows = await db
    .select({
      offerId: offers.id,
      rawName: offers.rawName,
      priceGrosze: offers.priceGrosze,
      bbox: offers.bbox,
    })
    .from(offers)
    .where(and(eq(offers.leafletId, leafletId), eq(offers.pageNo, pageNo)))

  return {
    leafletId,
    shopSlug: row.shopSlug,
    pageNo: row.pageNo,
    pageCount: row.pageCount,
    imageUrl: `/api/pages/${leafletId}/${pageNo}`,
    boxes: offerRows.flatMap((o) =>
      isBox(o.bbox)
        ? [{
            offerId: o.offerId, rawName: o.rawName, priceGrosze: o.priceGrosze,
            x: o.bbox.x, y: o.bbox.y, w: o.bbox.w, h: o.bbox.h,
          }]
        : [],
    ),
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/queries/leaflet.test.ts`
Expected: PASS — three tests green.

- [ ] **Step 5: Implement `src/server/views/leaflet.tsx`**

```tsx
import { Layout } from '@/server/views/layout'
import { formatZl } from '@/lib/format'
import type { LeafletPageView } from '@/lib/queries/leaflet'

export function LeafletView(props: { view: LeafletPageView }) {
  const v = props.view
  const prev = v.pageNo > 1 ? v.pageNo - 1 : null
  const next = v.pageNo < v.pageCount ? v.pageNo + 1 : null
  return (
    <Layout title={`${v.shopSlug} s.${v.pageNo} — Promo Radar`}>
      <h1>{v.shopSlug} — strona {v.pageNo} z {v.pageCount}</h1>
      <p>
        {prev ? <a href={`/leaflets/${v.leafletId}?page=${prev}`}>← poprzednia</a> : null}{' '}
        {next ? <a href={`/leaflets/${v.leafletId}?page=${next}`}>następna →</a> : null}{' '}
        <span class="muted">{v.boxes.length} ofert na tej stronie</span>
      </p>
      <div class="viewer">
        <img src={v.imageUrl} alt={`strona ${v.pageNo}`} />
        {v.boxes.map((b) => (
          <span
            class="box"
            title={`${b.rawName} — ${formatZl(b.priceGrosze)}`}
            style={`left:${b.x * 100}%;top:${b.y * 100}%;width:${b.w * 100}%;height:${b.h * 100}%`}
          />
        ))}
      </div>
    </Layout>
  )
}
```

- [ ] **Step 6: Add routes to `src/server/app.tsx`**

```tsx
app.get('/leaflets/:id', async (c) => {
  const pageNo = Number(c.req.query('page') ?? '1')
  const view = await getLeafletPage(
    db, c.req.param('id'), Number.isInteger(pageNo) && pageNo > 0 ? pageNo : 1,
  )
  if (!view) return c.text('not found', 404)
  return c.html(<LeafletView view={view} />)
})

app.get('/api/pages/:leafletId/:pageNo', async (c) => {
  const n = Number(c.req.param('pageNo'))
  if (!Number.isInteger(n) || n < 1) return c.text('bad page', 400)

  // The path comes from the database, never from the request.
  const [page] = await db
    .select({ imagePath: leafletPages.imagePath })
    .from(leafletPages)
    .where(and(
      eq(leafletPages.leafletId, c.req.param('leafletId')),
      eq(leafletPages.pageNo, n),
    ))
    .limit(1)
  if (!page) return c.text('not found', 404)

  try {
    const body = await readFile(page.imagePath)
    return c.body(body, 200, {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'public, max-age=86400',
    })
  } catch {
    return c.text('image missing on disk', 410)
  }
})
```

- [ ] **Step 7: Verify the overlay against a real page**

```bash
pnpm dev &
sleep 3
docker-compose exec -T db psql -U promo -d promo_radar -t -c \
  "select id from leaflets limit 1"
# open http://localhost:3000/leaflets/<that-id>?page=1 in a browser
kill %1
```

Expected: the rendered leaflet page with red boxes sitting on the promo tiles. If
the boxes are systematically offset, the model is returning bbox values in pixels
rather than fractions — tighten that sentence in `src/lib/extract/prompt.ts` and
`pnpm reparse` the leaflet. Do not fudge the coordinates in the view.

- [ ] **Step 8: Commit**

```bash
pnpm typecheck
git add -A
git commit -m "feat: add leaflet page viewer with offer overlays"
```

---

### Task 5: Document the UI

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add a UI section to `README.md`**

````markdown
## Web UI

```bash
pnpm dev     # http://localhost:3000
```

A single Hono server rendering JSX to HTML. No client JavaScript, no bundler.

| Route | What it shows |
|---|---|
| `/` | Current promos. Filters: search, shop, cross-shop only, needs-review. Sort by discount or unit price. |
| `/products/<id>` | The same product across every shop promoting it now, with the cheapest unit price marked. |
| `/leaflets/<id>?page=n` | The source page image with offer boxes overlaid — the fastest way to check a parse. |
| `/api/promos`, `/api/products/<id>` | JSON for the first two. |

Prices marked **z kartą** require the shop's loyalty card, so they are not
comparable to a plain shelf price. "Najtaniej" is decided on the normalized unit
price and only among offers sharing the same basis (per kg, per l, or per piece).
````

- [ ] **Step 2: Run everything and commit**

```bash
pnpm test
pnpm typecheck
git add README.md
git commit -m "docs: document the web UI"
```

---

## Verification

- [ ] `pnpm test` passes (pipeline and UI suites).
- [ ] `pnpm typecheck` is clean.
- [ ] `/` lists real promos, and the "cross-shop only" filter narrows to products promoted by more than one shop.
- [ ] A product page shows one row per shop with the cheapest unit price marked, and loyalty prices badged.
- [ ] A leaflet page renders with boxes that visually land on the promo tiles.
