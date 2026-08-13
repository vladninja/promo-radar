export type SizeUnit = 'g' | 'ml' | 'pcs'
export interface Size { value: number; unit: SizeUnit }

const num = (s: string) => Number(s.replace(',', '.'))

/** Multipack first: "4 x 125 g" is 500 g, not 125 g. */
const MULTIPACK = /(\d+)\s*[x×]\s*(\d+(?:[,.]\d+)?)\s*(kg|g|l|ml)\b/i
const SINGLE = /(\d+(?:[,.]\d+)?)\s*(kg|g|l|ml)\b/i
const PIECES = /(\d+)\s*(szt\.?|rolki|rolka|opakowa[nń]|sztuk)\b/i

function toCanonical(value: number, unit: string): Size {
  switch (unit.toLowerCase()) {
    case 'kg': return { value: Math.round(value * 1000), unit: 'g' }
    case 'g': return { value: Math.round(value), unit: 'g' }
    case 'l': return { value: Math.round(value * 1000), unit: 'ml' }
    default: return { value: Math.round(value), unit: 'ml' }
  }
}

/**
 * Loose goods sold by weight. "Winogrona jasne luzem 1 kg" is priced per kilo —
 * the "1 kg" is the basis, not a package size — so treating it as a 1000 g pack
 * stops it matching the same fruit sold as "na wagę" in another shop. Loose
 * produce is where shops overlap most, so this matters.
 */
const LOOSE = /\b(luzem|na wag[eę]|na sztuki)\b/i

export function extractSize(name: string): Size | null {
  if (LOOSE.test(name)) return null
  const multi = name.match(MULTIPACK)
  if (multi) {
    const one = toCanonical(num(multi[2]!), multi[3]!)
    return { value: one.value * Number(multi[1]), unit: one.unit }
  }
  const single = name.match(SINGLE)
  if (single) return toCanonical(num(single[1]!), single[2]!)
  const pieces = name.match(PIECES)
  if (pieces) return { value: Number(pieces[1]), unit: 'pcs' }
  return null
}
