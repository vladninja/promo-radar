import { sql } from 'drizzle-orm'
import { offers } from '@/lib/db/schema'

/**
 * A promotion's discount, as a shopper would experience it.
 *
 * "Trzeci produkt 100% taniej" is a third off three items, not a 100% cut, but
 * it is printed as 100 — so ordering on the printed number puts price-less
 * bundles at the head of every list and buries the real bargains. Spreading the
 * headline over the bundle it applies to ranks them where they belong.
 *
 * Shared by the listing and the similar-promotions strip so the two agree about
 * what counts as a big discount.
 */
export const effectiveDiscount = sql`case
  when ${offers.promoKind} = 'multibuy' and coalesce(${offers.minQty}, 0) > 1
    then ${offers.discountPercent}::numeric / ${offers.minQty}
  else ${offers.discountPercent}::numeric
end`
