/**
 * Asks the model about product pairs the trigram cannot settle, then applies the
 * answers.
 *
 * The trigram is a good candidate generator and a poor judge: it scored "Ogórek
 * gruntowy" against "Ogórki gruntowe" at 0.52 and "Jabłka Gala" against "Jabłka
 * Ligol" at 0.78 — the pair that should merge below the pair that must not. No
 * threshold drawn across that ordering is right. So similarity proposes and the
 * model disposes, in both directions: pairs it was too shy to merge, and
 * attachments it made on a score alone.
 *
 * Every verdict is cached under the two canonical keys, so re-running costs
 * nothing and a rescore can be re-applied for free.
 *
 * Usage:
 *   pnpm tsx scripts/link-products.ts                # dry run, cache only
 *   pnpm tsx scripts/link-products.ts --ask          # dry run, spends tokens
 *   pnpm tsx scripts/link-products.ts --ask --apply  # the real thing
 *   pnpm tsx scripts/link-products.ts --apply        # re-apply cache after a rescore
 *   ... --max 200                                    # cap the questions asked
 */
import { db, pool } from '@/lib/db/client'
import { linkProducts } from '@/lib/match/link'
import { createOpenAiJudgeClient } from '@/lib/match/openai-judge'

const argv = process.argv.slice(2)
const ask = argv.includes('--ask')
const apply = argv.includes('--apply')
const maxIdx = argv.indexOf('--max')
const maxQuestions = maxIdx >= 0 ? Number(argv[maxIdx + 1]) : undefined

try {
  const stats = await linkProducts(db, {
    client: ask ? createOpenAiJudgeClient() : null,
    apply,
    maxQuestions,
  })
  console.log(JSON.stringify(stats))
  if (!ask && stats.candidates > stats.fromCache) {
    console.log(
      `${stats.candidates - stats.fromCache} pairs undecided — re-run with --ask`,
    )
  }
  if (!apply) console.log('dry run — re-run with --apply')
} catch (e) {
  console.error(e instanceof Error ? e.message : e)
  process.exitCode = 1
} finally {
  await pool.end()
}
