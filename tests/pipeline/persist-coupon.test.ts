import { describe, it, expect, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { persistPageResult } from '@/lib/pipeline/persist'
import { rescoreAll } from '@/lib/pipeline/rescore'
import { leaflets, offers, shops } from '@/lib/db/schema'
import type { OfferTile } from '@/lib/extract/schema'

const pool = new Pool({ connectionString: process.env.DATABASE_URL_TEST })
const db = drizzle(pool)

beforeEach(async () => {
  await pool.query(
    'truncate offers, leaflet_pages, leaflets, products, shops cascade',
  )
})

function tile(over: Partial<OfferTile>): OfferTile {
  return {
    raw_name: 'Danio serek homogenizowany, 140 g', brand: 'Danone',
    price: null, price_unit: null, price_before: null, price_regular: null,
    discount_percent: null, promo_kind: 'price', min_qty: null,
    unit_price_raw: null, requires_loyalty: false,
    requires_coupon: false, coupon_points: null,
    purchase_limit: null, date_badge: null, category: 'nabial',
    bbox: { x: 0, y: 0, w: 0.2, h: 0.2 },
    ...over,
  }
}

async function persist(tiles: OfferTile[]) {
  const [shop] = await db.insert(shops)
    .values({ slug: `s${tiles.length}`, name: 'S' }).returning()
  const [leaflet] = await db.insert(leaflets).values({
    shopId: shop!.id, externalId: 'e1', sourceSlug: 'x',
    pdfUrl: 'https://example.test/x.pdf', publishedAt: new Date('2026-08-12'),
    fileHash: 'h', pageCount: 1,
  }).returning()
  await persistPageResult(db, {
    leafletId: leaflet!.id, pageNo: 1,
    imagePath: 'p.png', imageHash: 'ih',
    result: { page_date_badge: null, issue_text: null, no_offers: false, tiles },
    publishedAt: new Date('2026-08-12'),
    leafletRange: {
      from: new Date('2026-08-12'), to: new Date('2026-08-18'),
    },
  })
  return db.select().from(offers)
}

describe('a price behind a points coupon', () => {
  it('gives way to the shelf price printed beside it', async () => {
    const [row] = await persist([tile({
      price: '0,01', price_before: '8,99', discount_percent: 99,
      unit_price_raw: '0,07 zł/kg',
      requires_coupon: true, coupon_points: 1000,
    })])

    expect(row!.priceGrosze).toBe(899)     // what a shopper without points pays
    expect(row!.priceBefore).toBeNull()    // 8,99 is the price now, not a cut
    expect(row!.unitPriceGrosze).toBeNull()
    expect(row!.unitPriceRaw).toBeNull()
    expect(row!.requiresCoupon).toBe(true)
    expect(row!.couponPoints).toBe(1000)
    expect(row!.needsReview).toBe(true)
  })

  it('leaves no price at all when the tile prints only the coupon price', async () => {
    // The Danio and Oshee tiles: 0,01 with a coin badge and nothing else. A
    // missing price is honest; 0,01 would beat every yoghurt in Poland.
    const [row] = await persist([tile({
      price: '0,01', requires_coupon: true, coupon_points: 1000,
    })])

    expect(row!.priceGrosze).toBeNull()
    expect(row!.requiresCoupon).toBe(true)
  })

  it('is caught by the price floor even when the marker is missed', async () => {
    const [row] = await persist([tile({ price: '0,01', price_before: '5,99' })])

    expect(row!.priceGrosze).toBe(599)
    expect(row!.requiresCoupon).toBe(false)   // nothing was read off the page
    expect(row!.needsReview).toBe(true)
  })

  it('leaves an ordinary promotional price alone', async () => {
    const [row] = await persist([tile({
      price: '5,99', price_before: '8,99', discount_percent: 33,
      unit_price_raw: '4,28 zł/kg',
    })])

    expect(row!.priceGrosze).toBe(599)
    expect(row!.priceBefore).toBe(899)
    expect(row!.unitPriceGrosze).toBe(428)
    expect(row!.needsReview).toBe(false)
  })

  it('survives a rescore, which clears every review flag first', async () => {
    await persist([tile({
      price: '0,01', price_before: '8,99', requires_coupon: true,
    })])
    await rescoreAll(db)

    const [row] = await db.select().from(offers)
    expect(row!.needsReview).toBe(true)
  })
})
