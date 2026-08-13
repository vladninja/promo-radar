import { describe, it, expect, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { getPromo, getSameProductElsewhere, getSimilarPromos } from '@/lib/queries/promo'
import { leaflets, offers, products, shops } from '@/lib/db/schema'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL_TEST })
const db = drizzle(pool)
const NOW = new Date('2026-08-13T12:00:00Z')
const FROM = new Date('2026-08-12T00:00:00Z')
const TO = new Date('2026-08-14T00:00:00Z')

const ids: Record<string, string> = {}

async function leafletFor(slug: string, key: string) {
  const [shop] = await db.insert(shops).values({ slug, name: slug }).returning()
  const [leaflet] = await db.insert(leaflets).values({
    shopId: shop!.id, externalId: key, sourceSlug: 's',
    pdfUrl: 'https://example.test/x.pdf', publishedAt: NOW,
    fileHash: key, pageCount: 60,
  }).returning()
  return leaflet!.id
}

beforeEach(async () => {
  await pool.query('truncate offers, leaflet_pages, leaflets, products, shops cascade')

  const [melon] = await db.insert(products).values({
    canonicalKey: '|arbuz|', displayName: 'arbuzy', matchName: 'arbuz',
  }).returning()
  const [plum] = await db.insert(products).values({
    canonicalKey: '|sliwk|', displayName: 'śliwki', matchName: 'śliwk',
  }).returning()

  const lidl = await leafletFor('lidl', 'L1')
  const biedronka = await leafletFor('biedronka', 'B1')

  // Lidl prints the same watermelon on three pages of one leaflet.
  const rows = await db.insert(offers).values([
    ...[1, 20, 49].map((pageNo) => ({
      leafletId: lidl, pageNo, rawName: 'Arbuzy, luzem 1 kg', name: 'arbuzy',
      priceGrosze: pageNo === 49 ? 199 : 149, promoKind: 'price' as const,
      productId: melon!.id, category: 'owoce-warzywa' as const,
      discountPercent: 75, validFrom: FROM, validTo: TO, dateSource: 'offer' as const,
    })),
    // Biedronka has the same watermelon, twice in its own leaflet.
    {
      leafletId: biedronka, pageNo: 3, rawName: 'Arbuz 1 kg', name: 'arbuz',
      priceGrosze: 299, promoKind: 'price' as const, productId: melon!.id,
      category: 'owoce-warzywa' as const,
      validFrom: FROM, validTo: TO, dateSource: 'offer' as const,
    },
    {
      leafletId: biedronka, pageNo: 30, rawName: 'Arbuz 1 kg', name: 'arbuz',
      priceGrosze: 349, promoKind: 'price' as const, productId: melon!.id,
      category: 'owoce-warzywa' as const,
      validFrom: FROM, validTo: TO, dateSource: 'offer' as const,
    },
    // Something else from the same aisle, printed twice.
    ...[5, 40].map((pageNo) => ({
      leafletId: lidl, pageNo, rawName: 'Śliwki polskie 1 kg', name: 'śliwki',
      priceGrosze: 399, promoKind: 'price' as const, productId: plum!.id,
      category: 'owoce-warzywa' as const,
      discountPercent: 60, validFrom: FROM, validTo: TO, dateSource: 'offer' as const,
    })),
  ]).returning()

  ids.page1 = rows.find((r) => r.pageNo === 1)!.id
})

describe('getSimilarPromos', () => {
  it('leaves out the promotion being viewed, including its other printings', async () => {
    const promo = (await getPromo(db, ids.page1!))!
    const similar = await getSimilarPromos(db, promo, NOW)

    // Pages 20 and 49 are the same watermelon; so is Biedronka's, which belongs
    // under "the same thing elsewhere" rather than under "similar".
    expect(similar.map((s) => s.rawName)).not.toContain('Arbuzy, luzem 1 kg')
    expect(similar.map((s) => s.rawName)).not.toContain('Arbuz 1 kg')
  })

  it('shows one card per product, at its lowest price', async () => {
    const promo = (await getPromo(db, ids.page1!))!
    const similar = await getSimilarPromos(db, promo, NOW)

    expect(similar).toHaveLength(1)              // the plums, printed twice
    expect(similar[0]!.rawName).toBe('Śliwki polskie 1 kg')
    expect(similar[0]!.priceGrosze).toBe(399)
  })
})

describe('getSameProductElsewhere', () => {
  it('lists a shop once, at its best price', async () => {
    const promo = (await getPromo(db, ids.page1!))!
    const elsewhere = await getSameProductElsewhere(db, promo, NOW)

    expect(elsewhere).toHaveLength(1)
    expect(elsewhere[0]!.shopSlug).toBe('biedronka')
    expect(elsewhere[0]!.priceGrosze).toBe(299)   // not the 3,49 printing
  })
})
