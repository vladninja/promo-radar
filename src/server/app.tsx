import { Hono } from 'hono'
import type { Context } from 'hono'
import { db } from '@/lib/db/client'
import { listPromos, type PromoFilters } from '@/lib/queries/promos'
import { PromosView } from '@/server/views/promos'

export const app = new Hono()

function promoFilters(c: Context): PromoFilters {
  const q = c.req.query()
  return {
    q: q.q || undefined,
    shop: q.shop || undefined,
    crossShopOnly: q.cross === '1',
    needsReview: q.review === '1',
    sort: q.sort === 'unit' ? 'unit' : 'discount',
  }
}

app.get('/health', (c) => c.text('ok'))

app.get('/', async (c) => {
  const filters = promoFilters(c)
  return c.html(<PromosView rows={await listPromos(db, filters)} filters={filters} />)
})

app.get('/api/promos', async (c) => c.json(await listPromos(db, promoFilters(c))))
