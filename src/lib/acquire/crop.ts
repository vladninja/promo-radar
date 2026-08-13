import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { pageSizePx } from '@/lib/acquire/rasterize'

const run = promisify(execFile)

export interface Bbox { x: number; y: number; w: number; h: number }

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

/**
 * Renders one promo tile out of its leaflet page.
 *
 * poppler crops straight from the PDF, so the tile comes back sharp at a fraction
 * of the weight — a card grid backed by full page scans would ship tens of
 * megabytes. Results are cached by their inputs, so a card costs one pdftoppm
 * call ever.
 */
export async function renderCrop(
  pdfPath: string,
  pageNo: number,
  bbox: Bbox,
  outDir: string,
  dpi = 96,
): Promise<string> {
  const x = clamp01(bbox.x)
  const y = clamp01(bbox.y)
  const w = clamp01(bbox.w)
  const h = clamp01(bbox.h)

  const key = createHash('sha1')
    .update([pdfPath, pageNo, x, y, w, h, dpi].join('|'))
    .digest('hex')
    .slice(0, 16)
  const out = join(outDir, `${key}.jpg`)
  try {
    await stat(out)
    return out
  } catch {
    // not cached yet
  }

  const page = await pageSizePx(pdfPath, dpi)
  // A tile smaller than this is a misread bbox, not a product photo.
  const cw = Math.max(24, Math.round(w * page.width))
  const ch = Math.max(24, Math.round(h * page.height))
  const cx = Math.min(Math.round(x * page.width), Math.max(0, page.width - cw))
  const cy = Math.min(Math.round(y * page.height), Math.max(0, page.height - ch))

  await mkdir(outDir, { recursive: true })
  await run('pdftoppm', [
    '-f', String(pageNo), '-l', String(pageNo),
    '-r', String(dpi), '-jpeg', '-jpegopt', 'quality=80', '-singlefile',
    '-x', String(cx), '-y', String(cy), '-W', String(cw), '-H', String(ch),
    pdfPath, out.replace(/\.jpg$/, ''),
  ])
  return out
}
