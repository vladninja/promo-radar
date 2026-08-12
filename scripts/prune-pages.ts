import { join } from 'node:path'
import { config } from '@/lib/config'
import { prunePages } from '@/lib/pipeline/prune'

const deleted = await prunePages(join(config.storageDir, 'pages'), 30, new Date())
console.log(`deleted ${deleted} page images`)
