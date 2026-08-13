/**
 * Finds the cheapest render resolution that still reads a leaflet correctly.
 *
 * Image tokens scale with page area, and the image is most of the input cost, so
 * rendering smaller is a real saving — but only until the small print stops
 * being legible, and the small print is where unit prices and crossed-out prices
 * live. This runs one page at several resolutions and prints tokens, cost and
 * what was actually read, so the trade-off is measured rather than guessed.
 *
 * Also varies the image `detail` setting, which is the larger lever: cost is
 * patch-based (ceil(w/32) x ceil(h/32)), so 'low' sends a 512x512 copy for a
 * fraction of the tokens, while 'original' skips the downsampling that 'high'
 * applies above ~2500 patches.
 *
 * Usage: pnpm tsx scripts/calibrate-dpi.ts <pdf> [pageNo] [dpiList] [detailList]
 *   pnpm tsx scripts/calibrate-dpi.ts storage/pdf/biedronka/112101.pdf 1 110 low,high,original
 */
import { statSync } from 'node:fs'
import { config } from '@/lib/config'
import { pageSizePx, renderPage } from '@/lib/acquire/rasterize'
import { createOpenAiVisionClient } from '@/lib/extract/openai-client'

const pdf = process.argv[2]
if (!pdf) {
  console.error('usage: tsx scripts/calibrate-dpi.ts <pdf> [pageNo] [dpiList]')
  process.exit(1)
}
const pageNo = Number(process.argv[3] ?? 1)
const dpis = (process.argv[4] ?? '110,90,70').split(',').map(Number)
const details = (process.argv[5] ?? 'high').split(',') as Array<
  'low' | 'high' | 'original' | 'auto'
>

const price = config.pricing[config.visionModel] ?? { input: 0, output: 0 }
const usd = (inTok: number, outTok: number) =>
  (inTok * price.input + outTok * price.output) / 1_000_000

const client = createOpenAiVisionClient()

for (const dpi of dpis) {
  const size = await pageSizePx(pdf, dpi)
  const patches = Math.ceil(size.width / 32) * Math.ceil(size.height / 32)
  const img = await renderPage(pdf, pageNo, `storage/calibrate/${dpi}`, dpi)
  const kb = Math.round(statSync(img.path).size / 1024)

  for (const detail of details) {
    const started = Date.now()
    const out = await client.parsePage(img.path, config.visionModel, detail)
    const seconds = ((Date.now() - started) / 1000).toFixed(1)

    console.log(
      `\n=== ${dpi} dpi / detail=${detail} — ${size.width}x${size.height}px ` +
      `(${patches} patches), ${kb} KB, ${seconds}s\n` +
      `    tokens in ${out.tokensIn}, out ${out.tokensOut}, ` +
      `cost $${usd(out.tokensIn, out.tokensOut).toFixed(5)}, tiles ${out.result.tiles.length}`,
    )
    for (const t of out.result.tiles) {
      console.log(
        `    ${t.raw_name.slice(0, 38).padEnd(38)} p=${String(t.price).padEnd(7)}` +
        ` before=${String(t.price_before).padEnd(7)} unit=${t.unit_price_raw ?? '-'}`,
      )
    }
  }
}
