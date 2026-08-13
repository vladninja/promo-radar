import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { config } from '@/lib/config'
import { createRateLimiter } from '@/lib/sources/rate-limit'
import type { DiscoveredLeaflet, LeafletSource } from '@/lib/sources/types'

/**
 * The shop listing page carries what the media API does not: each leaflet's
 * validity range, and often its page count. Both sit in the same markup as the
 * PDF link — the download anchor names the dates, and the viewer iframe carries
 * `?pages=N&id=…` — so no DOM walking is needed to pair them.
 *
 * This is what makes it possible to skip an expired leaflet before paying to
 * download and parse 60-90 pages of it.
 */
const DOWNLOAD_ANCHOR =
  /download="[^"]*?od (\d{2})\/(\d{2})\/(\d{4}) do (\d{2})\/(\d{2})\/(\d{4})[^"]*?"\s+href="[^"]*?uploads\/pdf\/([a-z0-9_]+)\.pdf"/g
const VIEWER_IFRAME = /\?pages=(\d+)&(?:amp;)?id=([a-z0-9_]+)/g

export interface ShopLeafletMeta {
  validFrom: Date
  validTo: Date
  pageCount: number | null
}

export function pdfIdFromUrl(url: string): string | null {
  const m = url.match(/\/([a-z0-9_]+)\.pdf(?:$|[?#])/)
  return m ? m[1]! : null
}

export function parseShopMeta(html: string): Map<string, ShopLeafletMeta> {
  const pages = new Map<string, number>()
  for (const m of html.matchAll(VIEWER_IFRAME)) {
    pages.set(m[2]!, Number(m[1]))
  }

  const out = new Map<string, ShopLeafletMeta>()
  for (const m of html.matchAll(DOWNLOAD_ANCHOR)) {
    const [, d1, m1, y1, d2, m2, y2, id] = m
    out.set(id!, {
      validFrom: new Date(Date.UTC(Number(y1), Number(m1) - 1, Number(d1))),
      // The printed end date is inclusive, so a leaflet valid "do 19/08" is
      // still current all through the 19th.
      validTo: new Date(Date.UTC(Number(y2), Number(m2) - 1, Number(d2), 23, 59, 59)),
      pageCount: pages.get(id!) ?? null,
    })
  }
  return out
}

const limit = createRateLimiter(1000)

async function getText(url: string): Promise<string | null> {
  try {
    const res = await limit(() =>
      fetch(url, { headers: { 'User-Agent': config.userAgent } }),
    )
    return res.ok ? await res.text() : null
  } catch {
    return null
  }
}

/** Pure mapping from listing-page metadata to discovered leaflets, so the
 *  shape of what discovery returns is testable without network access. */
export function shopMetaToLeaflets(
  shopSlug: string,
  meta: Map<string, ShopLeafletMeta>,
  baseUrl = config.sourceBaseUrl,
): DiscoveredLeaflet[] {
  return [...meta].map(([id, m]) => ({
    shopSlug,
    externalId: id,
    pdfUrl: `${baseUrl}/wp-content/uploads/pdf/${id}.pdf`,
    publishedAt: m.validFrom,
    coverUrl: null,
    validFrom: m.validFrom,
    validTo: m.validTo,
    pageCount: m.pageCount,
  }))
}

export const gazetkiSource: LeafletSource = {
  slug: 'gazetkipromocyjne',

  /**
   * One request per shop. The listing page carries the validity dates, the page
   * count and the PDF link together, which is everything discovery needs.
   *
   * The media REST endpoint was used for this and has been dropped: it has no
   * validity dates, so it forced a walk of the whole 223-PDF archive plus a
   * cursor, and returned the same 19 current leaflets this does. Its only extra
   * was a publication timestamp, which validity dates make redundant.
   */
  async discover(shopSlugs) {
    const found: DiscoveredLeaflet[] = []
    for (const slug of shopSlugs) {
      const html = await getText(`${config.sourceBaseUrl}/${slug}/`)
      if (!html) continue
      // The listing page gives no publication time. The start of validity is
      // the meaningful date here, and anchors the year when a page prints
      // "12.08" with no year.
      found.push(...shopMetaToLeaflets(slug, parseShopMeta(html)))
    }
    return found
  },

  async fetchAsset(leaflet, destDir) {
    const res = await limit(() =>
      fetch(leaflet.pdfUrl, { headers: { 'User-Agent': config.userAgent } }),
    )
    if (!res.ok) throw new Error(`GET ${leaflet.pdfUrl} failed: ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    const sha256 = createHash('sha256').update(buf).digest('hex')
    const dir = join(destDir, leaflet.shopSlug)
    await mkdir(dir, { recursive: true })
    const path = join(dir, `${leaflet.externalId}.pdf`)
    await writeFile(path, buf)
    return { path, sha256 }
  },
}
