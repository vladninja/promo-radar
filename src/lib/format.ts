export function formatZl(grosze: number | null): string {
  if (grosze === null) return '—'
  const zl = Math.floor(grosze / 100)
  const gr = String(grosze % 100).padStart(2, '0')
  return `${zl},${gr} zł`
}

const BASIS_LABEL: Record<string, string> = { kg: 'zł/kg', l: 'zł/l', pcs: 'zł/szt.' }

export function formatUnitPrice(
  grosze: number | null,
  basis: 'kg' | 'l' | 'pcs' | null,
): string {
  if (grosze === null || basis === null) return '—'
  const zl = Math.floor(grosze / 100)
  const gr = String(grosze % 100).padStart(2, '0')
  return `${zl},${gr} ${BASIS_LABEL[basis]}`
}

const dd = (d: Date) => String(d.getUTCDate()).padStart(2, '0')
const mm = (d: Date) => String(d.getUTCMonth() + 1).padStart(2, '0')

export function formatRange(from: Date | null, to: Date | null): string {
  if (!from || !to) return '—'
  return `${dd(from)}.${mm(from)} – ${dd(to)}.${mm(to)}`
}

export function formatPromo(
  kind: string,
  minQty: number | null,
  discountPercent: number | null,
): string {
  const pct = discountPercent !== null ? `${discountPercent}% taniej` : 'promocja'
  switch (kind) {
    case 'bogo': return '1+1 gratis'
    case 'multibuy': return `przy zakupie ${minQty ?? '?'}: ${pct}`
    case 'percent': return pct
    default: return 'cena promocyjna'
  }
}

/**
 * One label per mechanic, the same on every card.
 *
 * formatPromo spells out the specifics — "przy zakupie 3: 60% taniej" — which is
 * what the detail page wants and what makes a grid unreadable: forty cards, no
 * two chips alike, nothing scannable. Here the chip says what kind of deal it is
 * and the price beside it says the rest.
 */
export const PROMO_KIND_LABELS: Record<string, string> = {
  price: 'Cena promo',
  percent: 'Rabat',
  multibuy: 'Wielosztuka',
  bogo: 'Gratis',
}

export function promoKindLabel(kind: string): string {
  return PROMO_KIND_LABELS[kind] ?? PROMO_KIND_LABELS.price!
}
