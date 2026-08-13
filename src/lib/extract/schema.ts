import { z } from 'zod'
import { CATEGORIES } from '@/lib/normalize/category'

export const OfferTileSchema = z.object({
  raw_name: z.string(),
  brand: z.string().nullable(),
  price: z.string().nullable(),
  /**
   * Unit printed against the main price, e.g. "/kg". Exact, unlike the rounded
   * small print: a price of 7,99 /kg is restated as "0,80 zł/100 g".
   *
   * Defaulted rather than required, so page results recorded before this field
   * existed — the golden fixture, and every stored raw_json — still parse.
   */
  price_unit: z.string().nullable().default(null),
  price_before: z.string().nullable(),
  price_regular: z.string().nullable(),
  discount_percent: z.number().int().nullable(),
  promo_kind: z.enum(['price', 'percent', 'multibuy', 'bogo']),
  min_qty: z.number().int().nullable(),
  unit_price_raw: z.string().nullable(),
  requires_loyalty: z.boolean(),
  purchase_limit: z.string().nullable(),
  date_badge: z.string().nullable(),
  /** Aisle this promotion belongs to. Defaulted so readings made before
   *  categories existed still parse; a keyword classifier fills the gap. */
  category: z.enum(CATEGORIES).nullable().default(null),
  bbox: z.object({
    x: z.number(), y: z.number(), w: z.number(), h: z.number(),
  }),
})

export const PageResultSchema = z.object({
  page_date_badge: z.string().nullable(),
  issue_text: z.string().nullable(),
  tiles: z.array(OfferTileSchema),
})

export type OfferTile = z.infer<typeof OfferTileSchema>
export type PageResult = z.infer<typeof PageResultSchema>

/**
 * What the model is actually asked to emit. Two thirds of the cost of a page is
 * output tokens, and most of that was field names repeated on every tile, so the
 * wire format uses short keys and a positional bbox. It is mapped straight back
 * to PageResult, which stays the shape everything downstream reads.
 */
export const WireTileSchema = z.object({
  n: z.string(),                       // name, as printed
  br: z.string().nullable(),           // brand
  p: z.string().nullable(),            // price
  pu: z.string().nullable(),           // unit printed against the price, e.g. "/kg"
  pb: z.string().nullable(),           // price before the reduction
  pr: z.string().nullable(),           // regular / non-promotional price
  d: z.number().int().nullable(),      // discount percent
  k: z.enum(['price', 'percent', 'multibuy', 'bogo']),
  q: z.number().int().nullable(),      // minimum quantity
  u: z.string().nullable(),            // unit price, as printed
  l: z.boolean(),                      // loyalty card required
  lim: z.string().nullable(),          // purchase limit
  dt: z.string().nullable(),           // dates only, e.g. "12.08-14.08"
  c: z.enum(CATEGORIES),               // aisle
  b: z.array(z.number()).length(4),    // bbox: x, y, w, h
})

export const WirePageSchema = z.object({
  pd: z.string().nullable(),           // page-level date range
  iss: z.string().nullable(),          // issue marking, e.g. "NR 33/2026"
  t: z.array(WireTileSchema),
})

export type WirePage = z.infer<typeof WirePageSchema>

export function toPageResult(w: WirePage): PageResult {
  return {
    page_date_badge: w.pd,
    issue_text: w.iss,
    tiles: w.t.map((t) => ({
      raw_name: t.n,
      brand: t.br,
      price: t.p,
      price_unit: t.pu,
      price_before: t.pb,
      price_regular: t.pr,
      discount_percent: t.d,
      promo_kind: t.k,
      min_qty: t.q,
      unit_price_raw: t.u,
      requires_loyalty: t.l,
      purchase_limit: t.lim,
      date_badge: t.dt,
      category: t.c,
      bbox: { x: t.b[0]!, y: t.b[1]!, w: t.b[2]!, h: t.b[3]! },
    })),
  }
}
