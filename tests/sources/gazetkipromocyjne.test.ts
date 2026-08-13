import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { collectPages, parseMediaItems } from '@/lib/sources/gazetkipromocyjne'

describe('collectPages', () => {
  it('keeps going after a short page', async () => {
    // The live endpoint answers 99 for per_page=100 on the first page. Treating
    // that as the end silently discarded more than half the archive.
    const sizes = [99, 100, 24, 0]
    const seen: number[] = []
    const out = await collectPages(async (page) => {
      seen.push(page)
      return new Array(sizes[page - 1] ?? 0).fill({})
    })
    expect(seen).toEqual([1, 2, 3, 4])
    expect(out).toHaveLength(223)
  })

  it('stops at the first empty page', async () => {
    let calls = 0
    const out = await collectPages(async () => { calls++; return [] })
    expect(calls).toBe(1)
    expect(out).toEqual([])
  })

  it('respects the page cap', async () => {
    let calls = 0
    await collectPages(async () => { calls++; return [{}] }, 3)
    expect(calls).toBe(3)
  })
})

const items = JSON.parse(
  readFileSync('tests/fixtures/media-2026-08-12.json', 'utf8'),
) as unknown[]

describe('parseMediaItems', () => {
  it('keeps only allowlisted shops', () => {
    const out = parseMediaItems(items, ['biedronka', 'lidl', 'kaufland'])
    expect(out.length).toBeGreaterThan(0)
    for (const l of out) {
      expect(['biedronka', 'lidl', 'kaufland']).toContain(l.shopSlug)
    }
  })

  it('derives the shop from link, not from the filename prefix', () => {
    const out = parseMediaItems(
      [{
        id: 1,
        date: '2026-08-12T10:17:04',
        link: 'https://www.gazetkipromocyjne.net/lidl/attachment/0__abc/',
        source_url: 'https://www.gazetkipromocyjne.net/wp-content/uploads/pdf/0__abc.pdf',
        post: 0,
      }],
      ['lidl'],
    )
    expect(out).toEqual([{
      shopSlug: 'lidl',
      externalId: '1',
      pdfUrl: 'https://www.gazetkipromocyjne.net/wp-content/uploads/pdf/0__abc.pdf',
      publishedAt: new Date('2026-08-12T10:17:04'),
      coverUrl: null, validFrom: null, validTo: null, pageCount: null,
    }])
  })

  it('skips items whose link has no shop slug', () => {
    expect(parseMediaItems(
      [{
        id: 2, date: '2026-08-12T10:00:00',
        link: 'https://www.gazetkipromocyjne.net/attachment/x/',
        source_url: 'https://example.test/x.pdf', post: 0,
      }],
      ['lidl'],
    )).toEqual([])
  })

  it('reads the cover thumbnail when present', () => {
    const out = parseMediaItems(
      [{
        id: 3, date: '2026-08-12T10:00:00',
        link: 'https://www.gazetkipromocyjne.net/biedronka/attachment/y/',
        source_url: 'https://example.test/y.pdf',
        media_details: { sizes: { full: { source_url: 'https://example.test/y-pdf.jpg' } } },
      }],
      ['biedronka'],
    )
    expect(out[0]!.coverUrl).toBe('https://example.test/y-pdf.jpg')
  })
})
