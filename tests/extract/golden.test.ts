import { describe, it, expect } from 'vitest'
import { existsSync, writeFileSync, readFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderPage } from '@/lib/acquire/rasterize'
import { PageResultSchema } from '@/lib/extract/schema'
import { parseGrosze } from '@/lib/normalize/money'

const FIXTURE = 'tests/fixtures/vision-page3.json'

describe.runIf(process.env.SMOKE === '1')('live vision smoke', () => {
  it('parses a real leaflet page and records the response', async () => {
    const { createOpenAiVisionClient } = await import('@/lib/extract/openai-client')
    const dir = await mkdtemp(join(tmpdir(), 'smoke-'))
    const img = await renderPage('tests/fixtures/leaflet-2pages.pdf', 1, dir)
    const out = await createOpenAiVisionClient().parsePage(img.path, 'gpt-5.6-luna')
    expect(out.result.tiles.length).toBeGreaterThan(0)
    writeFileSync(FIXTURE, JSON.stringify(out.result, null, 2))
  }, 180_000)
})

// Loaded lazily: a skipped describe still runs its factory during collection,
// so reading the file at suite level would throw before the fixture exists.
const loadFixture = () =>
  PageResultSchema.parse(JSON.parse(readFileSync(FIXTURE, 'utf8')))

describe('page schema', () => {
  it('rejects a tile that is missing its bounding box', () => {
    expect(() => PageResultSchema.parse({
      page_date_badge: null,
      issue_text: null,
      tiles: [{
        raw_name: 'x', brand: null, price: '1,00', price_before: null,
        price_regular: null, discount_percent: null, promo_kind: 'price',
        min_qty: null, unit_price_raw: null, requires_loyalty: false,
        purchase_limit: null, date_badge: null,
      }],
    })).toThrow()
  })
})

describe.runIf(existsSync(FIXTURE))('golden page result', () => {
  it('still satisfies the page schema', () => {
    expect(() => loadFixture()).not.toThrow()
  })

  it('yields parseable prices for every plain-price tile', () => {
    const priced = loadFixture().tiles.filter((t) => t.promo_kind === 'price')
    expect(priced.length).toBeGreaterThan(0)
    for (const t of priced) expect(parseGrosze(t.price ?? '')).not.toBeNull()
  })

  it('keeps bbox values as fractions of the page', () => {
    for (const t of loadFixture().tiles) {
      for (const v of [t.bbox.x, t.bbox.y, t.bbox.w, t.bbox.h]) {
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(1)
      }
    }
  })
})
