/**
 * A deliberately shallow Polish stemmer, for matching only.
 *
 * Polish inflects the words that name a product: Biedronka prints "Ogórek
 * gruntowy", Kaufland "Ogórki gruntowe", and the trigram similarity between the
 * two is 0.52 — under the attach threshold, so the same cucumber became two
 * products and the price comparison the app exists for never happened. Lidl's
 * "Nektarynki" against Kaufland's "Nektarynki układane" scored 0.41.
 *
 * Two rules cover almost all of it:
 *
 *  - the fleeting e: "ogórek" is "ogórk-" everywhere except the nominative
 *    singular, which is why it does not look like "ogórki";
 *  - one final vowel carries number and gender: -i, -y, -a, -e, -o.
 *
 * Nothing here tries to be a real stemmer. It runs on the already-stripped core
 * name, never on text shown to anyone, and it only has to make two spellings of
 * one product meet. Words of four letters or fewer are left alone: "sok" and
 * "ser" have nothing to spare, and stemming them invents collisions.
 */
const VOWEL_END = /[aeiouyąęó]$/

export function stemWord(word: string): string {
  let w = word
  // ogórek → ogórk, marchewek → marchewk. Before the vowel rule, which would
  // otherwise leave "ogóre".
  if (w.length > 4 && w.endsWith('ek')) w = `${w.slice(0, -2)}k`
  if (w.length > 4 && VOWEL_END.test(w)) w = w.slice(0, -1)
  return w
}

/** The form two spellings of one product are compared on. */
export function matchName(core: string): string {
  return core
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .map(stemWord)
    .join(' ')
}
