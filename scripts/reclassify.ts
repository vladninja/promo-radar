/**
 * Re-runs the category rules over every stored offer.
 *
 * Deliberately narrower than `rescore`: it touches the category column and
 * nothing else, so it is safe to run while a scan is inserting. Rescore rebuilds
 * product links and deletes the products table, which is not.
 *
 * It only rescues offers sitting in "inne". Most categories were assigned by the
 * model while reading the page, and the model is far better at this than the
 * keyword rules — running the rules over everything would move 626 of 1272
 * offers, the bulk of them into "inne". Rules may promote, never demote.
 *
 * Usage: pnpm tsx scripts/reclassify.ts [--apply]
 */
import { eq } from 'drizzle-orm'
import { db, pool } from '@/lib/db/client'
import { offers } from '@/lib/db/schema'
import { classifyCategory } from '@/lib/normalize/category'

const apply = process.argv.includes('--apply')

try {
  const rows = await db
    .select({ id: offers.id, rawName: offers.rawName, category: offers.category })
    .from(offers)

  const moves = new Map<string, number>()
  let changed = 0
  for (const row of rows) {
    if (row.category !== 'inne') continue
    const next = classifyCategory(row.rawName)
    if (next === row.category) continue
    changed++
    const key = `${row.category} -> ${next}`
    moves.set(key, (moves.get(key) ?? 0) + 1)
    if (apply) {
      await db.update(offers).set({ category: next }).where(eq(offers.id, row.id))
    }
  }

  for (const [move, n] of [...moves].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${n.toString().padStart(4)}  ${move}`)
  }
  console.log(
    `\n${changed} of ${rows.length} offers ${apply ? 'reclassified' : 'would move'}` +
    `${apply ? '' : '  (re-run with --apply)'}`,
  )
} catch (e) {
  console.error(e instanceof Error ? e.message : e)
  process.exitCode = 1
} finally {
  await pool.end()
}
