import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { config } from '@/lib/config'
import { createRateLimiter } from '@/lib/sources/rate-limit'
import type { DiscoveredLeaflet, LeafletSource } from '@/lib/sources/types'

const SHOP_FROM_LINK = /^https?:\/\/[^/]+\/([^/]+)\/attachment\//

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
    })
  }
  return out
}

const limit = createRateLimiter(1000)

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
