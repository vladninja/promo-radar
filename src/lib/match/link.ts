import { eq, inArray, sql } from 'drizzle-orm'
import type { Db } from '@/lib/db/client'
import { config } from '@/lib/config'
import { matchVerdicts, offers, products } from '@/lib/db/schema'
import { PRIVATE_LABELS, isCategoryPromo } from '@/lib/normalize/brands'
import { coreName } from '@/lib/normalize/canonical'
import { matchName } from '@/lib/normalize/stem'
import { extractSize } from '@/lib/normalize/size'
import { normalizeBrand } from '@/lib/match/attach'
import { describeProduct, type JudgeClient, type ProductPair } from '@/lib/match/judge'

/**
 * Similarity band the model is asked about.
 *
 * Below the floor the two names share almost nothing and asking is noise; above
 * the ceiling the keys are identical and there is nothing to decide. The band
 * deliberately spans the old attach threshold in both directions, because the
 * trigram is wrong on both sides of it: it left "Ogórki gruntowe" un-merged at
 * 0.52 and merged "Karty edukacyjne" into "gry edukacyjne" at 0.55.
 */
export const BAND_LOW = 0.35
export const BAND_HIGH = 0.98
const SIZE_TOLERANCE = 0.05
const BATCH = 40

export interface LinkStats {
  candidates: number
  asked: number
  fromCache: number
  merged: number
  split: number
  tokensIn: number
  tokensOut: number
  costUsd: number
}

interface Question {
  key: string
  a: string
  b: string
  /** What to do about it, once the verdict is in. */
  kind: 'merge' | 'split'
  aId: string
  bId: string
}

/** Order-independent, and stable across a rescore because it names no ids. */
function pairKey(a: string, b: string): string {
  return a < b ? `${a} ~ ${b}` : `${b} ~ ${a}`
}

function groupable(p: { brand: string | null; displayName: string }): boolean {
  const brand = normalizeBrand(p.brand)
  if (brand !== null && PRIVATE_LABELS.has(brand)) return false
  return !isCategoryPromo(p.displayName)
}

/**
 * Products the trigram thinks might be the same, for the model to decide.
 *
 * Same size basis and size within tolerance, as in the matcher — the model is
 * asked about names, not about whether 200 g is 500 g. Both must be on offer
 * now, so a dead archive is never paid for.
 */
async function mergeCandidates(db: Db, now: Date, low: number, high: number) {
  const rows = await db.execute(sql`
    with live as (
      select distinct p.id, p.canonical_key, p.display_name, p.brand,
             p.match_name, p.size_value, p.size_unit
        from products p
        join offers o on o.product_id = p.id
       where o.valid_from <= ${now} and o.valid_to >= ${now}
    )
    select a.id a_id, a.canonical_key a_key, a.display_name a_name, a.brand a_brand,
           a.size_value a_size, a.size_unit a_unit,
           b.id b_id, b.canonical_key b_key, b.display_name b_name, b.brand b_brand,
           b.size_value b_size, b.size_unit b_unit,
           similarity(a.match_name, b.match_name) sim
      from live a
      join live b on a.id < b.id
     where coalesce(a.size_unit::text, '-') = coalesce(b.size_unit::text, '-')
       and (
         (a.size_value is null and b.size_value is null)
         or (a.size_value::numeric between b.size_value * ${sql.raw(String(1 - SIZE_TOLERANCE))}
                                      and b.size_value * ${sql.raw(String(1 + SIZE_TOLERANCE))})
       )
       and similarity(a.match_name, b.match_name) between ${low}::real and ${high}::real
     order by sim desc
  `)
  return rows.rows as Array<Record<string, unknown>>
}

/**
 * Attachments the trigram made on its own judgement, for the model to confirm.
 *
 * Every one of these merged two differently-worded offers on a score alone, and
 * nothing has looked at them since — a wrong one is invisible, because the two
 * products it invented are now one.
 */
