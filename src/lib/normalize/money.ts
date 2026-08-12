export type UnitBasis = 'kg' | 'l' | 'pcs'
export interface UnitPrice { grosze: number; basis: UnitBasis }

const NUMBER = /(\d+)\s*[,.]\s*(\d{2})|(\d+)/

/** Parses a printed Polish price into integer grosze. */
export function parseGrosze(raw: string): number | null {
  if (!raw) return null
  // Leaflets render "7 99" with the grosze part as a superscript.
  const spaced = raw.match(/(\d+)\s+(\d{2})(?!\d)/)
  if (spaced) return Number(spaced[1]) * 100 + Number(spaced[2])
  const m = raw.match(NUMBER)
  if (!m) return null
  if (m[1] !== undefined && m[2] !== undefined) {
    return Number(m[1]) * 100 + Number(m[2])
  }
  return Number(m[3]) * 100
}

const BASES: Array<[RegExp, UnitBasis, number]> = [
  [/\/\s*100\s*g/i, 'kg', 10],
  [/\/\s*kg/i, 'kg', 1],
  [/\/\s*100\s*ml/i, 'l', 10],
  [/\/\s*(l|litr)/i, 'l', 1],
  [/\/\s*(szt|rolka|rolki|opak|sztuk)/i, 'pcs', 1],
]

/** Parses a unit price and normalizes it to per kg, per l or per piece. */
export function parseUnitPrice(raw: string): UnitPrice | null {
  if (!raw) return null
  const grosze = parseGrosze(raw)
  if (grosze === null) return null
  for (const [re, basis, factor] of BASES) {
    if (re.test(raw)) return { grosze: grosze * factor, basis }
  }
  return null
}
