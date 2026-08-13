import { z } from 'zod'

/**
 * One question for the model: are these two the same thing to buy?
 *
 * The trigram cannot answer this. It scores "Ogórek gruntowy" against "Ogórki
 * gruntowe" at 0.52 and "Jabłka Gala" against "Jabłka Ligol" at 0.78 — the pair
 * that should merge below the pair that should not. Any threshold drawn across
 * that ordering is wrong in both directions, which is why the stemmer had to be
 * hand-fed the cases we happened to notice.
 *
 * So the trigram keeps the job it is good at — proposing candidates cheaply out
 * of thousands of products — and the model does the judging.
 */
export interface ProductPair {
  /** Index in the batch, echoed back so the answers can be matched up. */
  i: number
  a: string
  b: string
}

export const VerdictSchema = z.object({
  i: z.number().int(),
  same: z.boolean(),
  /** A few words, for the audit trail. Cheap: it is the only free text asked for. */
  why: z.string(),
})

export const VerdictBatchSchema = z.object({
  v: z.array(VerdictSchema),
})

export type Verdict = z.infer<typeof VerdictSchema>

export interface JudgeClient {
  judge(
    pairs: ProductPair[],
    model: string,
  ): Promise<{ verdicts: Verdict[]; tokensIn: number; tokensOut: number }>
}

export const JUDGE_PROMPT = `You compare products advertised in Polish grocery leaflets.

For each numbered pair, decide whether the two entries are the same thing to
buy — close enough that a shopper choosing between two shops would call it one
product and compare the prices directly.

Same thing:
- the same product written in different grammatical forms: "Ogórek gruntowy" and
  "Ogórki gruntowe", "Nektarynka" and "Nektarynki"
- the same product with wording about how it is displayed or packed: "luzem",
  "układane", "na wagę", "na tackach"
- the same product where one entry names a variety the other leaves open, when
  the other says "różne rodzaje" or names no variety at all

Not the same thing:
- different brands: Łaciate and Mlekovita milk are two products
- different varieties, flavours or kinds: Gala and Ligol apples, red and yellow
  peppers, field and greenhouse cucumbers, smoked and plain cheese
- different states: fresh and frozen, whole and sliced, raw and cooked
- different sizes when both are stated

When it is genuinely unclear, answer false. A wrong merge quotes one shop's
price under another shop's product, which is worse than showing two entries.

Return one verdict per pair, echoing its index in i, with a few words in why.`

/** The pair as the model sees it. Brand and size matter to the judgement. */
export function describeProduct(p: {
  displayName: string
  brand: string | null
  sizeValue: number | null
  sizeUnit: string | null
}): string {
  const brand = p.brand ? `${p.brand} ` : ''
  const size = p.sizeValue && p.sizeUnit ? ` (${p.sizeValue} ${p.sizeUnit})` : ''
  return `${brand}${p.displayName}${size}`.trim()
}

export function buildBatchInput(pairs: ProductPair[]): string {
  return pairs.map((p) => `${p.i}. A: ${p.a}\n   B: ${p.b}`).join('\n')
}