async function splitCandidates(db: Db, now: Date) {
  const rows = await db.execute(sql`
    select o.id o_id, o.raw_name, o.brand o_brand, o.canonical_key o_key,
           p.id p_id, p.canonical_key p_key, p.display_name p_name, p.brand p_brand,
           p.size_value p_size, p.size_unit p_unit
      from offers o
      join products p on p.id = o.product_id
     where o.match_method = 'trigram'
       and o.valid_from <= ${now} and o.valid_to >= ${now}
  `)
  return rows.rows as Array<Record<string, unknown>>
}

const str = (v: unknown) => (v === null || v === undefined ? null : String(v))
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))

export async function linkProducts(db: Db, opts: {
  /** Omit to apply cached verdicts only, without spending anything. */
  client?: JudgeClient | null
  model?: string
  now?: Date
  low?: number
  high?: number
  apply?: boolean
  maxQuestions?: number
} = {}): Promise<LinkStats> {
  const now = opts.now ?? new Date()
  const model = opts.model ?? config.visionModel
  const stats: LinkStats = {
    candidates: 0, asked: 0, fromCache: 0, merged: 0, split: 0,
    tokensIn: 0, tokensOut: 0, costUsd: 0,
  }

  const questions: Question[] = []
  const byKey = new Map<string, Question>()
  const add = (q: Question) => {
    if (byKey.has(q.key)) return
    byKey.set(q.key, q)
    questions.push(q)
  }

  for (const r of await mergeCandidates(db, now, opts.low ?? BAND_LOW, opts.high ?? BAND_HIGH)) {
    const a = {
      displayName: String(r.a_name), brand: str(r.a_brand),
      sizeValue: num(r.a_size), sizeUnit: str(r.a_unit),
    }
    const b = {
      displayName: String(r.b_name), brand: str(r.b_brand),
      sizeValue: num(r.b_size), sizeUnit: str(r.b_unit),
    }
    if (!groupable(a) || !groupable(b)) continue
    add({
      key: pairKey(String(r.a_key), String(r.b_key)),
      a: describeProduct(a), b: describeProduct(b),
      kind: 'merge', aId: String(r.a_id), bId: String(r.b_id),
    })
  }

  for (const r of await splitCandidates(db, now)) {
    const offerSide = {
      displayName: coreName(String(r.raw_name)), brand: str(r.o_brand),
      sizeValue: null, sizeUnit: null,
    }
    const productSide = {
      displayName: String(r.p_name), brand: str(r.p_brand),
      sizeValue: num(r.p_size), sizeUnit: str(r.p_unit),
    }
    add({
      key: pairKey(String(r.o_key), String(r.p_key)),
      a: describeProduct(offerSide), b: describeProduct(productSide),
      kind: 'split', aId: String(r.o_id), bId: String(r.p_id),
    })
  }

  stats.candidates = questions.length
  if (questions.length === 0) return stats

  // Cached verdicts first: a rescore throws the products away and rebuilds them,
  // and re-deciding what has already been decided is pure waste.
  const cached = new Map<string, boolean>()
  for (const chunk of chunks([...byKey.keys()], 500)) {
    const rows = await db
      .select({ pairKey: matchVerdicts.pairKey, same: matchVerdicts.same })
      .from(matchVerdicts)
      .where(inArray(matchVerdicts.pairKey, chunk))
    for (const r of rows) cached.set(r.pairKey, r.same)
  }
  stats.fromCache = cached.size

  const unanswered = questions.filter((q) => !cached.has(q.key))
  const budget = opts.maxQuestions ?? Infinity
  const toAsk = opts.client ? unanswered.slice(0, budget) : []

  for (const batch of chunks(toAsk, BATCH)) {
    const pairs: ProductPair[] = batch.map((q, i) => ({ i, a: q.a, b: q.b }))
    const res = await opts.client!.judge(pairs, model)
    stats.tokensIn += res.tokensIn
    stats.tokensOut += res.tokensOut
    stats.asked += batch.length

    const rows = res.verdicts
      .filter((v) => batch[v.i] !== undefined)
      .map((v) => ({
        pairKey: batch[v.i]!.key, aName: batch[v.i]!.a, bName: batch[v.i]!.b,
        same: v.same, reason: v.why.slice(0, 200), model,
      }))
    if (rows.length > 0) {
      await db.insert(matchVerdicts).values(rows).onConflictDoNothing()
      for (const r of rows) cached.set(r.pairKey, r.same)
    }
  }

  const p = config.pricing[model] ?? { input: 0, output: 0 }
  stats.costUsd = (stats.tokensIn * p.input + stats.tokensOut * p.output) / 1_000_000

  if (opts.apply === false) return stats

  // Splits first: an offer wrongly attached must leave before the product it was
  // attached to is weighed up for merging with anything else.
  for (const q of questions) {
    if (q.kind !== 'split') continue
    if (cached.get(q.key) !== false) continue
    stats.split += await detachOffer(db, q.aId)
  }

  const merges = questions.filter((q) => q.kind === 'merge' && cached.get(q.key) === true)
  stats.merged = await applyMerges(db, merges.map((q) => [q.aId, q.bId] as const))

  return stats
}

