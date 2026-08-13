import { and, eq, sql } from 'drizzle-orm'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { config } from '@/lib/config'
import type { Db } from '@/lib/db/client'
import {
  jobRuns, leaflets, leafletPages, shops,
} from '@/lib/db/schema'
import { pageCount } from '@/lib/acquire/rasterize'
import { fallbackLeafletRange } from '@/lib/extract/dates'
import { extractPage, type PageResult, type VisionClient } from '@/lib/extract/vision'
import { persistPageResult } from '@/lib/pipeline/persist'
import type { LeafletSource } from '@/lib/sources/types'

export interface ScanDeps {
  db: Db
  source: LeafletSource
  client: VisionClient
  storageDir: string
  now: () => Date
  maxPages: number
  maxLeafletAgeDays: number
}

export interface ScanStats {
  leafletsSeen: number
  leafletsSkippedOld: number
  leafletsSkippedFuture: number
  leafletsSkippedExpired: number
  leafletsNew: number
  leafletsResumed: number
  pagesExtracted: number
  pagesReused: number
  pagesFailed: number
  offersCreated: number
  tokensIn: number
  tokensOut: number
  costUsd: number
  capped: boolean
}

function costUsd(tokensIn: number, tokensOut: number, model: string): number {
  const p = config.pricing[model] ?? { input: 0, output: 0 }
  return (tokensIn * p.input + tokensOut * p.output) / 1_000_000
}

/**
 * The source has stopped answering usefully. With discovery reading the shop
 * listing pages directly, "no current leaflets at all" is the signal — there is
 * no cursor to age out, and a healthy day always lists something.
 */
export function isStale(stats: ScanStats): boolean {
  return stats.leafletsSeen === 0
}

