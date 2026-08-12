import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { config } from '@/lib/config'

export const pool = new Pool({ connectionString: config.databaseUrl() })
export const db = drizzle(pool)
export type Db = typeof db