/** Gives an offer back its own product, as the matcher would have without the trigram. */
async function detachOffer(db: Db, offerId: string): Promise<number> {
  const [o] = await db.select().from(offers).where(eq(offers.id, offerId)).limit(1)
  if (!o || !o.canonicalKey) return 0
  const core = coreName(o.rawName)
  const size = extractSize(o.rawName)
  await db.insert(products).values({
    canonicalKey: o.canonicalKey,
    displayName: core,
    matchName: matchName(core),
    brand: o.brand,
    sizeValue: size?.value ?? null,
    sizeUnit: size?.unit ?? null,
  }).onConflictDoNothing()
  const [own] = await db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.canonicalKey, o.canonicalKey))
    .limit(1)
  if (!own || own.id === o.productId) return 0
  await db.update(offers)
    .set({ productId: own.id, matchMethod: 'new', matchScore: null })
    .where(eq(offers.id, offerId))
  return 1
}

/** Repoints every offer onto one survivor per connected group, and drops the rest. */
async function applyMerges(db: Db, pairs: ReadonlyArray<readonly [string, string]>): Promise<number> {
  if (pairs.length === 0) return 0
  const parent = new Map<string, string>()
  const find = (x: string): string => {
    const p = parent.get(x)
    if (p === undefined || p === x) return x
    const root = find(p)
    parent.set(x, root)
    return root
  }
  for (const [a, b] of pairs) {
    parent.set(a, parent.get(a) ?? a)
    parent.set(b, parent.get(b) ?? b)
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(rb, ra)
  }

  const groups = new Map<string, string[]>()
  for (const id of parent.keys()) {
    const root = find(id)
    groups.set(root, [...(groups.get(root) ?? []), id])
  }

  let absorbed = 0
  for (const members of groups.values()) {
    if (members.length < 2) continue
    // The survivor is whichever product the most offers already point at, so the
    // fewest rows move and the readable name is the one seen most often.
    const counts = await db
      .select({ id: offers.productId, n: sql<number>`count(*)` })
      .from(offers)
      .where(inArray(offers.productId, members))
      .groupBy(offers.productId)
    const survivor = counts
      .sort((x, y) => Number(y.n) - Number(x.n) || String(x.id).localeCompare(String(y.id)))[0]?.id
    if (!survivor) continue
    const losers = members.filter((m) => m !== survivor)
    if (losers.length === 0) continue
    await db.update(offers).set({ productId: survivor }).where(inArray(offers.productId, losers))
    await db.delete(products).where(inArray(products.id, losers))
    absorbed += losers.length
  }
  return absorbed
}

function chunks<T>(xs: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n))
  return out
}
