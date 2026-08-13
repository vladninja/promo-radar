import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseShopMeta, shopMetaToLeaflets } from '@/lib/sources/gazetkipromocyjne'

const html = readFileSync('tests/fixtures/shop-page-biedronka.html', 'utf8')

describe('shopMetaToLeaflets', () => {
  const leaflets = shopMetaToLeaflets(
    'biedronka', parseShopMeta(html), 'https://example.test',
  )

  it('produces one leaflet per listing entry', () => {
    expect(leaflets).toHaveLength(4)
    expect(new Set(leaflets.map((l) => l.shopSlug))).toEqual(new Set(['biedronka']))
  })

  it('uses the pdf file stem as the external id and builds its url', () => {
    const l = leaflets.find((x) => x.externalId === '4__6a7c1f3ae960d')!
    expect(l.pdfUrl).toBe(
      'https://example.test/wp-content/uploads/pdf/4__6a7c1f3ae960d.pdf',
    )
  })

  it('carries validity dates and page count through', () => {
    const l = leaflets.find((x) => x.externalId === '4__6a7c1f3ae960d')!
    expect(l.validFrom!.toISOString().slice(0, 10)).toBe('2026-08-12')
    expect(l.validTo!.toISOString().slice(0, 10)).toBe('2026-08-19')
    expect(l.pageCount).toBe(84)
  })

  it('anchors publishedAt to the start of validity', () => {
    // The listing page has no publication timestamp, and the start of validity
    // is what the year inference needs when a page prints "12.08" bare.
    for (const l of leaflets) expect(l.publishedAt).toEqual(l.validFrom)
  })

  it('returns nothing for markup it does not recognise', () => {
    expect(shopMetaToLeaflets('lidl', parseShopMeta('<html></html>'))).toEqual([])
  })
})
