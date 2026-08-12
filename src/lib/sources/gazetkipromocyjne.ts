import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { config } from '@/lib/config'
import { createRateLimiter } from '@/lib/sources/rate-limit'
import type { DiscoveredLeaflet, LeafletSource } from '@/lib/sources/types'

const SHOP_FROM_LINK = /^https?:\/\/[^/]+\/([^/]+)\/attachment\//

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

export function parseMediaItems(
  items: unknown[],
  allowlist: readonly string[],
): DiscoveredLeaflet[] {
  const out: DiscoveredLeaflet[] = []
  for (const raw of items) {
    const it = raw as {
      id?: number
      date?: string
      link?: string
      source_url?: string
      media_details?: { sizes?: { full?: { source_url?: string } } }
    }
    if (!it.id || !it.date || !it.link || !it.source_url) continue
    const m = it.link.match(SHOP_FROM_LINK)
    const slug = m?.[1]
    if (!slug || !allowlist.includes(slug)) continue
    out.push({
      shopSlug: slug,
      externalId: String(it.id),
      pdfUrl: it.source_url,
      publishedAt: new Date(it.date),
      coverUrl: it.media_details?.sizes?.full?.source_url ?? null,
      validFrom: null,
      validTo: null,
      pageCount: null,
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

async function getJson(url: string): Promise<unknown[]> {
  const res = await limit(() =>
    fetch(url, { headers: { 'User-Agent': config.userAgent } }),
  )
  // Asking for a page past the last one answers 400 rest_post_invalid_page_number.
  // That is the end of the results, not a failure — it happens whenever the
  // total is an exact multiple of per_page.
  if (res.status === 400) return []
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`)
  return (await res.json()) as unknown[]
}

export const gazetkiSource: LeafletSource = {
  slug: 'gazetkipromocyjne',

  async discover(shopSlugs, since) {
    const found: DiscoveredLeaflet[] = []
    for (let page = 1; page <= 10; page++) {
      const params = new URLSearchParams({
        mime_type: 'application/pdf',
        per_page: '100',
        page: String(page),
        orderby: 'date',
        order: 'asc',
        _fields: 'id,date,source_url,link,media_details',
      })
      if (since) params.set('after', since.toISOString())
      const items = await getJson(
        `${config.sourceBaseUrl}/wp-json/wp/v2/media?${params}`,
      )
      found.push(...parseMediaItems(items, shopSlugs))
      if (items.length < 100) break
    }

    // One listing page per shop supplies validity dates and page counts. If a
    // page is unreachable or its markup changes, discovery still works — the
    // leaflet simply falls back to the publication-age rule.
    for (const slug of new Set(found.map((f) => f.shopSlug))) {
      const html = await getText(`${config.sourceBaseUrl}/${slug}/`)
      if (!html) continue
      const meta = parseShopMeta(html)
      for (const leaflet of found) {
        if (leaflet.shopSlug !== slug) continue
        const id = pdfIdFromUrl(leaflet.pdfUrl)
        const m = id ? meta.get(id) : undefined
        if (!m) continue
        leaflet.validFrom = m.validFrom
        leaflet.validTo = m.validTo
        leaflet.pageCount = m.pageCount
      }
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
