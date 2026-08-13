/**
 * Retailer private labels. A private label exists in exactly one chain, so it can
 * never legitimately match a product in another — and a name similarity that
 * says otherwise is always wrong.
 *
 * Keys are brand names with punctuation and case removed, matching
 * normalizeBrand(). Maintained by hand; only labels actually seen in leaflets
 * need to be here, and an unknown label simply falls back to normal matching.
 */
export const PRIVATE_LABELS = new Set([
  // Biedronka
  'mlecznadolina',
  'krainamięs',
  'krainawędlin',
  'czasnagrill',
  'vitalfresh',
  'smacznego',
  'govege',
  // Lidl
  'pikok',
  'floralys',
  'oceansea',
  'bellarom',
  'milbona',
  'combino',
  'dulano',
  'freeway',
  'solevita',
  // Kaufland
  'kclassic',
  'kstądtakiedobre',
  'kaufland',
])

/**
 * "Wszystkie paczkowane kabanosy" is a whole category on promotion, not a
 * product. Two shops discounting their own kabanosy ranges — on different terms,
 * over different items — are not selling the same thing, so these must never be
 * grouped with anything but themselves.
 */
export function isCategoryPromo(coreName: string): boolean {
  return /^wszystk\w+\b/.test(coreName)
}
