import { describe, it, expect } from 'vitest'
import { isSuspicious, extractPage, type PageResult, type VisionClient } from '@/lib/extract/vision'

const tile = (over: Partial<PageResult['tiles'][number]> = {}) => ({
  raw_name: 'Masło Ekstra Mleczna Dolina, 200 g',
  brand: 'Mleczna Dolina',
  price: '1,99',
  price_before: null,
  price_regular: null,
  discount_percent: 60,
  promo_kind: 'multibuy' as const,
  min_qty: 3,
  unit_price_raw: null,
  requires_loyalty: true,
  purchase_limit: 'Limit dzienny 3 szt. na kartę Moja Biedronka',
  date_badge: 'OFERTA OD 13.08 DO 14.08',
  bbox: { x: 0.55, y: 0.03, w: 0.4, h: 0.2 },
  ...over,
})

const page = (over: Partial<PageResult> = {}): PageResult => ({
  page_date_badge: 'ŚRODA – PIĄTEK 12.08-14.08',
  issue_text: 'NR 33/2026 P',
  tiles: [tile()],
  ...over,
})

describe('isSuspicious', () => {
  it('flags a page with no tiles', () => {
    expect(isSuspicious(page({ tiles: [] }))).toBe(true)
  })
  it('flags a plain-price tile with no price', () => {
    expect(isSuspicious(page({
      tiles: [tile({ promo_kind: 'price', price: null })],
    }))).toBe(true)
  })
  it('accepts a bogo tile with no price', () => {
    expect(isSuspicious(page({
      tiles: [tile({ promo_kind: 'bogo', price: null })],
    }))).toBe(false)
  })
  it('accepts a healthy page', () => {
    expect(isSuspicious(page())).toBe(false)
  })
})

describe('extractPage', () => {
  const PDF = 'tests/fixtures/leaflet-2pages.pdf'

  it('returns the first result when it is healthy, without splitting', async () => {
    const calls: string[] = []
    const client: VisionClient = {
      async parsePage(imagePath) {
        calls.push(imagePath)
        return { result: page(), tokensIn: 1000, tokensOut: 500 }
      },
    }
    const out = await extractPage({ client, pdfPath: PDF, pageNo: 1, outDir: 'storage/test' })
    expect(out.status).toBe('done')
    expect(calls).toHaveLength(1)
    expect(out.splitRetry).toBe(false)
  })

  it('retries as halves when the page looks suspicious, and merges tiles', async () => {
    const calls: string[] = []
    const client: VisionClient = {
      async parsePage(imagePath) {
        calls.push(imagePath)
        if (calls.length === 1) return { result: page({ tiles: [] }), tokensIn: 900, tokensOut: 10 }
        return { result: page(), tokensIn: 800, tokensOut: 400 }
      },
    }
    const out = await extractPage({ client, pdfPath: PDF, pageNo: 1, outDir: 'storage/test' })
    expect(calls).toHaveLength(3)          // whole page, then two halves
    expect(out.splitRetry).toBe(true)
    expect(out.status).toBe('done')
    if (out.status === 'done') expect(out.result.tiles).toHaveLength(2)
    expect(out.tokensIn).toBe(2500)        // tokens accumulate across all calls
  })

  it('fails when both halves are still suspicious', async () => {
    const client: VisionClient = {
      async parsePage() {
        return { result: page({ tiles: [] }), tokensIn: 100, tokensOut: 5 }
      },
    }
    const out = await extractPage({ client, pdfPath: PDF, pageNo: 1, outDir: 'storage/test' })
    expect(out.status).toBe('failed')
    expect(out.splitRetry).toBe(true)
  })

  it('fails with the error message when the client throws', async () => {
    const client: VisionClient = {
      async parsePage() { throw new Error('schema validation failed') },
    }
    const out = await extractPage({ client, pdfPath: PDF, pageNo: 1, outDir: 'storage/test' })
    expect(out.status).toBe('failed')
    if (out.status === 'failed') expect(out.error).toContain('schema validation failed')
  })

  it('carries the page image path and hash on the outcome', async () => {
    const client: VisionClient = {
      async parsePage() { return { result: page(), tokensIn: 1, tokensOut: 1 } },
    }
    const out = await extractPage({ client, pdfPath: PDF, pageNo: 2, outDir: 'storage/test' })
    expect(out.imagePath).toContain('p2.jpg')
    expect(out.imageHash).toMatch(/^[0-9a-f]{64}$/)
  })
})
