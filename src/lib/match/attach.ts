import { and, eq, isNull, or, sql, type SQLWrapper } from 'drizzle-orm'
import type { Db } from '@/lib/db/client'
import { products } from '@/lib/db/schema'
import { PRIVATE_LABELS, isCategoryPromo } from '@/lib/normalize/brands'
import { canonicalKey, coreName } from '@/lib/normalize/canonical'
import { matchName } from '@/lib/normalize/stem'
import type { Size } from '@/lib/normalize/size'

/** Brands compare on letters and digits only, so "Coca-Cola" meets "Coca Cola". */
export function normalizeBrand(brand: string | null): string | null {
  if (!brand) return null
  const key = brand.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
  return key.length > 0 ? key : null
}

const brandNorm = (col: SQLWrapper) =>
  sql`regexp_replace(lower(${col}), '[^[:alnum:]]+', '', 'g')`

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
  // Similarity has to see the same shape on both sides, so it runs on the
  // stemmed form of each: comparing a stem against inflected Polish scores worse
  // than comparing two inflected forms.
  const stem = matchName(core)
  const brandKey = normalizeBrand(input.brand)

  // Similarity is only meaningful for things that could be the same product in
  // two shops. A whole category on promotion is not a product, and a private
  // label exists in one chain only, so both are matched by exact key alone —
  // which still collapses the same offer printed twice in one leaflet.
  const groupable =
    !isCategoryPromo(core) && !(brandKey !== null && PRIVATE_LABELS.has(brandKey))

  const [exact] = await db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.canonicalKey, key))
    .limit(1)
  if (exact) {
    return { productId: exact.id, canonicalKey: key, method: 'exact', score: null, needsReview: false }
  }

  // Two named brands that are not the same brand are not the same product, however
  // similar the words around them read. "Mleko Łaciate 3,2%" and "Mleko Mlekovita
  // 3,2%" differ by one token and would otherwise merge, which for a price
  // comparison is worse than not matching at all.
  const brandFilter = brandKey
    ? or(isNull(products.brand), sql`${brandNorm(products.brand)} = ${brandKey}`)
    : sql`true`

  const sizeFilter = input.size
    ? and(
        eq(products.sizeUnit, input.size.unit),
        sql`${products.sizeValue} between ${Math.floor(input.size.value * (1 - SIZE_TOLERANCE))}
            and ${Math.ceil(input.size.value * (1 + SIZE_TOLERANCE))}`,
      )
    : sql`${products.sizeValue} is null`

  const candidates = !groupable ? [] : await db
    .select({
      id: products.id,
      brand: products.brand,
      displayName: products.displayName,
      score: sql<number>`similarity(${products.matchName}, ${stem})`.as('score'),
    })
    .from(products)
    .where(and(sizeFilter, brandFilter))
    .orderBy(sql`similarity(${products.matchName}, ${stem}) desc`)
    .limit(5)

  // The rule has to hold in both directions: an unbranded "Paluszki rybne" must
  // not attach itself to Kaufland's "K-CLASSIC Paluszki rybne" either, so
  // ungroupable products are rejected as candidates as well as as searchers.
  const candidate = candidates.find((c) => {
    const cBrand = normalizeBrand(c.brand)
    if (cBrand !== null && PRIVATE_LABELS.has(cBrand)) return false
    return !isCategoryPromo(c.displayName)
  })

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
      matchName: stem,
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
