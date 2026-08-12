import { and, eq, sql } from 'drizzle-orm'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { config } from '@/lib/config'
import type { Db } from '@/lib/db/client'
import {
  jobRuns, leaflets, leafletPages, offers, shops, sourceCursors,
} from '@/lib/db/schema'
import { pageCount } from '@/lib/acquire/rasterize'
import {
  fallbackLeafletRange, parseDateBadge, parseIssueYear, resolveDates,
} from '@/lib/extract/dates'
import { extractPage, type PageResult, type VisionClient } from '@/lib/extract/vision'
import { attachToProduct } from '@/lib/match/attach'
import { coreName } from '@/lib/normalize/canonical'
import { parseGrosze, parseUnitPrice } from '@/lib/normalize/money'
import { extractSize } from '@/lib/normalize/size'
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

export async function isStale(
  db: Db,
  now: Date,
  staleHours: number,
): Promise<boolean> {
  const [cursor] = await db.select().from(sourceCursors).limit(1)
  if (!cursor) return false
  const age = now.getTime() - cursor.lastSeenDate.getTime()
  return age > staleHours * 3600 * 1000
}

export async function runScan(deps: ScanDeps): Promise<ScanStats> {
  const { db, source, client, storageDir, now } = deps
  const stats: ScanStats = {
    leafletsSeen: 0, leafletsSkippedOld: 0, leafletsSkippedExpired: 0,
    leafletsNew: 0, leafletsResumed: 0,
    pagesExtracted: 0, pagesReused: 0, pagesFailed: 0,
    offersCreated: 0, tokensIn: 0, tokensOut: 0, costUsd: 0, capped: false,
  }

  const [run] = await db
    .insert(jobRuns)
    .values({ script: 'scan', startedAt: now() })
    .returning({ id: jobRuns.id })

  try {
    const [cursor] = await db.select().from(sourceCursors).limit(1)
    const all = await source.discover(
      config.shopAllowlist,
      cursor?.lastSeenDate ?? null,
    )

    // Only leaflets that can still be current. Validity dates live inside the
    // PDF, so publication age is the one signal available before paying to
    // parse. Newest first, so a capped run spends its budget on the freshest.
    const ageCutoff = new Date(
      now().getTime() - deps.maxLeafletAgeDays * 24 * 3600 * 1000,
    )
    const discovered = all
      .filter((d) => {
        // Real validity dates from the shop listing page win: a leaflet whose
        // promotions have ended is skipped before a single page is downloaded.
        if (d.validTo) return d.validTo >= now()
        return d.publishedAt >= ageCutoff
      })
      .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())

    stats.leafletsSeen = discovered.length
    stats.leafletsSkippedOld = all.length - discovered.length

    const shopRows = await db.select().from(shops)
    const shopIdBySlug = new Map(shopRows.map((s) => [s.slug, s.id]))
    let newestSeen = cursor?.lastSeenDate ?? null
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
      // Only discovery advances the cursor; resumed leaflets are already behind it.
      if (item.leafletId === null && (!newestSeen || d.publishedAt > newestSeen)) {
        newestSeen = d.publishedAt
      }

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
      const leafletRange = leaflet!.validFrom && leaflet!.validTo
        ? { from: leaflet!.validFrom, to: leaflet!.validTo }
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

        const year =
          parseIssueYear(outcome.result.issue_text ?? '') ??
          leaflet!.publishedAt.getUTCFullYear()
        const pageRange = outcome.result.page_date_badge
          ? parseDateBadge(outcome.result.page_date_badge, year)
          : null

        await db.insert(leafletPages).values({
          leafletId, pageNo,
          imagePath: outcome.imagePath, imageHash: outcome.imageHash,
          status: 'done', rawJson: outcome.result,
          validFrom: pageRange?.from ?? null, validTo: pageRange?.to ?? null,
          tokensIn: outcome.tokensIn, tokensOut: outcome.tokensOut,
          splitRetry: outcome.splitRetry,
        }).onConflictDoNothing()
        stats.pagesExtracted++

        for (const tile of outcome.result.tiles) {
          const offerRange = tile.date_badge
            ? parseDateBadge(tile.date_badge, year)
            : null
          const { range, source: dateSrc } = resolveDates(
            offerRange, pageRange, leafletRange,
          )
          const size = extractSize(tile.raw_name)
          const unit = tile.unit_price_raw ? parseUnitPrice(tile.unit_price_raw) : null
          const match = await attachToProduct(db, {
            brand: tile.brand, name: tile.raw_name, size,
          })

          await db.insert(offers).values({
            leafletId, pageNo,
            rawName: tile.raw_name, brand: tile.brand, name: coreName(tile.raw_name),
            sizeValue: size?.value ?? null, sizeUnit: size?.unit ?? null,
            priceGrosze: tile.price ? parseGrosze(tile.price) : null,
            priceBefore: tile.price_before ? parseGrosze(tile.price_before) : null,
            priceRegular: tile.price_regular ? parseGrosze(tile.price_regular) : null,
            discountPercent: tile.discount_percent,
            promoKind: tile.promo_kind, minQty: tile.min_qty,
            unitPriceGrosze: unit?.grosze ?? null, unitBasis: unit?.basis ?? null,
            unitPriceRaw: tile.unit_price_raw,
            requiresLoyalty: tile.requires_loyalty,
            purchaseLimit: tile.purchase_limit,
            validFrom: range.from, validTo: range.to, dateSource: dateSrc,
            canonicalKey: match.canonicalKey, productId: match.productId,
            matchMethod: match.method, matchScore: match.score,
            needsReview: match.needsReview || dateSrc === 'leaflet',
            bbox: tile.bbox,
          })
          stats.offersCreated++
        }
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
      const fromSource = leaflet!.validFrom !== null && leaflet!.validTo !== null
      await db.update(leaflets).set({
        validFrom: fromSource
          ? leaflet!.validFrom
          : agg!.from ? new Date(agg!.from) : leafletRange.from,
        validTo: fromSource
          ? leaflet!.validTo
          : agg!.to ? new Date(agg!.to) : leafletRange.to,
        status: !complete ? 'partial' : Number(agg!.failed) > 0 ? 'partial' : 'done',
      }).where(eq(leaflets.id, leafletId))

      if (stats.capped) break
    }

    // A capped run leaves discovered-but-untouched leaflets behind. Advancing
    // the cursor past them would hide them from every future run, so the cursor
    // only moves when the whole discovered set was worked through.
    if (newestSeen && !stats.capped) {
      await db.insert(sourceCursors)
        .values({ sourceSlug: source.slug, lastSeenDate: newestSeen })
        .onConflictDoUpdate({
          target: sourceCursors.sourceSlug,
          set: { lastSeenDate: newestSeen },
        })
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
