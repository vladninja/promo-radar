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

describe.runIf(existsSync(FIXTURE))('golden page result', () => {
  const raw = JSON.parse(readFileSync(FIXTURE, 'utf8'))

  it('still satisfies the page schema', () => {
    expect(() => PageResultSchema.parse(raw)).not.toThrow()
  })

  it('yields parseable prices for every plain-price tile', () => {
    const page = PageResultSchema.parse(raw)
    const priced = page.tiles.filter((t) => t.promo_kind === 'price')
    expect(priced.length).toBeGreaterThan(0)
    for (const t of priced) expect(parseGrosze(t.price ?? '')).not.toBeNull()
  })

  it('keeps bbox values as fractions of the page', () => {
    const page = PageResultSchema.parse(raw)
    for (const t of page.tiles) {
      for (const v of [t.bbox.x, t.bbox.y, t.bbox.w, t.bbox.h]) {
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(1)
      }
    }
  })
})
