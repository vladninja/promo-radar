import { and, eq, gte, lte, sql, type SQL } from 'drizzle-orm'
import type { Db } from '@/lib/db/client'
import { leaflets, offers, shops } from '@/lib/db/schema'
import type { Category } from '@/lib/normalize/category'

export interface PromoFilters {
  q?: string
  shop?: string
  crossShopOnly?: boolean
  needsReview?: boolean
  category?: Category
  sort?: 'discount' | 'unit'
  now?: Date
}

export interface PromoRow {
  offerId: string
  productId: string | null
  rawName: string
  shopSlug: string
  priceGrosze: number | null
  unitPriceGrosze: number | null
  unitBasis: 'kg' | 'l' | 'pcs' | null
  promoKind: string
  minQty: number | null
  discountPercent: number | null
  requiresLoyalty: boolean
  needsReview: boolean
  category: Category
  validFrom: Date | null
  validTo: Date | null
  shopCount: number
}

export async function listPromos(db: Db, f: PromoFilters): Promise<PromoRow[]> {
  const now = f.now ?? new Date()

  // Distinct shops currently promoting each product.
  const shopCount = sql<number>`(
    select count(distinct l2.shop_id)
      from offers o2
      join leaflets l2 on l2.id = o2.leaflet_id
     where o2.product_id = ${offers.productId}
       and o2.valid_from <= ${now} and o2.valid_to >= ${now}
  )`

  const where: SQL[] = [lte(offers.validFrom, now), gte(offers.validTo, now)]
  if (f.shop) where.push(eq(shops.slug, f.shop))
  if (f.q) where.push(sql`${offers.rawName} ilike ${'%' + f.q + '%'}`)
  if (f.needsReview) where.push(eq(offers.needsReview, true))
  if (f.category) where.push(eq(offers.category, f.category))
  if (f.crossShopOnly) where.push(sql`${shopCount} > 1`)

  const order = f.sort === 'unit'
    ? sql`${offers.unitPriceGrosze} asc nulls last`
    : sql`${offers.discountPercent} desc nulls last`

  const rows = await db
    .select({
      offerId: offers.id,
      productId: offers.productId,
      rawName: offers.rawName,
      shopSlug: shops.slug,
      priceGrosze: offers.priceGrosze,
      unitPriceGrosze: offers.unitPriceGrosze,
      unitBasis: offers.unitBasis,
      promoKind: offers.promoKind,
      minQty: offers.minQty,
      discountPercent: offers.discountPercent,
      requiresLoyalty: offers.requiresLoyalty,
      needsReview: offers.needsReview,
      category: offers.category,
      validFrom: offers.validFrom,
      validTo: offers.validTo,
      shopCount: shopCount.as('shop_count'),
    })
    .from(offers)
    .innerJoin(leaflets, eq(leaflets.id, offers.leafletId))
    .innerJoin(shops, eq(shops.id, leaflets.shopId))
    .where(and(...where))
    .orderBy(order)
    .limit(300)

  // A leaflet prints its headline offers on the cover and again in the section,
  // so the same promotion arrives twice. That is one promotion, not two: merge on
  // shop, identity, price, mechanic and dates, keeping the fuller printing.
  const merged = new Map<string, PromoRow>()
  for (const r of rows) {
    const row: PromoRow = { ...r, shopCount: Number(r.shopCount) }
    const key = [
      row.shopSlug, row.productId ?? row.rawName, row.priceGrosze ?? 'x',
      row.promoKind, row.minQty ?? 'x', row.requiresLoyalty,
      row.validFrom?.getTime() ?? 'x', row.validTo?.getTime() ?? 'x',
    ].join('|')
    const seen = merged.get(key)
    if (!seen) {
      merged.set(key, row)
      continue
    }
    seen.unitPriceGrosze ??= row.unitPriceGrosze
    seen.unitBasis ??= row.unitBasis
    seen.discountPercent ??= row.discountPercent
    seen.needsReview = seen.needsReview || row.needsReview
  }
  return [...merged.values()]
}
