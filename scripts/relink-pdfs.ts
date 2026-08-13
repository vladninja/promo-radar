/**
 * Renames stored PDFs to match the external id their leaflet now has.
 *
 * The pipeline derives a leaflet's file path from its external id. When the id
 * scheme changed — media attachment ids became PDF file stems — the database was
 * re-keyed but the files on disk kept their old names, so every path missed:
 * crops 404, and a scan would try to re-download leaflets it already had.
 *
 * Files are matched to rows by sha256, never by guessing at the old name, so a
 * mismatch is reported rather than papered over.
 *
 * Usage: pnpm tsx scripts/relink-pdfs.ts [--apply]
 */
import { createHash } from 'node:crypto'
import { readdir, readFile, rename, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { config } from '@/lib/config'
import { db, pool } from '@/lib/db/client'
import { leaflets, shops } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

const apply = process.argv.includes('--apply')

try {
  const rows = await db
    .select({
      externalId: leaflets.externalId,
      fileHash: leaflets.fileHash,
      shopSlug: shops.slug,
    })
    .from(leaflets)
    .innerJoin(shops, eq(shops.id, leaflets.shopId))
  const byHash = new Map(rows.map((r) => [r.fileHash, r]))

  const pdfDir = join(config.storageDir, 'pdf')
  let renamed = 0
  let ok = 0
  let orphans = 0

  for (const shop of await readdir(pdfDir)) {
    const dir = join(pdfDir, shop)
    if (!(await stat(dir)).isDirectory()) continue
    for (const file of await readdir(dir)) {
      if (!file.endsWith('.pdf')) continue
      const path = join(dir, file)
      const hash = createHash('sha256').update(await readFile(path)).digest('hex')
      const row = byHash.get(hash)
      if (!row) {
        console.log(`orphan   ${shop}/${file} — no leaflet has this file's hash`)
        orphans++
        continue
      }
      const want = `${row.externalId}.pdf`
      if (file === want) { ok++; continue }
      console.log(`rename   ${shop}/${file} -> ${want}`)
      if (apply) await rename(path, join(dir, want))
      renamed++
    }
  }

  console.log(
    `\n${ok} already correct, ${renamed} ${apply ? 'renamed' : 'to rename'}, ` +
    `${orphans} orphaned${apply ? '' : '  (re-run with --apply)'}`,
  )
} catch (e) {
  console.error(e instanceof Error ? e.message : e)
  process.exitCode = 1
} finally {
  await pool.end()
}
