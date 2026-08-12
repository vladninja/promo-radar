import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
const DEFAULT_DPI = 110

async function hashFile(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

export async function pageCount(pdfPath: string): Promise<number> {
  const { stdout } = await run('pdfinfo', [pdfPath])
  const m = stdout.match(/^Pages:\s+(\d+)/m)
  if (!m) throw new Error(`pdfinfo gave no page count for ${pdfPath}`)
  return Number(m[1])
}

export async function pageSizePx(
  pdfPath: string,
  dpi = DEFAULT_DPI,
): Promise<{ width: number; height: number }> {
  const { stdout } = await run('pdfinfo', [pdfPath])
  const m = stdout.match(/^Page size:\s+([\d.]+) x ([\d.]+) pts/m)
  if (!m) throw new Error(`pdfinfo gave no page size for ${pdfPath}`)
  return {
    width: Math.round((Number(m[1]) / 72) * dpi),
    height: Math.round((Number(m[2]) / 72) * dpi),
  }
}

const JPEG_ARGS = ['-jpeg', '-jpegopt', 'quality=80']

export async function renderPage(
  pdfPath: string,
  pageNo: number,
  outDir: string,
  dpi = DEFAULT_DPI,
): Promise<{ path: string; sha256: string }> {
  await mkdir(outDir, { recursive: true })
  const prefix = join(outDir, `p${pageNo}`)
  await run('pdftoppm', [
    '-f', String(pageNo), '-l', String(pageNo),
    '-r', String(dpi), ...JPEG_ARGS, '-singlefile',
    pdfPath, prefix,
  ])
  const path = `${prefix}.jpg`
  return { path, sha256: await hashFile(path) }
}

export async function renderHalves(
  pdfPath: string,
  pageNo: number,
  outDir: string,
  dpi = DEFAULT_DPI,
): Promise<Array<{ path: string; sha256: string }>> {
  await mkdir(outDir, { recursive: true })
  const { width, height } = await pageSizePx(pdfPath, dpi)
  const overlap = Math.round(height * 0.1)
  const windows = [
    { y: 0, h: Math.round(height / 2) + overlap, tag: 'top' },
    { y: Math.round(height / 2) - overlap, h: Math.round(height / 2) + overlap, tag: 'bottom' },
  ]
  const out: Array<{ path: string; sha256: string }> = []
  for (const w of windows) {
    const prefix = join(outDir, `p${pageNo}-${w.tag}`)
    await run('pdftoppm', [
      '-f', String(pageNo), '-l', String(pageNo),
      '-r', String(dpi), ...JPEG_ARGS, '-singlefile',
      '-x', '0', '-y', String(w.y), '-W', String(width), '-H', String(w.h),
      pdfPath, prefix,
    ])
    const path = `${prefix}.jpg`
    out.push({ path, sha256: await hashFile(path) })
  }
  return out
}
