import { db, pool } from '@/lib/db/client'
import { rescoreAll } from '@/lib/pipeline/rescore'

try {
  console.log(JSON.stringify(await rescoreAll(db)))
} finally {
  await pool.end()
}
