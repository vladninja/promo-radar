import { readdir, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'

/** Deletes rendered page JPEGs older than the cutoff. PDFs are the archive and are kept. */
export async function prunePages(
  dir: string,
  olderThanDays: number,
  now: Date,
): Promise<number> {
  const cutoff = now.getTime() - olderThanDays * 24 * 3600 * 1000
  let deleted = 0
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      deleted += await prunePages(path, olderThanDays, now)
      continue
    }
    if (!entry.name.endsWith('.jpg')) continue
    if ((await stat(path)).mtime.getTime() < cutoff) {
      await unlink(path)
      deleted++
    }
  }
  return deleted
}
