import { and, eq, gte, inArray, lte, sql, type SQL } from 'drizzle-orm'
import type { Db } from '@/lib/db/client'
import { leaflets, offers, shops } from '@/lib/db/schema'
import { FOOD_CATEGORIES, type Category } from '@/lib/normalize/category'
import { effectiveDiscount } from '@/lib/queries/sort'

export interface PromoFilters {
  q?: string
  shop?: string
  crossShopOnly?: boolean
  needsReview?: boolean
  category?: Category
  foodOnly?: boolean
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
  if (f.foodOnly) where.push(inArray(offers.category, [...FOOD_CATEGORIES]))
  if (f.crossShopOnly) where.push(sql`${shopCount} > 1`)

  const order = f.sort === 'unit'
    ? sql`${offers.unitPriceGrosze} asc nulls last`
    : sql`${effectiveDiscount} desc nulls last`

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
    // Generous, because merging happens below in JS: a limit applied here would
    // truncate before duplicates collapse, so the count shown would be wrong and
    // the tail of the list silently missing. Paging is done on merged rows.
    .limit(5000)

  // One card per product. A leaflet prints its headline offers on the cover and
  // again in the section, and three shops promote the same yoghurt in the same
  // week — to a shopper that is one thing to buy, not four. The cheapest offer
  // represents it here and the detail page lists where else it is on.
  //
  // Offers the matcher could not identify keep a per-shop key: without a product
  // there is nothing to say two of them are the same thing, and collapsing on the
  // printed name alone would merge unrelated goods.
  const merged = new Map<string, PromoRow>()
  for (const r of rows) {
    const row: PromoRow = { ...r, shopCount: Number(r.shopCount) }
    // Loyalty is deliberately not part of the key: a shop quoting "z kartą 1,49"
    // beside "bez karty 1,99" is running one promotion, and listing both makes
    // the shop look like it competes with itself.
    const key = row.productId ?? [
      row.shopSlug, row.rawName, row.promoKind, row.minQty ?? 'x',
      row.validFrom?.getTime() ?? 'x', row.validTo?.getTime() ?? 'x',
    ].join('|')
    const seen = merged.get(key)
    if (!seen) {
      merged.set(key, row)
      continue
    }
    // The price a shopper can actually pay is the lowest of the pair.
    const cheaper =
      (row.priceGrosze ?? Infinity) < (seen.priceGrosze ?? Infinity) ? row : seen
    const other = cheaper === row ? seen : row
    // Filling gaps from the other printing only makes sense within one shop,
    // where both describe the same promotion. Another shop's unit price belongs
    // to another shop's price, and copying it across would quote a figure that
    // appears in no leaflet.
    if (cheaper.shopSlug === other.shopSlug) {
      cheaper.unitPriceGrosze ??= other.unitPriceGrosze
      cheaper.unitBasis ??= other.unitBasis
      cheaper.discountPercent ??= other.discountPercent
    }
    cheaper.needsReview = cheaper.needsReview || other.needsReview
    merged.set(key, cheaper)
  }
  return [...merged.values()]
}

export interface PromoPage {
  rows: PromoRow[]
  total: number
  page: number
  pages: number
}

export const PAGE_SIZE = 60

/** One screen of promotions, paged after merging so the totals are honest. */
export async function listPromoPage(
  db: Db,
  f: PromoFilters,
  page = 1,
): Promise<PromoPage> {
  const all = await listPromos(db, f)
  const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE))
  const current = Math.min(Math.max(1, page), pages)
  return {
    rows: all.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE),
    total: all.length,
    page: current,
    pages,
  }
}
