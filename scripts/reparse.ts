import { eq } from 'drizzle-orm'
import { db, pool } from '@/lib/db/client'
import { leaflets, leafletPages, offers } from '@/lib/db/schema'

const externalId = process.argv[2]
if (!externalId) {
  console.error('usage: pnpm reparse <externalId>')
  process.exit(1)
}

try {
  const [leaflet] = await db.select().from(leaflets)
    .where(eq(leaflets.externalId, externalId)).limit(1)
  if (!leaflet) throw new Error(`no leaflet with external id ${externalId}`)
  await db.delete(offers).where(eq(offers.leafletId, leaflet.id))
  await db.delete(leafletPages).where(eq(leafletPages.leafletId, leaflet.id))
  await db.update(leaflets).set({ status: 'pending' }).where(eq(leaflets.id, leaflet.id))
  console.log(`cleared leaflet ${externalId}; run pnpm scan to re-extract`)
} finally {
  await pool.end()
}
