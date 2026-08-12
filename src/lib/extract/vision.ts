import { renderHalves, renderPage } from '@/lib/acquire/rasterize'
import type { PageResult } from '@/lib/extract/schema'

export type { OfferTile, PageResult } from '@/lib/extract/schema'
export { OfferTileSchema, PageResultSchema } from '@/lib/extract/schema'

export interface VisionClient {
  parsePage(
    imagePath: string,
    model: string,
  ): Promise<{ result: PageResult; tokensIn: number; tokensOut: number }>
}

interface OutcomeBase {
  tokensIn: number
  tokensOut: number
  splitRetry: boolean
  imagePath: string
  imageHash: string
}

export type ExtractOutcome =
  | ({ status: 'done'; result: PageResult } & OutcomeBase)
  | ({ status: 'failed'; error: string } & OutcomeBase)

/** A page is suspicious when it yielded nothing, or a priced tile lost its price. */
export function isSuspicious(r: PageResult): boolean {
  if (r.tiles.length === 0) return true
  return r.tiles.some(
    (t) => t.raw_name.trim().length > 0 && t.price === null && t.promo_kind === 'price',
  )
}

export async function extractPage(args: {
  client: VisionClient
  pdfPath: string
  pageNo: number
  outDir: string
  model?: string
  escalationModel?: string
}): Promise<ExtractOutcome> {
  const { client, pdfPath, pageNo, outDir } = args
  const model = args.model ?? 'gpt-5.6-luna'
  const escalation = args.escalationModel ?? 'gpt-5.6-terra'
  let tokensIn = 0
  let tokensOut = 0
  let imagePath = ''
  let imageHash = ''

  try {
    const whole = await renderPage(pdfPath, pageNo, outDir)
    imagePath = whole.path
    imageHash = whole.sha256
    const first = await client.parsePage(whole.path, model)
    tokensIn += first.tokensIn
    tokensOut += first.tokensOut
    if (!isSuspicious(first.result)) {
      return {
        status: 'done', result: first.result,
        tokensIn, tokensOut, splitRetry: false, imagePath, imageHash,
      }
    }

    // Suspicious: re-render as overlapping halves on the stronger model.
    const halves = await renderHalves(pdfPath, pageNo, outDir)
    const merged: PageResult = {
      page_date_badge: first.result.page_date_badge,
      issue_text: first.result.issue_text,
      tiles: [],
    }
    for (const half of halves) {
      const r = await client.parsePage(half.path, escalation)
      tokensIn += r.tokensIn
      tokensOut += r.tokensOut
      merged.tiles.push(...r.result.tiles)
      merged.page_date_badge ??= r.result.page_date_badge
      merged.issue_text ??= r.result.issue_text
    }
    if (isSuspicious(merged)) {
      return {
        status: 'failed',
        error: 'page still suspicious after split retry',
        tokensIn, tokensOut, splitRetry: true, imagePath, imageHash,
      }
    }
    return {
      status: 'done', result: merged,
      tokensIn, tokensOut, splitRetry: true, imagePath, imageHash,
    }
  } catch (e) {
    return {
      status: 'failed',
      error: e instanceof Error ? e.message : String(e),
      tokensIn, tokensOut, splitRetry: false, imagePath, imageHash,
    }
  }
}
