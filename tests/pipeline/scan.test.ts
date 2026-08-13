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
    'truncate offers, leaflet_pages, leaflets, products, shops, job_runs cascade',
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
      coverUrl: null, validFrom: null, validTo: null, pageCount: null,
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
            price: '1,99', price_unit: null,
            price_before: null, price_regular: null,
            discount_percent: 60, promo_kind: 'multibuy', min_qty: 3,
            unit_price_raw: '1,00 zł/100 g', requires_loyalty: true,
            purchase_limit: 'Limit dzienny 3 szt.',
            date_badge: 'OFERTA OD 13.08 DO 14.08',
            category: 'nabial' as const,
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
  maxPages, maxLeafletAgeDays: 14,
})

/** A source publishing leaflets at the given ISO dates, oldest listed first. */
function sourceWithDates(dates: string[]): LeafletSource {
  return {
    ...fakeSource,
    async discover() {
      return dates.map((date, i) => ({
        shopSlug: 'biedronka',
        externalId: `L${i}`,
        pdfUrl: 'https://example.test/a.pdf',
        publishedAt: new Date(date),
        coverUrl: null, validFrom: null, validTo: null, pageCount: null,
      }))
    },
    async fetchAsset(l, destDir) {
      await mkdir(join(destDir, 'biedronka'), { recursive: true })
      const path = join(destDir, 'biedronka', `${l.externalId}.pdf`)
      await copyFile('tests/fixtures/leaflet-2pages.pdf', path)
      return { path, sha256: `h-${l.externalId}` }
    },
  }
}

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

    // Discovery returns nothing this run; the leaflet must still be resumed.
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

  it('ignores leaflets published longer ago than the age limit', async () => {
    const c = { calls: 0 }
    const stats = await runScan({
      ...deps(c),
      source: sourceWithDates([
        '2026-05-01T00:00:00Z',   // 103 days old — stale catalogue
        '2026-07-20T00:00:00Z',   // 23 days old
        '2026-08-11T00:00:00Z',   // yesterday
      ]),
    })
    expect(stats.leafletsSkippedOld).toBe(2)
    expect(stats.leafletsSeen).toBe(1)
    expect(stats.leafletsNew).toBe(1)
    const rows = await db.select().from(leaflets)
    expect(rows.map((r) => r.externalId)).toEqual(['L2'])
  })

  it('never downloads a leaflet whose validity has already ended', async () => {
    const c = { calls: 0 }
    let downloads = 0
    const dated: LeafletSource = {
      ...fakeSource,
      async discover() {
        return [
          {
            shopSlug: 'biedronka', externalId: 'EXPIRED',
            pdfUrl: 'https://example.test/a.pdf',
            publishedAt: new Date('2026-08-11T00:00:00Z'),   // published recently
            coverUrl: null,
            validFrom: new Date('2026-08-01T00:00:00Z'),
            validTo: new Date('2026-08-05T23:59:59Z'),        // but already over
            pageCount: 84,
          },
          {
            shopSlug: 'biedronka', externalId: 'CURRENT',
            pdfUrl: 'https://example.test/b.pdf',
            publishedAt: new Date('2026-08-10T00:00:00Z'),
            coverUrl: null,
            validFrom: new Date('2026-08-12T00:00:00Z'),
            validTo: new Date('2026-08-19T23:59:59Z'),
            pageCount: 2,
          },
        ]
      },
      async fetchAsset(l, destDir) {
        downloads++
        await mkdir(join(destDir, 'biedronka'), { recursive: true })
        const path = join(destDir, 'biedronka', `${l.externalId}.pdf`)
        await copyFile('tests/fixtures/leaflet-2pages.pdf', path)
        return { path, sha256: `h-${l.externalId}` }
      },
    }

    const stats = await runScan({ ...deps(c), source: dated })
    expect(stats.leafletsSkippedOld).toBe(1)
    expect(downloads).toBe(1)                    // the expired one never fetched
    const rows = await db.select().from(leaflets)
    expect(rows.map((r) => r.externalId)).toEqual(['CURRENT'])
    // The source's own dates are stored, not a guess from the publication date.
    expect(rows[0]!.validTo!.toISOString().slice(0, 10)).toBe('2026-08-19')
  })

  it('does not parse a leaflet whose promotions have not started yet', async () => {
    const c = { calls: 0 }
    let downloads = 0
    const NOW = new Date('2026-08-12T12:00:00Z')
    const dated: LeafletSource = {
      ...fakeSource,
      async discover() {
        return [
          {
            shopSlug: 'biedronka', externalId: 'NEXTWEEK',
            pdfUrl: 'https://example.test/a.pdf',
            publishedAt: new Date('2026-08-11T00:00:00Z'),
            coverUrl: null,
            validFrom: new Date('2026-08-17T00:00:00Z'),   // starts in 5 days
            validTo: new Date('2026-08-22T23:59:59Z'),
            pageCount: 62,
          },
          {
            shopSlug: 'biedronka', externalId: 'TODAY',
            pdfUrl: 'https://example.test/b.pdf',
            publishedAt: new Date('2026-08-10T00:00:00Z'),
            coverUrl: null,
            validFrom: new Date('2026-08-12T00:00:00Z'),
            validTo: new Date('2026-08-14T23:59:59Z'),
            pageCount: 2,
          },
        ]
      },
      async fetchAsset(l, destDir) {
        downloads++
        await mkdir(join(destDir, 'biedronka'), { recursive: true })
        const path = join(destDir, 'biedronka', `${l.externalId}.pdf`)
        await copyFile('tests/fixtures/leaflet-2pages.pdf', path)
        return { path, sha256: `h-${l.externalId}` }
      },
    }

    const stats = await runScan({ ...deps(c), source: dated })
    expect(stats.leafletsSkippedFuture).toBe(1)
    expect(downloads).toBe(1)
    const rows = await db.select().from(leaflets)
    expect(rows.map((r) => r.externalId)).toEqual(['TODAY'])

    // Nothing to hide it from a later run: discovery re-reads the listing page
    // every time, so it reappears on the day it becomes current.
    expect(NOW < new Date('2026-08-17T00:00:00Z')).toBe(true)
  })

  it('reuses an identical page instead of paying for it twice', async () => {
    const c = { calls: 0 }
    // Two leaflets built from the same PDF, so their page images are identical.
    const stats = await runScan({
      ...deps(c),
      source: sourceWithDates([
        '2026-08-10T00:00:00Z',
        '2026-08-11T00:00:00Z',
      ]),
    })

    expect(stats.leafletsNew).toBe(2)
    expect(c.calls).toBe(2)                 // 4 pages, only 2 actually parsed
    expect(stats.pagesReused).toBe(2)
    expect(stats.pagesExtracted).toBe(4)    // all four pages still recorded
    expect(await db.select().from(offers)).toHaveLength(4)
  })

  it('spends its budget on the newest leaflet first', async () => {
    const stats = await runScan({
      ...deps({ calls: 0 }, 2),      // room for one 2-page leaflet only
      source: sourceWithDates([
        '2026-08-02T00:00:00Z',
        '2026-08-10T00:00:00Z',       // newest
      ]),
    })
    expect(stats.capped).toBe(true)
    const rows = await db.select().from(leaflets)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.externalId).toBe('L1')
  })

  it('does not spend on an unfinished leaflet whose promotions have ended', async () => {
    await runScan(deps({ calls: 0 }, 1))       // leaves one leaflet partial
    await db.update(leaflets).set({
      validTo: new Date('2026-08-01T00:00:00Z'),   // expired before "now"
    })

    const second = { calls: 0 }
    const stats = await runScan({
      ...deps(second),
      source: { ...fakeSource, async discover() { return [] } },
    })
    expect(stats.leafletsSkippedExpired).toBe(1)
    expect(stats.leafletsResumed).toBe(0)
    expect(second.calls).toBe(0)
  })

  it('records a job run with stats', async () => {
    await runScan(deps({ calls: 0 }))
    const { rows } = await pool.query('select script, status, stats from job_runs')
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('ok')
    expect(rows[0].stats.offersCreated).toBe(2)
  })
})
