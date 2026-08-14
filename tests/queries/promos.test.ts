import { describe, it, expect, beforeEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { listPromoPage, listPromos } from '@/lib/queries/promos'
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
    displayName: 'masło ekstra', matchName: 'masł ekstr',
    sizeValue: 200, sizeUnit: 'g',
  }).returning()
  const [other] = await db.insert(products).values({
    canonicalKey: 'k|chleb|500g', displayName: 'chleb', matchName: 'chleb',
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
    expect(rows).toHaveLength(2)   // the butter, once, and the bread
  })

  it('reports how many shops promote each product', async () => {
    const rows = await listPromos(db, { now: NOW })
    const butter = rows.filter((r) => r.rawName.startsWith('Masło'))
    expect(butter).toHaveLength(1)
    expect(butter[0]!.shopCount).toBe(2)
    const bread = rows.find((r) => r.rawName.startsWith('Chleb'))!
    expect(bread.shopCount).toBe(1)
  })

  it('shows one card for a product two shops are promoting, at the lower price', async () => {
    const rows = await listPromos(db, { now: NOW, q: 'masło' })
    expect(rows).toHaveLength(1)
    expect(rows[0]!.priceGrosze).toBe(199)      // Biedronka's, the cheaper
    expect(rows[0]!.shopSlug).toBe('biedronka')
    // Lidl's 9,00 zł/kg belongs to Lidl's 2,00: quoting it here would put a
    // figure on the card that appears in neither leaflet.
    expect(rows[0]!.unitPriceGrosze).toBe(800)
  })

  it('filters to cross-shop products only', async () => {
    const rows = await listPromos(db, { now: NOW, crossShopOnly: true })
    expect(rows).toHaveLength(1)
    expect(rows[0]!.rawName.startsWith('Masło')).toBe(true)
  })

  it('filters by shop', async () => {
    const rows = await listPromos(db, { now: NOW, shop: 'biedronka' })
    expect(rows.every((r) => r.shopSlug === 'biedronka')).toBe(true)
    expect(rows.length).toBeGreaterThan(0)
  })

  it('searches by name, case-insensitively', async () => {
    expect(await listPromos(db, { now: NOW, q: 'masło' })).toHaveLength(1)
    expect(await listPromos(db, { now: NOW, q: 'MASŁO' })).toHaveLength(1)
  })

  it('sorts by unit price ascending, offers without one last', async () => {
    const rows = await listPromos(db, { now: NOW, sort: 'unit' })
    expect(rows[0]!.unitPriceGrosze).toBe(800)
    expect(rows.at(-1)!.unitPriceGrosze).toBeNull()
  })

  it('sorts by discount descending by default', async () => {
    const rows = await listPromos(db, { now: NOW, crossShopOnly: true })
    expect(rows[0]!.discountPercent).toBe(60)
  })

  it('shows one row for a promotion printed on two pages', async () => {
    // Leaflets advertise headline offers on the cover and again in the section,
    // the second printing usually carrying more detail.
    const [existing] = await db.select().from(offers)
      .where(eq(offers.rawName, 'Chleb pszenny, 500 g')).limit(1)
    expect(existing!.unitPriceGrosze).toBeNull()   // the cover printing

    await db.insert(offers).values({
      leafletId: existing!.leafletId, pageNo: 7,
      rawName: existing!.rawName, name: existing!.name,
      priceGrosze: existing!.priceGrosze, promoKind: 'price',
      requiresLoyalty: existing!.requiresLoyalty, productId: existing!.productId,
      unitPriceGrosze: 698, unitBasis: 'kg',       // the section printing, fuller
      validFrom: existing!.validFrom, validTo: existing!.validTo,
      dateSource: 'offer',
    })

    const rows = await listPromos(db, { now: NOW, q: 'chleb' })
    expect(rows).toHaveLength(1)                   // one promotion, not two pages
    expect(rows[0]!.unitPriceGrosze).toBe(698)     // enriched by the fuller row
  })

  it('carries the loyalty flag through', async () => {
    const rows = await listPromos(db, { now: NOW, shop: 'biedronka' })
    expect(rows[0]!.requiresLoyalty).toBe(true)
  })
})

describe('listPromoPage', () => {
  it('keeps shelf offers out of the grid and boxes them separately', async () => {
    const [leaflet] = await db.select().from(leaflets).limit(1)
    await db.insert(offers).values({
      leafletId: leaflet!.id, pageNo: 9, rawName: 'WSZYSTKIE PRODUKTY FINISH',
      name: 'wszystkie produkty finish', promoKind: 'percent',
      discountPercent: 70, isGroup: true, dateSource: 'offer',
      validFrom: new Date('2026-08-12T00:00:00Z'),
      validTo: new Date('2026-08-14T00:00:00Z'),
    })

    const page = await listPromoPage(db, { now: NOW })
    expect(page.rows.some((r) => r.isGroup)).toBe(false)
    expect(page.groups.map((g) => g.rawName)).toEqual(['WSZYSTKIE PRODUKTY FINISH'])
    expect(page.total).toBe(2)        // the butter and the bread, not the shelf
    expect(page.groupTotal).toBe(1)
  })

  it('gives the whole set when the shelves are what was asked for', async () => {
    const [leaflet] = await db.select().from(leaflets).limit(1)
    await db.insert(offers).values({
      leafletId: leaflet!.id, pageNo: 9, rawName: 'WSZYSTKIE PRODUKTY FINISH',
      name: 'wszystkie produkty finish', promoKind: 'percent',
      discountPercent: 70, isGroup: true, dateSource: 'offer',
      validFrom: new Date('2026-08-12T00:00:00Z'),
      validTo: new Date('2026-08-14T00:00:00Z'),
    })

    const page = await listPromoPage(db, { now: NOW, groupsOnly: true })
    expect(page.rows).toHaveLength(0)
    expect(page.groups).toHaveLength(1)
  })
})
