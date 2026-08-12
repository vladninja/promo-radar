import { and, eq, gte, lte } from 'drizzle-orm'
import type { Db } from '@/lib/db/client'
import { leaflets, offers, products, shops } from '@/lib/db/schema'

export interface ProductOffer {
  offerId: string
  shopSlug: string
  leafletId: string
  pageNo: number
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

  // Cheapest is decided per unit basis, never across bases: a per-piece price
  // must not win against a per-kilogram one.
  const bestByBasis = new Map<string, number>()
  for (const r of rows) {
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
    offers: rows.map((r) => ({
      ...r,
      isCheapest:
        r.unitBasis !== null &&
        r.unitPriceGrosze !== null &&
        bestByBasis.get(r.unitBasis) === r.unitPriceGrosze,
    })),
  }
}
