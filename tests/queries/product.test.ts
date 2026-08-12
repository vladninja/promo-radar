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
