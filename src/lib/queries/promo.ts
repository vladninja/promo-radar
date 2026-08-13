import { and, eq, gte, lte, ne, sql } from 'drizzle-orm'
import type { Db } from '@/lib/db/client'
import { leaflets, offers, shops } from '@/lib/db/schema'
import type { Category } from '@/lib/normalize/category'

export interface PromoDetail {
  offerId: string
  /** Every page of the leaflet that printed this promotion. */
  pageNos: number[]
  shopSlug: string
  leafletId: string
  externalId: string
  pageNo: number
  rawName: string
  brand: string | null
  category: Category
  sizeValue: number | null
  sizeUnit: 'g' | 'ml' | 'pcs' | null
  priceGrosze: number | null
  priceBefore: number | null
  priceRegular: number | null
  discountPercent: number | null
  unitPriceGrosze: number | null
  unitBasis: 'kg' | 'l' | 'pcs' | null
  promoKind: string
  minQty: number | null
  requiresLoyalty: boolean
  requiresCoupon: boolean
  couponPoints: number | null
  purchaseLimit: string | null
  validFrom: Date | null
  validTo: Date | null
  dateSource: string
  needsReview: boolean
  productId: string | null
  bbox: { x: number; y: number; w: number; h: number } | null
}

export interface RelatedPromo {
  offerId: string
  shopSlug: string
  rawName: string
  priceGrosze: number | null
  unitPriceGrosze: number | null
  unitBasis: 'kg' | 'l' | 'pcs' | null
  requiresLoyalty: boolean
  hasImage: boolean
}

function isBox(v: unknown): v is { x: number; y: number; w: number; h: number } {
  if (typeof v !== 'object' || v === null) return false
  const b = v as Record<string, unknown>
  return ['x', 'y', 'w', 'h'].every((k) => typeof b[k] === 'number')
}

const detailColumns = {
  offerId: offers.id,
  shopSlug: shops.slug,
  leafletId: offers.leafletId,
  externalId: leaflets.externalId,
  pageNo: offers.pageNo,
  rawName: offers.rawName,
  brand: offers.brand,
  category: offers.category,
  sizeValue: offers.sizeValue,
  sizeUnit: offers.sizeUnit,
  priceGrosze: offers.priceGrosze,
  priceBefore: offers.priceBefore,
  priceRegular: offers.priceRegular,
  discountPercent: offers.discountPercent,
  unitPriceGrosze: offers.unitPriceGrosze,
  unitBasis: offers.unitBasis,
  promoKind: offers.promoKind,
  minQty: offers.minQty,
  requiresLoyalty: offers.requiresLoyalty,
  requiresCoupon: offers.requiresCoupon,
  couponPoints: offers.couponPoints,
  purchaseLimit: offers.purchaseLimit,
  validFrom: offers.validFrom,
  validTo: offers.validTo,
  dateSource: offers.dateSource,
  needsReview: offers.needsReview,
  productId: offers.productId,
  bbox: offers.bbox,
}

/**
 * One promotion, however many rows carry it.
 *
 * A leaflet prints its headline offers on the cover and again in the section, and
 * a shop that quotes both a loyalty price and a price without the card produces a
 * row for each. Those are one promotion to a shopper, so they are folded together
 * here exactly as they are in the list — otherwise every printing has its own
 * page and the same watermelon appears three times.
 */
