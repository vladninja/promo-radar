import { Pool } from 'pg'

export default async function setup() {
  process.env.DATABASE_URL_TEST ??=
    'postgres://promo:promo@localhost:55432/promo_radar_test'
  const admin = new Pool({
    connectionString: 'postgres://promo:promo@localhost:55432/promo_radar',
  })
  const { rows } = await admin.query(
    "select 1 from pg_database where datname = 'promo_radar_test'",
  )
  if (rows.length === 0) await admin.query('create database promo_radar_test')
  await admin.end()

  const test = new Pool({ connectionString: process.env.DATABASE_URL_TEST })
  await test.query('create extension if not exists pg_trgm')
  await test.end()
}
