import { config } from '@/lib/config'
import { db, pool } from '@/lib/db/client'
import { createOpenAiVisionClient } from '@/lib/extract/openai-client'
import { isStale, runScan } from '@/lib/pipeline/scan'
import { sources } from '@/lib/sources'

const source = sources['gazetkipromocyjne']!

/**
 * Only one scan may run at a time. Two overlapping runs process the same pages
 * and write the offers twice, which is both wasted money and silently doubled
 * data — and a daily cron plus a manual run is exactly how that happens.
 */
const SCAN_LOCK = 8_147_213
const lock = await pool.connect()
const { rows: locked } = await lock.query<{ ok: boolean }>(
  'select pg_try_advisory_lock($1) as ok', [SCAN_LOCK],
)
if (!locked[0]?.ok) {
  console.error('another scan holds the lock — not starting a second one')
  lock.release()
  await pool.end()
  process.exit(3)
}

try {
  const stats = await runScan({
    db, source,
    client: createOpenAiVisionClient(),
    storageDir: config.storageDir,
    now: () => new Date(),
    maxPages: config.maxPagesPerRun,
    maxLeafletAgeDays: config.maxLeafletAgeDays,
  })
  console.log(JSON.stringify(stats))

  if (isStale(stats)) {
    console.error('No current leaflets listed at all — the source may have changed.')
    process.exitCode = 1
  }
  if (stats.pagesFailed > 0) {
    console.error(`${stats.pagesFailed} pages failed to extract.`)
    process.exitCode = 1
  }
} catch (e) {
  console.error(e)
  process.exitCode = 2
} finally {
  await lock.query('select pg_advisory_unlock($1)', [SCAN_LOCK])
  lock.release()
  await pool.end()
}
