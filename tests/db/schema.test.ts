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
