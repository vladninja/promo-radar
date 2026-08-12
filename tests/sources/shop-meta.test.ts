import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseShopMeta, pdfIdFromUrl } from '@/lib/sources/gazetkipromocyjne'

const html = readFileSync('tests/fixtures/shop-page-biedronka.html', 'utf8')

describe('pdfIdFromUrl', () => {
  it('takes the file stem', () => {
    expect(pdfIdFromUrl(
      'https://www.gazetkipromocyjne.net/wp-content/uploads/pdf/4__6a7c1f3ae960d.pdf',
    )).toBe('4__6a7c1f3ae960d')
  })
  it('returns null for a non-pdf url', () => {
    expect(pdfIdFromUrl('https://example.test/x.jpg')).toBeNull()
  })
})

describe('parseShopMeta', () => {
  const meta = parseShopMeta(html)

  it('pairs every leaflet with its validity range', () => {
    expect(meta.size).toBe(4)
    const entry = meta.get('4__6a7c1f3ae960d')!
    expect(entry.validFrom.toISOString().slice(0, 10)).toBe('2026-08-12')
    expect(entry.validTo.toISOString().slice(0, 10)).toBe('2026-08-19')
  })

  it('reads the page count when the viewer exposes it', () => {
    expect(meta.get('4__6a7c1f3ae960d')!.pageCount).toBe(84)
  })

  it('still returns dates when no page count is present', () => {
    const entry = meta.get('4__deadbeef01')!
    expect(entry.pageCount).toBeNull()
    expect(entry.validTo.toISOString().slice(0, 10)).toBe('2026-06-08')
  })

  it('treats the end date as inclusive to the end of that day', () => {
    // A leaflet valid "do 19/08" is still current at noon on the 19th.
    const entry = meta.get('4__6a7c1f3ae960d')!
    expect(entry.validTo > new Date('2026-08-19T12:00:00Z')).toBe(true)
  })

  it('returns an empty map for markup it does not recognise', () => {
    expect(parseShopMeta('<html><body>nothing here</body></html>').size).toBe(0)
  })
})
