import { describe, it, expect } from 'vitest'
import { parseGrosze, parseUnitPrice } from '@/lib/normalize/money'

describe('parseGrosze', () => {
  const cases: Array<[string, number | null]> = [
    ['7,99', 799],
    ['7 99', 799],          // big-digit price rendered with a gap
    ['28,99', 2899],
    ['1,50', 150],
    ['2,99 zł', 299],
    ['14,99/kg', 1499],
    ['0,80', 80],
    ['199', 19900],         // whole zloty, no decimals
    ['', null],
    ['gratis', null],
  ]
  it.each(cases)('parses %s', (input, expected) => {
    expect(parseGrosze(input)).toBe(expected)
  })
})

describe('parseUnitPrice', () => {
  it('normalizes zł/100 g to per kilogram', () => {
    expect(parseUnitPrice('0,80 zł/100 g')).toEqual({ grosze: 800, basis: 'kg' })
  })
  it('keeps zł/kg as per kilogram', () => {
    expect(parseUnitPrice('14,99 zł/kg')).toEqual({ grosze: 1499, basis: 'kg' })
  })
  it('normalizes zł/100 ml to per litre', () => {
    expect(parseUnitPrice('1,20 zł/100 ml')).toEqual({ grosze: 1200, basis: 'l' })
  })
  it('keeps zł/l as per litre', () => {
    expect(parseUnitPrice('3,49 zł/l')).toEqual({ grosze: 349, basis: 'l' })
  })
  it('treats per-piece bases as pcs', () => {
    expect(parseUnitPrice('1,50 zł/rolka')).toEqual({ grosze: 150, basis: 'pcs' })
    expect(parseUnitPrice('2,00 zł/szt.')).toEqual({ grosze: 200, basis: 'pcs' })
  })
  it('returns null when there is no unit', () => {
    expect(parseUnitPrice('7,99')).toBeNull()
  })
})
