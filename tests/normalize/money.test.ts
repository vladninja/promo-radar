import { describe, it, expect } from 'vitest'
import { looksLikeTokenPrice, parseGrosze, parseUnitPrice } from '@/lib/normalize/money'

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

describe('looksLikeTokenPrice', () => {
  it('spots a points-coupon price sitting beside the real one', () => {
    // Kaufland prints "0,01" with "aktywuj kupon" and -1000 points next to a
    // 5,99 promotional price on the same tile.
    expect(looksLikeTokenPrice(1, 899)).toBe(true)
    expect(looksLikeTokenPrice(1, 599)).toBe(true)
  })

  it('leaves ordinary cheap things alone', () => {
    expect(looksLikeTokenPrice(49, 69)).toBe(false)    // 0,49 bread roll
    expect(looksLikeTokenPrice(149, 599)).toBe(false)  // 1,49 watermelon per kg
  })

  it('catches a coupon price that prints no reference at all', () => {
    // The Danio and Oshee tiles gave 0,01 and nothing else; a ratio test alone
    // would have let both through.
    expect(looksLikeTokenPrice(1, null)).toBe(true)
  })

  it('leaves a plausible few-grosze item alone', () => {
    expect(looksLikeTokenPrice(19, null)).toBe(false)   // 0,19 pencil sharpener
  })
})
