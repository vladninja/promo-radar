import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import type { Context } from 'hono'
import { db } from '@/lib/db/client'
import { leafletPages } from '@/lib/db/schema'
import { renderCrop } from '@/lib/acquire/crop'
import { config } from '@/lib/config'
import { getLeafletPage } from '@/lib/queries/leaflet'
import {
  getPromo, getGroupMembers, getSameProductElsewhere, getSimilarPromos,
} from '@/lib/queries/promo'
import { PromoView } from '@/server/views/promo'
import { getProduct } from '@/lib/queries/product'
import { listPromos, listPromoPage, type PromoFilters } from '@/lib/queries/promos'
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
    foodOnly: q.food === '1',
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
  const page = Number(c.req.query('page') ?? '1')
  const result = await listPromoPage(db, filters, Number.isFinite(page) ? page : 1)
  return c.html(<PromosView result={result} filters={filters} query={c.req.query()} />)
})

app.get('/api/promos', async (c) => c.json(await listPromos(db, promoFilters(c))))

app.get('/promos/:id', async (c) => {
  const promo = await getPromo(db, c.req.param('id'))
  if (!promo) return c.text('not found', 404)
  const [elsewhere, similar, members] = await Promise.all([
    // A shelf offer is not a product, so there is no same-product-elsewhere to
    // look for; what it covers is printed in its own leaflet instead.
    promo.isGroup ? Promise.resolve([]) : getSameProductElsewhere(db, promo),
    getSimilarPromos(db, promo),
    getGroupMembers(db, promo),
  ])
  return c.html(
    <PromoView promo={promo} elsewhere={elsewhere} similar={similar} members={members} />,
  )
})

// One promo tile, cropped out of its leaflet page and cached on disk.
app.get('/api/crop/:id', async (c) => {
  const promo = await getPromo(db, c.req.param('id'))
  if (!promo || !promo.bbox) return c.text('no image', 404)
  const pdfPath = join(
    config.storageDir, 'pdf', promo.shopSlug, `${promo.externalId}.pdf`,
  )
  try {
    const file = await renderCrop(
      pdfPath, promo.pageNo, promo.bbox, join(config.storageDir, 'crops'),
    )
    return c.body(await readFile(file), 200, {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'public, max-age=604800',
    })
  } catch {
    return c.text('crop unavailable', 404)
  }
})

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