export async function getPromo(db: Db, offerId: string): Promise<PromoDetail | null> {
  const [row] = await db
    .select(detailColumns)
    .from(offers)
    .innerJoin(leaflets, eq(leaflets.id, offers.leafletId))
    .innerJoin(shops, eq(shops.id, leaflets.shopId))
    .where(eq(offers.id, offerId))
    .limit(1)
  if (!row) return null

  const siblings = await db
    .select(detailColumns)
    .from(offers)
    .innerJoin(leaflets, eq(leaflets.id, offers.leafletId))
    .innerJoin(shops, eq(shops.id, leaflets.shopId))
    .where(and(
      eq(offers.leafletId, row.leafletId),
      eq(offers.rawName, row.rawName),
      eq(offers.promoKind, row.promoKind),
    ))

  const same = siblings.filter((s) =>
    s.minQty === row.minQty &&
    s.validFrom?.getTime() === row.validFrom?.getTime() &&
    s.validTo?.getTime() === row.validTo?.getTime(),
  )

  // The loyalty price is the headline; the price without the card is the
  // comparison, which is what "pr" means everywhere else.
  const card = same.find((s) => s.requiresLoyalty) ?? row
  const plain = same.find((s) => !s.requiresLoyalty)
  const merged = { ...card }
  if (plain && plain.offerId !== card.offerId) {
    merged.priceRegular ??= plain.priceGrosze
    merged.priceBefore ??= plain.priceBefore
    merged.discountPercent ??= plain.discountPercent
  }
  for (const s of same) {
    merged.unitPriceGrosze ??= s.unitPriceGrosze
    merged.unitBasis ??= s.unitBasis
    merged.purchaseLimit ??= s.purchaseLimit
    merged.priceBefore ??= s.priceBefore
    if (!isBox(merged.bbox) && isBox(s.bbox)) merged.bbox = s.bbox
  }

  return {
    ...merged,
    pageNos: [...new Set(same.map((s) => s.pageNo))].sort((a, b) => a - b),
    bbox: isBox(merged.bbox) ? merged.bbox : null,
  }
}

/**
 * The same product on offer in other shops. This is the whole point of the app,
 * so it belongs above the fold on the promo page rather than behind a link.
 */
export async function getSameProductElsewhere(
  db: Db,
  promo: PromoDetail,
  now = new Date(),
): Promise<RelatedPromo[]> {
  if (!promo.productId) return []
  const rows = await db
    .select({
      offerId: offers.id,
      shopSlug: shops.slug,
      rawName: offers.rawName,
      priceGrosze: offers.priceGrosze,
      unitPriceGrosze: offers.unitPriceGrosze,
      unitBasis: offers.unitBasis,
      requiresLoyalty: offers.requiresLoyalty,
      bbox: offers.bbox,
    })
    .from(offers)
    .innerJoin(leaflets, eq(leaflets.id, offers.leafletId))
    .innerJoin(shops, eq(shops.id, leaflets.shopId))
    .where(and(
      eq(offers.productId, promo.productId),
      ne(offers.leafletId, promo.leafletId),   // other leaflets, not other printings
      lte(offers.validFrom, now),
      gte(offers.validTo, now),
    ))
    .orderBy(sql`${offers.unitPriceGrosze} asc nulls last`)
    .limit(12)

  // One entry per shop: another leaflet may print the same offer twice as well.
  const seen = new Set<string>()
  return rows
    .filter((r) => {
      const key = `${r.shopSlug}|${r.priceGrosze}|${r.requiresLoyalty}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map((r) => ({ ...r, hasImage: isBox(r.bbox) }))
}

/** Other promotions from the same aisle, for browsing sideways. */
export async function getSimilarPromos(
  db: Db,
  promo: PromoDetail,
  now = new Date(),
  limit = 12,
): Promise<RelatedPromo[]> {
  const rows = await db
    .select({
      offerId: offers.id,
      shopSlug: shops.slug,
      rawName: offers.rawName,
      priceGrosze: offers.priceGrosze,
      unitPriceGrosze: offers.unitPriceGrosze,
      unitBasis: offers.unitBasis,
      requiresLoyalty: offers.requiresLoyalty,
      bbox: offers.bbox,
    })
    .from(offers)
    .innerJoin(leaflets, eq(leaflets.id, offers.leafletId))
    .innerJoin(shops, eq(shops.id, leaflets.shopId))
    .where(and(
      eq(offers.category, promo.category),
      ne(offers.id, promo.offerId),
      lte(offers.validFrom, now),
      gte(offers.validTo, now),
    ))
    .orderBy(sql`${offers.discountPercent} desc nulls last`)
    .limit(limit)
  return rows.map((r) => ({ ...r, hasImage: isBox(r.bbox) }))
}

/** Where the cropped tile for an offer lives. */
export function cropUrl(offerId: string): string {
  return `/api/crop/${offerId}`
}
