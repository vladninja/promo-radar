import { and, eq, sql } from 'drizzle-orm'
import type { Db } from '@/lib/db/client'
import { products } from '@/lib/db/schema'
import { canonicalKey, coreName } from '@/lib/normalize/canonical'
import type { Size } from '@/lib/normalize/size'

export const THRESHOLD_ATTACH = 0.55
export const THRESHOLD_REVIEW = 0.45
const SIZE_TOLERANCE = 0.05

export interface MatchInput {
  brand: string | null
  name: string
  size: Size | null
}

export interface MatchResult {
  productId: string
  canonicalKey: string
  method: 'exact' | 'trigram' | 'new'
  score: number | null
  needsReview: boolean
}

export async function attachToProduct(
  db: Db,
  input: MatchInput,
): Promise<MatchResult> {
  const key = canonicalKey(input)
  const core = coreName(input.name)

  const [exact] = await db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.canonicalKey, key))
    .limit(1)
  if (exact) {
    return { productId: exact.id, canonicalKey: key, method: 'exact', score: null, needsReview: false }
  }

  const sizeFilter = input.size
    ? and(
        eq(products.sizeUnit, input.size.unit),
        sql`${products.sizeValue} between ${Math.floor(input.size.value * (1 - SIZE_TOLERANCE))}
            and ${Math.ceil(input.size.value * (1 + SIZE_TOLERANCE))}`,
      )
    : sql`${products.sizeValue} is null`

  const [candidate] = await db
    .select({
      id: products.id,
      score: sql<number>`similarity(${products.displayName}, ${core})`.as('score'),
    })
    .from(products)
    .where(sizeFilter)
    .orderBy(sql`similarity(${products.displayName}, ${core}) desc`)
    .limit(1)

  if (candidate && candidate.score >= THRESHOLD_ATTACH) {
    return {
      productId: candidate.id, canonicalKey: key,
      method: 'trigram', score: candidate.score, needsReview: false,
    }
  }

  const needsReview =
    candidate !== undefined &&
    candidate.score >= THRESHOLD_REVIEW &&
    candidate.score < THRESHOLD_ATTACH

  const [created] = await db
    .insert(products)
    .values({
      canonicalKey: key,
      displayName: core,
      brand: input.brand,
      sizeValue: input.size?.value ?? null,
      sizeUnit: input.size?.unit ?? null,
    })
    .returning({ id: products.id })

  return {
    productId: created!.id, canonicalKey: key, method: 'new',
    score: candidate?.score ?? null, needsReview,
  }
}
