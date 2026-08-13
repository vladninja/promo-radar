/**
 * Rebuilds every offer from the page readings already stored in leaflet_pages.
 *
 * Each page keeps the raw reading that produced it, so offers can be regenerated
 * without touching the vision API. That makes this the repair tool for anything
 * that corrupted offers while the readings themselves stayed good — duplicates
 * from two runs overlapping, say — and the way to apply a change in parsing or
 * categorising to pages already read.
 *
 * Usage: pnpm tsx scripts/rebuild-offers.ts [--apply]
 */
import { eq } from 'drizzle-orm'
import { db, pool } from '@/lib/db/client'
import { leaflets, leafletPages, offers, products } from '@/lib/db/schema'
import { fallbackLeafletRange } from '@/lib/extract/dates'
import { PageResultSchema } from '@/lib/extract/schema'
import { persistPageResult } from '@/lib/pipeline/persist'

const apply = process.argv.includes('--apply')

try {
  const pages = await db
    .select({
      leafletId: leafletPages.leafletId,
      pageNo: leafletPages.pageNo,
      rawJson: leafletPages.rawJson,
      imagePath: leafletPages.imagePath,
      imageHash: leafletPages.imageHash,
      tokensIn: leafletPages.tokensIn,
      tokensOut: leafletPages.tokensOut,
      splitRetry: leafletPages.splitRetry,
      publishedAt: leaflets.publishedAt,
      validFrom: leaflets.validFrom,
      validTo: leaflets.validTo,
    })
    .from(leafletPages)
    .innerJoin(leaflets, eq(leaflets.id, leafletPages.leafletId))
    .where(eq(leafletPages.status, 'done'))

  const usable = pages.filter((p) => p.rawJson !== null)
  const before = (await db.select().from(offers)).length

  console.log(
    `${usable.length} readable pages of ${pages.length}; ${before} offers now`,
  )
  if (!apply) {
    console.log('re-run with --apply to rebuild')
    process.exit(0)
  }

  // Products are derived from offers, so they are rebuilt alongside them rather
  // than left pointing at rows that no longer exist.
  await db.delete(offers)
  await db.delete(products)

  let rebuilt = 0
  let skipped = 0
  for (const page of usable) {
    const parsed = PageResultSchema.safeParse(page.rawJson)
    if (!parsed.success) { skipped++; continue }
    const hasPublishedRange = page.validFrom !== null && page.validTo !== null
    await persistPageResult(db, {
      leafletId: page.leafletId,
      pageNo: page.pageNo,
      // Carry the page row's own fields through: persistPageResult upserts it,
      // and blanking these would break the leaflet viewer and the token record.
      imagePath: page.imagePath,
      imageHash: page.imageHash,
      tokensIn: page.tokensIn ?? 0,
      tokensOut: page.tokensOut ?? 0,
      splitRetry: page.splitRetry,
      result: parsed.data,
      publishedAt: page.publishedAt,
      leafletRange: hasPublishedRange
        ? { from: page.validFrom!, to: page.validTo! }
        : fallbackLeafletRange(page.publishedAt),
      leafletRangeIsGuess: !hasPublishedRange,
    })
    rebuilt++
  }

  const after = (await db.select().from(offers)).length
  console.log(
    `rebuilt ${rebuilt} pages${skipped ? `, skipped ${skipped} unparseable` : ''}: ` +
    `${before} offers -> ${after}`,
  )
} catch (e) {
  console.error(e instanceof Error ? e.message : e)
  process.exitCode = 1
} finally {
  await pool.end()
}
