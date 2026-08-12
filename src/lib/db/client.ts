import { drizzle } from 'drizzle-orm/node-postgres'
// `pg` is CommonJS: a named import breaks under plain ESM (tsx scripts/*.ts),
// even though Vite rewrites it fine inside tests.
import pg from 'pg'
import { config } from '@/lib/config'

const { Pool } = pg

export const pool = new Pool({ connectionString: config.databaseUrl() })
export const db = drizzle(pool)
export type Db = typeof db
