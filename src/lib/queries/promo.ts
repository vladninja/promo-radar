import { and, eq, gte, lte, ne, sql } from 'drizzle-orm'
import type { Db } from '@/lib/db/client'
import { leaflets, offers, products, shops } from '@/lib/db/schema'
import { coreName } from '@/lib/normalize/canonical'
import { matchName } from '@/lib/normalize/stem'
import type { Category } from '@/lib/normalize/category'
import { effectiveDiscount } from '@/lib/queries/sort'

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
  isGroup: boolean
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
  isGroup: offers.isGroup,
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
    .orderBy(sql`${offers.unitPriceGrosze} asc nulls last, ${offers.priceGrosze} asc nulls last`)
    .limit(24)

  // One entry per shop. Another leaflet prints the same offer twice as well, and
  // keying on the price let a shop appear twice whenever its two printings
  // disagreed — which is exactly when the second one is worth least.
  const seen = new Set<string>()
  return rows
    .filter((r) => {
      if (seen.has(r.shopSlug)) return false
      seen.add(r.shopSlug)
      return true
    })
    .map((r) => ({ ...r, hasImage: isBox(r.bbox) }))
}

/**
 * Other promotions from the same aisle, for browsing sideways.
 *
 * "Other" has to mean other product, not other row. Excluding the offer being
 * viewed left its own siblings in the strip — one watermelon, printed on pages
 * 1, 20 and 49 of the same Lidl leaflet, filled three of the twelve slots
 * underneath itself. The strip carries one card per product, like the listing.
 */
export async function getSimilarPromos(
  db: Db,
  promo: PromoDetail,
  now = new Date(),
  limit = 12,
): Promise<RelatedPromo[]> {
  // The stemmed name of what is being viewed, to rank the aisle against.
  const mine = matchName(coreName(promo.rawName))
  const rows = await db
    .select({
      offerId: offers.id,
      productId: offers.productId,
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
    .leftJoin(products, eq(products.id, offers.productId))
    .where(and(
      eq(offers.category, promo.category),
      // Like with like. A shelf offer among products is a card with no price
      // and nothing to compare; products among shelf offers are the aisle, not
      // a shortlist. Viewed from a shelf offer, the other shelf offers in the
      // aisle are exactly what is worth seeing next.
      eq(offers.isGroup, promo.isGroup),
      ne(offers.id, promo.offerId),
      // "is distinct from" rather than <>: an unmatched offer has a null product
      // and <> would silently drop every one of them.
      promo.productId
        ? sql`${offers.productId} is distinct from ${promo.productId}`
        : sql`true`,
      lte(offers.validFrom, now),
      gte(offers.validTo, now),
    ))
    // Nearest first, then the best deal. An aisle is a coarse thing to be shown:
    // looking at plums, the other plums are what is worth seeing, and ranking the
    // whole of fruit and veg by discount buries them under cut-price cucumbers.
    // Produce is where this matters most, because it carries no brand to group by.
    .orderBy(sql`
      case when ${mine} = '' then 0
           else similarity(${products.matchName}, ${mine}) end desc nulls last,
      ${effectiveDiscount} desc nulls last`)
    // Read wide, then collapse: taking twelve rows first would spend the strip
    // on repeat printings of three products.
    .limit(limit * 8)

  const seen = new Map<string, RelatedPromo & { productId: string | null }>()
  for (const r of rows) {
    const key = r.productId ?? `${r.shopSlug}|${r.rawName}`
    const row = { ...r, hasImage: isBox(r.bbox) }
    const kept = seen.get(key)
    if (!kept) {
      seen.set(key, row)
    } else if ((row.priceGrosze ?? Infinity) < (kept.priceGrosze ?? Infinity)) {
      seen.set(key, row)
    }
  }
  return [...seen.values()].slice(0, limit)
}

/** Where the cropped tile for an offer lives. */
export function cropUrl(offerId: string): string {
  return `/api/crop/${offerId}`
}

/**
 * What a shelf offer probably covers.
 *
 * "WSZYSTKIE PRODUKTY FINISH — drugi 70% taniej" says nothing about which Finish
 * products, because the leaflet prints them on its own pages. Membership is
 * inferred, not stated: same leaflet, same brand where the offer names one, same
 * aisle otherwise. That is a guess, and the heading on the page says so rather
 * than claiming the shop promised it.
 *
 * Other shelf offers are excluded — a leaflet runs several at once, and one is
 * not a member of another.
 */
export async function getGroupMembers(
  db: Db,
  promo: PromoDetail,
  limit = 18,
): Promise<RelatedPromo[]> {
  if (!promo.isGroup) return []
  const brand = promo.brand?.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '') ?? null

  const rows = await db
    .select({
      offerId: offers.id,
      productId: offers.productId,
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
      eq(offers.leafletId, promo.leafletId),
      ne(offers.id, promo.offerId),
      eq(offers.isGroup, false),
      eq(offers.category, promo.category),
      brand
        ? sql`regexp_replace(lower(${offers.brand}), '[^[:alnum:]]+', '', 'g') = ${brand}`
        : sql`true`,
    ))
    .orderBy(sql`${offers.priceGrosze} asc nulls last`)
    .limit(limit * 4)

  const seen = new Set<string>()
  const out: RelatedPromo[] = []
  for (const r of rows) {
    const key = r.productId ?? r.rawName
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ ...r, hasImage: isBox(r.bbox) })
    if (out.length >= limit) break
  }
  return out
}
