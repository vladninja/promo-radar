import { config } from '@/lib/config'
import { db, pool } from '@/lib/db/client'
import { createOpenAiVisionClient } from '@/lib/extract/openai-client'
import { isStale, runScan } from '@/lib/pipeline/scan'
import { sources } from '@/lib/sources'

const source = sources['gazetkipromocyjne']!

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
  await pool.end()
}
