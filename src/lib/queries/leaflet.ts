import { and, eq } from 'drizzle-orm'
import type { Db } from '@/lib/db/client'
import { leaflets, leafletPages, offers, shops } from '@/lib/db/schema'

export interface PageBox {
  offerId: string
  rawName: string
  priceGrosze: number | null
  x: number
  y: number
  w: number
  h: number
}

export interface LeafletPageView {
  leafletId: string
  shopSlug: string
  pageNo: number
  pageCount: number
  imageUrl: string
  boxes: PageBox[]
}

function isBox(v: unknown): v is { x: number; y: number; w: number; h: number } {
  if (typeof v !== 'object' || v === null) return false
  const b = v as Record<string, unknown>
  return ['x', 'y', 'w', 'h'].every((k) => typeof b[k] === 'number')
}

export async function getLeafletPage(
  db: Db,
  leafletId: string,
  pageNo: number,
): Promise<LeafletPageView | null> {
  const [row] = await db
    .select({
      pageCount: leaflets.pageCount,
      shopSlug: shops.slug,
      pageNo: leafletPages.pageNo,
    })
    .from(leafletPages)
    .innerJoin(leaflets, eq(leaflets.id, leafletPages.leafletId))
    .innerJoin(shops, eq(shops.id, leaflets.shopId))
    .where(and(
      eq(leafletPages.leafletId, leafletId),
      eq(leafletPages.pageNo, pageNo),
    ))
    .limit(1)
  if (!row) return null

  const offerRows = await db
    .select({
      offerId: offers.id,
      rawName: offers.rawName,
      priceGrosze: offers.priceGrosze,
      bbox: offers.bbox,
    })
    .from(offers)
    .where(and(eq(offers.leafletId, leafletId), eq(offers.pageNo, pageNo)))

  return {
    leafletId,
    shopSlug: row.shopSlug,
    pageNo: row.pageNo,
    pageCount: row.pageCount,
    imageUrl: `/api/pages/${leafletId}/${pageNo}`,
    boxes: offerRows.flatMap((o) =>
      isBox(o.bbox)
        ? [{
            offerId: o.offerId, rawName: o.rawName, priceGrosze: o.priceGrosze,
            x: o.bbox.x, y: o.bbox.y, w: o.bbox.w, h: o.bbox.h,
          }]
        : [],
    ),
  }
}