export async function runScan(deps: ScanDeps): Promise<ScanStats> {
  const { db, source, client, storageDir, now } = deps
  const stats: ScanStats = {
    leafletsSeen: 0, leafletsSkippedOld: 0, leafletsSkippedFuture: 0,
    leafletsSkippedExpired: 0,
    leafletsNew: 0, leafletsResumed: 0,
    pagesExtracted: 0, pagesReused: 0, pagesFailed: 0,
    offersCreated: 0, tokensIn: 0, tokensOut: 0, costUsd: 0, capped: false,
  }

  const [run] = await db
    .insert(jobRuns)
    .values({ script: 'scan', startedAt: now() })
    .returning({ id: jobRuns.id })

  try {
    const all = await source.discover(config.shopAllowlist)

    // Only leaflets that can still be current. Validity dates live inside the
    // PDF, so publication age is the one signal available before paying to
    // parse. Newest first, so a capped run spends its budget on the freshest.
    const ageCutoff = new Date(
      now().getTime() - deps.maxLeafletAgeDays * 24 * 3600 * 1000,
    )
    // Parse only what is on offer today. Dates from the shop listing page make
    // this exact; without them, publication age is the fallback.
    const isCurrent = (d: typeof all[number]) => {
      if (d.validFrom && d.validTo) return d.validFrom <= now() && d.validTo >= now()
      if (d.validTo) return d.validTo >= now()
      return d.publishedAt >= ageCutoff
    }
    // Already published but not started yet. Shops post next week's leaflet
    // days ahead; it is parsed on the day it becomes current, not before.
    const isFuture = (d: typeof all[number]) => d.validFrom !== null && d.validFrom > now()

    const discovered = all
      .filter(isCurrent)
      .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())
    const future = all.filter(isFuture)

    stats.leafletsSeen = discovered.length
    stats.leafletsSkippedFuture = future.length
    stats.leafletsSkippedOld = all.length - discovered.length - future.length

    const shopRows = await db.select().from(shops)
    const shopIdBySlug = new Map(shopRows.map((s) => [s.slug, s.id]))
    let pageBudget = deps.maxPages

    // Leaflets we have already stored but not finished — because a previous run
    // hit the page cap, a page failed, or `reparse` cleared them. Discovery will
    // never return these again (the cursor has moved past their publication
    // date), so they are resumed from the database instead.
    const unfinishedAll = await db
      .select({
        id: leaflets.id, externalId: leaflets.externalId, pdfUrl: leaflets.pdfUrl,
        publishedAt: leaflets.publishedAt,
        validFrom: leaflets.validFrom, validTo: leaflets.validTo,
        pageCount: leaflets.pageCount, shopSlug: shops.slug,
      })
      .from(leaflets)
      .innerJoin(shops, eq(shops.id, leaflets.shopId))
      .where(sql`${leaflets.status} <> 'done'`)

    // Finishing a leaflet whose promotions have already ended buys nothing.
    const unfinished = unfinishedAll.filter(
      (u) => u.validTo === null || u.validTo >= now(),
    )
    stats.leafletsSkippedExpired = unfinishedAll.length - unfinished.length

    const work: Array<{ leafletId: string | null; d: typeof discovered[number] }> = [
      ...unfinished.map((u) => ({
        leafletId: u.id,
        d: {
          shopSlug: u.shopSlug, externalId: u.externalId, pdfUrl: u.pdfUrl,
          publishedAt: u.publishedAt, coverUrl: null,
          validFrom: u.validFrom, validTo: u.validTo, pageCount: u.pageCount,
        },
      })),
      ...discovered
        .filter((d) => !unfinished.some(
          (u) => u.shopSlug === d.shopSlug && u.externalId === d.externalId,
        ))
        .map((d) => ({ leafletId: null, d })),
    ]
    stats.leafletsResumed = unfinished.length

    for (const item of work) {
      const d = item.d
      const shopId = shopIdBySlug.get(d.shopSlug)
      if (!shopId) continue
      // Stop before downloading a PDF there is no budget left to parse.
      if (pageBudget <= 0) { stats.capped = true; break }

      const [known] = item.leafletId
        ? [{ id: item.leafletId }]
        : await db
            .select({ id: leaflets.id })
            .from(leaflets)
            .where(and(eq(leaflets.shopId, shopId), eq(leaflets.externalId, d.externalId)))
            .limit(1)

      let leafletId: string
      let pdfPath: string
      const pdfDir = join(storageDir, 'pdf')

      if (known) {
        leafletId = known.id
        pdfPath = join(pdfDir, d.shopSlug, `${d.externalId}.pdf`)
      } else {
        const asset = await source.fetchAsset(d, pdfDir)
        pdfPath = asset.path
        const [inserted] = await db
          .insert(leaflets)
          .values({
            shopId, externalId: d.externalId, sourceSlug: source.slug,
            pdfUrl: d.pdfUrl, publishedAt: d.publishedAt,
            validFrom: d.validFrom, validTo: d.validTo,
            fileHash: asset.sha256, pageCount: await pageCount(asset.path),
          })
          .returning({ id: leaflets.id })
        leafletId = inserted!.id
        stats.leafletsNew++
      }

      const [leaflet] = await db
        .select().from(leaflets).where(eq(leaflets.id, leafletId)).limit(1)
      // Prefer the source's own validity range over guessing a week from the
      // publication date, so offers with no printed dates still get real ones.
      const hasPublishedRange = leaflet!.validFrom !== null && leaflet!.validTo !== null
      const leafletRange = hasPublishedRange
        ? { from: leaflet!.validFrom!, to: leaflet!.validTo! }
        : fallbackLeafletRange(leaflet!.publishedAt)
      const pageDir = join(storageDir, 'pages', leafletId)
      await mkdir(pageDir, { recursive: true })

      const existing = await db
        .select({ pageNo: leafletPages.pageNo, status: leafletPages.status })
        .from(leafletPages)
        .where(eq(leafletPages.leafletId, leafletId))
      const done = new Set(
        existing.filter((p) => p.status === 'done').map((p) => p.pageNo),
      )

      for (let pageNo = 1; pageNo <= leaflet!.pageCount; pageNo++) {
        if (done.has(pageNo)) continue
        if (pageBudget <= 0) { stats.capped = true; break }
        pageBudget--

        const outcome = await extractPage({
          client, pdfPath, pageNo, outDir: pageDir,
          model: config.visionModel, escalationModel: config.visionModelEscalation,
          async reuse(imageHash) {
            const [hit] = await db
              .select({ rawJson: leafletPages.rawJson })
              .from(leafletPages)
              .where(and(
                eq(leafletPages.imageHash, imageHash),
                eq(leafletPages.status, 'done'),
              ))
              .limit(1)
            return (hit?.rawJson as PageResult | undefined) ?? null
          },
        })
        if (outcome.reused) stats.pagesReused++
        stats.tokensIn += outcome.tokensIn
        stats.tokensOut += outcome.tokensOut
        stats.costUsd += costUsd(outcome.tokensIn, outcome.tokensOut, config.visionModel)

        if (outcome.status === 'failed') {
          stats.pagesFailed++
          await db.insert(leafletPages).values({
            leafletId, pageNo,
            imagePath: outcome.imagePath, imageHash: outcome.imageHash,
            status: 'failed', error: outcome.error,
            tokensIn: outcome.tokensIn, tokensOut: outcome.tokensOut,
            splitRetry: outcome.splitRetry,
          }).onConflictDoNothing()
          continue
        }

        const persisted = await persistPageResult(db, {
          leafletId, pageNo,
          imagePath: outcome.imagePath, imageHash: outcome.imageHash,
          result: outcome.result,
          publishedAt: leaflet!.publishedAt,
          leafletRange,
          leafletRangeIsGuess: !hasPublishedRange,
          tokensIn: outcome.tokensIn, tokensOut: outcome.tokensOut,
          splitRetry: outcome.splitRetry,
        })
        stats.pagesExtracted++
        stats.offersCreated += persisted.offersCreated
      }

      // Derive the leaflet range from what the pages actually said.
      // Raw sql aggregates come back as strings — drizzle applies no column
      // parser to them — so timestamps and counts are coerced explicitly.
      const [agg] = await db
        .select({
          from: sql<string | null>`min(${leafletPages.validFrom})`,
          to: sql<string | null>`max(${leafletPages.validTo})`,
          failed: sql<string>`count(*) filter (where ${leafletPages.status} = 'failed')`,
          total: sql<string>`count(*)`,
        })
        .from(leafletPages)
        .where(eq(leafletPages.leafletId, leafletId))

      const complete = Number(agg!.total) === leaflet!.pageCount
      // The publisher's own range wins when we have it. Deriving from page
      // headers would narrow a 12.08-19.08 leaflet to whichever 3-day
      // sub-period happened to be printed on the pages parsed so far.
      await db.update(leaflets).set({
        validFrom: hasPublishedRange
          ? leaflet!.validFrom
          : agg!.from ? new Date(agg!.from) : leafletRange.from,
        validTo: hasPublishedRange
          ? leaflet!.validTo
          : agg!.to ? new Date(agg!.to) : leafletRange.to,
        status: !complete ? 'partial' : Number(agg!.failed) > 0 ? 'partial' : 'done',
      }).where(eq(leaflets.id, leafletId))

      if (stats.capped) break
    }

    await db.update(jobRuns)
      .set({ finishedAt: now(), status: 'ok', stats })
      .where(eq(jobRuns.id, run!.id))
    return stats
  } catch (e) {
    await db.update(jobRuns)
      .set({
        finishedAt: now(), status: 'failed', stats,
        error: e instanceof Error ? e.message : String(e),
      })
      .where(eq(jobRuns.id, run!.id))
    throw e
  }
}
