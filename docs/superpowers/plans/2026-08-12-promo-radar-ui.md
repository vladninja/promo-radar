# Promo Radar — UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Prerequisite:** `docs/superpowers/plans/2026-08-12-promo-radar-pipeline.md` is complete and `pnpm scan` has produced real offers. This plan reads that data; it never writes to it.

**Goal:** Three server-rendered screens — a filterable promo list, a cross-shop price comparison per product, and a leaflet page viewer with offer boxes overlaid — plus JSON endpoints for the same three views.

**Architecture:** Next.js App Router with React Server Components querying Postgres through drizzle directly. All SQL lives in `src/lib/queries/*.ts` so it is unit-testable without rendering; pages are thin presentational wrappers. Page images are served by a route handler that reads from `storage/`, since they live outside `public/`.

**Tech Stack:** next 16.3.0, React 19, drizzle-orm 0.45.2, Vitest 4.1.10. No CSS framework — one small stylesheet.

## Global Constraints

- Money is integer grosze in the database. Formatting to `zł` happens only in `src/lib/format.ts`.
- Unit prices are already normalized to per-kg / per-l / per-piece by the pipeline. Comparison never re-derives them from pack sizes.
- Every screen is a Server Component. No client-side data fetching, no `use client` except where a step explicitly says so.
- A loyalty-gated offer (`requires_loyalty`) must be visually marked wherever a price is shown. Never present a card price as if it were the shelf price.
- "Current" always means `valid_from <= now <= valid_to`.
- Pinned: `next@16.3.0`.

---

## File Structure

| File | Responsibility |
|---|---|
| `next.config.ts` | Next config, path alias |
| `src/app/layout.tsx` | shell, nav, stylesheet import |
| `src/app/globals.css` | the entire stylesheet |
| `src/lib/format.ts` | grosze → `zł`, dates, unit-price labels |
| `src/lib/queries/promos.ts` | list query + filters |
| `src/lib/queries/product.ts` | one product with all its current offers |
| `src/lib/queries/leaflet.ts` | one leaflet page with its offer boxes |
| `src/app/page.tsx` | promo list screen |
| `src/app/products/[id]/page.tsx` | comparison screen |
| `src/app/leaflets/[id]/page.tsx` | page viewer screen |
| `src/app/api/pages/[leafletId]/[pageNo]/route.ts` | serves page JPEGs from storage |
| `src/app/api/promos/route.ts` | JSON list |
| `src/app/api/products/[id]/route.ts` | JSON comparison |

---

### Task 1: Next.js scaffold and formatting

**Files:**
- Create: `next.config.ts`, `src/app/layout.tsx`, `src/app/globals.css`, `src/lib/format.ts`
- Modify: `package.json` (add next/react deps and `dev`/`build` scripts), `tsconfig.json` (add `jsx`, `next-env` include)
- Test: `tests/format.test.ts`

**Interfaces:**
- Consumes: nothing from the pipeline plan except `config`.
- Produces: `formatZl(grosze: number | null): string`; `formatUnitPrice(grosze: number | null, basis: 'kg' | 'l' | 'pcs' | null): string`; `formatRange(from: Date | null, to: Date | null): string`; `formatPromo(kind: string, minQty: number | null, discountPercent: number | null): string`.

- [ ] **Step 1: Install Next and add scripts**

```bash
pnpm add next@16.3.0 react@19.2.0 react-dom@19.2.0
pnpm add -D @types/react@19.2.0 @types/react-dom@19.2.0
```

Add to `package.json` scripts:

```json
"dev": "next dev",
"build": "next build",
"start": "next start"
```

- [ ] **Step 2: Add `next.config.ts`**

```ts
import type { NextConfig } from 'next'

const config: NextConfig = { experimental: { typedRoutes: true } }
export default config
```

- [ ] **Step 3: Extend `tsconfig.json`**

Add to `compilerOptions`: `"jsx": "preserve"`, `"lib": ["ES2023", "DOM"]`, `"plugins": [{ "name": "next" }]`, `"allowJs": true`, `"incremental": true`, `"noEmit": true`. Add `"next-env.d.ts"` and `".next/types/**/*.ts"` to `include`.

- [ ] **Step 4: Write the failing test `tests/format.test.ts`**

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

- [ ] **Step 5: Run it to verify it fails**

Run: `pnpm vitest run tests/format.test.ts`
Expected: FAIL — cannot resolve `@/lib/format`.

