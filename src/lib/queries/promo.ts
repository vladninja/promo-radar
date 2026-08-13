import { and, eq, gte, lte, ne, sql } from 'drizzle-orm'
import type { Db } from '@/lib/db/client'
import { leaflets, offers, shops } from '@/lib/db/schema'
import type { Category } from '@/lib/normalize/category'

export interface PromoDetail {
  offerId: string
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
  purchaseLimit: offers.purchaseLimit,
  validFrom: offers.validFrom,
  validTo: offers.validTo,
  dateSource: offers.dateSource,
  needsReview: offers.needsReview,
  productId: offers.productId,
  bbox: offers.bbox,
}

export async function getPromo(db: Db, offerId: string): Promise<PromoDetail | null> {
  const [row] = await db
    .select(detailColumns)
    .from(offers)
    .innerJoin(leaflets, eq(leaflets.id, offers.leafletId))
    .innerJoin(shops, eq(shops.id, leaflets.shopId))
    .where(eq(offers.id, offerId))
    .limit(1)
  if (!row) return null
  return { ...row, bbox: isBox(row.bbox) ? row.bbox : null }
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
      ne(offers.id, promo.offerId),
      lte(offers.validFrom, now),
      gte(offers.validTo, now),
    ))
    .orderBy(sql`${offers.unitPriceGrosze} asc nulls last`)
    .limit(12)
  return rows.map((r) => ({ ...r, hasImage: isBox(r.bbox) }))
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
