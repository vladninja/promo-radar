import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseMediaItems } from '@/lib/sources/gazetkipromocyjne'

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
      coverUrl: null,
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
