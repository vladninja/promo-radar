import { describe, it, expect, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { eq } from 'drizzle-orm'
import pg from 'pg'
import { linkProducts } from '@/lib/match/link'
import type { JudgeClient } from '@/lib/match/judge'
import { leaflets, matchVerdicts, offers, products, shops } from '@/lib/db/schema'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL_TEST })
const db = drizzle(pool)
const NOW = new Date('2026-08-13T12:00:00Z')
const FROM = new Date('2026-08-12T00:00:00Z')
const TO = new Date('2026-08-14T00:00:00Z')

/** Answers by looking at the words, the way the real judge is meant to. */
function judgeSaying(same: (a: string, b: string) => boolean, calls: { n: number }): JudgeClient {
  return {
    async judge(pairs) {
      calls.n += pairs.length
      return {
        tokensIn: 100 * pairs.length, tokensOut: 20 * pairs.length,
        verdicts: pairs.map((p) => ({ i: p.i, same: same(p.a, p.b), why: 'test' })),
      }
    },
  }
}

async function seedProduct(name: string, matchName: string) {
  const [p] = await db.insert(products).values({
    canonicalKey: `|${matchName}|`, displayName: name, matchName,
  }).returning()
  return p!.id
}

async function seedOffer(shopSlug: string, rawName: string, productId: string, opts: {
  method?: 'exact' | 'trigram' | 'new'
  canonicalKey?: string
} = {}) {
  let [shop] = await db.select().from(shops).where(eq(shops.slug, shopSlug)).limit(1)
  if (!shop) {
    ;[shop] = await db.insert(shops).values({ slug: shopSlug, name: shopSlug }).returning()
  }
  const [leaflet] = await db.insert(leaflets).values({
    shopId: shop!.id, externalId: `${shopSlug}-${rawName}`, sourceSlug: 's',
    pdfUrl: 'https://example.test/x.pdf', publishedAt: NOW,
    fileHash: `${shopSlug}-${rawName}`, pageCount: 1,
  }).returning()
  const [o] = await db.insert(offers).values({
    leafletId: leaflet!.id, pageNo: 1, rawName, name: rawName.toLowerCase(),
    priceGrosze: 299, promoKind: 'price', productId,
    canonicalKey: opts.canonicalKey ?? `|${rawName.toLowerCase()}|`,
    matchMethod: opts.method ?? 'new',
    matchScore: opts.method === 'trigram' ? 0.6 : null,
    validFrom: FROM, validTo: TO, dateSource: 'offer',
  }).returning()
  return o!.id
}

beforeEach(async () => {
  await pool.query(
    'truncate offers, leaflet_pages, leaflets, products, shops, match_verdicts cascade',
  )
})

describe('linkProducts', () => {
  it('merges two products the model calls the same thing', async () => {
    const a = await seedProduct('ogórek gruntowy', 'ogórk gruntow')
    const b = await seedProduct('ogórki gruntowe świeże', 'ogórk gruntow śwież')
    await seedOffer('biedronka', 'Ogórek gruntowy na wagę', a)
    await seedOffer('kaufland', 'Ogórki gruntowe świeże 1 kg', b)

    const calls = { n: 0 }
    const stats = await linkProducts(db, {
      client: judgeSaying(() => true, calls), apply: true, now: NOW,
    })

    expect(stats.candidates).toBe(1)
    expect(stats.asked).toBe(1)
    expect(stats.merged).toBe(1)
    expect(await db.select().from(products)).toHaveLength(1)
    const rows = await db.select().from(offers)
    expect(new Set(rows.map((r) => r.productId)).size).toBe(1)
  })

  it('leaves them alone when the model says they are different', async () => {
    const a = await seedProduct('jabłka gala', 'jabłk gal')
    const b = await seedProduct('jabłka ligol', 'jabłk ligol')
    await seedOffer('biedronka', 'Jabłka Gala 1 kg', a)
    await seedOffer('lidl', 'Jabłka Ligol 1 kg', b)

    const stats = await linkProducts(db, {
      client: judgeSaying(() => false, { n: 0 }), apply: true, now: NOW,
    })

    expect(stats.candidates).toBe(1)
    expect(stats.merged).toBe(0)
    expect(await db.select().from(products)).toHaveLength(2)
  })

  it('undoes a trigram attachment the model rejects', async () => {
    const p = await seedProduct('gry edukacyjne', 'gry edukacyjn')
    await seedOffer('biedronka', 'Gry edukacyjne', p)
    const wrong = await seedOffer('biedronka', 'Karty edukacyjne', p, {
      method: 'trigram', canonicalKey: '|kart edukacyjn|',
    })

    const stats = await linkProducts(db, {
      client: judgeSaying(() => false, { n: 0 }), apply: true, now: NOW,
    })

    expect(stats.split).toBe(1)
    const [row] = await db.select().from(offers).where(eq(offers.id, wrong))
    expect(row!.productId).not.toBe(p)
    expect(row!.matchMethod).toBe('new')
  })

  it('asks once and remembers, so a rescore costs nothing to re-apply', async () => {
    const a = await seedProduct('ogórek gruntowy', 'ogórk gruntow')
    const b = await seedProduct('ogórki gruntowe świeże', 'ogórk gruntow śwież')
    await seedOffer('biedronka', 'Ogórek gruntowy na wagę', a)
    await seedOffer('kaufland', 'Ogórki gruntowe świeże 1 kg', b)

    const calls = { n: 0 }
    await linkProducts(db, {
      client: judgeSaying(() => true, calls), apply: false, now: NOW,
    })
    expect(calls.n).toBe(1)
    expect(await db.select().from(matchVerdicts)).toHaveLength(1)

    // Second run: same question, no client at all — the cache answers it.
    const stats = await linkProducts(db, { client: null, apply: true, now: NOW })
    expect(stats.asked).toBe(0)
    expect(stats.fromCache).toBe(1)
    expect(stats.merged).toBe(1)
    expect(stats.costUsd).toBe(0)
  })

  it('never asks about a whole category on promotion', async () => {
    const a = await seedProduct('wszystkie czekolady milka', 'wszystk czekolad milk')
    const b = await seedProduct('wszystkie czekolady wedel', 'wszystk czekolad wedel')
    await seedOffer('biedronka', 'Wszystkie czekolady Milka', a)
    await seedOffer('lidl', 'Wszystkie czekolady Wedel', b)

    const stats = await linkProducts(db, {
      client: judgeSaying(() => true, { n: 0 }), apply: true, now: NOW,
    })
    expect(stats.candidates).toBe(0)
    expect(stats.merged).toBe(0)
  })
})
