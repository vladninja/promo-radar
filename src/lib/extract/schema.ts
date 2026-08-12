import { z } from 'zod'

export const OfferTileSchema = z.object({
  raw_name: z.string(),
  brand: z.string().nullable(),
  price: z.string().nullable(),
  price_before: z.string().nullable(),
  price_regular: z.string().nullable(),
  discount_percent: z.number().int().nullable(),
  promo_kind: z.enum(['price', 'percent', 'multibuy', 'bogo']),
  min_qty: z.number().int().nullable(),
  unit_price_raw: z.string().nullable(),
  requires_loyalty: z.boolean(),
  purchase_limit: z.string().nullable(),
  date_badge: z.string().nullable(),
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
