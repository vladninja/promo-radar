/**
 * Ingests page readings produced outside the vision API — for example pages read
 * directly by an assistant looking at the rendered images.
 *
 * The readings go through exactly the same downstream logic as API output:
 * date precedence, money parsing, size extraction and product matching, all via
 * persistPageResult. Only the reading itself differs.
 *
 * Input is a JSON file: [{ "pageNo": 1, "result": { ...PageResult } }, …]
 * where PageResult is { page_date_badge, issue_text, tiles: [...] }.
 *
 * Usage: pnpm tsx scripts/ingest-pages.ts <leafletId> <readings.json>
 */
import { readFile } from 'node:fs/promises'
import { eq } from 'drizzle-orm'
import { join } from 'node:path'
import { config } from '@/lib/config'
import { db, pool } from '@/lib/db/client'
import { leaflets, leafletPages } from '@/lib/db/schema'
import { fallbackLeafletRange } from '@/lib/extract/dates'
import { PageResultSchema } from '@/lib/extract/schema'
import { persistPageResult } from '@/lib/pipeline/persist'

const [leafletId, jsonPath] = process.argv.slice(2)
if (!leafletId || !jsonPath) {
  console.error('usage: tsx scripts/ingest-pages.ts <leafletId> <readings.json>')
  process.exit(1)
}

try {
  const [leaflet] = await db.select().from(leaflets)
    .where(eq(leaflets.id, leafletId)).limit(1)
  if (!leaflet) throw new Error(`no leaflet ${leafletId}`)

  const leafletRange = leaflet.validFrom && leaflet.validTo
    ? { from: leaflet.validFrom, to: leaflet.validTo }
    : fallbackLeafletRange(leaflet.publishedAt)

  const raw = JSON.parse(await readFile(jsonPath, 'utf8')) as Array<{
    pageNo: number
    result: unknown
  }>

  const already = await db
    .select({ pageNo: leafletPages.pageNo, status: leafletPages.status })
    .from(leafletPages).where(eq(leafletPages.leafletId, leafletId))
  const done = new Set(
    already.filter((p) => p.status === 'done').map((p) => p.pageNo),
  )

  let pages = 0
  let offers = 0
  let skipped = 0
  for (const entry of raw) {
    if (done.has(entry.pageNo)) { skipped++; continue }
    // Validated with the same schema the API output must satisfy, so a
    // malformed reading fails loudly here rather than corrupting the data.
    const result = PageResultSchema.parse(entry.result)
    const out = await persistPageResult(db, {
      leafletId,
      pageNo: entry.pageNo,
      imagePath: join(config.storageDir, 'pages', leafletId, `p${entry.pageNo}.jpg`),
      imageHash: '',
      result,
      publishedAt: leaflet.publishedAt,
      leafletRange,
    })
    pages++
    offers += out.offersCreated
  }

  const total = await db.select({ pageNo: leafletPages.pageNo })
    .from(leafletPages).where(eq(leafletPages.leafletId, leafletId))
  await db.update(leaflets)
    .set({ status: total.length >= leaflet.pageCount ? 'done' : 'partial' })
    .where(eq(leaflets.id, leafletId))

  console.log(JSON.stringify({ pages, offers, skipped, leafletId }))
} catch (e) {
  console.error(e instanceof Error ? e.message : e)
  process.exitCode = 1
} finally {
  await pool.end()
}
