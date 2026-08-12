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
