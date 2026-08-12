import { describe, it, expect } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  pageCount, pageSizePx, renderPage, renderHalves,
} from '@/lib/acquire/rasterize'

const PDF = 'tests/fixtures/leaflet-2pages.pdf'

describe('rasterize', () => {
  it('counts pages', async () => {
    expect(await pageCount(PDF)).toBe(2)
  })

  it('computes pixel size at a given dpi', async () => {
    // 1146 x 1800 pt at 110 dpi
    expect(await pageSizePx(PDF, 110)).toEqual({ width: 1751, height: 2750 })
  })

  it('renders a page to a hashed jpeg', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pr-'))
    const out = await renderPage(PDF, 1, dir)
    expect(out.path.endsWith('.jpg')).toBe(true)
    expect(out.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(statSync(out.path).size).toBeGreaterThan(50_000)
  })

  it('is deterministic — the same page hashes the same twice', async () => {
    const a = await renderPage(PDF, 1, await mkdtemp(join(tmpdir(), 'pr-')))
    const b = await renderPage(PDF, 1, await mkdtemp(join(tmpdir(), 'pr-')))
    expect(a.sha256).toBe(b.sha256)
  })

  it('renders two overlapping halves', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pr-'))
    const halves = await renderHalves(PDF, 1, dir)
    expect(halves).toHaveLength(2)
    expect(halves[0]!.sha256).not.toBe(halves[1]!.sha256)
    for (const h of halves) expect(statSync(h.path).size).toBeGreaterThan(20_000)
  })
})
