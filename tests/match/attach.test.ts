import { describe, it, expect, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { attachToProduct } from '@/lib/match/attach'
import { products } from '@/lib/db/schema'

const pool = new Pool({ connectionString: process.env.DATABASE_URL_TEST })
const db = drizzle(pool)

beforeEach(async () => {
  await pool.query('truncate offers, products cascade')
})

describe('attachToProduct', () => {
  it('creates a new product when nothing matches', async () => {
    const r = await attachToProduct(db, {
      brand: 'Mleczna Dolina',
      name: 'Masło Ekstra Mleczna Dolina, 200 g',
      size: { value: 200, unit: 'g' },
    })
    expect(r.method).toBe('new')
    expect(r.needsReview).toBe(false)
    expect(r.canonicalKey).toBe('mleczna dolina|masło ekstra mleczna dolina|200g')
  })

  it('reuses the product on an exact canonical key', async () => {
    const first = await attachToProduct(db, {
      brand: 'Mleczna Dolina',
      name: 'Masło Ekstra Mleczna Dolina, 200 g',
      size: { value: 200, unit: 'g' },
    })
    const second = await attachToProduct(db, {
      brand: 'mleczna dolina',
      name: 'masło ekstra mleczna dolina 200 g',
      size: { value: 200, unit: 'g' },
    })
    expect(second.method).toBe('exact')
    expect(second.productId).toBe(first.productId)
  })

  it('matches a near-identical name by trigram similarity', async () => {
    const first = await attachToProduct(db, {
      brand: null,
      name: 'Mleko UHT Łaciate 3,2%, 1 l',
      size: { value: 1000, unit: 'ml' },
    })
    const second = await attachToProduct(db, {
      brand: null,
      name: 'Mleko Łaciate 3,2% 1 l',
      size: { value: 1000, unit: 'ml' },
    })
    expect(second.method).toBe('trigram')
    expect(second.productId).toBe(first.productId)
    expect(second.score).toBeGreaterThanOrEqual(0.55)
  })

  it('does not match across different units', async () => {
    await attachToProduct(db, {
      brand: null, name: 'Sok pomarańczowy Hortex, 1 l',
      size: { value: 1000, unit: 'ml' },
    })
    const r = await attachToProduct(db, {
      brand: null, name: 'Sok pomarańczowy Hortex, 1 kg',
      size: { value: 1000, unit: 'g' },
    })
    expect(r.method).toBe('new')
  })

  it('does not match when sizes differ by more than 5%', async () => {
    await attachToProduct(db, {
      brand: null, name: 'Jogurt naturalny Piątnica, 400 g',
      size: { value: 400, unit: 'g' },
    })
    const r = await attachToProduct(db, {
      brand: null, name: 'Jogurt naturalny Piątnica, 150 g',
      size: { value: 150, unit: 'g' },
    })
    expect(r.method).toBe('new')
  })

  it('flags a borderline similarity for review', async () => {
    await db.insert(products).values({
      canonicalKey: 'x|chleb pszenny krojony|500g',
      displayName: 'chleb pszenny krojony',
      sizeValue: 500,
      sizeUnit: 'g',
    })
    const r = await attachToProduct(db, {
      brand: null, name: 'Chleb pszenno-żytni na zakwasie, 500 g',
      size: { value: 500, unit: 'g' },
    })
    // Either a new product or a review flag, but never a silent confident match.
    expect(r.method === 'new' || r.needsReview).toBe(true)
  })

  it('never merges two different named brands', async () => {
    const first = await attachToProduct(db, {
      brand: 'Łaciate', name: 'Mleko UHT Łaciate 3,2%, 1 l',
      size: { value: 1000, unit: 'ml' },
    })
    const second = await attachToProduct(db, {
      brand: 'Mlekovita', name: 'Mleko UHT Mlekovita 3,2%, 1 l',
      size: { value: 1000, unit: 'ml' },
    })
    // The names are one token apart, so similarity alone would merge them.
    expect(second.productId).not.toBe(first.productId)
    expect(second.method).toBe('new')
  })

  it('still matches the same brand written differently', async () => {
    const first = await attachToProduct(db, {
      brand: 'Coca-Cola', name: 'Napój gazowany Coca-Cola, 2 l',
      size: { value: 2000, unit: 'ml' },
    })
    const second = await attachToProduct(db, {
      brand: 'coca cola', name: 'Napój gazowany Coca Cola 2 l',
      size: { value: 2000, unit: 'ml' },
    })
    expect(second.productId).toBe(first.productId)
  })

  it('matches loose goods on name alone', async () => {
    const first = await attachToProduct(db, {
      brand: null, name: 'Winogrono jasne na wagę', size: null,
    })
    const second = await attachToProduct(db, {
      brand: null, name: 'Winogrono jasne', size: null,
    })
    expect(second.productId).toBe(first.productId)
  })
})
