import { describe, it, expect } from 'vitest'
import { Pool } from 'pg'

describe('database', () => {
  it('has the pg_trgm extension available', async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL_TEST })
    const { rows } = await pool.query(
      "select extname from pg_extension where extname = 'pg_trgm'",
    )
    await pool.end()
    expect(rows).toHaveLength(1)
  })
})
