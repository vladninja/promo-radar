import { eq, isNull, or } from 'drizzle-orm'
import type { Db } from '@/lib/db/client'
import { leaflets, offers, products } from '@/lib/db/schema'
import { attachToProduct } from '@/lib/match/attach'
import { reclassifyCategory } from '@/lib/normalize/category'
import { looksLikeTokenPrice } from '@/lib/normalize/money'
import { extractSize } from '@/lib/normalize/size'

/**
 * Re-runs matching over every stored offer. Makes no API calls, so thresholds
 * and the stoplist can be re-tuned against the whole archive for free.
 */
export async function rescoreAll(db: Db): Promise<{ offers: number; relinked: number }> {
  await db.update(offers).set({
    productId: null, matchMethod: null, matchScore: null, needsReview: false,
  })
  await db.delete(products)

  // Leaflets whose validity we had to invent. An offer that fell back to such a
  // range still deserves review, and rescore must not quietly clear that flag.
  const guessed = new Set(
    (await db
      .select({ id: leaflets.id })
      .from(leaflets)
      .where(or(isNull(leaflets.validFrom), isNull(leaflets.validTo)))
    ).map((l) => l.id),
  )

  const rows = await db.select().from(offers)
  let relinked = 0
  for (const row of rows) {
    const match = await attachToProduct(db, {
      brand: row.brand, name: row.rawName, size: extractSize(row.rawName),
    })
    // A price behind a points coupon needs review however well it matched, and
    // rescore clears the flag wholesale, so re-derive it here too.
    const tokenPrice =
      row.requiresCoupon ||
      looksLikeTokenPrice(row.priceGrosze, row.priceBefore ?? row.priceRegular)

    await db.update(offers).set({
      // Re-classify too: extending the keyword rules should reach every offer
      // already stored, not only the ones read afterwards.
      category: reclassifyCategory(row.rawName, row.category),
      canonicalKey: match.canonicalKey, productId: match.productId,
      matchMethod: match.method, matchScore: match.score,
      needsReview:
        match.needsReview || tokenPrice ||
        (row.dateSource === 'leaflet' && guessed.has(row.leafletId)),
    }).where(eq(offers.id, row.id))
    relinked++
  }
  return { offers: rows.length, relinked }
}