- [ ] **Step 6: Implement `src/lib/format.ts`**

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

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm vitest run tests/format.test.ts`
Expected: PASS.

- [ ] **Step 8: Create `src/app/globals.css`**

```css
:root { --fg: #1a1a1a; --muted: #6b6b6b; --line: #e3e3e3; --accent: #c8102e; }
* { box-sizing: border-box; }
body {
  margin: 0; color: var(--fg); background: #fff;
  font: 15px/1.5 system-ui, -apple-system, sans-serif;
}
a { color: inherit; }
header.top {
  display: flex; gap: 1rem; align-items: baseline;
  padding: 1rem 1.5rem; border-bottom: 1px solid var(--line);
}
header.top strong { color: var(--accent); }
main { padding: 1.5rem; max-width: 1100px; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: .5rem .6rem; border-bottom: 1px solid var(--line); }
th { font-weight: 600; color: var(--muted); font-size: 13px; }
.muted { color: var(--muted); }
.price { font-weight: 700; white-space: nowrap; }
.badge {
  display: inline-block; padding: .1rem .4rem; border-radius: 3px;
  font-size: 12px; background: #f2f2f2;
}
.badge.card { background: #fff3cd; }
.badge.review { background: #ffe0e0; }
form.filters { display: flex; gap: .75rem; flex-wrap: wrap; margin-bottom: 1.25rem; }
input, select, button { padding: .35rem .5rem; font: inherit; }
.viewer { position: relative; display: inline-block; }
.viewer img { max-width: 100%; height: auto; display: block; }
.viewer .box {
  position: absolute; border: 2px solid var(--accent);
  background: rgba(200,16,46,.08);
}
```

- [ ] **Step 9: Create `src/app/layout.tsx`**

```tsx
import type { ReactNode } from 'react'
import './globals.css'

export const metadata = { title: 'Promo Radar' }

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pl">
      <body>
        <header className="top">
          <strong>Promo Radar</strong>
          <a href="/">Promocje</a>
        </header>
        <main>{children}</main>
      </body>
    </html>
  )
}
```

- [ ] **Step 10: Verify the app builds and commit**

```bash
pnpm build
git add -A
git commit -m "feat: add Next.js shell and value formatting"
```

Expected: build succeeds.

---

### Task 2: Promo list

**Files:**
- Create: `src/lib/queries/promos.ts`, `src/app/page.tsx`, `src/app/api/promos/route.ts`
- Test: `tests/queries/promos.test.ts`

**Interfaces:**
- Consumes: `db`, schema tables, `formatZl`.
- Produces: `interface PromoFilters { q?: string; shop?: string; crossShopOnly?: boolean; needsReview?: boolean; sort?: 'discount' | 'unit'; now?: Date }`; `interface PromoRow { offerId: string; productId: string | null; rawName: string; shopSlug: string; priceGrosze: number | null; unitPriceGrosze: number | null; unitBasis: 'kg' | 'l' | 'pcs' | null; promoKind: string; minQty: number | null; discountPercent: number | null; requiresLoyalty: boolean; needsReview: boolean; validFrom: Date | null; validTo: Date | null; shopCount: number }`; `listPromos(db: Db, f: PromoFilters): Promise<PromoRow[]>`.

`shopCount` is the number of distinct shops currently promoting that product — the value that makes `crossShopOnly` meaningful.

- [ ] **Step 1: Write the failing test `tests/queries/promos.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { listPromos } from '@/lib/queries/promos'
import { leaflets, offers, products, shops } from '@/lib/db/schema'

const pool = new Pool({ connectionString: process.env.DATABASE_URL_TEST })
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

  // Single-shop offer, and one that has already expired.
  const [lidlLeaflet] = await db.select().from(leaflets).limit(1)
  await db.insert(offers).values([
    {
      leafletId: lidlLeaflet!.id, pageNo: 1, rawName: 'Chleb pszenny, 500 g',
      name: 'chleb pszenny', priceGrosze: 349, promoKind: 'price',
      productId: other!.id, dateSource: 'offer',
      validFrom: new Date('2026-08-12T00:00:00Z'),
      validTo: new Date('2026-08-14T00:00:00Z'),
    },
    {
      leafletId: lidlLeaflet!.id, pageNo: 1, rawName: 'Stara promocja, 1 kg',
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
    const rows = await listPromos(db, { now: NOW, q: 'masło' })
    expect(rows).toHaveLength(2)
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

  const where: SQL[] = [
    lte(offers.validFrom, now),
    gte(offers.validTo, now),
  ]
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

- [ ] **Step 5: Implement `src/app/page.tsx`**

```tsx
import { db } from '@/lib/db/client'
import { listPromos } from '@/lib/queries/promos'
import { formatPromo, formatRange, formatUnitPrice, formatZl } from '@/lib/format'

export const dynamic = 'force-dynamic'

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const sp = await searchParams
  const rows = await listPromos(db, {
    q: sp.q,
    shop: sp.shop,
    crossShopOnly: sp.cross === '1',
    needsReview: sp.review === '1',
    sort: sp.sort === 'unit' ? 'unit' : 'discount',
  })

  return (
    <>
      <form className="filters">
        <input name="q" placeholder="Szukaj produktu" defaultValue={sp.q ?? ''} />
        <select name="shop" defaultValue={sp.shop ?? ''}>
          <option value="">Wszystkie sklepy</option>
          <option value="biedronka">Biedronka</option>
          <option value="lidl">Lidl</option>
          <option value="kaufland">Kaufland</option>
        </select>
        <select name="sort" defaultValue={sp.sort ?? 'discount'}>
          <option value="discount">Największa zniżka</option>
          <option value="unit">Najniższa cena jednostkowa</option>
        </select>
        <label>
          <input type="checkbox" name="cross" value="1" defaultChecked={sp.cross === '1'} />{' '}
          Tylko w kilku sklepach
        </label>
        <label>
          <input type="checkbox" name="review" value="1" defaultChecked={sp.review === '1'} />{' '}
          Do sprawdzenia
        </label>
        <button type="submit">Filtruj</button>
      </form>

      <p className="muted">{rows.length} promocji</p>
      <table>
        <thead>
          <tr>
            <th>Produkt</th><th>Sklep</th><th>Cena</th><th>Za jednostkę</th>
            <th>Promocja</th><th>Termin</th><th>Sklepy</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.offerId}>
              <td>
                {r.productId
                  ? <a href={`/products/${r.productId}`}>{r.rawName}</a>
                  : r.rawName}
                {r.needsReview && <> <span className="badge review">do sprawdzenia</span></>}
              </td>
              <td>{r.shopSlug}</td>
              <td className="price">
                {formatZl(r.priceGrosze)}
                {r.requiresLoyalty && <> <span className="badge card">z kartą</span></>}
              </td>
              <td>{formatUnitPrice(r.unitPriceGrosze, r.unitBasis)}</td>
              <td>{formatPromo(r.promoKind, r.minQty, r.discountPercent)}</td>
              <td>{formatRange(r.validFrom, r.validTo)}</td>
              <td>{r.shopCount > 1 ? `${r.shopCount} sklepy` : '1'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}
```

- [ ] **Step 6: Implement `src/app/api/promos/route.ts`**

```ts
import { db } from '@/lib/db/client'
import { listPromos } from '@/lib/queries/promos'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const p = new URL(request.url).searchParams
  const rows = await listPromos(db, {
    q: p.get('q') ?? undefined,
    shop: p.get('shop') ?? undefined,
    crossShopOnly: p.get('cross') === '1',
    needsReview: p.get('review') === '1',
    sort: p.get('sort') === 'unit' ? 'unit' : 'discount',
  })
  return Response.json(rows)
}
```

- [ ] **Step 7: Check the screen against real data**

```bash
pnpm dev &
sleep 6
curl -s "http://localhost:3000/api/promos?cross=1" | head -c 400
curl -s "http://localhost:3000/" | grep -c "<tr>"
kill %1
```

Expected: JSON rows from your scanned data, and a positive row count in the HTML.

- [ ] **Step 8: Commit**

```bash
git add src/lib/queries/promos.ts src/app/page.tsx src/app/api/promos tests/queries/
git commit -m "feat: add the promo list screen and JSON endpoint"
```

---

### Task 3: Cross-shop comparison

**Files:**
- Create: `src/lib/queries/product.ts`, `src/app/products/[id]/page.tsx`, `src/app/api/products/[id]/route.ts`
- Test: `tests/queries/product.test.ts`

**Interfaces:**
- Consumes: `db`, schema, formatters.
- Produces: `interface ProductOffer { offerId: string; shopSlug: string; leafletId: string; pageNo: number; priceGrosze: number | null; priceBefore: number | null; priceRegular: number | null; unitPriceGrosze: number | null; unitBasis: 'kg' | 'l' | 'pcs' | null; promoKind: string; minQty: number | null; discountPercent: number | null; requiresLoyalty: boolean; purchaseLimit: string | null; validFrom: Date | null; validTo: Date | null; rawName: string; isCheapest: boolean }`; `interface ProductDetail { id: string; displayName: string; brand: string | null; sizeValue: number | null; sizeUnit: 'g' | 'ml' | 'pcs' | null; offers: ProductOffer[] }`; `getProduct(db: Db, id: string, now?: Date): Promise<ProductDetail | null>`.

`isCheapest` is computed on the **normalized unit price** and only among offers
that share the same `unitBasis`, so 200 g and 500 g packs are ranked honestly and
a per-piece price is never compared against a per-kilogram one.

- [ ] **Step 1: Write the failing test `tests/queries/product.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { getProduct } from '@/lib/queries/product'
import { leaflets, offers, products, shops } from '@/lib/db/schema'

const pool = new Pool({ connectionString: process.env.DATABASE_URL_TEST })
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

  // Cheapest is decided per unit basis, never across bases: a per-piece price
  // must not win against a per-kilogram one.
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

- [ ] **Step 5: Implement `src/app/products/[id]/page.tsx`**

```tsx
import { notFound } from 'next/navigation'
import { db } from '@/lib/db/client'
import { getProduct } from '@/lib/queries/product'
import { formatPromo, formatRange, formatUnitPrice, formatZl } from '@/lib/format'

export const dynamic = 'force-dynamic'

export default async function ProductPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const product = await getProduct(db, id)
  if (!product) notFound()

  const size = product.sizeValue
    ? `${product.sizeValue} ${product.sizeUnit}`
    : 'na wagę / bez rozmiaru'

  return (
    <>
      <h1>{product.displayName}</h1>
      <p className="muted">
        {product.brand ?? 'bez marki'} · {size} · {product.offers.length} ofert
      </p>

      <table>
        <thead>
          <tr>
            <th>Sklep</th><th>Cena</th><th>Za jednostkę</th><th>Przed obniżką</th>
            <th>Poza promocją</th><th>Promocja</th><th>Termin</th><th>Limit</th><th>Źródło</th>
          </tr>
        </thead>
        <tbody>
          {product.offers.map((o) => (
            <tr key={o.offerId}>
              <td>{o.shopSlug}</td>
              <td className="price">
                {formatZl(o.priceGrosze)}
                {o.requiresLoyalty && <> <span className="badge card">z kartą</span></>}
              </td>
              <td>
                {formatUnitPrice(o.unitPriceGrosze, o.unitBasis)}
                {o.isCheapest && <> <span className="badge">najtaniej</span></>}
              </td>
              <td className="muted">{formatZl(o.priceBefore)}</td>
              <td className="muted">{formatZl(o.priceRegular)}</td>
              <td>{formatPromo(o.promoKind, o.minQty, o.discountPercent)}</td>
              <td>{formatRange(o.validFrom, o.validTo)}</td>
              <td className="muted">{o.purchaseLimit ?? '—'}</td>
              <td>
                <a href={`/leaflets/${o.leafletId}?page=${o.pageNo}`}>
                  s. {o.pageNo}
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}
```

- [ ] **Step 6: Implement `src/app/api/products/[id]/route.ts`**

```ts
import { db } from '@/lib/db/client'
import { getProduct } from '@/lib/queries/product'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const product = await getProduct(db, id)
  if (!product) return Response.json({ error: 'not found' }, { status: 404 })
  return Response.json(product)
}
```

- [ ] **Step 7: Commit**

```bash
pnpm build
git add src/lib/queries/product.ts src/app/products src/app/api/products tests/queries/product.test.ts
git commit -m "feat: add cross-shop comparison screen"
```

---

### Task 4: Leaflet page viewer with offer boxes

**Files:**
- Create: `src/lib/queries/leaflet.ts`, `src/app/leaflets/[id]/page.tsx`, `src/app/api/pages/[leafletId]/[pageNo]/route.ts`
- Test: `tests/queries/leaflet.test.ts`

**Interfaces:**
- Consumes: `db`, schema, `config.storageDir`.
- Produces: `interface PageBox { offerId: string; rawName: string; priceGrosze: number | null; x: number; y: number; w: number; h: number }`; `interface LeafletPageView { leafletId: string; shopSlug: string; pageNo: number; pageCount: number; imageUrl: string; boxes: PageBox[] }`; `getLeafletPage(db: Db, leafletId: string, pageNo: number): Promise<LeafletPageView | null>`.

Page images live in `storage/`, outside `public/`, so a route handler streams
them. It resolves the path from the database rather than from user input, so a
crafted `pageNo` cannot escape the storage directory.

- [ ] **Step 1: Write the failing test `tests/queries/leaflet.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { getLeafletPage } from '@/lib/queries/leaflet'
import { leaflets, leafletPages, offers, shops } from '@/lib/db/schema'

const pool = new Pool({ connectionString: process.env.DATABASE_URL_TEST })
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

- [ ] **Step 5: Implement `src/app/api/pages/[leafletId]/[pageNo]/route.ts`**

```ts
import { readFile } from 'node:fs/promises'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { leafletPages } from '@/lib/db/schema'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ leafletId: string; pageNo: string }> },
) {
  const { leafletId, pageNo } = await params
  const n = Number(pageNo)
  if (!Number.isInteger(n) || n < 1) {
    return new Response('bad page', { status: 400 })
  }

  // The path comes from the database, never from the request.
  const [page] = await db
    .select({ imagePath: leafletPages.imagePath })
    .from(leafletPages)
    .where(and(eq(leafletPages.leafletId, leafletId), eq(leafletPages.pageNo, n)))
    .limit(1)
  if (!page) return new Response('not found', { status: 404 })

  try {
    const body = await readFile(page.imagePath)
    return new Response(body, {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=86400',
      },
    })
  } catch {
    return new Response('image missing on disk', { status: 410 })
  }
}
```

- [ ] **Step 6: Implement `src/app/leaflets/[id]/page.tsx`**

```tsx
import { notFound } from 'next/navigation'
import { db } from '@/lib/db/client'
import { getLeafletPage } from '@/lib/queries/leaflet'
import { formatZl } from '@/lib/format'

export const dynamic = 'force-dynamic'

export default async function LeafletPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ page?: string }>
}) {
  const { id } = await params
  const { page } = await searchParams
  const pageNo = Number(page ?? '1')
  const view = await getLeafletPage(db, id, Number.isInteger(pageNo) ? pageNo : 1)
  if (!view) notFound()

  const prev = view.pageNo > 1 ? view.pageNo - 1 : null
  const next = view.pageNo < view.pageCount ? view.pageNo + 1 : null

  return (
    <>
      <h1>{view.shopSlug} — strona {view.pageNo} z {view.pageCount}</h1>
      <p>
        {prev && <a href={`/leaflets/${id}?page=${prev}`}>← poprzednia</a>}{' '}
        {next && <a href={`/leaflets/${id}?page=${next}`}>następna →</a>}{' '}
        <span className="muted">{view.boxes.length} ofert na tej stronie</span>
      </p>

      <div className="viewer">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={view.imageUrl} alt={`strona ${view.pageNo}`} />
        {view.boxes.map((b) => (
          <span
            key={b.offerId}
            className="box"
            title={`${b.rawName} — ${formatZl(b.priceGrosze)}`}
            style={{
              left: `${b.x * 100}%`,
              top: `${b.y * 100}%`,
              width: `${b.w * 100}%`,
              height: `${b.h * 100}%`,
            }}
          />
        ))}
      </div>
    </>
  )
}
```

- [ ] **Step 7: Verify the overlay against a real page**

```bash
pnpm dev &
sleep 6
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
pnpm build
git add src/lib/queries/leaflet.ts src/app/leaflets src/app/api/pages tests/queries/leaflet.test.ts
git commit -m "feat: add leaflet page viewer with offer overlays"
```

---

### Task 5: Finish the docs

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add a UI section to `README.md`**

````markdown
## Web UI

```bash
pnpm dev     # http://localhost:3000
```

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
pnpm build
git add README.md
git commit -m "docs: document the web UI"
```

Expected: tests pass, no type errors, build succeeds.

---

## Verification

- [ ] `pnpm test` passes (pipeline and UI suites).
- [ ] `pnpm build` succeeds.
- [ ] `/` lists real promos, and the "cross-shop only" filter narrows to products promoted by more than one shop.
- [ ] A product page shows one row per shop with the cheapest unit price marked, and loyalty prices badged.
- [ ] A leaflet page renders with boxes that visually land on the promo tiles.
