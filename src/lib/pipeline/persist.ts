import type { Db } from '@/lib/db/client'
import { leafletPages, offers } from '@/lib/db/schema'
import {
  parseBadgeWithin, parseIssueYear, resolveDates, type DateRange,
} from '@/lib/extract/dates'
import type { PageResult } from '@/lib/extract/vision'
import { attachToProduct } from '@/lib/match/attach'
import { coreName } from '@/lib/normalize/canonical'
import { parseGrosze, parseUnitPrice } from '@/lib/normalize/money'
import { classifyCategory, isPetFood } from '@/lib/normalize/category'
import { extractSize } from '@/lib/normalize/size'

export interface PersistArgs {
  leafletId: string
  pageNo: number
  imagePath: string
  imageHash: string
  result: PageResult
  publishedAt: Date
  leafletRange: DateRange
  /**
   * True when leafletRange was invented from the publication date rather than
   * taken from the shop's own listing. Falling back to a real published range is
   * fine; falling back to a guess is what deserves review.
   */
  leafletRangeIsGuess?: boolean
  tokensIn?: number
  tokensOut?: number
  splitRetry?: boolean
}

/**
 * Turns one parsed page into rows. Kept separate from the scan loop so that any
 * source of page results — the vision API, or a reading produced by hand — is
 * treated identically: same date precedence, same money parsing, same size
 * extraction, same product matching.
 */
export async function persistPageResult(
  db: Db,
  args: PersistArgs,
): Promise<{ offersCreated: number }> {
  const { leafletId, pageNo, result, leafletRange } = args

  const year =
    parseIssueYear(result.issue_text ?? '') ?? args.publishedAt.getUTCFullYear()
  const pageRange = result.page_date_badge
    ? parseBadgeWithin(result.page_date_badge, year, leafletRange.to)
    : null

  await db.insert(leafletPages).values({
    leafletId, pageNo,
    imagePath: args.imagePath, imageHash: args.imageHash,
    status: 'done', rawJson: result,
    validFrom: pageRange?.from ?? null, validTo: pageRange?.to ?? null,
    tokensIn: args.tokensIn ?? 0, tokensOut: args.tokensOut ?? 0,
    splitRetry: args.splitRetry ?? false,
  }).onConflictDoUpdate({
    // A page that failed must be replaceable, otherwise the retry succeeds and
    // the row stays marked failed with no data on it.
    target: [leafletPages.leafletId, leafletPages.pageNo],
    set: {
      imagePath: args.imagePath, imageHash: args.imageHash,
      status: 'done', rawJson: result, error: null,
      validFrom: pageRange?.from ?? null, validTo: pageRange?.to ?? null,
      tokensIn: args.tokensIn ?? 0, tokensOut: args.tokensOut ?? 0,
      splitRetry: args.splitRetry ?? false,
    },
  })

  let offersCreated = 0
  for (const tile of result.tiles) {
    const offerRange = tile.date_badge
      ? parseBadgeWithin(tile.date_badge, year, leafletRange.to)
      : null
    const { range, source: dateSrc } = resolveDates(
      offerRange, pageRange, leafletRange,
    )
    const size = extractSize(tile.raw_name)
    // The unit printed against the main price is exact. The smaller per-100 g
    // restatement is rounded, and scaling it up invents a grosz: a shelf price of
    // 7,99 zł/kg is printed as "0,80 zł/100 g", which becomes 8,00 zł/kg.
    const unit =
      (tile.price && tile.price_unit
        ? parseUnitPrice(`${tile.price} zł${tile.price_unit}`)
        : null) ??
      (tile.unit_price_raw ? parseUnitPrice(tile.unit_price_raw) : null)
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
      // Pet food is the one place the rules overrule the model: it sits in the
      // food aisle, so the model files it as groceries, but nobody shopping for
      // dinner wants it in their results.
      category: isPetFood(tile.raw_name)
        ? 'zwierzeta'
        : tile.category ?? classifyCategory(tile.raw_name),
      validFrom: range.from, validTo: range.to, dateSource: dateSrc,
      canonicalKey: match.canonicalKey, productId: match.productId,
      matchMethod: match.method, matchScore: match.score,
      needsReview:
        match.needsReview ||
        (dateSrc === 'leaflet' && args.leafletRangeIsGuess === true),
      bbox: tile.bbox,
    })
    offersCreated++
  }
  return { offersCreated }
}
