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
