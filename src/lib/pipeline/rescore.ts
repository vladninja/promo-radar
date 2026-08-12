import { eq } from 'drizzle-orm'
import type { Db } from '@/lib/db/client'
import { offers, products } from '@/lib/db/schema'
import { attachToProduct } from '@/lib/match/attach'
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

  const rows = await db.select().from(offers)
  let relinked = 0
  for (const row of rows) {
    const match = await attachToProduct(db, {
      brand: row.brand, name: row.rawName, size: extractSize(row.rawName),
    })
    await db.update(offers).set({
      canonicalKey: match.canonicalKey, productId: match.productId,
      matchMethod: match.method, matchScore: match.score,
      needsReview: match.needsReview,
    }).where(eq(offers.id, row.id))
    relinked++
  }
  return { offers: rows.length, relinked }
}
