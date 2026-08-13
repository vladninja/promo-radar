/**
 * Downloads a current leaflet, registers it, and renders every page to JPEG.
 * Makes no vision calls, so it costs nothing.
 *
 * This is the first half of reading a leaflet by hand: run it, then look at the
 * rendered pages and feed your readings to scripts/ingest-pages.ts.
 *
 * Usage:
 *   pnpm tsx scripts/prepare-leaflet.ts --list
 *   pnpm tsx scripts/prepare-leaflet.ts <externalId>
 */
import { eq, and } from 'drizzle-orm'
import { join } from 'node:path'
import { config } from '@/lib/config'
import { db, pool } from '@/lib/db/client'
import { leaflets, shops } from '@/lib/db/schema'
import { pageCount, renderPage } from '@/lib/acquire/rasterize'
import { sources } from '@/lib/sources'

const source = sources['gazetkipromocyjne']!
const arg = process.argv[2]

try {
  const found = await source.discover(config.shopAllowlist)
  const now = new Date()
  const current = found.filter((d) =>
    d.validFrom && d.validTo ? d.validFrom <= now && d.validTo >= now : true,
  )

  if (!arg || arg === '--list') {
    console.log(`${current.length} leaflets on offer today:\n`)
    for (const d of current) {
      const from = d.validFrom?.toISOString().slice(0, 10) ?? '?'
      const to = d.validTo?.toISOString().slice(0, 10) ?? '?'
      console.log(
        `  ${d.externalId.padEnd(8)} ${d.shopSlug.padEnd(10)} ${from} -> ${to}` +
        `  ${d.pageCount ?? '?'} pages`,
      )
    }
    console.log('\nthen: pnpm tsx scripts/prepare-leaflet.ts <externalId>')
    process.exit(0)
  }

  const d = current.find((x) => x.externalId === arg)
  if (!d) throw new Error(`${arg} is not among the leaflets on offer today`)

  const [shop] = await db.select().from(shops).where(eq(shops.slug, d.shopSlug)).limit(1)
  if (!shop) throw new Error(`shop ${d.shopSlug} is not seeded`)

  const [known] = await db.select().from(leaflets)
    .where(and(eq(leaflets.shopId, shop.id), eq(leaflets.externalId, d.externalId)))
    .limit(1)

  let leafletId: string
  let pdfPath: string
  if (known) {
    leafletId = known.id
    pdfPath = join(config.storageDir, 'pdf', d.shopSlug, `${d.externalId}.pdf`)
    console.log(`already registered: ${leafletId}`)
  } else {
    console.log(`downloading ${d.pdfUrl} …`)
    const asset = await source.fetchAsset(d, join(config.storageDir, 'pdf'))
    pdfPath = asset.path
    const [row] = await db.insert(leaflets).values({
      shopId: shop.id, externalId: d.externalId, sourceSlug: source.slug,
      pdfUrl: d.pdfUrl, publishedAt: d.publishedAt,
      validFrom: d.validFrom, validTo: d.validTo,
      fileHash: asset.sha256, pageCount: await pageCount(asset.path),
    }).returning({ id: leaflets.id })
    leafletId = row!.id
  }

  const [leaflet] = await db.select().from(leaflets).where(eq(leaflets.id, leafletId)).limit(1)
  const pageDir = join(config.storageDir, 'pages', leafletId)
  console.log(`rendering ${leaflet!.pageCount} pages to ${pageDir} …`)
  for (let n = 1; n <= leaflet!.pageCount; n++) {
    await renderPage(pdfPath, n, pageDir)
  }

  console.log(JSON.stringify({
    leafletId,
    externalId: d.externalId,
    shop: d.shopSlug,
    pages: leaflet!.pageCount,
    pageDir,
    validFrom: leaflet!.validFrom,
    validTo: leaflet!.validTo,
  }, null, 2))
} catch (e) {
  console.error(e instanceof Error ? e.message : e)
  process.exitCode = 1
} finally {
  await pool.end()
}
