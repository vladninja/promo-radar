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
