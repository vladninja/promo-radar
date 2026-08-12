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
