import { describe, it, expect } from 'vitest'
import { mkdtemp, utimes, writeFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { prunePages } from '@/lib/pipeline/prune'

describe('prunePages', () => {
  it('deletes jpegs older than the cutoff and keeps the rest', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'prune-'))
    const now = new Date('2026-08-12T00:00:00Z')
    const old = new Date('2026-06-01T00:00:00Z')

    await writeFile(join(dir, 'old.jpg'), 'x')
    await utimes(join(dir, 'old.jpg'), old, old)
    await writeFile(join(dir, 'new.jpg'), 'x')
    await utimes(join(dir, 'new.jpg'), now, now)
    await writeFile(join(dir, 'keep.pdf'), 'x')
    await utimes(join(dir, 'keep.pdf'), old, old)

    const deleted = await prunePages(dir, 30, now)
    expect(deleted).toBe(1)
    expect((await readdir(dir)).sort()).toEqual(['keep.pdf', 'new.jpg'])
  })
})
