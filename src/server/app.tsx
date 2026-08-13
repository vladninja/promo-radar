import { readFile } from 'node:fs/promises'
import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import type { Context } from 'hono'
import { db } from '@/lib/db/client'
import { leafletPages } from '@/lib/db/schema'
import { getLeafletPage } from '@/lib/queries/leaflet'
import { getProduct } from '@/lib/queries/product'
import { listPromos, type PromoFilters } from '@/lib/queries/promos'
import { CATEGORIES, type Category } from '@/lib/normalize/category'
import { LeafletView } from '@/server/views/leaflet'
import { ProductView } from '@/server/views/product'
import { PromosView } from '@/server/views/promos'

export const app = new Hono()

function promoFilters(c: Context): PromoFilters {
  const q = c.req.query()
  return {
    q: q.q || undefined,
    shop: q.shop || undefined,
    crossShopOnly: q.cross === '1',
    needsReview: q.review === '1',
    category: (CATEGORIES as readonly string[]).includes(q.category ?? '')
      ? (q.category as Category)
      : undefined,
    sort: q.sort === 'unit' ? 'unit' : 'discount',
  }
}

app.get('/health', (c) => c.text('ok'))
app.get('/favicon.ico', (c) => c.body(null, 204))

app.get('/', async (c) => {
  const filters = promoFilters(c)
  return c.html(<PromosView rows={await listPromos(db, filters)} filters={filters} />)
})

app.get('/api/promos', async (c) => c.json(await listPromos(db, promoFilters(c))))

app.get('/products/:id', async (c) => {
  const product = await getProduct(db, c.req.param('id'))
  if (!product) return c.text('not found', 404)
  return c.html(<ProductView product={product} />)
})

app.get('/api/products/:id', async (c) => {
  const product = await getProduct(db, c.req.param('id'))
  return product ? c.json(product) : c.json({ error: 'not found' }, 404)
})

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

  // The path comes from the database, never from the request, so a crafted
  // page number cannot escape the storage directory.
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
