import { describe, it, expect, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { copyFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { runScan } from '@/lib/pipeline/scan'
import { leaflets, leafletPages, offers, shops } from '@/lib/db/schema'
import type { LeafletSource } from '@/lib/sources/types'
import type { VisionClient } from '@/lib/extract/vision'

const pool = new Pool({ connectionString: process.env.DATABASE_URL_TEST })
const db = drizzle(pool)

beforeEach(async () => {
  await pool.query(
    'truncate offers, leaflet_pages, leaflets, products, shops, job_runs, source_cursors cascade',
  )
  await db.insert(shops).values([
    { slug: 'biedronka', name: 'Biedronka' },
    { slug: 'lidl', name: 'Lidl' },
    { slug: 'kaufland', name: 'Kaufland' },
  ])
})

const fakeSource: LeafletSource = {
  slug: 'gazetkipromocyjne',
  async discover() {
    return [{
      shopSlug: 'biedronka',
      externalId: '113166',
      pdfUrl: 'https://example.test/a.pdf',
      publishedAt: new Date('2026-08-12T10:17:04Z'),
      coverUrl: null,
    }]
  },
  async fetchAsset(_l, destDir) {
    await mkdir(join(destDir, 'biedronka'), { recursive: true })
    const path = join(destDir, 'biedronka', '113166.pdf')
    await copyFile('tests/fixtures/leaflet-2pages.pdf', path)
    return { path, sha256: 'fixedhash' }
  },
}

function fakeVision(counter: { calls: number }): VisionClient {
  return {
    async parsePage() {
      counter.calls++
      return {
        tokensIn: 1200, tokensOut: 800,
        result: {
          page_date_badge: 'ŚRODA – PIĄTEK 12.08-14.08',
          issue_text: 'NR 33/2026 P',
          tiles: [{
            raw_name: 'Masło Ekstra Mleczna Dolina, 200 g',
            brand: 'Mleczna Dolina',
            price: '1,99', price_before: null, price_regular: null,
            discount_percent: 60, promo_kind: 'multibuy', min_qty: 3,
            unit_price_raw: '1,00 zł/100 g', requires_loyalty: true,
            purchase_limit: 'Limit dzienny 3 szt.',
            date_badge: 'OFERTA OD 13.08 DO 14.08',
            bbox: { x: 0.5, y: 0.1, w: 0.4, h: 0.2 },
          }],
        },
      }
    },
  }
}

const deps = (counter: { calls: number }, maxPages = 400) => ({
  db, source: fakeSource, client: fakeVision(counter),
  storageDir: 'storage/test-scan', now: () => new Date('2026-08-12T12:00:00Z'),
  maxPages,
})

describe('runScan', () => {
  it('ingests a leaflet, extracts its pages and creates offers', async () => {
    const c = { calls: 0 }
    const stats = await runScan(deps(c))
    expect(stats.leafletsNew).toBe(1)
    expect(stats.pagesExtracted).toBe(2)
    expect(stats.offersCreated).toBe(2)
    expect(stats.tokensIn).toBe(2400)
    expect(stats.costUsd).toBeGreaterThan(0)

    const rows = await db.select().from(offers)
    expect(rows).toHaveLength(2)
    expect(rows[0]!.priceGrosze).toBe(199)
    expect(rows[0]!.unitPriceGrosze).toBe(1000)   // 1,00 zł/100 g → 10,00 zł/kg
    expect(rows[0]!.unitBasis).toBe('kg')
    expect(rows[0]!.requiresLoyalty).toBe(true)
    expect(rows[0]!.minQty).toBe(3)
    expect(rows[0]!.dateSource).toBe('offer')
    expect(rows[0]!.productId).not.toBeNull()
  })

  it('derives the leaflet validity range from its pages', async () => {
    await runScan(deps({ calls: 0 }))
    const [l] = await db.select().from(leaflets)
    expect(l!.validFrom!.toISOString().slice(0, 10)).toBe('2026-08-12')
    expect(l!.validTo!.toISOString().slice(0, 10)).toBe('2026-08-14')
    expect(l!.status).toBe('done')
  })

  it('is idempotent — a second run costs nothing', async () => {
    const first = { calls: 0 }
    await runScan(deps(first))
    expect(first.calls).toBe(2)

    const second = { calls: 0 }
    const stats = await runScan(deps(second))
    expect(second.calls).toBe(0)          // no vision calls at all
    expect(stats.pagesExtracted).toBe(0)
    expect(await db.select().from(offers)).toHaveLength(2)  // no duplicates
    expect(await db.select().from(leafletPages)).toHaveLength(2)
  })

  it('respects the per-run page cap', async () => {
    const c = { calls: 0 }
    const stats = await runScan(deps(c, 1))
    expect(c.calls).toBe(1)
    expect(stats.capped).toBe(true)
    expect(stats.pagesExtracted).toBe(1)
    const [l] = await db.select().from(leaflets)
    expect(l!.status).toBe('partial')
  })

  it('resumes a capped leaflet on the next run, even though discovery skips it', async () => {
    const first = { calls: 0 }
    await runScan(deps(first, 1))
    expect(first.calls).toBe(1)

    // Discovery now returns nothing: the cursor has moved past this leaflet.
    const emptySource: LeafletSource = {
      ...fakeSource,
      async discover() { return [] },
    }
    const second = { calls: 0 }
    const stats = await runScan({ ...deps(second), source: emptySource })

    expect(stats.leafletsResumed).toBe(1)
    expect(second.calls).toBe(1)            // the remaining page, not the done one
    expect(stats.pagesExtracted).toBe(1)
    expect(await db.select().from(leafletPages)).toHaveLength(2)
    const [l] = await db.select().from(leaflets)
    expect(l!.status).toBe('done')
  })

  it('advances the source cursor to the newest publication seen', async () => {
    await runScan(deps({ calls: 0 }))
    const { rows } = await pool.query('select last_seen_date from source_cursors')
    expect(new Date(rows[0].last_seen_date).toISOString())
      .toBe('2026-08-12T10:17:04.000Z')
  })

  it('records a job run with stats', async () => {
    await runScan(deps({ calls: 0 }))
    const { rows } = await pool.query('select script, status, stats from job_runs')
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('ok')
    expect(rows[0].stats.offersCreated).toBe(2)
  })
})
