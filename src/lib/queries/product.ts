import { and, eq, gte, lte } from 'drizzle-orm'
import type { Db } from '@/lib/db/client'
import { leaflets, offers, products, shops } from '@/lib/db/schema'

export interface ProductOffer {
  offerId: string
  shopSlug: string
  leafletId: string
  pageNo: number
  /** Every page of this leaflet printing the same offer, ascending. */
  pageNos: number[]
  rawName: string
  priceGrosze: number | null
  priceBefore: number | null
  priceRegular: number | null
  unitPriceGrosze: number | null
  unitBasis: 'kg' | 'l' | 'pcs' | null
  promoKind: string
  minQty: number | null
  discountPercent: number | null
  requiresLoyalty: boolean
  purchaseLimit: string | null
  validFrom: Date | null
  validTo: Date | null
  isCheapest: boolean
}

export interface ProductDetail {
  id: string
  displayName: string
  brand: string | null
  sizeValue: number | null
  sizeUnit: 'g' | 'ml' | 'pcs' | null
  offers: ProductOffer[]
}

export async function getProduct(
  db: Db,
  id: string,
  now = new Date(),
): Promise<ProductDetail | null> {
  const [product] = await db.select().from(products).where(eq(products.id, id)).limit(1)
  if (!product) return null

  const rows = await db
    .select({
      offerId: offers.id,
      shopSlug: shops.slug,
      leafletId: offers.leafletId,
      pageNo: offers.pageNo,
      rawName: offers.rawName,
      priceGrosze: offers.priceGrosze,
      priceBefore: offers.priceBefore,
      priceRegular: offers.priceRegular,
      unitPriceGrosze: offers.unitPriceGrosze,
      unitBasis: offers.unitBasis,
      promoKind: offers.promoKind,
      minQty: offers.minQty,
      discountPercent: offers.discountPercent,
      requiresLoyalty: offers.requiresLoyalty,
      purchaseLimit: offers.purchaseLimit,
      validFrom: offers.validFrom,
      validTo: offers.validTo,
    })
    .from(offers)
    .innerJoin(leaflets, eq(leaflets.id, offers.leafletId))
    .innerJoin(shops, eq(shops.id, leaflets.shopId))
    .where(and(
      eq(offers.productId, id),
      lte(offers.validFrom, now),
      gte(offers.validTo, now),
    ))

  // A leaflet prints its headline offers on the cover and again in the section,
  // often with fuller detail the second time, and quotes a loyalty price beside
  // one without the card. All of that is one offer: same shop, same leaflet, same
  // product, same mechanic, same dates. Price and loyalty are deliberately out of
  // the key — with them in, Lidl's watermelon was listed twice, at 1,49 z kartą
  // and at 1,99, on a page whose whole job is to compare shops.
  const merged = new Map<string, typeof rows[number] & { pageNos: number[] }>()
  for (const r of rows) {
    const key = [
      r.shopSlug, r.leafletId, r.rawName, r.promoKind, r.minQty ?? 'x',
      r.validFrom?.getTime() ?? 'x', r.validTo?.getTime() ?? 'x',
    ].join('|')
    const seen = merged.get(key)
    if (!seen) {
      merged.set(key, { ...r, pageNos: [r.pageNo] })
      continue
    }
    const pageNos = [...new Set([...seen.pageNos, r.pageNo])].sort((a, b) => a - b)
    // The loyalty price is the headline and the price without the card is the
    // comparison, exactly as on the promotion page.
    if (r.requiresLoyalty && !seen.requiresLoyalty) {
      const plain = seen.priceGrosze
      Object.assign(seen, r)
      seen.priceRegular ??= plain
    } else if (!r.requiresLoyalty && seen.requiresLoyalty) {
      seen.priceRegular ??= r.priceGrosze
    }
    seen.pageNos = pageNos
    // Keep whichever printing told us more.
    seen.priceBefore ??= r.priceBefore
    seen.priceRegular ??= r.priceRegular
    seen.discountPercent ??= r.discountPercent
    seen.unitPriceGrosze ??= r.unitPriceGrosze
    seen.unitBasis ??= r.unitBasis
    seen.purchaseLimit ??= r.purchaseLimit
    seen.pageNo = pageNos[0]!
  }
  const deduped = [...merged.values()]

  // Cheapest is decided per unit basis, never across bases: a per-piece price
  // must not win against a per-kilogram one.
  const bestByBasis = new Map<string, number>()
  for (const r of deduped) {
    if (r.unitBasis === null || r.unitPriceGrosze === null) continue
    const current = bestByBasis.get(r.unitBasis)
    if (current === undefined || r.unitPriceGrosze < current) {
      bestByBasis.set(r.unitBasis, r.unitPriceGrosze)
    }
  }

  return {
    id: product.id,
    displayName: product.displayName,
    brand: product.brand,
    sizeValue: product.sizeValue,
    sizeUnit: product.sizeUnit,
    offers: deduped.map((r) => ({
      ...r,
      isCheapest:
        r.unitBasis !== null &&
        r.unitPriceGrosze !== null &&
        bestByBasis.get(r.unitBasis) === r.unitPriceGrosze,
    })),
  }
}
