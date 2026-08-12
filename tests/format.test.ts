import { describe, it, expect } from 'vitest'
import { formatZl, formatUnitPrice, formatRange, formatPromo } from '@/lib/format'

describe('formatZl', () => {
  it('renders grosze as zloty with two decimals', () => {
    expect(formatZl(799)).toBe('7,99 zł')
    expect(formatZl(2899)).toBe('28,99 zł')
    expect(formatZl(80)).toBe('0,80 zł')
    expect(formatZl(19900)).toBe('199,00 zł')
  })
  it('renders a dash for no price', () => {
    expect(formatZl(null)).toBe('—')
  })
})

describe('formatUnitPrice', () => {
  it('labels the normalized basis', () => {
    expect(formatUnitPrice(800, 'kg')).toBe('8,00 zł/kg')
    expect(formatUnitPrice(349, 'l')).toBe('3,49 zł/l')
    expect(formatUnitPrice(150, 'pcs')).toBe('1,50 zł/szt.')
  })
  it('renders a dash when unknown', () => {
    expect(formatUnitPrice(null, null)).toBe('—')
    expect(formatUnitPrice(800, null)).toBe('—')
  })
})

describe('formatRange', () => {
  it('renders a day-month range', () => {
    expect(formatRange(
      new Date('2026-08-12T00:00:00Z'),
      new Date('2026-08-14T00:00:00Z'),
    )).toBe('12.08 – 14.08')
  })
  it('handles a missing range', () => {
    expect(formatRange(null, null)).toBe('—')
  })
})

describe('formatPromo', () => {
  it('describes each promo kind', () => {
    expect(formatPromo('price', null, null)).toBe('cena promocyjna')
    expect(formatPromo('percent', null, 72)).toBe('72% taniej')
    expect(formatPromo('multibuy', 3, 60)).toBe('przy zakupie 3: 60% taniej')
    expect(formatPromo('bogo', null, null)).toBe('1+1 gratis')
  })
})
